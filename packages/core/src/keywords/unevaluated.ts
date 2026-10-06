// Unevaluated vocabulary: the channel-consumer keyword class. Phase 1: runs
// after every other keyword in the same schema object has merged.

import { isObject, JsonValue } from "../json.js";
import { KeywordBehavior } from "../dialect.js";
import { LowerExpr, LowerStmt, lowerIR } from "../lowering.js";
import { childCursor } from "../cursor.js";
import { SELF } from "./core.js";
import {
  properties,
  patternProperties,
  additionalProperties,
  prefixItems,
  items,
  contains,
} from "./applicator.js";
import {
  isFalse,
  rejectingSweep,
  unevaluatedNamesRejected,
  unevaluatedRejected,
} from "./rejects.js";

/** 2020-12 unevaluated vocabulary URI. */
export const VOCAB_UNEVALUATED =
  "https://json-schema.org/draft/2020-12/vocab/unevaluated";

/**
 * EXEMPLAR (consumer class): reads visible dependency records (engine.ts
 * visibility rule), applies the subschema to properties nobody evaluated,
 * and produces like any other applicator.
 */
export const unevaluatedProperties: KeywordBehavior = {
  id: `${VOCAB_UNEVALUATED}#unevaluatedProperties`,
  phase: 1,
  analyze: () => ({
    subschemas: SELF.subschemas,
    consumes: [
      properties.id,
      patternProperties.id,
      additionalProperties.id,
      `${VOCAB_UNEVALUATED}#unevaluatedProperties`,
    ],
    produces: [`${VOCAB_UNEVALUATED}#unevaluatedProperties`],
    evaluatesNames: { kind: "all" },
    applications: [
      { path: [], mode: "childSweep", conditional: false, asserts: true },
    ],
  }),
  // Static-coverage path only (D9a): the planner classifies this schema
  // object as interpreted when any coverage contributor is dynamic, so
  // lower() is never called with a null coverage.
  lower: (value, lctx) => {
    // Runtime-coverage path (phase B activates it): fold the unit's runtime
    // channel into an evaluated-name set and sweep the names it does not
    // cover, mirroring evaluate()'s seen-set skip. The object-gated
    // collectedNames produce is the same one the static path emits — its
    // attempted-apply accumulator is exactly the interpreter's `matched`.
    if (lctx.runtimeCoverage()) {
      const f = lctx.binding();
      const b = lctx.binding();
      const { step, scope } = rejectingSweep(
        value,
        { kind: "binding", id: b },
        lctx,
        unevaluatedNamesRejected,
      );
      lctx.emit(
        lowerIR.when(lowerIR.typeIs(lctx.instance, "object"), [
          { kind: "coverageFold", half: "names", binding: f },
          ...scope([
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
                  [step],
                ),
              ],
            },
          ]),
          { kind: "produce", value: { kind: "collectedNames" } },
        ]),
      );
      return;
    }
    const coverage = lctx.staticCoverage();
    if (coverage === null) {
      throw new Error(
        "unevaluatedProperties lowering requires static coverage (planner bug)",
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
      const { step, scope } = rejectingSweep(
        value,
        { kind: "binding", id: b },
        lctx,
        unevaluatedNamesRejected,
      );
      body.push(
        ...scope([
          {
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
          },
        ]),
      );
    }
    body.push({ kind: "produce", value: { kind: "collectedNames" } });
    // Produce iff the instance is an object (nothing otherwise), matching
    // evaluate()'s object-type guard before ctx.produce.
    lctx.emit(lowerIR.when(lowerIR.typeIs(lctx.instance, "object"), body));
  },
  evaluate: (value, cursor, ctx) => {
    if (!isObject(cursor.value)) return true;
    const seen = new Set<string>();
    for (const p of ctx.visible([
      properties.id,
      patternProperties.id,
      additionalProperties.id,
      unevaluatedProperties.id,
    ])) {
      for (const name of p.data as string[]) seen.add(name);
    }
    let ok = true;
    const matched: string[] = [];
    for (const name of Object.keys(cursor.value)) {
      if (seen.has(name)) continue;
      matched.push(name);
      if (
        !isFalse(value) &&
        !ctx.apply(
          ["unevaluatedProperties"],
          childCursor(cursor, name, cursor.value[name]!),
        )
      )
        ok = false;
    }
    if (isFalse(value) && matched.length > 0) {
      const rejected: JsonValue[] = [...matched];
      ctx.report(() => unevaluatedNamesRejected(lowerIR.constant(rejected)));
      ok = false;
    }
    // Dependency data only from an accepting keyword (Appendix D; see
    // applicator.ts properties).
    if (ok) ctx.produce(matched);
    return ok;
  },
};

/** Same consumer shape as {@link unevaluatedProperties}, over array indexes not covered by `prefixItems`/`items`/`contains`. */
export const unevaluatedItems: KeywordBehavior = {
  id: `${VOCAB_UNEVALUATED}#unevaluatedItems`,
  phase: 1,
  analyze: () => ({
    subschemas: SELF.subschemas,
    consumes: [
      prefixItems.id,
      items.id,
      contains.id,
      `${VOCAB_UNEVALUATED}#unevaluatedItems`,
    ],
    produces: [`${VOCAB_UNEVALUATED}#unevaluatedItems`],
    evaluatesIndexes: { kind: "all" },
    applications: [
      { path: [], mode: "childSweep", conditional: false, asserts: true },
    ],
  }),
  // Static-coverage path only (D9a), same discipline as
  // unevaluatedProperties: the planner classifies this schema object as
  // interpreted whenever any index-coverage contributor is dynamic (e.g. a
  // sibling `contains`, whose coverage is instance-dependent), so lower() is
  // never called with a null/incomplete coverage.
  lower: (value, lctx) => {
    // Runtime-coverage path (phase B activates it): fold the unit's runtime
    // channel into a coveredPrefix/coveredIdx summary over this array's
    // length and sweep the indexes it does not cover, mirroring evaluate()'s
    // skip loop. The appliedTrue produce is the same one the static path
    // emits (any attempted apply -> true, the interpreter's `applied` flag).
    if (lctx.runtimeCoverage()) {
      const f = lctx.binding();
      const b = lctx.binding();
      const { step, scope } = rejectingSweep(
        value,
        { kind: "binding", id: b },
        lctx,
        unevaluatedRejected,
      );
      lctx.emit(
        lowerIR.when(lowerIR.typeIs(lctx.instance, "array"), [
          { kind: "coverageFold", half: "indexes", binding: f },
          ...scope([
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
                  [step],
                ),
              ],
            },
          ]),
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
        "unevaluatedItems lowering requires static coverage (planner bug)",
      );
    }
    if (coverage.coversAllIndexes) return; // statically vacuous
    const b = lctx.binding();
    const { step, scope } = rejectingSweep(
      value,
      { kind: "binding", id: b },
      lctx,
      unevaluatedRejected,
    );
    lctx.emit(
      lowerIR.when(lowerIR.typeIs(lctx.instance, "array"), [
        ...scope([
          {
            kind: "forEachIndex",
            target: lctx.instance,
            binding: b,
            start: coverage.prefixCount,
            body: [step],
          },
        ]),
      ]),
    );
    // Annotation: true iff it applied to any unevaluated index.
    lctx.emit({
      kind: "produce",
      value: { kind: "collectedIndexes", render: "appliedTrue" },
    });
  },
  evaluate: (value, cursor, ctx) => {
    if (!Array.isArray(cursor.value)) return true;
    const length = cursor.value.length;
    let coveredPrefix = 0;
    const coveredIdx = new Set<number>();
    for (const p of ctx.visible([
      prefixItems.id,
      items.id,
      contains.id,
      unevaluatedItems.id,
    ])) {
      if (p.behaviorId === contains.id) {
        if (p.data === true) coveredPrefix = length;
        else for (const i of p.data as number[]) coveredIdx.add(i);
      } else if (p.data === true) {
        coveredPrefix = length;
      } else if (p.behaviorId === prefixItems.id) {
        coveredPrefix = Math.max(coveredPrefix, (p.data as number) + 1);
      }
    }
    let ok = true;
    let applied = false;
    const rejected: JsonValue[] = [];
    for (let i = coveredPrefix; i < length; i++) {
      if (coveredIdx.has(i)) continue;
      applied = true;
      if (isFalse(value)) rejected.push(i);
      else if (
        !ctx.apply(
          ["unevaluatedItems"],
          childCursor(cursor, i, cursor.value[i]!),
        )
      )
        ok = false;
    }
    if (rejected.length > 0) {
      ctx.report(() => unevaluatedRejected(lowerIR.constant(rejected)));
      ok = false;
    }
    if (applied && ok) ctx.produce(true);
    return ok;
  },
};

/** The 2020-12 unevaluated vocabulary's keyword behaviors, by name. */
export const unevaluatedVocabulary: Record<string, KeywordBehavior> = {
  unevaluatedProperties,
  unevaluatedItems,
};
