// Validation vocabulary: pure assertions. Assertions never produce and
// never descend.
//
// Every keyword describes its one error once (D13): a `describe` builder
// gives the message and params as lowering IR, `lower()` emits it, and
// `evaluate()` reports it through `ctx.report` for the record to realize
// against the instance if it is ever rendered. Runtime data enters the
// evaluate-side form as constants (`lowerIR.instance` for the instance).

import {
  JsonValue,
  JsonType,
  isObject,
  jsonTypeOf,
  jsonEqual,
  codePointLength,
  isMultipleOf,
  hasDuplicateItems,
} from "../json.js";
import { KeywordBehavior, KeywordContext } from "../dialect.js";
import {
  Description,
  LowerExpr,
  LoweringContext,
  lowerIR,
} from "../lowering.js";
import { Cursor } from "../cursor.js";
import { missingDependencies, preview } from "../messages.js";

/** 2020-12 validation vocabulary URI. */
export const VOCAB_VALIDATION =
  "https://json-schema.org/draft/2020-12/vocab/validation";

const id = (name: string): string => `${VOCAB_VALIDATION}#${name}`;

// A keyword's one message builder: IR for its error, given the keyword
// value and the instance expression.
type Describe<V> = (value: V, instance: LowerExpr) => Description;

// The instance as a message shows it.
const shown = (instance: LowerExpr): LowerExpr =>
  lowerIR.helper("preview", instance);

/**
 * A one-error assertion: `test(value, instance)` or report. `describe` is
 * the keyword's one message builder; `lower` emits the same description.
 */
const assertion = <V extends JsonValue>(
  name: string,
  test: (value: V, instance: JsonValue) => boolean,
  describe: Describe<V>,
): KeywordBehavior => ({
  id: id(name),
  evaluate: (value: JsonValue, cursor: Cursor, ctx: KeywordContext) => {
    if (test(value as V, cursor.value)) return true;
    ctx.report(() => describe(value as V, lowerIR.instance));
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
  <V extends JsonValue>(
    guardType: JsonType,
    measure: (lctx: LoweringContext) => LowerExpr,
    op: "<" | "<=" | ">" | ">=",
    describe: Describe<V>,
  ) =>
  (value: JsonValue, lctx: LoweringContext): void => {
    lctx.emit(
      lowerIR.when(
        lowerIR.and(
          lowerIR.typeIs(lctx.instance, guardType),
          lowerIR.not(lowerIR.cmp(op, measure(lctx), lowerIR.constant(value))),
        ),
        [lowerIR.failDescribed(describe(value as V, lctx.instance))],
      ),
    );
  };
const arrayLengthMeasure = (lctx: LoweringContext): LowerExpr =>
  lowerIR.helper("lengthOf", lctx.instance);
const propertyCountMeasure = (lctx: LoweringContext): LowerExpr =>
  lowerIR.helper("lengthOf", lowerIR.helper("keysOf", lctx.instance));
const numberMeasure = (lctx: LoweringContext): LowerExpr => lctx.instance;

// --- the message builders ------------------------------------------------------

// `must be >= 5, got 3`.
const describeBound =
  (op: string): Describe<number> =>
  (limit, instance) => ({
    message: [`must be ${op} ${limit}, got `, shown(instance)],
    params: { limit: lowerIR.constant(limit), value: instance },
  });

// `must be at least 5 characters, got "abc" (3)`.
const describeLength =
  (phrase: string): Describe<number> =>
  (limit, instance) => {
    const length = lowerIR.helper("codePointLength", instance);
    return {
      message: [
        `must be ${phrase} ${limit} characters, got `,
        shown(instance),
        " (",
        length,
        ")",
      ],
      params: { limit: lowerIR.constant(limit), value: instance, length },
    };
  };

// `must have at least 3 items, got 1`.
const describeCount =
  (
    phrase: string,
    noun: "items" | "properties",
    count: (instance: LowerExpr) => LowerExpr,
  ): Describe<number> =>
  (limit, instance) => ({
    message: [`must have ${phrase} ${limit} ${noun}, got `, count(instance)],
    params: { limit: lowerIR.constant(limit), count: count(instance) },
  });
const itemCount = (instance: LowerExpr): LowerExpr =>
  lowerIR.helper("lengthOf", instance);
const propertyCount = (instance: LowerExpr): LowerExpr =>
  lowerIR.helper("lengthOf", lowerIR.helper("keysOf", instance));

const typeMatches = (t: JsonValue, v: JsonValue): boolean =>
  t === "integer"
    ? typeof v === "number" && Number.isInteger(v)
    : jsonTypeOf(v) === t;

const typeNames = (value: JsonValue): JsonValue[] =>
  Array.isArray(value) ? value : [value];

// `expected string, null, got 3 (integer)`.
const describeType: Describe<JsonValue[]> = (names, instance) => ({
  message: [
    "expected " +
      names
        .map((n) => (typeof n === "string" ? n : JSON.stringify(n)))
        .join(", ") +
      ", got ",
    lowerIR.helper("typedPreview", instance),
  ],
  params: {
    expected: lowerIR.constant(names),
    actual: lowerIR.helper("apparentType", instance),
    value: instance,
  },
});

// `must be one of [1, 2, 3], got 4`.
const describeEnum: Describe<JsonValue> = (value, instance) => ({
  message: [`must be one of ${preview(value)}, got `, shown(instance)],
  params: { allowedValues: lowerIR.constant(value), value: instance },
});

// `must equal {"a": 1}, got 2`.
const describeConst: Describe<JsonValue> = (value, instance) => ({
  message: [`must equal ${preview(value)}, got `, shown(instance)],
  params: { allowedValue: lowerIR.constant(value), value: instance },
});

// `must be a multiple of 3, got 7`.
const describeMultipleOf: Describe<number> = (value, instance) => ({
  message: [`must be a multiple of ${value}, got `, shown(instance)],
  params: { multipleOf: lowerIR.constant(value), value: instance },
});

// `must match pattern "^a", got "b"`.
const describePattern: Describe<string> = (value, instance) => ({
  message: [`must match pattern ${preview(value)}, got `, shown(instance)],
  params: { pattern: lowerIR.constant(value), value: instance },
});

// One error naming every missing property: `missing required properties
// "a", "c"`.
const describeRequired: Describe<readonly string[]> = (names, instance) => {
  const missing = lowerIR.helper(
    "missingNames",
    instance,
    lowerIR.constant([...names]),
  );
  return {
    message: [
      "missing required ",
      lowerIR.helper(
        "labeledNames",
        missing,
        lowerIR.constant("property"),
        lowerIR.constant("properties"),
      ),
    ],
    params: { missing },
  };
};

// Every group of equal items, by index: `items are not unique: [0, 2] are
// equal; [1, 3] are equal`. Never the items themselves, which can be
// arbitrarily large.
const describeUniqueItems = (instance: LowerExpr): Description => {
  const groups = lowerIR.helper("duplicateGroups", instance);
  return {
    message: ["items are not unique: ", lowerIR.helper("indexGroups", groups)],
    params: { duplicates: groups },
  };
};

/**
 * One error for every missing dependency (`dependentRequired`, and the
 * array members of draft-07's `dependencies`): `"a" requires "b", "c"`.
 */
export const describeDependencies: Describe<
  Readonly<Record<string, JsonValue>>
> = (spec, instance) => {
  const missing = lowerIR.helper(
    "missingDependencies",
    instance,
    lowerIR.constant(spec),
  );
  return {
    message: [lowerIR.helper("dependencyList", missing)],
    params: { missing },
  };
};

/**
 * Whether some present property's array member names an absent one; `null`
 * when no array member names anything (the lowered condition of
 * {@link describeDependencies}).
 */
export function dependencyAbsent(
  spec: Readonly<Record<string, JsonValue>>,
  instance: LowerExpr,
): LowerExpr | null {
  const pairs: LowerExpr[] = [];
  for (const [name, deps] of Object.entries(spec)) {
    if (!Array.isArray(deps)) continue;
    for (const dep of deps) {
      if (typeof dep !== "string") continue;
      pairs.push(
        lowerIR.and(
          { kind: "hasOwn", target: instance, key: name },
          lowerIR.not({ kind: "hasOwn", target: instance, key: dep }),
        ),
      );
    }
  }
  return pairs.length === 0 ? null : lowerIR.or(...pairs);
}

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
    ctx.report(() => describePattern(value as string, lowerIR.instance));
    return false;
  },
  lower: (value, lctx) => {
    lctx.emit(
      lowerIR.when(
        lowerIR.and(
          lowerIR.typeIs(lctx.instance, "string"),
          lowerIR.not(lowerIR.regexTest(value as string, lctx.instance)),
        ),
        [
          lowerIR.failDescribed(
            describePattern(value as string, lctx.instance),
          ),
        ],
      ),
    );
  },
};

/** The 2020-12 validation vocabulary's keyword behaviors, by name. */
export const validationVocabulary: Record<string, KeywordBehavior> = {
  type: {
    id: id("type"),
    evaluate: (value, cursor, ctx) => {
      const names = typeNames(value);
      if (names.some((t) => typeMatches(t, cursor.value))) return true;
      ctx.report(() => describeType(names, lowerIR.instance));
      return false;
    },
    lower: (value, lctx) => {
      const names = typeNames(value);
      const types = names as (JsonType | "integer")[];
      lctx.emit(
        lowerIR.when(lowerIR.not(lowerIR.typeIs(lctx.instance, ...types)), [
          lowerIR.failDescribed(describeType(names, lctx.instance)),
        ]),
      );
    },
  },
  enum: {
    ...assertion<JsonValue>(
      "enum",
      (value, instance) =>
        (value as JsonValue[]).some((x) => jsonEqual(x, instance)),
      describeEnum,
    ),
    lower: (value, lctx) => {
      const alternatives = value as JsonValue[];
      const fail = lowerIR.failDescribed(describeEnum(value, lctx.instance));
      // An empty enum can never match (some() over zero alternatives is
      // false); guard explicitly since lowerIR.or() with zero parts has no
      // meaningful "no alternatives matched" expression to negate.
      lctx.emit(
        alternatives.length === 0
          ? fail
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
              [fail],
            ),
      );
    },
  },
  const: {
    ...assertion<JsonValue>(
      "const",
      (value, instance) => jsonEqual(value, instance),
      describeConst,
    ),
    lower: (value, lctx) => {
      lctx.emit(
        lowerIR.when(
          lowerIR.not(
            lowerIR.helper("jsonEqual", lowerIR.constant(value), lctx.instance),
          ),
          [lowerIR.failDescribed(describeConst(value, lctx.instance))],
        ),
      );
    },
  },
  pattern,
  minLength: {
    ...assertion<number>(
      "minLength",
      (value, instance) =>
        typeof instance !== "string" || codePointLength(instance) >= value,
      describeLength("at least"),
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
          [lowerIR.failDescribed(describeLength("at least")(n, lctx.instance))],
        ),
      );
    },
  },
  maxLength: {
    ...assertion<number>(
      "maxLength",
      (value, instance) =>
        typeof instance !== "string" || codePointLength(instance) <= value,
      describeLength("at most"),
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
          [lowerIR.failDescribed(describeLength("at most")(n, lctx.instance))],
        ),
      );
    },
  },
  minimum: {
    ...assertion<number>(
      "minimum",
      (value, instance) => typeof instance !== "number" || instance >= value,
      describeBound(">="),
    ),
    lower: guardedCompare("number", numberMeasure, ">=", describeBound(">=")),
  },
  maximum: {
    ...assertion<number>(
      "maximum",
      (value, instance) => typeof instance !== "number" || instance <= value,
      describeBound("<="),
    ),
    lower: guardedCompare("number", numberMeasure, "<=", describeBound("<=")),
  },
  exclusiveMinimum: {
    ...assertion<number>(
      "exclusiveMinimum",
      (value, instance) => typeof instance !== "number" || instance > value,
      describeBound(">"),
    ),
    lower: guardedCompare("number", numberMeasure, ">", describeBound(">")),
  },
  exclusiveMaximum: {
    ...assertion<number>(
      "exclusiveMaximum",
      (value, instance) => typeof instance !== "number" || instance < value,
      describeBound("<"),
    ),
    lower: guardedCompare("number", numberMeasure, "<", describeBound("<")),
  },
  minItems: {
    ...assertion<number>(
      "minItems",
      (value, instance) => !Array.isArray(instance) || instance.length >= value,
      describeCount("at least", "items", itemCount),
    ),
    lower: guardedCompare(
      "array",
      arrayLengthMeasure,
      ">=",
      describeCount("at least", "items", itemCount),
    ),
  },
  maxItems: {
    ...assertion<number>(
      "maxItems",
      (value, instance) => !Array.isArray(instance) || instance.length <= value,
      describeCount("at most", "items", itemCount),
    ),
    lower: guardedCompare(
      "array",
      arrayLengthMeasure,
      "<=",
      describeCount("at most", "items", itemCount),
    ),
  },
  minProperties: {
    ...assertion<number>(
      "minProperties",
      (value, instance) =>
        !isObject(instance) || Object.keys(instance).length >= value,
      describeCount("at least", "properties", propertyCount),
    ),
    lower: guardedCompare(
      "object",
      propertyCountMeasure,
      ">=",
      describeCount("at least", "properties", propertyCount),
    ),
  },
  maxProperties: {
    ...assertion<number>(
      "maxProperties",
      (value, instance) =>
        !isObject(instance) || Object.keys(instance).length <= value,
      describeCount("at most", "properties", propertyCount),
    ),
    lower: guardedCompare(
      "object",
      propertyCountMeasure,
      "<=",
      describeCount("at most", "properties", propertyCount),
    ),
  },
  required: {
    id: id("required"),
    evaluate: (value, cursor, ctx) => {
      const instance = cursor.value;
      if (!isObject(instance) || !Array.isArray(value)) return true;
      const names = value.filter((n): n is string => typeof n === "string");
      if (names.every((name) => Object.hasOwn(instance, name))) return true;
      ctx.report(() => describeRequired(names, lowerIR.instance));
      return false;
    },
    lower: (value, lctx) => {
      if (!Array.isArray(value)) return;
      const names = value.filter((n): n is string => typeof n === "string");
      if (names.length === 0) return;
      lctx.emit(
        lowerIR.when(
          lowerIR.and(
            lowerIR.typeIs(lctx.instance, "object"),
            lowerIR.or(
              ...names.map((name) =>
                lowerIR.not({
                  kind: "hasOwn",
                  target: lctx.instance,
                  key: name,
                }),
              ),
            ),
          ),
          [lowerIR.failDescribed(describeRequired(names, lctx.instance))],
        ),
      );
    },
  },
  multipleOf: {
    ...assertion<number>(
      "multipleOf",
      (value, instance) =>
        typeof instance !== "number" || isMultipleOf(instance, value),
      describeMultipleOf,
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
          [
            lowerIR.failDescribed(
              describeMultipleOf(value as number, lctx.instance),
            ),
          ],
        ),
      );
    },
  },
  uniqueItems: {
    id: id("uniqueItems"),
    evaluate: (value, cursor, ctx) => {
      if (value !== true || !Array.isArray(cursor.value)) return true;
      if (!hasDuplicateItems(cursor.value)) return true;
      ctx.report(() => describeUniqueItems(lowerIR.instance));
      return false;
    },
    // evaluate() returns true (vacuously) whenever `value !== true` — mirror
    // that by emitting nothing at all when the keyword value isn't literally
    // `true`. The groups are computed only on the failure path (D9e), so
    // the duplicate scan's cost is not doubled for valid data.
    lower: (value, lctx) => {
      if (value !== true) return;
      lctx.emit(
        lowerIR.when(
          lowerIR.and(
            lowerIR.typeIs(lctx.instance, "array"),
            lowerIR.helper("hasDuplicateItems", lctx.instance),
          ),
          [lowerIR.failDescribed(describeUniqueItems(lctx.instance))],
        ),
      );
    },
  },
  dependentRequired: {
    id: id("dependentRequired"),
    evaluate: (value, cursor, ctx) => {
      const instance = cursor.value;
      if (!isObject(instance) || !isObject(value)) return true;
      if (Object.keys(missingDependencies(instance, value)).length === 0) {
        return true;
      }
      ctx.report(() => describeDependencies(value, lowerIR.instance));
      return false;
    },
    lower: (value, lctx) => {
      if (!isObject(value)) return;
      const absent = dependencyAbsent(value, lctx.instance);
      if (absent === null) return;
      lctx.emit(
        lowerIR.when(
          lowerIR.and(lowerIR.typeIs(lctx.instance, "object"), absent),
          [lowerIR.failDescribed(describeDependencies(value, lctx.instance))],
        ),
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
