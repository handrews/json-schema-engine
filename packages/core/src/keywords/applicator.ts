// Applicator vocabulary.
//
// EXEMPLARS: `anyOf` (in-place applicator class — subschemas applied at the
// same cursor; see engine.ts for channel merge/discard semantics) and
// `properties` (child applicator class — child cursors, produces its
// evaluated-name annotation).

import { JsonValue, isObject } from "../json.js";
import {
  KeywordBehavior,
  StaticFacts,
  SubschemaApplication,
} from "../dialect.js";
import { childCursor } from "../cursor.js";
import { LowerExpr, lowerIR } from "../lowering.js";
import { SELF, mapPositions } from "./core.js";

/** 2020-12 applicator vocabulary URI. */
export const VOCAB_APPLICATOR =
  "https://json-schema.org/draft/2020-12/vocab/applicator";

const id = (name: string): string => `${VOCAB_APPLICATOR}#${name}`;

// Facts helpers (D9a/planner edges). `conditional` marks alternatives whose
// application depends on runtime branching, not merely instance shape.
const arrayPositions = (value: JsonValue, conditional = false): StaticFacts =>
  Array.isArray(value)
    ? {
        subschemas: value.map((_, i) => [i]),
        applications: value.map((_, i): SubschemaApplication => ({
          path: [i],
          mode: "inPlace",
          conditional,
          asserts: true,
        })),
      }
    : {};
const selfPosition = (): StaticFacts => SELF;
const selfApplication = (
  mode: SubschemaApplication["mode"],
  conditional: boolean,
  asserts: boolean,
): StaticFacts => ({
  ...SELF,
  applications: [{ path: [], mode, conditional, asserts }],
});

/** `allOf`: every subschema must match, at the same cursor. */
export const allOf: KeywordBehavior = {
  id: id("allOf"),
  analyze: (value) => arrayPositions(value),
  lower: (value, lctx) => {
    (value as JsonValue[]).forEach((_, i) => {
      lctx.emit({
        kind: "apply",
        apply: { path: [i], cursor: { kind: "here" }, fold: "allMustPass" },
      });
    });
  },
  evaluate: (value, cursor, ctx) => {
    let ok = true;
    (value as JsonValue[]).forEach((_, i) => {
      if (!ctx.apply(["allOf", i], cursor)) ok = false;
    });
    return ok;
  },
};

/** EXEMPLAR (in-place applicator class): every branch runs, even after a match (DESIGN.md §4 rule 6; see engine.ts). */
export const anyOf: KeywordBehavior = {
  id: id("anyOf"),
  analyze: (value) => arrayPositions(value, true),
  lower: (value, lctx) => {
    const schemas = value as JsonValue[];
    // An empty anyOf can never match (evaluate()'s `ok` starts false and no
    // iteration can flip it) — keywordStatements only emits a check when it
    // sees at least one anyMayPass apply, so the empty case needs its own
    // unconditional failure.
    if (schemas.length === 0) {
      lctx.emit(lowerIR.fail("no branch matched"));
      return;
    }
    schemas.forEach((_, i) => {
      lctx.emit({
        kind: "apply",
        apply: { path: [i], cursor: { kind: "here" }, fold: "anyMayPass" },
      });
    });
    lctx.emit({ kind: "combineCheck", message: ["no branch matched"] });
  },
  evaluate: (value, cursor, ctx) => {
    let ok = false;
    (value as JsonValue[]).forEach((_, i) => {
      if (ctx.apply(["anyOf", i], cursor)) ok = true;
    });
    // Mutated inside the forEach closure above; the checker doesn't track that
    // reassignment for a read after the callback returns.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (!ok) ctx.error("no branch matched");
    return ok;
  },
};

/** `oneOf`: exactly one subschema must match, at the same cursor. */
export const oneOf: KeywordBehavior = {
  id: id("oneOf"),
  analyze: (value) => arrayPositions(value, true),
  lower: (value, lctx) => {
    const schemas = value as JsonValue[];
    // An empty oneOf can never match exactly one branch (count stays 0) —
    // same empty-run gap as anyOf above.
    if (schemas.length === 0) {
      lctx.emit(lowerIR.fail("matched 0 branches, expected exactly 1"));
      return;
    }
    schemas.forEach((_, i) => {
      lctx.emit({
        kind: "apply",
        apply: { path: [i], cursor: { kind: "here" }, fold: "exactlyOne" },
      });
    });
    lctx.emit({
      kind: "combineCheck",
      message: ["matched ", { kind: "tally" }, " branches, expected exactly 1"],
    });
  },
  evaluate: (value, cursor, ctx) => {
    let count = 0;
    (value as JsonValue[]).forEach((_, i) => {
      if (ctx.apply(["oneOf", i], cursor)) count++;
    });
    if (count !== 1) ctx.error(`matched ${count} branches, expected exactly 1`);
    return count === 1;
  },
};

/** `not`: the subschema must not match. */
export const not: KeywordBehavior = {
  id: id("not"),
  analyze: () => ({
    ...SELF,
    applications: [
      // inverted: success fails `not`, so this edge never contributes
      // evaluated-coverage on the parent-success path (D9a).
      {
        path: [],
        mode: "inPlace",
        conditional: false,
        asserts: true,
        inverted: true,
      },
    ],
  }),
  lower: (_value, lctx) => {
    lctx.emit({
      kind: "apply",
      apply: {
        path: [],
        cursor: { kind: "here" },
        fold: "negate",
        message: ["must not match the subschema"],
      },
    });
  },
  evaluate: (_value, cursor, ctx) => {
    if (!ctx.apply(["not"], cursor)) return true;
    ctx.error("must not match the subschema");
    return false;
  },
};

/**
 * `if`: drives `then`/`else`, which are inert on their own — their own
 * behaviors exist only so the registration walk identifies `$id`/`$anchor`
 * inside them.
 */
export const ifKeyword: KeywordBehavior = {
  id: id("if"),
  // `if` owns the application of its inert siblings (`then`/`else` behaviors
  // only mark walk positions) — the sibling-context exemplar for analyze().
  analyze: (_value, context) => {
    const applications: SubschemaApplication[] = [
      { path: [], mode: "inPlace", conditional: false, asserts: false },
    ];
    for (const branch of ["then", "else"] as const) {
      if (context && Object.hasOwn(context.schema, branch)) {
        applications.push({
          path: [],
          sibling: branch,
          mode: "inPlace",
          conditional: true,
          asserts: true,
        });
      }
    }
    return { ...SELF, applications };
  },
  lower: (_value, lctx) => {
    const hasThen = Object.hasOwn(lctx.schema, "then");
    const hasElse = Object.hasOwn(lctx.schema, "else");
    const condition: LowerExpr = {
      kind: "applyExpr",
      apply: { path: [], cursor: { kind: "here" }, fold: "discard" },
    };
    lctx.emit(
      lowerIR.when(
        condition,
        hasThen
          ? [
              {
                kind: "apply",
                apply: {
                  path: [],
                  sibling: "then",
                  cursor: { kind: "here" },
                  fold: "allMustPass",
                },
              },
            ]
          : [],
        hasElse
          ? [
              {
                kind: "apply",
                apply: {
                  path: [],
                  sibling: "else",
                  cursor: { kind: "here" },
                  fold: "allMustPass",
                },
              },
            ]
          : [],
      ),
    );
  },
  evaluate: (_value, cursor, ctx) => {
    const condition = ctx.apply(["if"], cursor);
    if (condition && Object.hasOwn(ctx.schema, "then"))
      return ctx.apply(["then"], cursor);
    if (!condition && Object.hasOwn(ctx.schema, "else"))
      return ctx.apply(["else"], cursor);
    return true;
  },
};

/** `dependentSchemas`: applies a named subschema when the property is present. */
export const dependentSchemas: KeywordBehavior = {
  id: id("dependentSchemas"),
  analyze: (value) => ({
    ...mapPositions(value),
    applications: isObject(value)
      ? Object.keys(value).map((k): SubschemaApplication => ({
          path: [k],
          mode: "inPlace",
          conditional: true,
          asserts: true,
        }))
      : [],
  }),
  lower: (value, lctx) => {
    if (!isObject(value)) return;
    lctx.emit(
      lowerIR.when(lowerIR.typeIs(lctx.instance, "object"), [
        ...Object.keys(value).map((k) =>
          lowerIR.when({ kind: "hasOwn", target: lctx.instance, key: k }, [
            {
              kind: "apply",
              apply: {
                path: [k],
                cursor: { kind: "here" },
                fold: "allMustPass",
              },
            },
          ]),
        ),
      ]),
    );
  },
  evaluate: (value, cursor, ctx) => {
    if (!isObject(cursor.value)) return true;
    let ok = true;
    for (const name of Object.keys(value as Record<string, JsonValue>)) {
      if (
        Object.hasOwn(cursor.value, name) &&
        !ctx.apply(["dependentSchemas", name], cursor)
      ) {
        ok = false;
      }
    }
    return ok;
  },
};

/** EXEMPLAR (child applicator class): child cursors, produces the matched property names. */
export const properties: KeywordBehavior = {
  id: id("properties"),
  analyze: (value) => ({
    ...mapPositions(value),
    produces: [id("properties")],
    evaluatesNames: isObject(value)
      ? { kind: "names", names: Object.keys(value) }
      : { kind: "names", names: [] },
    applications: isObject(value)
      ? Object.keys(value).map((k): SubschemaApplication => ({
          path: [k],
          mode: "childByKey",
          conditional: false,
          asserts: true,
        }))
      : [],
  }),
  lower: (value, lctx) => {
    if (!isObject(value)) return;
    for (const name of Object.keys(value)) {
      lctx.emit(
        lowerIR.when(
          lowerIR.and(lowerIR.typeIs(lctx.instance, "object"), {
            kind: "hasOwn",
            target: lctx.instance,
            key: name,
          }),
          [
            {
              kind: "apply",
              apply: {
                path: [name],
                cursor: { kind: "child", of: { kind: "here" }, segment: name },
                fold: "allMustPass",
              },
            },
          ],
        ),
      );
    }
    lctx.emit({ kind: "produce", value: { kind: "collectedNames" } });
  },
  evaluate: (value, cursor, ctx) => {
    if (!isObject(cursor.value)) return true;
    let ok = true;
    const matched: string[] = [];
    for (const name of Object.keys(value as Record<string, JsonValue>)) {
      if (Object.hasOwn(cursor.value, name)) {
        matched.push(name);
        if (
          !ctx.apply(
            ["properties", name],
            childCursor(cursor, name, cursor.value[name]!),
          )
        )
          ok = false;
      }
    }
    ctx.produce(matched);
    return ok;
  },
};

/** `patternProperties`: applies to properties whose name matches a pattern; produces the matched names. */
export const patternProperties: KeywordBehavior = {
  id: id("patternProperties"),
  // Property-name patterns are declared as regexes so `rejectUnsafeRegex`
  // can screen them at registration (see regex.ts).
  analyze: (value) => ({
    ...mapPositions(value),
    regexes: isObject(value) ? Object.keys(value) : [],
    produces: [id("patternProperties")],
    evaluatesNames: {
      kind: "patterns",
      patterns: isObject(value) ? Object.keys(value) : [],
    },
    applications: isObject(value)
      ? Object.keys(value).map((k): SubschemaApplication => ({
          path: [k],
          mode: "childSweep",
          conditional: false,
          asserts: true,
        }))
      : [],
  }),
  lower: (value, lctx) => {
    if (!isObject(value)) return;
    for (const pattern of Object.keys(value)) {
      const b = lctx.binding();
      lctx.emit(
        lowerIR.when(lowerIR.typeIs(lctx.instance, "object"), [
          {
            kind: "forEachKey",
            target: lctx.instance,
            binding: b,
            body: [
              lowerIR.when(
                lowerIR.regexTest(pattern, { kind: "binding", id: b }),
                [
                  {
                    kind: "apply",
                    apply: {
                      path: [pattern],
                      cursor: {
                        kind: "child",
                        of: { kind: "here" },
                        segment: { kind: "binding", id: b },
                      },
                      fold: "allMustPass",
                    },
                  },
                ],
              ),
            ],
          },
        ]),
      );
    }
    lctx.emit({ kind: "produce", value: { kind: "collectedNames" } });
  },
  evaluate: (value, cursor, ctx) => {
    if (!isObject(cursor.value)) return true;
    let ok = true;
    const matched = new Set<string>();
    for (const pattern of Object.keys(value as Record<string, JsonValue>)) {
      const re = ctx.compileRegex(pattern);
      for (const name of Object.keys(cursor.value)) {
        if (re.test(name)) {
          matched.add(name);
          if (
            !ctx.apply(
              ["patternProperties", pattern],
              childCursor(cursor, name, cursor.value[name]!),
            )
          )
            ok = false;
        }
      }
    }
    ctx.produce([...matched]);
    return ok;
  },
};

/**
 * `additionalProperties`: applies to properties not matched by sibling
 * `properties`/`patternProperties` — statically derivable from the schema
 * object, no channel involvement (contrast `unevaluatedProperties`).
 */
export const additionalProperties: KeywordBehavior = {
  id: id("additionalProperties"),
  // Post-success, the sibling trio covers every present name (D9a "all").
  analyze: () => ({
    ...selfApplication("childSweep", false, true),
    produces: [id("additionalProperties")],
    evaluatesNames: { kind: "all" },
  }),
  lower: (_value, lctx) => {
    const names = isObject(lctx.schema.properties)
      ? Object.keys(lctx.schema.properties)
      : [];
    const patterns = isObject(lctx.schema.patternProperties)
      ? Object.keys(lctx.schema.patternProperties)
      : [];
    const b = lctx.binding();
    const covered: LowerExpr[] = [
      ...names.map((n): LowerExpr =>
        lowerIR.cmp("===", { kind: "binding", id: b }, lowerIR.constant(n)),
      ),
      ...patterns.map((p): LowerExpr =>
        lowerIR.regexTest(p, { kind: "binding", id: b }),
      ),
    ];
    lctx.emit(
      lowerIR.when(lowerIR.typeIs(lctx.instance, "object"), [
        {
          kind: "forEachKey",
          target: lctx.instance,
          binding: b,
          body: [
            lowerIR.when(
              covered.length === 0
                ? lowerIR.constant(true)
                : lowerIR.not(lowerIR.or(...covered)),
              [
                {
                  kind: "apply",
                  apply: {
                    path: [],
                    cursor: {
                      kind: "child",
                      of: { kind: "here" },
                      segment: { kind: "binding", id: b },
                    },
                    fold: "allMustPass",
                  },
                },
              ],
            ),
          ],
        },
      ]),
    );
    lctx.emit({ kind: "produce", value: { kind: "collectedNames" } });
  },
  evaluate: (_value, cursor, ctx) => {
    if (!isObject(cursor.value)) return true;
    const names = isObject(ctx.schema.properties)
      ? new Set(Object.keys(ctx.schema.properties))
      : new Set<string>();
    const patterns = isObject(ctx.schema.patternProperties)
      ? Object.keys(ctx.schema.patternProperties).map((p) =>
          ctx.compileRegex(p),
        )
      : [];
    let ok = true;
    const matched: string[] = [];
    for (const name of Object.keys(cursor.value)) {
      if (names.has(name) || patterns.some((re) => re.test(name))) continue;
      matched.push(name);
      if (
        !ctx.apply(
          ["additionalProperties"],
          childCursor(cursor, name, cursor.value[name]!),
        )
      )
        ok = false;
    }
    ctx.produce(matched);
    return ok;
  },
};

/** `prefixItems`: applies each subschema to the array item at its index; produces the largest applied index. */
export const prefixItems: KeywordBehavior = {
  id: id("prefixItems"),
  analyze: (value) => ({
    ...arrayPositions(value),
    produces: [id("prefixItems")],
    evaluatesIndexes: {
      kind: "prefix",
      count: Array.isArray(value) ? value.length : 0,
    },
    applications: Array.isArray(value)
      ? value.map((_, i): SubschemaApplication => ({
          path: [i],
          mode: "childByIndex",
          conditional: false,
          asserts: true,
        }))
      : [],
  }),
  lower: (value, lctx) => {
    if (!Array.isArray(value)) return;
    value.forEach((_, i) => {
      lctx.emit(
        lowerIR.when(
          lowerIR.and(
            lowerIR.typeIs(lctx.instance, "array"),
            lowerIR.cmp(
              ">",
              lowerIR.helper("lengthOf", lctx.instance),
              lowerIR.constant(i),
            ),
          ),
          [
            {
              kind: "apply",
              apply: {
                path: [i],
                cursor: { kind: "child", of: { kind: "here" }, segment: i },
                fold: "allMustPass",
              },
            },
          ],
        ),
      );
    });
    lctx.emit({ kind: "produce", value: { kind: "collectedIndexes" } });
  },
  evaluate: (value, cursor, ctx) => {
    if (!Array.isArray(cursor.value)) return true;
    const schemas = value as JsonValue[];
    const n = Math.min(schemas.length, cursor.value.length);
    let ok = true;
    for (let i = 0; i < n; i++) {
      if (
        !ctx.apply(["prefixItems", i], childCursor(cursor, i, cursor.value[i]!))
      )
        ok = false;
    }
    // Annotation: largest applied index, or true when it covered the array.
    if (n > 0) ctx.produce(n === cursor.value.length ? true : n - 1);
    return ok;
  },
};

/** `items`: applies to array items past sibling `prefixItems`; produces `true` when it applied to any item. */
export const items: KeywordBehavior = {
  id: id("items"),
  // Coverage starts after the sibling prefixItems — the same read
  // evaluate() performs through ctx.schema, statically (AnalyzeContext).
  analyze: (_value, context) => ({
    ...selfApplication("childSweep", false, true),
    produces: [id("items")],
    evaluatesIndexes: {
      kind: "allFrom",
      start: Array.isArray(context?.schema.prefixItems)
        ? context.schema.prefixItems.length
        : 0,
    },
  }),
  lower: (_value, lctx) => {
    const start = Array.isArray(lctx.schema.prefixItems)
      ? lctx.schema.prefixItems.length
      : 0;
    const b = lctx.binding();
    lctx.emit(
      lowerIR.when(lowerIR.typeIs(lctx.instance, "array"), [
        {
          kind: "forEachIndex",
          target: lctx.instance,
          binding: b,
          start,
          body: [
            {
              kind: "apply",
              apply: {
                path: [],
                cursor: {
                  kind: "child",
                  of: { kind: "here" },
                  segment: { kind: "binding", id: b },
                },
                fold: "allMustPass",
              },
            },
          ],
        },
      ]),
    );
    lctx.emit({ kind: "produce", value: { kind: "collectedIndexes" } });
  },
  evaluate: (_value, cursor, ctx) => {
    if (!Array.isArray(cursor.value)) return true;
    // Applies past the sibling prefixItems (statically known per spec).
    const start = Array.isArray(ctx.schema.prefixItems)
      ? ctx.schema.prefixItems.length
      : 0;
    let ok = true;
    let applied = false;
    for (let i = start; i < cursor.value.length; i++) {
      applied = true;
      if (!ctx.apply(["items"], childCursor(cursor, i, cursor.value[i]!)))
        ok = false;
    }
    if (applied) ctx.produce(true);
    return ok;
  },
};

/**
 * `contains`: at least one array item must match (range configurable by
 * sibling `minContains`/`maxContains`); produces matched indexes.
 */
export const contains: KeywordBehavior = {
  id: id("contains"),
  // Per-item probes don't individually assert (the count does), and which
  // indexes end up evaluated is instance-dependent: coverage is dynamic.
  analyze: () => ({
    ...selfApplication("childSweep", false, false),
    produces: [id("contains")],
    evaluatesIndexes: { kind: "dynamic" },
  }),
  lower: (_value, lctx) => {
    const min =
      typeof lctx.schema.minContains === "number" ? lctx.schema.minContains : 1;
    const max =
      typeof lctx.schema.maxContains === "number"
        ? lctx.schema.maxContains
        : Infinity;
    const b = lctx.binding();
    lctx.emit(
      lowerIR.when(lowerIR.typeIs(lctx.instance, "array"), [
        {
          kind: "countRange",
          target: lctx.instance,
          binding: b,
          countWhen: {
            kind: "applyExpr",
            apply: {
              path: [],
              cursor: {
                kind: "child",
                of: { kind: "here" },
                segment: { kind: "binding", id: b },
              },
              fold: "discard",
            },
          },
          min,
          max,
          // Mirrors evaluate()'s text exactly (list-mode parity): the
          // tally placeholder binds to the runtime match count.
          outOfRangeMessage: [
            { kind: "tally" },
            ` item(s) match the contains subschema, expected ${min}-${max}`,
          ],
        },
      ]),
    );
    lctx.emit({ kind: "produce", value: { kind: "collectedIndexes" } });
  },
  evaluate: (_value, cursor, ctx) => {
    if (!Array.isArray(cursor.value)) return true;
    const matched: number[] = [];
    for (let i = 0; i < cursor.value.length; i++) {
      if (ctx.apply(["contains"], childCursor(cursor, i, cursor.value[i]!)))
        matched.push(i);
    }
    // minContains/maxContains are inert siblings (validation.ts) that turn
    // the count into a range assertion instead of contains' own >=1 default;
    // minContains: 0 with zero matches is valid (suite: "minContains = 0").
    const min =
      typeof ctx.schema.minContains === "number" ? ctx.schema.minContains : 1;
    const max =
      typeof ctx.schema.maxContains === "number"
        ? ctx.schema.maxContains
        : Infinity;
    if (matched.length < min || matched.length > max) {
      ctx.error(
        `${matched.length} item(s) match the contains subschema, expected ${min}-${max}`,
      );
      return false;
    }
    // Annotation: matched indexes, or true when every item matched.
    if (matched.length > 0)
      ctx.produce(matched.length === cursor.value.length ? true : matched);
    return true;
  },
};

/**
 * `propertyNames`: applies the subschema to each property name (as a string
 * instance), not to the object itself.
 */
export const propertyNames: KeywordBehavior = {
  id: id("propertyNames"),
  analyze: () => ({
    ...SELF,
    applications: [
      { path: [], mode: "propertyName", conditional: false, asserts: true },
    ],
  }),
  lower: (_value, lctx) => {
    const b = lctx.binding();
    lctx.emit(
      lowerIR.when(lowerIR.typeIs(lctx.instance, "object"), [
        {
          kind: "forEachKey",
          target: lctx.instance,
          binding: b,
          body: [
            {
              kind: "apply",
              apply: {
                path: [],
                cursor: { kind: "key", binding: b },
                fold: "allMustPass",
              },
            },
          ],
        },
      ]),
    );
  },
  evaluate: (_value, cursor, ctx) => {
    if (!isObject(cursor.value)) return true;
    let ok = true;
    for (const name of Object.keys(cursor.value)) {
      if (!ctx.apply(["propertyNames"], childCursor(cursor, name, name)))
        ok = false;
    }
    return ok;
  },
};

/** The 2020-12 applicator vocabulary's keyword behaviors, by name. */
export const applicatorVocabulary: Record<string, KeywordBehavior> = {
  allOf,
  anyOf,
  oneOf,
  not,
  if: ifKeyword,
  then: {
    id: id("then"),
    analyze: selfPosition,
    evaluate: () => true,
    lower: () => {
      /* if owns the application of this sibling */
    },
  },
  else: {
    id: id("else"),
    analyze: selfPosition,
    evaluate: () => true,
    lower: () => {
      /* if owns the application of this sibling */
    },
  },
  dependentSchemas,
  properties,
  patternProperties,
  additionalProperties,
  prefixItems,
  items,
  contains,
  propertyNames,
};
