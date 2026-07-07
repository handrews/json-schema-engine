// Validation vocabulary: pure assertions. Assertions never produce and
// never descend.

import {
  JsonValue,
  JsonType,
  isObject,
  jsonTypeOf,
  jsonEqual,
  codePointLength,
  firstDuplicatePair,
} from "../json.js";
import { KeywordBehavior, KeywordContext } from "../dialect.js";
import { LowerExpr, LoweringContext, lowerIR } from "../lowering.js";
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

/**
 * Shared shape for the numeric/string/array/object "guard, then compare"
 * assertions (minLength/maxLength/minimum/maximum/exclusiveMinimum/
 * exclusiveMaximum/minItems/maxItems/minProperties/maxProperties): the
 * keyword is vacuously true unless the instance has the guarded type, in
 * which case a comparison against the (hoisted) keyword value must hold.
 * Mirrors each assertion's `test` above exactly — same guard, same
 * direction of comparison — via `when(and(guard, not(cmp)), [fail])`.
 */
const guardedCompare =
  (
    guardType: JsonType,
    measure: (lctx: LoweringContext) => LowerExpr,
    op: "<" | "<=" | ">" | ">=",
    message: (value: JsonValue) => string,
  ) =>
  (value: JsonValue, lctx: LoweringContext): void => {
    lctx.emit(
      lowerIR.when(
        lowerIR.and(
          lowerIR.typeIs(lctx.instance, guardType),
          lowerIR.not(lowerIR.cmp(op, measure(lctx), lowerIR.constant(value))),
        ),
        [lowerIR.fail(message(value))],
      ),
    );
  };
const arrayLengthMeasure = (lctx: LoweringContext): LowerExpr =>
  lowerIR.helper("lengthOf", lctx.instance);
const propertyCountMeasure = (lctx: LoweringContext): LowerExpr =>
  lowerIR.helper("lengthOf", lowerIR.helper("keysOf", lctx.instance));
const numberMeasure = (lctx: LoweringContext): LowerExpr => lctx.instance;

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
  lower: (value, lctx) => {
    lctx.emit(
      lowerIR.when(
        lowerIR.and(
          lowerIR.typeIs(lctx.instance, "string"),
          lowerIR.not(lowerIR.regexTest(value as string, lctx.instance)),
        ),
        [lowerIR.fail("does not match required pattern")],
      ),
    );
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

/**
 * `instance` is an exact multiple of `divisor` (`multipleOf`'s predicate,
 * shared by both tiers). Scales both operands to integers by the same power
 * of ten before the modulus so binary-float rounding doesn't misfire (e.g.
 * 0.0075 % 0.0001 in raw floats).
 */
export function isMultipleOf(instance: number, divisor: number): boolean {
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
  type: {
    id: id("type"),
    evaluate: (value, cursor, ctx) => {
      const ok = Array.isArray(value)
        ? value.some((t) => typeMatches(t, cursor.value))
        : typeMatches(value, cursor.value);
      if (!ok) ctx.error(`expected type ${JSON.stringify(value)}`);
      return ok;
    },
    lower: (value, lctx) => {
      const types = (Array.isArray(value) ? value : [value]) as (
        JsonType | "integer"
      )[];
      lctx.emit(
        lowerIR.when(lowerIR.not(lowerIR.typeIs(lctx.instance, ...types)), [
          lowerIR.fail(`expected type ${JSON.stringify(value)}`),
        ]),
      );
    },
  },
  enum: {
    ...assertion(
      "enum",
      (value, instance) =>
        (value as JsonValue[]).some((x) => jsonEqual(x, instance)),
      () => "not one of the allowed values",
    ),
    lower: (value, lctx) => {
      const alternatives = value as JsonValue[];
      // An empty enum can never match (some() over zero alternatives is
      // false); guard explicitly since lowerIR.or() with zero parts has no
      // meaningful "no alternatives matched" expression to negate.
      lctx.emit(
        alternatives.length === 0
          ? lowerIR.fail("not one of the allowed values")
          : lowerIR.when(
              lowerIR.not(
                lowerIR.or(
                  ...alternatives.map((x) =>
                    lowerIR.helper(
                      "jsonEqual",
                      lowerIR.constant(x),
                      lctx.instance,
                    ),
                  ),
                ),
              ),
              [lowerIR.fail("not one of the allowed values")],
            ),
      );
    },
  },
  const: {
    ...assertion(
      "const",
      (value, instance) => jsonEqual(value, instance),
      () => "does not equal the required constant",
    ),
    lower: (value, lctx) => {
      lctx.emit(
        lowerIR.when(
          lowerIR.not(
            lowerIR.helper("jsonEqual", lowerIR.constant(value), lctx.instance),
          ),
          [lowerIR.fail("does not equal the required constant")],
        ),
      );
    },
  },
  pattern,
  minLength: {
    ...assertion(
      "minLength",
      (value, instance) =>
        typeof instance !== "string" ||
        codePointLength(instance) >= (value as number),
      (value) => `must be at least ${value as number} characters`,
    ),
    // Violation = code points < n. UTF-16 units bound points from above
    // (points <= units) and below (points >= units/2), so units alone decide
    // outside [n, 2n) — codePointLength runs only in that window (D9).
    lower: (value, lctx) => {
      const n = value as number;
      const len = lowerIR.helper("lengthOf", lctx.instance);
      const cpl = lowerIR.helper("codePointLength", lctx.instance);
      lctx.emit(
        lowerIR.when(
          lowerIR.and(
            lowerIR.typeIs(lctx.instance, "string"),
            lowerIR.or(
              lowerIR.cmp("<", len, lowerIR.constant(n)),
              lowerIR.and(
                lowerIR.cmp("<", len, lowerIR.constant(2 * n)),
                lowerIR.cmp("<", cpl, lowerIR.constant(n)),
              ),
            ),
          ),
          [lowerIR.fail(`must be at least ${n} characters`)],
        ),
      );
    },
  },
  maxLength: {
    ...assertion(
      "maxLength",
      (value, instance) =>
        typeof instance !== "string" ||
        codePointLength(instance) <= (value as number),
      (value) => `must be at most ${value as number} characters`,
    ),
    // Violation = code points > n; units <= n implies points <= n, so the
    // expensive count runs only when units exceed the bound (D9).
    lower: (value, lctx) => {
      const n = value as number;
      lctx.emit(
        lowerIR.when(
          lowerIR.and(
            lowerIR.typeIs(lctx.instance, "string"),
            lowerIR.cmp(
              ">",
              lowerIR.helper("lengthOf", lctx.instance),
              lowerIR.constant(n),
            ),
            lowerIR.cmp(
              ">",
              lowerIR.helper("codePointLength", lctx.instance),
              lowerIR.constant(n),
            ),
          ),
          [lowerIR.fail(`must be at most ${n} characters`)],
        ),
      );
    },
  },
  minimum: {
    ...assertion(
      "minimum",
      (value, instance) =>
        typeof instance !== "number" || instance >= (value as number),
      (value) => `must be >= ${value as number}`,
    ),
    lower: guardedCompare(
      "number",
      numberMeasure,
      ">=",
      (value) => `must be >= ${value as number}`,
    ),
  },
  maximum: {
    ...assertion(
      "maximum",
      (value, instance) =>
        typeof instance !== "number" || instance <= (value as number),
      (value) => `must be <= ${value as number}`,
    ),
    lower: guardedCompare(
      "number",
      numberMeasure,
      "<=",
      (value) => `must be <= ${value as number}`,
    ),
  },
  exclusiveMinimum: {
    ...assertion(
      "exclusiveMinimum",
      (value, instance) =>
        typeof instance !== "number" || instance > (value as number),
      (value) => `must be > ${value as number}`,
    ),
    lower: guardedCompare(
      "number",
      numberMeasure,
      ">",
      (value) => `must be > ${value as number}`,
    ),
  },
  exclusiveMaximum: {
    ...assertion(
      "exclusiveMaximum",
      (value, instance) =>
        typeof instance !== "number" || instance < (value as number),
      (value) => `must be < ${value as number}`,
    ),
    lower: guardedCompare(
      "number",
      numberMeasure,
      "<",
      (value) => `must be < ${value as number}`,
    ),
  },
  minItems: {
    ...assertion(
      "minItems",
      (value, instance) =>
        !Array.isArray(instance) || instance.length >= (value as number),
      (value) => `must have at least ${value as number} items`,
    ),
    lower: guardedCompare(
      "array",
      arrayLengthMeasure,
      ">=",
      (value) => `must have at least ${value as number} items`,
    ),
  },
  maxItems: {
    ...assertion(
      "maxItems",
      (value, instance) =>
        !Array.isArray(instance) || instance.length <= (value as number),
      (value) => `must have at most ${value as number} items`,
    ),
    lower: guardedCompare(
      "array",
      arrayLengthMeasure,
      "<=",
      (value) => `must have at most ${value as number} items`,
    ),
  },
  minProperties: {
    ...assertion(
      "minProperties",
      (value, instance) =>
        !isObject(instance) ||
        Object.keys(instance).length >= (value as number),
      (value) => `must have at least ${value as number} properties`,
    ),
    lower: guardedCompare(
      "object",
      propertyCountMeasure,
      ">=",
      (value) => `must have at least ${value as number} properties`,
    ),
  },
  maxProperties: {
    ...assertion(
      "maxProperties",
      (value, instance) =>
        !isObject(instance) ||
        Object.keys(instance).length <= (value as number),
      (value) => `must have at most ${value as number} properties`,
    ),
    lower: guardedCompare(
      "object",
      propertyCountMeasure,
      "<=",
      (value) => `must have at most ${value as number} properties`,
    ),
  },
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
    lower: (value, lctx) => {
      lctx.emit(
        lowerIR.when(lowerIR.typeIs(lctx.instance, "object"), [
          ...(value as string[]).map((name) =>
            lowerIR.when(
              lowerIR.not({
                kind: "hasOwn",
                target: lctx.instance,
                key: name,
              }),
              [lowerIR.fail(`missing required property '${name}'`)],
            ),
          ),
        ]),
      );
    },
  },
  multipleOf: {
    ...assertion(
      "multipleOf",
      (value, instance) =>
        typeof instance !== "number" || isMultipleOf(instance, value as number),
      (value) => `must be a multiple of ${value as number}`,
    ),
    lower: (value, lctx) => {
      lctx.emit(
        lowerIR.when(
          lowerIR.and(
            lowerIR.typeIs(lctx.instance, "number"),
            lowerIR.not(
              lowerIR.helper(
                "isMultipleOf",
                lctx.instance,
                lowerIR.constant(value),
              ),
            ),
          ),
          [lowerIR.fail(`must be a multiple of ${value as number}`)],
        ),
      );
    },
  },
  uniqueItems: {
    id: id("uniqueItems"),
    evaluate: (value, cursor, ctx) => {
      if (value !== true || !Array.isArray(cursor.value)) return true;
      const pair = firstDuplicatePair(cursor.value);
      if (pair === null) return true;
      const [j, i] = pair;
      ctx.error(`items at ${j} and ${i} are not unique`);
      return false;
    },
    // evaluate() returns true (vacuously) whenever `value !== true` — mirror
    // that by emitting nothing at all when the keyword value isn't literally
    // `true` (the message text can't cite specific indexes at compile time,
    // but the assertion itself does not depend on them: any duplicate fails).
    lower: (value, lctx) => {
      if (value !== true) return;
      // The pair lookup in the message runs only on the failure path
      // (D9e), so the duplicate scan's cost is not doubled for valid data.
      const pair = lowerIR.helper("firstDuplicatePair", lctx.instance);
      lctx.emit(
        lowerIR.when(
          lowerIR.and(
            lowerIR.typeIs(lctx.instance, "array"),
            lowerIR.helper("hasDuplicateItems", lctx.instance),
          ),
          [
            lowerIR.fail(
              "items at ",
              { kind: "item", target: pair, index: lowerIR.constant(0) },
              " and ",
              { kind: "item", target: pair, index: lowerIR.constant(1) },
              " are not unique",
            ),
          ],
        ),
      );
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
    lower: (value, lctx) => {
      lctx.emit(
        lowerIR.when(lowerIR.typeIs(lctx.instance, "object"), [
          ...Object.entries(value as Record<string, JsonValue>).map(
            ([name, deps]) =>
              lowerIR.when(
                { kind: "hasOwn", target: lctx.instance, key: name },
                (deps as string[]).map((dep) =>
                  lowerIR.when(
                    lowerIR.not({
                      kind: "hasOwn",
                      target: lctx.instance,
                      key: dep,
                    }),
                    [lowerIR.fail(`'${name}' requires '${dep}' to be present`)],
                  ),
                ),
              ),
          ),
        ]),
      );
    },
  },
  // minContains/maxContains have no assertion of their own; `contains` reads
  // them as inert siblings (applicator.ts), the same way `if` drives `then`/
  // `else`. They must still be registered so unknown-keyword handling and the
  // registration walk don't treat them as annotation-only or absent.
  minContains: {
    id: id("minContains"),
    evaluate: () => true,
    lower: () => {
      /* contains reads this sibling directly (lctx.schema.minContains) */
    },
  },
  maxContains: {
    id: id("maxContains"),
    evaluate: () => true,
    lower: () => {
      /* contains reads this sibling directly (lctx.schema.maxContains) */
    },
  },
};
