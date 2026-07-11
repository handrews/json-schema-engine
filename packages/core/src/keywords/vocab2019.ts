// 2019-09 dialect (DESIGN.md M4-A): assembled from its own vocabulary URIs,
// reusing 2020-12 behavior objects wherever spec semantics are identical
// (validation is byte-for-byte the same set; most applicators too) and
// registering new behaviors only where 2019-09 diverges — no `$dynamicRef`/
// `$dynamicAnchor` (2019-09 has `$recursiveRef`/`$recursiveAnchor` instead),
// tuple-form `items` folds what 2020-12 splits into `prefixItems`+`items`,
// and `additionalItems` (retired in 2020-12) fills the gap that leaves.

import { isObject } from "../json.js";
import {
  DialectRegistry,
  KeywordBehavior,
  StaticFacts,
  SubschemaApplication,
  identifiers2019,
} from "../dialect.js";
import { childCursor } from "../cursor.js";
import { LowerExpr, LowerStmt, lowerIR } from "../lowering.js";
import {
  coreVocabulary,
  VOCAB_CORE_2019,
  $recursiveRef,
  $recursiveAnchor,
  annotationOnly,
  SELF,
} from "./core.js";
import {
  allOf,
  anyOf,
  oneOf,
  not,
  ifKeyword,
  dependentSchemas,
  properties,
  patternProperties,
  propertyNames,
  additionalProperties,
  contains,
} from "./applicator.js";
import { validationVocabulary } from "./validation.js";

/** 2019-09 core vocabulary URI. */
export const VOCAB_CORE_2019_09 = VOCAB_CORE_2019;
/** 2019-09 applicator vocabulary URI. */
export const VOCAB_APPLICATOR_2019 =
  "https://json-schema.org/draft/2019-09/vocab/applicator";
/** 2019-09 validation vocabulary URI. */
export const VOCAB_VALIDATION_2019 =
  "https://json-schema.org/draft/2019-09/vocab/validation";
/** 2019-09 meta-data vocabulary URI. */
export const VOCAB_META_DATA_2019 =
  "https://json-schema.org/draft/2019-09/vocab/meta-data";
/** 2019-09 format vocabulary URI. */
export const VOCAB_FORMAT_2019 =
  "https://json-schema.org/draft/2019-09/vocab/format";
/** 2019-09 content vocabulary URI. */
export const VOCAB_CONTENT_2019 =
  "https://json-schema.org/draft/2019-09/vocab/content";

/** 2019-09 dialect URI. */
export const DIALECT_2019_09 = "https://json-schema.org/draft/2019-09/schema";

const id = (name: string): string => `${VOCAB_APPLICATOR_2019}#${name}`;

// 2019-09 core: same keyword set as 2020-12's core minus $dynamicRef/
// $dynamicAnchor, plus $recursiveRef/$recursiveAnchor. $id/$schema/$anchor/
// $vocabulary/$comment/$defs behaviors are draft-agnostic (structural or
// value-is-the-position), so they're shared as-is — the milestone contract
// allows a shared behavior's id to stay a 2020-12 URI.
const core2019Vocabulary: Record<string, KeywordBehavior> = {
  $ref: coreVocabulary.$ref!,
  $defs: coreVocabulary.$defs!,
  $id: coreVocabulary.$id!,
  $schema: coreVocabulary.$schema!,
  $anchor: coreVocabulary.$anchor!,
  $vocabulary: coreVocabulary.$vocabulary!,
  $comment: coreVocabulary.$comment!,
  $recursiveRef,
  $recursiveAnchor,
};

/**
 * `items` (2019-09 form): a schema value applies to every element (produces
 * `true`, matching 2020-12 `items`' post-`prefixItems` annotation shape); an
 * array value (tuple) applies element-wise to the first N and produces the
 * largest index reached, or `true` when it covers the whole array — this is
 * the pre-2020-12 keyword that `prefixItems`/`items` later split in two, so
 * its annotation shape mirrors 2020-12 `prefixItems`'.
 */
export const items2019: KeywordBehavior = {
  id: id("items"),
  // evaluatesIndexes mirrors prefixItems (array form: a fixed-count prefix)
  // and items (schema form: every index from 0 — 2019-09 folds prefixItems
  // into this same keyword, so there's no separate sibling to start after)
  // — the coverage facts unevaluatedItems2019 needs for static licensing.
  analyze: (value): StaticFacts =>
    Array.isArray(value)
      ? {
          subschemas: value.map((_, i) => [i]),
          applications: value.map((_, i): SubschemaApplication => ({
            path: [i],
            mode: "childByIndex",
            conditional: false,
            asserts: true,
          })),
          evaluatesIndexes: { kind: "prefix", count: value.length },
        }
      : {
          ...SELF,
          applications: [
            { path: [], mode: "childSweep", conditional: false, asserts: true },
          ],
          evaluatesIndexes: { kind: "allFrom", start: 0 },
        },
  // Two forms, same as evaluate(): tuple (per-index, guarded by the array's
  // length like prefixItems' compiled form) or schema (every element from
  // index 0, like `items`' compiled form but with no sibling prefixItems to
  // start after — 2019-09 has no such keyword). Each form's annotation
  // mirrors evaluate(): tuple produces the largest applied index (or true
  // when it covered the array), schema produces true iff it applied to any
  // element.
  lower: (value, lctx) => {
    if (Array.isArray(value)) {
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
                  cursor: {
                    kind: "child",
                    of: { kind: "here" },
                    segment: i,
                  },
                  fold: "allMustPass",
                },
              },
            ],
          ),
        );
      });
      lctx.emit({
        kind: "produce",
        value: { kind: "collectedIndexes", render: "largestOrTrue" },
      });
      return;
    }
    const b = lctx.binding();
    lctx.emit(
      lowerIR.when(lowerIR.typeIs(lctx.instance, "array"), [
        {
          kind: "forEachIndex",
          target: lctx.instance,
          binding: b,
          start: 0,
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
    lctx.emit({
      kind: "produce",
      value: { kind: "collectedIndexes", render: "appliedTrue" },
    });
  },
  evaluate: (value, cursor, ctx) => {
    if (!Array.isArray(cursor.value)) return true;
    if (Array.isArray(value)) {
      const n = Math.min(value.length, cursor.value.length);
      let ok = true;
      for (let i = 0; i < n; i++) {
        if (!ctx.apply(["items", i], childCursor(cursor, i, cursor.value[i]!)))
          ok = false;
      }
      if (n > 0) ctx.produce(n === cursor.value.length ? true : n - 1);
      return ok;
    }
    let ok = true;
    let applied = false;
    for (let i = 0; i < cursor.value.length; i++) {
      applied = true;
      if (!ctx.apply(["items"], childCursor(cursor, i, cursor.value[i]!)))
        ok = false;
    }
    if (applied) ctx.produce(true);
    return ok;
  },
};

/**
 * `additionalItems`: applies only when the sibling `items` is present *and*
 * an array (tuple form) — a schema-form `items` already covers every
 * element, so `additionalItems` "does nothing" against it (suite: "when
 * items is schema, additionalItems does nothing"). Sibling-read, same
 * pattern as `if`/`then`/`else` and `contains`' `minContains`/`maxContains`
 * siblings.
 */
export const additionalItems: KeywordBehavior = {
  id: id("additionalItems"),
  // Sibling read at plan time (AnalyzeContext.schema), same as `if`
  // declaring applications for `then`/`else`: no edge at all when `items`
  // isn't an array, so the planner never visits a target this keyword can
  // never reach.
  analyze: (_value, context): StaticFacts => {
    const siblingItems = context?.schema.items;
    if (!Array.isArray(siblingItems)) return SELF;
    return {
      ...SELF,
      applications: [
        { path: [], mode: "childSweep", conditional: false, asserts: true },
      ],
      evaluatesIndexes: { kind: "allFrom", start: siblingItems.length },
    };
  },
  // Sibling `items` is plan-time data (lctx.schema.items): when it isn't an
  // array, this keyword contributes nothing at all, so the lowering emits
  // no statements — same static-read pattern as `if`/`then`/`else`.
  lower: (_value, lctx) => {
    const siblingItems = lctx.schema.items;
    if (!Array.isArray(siblingItems)) return;
    const start = siblingItems.length;
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
    // Annotation: true iff it applied to any element past the tuple prefix.
    lctx.emit({
      kind: "produce",
      value: { kind: "collectedIndexes", render: "appliedTrue" },
    });
  },
  evaluate: (_value, cursor, ctx) => {
    if (!Array.isArray(cursor.value)) return true;
    const siblingItems = ctx.schema.items;
    if (!Array.isArray(siblingItems)) return true;
    let ok = true;
    let applied = false;
    for (let i = siblingItems.length; i < cursor.value.length; i++) {
      applied = true;
      if (
        !ctx.apply(
          ["additionalItems"],
          childCursor(cursor, i, cursor.value[i]!),
        )
      )
        ok = false;
    }
    // Boolean annotation: additionalItems has no index-range shape of its
    // own, only whether it applied to any element.
    if (applied) ctx.produce(true);
    return ok;
  },
};

const applicator2019Vocabulary: Record<string, KeywordBehavior> = {
  allOf,
  anyOf,
  oneOf,
  not,
  if: ifKeyword,
  then: {
    id: id("then"),
    analyze: (): StaticFacts => SELF,
    evaluate: () => true,
    lower: () => {
      /* if owns the application of this sibling */
    },
  },
  else: {
    id: id("else"),
    analyze: (): StaticFacts => SELF,
    evaluate: () => true,
    lower: () => {
      /* if owns the application of this sibling */
    },
  },
  dependentSchemas,
  properties,
  patternProperties,
  propertyNames,
  additionalProperties,
  items: items2019,
  additionalItems,
  contains,
};

// unevaluatedItems/unevaluatedProperties (2019-09): same consumer pattern as
// unevaluated.ts, wired to this dialect's producer ids — items2019 folds
// prefixItems+items into one id, and additionalItems is a genuinely new
// producer 2020-12 doesn't have. Spec-wise these two live in the applicator
// vocabulary (2019-09 has no separate unevaluated vocabulary yet).
const unevaluatedItems2019: KeywordBehavior = {
  id: `${VOCAB_APPLICATOR_2019}#unevaluatedItems`,
  phase: 1,
  analyze: (): StaticFacts => ({
    subschemas: SELF.subschemas,
    consumes: [
      items2019.id,
      additionalItems.id,
      contains.id,
      `${VOCAB_APPLICATOR_2019}#unevaluatedItems`,
    ],
    produces: [`${VOCAB_APPLICATOR_2019}#unevaluatedItems`],
    // Self-covering (D9a): once this keyword runs, everything is evaluated —
    // needed both for the planner's own edge (childSweep to its own
    // position) and so an outer scope's coverage computation can fold this
    // node's post-success contribution.
    evaluatesIndexes: { kind: "all" },
    applications: [
      { path: [], mode: "childSweep", conditional: false, asserts: true },
    ],
  }),
  // Static-coverage path only (D9a), same discipline as 2020-12
  // unevaluatedItems (unevaluated.ts): a sibling `contains` always declares
  // evaluatesIndexes: dynamic (applicator.ts), so the planner classifies
  // this node interpreted whenever `contains` is present — lower() is never
  // called with a null/incomplete coverage, and never needs the
  // per-index coveredIdx set evaluate() tracks (that set is populated only
  // from a dynamic `contains` match list, which forces interpretation).
  lower: (_value, lctx) => {
    // Runtime-coverage path (phase B activates it): same shape as 2020-12
    // unevaluatedItems — fold the channel into a coveredPrefix/coveredIdx
    // summary over this array's length and sweep the uncovered indexes.
    if (lctx.runtimeCoverage()) {
      const f = lctx.binding();
      const b = lctx.binding();
      lctx.emit(
        lowerIR.when(lowerIR.typeIs(lctx.instance, "array"), [
          { kind: "coverageFold", half: "indexes", binding: f },
          {
            kind: "forEachIndex",
            target: lctx.instance,
            binding: b,
            start: 0,
            body: [
              lowerIR.when(
                lowerIR.not({
                  kind: "coverageCovers",
                  fold: f,
                  target: { kind: "binding", id: b },
                }),
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
          {
            kind: "produce",
            value: { kind: "collectedIndexes", render: "appliedTrue" },
          },
        ]),
      );
      return;
    }
    const coverage = lctx.staticCoverage();
    if (coverage === null) {
      throw new Error(
        "unevaluatedItems2019 lowering requires static coverage (planner bug)",
      );
    }
    if (coverage.coversAllIndexes) return; // statically vacuous
    const b = lctx.binding();
    lctx.emit(
      lowerIR.when(lowerIR.typeIs(lctx.instance, "array"), [
        {
          kind: "forEachIndex",
          target: lctx.instance,
          binding: b,
          start: coverage.prefixCount,
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
    // Annotation: true iff it applied to any unevaluated index.
    lctx.emit({
      kind: "produce",
      value: { kind: "collectedIndexes", render: "appliedTrue" },
    });
  },
  evaluate: (_value, cursor, ctx) => {
    if (!Array.isArray(cursor.value)) return true;
    const length = cursor.value.length;
    let coveredPrefix = 0;
    const coveredIdx = new Set<number>();
    for (const p of ctx.visible([
      items2019.id,
      additionalItems.id,
      contains.id,
      unevaluatedItems2019.id,
    ])) {
      if (p.behaviorId === contains.id) {
        if (p.value === true) coveredPrefix = length;
        else for (const i of p.value as number[]) coveredIdx.add(i);
      } else if (p.value === true) {
        coveredPrefix = length;
      } else if (p.behaviorId === items2019.id) {
        coveredPrefix = Math.max(coveredPrefix, (p.value as number) + 1);
      }
    }
    let ok = true;
    let applied = false;
    for (let i = coveredPrefix; i < length; i++) {
      if (coveredIdx.has(i)) continue;
      applied = true;
      if (
        !ctx.apply(
          ["unevaluatedItems"],
          childCursor(cursor, i, cursor.value[i]!),
        )
      )
        ok = false;
    }
    if (applied) ctx.produce(true);
    return ok;
  },
};

const unevaluatedProperties2019: KeywordBehavior = {
  id: `${VOCAB_APPLICATOR_2019}#unevaluatedProperties`,
  phase: 1,
  analyze: (): StaticFacts => ({
    subschemas: SELF.subschemas,
    consumes: [
      properties.id,
      patternProperties.id,
      additionalProperties.id,
      `${VOCAB_APPLICATOR_2019}#unevaluatedProperties`,
    ],
    produces: [`${VOCAB_APPLICATOR_2019}#unevaluatedProperties`],
    evaluatesNames: { kind: "all" },
    applications: [
      { path: [], mode: "childSweep", conditional: false, asserts: true },
    ],
  }),
  // Static-coverage path only (D9a) — same discipline as 2020-12
  // unevaluatedProperties (unevaluated.ts). `properties`/`patternProperties`/
  // `additionalProperties` here are the shared 2020-12 behaviors
  // (applicator.ts), so their evaluatesNames facts are identical.
  lower: (_value, lctx) => {
    // Runtime-coverage path (phase B activates it): same shape as 2020-12
    // unevaluatedProperties — fold the channel into an evaluated-name set and
    // sweep the names it does not cover.
    if (lctx.runtimeCoverage()) {
      const f = lctx.binding();
      const b = lctx.binding();
      lctx.emit(
        lowerIR.when(lowerIR.typeIs(lctx.instance, "object"), [
          { kind: "coverageFold", half: "names", binding: f },
          {
            kind: "forEachKey",
            target: lctx.instance,
            binding: b,
            body: [
              lowerIR.when(
                lowerIR.not({
                  kind: "coverageCovers",
                  fold: f,
                  target: { kind: "binding", id: b },
                }),
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
          { kind: "produce", value: { kind: "collectedNames" } },
        ]),
      );
      return;
    }
    const coverage = lctx.staticCoverage();
    if (coverage === null) {
      throw new Error(
        "unevaluatedProperties2019 lowering requires static coverage (planner bug)",
      );
    }
    // The sweep is statically vacuous when sibling coverage is total, but the
    // produce is not: evaluate() emits an (empty) names annotation for every
    // object regardless. So the object-type guard always wraps a produce; the
    // sweep is added only when some name can still be unevaluated.
    const body: LowerStmt[] = [];
    if (!coverage.coversAllNames) {
      const b = lctx.binding();
      const covered: LowerExpr[] = [
        ...coverage.names.map((n): LowerExpr =>
          lowerIR.cmp("===", { kind: "binding", id: b }, lowerIR.constant(n)),
        ),
        ...coverage.patterns.map((p): LowerExpr =>
          lowerIR.regexTest(p, { kind: "binding", id: b }),
        ),
      ];
      body.push({
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
      });
    }
    body.push({ kind: "produce", value: { kind: "collectedNames" } });
    // Produce iff the instance is an object (nothing otherwise), matching
    // evaluate()'s object-type guard before ctx.produce.
    lctx.emit(lowerIR.when(lowerIR.typeIs(lctx.instance, "object"), body));
  },
  evaluate: (_value, cursor, ctx) => {
    if (!isObject(cursor.value)) return true;
    const seen = new Set<string>();
    for (const p of ctx.visible([
      properties.id,
      patternProperties.id,
      additionalProperties.id,
      unevaluatedProperties2019.id,
    ])) {
      for (const name of p.value as string[]) seen.add(name);
    }
    let ok = true;
    const matched: string[] = [];
    for (const name of Object.keys(cursor.value)) {
      if (seen.has(name)) continue;
      matched.push(name);
      if (
        !ctx.apply(
          ["unevaluatedProperties"],
          childCursor(cursor, name, cursor.value[name]!),
        )
      )
        ok = false;
    }
    ctx.produce(matched);
    return ok;
  },
};

Object.assign(applicator2019Vocabulary, {
  unevaluatedItems: unevaluatedItems2019,
  unevaluatedProperties: unevaluatedProperties2019,
});

const metaDataVocabulary2019 = Object.fromEntries(
  [
    "title",
    "description",
    "default",
    "deprecated",
    "readOnly",
    "writeOnly",
    "examples",
  ].map((name) => [name, annotationOnly(`${VOCAB_META_DATA_2019}#${name}`)]),
);

const contentVocabulary2019 = Object.fromEntries(
  ["contentMediaType", "contentEncoding", "contentSchema"].map((name) => [
    name,
    annotationOnly(`${VOCAB_CONTENT_2019}#${name}`),
  ]),
);

/** Registers the 2019-09 vocabularies and dialect. */
export function registerDialect2019(
  registry: DialectRegistry,
  format: (id: string) => KeywordBehavior = annotationOnly,
): void {
  registry.registerVocabulary(VOCAB_CORE_2019_09, core2019Vocabulary);
  registry.registerVocabulary(VOCAB_APPLICATOR_2019, applicator2019Vocabulary);
  registry.registerVocabulary(VOCAB_VALIDATION_2019, validationVocabulary);
  registry.registerVocabulary(VOCAB_META_DATA_2019, metaDataVocabulary2019);
  registry.registerVocabulary(VOCAB_FORMAT_2019, {
    format: format(`${VOCAB_FORMAT_2019}#format`),
  });
  registry.registerVocabulary(VOCAB_CONTENT_2019, contentVocabulary2019);

  registry.registerDialect(
    DIALECT_2019_09,
    [
      VOCAB_CORE_2019_09,
      VOCAB_APPLICATOR_2019,
      VOCAB_VALIDATION_2019,
      VOCAB_META_DATA_2019,
      VOCAB_FORMAT_2019,
      VOCAB_CONTENT_2019,
    ],
    { identifiers: identifiers2019 },
  );
}
