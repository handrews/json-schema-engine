// Schema registration and static reference resolution.
//
// The registration walk descends only into *schema positions*, so `$id` or
// `$anchor` inside `enum` data or an unknown keyword's value is never treated
// as an identifier. Unlike the F2 prototype, the positions are not hard-coded:
// the walk asks each keyword behavior's analyze() for its subschema positions
// (DESIGN.md D1/D2), so a custom applicator registered through the dialect
// registry gets correct identifier handling for free.
//
// Registration is all-or-nothing (ADR 0005). The walk writes into a
// per-registration staging object and a single throw-free commit applies it,
// so a throw anywhere in the walk — a non-schema value, a duplicate
// identifier, a regex screen, a custom keyword's analyze(), even a native
// stack overflow — leaves every live index exactly as it was. Anchors are
// committed after documents so that their refs are the interned ones; the
// produced/consumed unions are never evicted, since they only widen
// retention and a stale entry is harmless.

import {
  JsonValue,
  isObject,
  escapeSegment,
  jsonEqual,
  unescapeSegment,
} from "./json.js";
import {
  resolveSplit,
  resolveUri,
  splitFragment,
  SplitUri,
  UnresolvableRefError,
} from "./uri.js";
import { SchemaRef } from "./ref.js";
import {
  Dialect,
  DialectRegistry,
  ReadOnlyRegistryError,
  UnknownDialectError,
} from "./dialect.js";
import { SourceRange } from "./loader.js";

/**
 * A `$dynamicRef` after its scope-independent resolution steps
 * ({@link SchemaRegistry.dynamicReference}): the lexical target, and the
 * anchor name to walk the dynamic scope for, or `null` when no walk applies.
 */
export interface DynamicReference {
  lexical: SchemaRef;
  anchor: string | null;
}

/**
 * A `$recursiveRef` after its scope-independent resolution steps
 * ({@link SchemaRegistry.recursiveReference}): the lexical target, and
 * whether the reference rebinds through the dynamic scope at all — only
 * when its fragment is absent or empty and the lexical target's resource
 * carries `$recursiveAnchor: true` at its root (D8's degenerate case).
 */
export interface RecursiveReference {
  lexical: SchemaRef;
  rebinds: boolean;
}

/**
 * Where a schema resource physically lives: the registered document
 * containing it and the JSON Pointer from that document's root to the
 * resource's root (D17 bridge; see loader.ts).
 */
export interface DocumentLocation {
  documentUri: string;
  pointer: string;
}

/**
 * What a document would register as, worked out without registering it
 * ({@link SchemaRegistry.identify}): its canonical base URI, the
 * fragment-free retrieval URI, and the dialect URI it is governed by.
 */
export interface RootIdentity {
  baseUri: string;
  retrievalResource: string;
  dialectUri: string;
}

/**
 * A value that is not a schema (neither an object nor a boolean) was found
 * where a schema is required (D19): in a keyword-claimed schema position at
 * registration, or applied as a schema during evaluation. Keyword-value
 * validity beyond schema shape is not checked here — that is metaschema
 * validation's job ({@link EngineOptions.validateSchemas}).
 *
 * Thrown during registration, it leaves the registry untouched
 * ({@link SchemaRegistry.register}).
 */
export class InvalidSchemaError extends Error {}

/**
 * Schema nesting (at registration) or schema-application nesting (at
 * evaluation) exceeded {@link EngineOptions.maxDepth}. A bounded, catchable
 * failure that replaces the native stack overflow deep input would otherwise
 * cause; the engine remains usable afterward (each evaluation runs in fresh
 * state, and a failed registration writes nothing). Raise `maxDepth` for
 * legitimately deep documents, within what the runtime's own stack allows.
 */
export class MaxDepthExceededError extends Error {}

/**
 * Two different schema objects claim one resource URI: twice within one
 * document, or a document whose root or embedded `$id` names a resource
 * that a registered document already holds with different content. An
 * equal copy is not a duplicate. Nothing is registered
 * ({@link SchemaRegistry.register}); {@link SchemaRegistry.unregister}
 * is the way to replace a document.
 */
export class DuplicateResourceError extends Error {}

/**
 * Two different schema objects within one resource claim one anchor name
 * — through `$anchor`, `$dynamicAnchor`, or a legacy plain-fragment `$id`,
 * in any combination. One object carrying `$anchor` and `$dynamicAnchor`
 * under the same name names itself twice and is not a duplicate.
 */
export class DuplicateAnchorError extends Error {}

/**
 * A base-URI identifier that cannot name a resource: empty, `"#"`, or
 * carrying a non-empty fragment. A base URI has no fragment; a plain-name
 * fragment belongs to the dialect's anchor keyword. An empty trailing
 * fragment (`"sub#"`) is accepted.
 */
export class InvalidIdentifierError extends Error {}

/**
 * Default schema/application nesting bound. Chosen below the native
 * call-stack ceiling so the typed {@link MaxDepthExceededError} fires before
 * a `RangeError`, while staying generous for real-world documents.
 */
export const DEFAULT_MAX_DEPTH = 512;

/** One-line description of a non-schema value for error messages. */
export function describeNonSchema(node: JsonValue): string {
  if (node === null) return "null";
  return Array.isArray(node) ? "array" : typeof node;
}

/** Whether a thrown value is the runtime's native stack-overflow signal. */
export function isStackOverflow(err: unknown): err is RangeError {
  return err instanceof RangeError && /call stack/i.test(err.message);
}

// A memoized resolution failure: the message to re-throw (a fresh error per
// call keeps stack traces honest). Only UnresolvableRefError is memoized; a
// URIError from a bad escape or an UnknownDialectError is not a fact about
// the registry's contents.
class RefMiss {
  constructor(readonly message: string) {}
}

// Bound on memoized failures per registry: a custom keyword may hand
// ctx.resolveRef instance-derived strings, and each distinct miss would
// otherwise be a permanent entry.
const MAX_MEMOIZED_MISSES = 1024;

// One anchor claimed during a walk: the object that carries it and where
// that object sits in its resource. Plain and dynamic anchors share the
// namespace (a dynamic anchor is also a plain one, D8), so one map holds
// both and the flag says whether `$dynamicRef` may rebind through it.
interface StagedAnchor {
  node: JsonValue;
  pointer: string;
  dynamic: boolean;
}

// One resource a walk claims, with everything the walk learns about it.
interface StagedResource {
  node: JsonValue;
  dialectUri: string;
  location: DocumentLocation;
  // The nearest enclosing staged resource and this root's pointer within
  // it (`undefined` and "" at a document root): what masking reads before
  // a check, and the seed of a location chain (backlog D13).
  parent: string | undefined;
  pointerInParent: string;
  anchors: Map<string, StagedAnchor>;
  recursiveRoot: boolean;
}

/** One resource a registration is about to commit, as a {@link ResourceCheck} sees it. */
export interface StagedResourceView {
  uri: string;
  dialectUri: string;
  node: JsonValue;
}

/**
 * Runs once per staged resource after the walk succeeds and before the
 * commit; a throw leaves the registry untouched. `node` is the resource's
 * schema with the root of each directly embedded resource replaced by `{}`,
 * so a check reads one resource at a time under one dialect.
 */
export type ResourceCheck = (resource: StagedResourceView) => void;

// The resource's schema with the root of each directly embedded resource
// replaced by {} — accepted in every schema position of every bundled
// metaschema (draft-04's types a schema as "object", so `true` would not
// do). Only the path to each child root is copied; the rest is shared. A
// grandchild's parent is the child, so no two replaced paths nest.
function masked(stage: Staging, uri: string, res: StagedResource): JsonValue {
  let node = res.node;
  for (const child of stage.resources.values()) {
    if (child.parent !== uri) continue;
    const path = child.pointerInParent.slice(1).split("/").map(unescapeSegment);
    node = replaceAt(node, path, 0);
  }
  return node;
}

function replaceAt(
  node: JsonValue,
  path: readonly string[],
  i: number,
): JsonValue {
  if (i === path.length) return {};
  const seg = path[i]!;
  if (Array.isArray(node)) {
    const copy = [...node];
    const index = Number(seg);
    copy[index] = replaceAt(copy[index]!, path, i + 1);
    return copy;
  }
  const object = node as Record<string, JsonValue>;
  return { ...object, [seg]: replaceAt(object[seg]!, path, i + 1) };
}

// Everything one registration will write, held until the walk succeeds.
interface Staging {
  documentUri: string;
  retrievalResource: string;
  // A re-registration of an equal document under its own root: the
  // previous version's entries are evicted before this one's are written.
  rebinding: boolean;
  resources: Map<string, StagedResource>; // insertion order = walk order
  produced: Set<string>;
  consumed: Set<string>;
  coverageProducers: Set<string>;
  pending: Set<string>;
}

// A base-URI identifier the dialect's extractor handed back must name a
// resource of its own: empty and `"#"` resolve to the enclosing resource,
// and a fragment cannot be part of a base URI. Checked on the raw text, so
// a malformed escape in a fragment cannot surface as a URIError first.
function checkBaseId(baseId: string, where: string): void {
  if (baseId === "" || baseId === "#") {
    throw new InvalidIdentifierError(
      `base identifier ${JSON.stringify(baseId)} at '${where}' resolves to ` +
        "the enclosing resource and identifies nothing new",
    );
  }
  const hash = baseId.indexOf("#");
  if (hash !== -1 && hash !== baseId.length - 1) {
    throw new InvalidIdentifierError(
      `base identifier ${JSON.stringify(baseId)} at '${where}' carries a ` +
        "fragment; a base URI cannot, and a plain-name fragment belongs to " +
        "the dialect's anchor keyword",
    );
  }
}

/** Schema registration, identifier indexing, and reference resolution. */
export class SchemaRegistry {
  private documents = new Map<string, JsonValue>(); // resource URI -> schema node
  // resource URI -> anchor name -> ref. Two levels rather than a
  // "resource#name" key so that a resource's anchors can be dropped as one
  // entry; an inner map is built at commit and never mutated afterwards,
  // which is what lets a snapshot share it.
  private anchors = new Map<string, ReadonlyMap<string, SchemaRef>>();
  private dynamicAnchors = new Map<string, ReadonlyMap<string, SchemaRef>>(); // $dynamicAnchor only (D8)
  private recursiveRoots = new Set<string>(); // 2019-09 $recursiveAnchor at root
  // Unions of StaticFacts.produces / consumes over every registered keyword
  // occurrence: produce()'s declaration guard and the elision predicate's
  // "someone might read this" side (D5/M5.5).
  private producedBehaviorIds = new Set<string>();
  private consumedBehaviorIds = new Set<string>();
  // Consumed ids whose producer declares evaluated coverage (D9a facts): the
  // only dependency data the coverage channel's shape-dispatching folds
  // understand (coverage.ts).
  private coverageProducerIds = new Set<string>();
  private coverageConsumedIds = new Set<string>();
  private documentDialects = new Map<string, string>(); // resource URI -> dialect URI
  private resourceLocations = new Map<string, DocumentLocation>();
  // Document URI -> the resources its last walk claimed, root first. The
  // truth about who owns a resource is `resourceLocations`; this is the
  // index that makes eviction O(document) rather than O(registry), and a
  // resource an equal copy has since rebound is skipped by the truth check.
  private ownedResources = new Map<string, readonly string[]>();
  // Retrieval URI -> declared $id base, when they differ: the document must
  // be reachable under both, but anchors and lexical bases live under $id.
  private aliases = new Map<string, string>();
  // External resources seen in reference values during registration walks,
  // drained by the load closure (D7).
  private pendingResources = new Set<string>();
  private documentRanges = new Map<
    string,
    (pointer: string) => SourceRange | undefined
  >();
  /**
   * Called for each `pattern`/`patternProperties` regex during a
   * registration walk, when set. The Engine installs this (after registering
   * its trusted metaschemas) to enforce `rejectUnsafeRegex`.
   */
  onRegex?: (pattern: string, location: string) => void;
  // Resolution memos, keyed by referring base then reference value. An
  // entry can point into any resource, so a commit replaces them
  // wholesale (a snapshot keeps the maps it was handed: its answers never
  // change), as does a dialect registration, since pointer navigation
  // rebases per the target dialect's identifier syntax.
  // One SchemaRef object per (canonical base URI, pointer): identity that
  // the engine's caches key on. Keyed by resource so a commit evicts
  // exactly the resources it rewrites; a stale ref that user code still
  // holds keeps working, it just stops being the interned one.
  private interned = new Map<string, Map<string, SchemaRef>>();
  private refMemo = new Map<string, Map<string, SchemaRef | RefMiss>>();
  private dynMemo = new Map<string, Map<string, DynamicReference>>();
  private recMemo = new Map<string, Map<string, RecursiveReference>>();
  private dialectCache = new Map<string, Dialect>(); // resource URI -> dialect
  private misses = 0;
  private dialectGeneration: number;
  // Snapshots share the indexes above copy-on-write: the source copies them
  // before its first commit after a snapshot, so a view stays frozen at no
  // cost until the source changes.
  private shared = false;
  private readOnly = false;

  constructor(
    private dialectRegistry: DialectRegistry,
    private defaultDialectUri: string,
    private maxDepth: number = DEFAULT_MAX_DEPTH,
  ) {
    this.dialectGeneration = dialectRegistry.generation;
  }

  /**
   * A read-only view of the registry's current contents, over a view of the
   * dialect registry. Later registrations on this registry are invisible to
   * the view, and registering into the view throws
   * {@link ReadOnlyRegistryError}. A compiled artifact binds to one so that
   * a compilation boundary cannot change reference resolution (E1).
   */
  snapshot(): SchemaRegistry {
    const view = new SchemaRegistry(
      this.dialectRegistry.snapshot(),
      this.defaultDialectUri,
      this.maxDepth,
    );
    view.documents = this.documents;
    view.anchors = this.anchors;
    view.dynamicAnchors = this.dynamicAnchors;
    view.recursiveRoots = this.recursiveRoots;
    view.producedBehaviorIds = this.producedBehaviorIds;
    view.consumedBehaviorIds = this.consumedBehaviorIds;
    view.coverageProducerIds = this.coverageProducerIds;
    view.coverageConsumedIds = this.coverageConsumedIds;
    view.documentDialects = this.documentDialects;
    view.resourceLocations = this.resourceLocations;
    view.ownedResources = this.ownedResources;
    view.aliases = this.aliases;
    view.documentRanges = this.documentRanges;
    view.interned = this.interned;
    this.syncDialects();
    view.refMemo = this.refMemo;
    view.dynMemo = this.dynMemo;
    view.recMemo = this.recMemo;
    view.dialectCache = this.dialectCache;
    view.misses = this.misses;
    view.readOnly = true;
    this.shared = true;
    return view;
  }

  // Drops the memos when the dialect registry has changed underneath us.
  private syncDialects(): void {
    const gen = this.dialectRegistry.generation;
    if (gen !== this.dialectGeneration) {
      this.dialectGeneration = gen;
      this.resetMemos();
    }
  }

  private resetMemos(): void {
    this.refMemo = new Map();
    this.dynMemo = new Map();
    this.recMemo = new Map();
    this.dialectCache = new Map();
    this.misses = 0;
  }

  private mutable(): void {
    if (this.readOnly) {
      throw new ReadOnlyRegistryError("a registry snapshot is read-only");
    }
    if (!this.shared) return;
    this.documents = new Map(this.documents);
    this.anchors = new Map(this.anchors);
    this.dynamicAnchors = new Map(this.dynamicAnchors);
    this.recursiveRoots = new Set(this.recursiveRoots);
    this.producedBehaviorIds = new Set(this.producedBehaviorIds);
    this.consumedBehaviorIds = new Set(this.consumedBehaviorIds);
    this.coverageProducerIds = new Set(this.coverageProducerIds);
    this.coverageConsumedIds = new Set(this.coverageConsumedIds);
    this.documentDialects = new Map(this.documentDialects);
    this.resourceLocations = new Map(this.resourceLocations);
    this.ownedResources = new Map(this.ownedResources);
    this.aliases = new Map(this.aliases);
    this.documentRanges = new Map(this.documentRanges);
    // The inner maps stay shared: an insert there is the same node under
    // the same unchanged document. Eviction replaces an outer entry.
    this.interned = new Map(this.interned);
    this.shared = false;
  }

  // The one SchemaRef for a location. Interned only when the node is the
  // one the registered document holds there (`current`): navigation from a
  // ref that predates a re-registration, or a schema object whose $id
  // another registered document owns, gets a fresh uncached ref, exactly
  // the object a lookup returned before interning. A position indexed past
  // the document (`undefined`) is never interned either: the throw comes
  // later, in application, and caching instance-derived misses would only
  // grow the map.
  private intern(
    node: JsonValue | undefined,
    baseUri: string,
    pointer: string,
    current = true,
  ): SchemaRef {
    if (
      node === undefined ||
      !current ||
      (pointer === "" && this.documents.get(baseUri) !== node)
    ) {
      return { node: node as JsonValue, baseUri, pointer };
    }
    let byPointer = this.interned.get(baseUri);
    if (byPointer === undefined) {
      byPointer = new Map();
      this.interned.set(baseUri, byPointer);
    }
    const existing = byPointer.get(pointer);
    if (existing?.node === node) return existing;
    const ref: SchemaRef = {
      node,
      baseUri,
      pointer,
      key: `${baseUri}#${pointer}`,
      children: null,
      childrenBy: null,
      table: null,
    };
    if (existing === undefined) byPointer.set(pointer, ref);
    return ref;
  }

  /**
   * The dialect URI a document is governed by, fragment-free: its `$schema`
   * resolved against the retrieval URI, else `dialectUri`, else the
   * registry default. Registers nothing and consults no dialect.
   * @throws UnresolvableRefError if `$schema` cannot be resolved.
   */
  dialectUriOf(
    schema: JsonValue,
    retrievalUri: string,
    dialectUri?: string,
  ): string {
    // Dialect URIs are compared fragment-free: "…/draft-07/schema#" (the
    // canonical in-the-wild $schema spelling) names the same dialect.
    if (isObject(schema) && typeof schema.$schema === "string") {
      return splitFragment(resolveUri(schema.$schema, retrievalUri)).resource;
    }
    return splitFragment(dialectUri ?? this.defaultDialectUri).resource;
  }

  /**
   * What a document would register as, without registering it: the same
   * base URI and dialect {@link register} would use, so a caller that must
   * act first — metaschema validation, which refuses to register a document
   * that fails — names the same resource the registration would.
   * @throws UnknownDialectError if the dialect is not registered.
   * @throws InvalidIdentifierError if the root identifier names no resource.
   */
  identify(
    schema: JsonValue,
    retrievalUri: string,
    dialectUri?: string,
  ): RootIdentity {
    const effectiveDialect = this.dialectUriOf(
      schema,
      retrievalUri,
      dialectUri,
    );
    const dialect = this.dialectRegistry.getDialect(effectiveDialect);
    const retrievalResource = splitFragment(retrievalUri).resource;
    let baseUri = retrievalResource;
    const baseId = isObject(schema)
      ? dialect.identifiers(schema).baseId
      : undefined;
    if (baseId !== undefined) {
      checkBaseId(baseId, `${retrievalResource}#`);
      baseUri = splitFragment(resolveUri(baseId, retrievalResource)).resource;
    }
    return { baseUri, retrievalResource, dialectUri: effectiveDialect };
  }

  /**
   * Register a schema document and return its canonical base URI. The
   * dialect comes from `$schema` when present (and must already be
   * registered), else `dialectUri`, else the default.
   *
   * All or nothing: a throw from anywhere in the walk leaves the registry
   * exactly as it was, including the pending-reference queue and the
   * produced/consumed unions.
   *
   * One resource, one schema. Two different schema objects claiming one
   * resource URI — twice in one document, or against a resource a
   * registered document already holds — throw
   * {@link DuplicateResourceError}; two objects in one resource claiming
   * one anchor name throw {@link DuplicateAnchorError}. A retrieval URI
   * that already names or aliases another resource is refused the same way.
   * Registering a document equal to the one already registered under the
   * same root is allowed (it is walked again, so its references are queued
   * again) and rewrites that document's entries; an equal copy of a
   * resource another document embeds is allowed and takes ownership of it.
   * Replacing a document with a different one is {@link unregister}
   * followed by `register`.
   *
   * `$schema` governs the schema resource it roots (backlog D11): an
   * embedded `$id` resource declaring one is walked, indexed, and later
   * evaluated under that dialect, which must already be registered — the
   * `UnknownDialectError` otherwise carries its URI, so a caller holding
   * loaders can assemble it and register again. A resource without
   * `$schema` inherits the dialect of the resource containing it; a
   * `$schema` where no resource starts is ignored.
   *
   * `check`, when given, runs for every staged resource between the walk
   * and the commit ({@link ResourceCheck}); a throw from it registers
   * nothing.
   * @throws UnknownDialectError, InvalidIdentifierError,
   * DuplicateResourceError, DuplicateAnchorError, InvalidSchemaError,
   * MaxDepthExceededError, or whatever a keyword's `analyze()`, the regex
   * screen, or `check` throws.
   */
  register(
    schema: JsonValue,
    retrievalUri: string,
    dialectUri?: string,
    getRange?: (pointer: string) => SourceRange | undefined,
    check?: ResourceCheck,
  ): string {
    if (this.readOnly) {
      throw new ReadOnlyRegistryError("a registry snapshot is read-only");
    }
    const id = this.identify(schema, retrievalUri, dialectUri);
    const dialect = this.dialectRegistry.getDialect(id.dialectUri);
    const stage: Staging = {
      documentUri: id.baseUri,
      retrievalResource: id.retrievalResource,
      rebinding:
        this.resourceLocations.get(id.baseUri)?.documentUri === id.baseUri,
      resources: new Map(),
      produced: new Set(),
      consumed: new Set(),
      coverageProducers: new Set(),
      pending: new Set(),
    };
    if (id.retrievalResource !== id.baseUri) {
      // The retrieval URI becomes an alias of the declared base, so it must
      // not already be a resource in its own right, nor the alias of a
      // different one: either would leave one of them unreachable.
      if (this.documents.has(id.retrievalResource)) {
        throw new DuplicateResourceError(
          `retrieval URI '${id.retrievalResource}' already names a registered ` +
            `resource; the document declares '${id.baseUri}'`,
        );
      }
      const bound = this.aliases.get(id.retrievalResource);
      if (bound !== undefined && bound !== id.baseUri) {
        throw new DuplicateResourceError(
          `retrieval URI '${id.retrievalResource}' is already bound to ` +
            `resource '${bound}'; the document declares '${id.baseUri}'`,
        );
      }
    }
    const root = this.stageResource(
      stage,
      id.baseUri,
      schema,
      id.dialectUri,
      { documentUri: id.baseUri, pointer: "" },
      `${id.baseUri}#`,
    );
    try {
      this.walk(
        schema,
        id.baseUri,
        "",
        id.baseUri,
        "",
        dialect,
        0,
        stage,
        root,
      );
    } catch (err) {
      // Registration recursion has the same backstop as evaluation: a
      // maxDepth set above the runtime's ceiling must surface as the typed
      // error, not a bare RangeError. Nothing has been written either way.
      if (isStackOverflow(err)) {
        throw new MaxDepthExceededError(
          `schema nesting exceeded the native call stack ` +
            `(maxDepth=${this.maxDepth}); reduce nesting or lower maxDepth`,
        );
      }
      throw err;
    }
    if (check !== undefined) {
      for (const [uri, res] of stage.resources) {
        check({
          uri,
          dialectUri: res.dialectUri,
          node: masked(stage, uri, res),
        });
      }
    }
    this.commit(stage, getRange);
    return id.baseUri;
  }

  /**
   * Remove a registered document: its root and every resource its
   * registration claimed, with their anchors, dynamic anchors, recursive
   * roots, dialect and location entries, source-range lookup, and every
   * retrieval alias for it. A resource an equal copy in another document
   * has since taken over stays with that document. A snapshot taken earlier
   * keeps the removed document. Unregister then `register` is how a
   * document is replaced.
   * @throws UnresolvableRefError if `uri` is not a registered document
   * root — including when it names a resource embedded in another document.
   */
  unregister(uri: string): void {
    if (this.readOnly) {
      throw new ReadOnlyRegistryError("a registry snapshot is read-only");
    }
    const doc = this.canonical(splitFragment(uri).resource);
    const location = this.resourceLocations.get(doc);
    if (location === undefined) {
      throw new UnresolvableRefError(`unknown schema '${doc}'`);
    }
    if (location.documentUri !== doc) {
      throw new UnresolvableRefError(
        `'${doc}' is a resource embedded in document ` +
          `'${location.documentUri}'; unregister that document`,
      );
    }
    this.mutable();
    this.evict(doc);
    this.resetMemos();
  }

  // The dialect governing a resource rooted at `node` (backlog D11): its own
  // $schema, resolved against the resource's base, when it declares one;
  // otherwise the dialect in force around it. Naming the dialect already in
  // force is a no-op — no lookup, no rebind.
  private resourceDialect(
    node: JsonValue,
    baseUri: string,
    inherited: Dialect,
    where: string,
  ): Dialect {
    const declared = isObject(node) ? node.$schema : undefined;
    if (typeof declared !== "string") return inherited;
    const uri = splitFragment(resolveUri(declared, baseUri)).resource;
    if (uri === inherited.uri) return inherited;
    if (!this.dialectRegistry.hasDialect(uri)) {
      // Carrying the URI: the registry holds no loaders, but the engine
      // can assemble this dialect from its metaschema and register again.
      throw new UnknownDialectError(
        `embedded resource '${baseUri}' (at '${where}') declares unknown ` +
          `dialect '${uri}'`,
        uri,
      );
    }
    return this.dialectRegistry.getDialect(uri);
  }

  // Claim a resource for the registration in progress, or refuse it.
  private stageResource(
    stage: Staging,
    uri: string,
    node: JsonValue,
    dialectUri: string,
    location: DocumentLocation,
    where: string,
    parent?: string,
    pointerInParent = "",
  ): StagedResource {
    if (stage.resources.has(uri)) {
      throw new DuplicateResourceError(
        `resource '${uri}' is claimed twice in one document (at '${where}')`,
      );
    }
    if (this.aliases.has(uri)) {
      // The lookup path prefers the alias, so a resource under this name
      // could never be reached.
      throw new DuplicateResourceError(
        `'${uri}' (at '${where}') is the retrieval URI of resource ` +
          `'${this.aliases.get(uri)!}'`,
      );
    }
    const existing = this.documents.get(uri);
    if (existing !== undefined && !jsonEqual(existing, node)) {
      throw new DuplicateResourceError(
        `resource '${uri}' (at '${where}') is already registered as a ` +
          "different schema",
      );
    }
    const staged: StagedResource = {
      node,
      dialectUri,
      location,
      parent,
      pointerInParent,
      anchors: new Map(),
      recursiveRoot: false,
    };
    stage.resources.set(uri, staged);
    return staged;
  }

  // Claim an anchor name within a resource, or refuse it. `dynamic` marks a
  // `$dynamicAnchor`, which is a plain anchor too (D8).
  private static stageAnchor(
    res: StagedResource,
    resourceUri: string,
    name: string,
    node: JsonValue,
    pointer: string,
    dynamic: boolean,
  ): void {
    const prior = res.anchors.get(name);
    if (prior !== undefined && prior.node !== node) {
      throw new DuplicateAnchorError(
        `anchor '${name}' is claimed by two schemas in resource ` +
          `'${resourceUri}' (at '${prior.pointer}' and '${pointer}')`,
      );
    }
    res.anchors.set(name, {
      node,
      pointer,
      dynamic: dynamic || (prior?.dynamic ?? false),
    });
  }

  private walk(
    node: JsonValue,
    baseUri: string,
    pointer: string,
    documentUri: string,
    docPointer: string, // pointer from the registered document's root
    dialect: Dialect,
    depth: number,
    stage: Staging,
    res: StagedResource,
  ): void {
    if (depth > this.maxDepth) {
      throw new MaxDepthExceededError(
        `schema nesting exceeds maxDepth (${this.maxDepth}) at ` +
          `'${baseUri}#${pointer}'`,
      );
    }
    if (typeof node === "boolean") return;
    if (!isObject(node)) {
      throw new InvalidSchemaError(
        `non-schema value (${describeNonSchema(node)}) in schema position ` +
          `'${baseUri}#${pointer}'`,
      );
    }

    let ids = dialect.identifiers(node);
    const baseId = ids.baseId;
    if (pointer !== "" && baseId !== undefined) {
      const where = `${baseUri}#${pointer}`;
      checkBaseId(baseId, where);
      const location = { documentUri, pointer: docPointer };
      const parent = baseUri;
      const pointerInParent = pointer;
      baseUri = splitFragment(resolveUri(baseId, baseUri)).resource;
      pointer = "";
      // The boundary is decided from the outside, the contents from the
      // inside (2020-12 core §8.1.1): the enclosing dialect's syntax said a
      // resource starts here, and the resource's own $schema governs what
      // is minted into it, its keyword table, refIgnoresSiblings, and the
      // recursion below. The identifiers are read again with the inner
      // extractor; its own baseId is never used.
      dialect = this.resourceDialect(node, baseUri, dialect, where);
      ids = { ...dialect.identifiers(node), baseId };
      res = this.stageResource(
        stage,
        baseUri,
        node,
        dialect.uri,
        location,
        where,
        parent,
        pointerInParent,
      );
    }
    // A $schema where no resource starts is ignored, not refused: the spec
    // forbids the placement, but refusing it is strict-mode hygiene (D14),
    // and {"$schema": X, "not": {"$schema": X}} is how Bowtie spells
    // "allows nothing" for every dialect it tests.
    for (const anchor of ids.anchors ?? []) {
      SchemaRegistry.stageAnchor(res, baseUri, anchor, node, pointer, false);
    }
    if (ids.dynamicAnchor !== undefined) {
      SchemaRegistry.stageAnchor(
        res,
        baseUri,
        ids.dynamicAnchor,
        node,
        pointer,
        true,
      );
    }
    // $recursiveAnchor participates in rebinding only at a resource root.
    if (ids.recursiveAnchor === true && pointer === "") {
      res.recursiveRoot = true;
    }

    // draft-07/06 (D18): a $ref makes every sibling act as if absent — at
    // registration as at evaluation, so no identifier, subschema, reference,
    // or pattern inside a sibling is seen. Pointer references into a sibling
    // still resolve, since navigation reads the document.
    const refOnly = dialect.refIgnoresSiblings && Object.hasOwn(node, "$ref");
    for (const [name, value] of Object.entries(node)) {
      if (refOnly && name !== "$ref") continue;
      const behavior = dialect.keywords.get(name)?.behavior;
      const facts = behavior?.analyze?.(value, { schema: node });
      if (!facts) continue;
      for (const p of facts.produces ?? []) stage.produced.add(p);
      for (const c of facts.consumes ?? []) stage.consumed.add(c);
      if (
        facts.evaluatesNames !== undefined ||
        facts.evaluatesIndexes !== undefined
      ) {
        stage.coverageProducers.add(behavior!.id);
      }
      if (this.onRegex) {
        const keywordLocation = `${baseUri}#${pointer}/${escapeSegment(name)}`;
        for (const rx of facts.regexes ?? []) this.onRegex(rx, keywordLocation);
      }
      for (const ref of facts.references ?? []) {
        try {
          stage.pending.add(splitFragment(resolveUri(ref, baseUri)).resource);
        } catch {
          // Unresolvable now is not an error: evaluation reports it if the
          // reference is actually followed.
        }
      }
      const positions = facts.subschemas;
      if (!positions) continue;
      for (const relPath of positions) {
        let child: JsonValue = value;
        let suffix = "/" + escapeSegment(name);
        for (const seg of relPath) {
          child = (
            Array.isArray(child)
              ? child[seg as number]
              : (child as Record<string, JsonValue>)[seg as string]
          ) as JsonValue;
          suffix += "/" + escapeSegment(String(seg));
        }
        this.walk(
          child,
          baseUri,
          pointer + suffix,
          documentUri,
          docPointer + suffix,
          dialect,
          depth + 1,
          stage,
          res,
        );
      }
    }
  }

  // Apply a successful walk. Throw-free and non-recursive, so the indexes
  // can never be left half-written.
  private commit(
    stage: Staging,
    getRange?: (pointer: string) => SourceRange | undefined,
  ): void {
    this.mutable();
    if (stage.rebinding) this.evict(stage.documentUri);
    // A document root this registration absorbs as an embedded resource (an
    // equal copy) stops being a document of its own.
    const absorbed = new Set<string>();
    for (const [uri, res] of stage.resources) {
      const owner = this.resourceLocations.get(uri)?.documentUri;
      if (owner !== undefined && owner === uri && uri !== stage.documentUri) {
        absorbed.add(uri);
      }
      this.documents.set(uri, res.node);
      this.documentDialects.set(uri, res.dialectUri);
      this.resourceLocations.set(uri, res.location);
      this.interned.delete(uri);
      if (res.recursiveRoot) this.recursiveRoots.add(uri);
      else this.recursiveRoots.delete(uri);
    }
    for (const doc of absorbed) {
      this.ownedResources.delete(doc);
      this.documentRanges.delete(doc);
    }
    this.ownedResources.set(stage.documentUri, [...stage.resources.keys()]);
    if (stage.retrievalResource !== stage.documentUri) {
      this.aliases.set(stage.retrievalResource, stage.documentUri);
    }
    if (getRange) this.documentRanges.set(stage.documentUri, getRange);
    // Anchors after documents: `intern` returns the interned ref only for a
    // node the registered document holds, and the resource's old refs were
    // dropped above, so every anchor is the one object lookups will return.
    for (const [uri, res] of stage.resources) {
      this.anchors.delete(uri);
      this.dynamicAnchors.delete(uri);
      if (res.anchors.size === 0) continue;
      const plain = new Map<string, SchemaRef>();
      const dynamic = new Map<string, SchemaRef>();
      for (const [name, anchor] of res.anchors) {
        const ref = this.intern(anchor.node, uri, anchor.pointer);
        plain.set(name, ref);
        if (anchor.dynamic) dynamic.set(name, ref);
      }
      this.anchors.set(uri, plain);
      if (dynamic.size > 0) this.dynamicAnchors.set(uri, dynamic);
    }
    for (const p of stage.produced) this.producedBehaviorIds.add(p);
    for (const c of stage.consumed) this.consumedBehaviorIds.add(c);
    for (const p of stage.coverageProducers) this.coverageProducerIds.add(p);
    for (const c of stage.consumed) {
      if (this.coverageProducerIds.has(c)) this.coverageConsumedIds.add(c);
    }
    for (const p of stage.coverageProducers) {
      if (this.consumedBehaviorIds.has(p)) this.coverageConsumedIds.add(p);
    }
    for (const r of stage.pending) this.pendingResources.add(r);
    this.resetMemos();
  }

  // Drop everything a document's last registration claimed and still owns.
  // Runs on the post-`mutable()` maps only.
  private evict(doc: string): void {
    for (const r of this.ownedResources.get(doc) ?? []) {
      if (this.resourceLocations.get(r)?.documentUri !== doc) continue;
      this.documents.delete(r);
      this.documentDialects.delete(r);
      this.resourceLocations.delete(r);
      this.anchors.delete(r);
      this.dynamicAnchors.delete(r);
      this.recursiveRoots.delete(r);
      this.interned.delete(r);
    }
    this.ownedResources.delete(doc);
    this.documentRanges.delete(doc);
    for (const [alias, target] of this.aliases) {
      if (target === doc) this.aliases.delete(alias);
    }
  }

  /**
   * The registered document containing a schema resource, and the resource
   * root's pointer from that document's root (D17 bridge; see loader.ts).
   * Undefined for resources the registration walk never saw (e.g. an `$id`
   * inside an unknown keyword reached only by pointer navigation).
   */
  documentLocation(resourceUri: string): DocumentLocation | undefined {
    return this.resourceLocations.get(this.canonical(resourceUri));
  }

  /** Source range for a document-rooted pointer, when the loader supplied one (D17). */
  range(documentUri: string, pointer: string): SourceRange | undefined {
    return this.documentRanges.get(documentUri)?.(pointer);
  }

  /** True if a resource is registered, directly or via a retrieval-URI alias. */
  has(resourceUri: string): boolean {
    return this.documents.has(resourceUri) || this.aliases.has(resourceUri);
  }

  /** The schema node at a resource's root, if registered. */
  document(resourceUri: string): JsonValue | undefined {
    return this.documents.get(this.canonical(resourceUri));
  }

  /** External resources referenced but not yet registered; drained per call. */
  takeUnresolved(): string[] {
    const missing = [...this.pendingResources].filter((r) => !this.has(r));
    this.pendingResources.clear();
    return missing;
  }

  /**
   * One external resource referenced but not yet registered, removed from
   * the pending set; `undefined` when none remains. Taking one at a time is
   * what lets a load loop that throws leave the rest for a later drain.
   */
  nextUnresolved(): string | undefined {
    for (const r of this.pendingResources) {
      this.pendingResources.delete(r);
      if (!this.has(r)) return r;
    }
    return undefined;
  }

  /** The `$dynamicAnchor` target for a name in a resource, if one was registered (D8). */
  dynamicAnchor(resourceUri: string, name: string): SchemaRef | undefined {
    return this.dynamicAnchors.get(this.canonical(resourceUri))?.get(name);
  }

  /**
   * The scope-independent part of `$dynamicRef` resolution (D8), shared by
   * the interpreter and the compiler's plan-time analysis so the two tiers
   * cannot drift: the lexical target (which must exist, as for `$ref`), and
   * the anchor name the dynamic scope is walked for — `null` when the
   * reference behaves exactly like `$ref`, because its fragment is absent,
   * empty, or a JSON Pointer, or because the lexical target's resource
   * declares no `$dynamicAnchor` of that name (the bookending requirement).
   * @throws UnresolvableRefError if the lexical target does not exist.
   */
  dynamicReference(ref: string, currentBase: string): DynamicReference {
    this.syncDialects();
    let byRef = this.dynMemo.get(currentBase);
    if (byRef === undefined) {
      byRef = new Map();
      this.dynMemo.set(currentBase, byRef);
    }
    const memo = byRef.get(ref);
    if (memo !== undefined) return memo;

    const resolved = resolveSplit(ref, currentBase);
    const lexical = this.resolveMemo(ref, currentBase, resolved);
    const { resource, fragment } = resolved;
    const anchor =
      fragment === null ||
      fragment === "" ||
      fragment.startsWith("/") ||
      this.dynamicAnchor(resource, fragment) === undefined
        ? null
        : fragment;
    const result: DynamicReference = { lexical, anchor };
    byRef.set(ref, result);
    return result;
  }

  /**
   * The scope-independent steps of `$recursiveRef` resolution, shared by
   * the interpreter and the compiler's plan-time analysis: the lexical
   * target, and whether the dynamic scope is consulted at all. A non-empty
   * fragment (pointer or plain name) behaves like `$ref`; so does an empty
   * one whose target resource has no root-level `$recursiveAnchor: true`.
   * Otherwise the scope's outermost resource with such a root wins, which
   * is the caller's walk.
   * @throws UnresolvableRefError if the lexical target does not exist.
   */
  recursiveReference(ref: string, currentBase: string): RecursiveReference {
    this.syncDialects();
    let byRef = this.recMemo.get(currentBase);
    if (byRef === undefined) {
      byRef = new Map();
      this.recMemo.set(currentBase, byRef);
    }
    const memo = byRef.get(ref);
    if (memo !== undefined) return memo;

    const resolved = resolveSplit(ref, currentBase);
    const lexical = this.resolveMemo(ref, currentBase, resolved);
    const { resource, fragment } = resolved;
    const rebinds =
      (fragment === null || fragment === "") && this.hasRecursiveRoot(resource);
    const result: RecursiveReference = { lexical, rebinds };
    byRef.set(ref, result);
    return result;
  }

  /** True if a resource's root carries 2019-09 `$recursiveAnchor: true`. */
  hasRecursiveRoot(resourceUri: string): boolean {
    return this.recursiveRoots.has(this.canonical(resourceUri));
  }

  /** Behavior ids some registered keyword declares it produces dependency data under. */
  producedIds(): ReadonlySet<string> {
    return this.producedBehaviorIds;
  }

  /** Behavior ids some registered keyword declares it consumes. */
  consumedIds(): ReadonlySet<string> {
    return this.consumedBehaviorIds;
  }

  /** The consumed subset of {@link consumedIds} whose producer declares evaluated coverage: what the coverage channel carries. */
  coverageIds(): ReadonlySet<string> {
    return this.coverageConsumedIds;
  }

  private canonical(resourceUri: string): string {
    return this.aliases.get(resourceUri) ?? resourceUri;
  }

  /**
   * The dialect URI a resource was registered under.
   * @throws UnresolvableRefError if the resource is not registered.
   */
  dialectUriFor(baseUri: string): string {
    const uri = this.documentDialects.get(this.canonical(baseUri));
    if (uri === undefined)
      throw new UnresolvableRefError(`unknown schema '${baseUri}'`);
    return uri;
  }

  /**
   * The dialect a resource was registered under.
   * @throws UnresolvableRefError if the resource is not registered.
   */
  dialectFor(baseUri: string): Dialect {
    this.syncDialects();
    let dialect = this.dialectCache.get(baseUri);
    if (dialect === undefined) {
      dialect = this.dialectRegistry.getDialect(this.dialectUriFor(baseUri));
      this.dialectCache.set(baseUri, dialect);
    }
    return dialect;
  }

  // The dialect of a base that navigation has just entered, or the one in
  // force when the walk never indexed that base (an $id inside an unknown
  // keyword; a draft-07 $ref with an $id sibling): nothing throws where
  // nothing threw before. A plain map read rather than dialectFor — no
  // throw, and no cache entry for an unindexed base. Aliases cannot apply:
  // a base minted from $id is already canonical.
  private dialectAfter(baseUri: string, current: Dialect): Dialect {
    const uri = this.documentDialects.get(baseUri);
    return uri === undefined ? current : this.dialectRegistry.getDialect(uri);
  }

  /**
   * Resolves a URI to its resource's root schema.
   * @throws UnresolvableRefError if the resource is not registered.
   */
  rootRef(uri: string): SchemaRef {
    const { resource: rawResource, fragment } = splitFragment(uri);
    const resource = this.canonical(rawResource);
    if (fragment !== null && fragment !== "") {
      return this.resolveRef(uri, resource);
    }
    const node = this.documents.get(resource);
    if (node === undefined)
      throw new UnresolvableRefError(`unknown schema '${resource}'`);
    return this.intern(node, resource, "");
  }

  /**
   * Resolves a reference value against the referring schema's base URI.
   * @throws UnresolvableRefError if the resource, anchor, or pointer target
   * does not exist.
   */
  resolveRef(ref: string, currentBase: string): SchemaRef {
    this.syncDialects();
    return this.resolveMemo(ref, currentBase, null);
  }

  // The memo around locate(): `resolved` is the already-parsed reference
  // when the caller has it, else it is parsed on a miss.
  private resolveMemo(
    ref: string,
    currentBase: string,
    resolved: SplitUri | null,
  ): SchemaRef {
    let byRef = this.refMemo.get(currentBase);
    if (byRef === undefined) {
      byRef = new Map();
      this.refMemo.set(currentBase, byRef);
    }
    const memo = byRef.get(ref);
    if (memo !== undefined) {
      if (memo instanceof RefMiss) throw new UnresolvableRefError(memo.message);
      return memo;
    }
    try {
      const found = this.locate(resolved ?? resolveSplit(ref, currentBase));
      byRef.set(ref, found);
      return found;
    } catch (err) {
      if (
        err instanceof UnresolvableRefError &&
        this.misses < MAX_MEMOIZED_MISSES
      ) {
        this.misses++;
        byRef.set(ref, new RefMiss(err.message));
      }
      throw err;
    }
  }

  // Resolution proper: anchor lookup, or JSON Pointer navigation from the
  // resource root.
  private locate(resolved: SplitUri): SchemaRef {
    const resource = this.canonical(resolved.resource);
    const fragment = resolved.fragment;

    if (fragment !== null && fragment !== "" && !fragment.startsWith("/")) {
      const hit = this.anchors.get(resource)?.get(fragment);
      if (!hit)
        throw new UnresolvableRefError(
          `unknown anchor '${resource}#${fragment}'`,
        );
      return hit;
    }

    const root = this.documents.get(resource);
    if (root === undefined)
      throw new UnresolvableRefError(`unknown schema '${resource}'`);
    if (fragment === null || fragment === "") {
      return this.intern(root, resource, "");
    }

    // JSON Pointer navigation, tracking identifier-induced base changes on
    // the way, each under the dialect of the resource being navigated (D18):
    // the enclosing dialect's syntax decides whether an $id starts a
    // resource, exactly as in the walk, and the resource it starts governs
    // every step after it.
    let dialect = this.dialectFor(resource);
    let identifiers = dialect.identifiers;
    let node: JsonValue | undefined = root;
    let baseUri = resource;
    let pointer = "";
    let current = true;
    for (const rawSeg of fragment.slice(1).split("/")) {
      const seg = unescapeSegment(rawSeg);
      if (Array.isArray(node)) {
        node = node[Number(seg)];
      } else if (isObject(node) && Object.hasOwn(node, seg)) {
        node = node[seg];
      } else {
        node = undefined;
      }
      if (node === undefined) {
        throw new UnresolvableRefError(
          `pointer '${fragment}' not found in '${resource}'`,
        );
      }
      pointer += "/" + escapeSegment(seg);
      if (isObject(node)) {
        const baseId = identifiers(node).baseId;
        if (baseId !== undefined) {
          baseUri = splitFragment(resolveUri(baseId, baseUri)).resource;
          pointer = "";
          current &&= this.documents.get(baseUri) === node;
          dialect = this.dialectAfter(baseUri, dialect);
          identifiers = dialect.identifiers;
        }
      }
    }
    return this.intern(node, baseUri, pointer, current);
  }

  /**
   * Descend from a schema position into keyword/index children, maintaining
   * canonical location and lexical base.
   */
  child(ref: SchemaRef, segments: readonly (string | number)[]): SchemaRef {
    // Each hop is read with the extractor of the parent position's resource
    // — the one that decides whether a child starts a resource — and
    // memoized on the parent under that extractor, so a dialect
    // re-registration with another identifier syntax rebuilds the hops.
    // Crossing into another resource switches to its dialect for the next
    // hop, as the walk does.
    let dialect = this.dialectFor(ref.baseUri);
    let identifiers = dialect.identifiers;
    let at = ref;
    let i = 0;
    for (; i < segments.length; i++) {
      if (at.childrenBy !== identifiers) break;
      const hit = at.children?.get(String(segments[i]));
      if (hit === undefined) break;
      if (hit.baseUri !== at.baseUri) {
        dialect = this.dialectAfter(hit.baseUri, dialect);
        identifiers = dialect.identifiers;
      }
      at = hit;
    }
    if (i === segments.length) return at;

    // Slow path from the last memoized position. Children of the interned
    // ref for a location are that location's current nodes, and only those
    // are interned and memoized; children of any other ref (stale, or
    // consumer-built) are neither.
    let node: JsonValue | undefined = at.node;
    let { baseUri, pointer } = at;
    let current = this.interned.get(baseUri)?.get(pointer) === at;
    for (; i < segments.length; i++) {
      const seg = segments[i]!;
      // Own properties only: a missing name must not surface a prototype
      // member (`__proto__`, `length`, ...) as a schema.
      node =
        node !== undefined &&
        (Array.isArray(node) || isObject(node)) &&
        Object.hasOwn(node, seg)
          ? (node as Record<string, JsonValue>)[seg as string]
          : undefined;
      pointer += "/" + escapeSegment(String(seg));
      let rebased = false;
      if (isObject(node)) {
        const baseId = identifiers(node).baseId;
        if (baseId !== undefined) {
          baseUri = splitFragment(resolveUri(baseId, baseUri)).resource;
          pointer = "";
          current &&= this.documents.get(baseUri) === node;
          rebased = true;
        }
      }
      const next = this.intern(node, baseUri, pointer, current);
      if (current && node !== undefined) {
        if (at.childrenBy !== identifiers) {
          at.children = new Map();
          at.childrenBy = identifiers;
        }
        at.children!.set(String(seg), next);
      }
      at = next;
      if (rebased) {
        dialect = this.dialectAfter(baseUri, dialect);
        identifiers = dialect.identifiers;
      }
    }
    return at;
  }
}
