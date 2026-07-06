// Schema registration and static reference resolution.
//
// The registration walk descends only into *schema positions*, so `$id` or
// `$anchor` inside `enum` data or an unknown keyword's value is never treated
// as an identifier. Unlike the F2 prototype, the positions are not hard-coded:
// the walk asks each keyword behavior's analyze() for its subschema positions
// (DESIGN.md D1/D2), so a custom applicator registered through the dialect
// registry gets correct identifier handling for free.

import { JsonValue, isObject, escapeSegment, unescapeSegment } from "./json.js";
import { resolveUri, splitFragment, UnresolvableRefError } from "./uri.js";
import { SchemaRef } from "./ref.js";
import { Dialect, DialectRegistry } from "./dialect.js";
import { SourceRange } from "./loader.js";

// Where a schema resource physically lives: the registered document that
// contains it and the JSON Pointer from that document's root to the
// resource's root. Canonical schema locations are resource-rooted; loaders
// report source positions document-rooted (D17) — this is the bridge.
export interface DocumentLocation {
  documentUri: string;
  pointer: string;
}

export class SchemaRegistry {
  private documents = new Map<string, JsonValue>(); // resource URI -> schema node
  private anchors = new Map<string, SchemaRef>(); // "resource#anchor"
  private dynamicAnchors = new Map<string, SchemaRef>(); // $dynamicAnchor only (D8)
  private recursiveRoots = new Set<string>(); // 2019-09 $recursiveAnchor at root
  // Union of StaticFacts.consumes over every registered keyword occurrence:
  // the elision predicate's "someone might read this" side (D5/M5.5).
  private consumedBehaviorIds = new Set<string>();
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

  constructor(
    private dialectRegistry: DialectRegistry,
    private defaultDialectUri: string,
  ) {}

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
    this.walk(schema, baseUri, "", baseUri, "", dialect);
    return baseUri;
  }

  private walk(
    node: JsonValue,
    baseUri: string,
    pointer: string,
    documentUri: string,
    docPointer: string, // pointer from the registered document's root
    dialect: Dialect,
  ): void {
    if (!isObject(node)) return;

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
      const facts = behavior?.analyze?.(value);
      if (!facts) continue;
      for (const c of facts.consumes ?? []) this.consumedBehaviorIds.add(c);
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
        );
      }
    }
  }

  /**
   * The registered document containing a schema resource, and the resource
   * root's pointer from that document's root (D17). A canonical location
   * `(resourceUri, ptr)` corresponds to document pointer
   * `documentLocation(resourceUri).pointer + ptr` for source-position lookup.
   * Undefined for resources the registration walk never saw (e.g. an $id
   * inside an unknown keyword reached only by pointer navigation).
   */
  documentLocation(resourceUri: string): DocumentLocation | undefined {
    return this.resourceLocations.get(this.canonical(resourceUri));
  }

  /** Source range for a document-rooted pointer, when the loader supplied one (D17). */
  range(documentUri: string, pointer: string): SourceRange | undefined {
    return this.documentRanges.get(documentUri)?.(pointer);
  }

  has(resourceUri: string): boolean {
    return this.documents.has(resourceUri) || this.aliases.has(resourceUri);
  }

  document(resourceUri: string): JsonValue | undefined {
    return this.documents.get(this.canonical(resourceUri));
  }

  /** External resources referenced but not yet registered; drained per call. */
  takeUnresolved(): string[] {
    const missing = [...this.pendingResources].filter((r) => !this.has(r));
    this.pendingResources.clear();
    return missing;
  }

  dynamicAnchor(resourceUri: string, name: string): SchemaRef | undefined {
    return this.dynamicAnchors.get(`${this.canonical(resourceUri)}#${name}`);
  }

  hasRecursiveRoot(resourceUri: string): boolean {
    return this.recursiveRoots.has(this.canonical(resourceUri));
  }

  /** Production behavior ids some registered keyword declares it consumes. */
  consumedIds(): ReadonlySet<string> {
    return this.consumedBehaviorIds;
  }

  private canonical(resourceUri: string): string {
    return this.aliases.get(resourceUri) ?? resourceUri;
  }

  dialectUriFor(baseUri: string): string {
    const uri = this.documentDialects.get(this.canonical(baseUri));
    if (uri === undefined)
      throw new UnresolvableRefError(`unknown schema '${baseUri}'`);
    return uri;
  }

  dialectFor(baseUri: string): Dialect {
    return this.dialectRegistry.getDialect(this.dialectUriFor(baseUri));
  }

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

  /** Resolve a reference value against the referring schema's base URI. */
  resolveRef(ref: string, currentBase: string): SchemaRef {
    const resolved = splitFragment(resolveUri(ref, currentBase));
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
