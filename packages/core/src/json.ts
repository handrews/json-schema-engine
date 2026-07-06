// JSON utilities. Discipline notes carried over from the F2 prototype
// (DESIGN.md §5): Object.hasOwn everywhere an instance or schema key is
// tested (`__proto__`/`toString`/`constructor` are legal property names);
// regex compiled in unicode mode with fallback; length in code points.

/** A JSON-representable value. */
export type JsonValue =
  null | boolean | number | string | JsonValue[] | { [k: string]: JsonValue };

/** The seven JSON Schema primitive type names, including the `integer` subtype. */
export type JsonType =
  "null" | "boolean" | "number" | "integer" | "string" | "array" | "object";

/** True for JSON objects, excluding arrays and `null`. */
export const isObject = (v: unknown): v is Record<string, JsonValue> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * The primitive type of an instance value. `"integer"` is a numeric subtype
 * handled by the `type` keyword and is never returned here.
 */
export function jsonTypeOf(v: JsonValue): Exclude<JsonType, "integer"> {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  switch (typeof v) {
    case "boolean":
      return "boolean";
    case "number":
      return "number";
    case "string":
      return "string";
    default:
      return "object";
  }
}

/**
 * JSON equality per the spec: same type and value, object member order
 * insignificant.
 */
export function jsonEqual(a: JsonValue, b: JsonValue): boolean {
  if (a === b) return true;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!jsonEqual(a[i]!, b[i]!)) return false;
    }
    return true;
  }
  if (isObject(a)) {
    if (!isObject(b)) return false;
    const keys = Object.keys(a);
    if (keys.length !== Object.keys(b).length) return false;
    for (const k of keys) {
      if (!Object.hasOwn(b, k) || !jsonEqual(a[k]!, b[k]!)) return false;
    }
    return true;
  }
  return false;
}

/**
 * A canonical string key for JSON equality: two values share a key exactly
 * when {@link jsonEqual} holds (object member order made insignificant by
 * sorting keys). Used to bucket values for near-linear duplicate detection;
 * callers confirm bucket collisions with {@link jsonEqual} since distinct
 * values could, in principle, collide on the key.
 */
export function canonicalKey(value: JsonValue): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalKey).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalKey(value[k]!)}`).join(",")}}`;
}

/** String length in Unicode code points, per `minLength`/`maxLength`. */
export function codePointLength(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    n++;
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) i++;
  }
  return n;
}

/**
 * Compiles an ECMA-262 regex in unicode mode where possible (required for
 * `\p{...}` property escapes), falling back for patterns invalid under the
 * `u` flag.
 */
export function schemaRegExp(pattern: string): RegExp {
  try {
    return new RegExp(pattern, "u");
  } catch {
    return new RegExp(pattern);
  }
}

/** Escapes a JSON Pointer segment (RFC 6901). */
export const escapeSegment = (s: string): string =>
  s.replace(/~/g, "~0").replace(/\//g, "~1");

/** Unescapes a JSON Pointer segment (RFC 6901). */
export const unescapeSegment = (s: string): string =>
  s.replace(/~1/g, "/").replace(/~0/g, "~");
