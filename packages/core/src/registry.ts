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

// Where a schema resource physically lives: the registered document that
// contains it and the JSON Pointer from that document's root to the
// resource's root. Canonical schema locations are resource-rooted; loaders
// report source positions document-rooted (D17) — this is the bridge.
export interface DocumentLocation {
  documentUri: string;
  pointer: string;
}

export class SchemaRegistry {
  private documents = new Map<string, JsonValue>();   // resource URI -> schema node
  private anchors = new Map<string, SchemaRef>();     // "resource#anchor"
  private documentDialects = new Map<string, string>(); // resource URI -> dialect URI
  private resourceLocations = new Map<string, DocumentLocation>();

  constructor(
    private dialectRegistry: DialectRegistry,
    private defaultDialectUri: string,
  ) {}

  /**
   * Register a schema document. The dialect comes from `$schema` when present
   * (and must already be registered), else `dialectUri`, else the default.
   * Returns the document's canonical base URI.
   */
  register(schema: JsonValue, retrievalUri: string, dialectUri?: string): string {
    let effectiveDialect = dialectUri ?? this.defaultDialectUri;
    if (isObject(schema) && typeof schema.$schema === "string") {
      effectiveDialect = splitFragment(resolveUri(schema.$schema, retrievalUri)).resource;
    }
    const dialect = this.dialectRegistry.getDialect(effectiveDialect);

    let baseUri = splitFragment(retrievalUri).resource;
    if (isObject(schema) && typeof schema.$id === "string") {
      baseUri = splitFragment(resolveUri(schema.$id, baseUri)).resource;
    }
    this.documents.set(baseUri, schema);
    this.documentDialects.set(baseUri, effectiveDialect);
    this.resourceLocations.set(baseUri, { documentUri: baseUri, pointer: "" });
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

    if (pointer !== "" && typeof node.$id === "string") {
      baseUri = splitFragment(resolveUri(node.$id, baseUri)).resource;
      pointer = "";
      this.documents.set(baseUri, node);
      this.documentDialects.set(baseUri, dialect.uri);
      this.resourceLocations.set(baseUri, { documentUri, pointer: docPointer });
    }
    if (typeof node.$anchor === "string") {
      this.anchors.set(`${baseUri}#${node.$anchor}`, { node, baseUri, pointer });
    }

    for (const [name, value] of Object.entries(node)) {
      const behavior = dialect.keywords.get(name)?.behavior;
      const positions = behavior?.analyze?.(value!)?.subschemas;
      if (!positions) continue;
      for (const relPath of positions) {
        let child: JsonValue = value!;
        let suffix = "/" + escapeSegment(name);
        for (const seg of relPath) {
          child = (Array.isArray(child)
            ? child[seg as number]
            : (child as Record<string, JsonValue>)[seg as string]) as JsonValue;
          suffix += "/" + escapeSegment(String(seg));
        }
        this.walk(child, baseUri, pointer + suffix, documentUri, docPointer + suffix, dialect);
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
    return this.resourceLocations.get(resourceUri);
  }

  dialectFor(baseUri: string): Dialect {
    const uri = this.documentDialects.get(baseUri);
    if (uri === undefined) throw new UnresolvableRefError(`unknown schema '${baseUri}'`);
    return this.dialectRegistry.getDialect(uri);
  }

  rootRef(uri: string): SchemaRef {
    const { resource, fragment } = splitFragment(uri);
    if (fragment !== null && fragment !== "") {
      return this.resolveRef(uri, resource);
    }
    const node = this.documents.get(resource);
    if (node === undefined) throw new UnresolvableRefError(`unknown schema '${resource}'`);
    return { node, baseUri: resource, pointer: "" };
  }

  /** Resolve a reference value against the referring schema's base URI. */
  resolveRef(ref: string, currentBase: string): SchemaRef {
    const { resource, fragment } = splitFragment(resolveUri(ref, currentBase));

    if (fragment !== null && fragment !== "" && !fragment.startsWith("/")) {
      const hit = this.anchors.get(`${resource}#${fragment}`);
      if (!hit) throw new UnresolvableRefError(`unknown anchor '${resource}#${fragment}'`);
      return hit;
    }

    const root = this.documents.get(resource);
    if (root === undefined) throw new UnresolvableRefError(`unknown schema '${resource}'`);
    if (fragment === null || fragment === "") {
      return { node: root, baseUri: resource, pointer: "" };
    }

    // JSON Pointer navigation, tracking $id-induced base changes on the way.
    let node: JsonValue = root;
    let baseUri = resource;
    let pointer = "";
    for (const rawSeg of fragment.slice(1).split("/")) {
      const seg = unescapeSegment(rawSeg);
      if (Array.isArray(node)) {
        node = node[Number(seg)] as JsonValue;
      } else if (isObject(node) && Object.hasOwn(node, seg)) {
        node = node[seg] as JsonValue;
      } else {
        node = undefined as unknown as JsonValue;
      }
      if (node === undefined) {
        throw new UnresolvableRefError(`pointer '${fragment}' not found in '${resource}'`);
      }
      pointer += "/" + escapeSegment(seg);
      if (isObject(node) && typeof node.$id === "string") {
        baseUri = splitFragment(resolveUri(node.$id, baseUri)).resource;
        pointer = "";
      }
    }
    return { node, baseUri, pointer };
  }

  /**
   * Descend from a schema position into keyword/index children, maintaining
   * canonical location and lexical base.
   */
  child(ref: SchemaRef, segments: readonly (string | number)[]): SchemaRef {
    let node: JsonValue = ref.node;
    let { baseUri, pointer } = ref;
    for (const seg of segments) {
      node = (Array.isArray(node)
        ? node[seg as number]
        : (node as Record<string, JsonValue>)[seg as string]) as JsonValue;
      pointer += "/" + escapeSegment(String(seg));
      if (isObject(node) && typeof node.$id === "string") {
        baseUri = splitFragment(resolveUri(node.$id, baseUri)).resource;
        pointer = "";
      }
    }
    return { node, baseUri, pointer };
  }
}
