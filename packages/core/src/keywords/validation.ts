// Validation vocabulary: pure assertions. Assertions never produce and
// never descend.

import {
  JsonValue,
  isObject,
  jsonTypeOf,
  jsonEqual,
  codePointLength,
  canonicalKey,
} from "../json.js";
import { KeywordBehavior, KeywordContext } from "../dialect.js";
import { Cursor } from "../cursor.js";

/** 2020-12 validation vocabulary URI. */
export const VOCAB_VALIDATION =
  "https://json-schema.org/draft/2020-12/vocab/validation";

const id = (name: string): string => `${VOCAB_VALIDATION}#${name}`;

const assertion = (
  name: string,
  test: (value: JsonValue, instance: JsonValue) => boolean,
  message: (value: JsonValue) => string,
): KeywordBehavior => ({
  id: id(name),
  evaluate: (value: JsonValue, cursor: Cursor, ctx: KeywordContext) => {
    if (test(value, cursor.value)) return true;
    ctx.error(message(value));
    return false;
  },
});

const typeMatches = (t: JsonValue, v: JsonValue): boolean =>
  t === "integer"
    ? typeof v === "number" && Number.isInteger(v)
    : jsonTypeOf(v) === t;

/**
 * EXEMPLAR (assertion class): inspect the instance, report one error on
 * failure, return the verdict. `pattern` compiles its regex through the
 * context so a caller-supplied engine and the per-engine cache apply
 * (see regex.ts), and declares the pattern via analyze() so
 * `rejectUnsafeRegex` can screen it at registration.
 */
export const pattern: KeywordBehavior = {
  id: id("pattern"),
  analyze: (value) => ({
    regexes: typeof value === "string" ? [value] : [],
  }),
  evaluate: (value, cursor, ctx) => {
    const instance = cursor.value;
    if (typeof instance !== "string") return true;
    if (ctx.compileRegex(value as string).test(instance)) return true;
    ctx.error("does not match required pattern");
    return false;
  },
};

// Number of digits after the decimal point in `n`'s shortest representation,
// including exponential notation (1e-8 has 8). `%` on the raw floats fails
// suite cases like 0.0075 % 0.0001 (binary rounding); scaling both operands
// to integers by the same power of ten sidesteps that at the cost of this
// string inspection.
function decimalDigits(n: number): number {
  if (!Number.isFinite(n)) return 0;
  const s = Math.abs(n).toString();
  const eIndex = s.indexOf("e");
  if (eIndex !== -1) {
    const mantissa = s.slice(0, eIndex);
    const exponent = Number(s.slice(eIndex + 1));
    const dot = mantissa.indexOf(".");
    const mantissaDigits = dot === -1 ? 0 : mantissa.length - dot - 1;
    return Math.max(0, mantissaDigits - exponent);
  }
  const dot = s.indexOf(".");
  return dot === -1 ? 0 : s.length - dot - 1;
}

function isMultipleOf(instance: number, divisor: number): boolean {
  const scale = 10 ** Math.max(decimalDigits(instance), decimalDigits(divisor));
  const scaledInstance = instance * scale;
  const scaledDivisor = divisor * scale;
  // Suite case: the scaling itself can overflow to Infinity for huge
  // instances against a small divisor; that must read as non-multiple, not
  // throw or silently misvalidate.
  if (Number.isFinite(scaledInstance) && Number.isFinite(scaledDivisor)) {
    return Math.round(scaledInstance) % Math.round(scaledDivisor) === 0;
  }
  const quotient = instance / divisor;
  return Number.isFinite(quotient) && Number.isInteger(quotient);
}

/** The 2020-12 validation vocabulary's keyword behaviors, by name. */
export const validationVocabulary: Record<string, KeywordBehavior> = {
  type: assertion(
    "type",
    (value, instance) =>
      Array.isArray(value)
        ? value.some((t) => typeMatches(t, instance))
        : typeMatches(value, instance),
    (value) => `expected type ${JSON.stringify(value)}`,
  ),
  enum: assertion(
    "enum",
    (value, instance) =>
      (value as JsonValue[]).some((x) => jsonEqual(x, instance)),
    () => "not one of the allowed values",
  ),
  const: assertion(
    "const",
    (value, instance) => jsonEqual(value, instance),
    () => "does not equal the required constant",
  ),
  pattern,
  minLength: assertion(
    "minLength",
    (value, instance) =>
      typeof instance !== "string" ||
      codePointLength(instance) >= (value as number),
    (value) => `must be at least ${value as number} characters`,
  ),
  maxLength: assertion(
    "maxLength",
    (value, instance) =>
      typeof instance !== "string" ||
      codePointLength(instance) <= (value as number),
    (value) => `must be at most ${value as number} characters`,
  ),
  minimum: assertion(
    "minimum",
    (value, instance) =>
      typeof instance !== "number" || instance >= (value as number),
    (value) => `must be >= ${value as number}`,
  ),
  maximum: assertion(
    "maximum",
    (value, instance) =>
      typeof instance !== "number" || instance <= (value as number),
    (value) => `must be <= ${value as number}`,
  ),
  exclusiveMinimum: assertion(
    "exclusiveMinimum",
    (value, instance) =>
      typeof instance !== "number" || instance > (value as number),
    (value) => `must be > ${value as number}`,
  ),
  exclusiveMaximum: assertion(
    "exclusiveMaximum",
    (value, instance) =>
      typeof instance !== "number" || instance < (value as number),
    (value) => `must be < ${value as number}`,
  ),
  minItems: assertion(
    "minItems",
    (value, instance) =>
      !Array.isArray(instance) || instance.length >= (value as number),
    (value) => `must have at least ${value as number} items`,
  ),
  maxItems: assertion(
    "maxItems",
    (value, instance) =>
      !Array.isArray(instance) || instance.length <= (value as number),
    (value) => `must have at most ${value as number} items`,
  ),
  minProperties: assertion(
    "minProperties",
    (value, instance) =>
      !isObject(instance) || Object.keys(instance).length >= (value as number),
    (value) => `must have at least ${value as number} properties`,
  ),
  maxProperties: assertion(
    "maxProperties",
    (value, instance) =>
      !isObject(instance) || Object.keys(instance).length <= (value as number),
    (value) => `must have at most ${value as number} properties`,
  ),
  required: {
    id: id("required"),
    evaluate: (value, cursor, ctx) => {
      if (!isObject(cursor.value)) return true;
      let ok = true;
      for (const name of value as string[]) {
        if (!Object.hasOwn(cursor.value, name)) {
          ctx.error(`missing required property '${name}'`);
          ok = false;
        }
      }
      return ok;
    },
  },
  multipleOf: assertion(
    "multipleOf",
    (value, instance) =>
      typeof instance !== "number" || isMultipleOf(instance, value as number),
    (value) => `must be a multiple of ${value as number}`,
  ),
  uniqueItems: {
    id: id("uniqueItems"),
    evaluate: (value, cursor, ctx) => {
      if (value !== true || !Array.isArray(cursor.value)) return true;
      const items = cursor.value;
      // Bucket by canonical key for near-linear detection; a key collision is
      // confirmed with jsonEqual so distinct values that happen to share a key
      // are never misreported as duplicates.
      const seen = new Map<string, number[]>();
      for (let i = 0; i < items.length; i++) {
        const bucket = seen.get(canonicalKey(items[i]!));
        if (bucket === undefined) {
          seen.set(canonicalKey(items[i]!), [i]);
          continue;
        }
        for (const j of bucket) {
          if (jsonEqual(items[j]!, items[i]!)) {
            ctx.error(`items at ${j} and ${i} are not unique`);
            return false;
          }
        }
        bucket.push(i);
      }
      return true;
    },
  },
  dependentRequired: {
    id: id("dependentRequired"),
    evaluate: (value, cursor, ctx) => {
      if (!isObject(cursor.value)) return true;
      const instance = cursor.value;
      let ok = true;
      for (const [name, deps] of Object.entries(
        value as Record<string, JsonValue>,
      )) {
        if (!Object.hasOwn(instance, name)) continue;
        for (const dep of deps as string[]) {
          if (!Object.hasOwn(instance, dep)) {
            ctx.error(`'${name}' requires '${dep}' to be present`);
            ok = false;
          }
        }
      }
      return ok;
    },
  },
  // minContains/maxContains have no assertion of their own; `contains` reads
  // them as inert siblings (applicator.ts), the same way `if` drives `then`/
  // `else`. They must still be registered so unknown-keyword handling and the
  // registration walk don't treat them as annotation-only or absent.
  minContains: { id: id("minContains"), evaluate: () => true },
  maxContains: { id: id("maxContains"), evaluate: () => true },
};
