// The gated code serializer (D20/M6): the ONLY module that assembles
// JavaScript source text. Every value that reaches emitted code passes
// through a typed wrapper here, so schema-derived data is escaped by
// construction — raw string concatenation of untrusted input is impossible.
//
// The `js` tag accepts only CodeChunk arguments (the branded outputs of the
// wrappers below); a bare string throws. Template static parts are literals
// by grammar. Downstream modules traffic in CodeChunk, never string, so the
// type system carries the guarantee and ESLint fences the one escape hatch.

import type { JsonValue } from "@json-schema-engine/core";

const BRAND = Symbol("CodeChunk");

/** An opaque, already-escaped fragment of emitted JavaScript. */
export interface CodeChunk {
  readonly [BRAND]: true;
  readonly text: string;
}

const chunk = (text: string): CodeChunk => ({ [BRAND]: true, text });

const isChunk = (v: unknown): v is CodeChunk =>
  typeof v === "object" && v !== null && BRAND in v;

/**
 * Tagged template for emitted code. Interpolations MUST be CodeChunks (from
 * {@link id}/{@link str}/{@link num}/{@link json}/{@link regexTest}/{@link raw}/
 * {@link frag}); anything else throws, so a stray schema string can never be
 * spliced verbatim.
 */
export function js(
  strings: TemplateStringsArray,
  ...parts: readonly CodeChunk[]
): CodeChunk {
  let out = strings[0]!;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (!isChunk(part)) {
      throw new TypeError(
        `js\`\` interpolation ${i} is not a CodeChunk; wrap it (id/str/num/json/…)`,
      );
    }
    out += part.text + strings[i + 1]!;
  }
  return chunk(out);
}

const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const RESERVED = new Set([
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "debugger",
  "default",
  "delete",
  "do",
  "else",
  "export",
  "extends",
  "false",
  "finally",
  "for",
  "function",
  "if",
  "import",
  "in",
  "instanceof",
  "new",
  "null",
  "return",
  "super",
  "switch",
  "this",
  "throw",
  "true",
  "try",
  "typeof",
  "var",
  "void",
  "while",
  "with",
  "yield",
  "let",
  "static",
  "enum",
  "await",
  "implements",
  "package",
  "protected",
  "interface",
  "private",
  "public",
]);

/**
 * A machine-generated identifier. NEVER pass schema-derived text here —
 * identifiers come from the compiler's own counters and a fixed helper
 * vocabulary. Rejects anything that is not a plain identifier or is reserved.
 */
export function id(name: string): CodeChunk {
  if (!IDENT.test(name) || RESERVED.has(name)) {
    throw new TypeError(`unsafe identifier '${name}'`);
  }
  return chunk(name);
}

/** A JavaScript string literal, escaped for embedding (incl. U+2028/U+2029). */
export function str(value: string): CodeChunk {
  const json = JSON.stringify(value);
  // JSON.stringify leaves U+2028/U+2029 literal; they are valid in JSON but
  // were line terminators in pre-ES2019 JS and still trip some tooling.
  return chunk(
    json.replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029"),
  );
}

/** A numeric literal, JSON-sourced (finite), with an explicit -0 branch. */
export function num(value: number): CodeChunk {
  if (!Number.isFinite(value)) {
    throw new TypeError(`non-finite numeric constant ${String(value)}`);
  }
  if (Object.is(value, -0)) return chunk("-0");
  return chunk(String(value));
}

/** True when `value` or any nested value is an object with a "__proto__" own key. */
function hasProtoKey(value: JsonValue): boolean {
  if (value === null || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(hasProtoKey);
  if (Object.hasOwn(value, "__proto__")) return true;
  return Object.values(value).some(hasProtoKey);
}

/**
 * A JSON constant. Emits an object/array literal only when no nested own key
 * is `__proto__` (a literal `{"__proto__": …}` sets the prototype in source,
 * unlike JSON.parse); otherwise routes through a JSON.parse call so the
 * prototype is never touched.
 */
export function json(value: JsonValue): CodeChunk {
  if (value === null || typeof value !== "object") {
    if (typeof value === "number") return num(value);
    if (typeof value === "string") return str(value);
    return chunk(String(value)); // boolean
  }
  if (hasProtoKey(value)) {
    return chunk(`JSON.parse(${str(JSON.stringify(value)).text})`);
  }
  if (Array.isArray(value)) {
    return chunk(`[${value.map((v) => json(v).text).join(",")}]`);
  }
  const members = Object.entries(value).map(
    ([k, v]) => `${str(k).text}:${json(v).text}`,
  );
  return chunk(`{${members.join(",")}}`);
}

/**
 * A regex membership test against a hoisted, pre-compiled pattern. The
 * pattern source is escaped as a string literal; the compiled RegExp is
 * supplied at runtime through the artifact's regex table (never
 * `RegExp.prototype.toString`, never inline `/…/`).
 */
export function regexTest(
  tableRef: CodeChunk,
  source: string,
  target: CodeChunk,
): CodeChunk {
  return chunk(`${tableRef.text}[${str(source).text}].test(${target.text})`);
}

/** Splice previously built chunks (already escaped). */
export function frag(...chunks: readonly CodeChunk[]): CodeChunk {
  return chunk(chunks.map((c) => c.text).join(""));
}

/** Join chunks with a separator (both already escaped). */
export function join(sep: string, chunks: readonly CodeChunk[]): CodeChunk {
  return chunk(chunks.map((c) => c.text).join(sep));
}

/**
 * Internal escape hatch for structural code the compiler itself controls
 * (keywords, operators) — NOT for schema-derived data. Guarded by ESLint so
 * only emit-internal call sites use it. Kept explicit so audits grep one name.
 */
export function raw(controlledSource: string): CodeChunk {
  return chunk(controlledSource);
}

/** The assembled source text of a chunk. */
export const render = (c: CodeChunk): string => c.text;
