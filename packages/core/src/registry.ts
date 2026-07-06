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

export class SchemaRegistry {
  private documents = new Map<string, JsonValue>();   // resource URI -> schema node
  private anchors = new Map<string, SchemaRef>();     // "resource#anchor"
  private documentDialects = new Map<string, string>(); // resource URI -> dialect URI

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
    this.walk(schema, baseUri, "", dialect);
    return baseUri;
  }

  private walk(node: JsonValue, baseUri: string, pointer: string, dialect: Dialect): void {
    if (!isObject(node)) return;

    if (pointer !== "" && typeof node.$id === "string") {
      baseUri = splitFragment(resolveUri(node.$id, baseUri)).resource;
      pointer = "";
      this.documents.set(baseUri, node);
      this.documentDialects.set(baseUri, dialect.uri);
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
        let childPointer = pointer + "/" + escapeSegment(name);
        for (const seg of relPath) {
          child = (Array.isArray(child)
            ? child[seg as number]
            : (child as Record<string, JsonValue>)[seg as string]) as JsonValue;
          childPointer += "/" + escapeSegment(String(seg));
        }
        this.walk(child, baseUri, childPointer, dialect);
      }
    }
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
