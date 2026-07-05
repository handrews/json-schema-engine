// Shared JSON utilities for the prototype.

export type JsonValue =
  | null | boolean | number | string | JsonValue[] | { [k: string]: JsonValue };

export type JsonType =
  | "null" | "boolean" | "number" | "integer" | "string" | "array" | "object";

export const isObject = (v: unknown): v is Record<string, JsonValue> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

// The primitive type of an instance value ("integer" is a subtype handled in
// the type keyword, not returned here).
export function jsonTypeOf(v: JsonValue): Exclude<JsonType, "integer"> {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  switch (typeof v) {
    case "boolean": return "boolean";
    case "number": return "number";
    case "string": return "string";
    default: return "object";
  }
}

// JSON equality per the spec's definition (type + value, order-insensitive
// for objects).
export function jsonEqual(a: JsonValue, b: JsonValue): boolean {
  if (a === b) return true;
  if (typeof a === "number" && typeof b === "number") return a === b;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!jsonEqual(a[i]!, b[i]!)) return false;
    }
    return true;
  }
  if (isObject(a)) {
    if (!isObject(b)) return false;
    const ka = Object.keys(a);
    if (ka.length !== Object.keys(b).length) return false;
    for (const k of ka) {
      if (!Object.hasOwn(b, k) || !jsonEqual(a[k]!, b[k]!)) return false;
    }
    return true;
  }
  return false;
}

// String length in code points (minLength/maxLength).
export function codePointLength(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    n++;
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) i++;
  }
  return n;
}

// ECMA-262 regex in unicode mode where possible (required for \p{...}
// property escapes), falling back for patterns invalid under the u flag.
export function schemaRegExp(pattern: string): RegExp {
  try {
    return new RegExp(pattern, "u");
  } catch {
    return new RegExp(pattern);
  }
}

// JSON Pointer segment escaping (RFC 6901).
export const escapeSegment = (s: string): string =>
  s.replace(/~/g, "~0").replace(/\//g, "~1");

export const unescapeSegment = (s: string): string =>
  s.replace(/~1/g, "/").replace(/~0/g, "~");
