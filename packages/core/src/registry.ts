// Schema registration and static reference resolution.
//
// The registration walk descends only into *schema positions*, so `$id` or
// `$anchor` inside `enum` data or an unknown keyword's value is never treated
// as an identifier. Unlike the F2 prototype, the positions are not hard-coded:
// the walk asks each keyword behavior's analyze() for its subschema positions
// (DESIGN.md D1/D2), so a custom applicator registered through the dialect
// registry gets correct identifier handling for free.

import { JsonValue, isObject, escapeSegment, unescapeSegment } from "./json.js";
import {
  resolveSplit,
  resolveUri,
  splitFragment,
  UnresolvableRefError,
} from "./uri.js";
import { SchemaRef } from "./ref.js";
import { Dialect, DialectRegistry, ReadOnlyRegistryError } from "./dialect.js";
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
 * Where a schema resource physically lives: the registered document
 * containing it and the JSON Pointer from that document's root to the
 * resource's root (D17 bridge; see loader.ts).
 */
export interface DocumentLocation {
  documentUri: string;
  pointer: string;
}

/**
 * A value that is not a schema (neither an object nor a boolean) was found
 * where a schema is required (D19): in a keyword-claimed schema position at
 * registration, or applied as a schema during evaluation. Keyword-value
 * validity beyond schema shape is not checked here — that is metaschema
 * validation's job ({@link EngineOptions.validateSchemas}).
 *
 * When thrown during registration, the document may be partially indexed;
 * re-register a corrected document under the same URI, or discard the
 * engine.
 */
export class InvalidSchemaError extends Error {}

/**
 * Schema nesting (at registration) or schema-application nesting (at
 * evaluation) exceeded {@link EngineOptions.maxDepth}. A bounded, catchable
 * failure that replaces the native stack overflow deep input would otherwise
 * cause; the engine remains usable afterward (each evaluation runs in fresh
 * state). Raise `maxDepth` for legitimately deep documents, within what the
 * runtime's own stack allows.
 */
export class MaxDepthExceededError extends Error {}

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

/** Schema registration, identifier indexing, and reference resolution. */
export class SchemaRegistry {
  private documents = new Map<string, JsonValue>(); // resource URI -> schema node
  private anchors = new Map<string, SchemaRef>(); // "resource#anchor"
  private dynamicAnchors = new Map<string, SchemaRef>(); // $dynamicAnchor only (D8)
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
  // Snapshots share the indexes above copy-on-write: the source copies them
  // before its first registration after a snapshot, so a view stays frozen
  // at no cost until the source changes.
  private shared = false;
  private readOnly = false;

  constructor(
    private dialectRegistry: DialectRegistry,
    private defaultDialectUri: string,
    private maxDepth: number = DEFAULT_MAX_DEPTH,
  ) {}

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
    view.aliases = this.aliases;
    view.documentRanges = this.documentRanges;
    view.readOnly = true;
    this.shared = true;
    return view;
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
    this.aliases = new Map(this.aliases);
    this.documentRanges = new Map(this.documentRanges);
    this.shared = false;
  }

  /**
   * Register a schema document. The dialect comes from `$schema` when present
   * (and must already be registered), else `dialectUri`, else the default.
   * Returns the document's canonical base URI.
   */
  register(
    schema: JsonValue,
    retrievalUri: string,
    dialectUri?: string,
    getRange?: (pointer: string) => SourceRange | undefined,
  ): string {
    this.mutable();
    // Dialect URIs are compared fragment-free: "…/draft-07/schema#" (the
    // canonical in-the-wild $schema spelling) names the same dialect.
    let effectiveDialect = splitFragment(
      dialectUri ?? this.defaultDialectUri,
    ).resource;
    if (isObject(schema) && typeof schema.$schema === "string") {
      effectiveDialect = splitFragment(
        resolveUri(schema.$schema, retrievalUri),
      ).resource;
    }
    const dialect = this.dialectRegistry.getDialect(effectiveDialect);

    const retrievalResource = splitFragment(retrievalUri).resource;
    let baseUri = retrievalResource;
    const rootIds = isObject(schema) ? dialect.identifiers(schema) : {};
    if (rootIds.baseId !== undefined) {
      baseUri = splitFragment(resolveUri(rootIds.baseId, baseUri)).resource;
    }
    if (baseUri !== retrievalResource)
      this.aliases.set(retrievalResource, baseUri);
    this.documents.set(baseUri, schema);
    this.documentDialects.set(baseUri, effectiveDialect);
    this.resourceLocations.set(baseUri, { documentUri: baseUri, pointer: "" });
    if (getRange) this.documentRanges.set(baseUri, getRange);
    this.walk(schema, baseUri, "", baseUri, "", dialect, 0);
    return baseUri;
  }

  private walk(
    node: JsonValue,
    baseUri: string,
    pointer: string,
    documentUri: string,
    docPointer: string, // pointer from the registered document's root
    dialect: Dialect,
    depth: number,
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

    const ids = dialect.identifiers(node);
    if (pointer !== "" && ids.baseId !== undefined) {
      baseUri = splitFragment(resolveUri(ids.baseId, baseUri)).resource;
      pointer = "";
      this.documents.set(baseUri, node);
      this.documentDialects.set(baseUri, dialect.uri);
      this.resourceLocations.set(baseUri, { documentUri, pointer: docPointer });
    }
    for (const anchor of ids.anchors ?? []) {
      this.anchors.set(`${baseUri}#${anchor}`, { node, baseUri, pointer });
    }
    // A dynamic anchor is also a plain anchor for $ref purposes; only the
    // dynamic-anchor index participates in $dynamicRef rebinding (D8).
    if (ids.dynamicAnchor !== undefined) {
      const ref = { node, baseUri, pointer };
      this.anchors.set(`${baseUri}#${ids.dynamicAnchor}`, ref);
      this.dynamicAnchors.set(`${baseUri}#${ids.dynamicAnchor}`, ref);
    }
    // $recursiveAnchor participates in rebinding only at a resource root.
    if (ids.recursiveAnchor === true && pointer === "") {
      this.recursiveRoots.add(baseUri);
    }

    for (const [name, value] of Object.entries(node)) {
      const behavior = dialect.keywords.get(name)?.behavior;
      const facts = behavior?.analyze?.(value, { schema: node });
      if (!facts) continue;
      for (const p of facts.produces ?? []) this.producedBehaviorIds.add(p);
      for (const c of facts.consumes ?? []) {
        this.consumedBehaviorIds.add(c);
        if (this.coverageProducerIds.has(c)) this.coverageConsumedIds.add(c);
      }
      if (
        facts.evaluatesNames !== undefined ||
        facts.evaluatesIndexes !== undefined
      ) {
        this.coverageProducerIds.add(behavior!.id);
        if (this.consumedBehaviorIds.has(behavior!.id)) {
          this.coverageConsumedIds.add(behavior!.id);
        }
      }
      if (this.onRegex) {
        const keywordLocation = `${baseUri}#${pointer}/${escapeSegment(name)}`;
        for (const rx of facts.regexes ?? []) this.onRegex(rx, keywordLocation);
      }
      for (const ref of facts.references ?? []) {
        try {
          this.pendingResources.add(
            splitFragment(resolveUri(ref, baseUri)).resource,
          );
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
        );
      }
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

  /** The `$dynamicAnchor` target for a name in a resource, if one was registered (D8). */
  dynamicAnchor(resourceUri: string, name: string): SchemaRef | undefined {
    return this.dynamicAnchors.get(`${this.canonical(resourceUri)}#${name}`);
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
    const lexical = this.resolveRef(ref, currentBase);
    const { resource, fragment } = resolveSplit(ref, currentBase);
    if (fragment === null || fragment === "" || fragment.startsWith("/")) {
      return { lexical, anchor: null };
    }
    if (this.dynamicAnchor(resource, fragment) === undefined) {
      return { lexical, anchor: null };
    }
    return { lexical, anchor: fragment };
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
    return this.dialectRegistry.getDialect(this.dialectUriFor(baseUri));
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
    return { node, baseUri: resource, pointer: "" };
  }

  /**
   * Resolves a reference value against the referring schema's base URI.
   * @throws UnresolvableRefError if the resource, anchor, or pointer target
   * does not exist.
   */
  resolveRef(ref: string, currentBase: string): SchemaRef {
    const resolved = resolveSplit(ref, currentBase);
    const resource = this.canonical(resolved.resource);
    const fragment = resolved.fragment;

    if (fragment !== null && fragment !== "" && !fragment.startsWith("/")) {
      const hit = this.anchors.get(`${resource}#${fragment}`);
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
      return { node: root, baseUri: resource, pointer: "" };
    }

    // JSON Pointer navigation, tracking identifier-induced base changes on
    // the way, per the target document's dialect (D18).
    const identifiers = this.dialectFor(resource).identifiers;
    let node: JsonValue | undefined = root;
    let baseUri = resource;
    let pointer = "";
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
        }
      }
    }
    return { node, baseUri, pointer };
  }

  /**
   * Descend from a schema position into keyword/index children, maintaining
   * canonical location and lexical base.
   */
  child(ref: SchemaRef, segments: readonly (string | number)[]): SchemaRef {
    const identifiers = this.dialectFor(ref.baseUri).identifiers;
    let node: JsonValue = ref.node;
    let { baseUri, pointer } = ref;
    for (const seg of segments) {
      node = (
        Array.isArray(node)
          ? node[seg as number]
          : (node as Record<string, JsonValue>)[seg as string]
      ) as JsonValue;
      pointer += "/" + escapeSegment(String(seg));
      if (isObject(node)) {
        const baseId = identifiers(node).baseId;
        if (baseId !== undefined) {
          baseUri = splitFragment(resolveUri(baseId, baseUri)).resource;
          pointer = "";
        }
      }
    }
    return { node, baseUri, pointer };
  }
}
