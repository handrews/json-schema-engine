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
import { Description, LowerExpr, LowerStmt, lowerIR } from "../lowering.js";
import { indexRanges, nameList } from "../messages.js";
import { SELF, mapPositions } from "./core.js";
import {
  dependentsRejected,
  isFalse,
  namesRejected,
  positionsRejected,
  tailRejected,
} from "./rejects.js";

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
const selfApplication = (
  mode: SubschemaApplication["mode"],
  conditional: boolean,
  asserts: boolean,
): StaticFacts => ({
  ...SELF,
  applications: [{ path: [], mode, conditional, asserts }],
});

// A rejected-key list the lowered form binds (a rejectScope's `list`).
const listOf = (list: number): LowerExpr => ({ kind: "binding", id: list });

// The indexes of the `false` members of a subschema array.
const falseIndexes = (schemas: readonly JsonValue[]): number[] =>
  schemas.flatMap((schema, i) => (isFalse(schema) ? [i] : []));

// `allOf branch 1 is false`: the indexes are schema constants, so the whole
// description is known when the keyword is built.
const describeAllOfFalse = (failed: readonly number[]): Description => ({
  message: [
    failed.length === 1
      ? `allOf branch ${failed[0]} is false`
      : `allOf branches ${indexRanges(failed)} are false`,
  ],
  params: { failed: lowerIR.constant([...failed]) },
});

/** `allOf`: every subschema must match, at the same cursor. */
export const allOf: KeywordBehavior = {
  id: id("allOf"),
  analyze: (value) => arrayPositions(value),
  lower: (value, lctx) => {
    const schemas = value as JsonValue[];
    schemas.forEach((schema, i) => {
      if (isFalse(schema)) return;
      lctx.emit({
        kind: "apply",
        apply: { path: [i], cursor: { kind: "here" }, fold: "allMustPass" },
      });
    });
    // A `false` branch explains nothing, so allOf names it instead of
    // applying it (rejects.ts), after the branches that did apply.
    const failed = falseIndexes(schemas);
    if (failed.length > 0)
      lctx.emit(lowerIR.failDescribed(describeAllOfFalse(failed)));
  },
  evaluate: (value, cursor, ctx) => {
    const schemas = value as JsonValue[];
    let ok = true;
    schemas.forEach((schema, i) => {
      if (!isFalse(schema) && !ctx.apply(["allOf", i], cursor)) ok = false;
    });
    const failed = falseIndexes(schemas);
    if (failed.length > 0) {
      ctx.report(() => describeAllOfFalse(failed));
      ok = false;
    }
    return ok;
  },
};

// Which branches failed would say nothing new: all of them did, and each
// reported why.
const describeAnyOf = (count: number): Description => ({
  message: [
    count === 1
      ? "does not match the anyOf branch"
      : `does not match any of the ${count} anyOf branches`,
  ],
});

/** EXEMPLAR (in-place applicator class): every branch runs, even after a match (DESIGN.md §4 rule 6; see engine.ts). */
export const anyOf: KeywordBehavior = {
  id: id("anyOf"),
  analyze: (value) => arrayPositions(value, true),
  lower: (value, lctx) => {
    const schemas = value as JsonValue[];
    // An empty anyOf can never match, and keywordStatements only closes a
    // run that holds at least one anyMayPass apply: the failure is constant.
    if (schemas.length === 0) {
      lctx.emit(lowerIR.failDescribed(describeAnyOf(0)));
      return;
    }
    schemas.forEach((_, i) => {
      lctx.emit({
        kind: "apply",
        apply: { path: [i], cursor: { kind: "here" }, fold: "anyMayPass" },
      });
    });
    lctx.emit({
      kind: "combineCheck",
      message: describeAnyOf(schemas.length).message,
    });
  },
  evaluate: (value, cursor, ctx) => {
    const schemas = value as JsonValue[];
    let ok = false;
    schemas.forEach((_, i) => {
      if (ctx.apply(["anyOf", i], cursor)) ok = true;
    });
    // Mutated inside the forEach closure above; the checker doesn't track that
    // reassignment for a read after the callback returns.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (!ok) ctx.report(() => describeAnyOf(schemas.length));
    return ok;
  },
};

// `matched 2 branches (0, 2), expected exactly 1 of 3`.
const describeOneOf = (count: number, passing: LowerExpr): Description => ({
  message: [
    "matched ",
    lowerIR.helper(
      "countedIndexes",
      passing,
      lowerIR.constant("branch"),
      lowerIR.constant("branches"),
    ),
    `, expected exactly 1 of ${count}`,
  ],
  params: { passing },
});

/** `oneOf`: exactly one subschema must match, at the same cursor. */
export const oneOf: KeywordBehavior = {
  id: id("oneOf"),
  analyze: (value) => arrayPositions(value, true),
  lower: (value, lctx) => {
    const schemas = value as JsonValue[];
    // An empty oneOf can never match exactly one branch, and the run has
    // no apply to bind its passing list from: the failure is constant.
    if (schemas.length === 0) {
      lctx.emit(lowerIR.failDescribed(describeOneOf(0, lowerIR.constant([]))));
      return;
    }
    schemas.forEach((_, i) => {
      lctx.emit({
        kind: "apply",
        apply: { path: [i], cursor: { kind: "here" }, fold: "exactlyOne" },
      });
    });
    const { message, params } = describeOneOf(schemas.length, {
      kind: "tallyList",
    });
    lctx.emit({ kind: "combineCheck", message, params });
  },
  evaluate: (value, cursor, ctx) => {
    const schemas = value as JsonValue[];
    const passing: number[] = [];
    schemas.forEach((_, i) => {
      if (ctx.apply(["oneOf", i], cursor)) passing.push(i);
    });
    if (passing.length !== 1)
      ctx.report(() =>
        describeOneOf(schemas.length, lowerIR.constant(passing)),
      );
    return passing.length === 1;
  },
};

const describeNot: Description = { message: ["must not match the subschema"] };

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
        message: describeNot.message,
      },
    });
  },
  evaluate: (_value, cursor, ctx) => {
    if (!ctx.apply(["not"], cursor)) return true;
    ctx.report(() => describeNot);
    return false;
  },
};

/**
 * `if`: applies its subschema and communicates the outcome to `then`/`else`
 * as dependency data (draft-03 Appendix D); the keyword itself always
 * accepts, so a rejecting condition's errors are irrelevant (§12.2). The
 * compiled form realizes the dependency structurally — the hoisted condition
 * selects the sibling apply — so `then`/`else` lower nothing and the planner
 * edges for both branches are declared here.
 */
export const ifKeyword: KeywordBehavior = {
  id: id("if"),
  // The sibling-context exemplar for analyze(): the branch edges depend on
  // which siblings are present.
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
    return { ...SELF, produces: [id("if")], applications };
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
    ctx.produce(ctx.apply(["if"], cursor));
    return true;
  },
};

/**
 * `then` / `else`: consume `if`'s outcome; the selected branch applies its
 * subschema and reports that verdict as its own, the other is inert. Without
 * a sibling `if` there is no outcome and the keyword accepts.
 */
export const conditionalBranch = (
  branchId: string,
  name: "then" | "else",
  when: boolean,
): KeywordBehavior => ({
  id: branchId,
  analyze: () => ({ ...SELF, consumes: [id("if")] }),
  lower: () => {
    /* if's lowering applies this sibling on the hoisted outcome */
  },
  evaluate: (_value, cursor, ctx) => {
    const outcome = ctx.visible([id("if")], "adjacent");
    if (outcome.length === 0 || outcome[0]!.data !== when) return true;
    return ctx.apply([name], cursor);
  },
});

export const thenKeyword: KeywordBehavior = conditionalBranch(
  id("then"),
  "then",
  true,
);
export const elseKeyword: KeywordBehavior = conditionalBranch(
  id("else"),
  "else",
  false,
);

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
    const names = Object.keys(value);
    const r = names.some((k) => isFalse(value[k]!)) ? lctx.binding() : null;
    const present = (k: string): LowerExpr => ({
      kind: "hasOwn",
      target: lctx.instance,
      key: k,
    });
    const applies = names
      .filter((k) => !isFalse(value[k]!))
      .map((k) =>
        lowerIR.when(present(k), [
          {
            kind: "apply",
            apply: {
              path: [k],
              cursor: { kind: "here" },
              fold: "allMustPass",
            },
          },
        ]),
      );
    // A `false` dependency is never applied: a present trigger is rejected
    // and the triggers named in one error after the applied siblings.
    const rejects =
      r === null
        ? []
        : [
            lowerIR.rejectScope(
              r,
              names
                .filter((k) => isFalse(value[k]!))
                .map((k) =>
                  lowerIR.when(present(k), [
                    lowerIR.reject(r, lowerIR.constant(k)),
                  ]),
                ),
              dependentsRejected("dependentSchemas", listOf(r)),
            ),
          ];
    lctx.emit(
      lowerIR.when(lowerIR.typeIs(lctx.instance, "object"), [
        ...applies,
        ...rejects,
      ]),
    );
  },
  evaluate: (value, cursor, ctx) => {
    if (!isObject(cursor.value)) return true;
    let ok = true;
    const rejected: JsonValue[] = [];
    for (const [name, schema] of Object.entries(
      value as Record<string, JsonValue>,
    )) {
      if (!Object.hasOwn(cursor.value, name)) continue;
      if (isFalse(schema)) rejected.push(name);
      else if (!ctx.apply(["dependentSchemas", name], cursor)) ok = false;
    }
    if (rejected.length > 0) {
      ctx.report(() =>
        dependentsRejected("dependentSchemas", lowerIR.constant(rejected)),
      );
      ok = false;
    }
    return ok;
  },
};

// `property "a" not allowed`: the present names whose member is `false`.
const describeForbidden = (names: LowerExpr): Description =>
  namesRejected("", " not allowed", names);

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
    const r = Object.values(value).some(isFalse) ? lctx.binding() : null;
    const sweep = Object.keys(value).map((name) =>
      lowerIR.when(
        lowerIR.and(lowerIR.typeIs(lctx.instance, "object"), {
          kind: "hasOwn",
          target: lctx.instance,
          key: name,
        }),
        [
          r !== null && isFalse(value[name]!)
            ? lowerIR.reject(r, lowerIR.constant(name))
            : {
                kind: "apply",
                apply: {
                  path: [name],
                  cursor: {
                    kind: "child",
                    of: { kind: "here" },
                    segment: name,
                  },
                  fold: "allMustPass",
                },
              },
        ],
      ),
    );
    // A `false` member is never applied: the present names whose member is
    // false are reported once, after the members that did apply.
    lctx.emit(
      ...(r === null
        ? sweep
        : [lowerIR.rejectScope(r, sweep, describeForbidden(listOf(r)))]),
    );
    // Produce iff the instance is an object (an empty array otherwise), matching
    // evaluate()'s object-type guard before ctx.produce.
    lctx.emit(
      lowerIR.when(lowerIR.typeIs(lctx.instance, "object"), [
        { kind: "produce", value: { kind: "collectedNames" } },
      ]),
    );
  },
  evaluate: (value, cursor, ctx) => {
    if (!isObject(cursor.value)) return true;
    let ok = true;
    const matched: string[] = [];
    const rejected: JsonValue[] = [];
    for (const [name, schema] of Object.entries(
      value as Record<string, JsonValue>,
    )) {
      if (!Object.hasOwn(cursor.value, name)) continue;
      matched.push(name);
      if (isFalse(schema)) rejected.push(name);
      else if (
        !ctx.apply(
          ["properties", name],
          childCursor(cursor, name, cursor.value[name]!),
        )
      )
        ok = false;
    }
    if (rejected.length > 0) {
      ctx.report(() => describeForbidden(lowerIR.constant(rejected)));
      ok = false;
    }
    // Dependency data comes only from an accepting keyword (draft-03
    // Appendix D): a rejecting producer communicates nothing.
    if (ok) ctx.produce(matched);
    return ok;
  },
};

// The patterns whose member is `false`, in keyword order.
const forbiddenPatterns = (value: Record<string, JsonValue>): string[] =>
  Object.keys(value).filter((pattern) => isFalse(value[pattern]!));

// `properties "xa" matching "^x" not allowed`.
const describeForbiddenPatterns = (
  patterns: readonly string[],
  names: LowerExpr,
): Description =>
  namesRejected("", ` matching ${nameList([...patterns])} not allowed`, names, {
    patterns: lowerIR.constant([...patterns]),
  });

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
    const forbidden = forbiddenPatterns(value);
    for (const pattern of Object.keys(value)) {
      if (isFalse(value[pattern]!)) continue;
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
    if (forbidden.length > 0) {
      const r = lctx.binding();
      // Pattern-major, as evaluate() sweeps, and each name once even when
      // two `false` patterns match it: a later pattern rejects a name only
      // when no earlier `false` pattern has already.
      const sweeps = forbidden.map((pattern, k): LowerStmt => {
        const b = lctx.binding();
        const key: LowerExpr = { kind: "binding", id: b };
        const earlier = forbidden
          .slice(0, k)
          .map((p) => lowerIR.regexTest(p, key));
        return {
          kind: "forEachKey",
          target: lctx.instance,
          binding: b,
          body: [
            lowerIR.when(
              lowerIR.and(
                lowerIR.regexTest(pattern, key),
                ...(earlier.length > 0
                  ? [lowerIR.not(lowerIR.or(...earlier))]
                  : []),
              ),
              [lowerIR.reject(r, key)],
            ),
          ],
        };
      });
      lctx.emit(
        lowerIR.when(lowerIR.typeIs(lctx.instance, "object"), [
          lowerIR.rejectScope(
            r,
            sweeps,
            describeForbiddenPatterns(forbidden, listOf(r)),
          ),
        ]),
      );
    }
    // Produce iff the instance is an object (an empty array otherwise), matching
    // evaluate()'s object-type guard before ctx.produce.
    lctx.emit(
      lowerIR.when(lowerIR.typeIs(lctx.instance, "object"), [
        { kind: "produce", value: { kind: "collectedNames" } },
      ]),
    );
  },
  evaluate: (value, cursor, ctx) => {
    if (!isObject(cursor.value)) return true;
    let ok = true;
    const matched = new Set<string>();
    const rejected = new Set<string>();
    for (const [pattern, schema] of Object.entries(
      value as Record<string, JsonValue>,
    )) {
      const re = ctx.compileRegex(pattern);
      for (const name of Object.keys(cursor.value)) {
        if (!re.test(name)) continue;
        matched.add(name);
        if (isFalse(schema)) rejected.add(name);
        else if (
          !ctx.apply(
            ["patternProperties", pattern],
            childCursor(cursor, name, cursor.value[name]!),
          )
        )
          ok = false;
      }
    }
    if (rejected.size > 0) {
      const names: JsonValue[] = [...rejected];
      ctx.report(() =>
        describeForbiddenPatterns(
          forbiddenPatterns(value as Record<string, JsonValue>),
          lowerIR.constant(names),
        ),
      );
      ok = false;
    }
    if (ok) ctx.produce([...matched]);
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
  lower: (value, lctx) => {
    const names = isObject(lctx.schema.properties)
      ? Object.keys(lctx.schema.properties)
      : [];
    const patterns = isObject(lctx.schema.patternProperties)
      ? Object.keys(lctx.schema.patternProperties)
      : [];
    const b = lctx.binding();
    const key: LowerExpr = { kind: "binding", id: b };
    const covered: LowerExpr[] = [
      ...names.map((n): LowerExpr =>
        lowerIR.cmp("===", key, lowerIR.constant(n)),
      ),
      ...patterns.map((p): LowerExpr => lowerIR.regexTest(p, key)),
    ];
    // A `false` subschema is never applied: every additional name is
    // rejected and reported once, by name (rejects.ts).
    const r = isFalse(value) ? lctx.binding() : null;
    const step: LowerStmt =
      r === null
        ? {
            kind: "apply",
            apply: {
              path: [],
              cursor: { kind: "child", of: { kind: "here" }, segment: key },
              fold: "allMustPass",
            },
          }
        : lowerIR.reject(r, key);
    const sweep: LowerStmt = {
      kind: "forEachKey",
      target: lctx.instance,
      binding: b,
      body: [
        lowerIR.when(
          covered.length === 0
            ? lowerIR.constant(true)
            : lowerIR.not(lowerIR.or(...covered)),
          [step],
        ),
      ],
    };
    lctx.emit(
      lowerIR.when(lowerIR.typeIs(lctx.instance, "object"), [
        r === null
          ? sweep
          : lowerIR.rejectScope(
              r,
              [sweep],
              namesRejected("additional ", " not allowed", {
                kind: "binding",
                id: r,
              }),
            ),
      ]),
    );
    // Produce iff the instance is an object (an empty array otherwise), matching
    // evaluate()'s object-type guard before ctx.produce.
    lctx.emit(
      lowerIR.when(lowerIR.typeIs(lctx.instance, "object"), [
        { kind: "produce", value: { kind: "collectedNames" } },
      ]),
    );
  },
  evaluate: (value, cursor, ctx) => {
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
        !isFalse(value) &&
        !ctx.apply(
          ["additionalProperties"],
          childCursor(cursor, name, cursor.value[name]!),
        )
      )
        ok = false;
    }
    if (isFalse(value) && matched.length > 0) {
      // One summary error naming every additional property, never a
      // "schema is false" per child (rejects.ts).
      const rejected: JsonValue[] = [...matched];
      ctx.report(() =>
        namesRejected(
          "additional ",
          " not allowed",
          lowerIR.constant(rejected),
        ),
      );
      ok = false;
    }
    if (ok) ctx.produce(matched);
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
    const r = value.some(isFalse) ? lctx.binding() : null;
    const sweep = value.map((schema, i) =>
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
          r !== null && isFalse(schema)
            ? lowerIR.reject(r, lowerIR.constant(i))
            : {
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
    // A `false` position is never applied: the positions present in the
    // instance are reported once, after the positions that did apply.
    lctx.emit(
      ...(r === null
        ? sweep
        : [lowerIR.rejectScope(r, sweep, positionsRejected(listOf(r)))]),
    );
    // Annotation: largest applied index, or true when it covered the array
    // (evaluate() produces only when at least one index applied).
    lctx.emit({
      kind: "produce",
      value: { kind: "collectedIndexes", render: "largestOrTrue" },
    });
  },
  evaluate: (value, cursor, ctx) => {
    if (!Array.isArray(cursor.value)) return true;
    // A non-array value is malformed (metaschema's job to reject, D19 scope
    // line); no-op here so both tiers treat it identically — analyze() and
    // lower() already contribute nothing for it.
    if (!Array.isArray(value)) return true;
    const schemas = value;
    const n = Math.min(schemas.length, cursor.value.length);
    let ok = true;
    const rejected: number[] = [];
    for (let i = 0; i < n; i++) {
      if (isFalse(schemas[i]!)) rejected.push(i);
      else if (
        !ctx.apply(["prefixItems", i], childCursor(cursor, i, cursor.value[i]!))
      )
        ok = false;
    }
    if (rejected.length > 0) {
      ctx.report(() => positionsRejected(lowerIR.constant(rejected)));
      ok = false;
    }
    // Dependency data: largest applied index, or true when it covered the
    // array — only from an accepting keyword (Appendix D; see properties).
    if (n > 0 && ok) ctx.produce(n === cursor.value.length ? true : n - 1);
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
  lower: (value, lctx) => {
    const start = Array.isArray(lctx.schema.prefixItems)
      ? lctx.schema.prefixItems.length
      : 0;
    const b = lctx.binding();
    // A `false` subschema is never applied: every index from `start` is
    // rejected and the tail reported once (rejects.ts).
    const r = isFalse(value) ? lctx.binding() : null;
    const sweep: LowerStmt = {
      kind: "forEachIndex",
      target: lctx.instance,
      binding: b,
      start,
      body: [
        r === null
          ? {
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
            }
          : lowerIR.reject(r, { kind: "binding", id: b }),
      ],
    };
    lctx.emit(
      lowerIR.when(lowerIR.typeIs(lctx.instance, "array"), [
        r === null
          ? sweep
          : lowerIR.rejectScope(
              r,
              [sweep],
              tailRejected("items", start, listOf(r)),
            ),
      ]),
    );
    // Annotation: true iff it applied to any item past the prefix.
    lctx.emit({
      kind: "produce",
      value: { kind: "collectedIndexes", render: "appliedTrue" },
    });
  },
  evaluate: (value, cursor, ctx) => {
    if (!Array.isArray(cursor.value)) return true;
    // Applies past the sibling prefixItems (statically known per spec).
    const start = Array.isArray(ctx.schema.prefixItems)
      ? ctx.schema.prefixItems.length
      : 0;
    let ok = true;
    let applied = false;
    const rejected: number[] = [];
    for (let i = start; i < cursor.value.length; i++) {
      applied = true;
      if (isFalse(value)) rejected.push(i);
      else if (!ctx.apply(["items"], childCursor(cursor, i, cursor.value[i]!)))
        ok = false;
    }
    if (rejected.length > 0) {
      ctx.report(() =>
        tailRejected("items", start, lowerIR.constant(rejected)),
      );
      ok = false;
    }
    if (applied && ok) ctx.produce(true);
    return ok;
  },
};

// `the contains subschema matched 2 items (0, 3), expected at least 3`: the
// range comes from the sibling minContains/maxContains, so it is known when
// the keyword is built; the count and the matched indexes are runtime data.
const describeContains = (
  min: number,
  max: number,
  count: LowerExpr,
  matched: LowerExpr,
): Description => ({
  message: [
    "the contains subschema matched ",
    lowerIR.helper(
      "countedIndexes",
      matched,
      lowerIR.constant("item"),
      lowerIR.constant("items"),
    ),
    ", expected " +
      (!Number.isFinite(max)
        ? `at least ${min}`
        : max === min
          ? String(min)
          : `${min}-${max}`),
  ],
  params: {
    count,
    matched,
    minContains: lowerIR.constant(min),
    ...(Number.isFinite(max) ? { maxContains: lowerIR.constant(max) } : {}),
  },
});

// minContains/maxContains are inert siblings (validation.ts) that turn the
// count into a range assertion instead of contains' own >=1 default;
// minContains: 0 with zero matches is valid (suite: "minContains = 0").
const containsRange = (
  schema: Readonly<Record<string, JsonValue>>,
): { min: number; max: number } => ({
  min: typeof schema.minContains === "number" ? schema.minContains : 1,
  max: typeof schema.maxContains === "number" ? schema.maxContains : Infinity,
});

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
  lower: (value, lctx) => {
    const { min, max } = containsRange(lctx.schema);
    if (isFalse(value)) {
      // A `false` subschema matches no item and is never probed, so the
      // count is 0 for every array and the verdict is static. It produces
      // nothing: evaluate() produces only for a non-empty match.
      if (min > 0 || max < 0)
        lctx.emit(
          lowerIR.when(lowerIR.typeIs(lctx.instance, "array"), [
            lowerIR.failDescribed(
              describeContains(
                min,
                max,
                lowerIR.constant(0),
                lowerIR.constant([]),
              ),
            ),
          ]),
        );
      return;
    }
    const b = lctx.binding();
    const { message, params } = describeContains(
      min,
      max,
      { kind: "tally" },
      { kind: "tallyList" },
    );
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
          collectIndexes: true,
          min,
          max,
          outOfRangeMessage: message,
          outOfRangeParams: params,
        },
      ]),
    );
    // Annotation: matched indexes, or true when every item matched
    // (evaluate() produces only when at least one item matched).
    lctx.emit({
      kind: "produce",
      value: { kind: "collectedIndexes", render: "matchedOrAllTrue" },
    });
  },
  evaluate: (value, cursor, ctx) => {
    if (!Array.isArray(cursor.value)) return true;
    const matched: number[] = [];
    if (!isFalse(value)) {
      for (let i = 0; i < cursor.value.length; i++) {
        if (ctx.apply(["contains"], childCursor(cursor, i, cursor.value[i]!)))
          matched.push(i);
      }
    }
    const { min, max } = containsRange(ctx.schema);
    if (matched.length < min || matched.length > max) {
      ctx.report(() =>
        describeContains(
          min,
          max,
          lowerIR.constant(matched.length),
          lowerIR.constant(matched),
        ),
      );
      return false;
    }
    // Annotation: matched indexes, or true when every item matched.
    if (matched.length > 0)
      ctx.produce(matched.length === cursor.value.length ? true : matched);
    return true;
  },
};

// `no property names allowed, got "a", "b"`.
const describeNoNames = (names: LowerExpr): Description => ({
  message: [
    "no property names allowed, got ",
    lowerIR.helper("nameList", names),
  ],
  params: { properties: names },
});

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
  lower: (value, lctx) => {
    const b = lctx.binding();
    // A `false` subschema is never applied: any name at all is rejected,
    // and every name is reported once.
    const r = isFalse(value) ? lctx.binding() : null;
    const sweep: LowerStmt = {
      kind: "forEachKey",
      target: lctx.instance,
      binding: b,
      body: [
        r === null
          ? {
              kind: "apply",
              apply: {
                path: [],
                cursor: { kind: "key", binding: b },
                fold: "allMustPass",
              },
            }
          : lowerIR.reject(r, { kind: "binding", id: b }),
      ],
    };
    lctx.emit(
      lowerIR.when(lowerIR.typeIs(lctx.instance, "object"), [
        r === null
          ? sweep
          : lowerIR.rejectScope(r, [sweep], describeNoNames(listOf(r))),
      ]),
    );
  },
  evaluate: (value, cursor, ctx) => {
    if (!isObject(cursor.value)) return true;
    const names = Object.keys(cursor.value);
    if (isFalse(value)) {
      if (names.length === 0) return true;
      ctx.report(() => describeNoNames(lowerIR.constant(names)));
      return false;
    }
    let ok = true;
    for (const name of names) {
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
  then: thenKeyword,
  else: elseKeyword,
  dependentSchemas,
  properties,
  patternProperties,
  additionalProperties,
  prefixItems,
  items,
  contains,
  propertyNames,
};
