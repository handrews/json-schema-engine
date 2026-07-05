// Schema registration and static reference resolution.
//
// Registration walks only *schema positions* (a keyword-aware walk), so an
// `$id` or `$anchor` appearing inside `enum` data or an unknown keyword's
// value is not treated as an identifier — the trap several official ref tests
// check for.

import { JsonValue, isObject, unescapeSegment, escapeSegment } from "./json.js";

export interface SchemaRef {
  node: JsonValue;
  baseUri: string; // canonical base (no fragment)
  pointer: string; // JSON Pointer from the base's root schema
}

export class UnresolvableRefError extends Error {}

// Keywords whose value is one schema.
const SINGLE_SUBSCHEMA = new Set([
  "additionalProperties", "contains", "items", "not", "if", "then", "else",
  "propertyNames", "unevaluatedItems", "unevaluatedProperties",
]);
// Keywords whose value is an array of schemas.
const SUBSCHEMA_ARRAY = new Set(["allOf", "anyOf", "oneOf", "prefixItems"]);
// Keywords whose value is an object of named schemas.
const SUBSCHEMA_MAP = new Set([
  "$defs", "definitions", "properties", "patternProperties", "dependentSchemas",
]);

function resolveUri(ref: string, base: string): string {
  try {
    return new URL(ref, base).href;
  } catch {
    throw new UnresolvableRefError(`cannot resolve '${ref}' against '${base}'`);
  }
}

function splitFragment(uri: string): { resource: string; fragment: string | null } {
  const i = uri.indexOf("#");
  return i === -1
    ? { resource: uri, fragment: null }
    : { resource: uri.slice(0, i), fragment: decodeURIComponent(uri.slice(i + 1)) };
}

export class Registry {
  private docs = new Map<string, JsonValue>(); // resource URI -> schema node
  private anchors = new Map<string, SchemaRef>(); // "resource#anchor"

  register(schema: JsonValue, retrievalUri: string): string {
    let baseUri = splitFragment(retrievalUri).resource;
    if (isObject(schema) && typeof schema.$id === "string") {
      baseUri = splitFragment(resolveUri(schema.$id, baseUri)).resource;
    }
    this.docs.set(baseUri, schema);
    this.walk(schema, baseUri, "");
    return baseUri;
  }

  private walk(node: JsonValue, baseUri: string, pointer: string): void {
    if (!isObject(node)) return;

    if (pointer !== "" && typeof node.$id === "string") {
      baseUri = splitFragment(resolveUri(node.$id, baseUri)).resource;
      pointer = "";
      this.docs.set(baseUri, node);
    }
    if (typeof node.$anchor === "string") {
      this.anchors.set(`${baseUri}#${node.$anchor}`, { node, baseUri, pointer });
    }

    for (const [k, v] of Object.entries(node)) {
      const p = pointer + "/" + escapeSegment(k);
      if (SINGLE_SUBSCHEMA.has(k)) {
        this.walk(v!, baseUri, p);
      } else if (SUBSCHEMA_ARRAY.has(k) && Array.isArray(v)) {
        v.forEach((s, i) => this.walk(s!, baseUri, `${p}/${i}`));
      } else if (SUBSCHEMA_MAP.has(k) && isObject(v)) {
        for (const [name, s] of Object.entries(v)) {
          this.walk(s!, baseUri, `${p}/${escapeSegment(name)}`);
        }
      }
    }
  }

  rootRef(baseUri: string): SchemaRef {
    const node = this.docs.get(baseUri);
    if (node === undefined) throw new UnresolvableRefError(`unknown schema '${baseUri}'`);
    return { node, baseUri, pointer: "" };
  }

  // Resolve a $ref value against the referring schema's base URI.
  resolveRef(ref: string, currentBase: string): SchemaRef {
    const { resource, fragment } = splitFragment(resolveUri(ref, currentBase));

    if (fragment !== null && fragment !== "" && !fragment.startsWith("/")) {
      const hit = this.anchors.get(`${resource}#${fragment}`);
      if (!hit) throw new UnresolvableRefError(`unknown anchor '${resource}#${fragment}'`);
      return hit;
    }

    const root = this.docs.get(resource);
    if (root === undefined) throw new UnresolvableRefError(`unknown schema '${resource}'`);
    if (fragment === null || fragment === "") return { node: root, baseUri: resource, pointer: "" };

    // JSON Pointer navigation, tracking $id-induced base changes on the way.
    let node: JsonValue = root;
    let baseUri = resource;
    let pointer = "";
    for (const rawSeg of fragment.slice(1).split("/")) {
      const seg = unescapeSegment(rawSeg);
      if (Array.isArray(node)) {
        node = node[Number(seg)] as JsonValue;
      } else if (isObject(node)) {
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

  // Descend from a schema into a keyword/index child, maintaining canonical
  // location and lexical base.
  child(ref: SchemaRef, ...segments: (string | number)[]): SchemaRef {
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
