// Produce-recipe gate (COMPILED-ANNOTATIONS.md §5 stage 1): an independent
// reference evaluator (@jse/test-kit's evaluateProduceRecipes) runs each
// keyword's produce IR against a concrete instance and is differentially
// compared against the interpreter's OWN productions. The serializer still
// discards produce IR, so a wrong recipe is otherwise invisible until stage 2
// — this gate makes it fail loudly first.
//
// The comparison is VALID-ONLY by design: annotations only surface on success
// paths; consumer keywords' static-coverage lowering is sound only there
// (M6.6); and `contains` produces only after its range check passes.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createEngine,
  evaluateFragment,
  rootCursor,
  runEvaluation,
  DIALECT_2019_09,
  DIALECT_DRAFT_07,
  DIALECT_DRAFT_06,
  type Engine,
  type JsonValue,
  type KeywordBehavior,
  type Production,
  type SchemaRef,
  type TraceNode,
} from "@jse/core";
import { buildPlan, type PlannedUnit } from "@jse/compiler";
import { registerDraft04, DIALECT_DRAFT_04 } from "@jse/dialect-draft04";
import {
  evaluateProduceRecipes,
  suiteRemotesLoader,
  type OracleUnit,
  type RecipeProduction,
} from "@jse/test-kit";

const SUITE_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "test-suite",
);
const REMOTES = join(SUITE_ROOT, "remotes");

// ---------------------------------------------------------------------------
// Shared comparison machinery (Leg A + Leg C reuse it; Leg B inlines the same
// element-wise contract over its trace-derived interpreter side).
// ---------------------------------------------------------------------------

interface Interp {
  keyword: string;
  value: unknown;
}

/** A first mismatch between the oracle and the interpreter's own productions. */
interface Divergence {
  location: string;
  index: number;
  keyword: string | undefined;
  oracle: unknown;
  interpreter: unknown;
  reason: string;
}

// JSON values only (annotation values are JSON), so a stable-key stringify is
// a sound deep-equal that also ignores object key order.
function canonical(v: unknown): string {
  return JSON.stringify(v, (_k, val: unknown) => {
    if (val && typeof val === "object" && !Array.isArray(val)) {
      const rec = val as Record<string, unknown>;
      const sorted: Record<string, unknown> = {};
      for (const k of Object.keys(rec).sort()) sorted[k] = rec[k];
      return sorted;
    }
    return val;
  });
}
const valueEqual = (a: unknown, b: unknown): boolean =>
  canonical(a) === canonical(b);

/** First ordered mismatch, or null when the two production lists agree. */
function compareProductions(
  oracle: readonly RecipeProduction[],
  interp: readonly Interp[],
  location: string,
): Divergence | null {
  const n = Math.max(oracle.length, interp.length);
  for (let i = 0; i < n; i++) {
    const o = oracle[i];
    const p = interp[i];
    if (!o || !p) {
      return {
        location,
        index: i,
        keyword: o?.keyword ?? p?.keyword,
        oracle: o,
        interpreter: p,
        reason: "production count differs",
      };
    }
    if (o.keyword !== p.keyword || !valueEqual(o.value, p.value)) {
      return {
        location,
        index: i,
        keyword: o.keyword,
        oracle: o,
        interpreter: p,
        reason: "keyword or value differs",
      };
    }
  }
  return null;
}

/**
 * The interpreter's OWN-keyword productions for a unit evaluated standalone:
 * evaluateFragment then keep only productions at the passed root cursor whose
 * schemaRef is the unit's own (not merged child-applicator productions) and
 * whose keyword is a known dialect keyword (unknown keywords carry a null
 * vocabulary and are a separate serializer concern — §3.3).
 */
function ownInterpretations(
  engine: Engine,
  unitRef: SchemaRef,
  instance: JsonValue,
): { valid: boolean; productions: Interp[] } {
  const cursor = rootCursor(instance);
  const fragment = evaluateFragment(engine.registry, unitRef, cursor, {
    regexCache: engine.patternCache,
  });
  const productions = fragment.productions
    .filter(
      (p) =>
        p.cursor === cursor &&
        p.schemaRef.baseUri === unitRef.baseUri &&
        p.schemaRef.pointer === unitRef.pointer &&
        p.vocabularyUri !== null,
    )
    .map((p) => ({ keyword: p.keywordName, value: p.value }));
  return { valid: fragment.valid, productions };
}

/**
 * Runs the full contract for one (unit, instance): interpreter own-productions
 * vs the oracle. `divergence` is null on agreement (or when the unit is
 * invalid — the contract is valid-only). Returns the two sides so callers can
 * additionally pin them to hand-written expectations.
 */
function contractCompare(
  engine: Engine,
  unit: OracleUnit,
  instance: JsonValue,
): {
  valid: boolean;
  oracle: RecipeProduction[];
  interpreter: Interp[];
  divergence: Divergence | null;
} {
  const { valid, productions: interpreter } = ownInterpretations(
    engine,
    unit.ref,
    instance,
  );
  const oracle = evaluateProduceRecipes(
    engine.registry,
    engine.patternCache,
    unit,
    instance,
  );
  const divergence = valid
    ? compareProductions(
        oracle,
        interpreter,
        `${unit.ref.baseUri}#${unit.ref.pointer}`,
      )
    : null;
  return { valid, oracle, interpreter, divergence };
}

// ---------------------------------------------------------------------------
// Leg A — targeted table. Every recipe branch, checked through the full
// contract (oracle ≡ interpreter) AND pinned to a hand-written value.
// ---------------------------------------------------------------------------

interface TableCase {
  name: string;
  schema: JsonValue;
  instance: JsonValue;
  expected: RecipeProduction[];
  /** dialect URI passed to registerSchema (custom dialects); $schema handles the rest */
  dialectUri?: string;
  setup?: (engine: Engine) => void;
}

const DIALECT_2019 = { $schema: `${DIALECT_2019_09}#` };
const DIALECT_07 = { $schema: `${DIALECT_DRAFT_07}#` };
const DIALECT_06 = { $schema: `${DIALECT_DRAFT_06}#` };

const TABLE: TableCase[] = [
  // properties: present/absent names, empty object, non-object.
  {
    name: "properties present + absent names, schema-key order",
    schema: { properties: { a: {}, b: {}, c: {} } },
    instance: { a: 1, c: 2 },
    expected: [{ keyword: "properties", value: ["a", "c"] }],
  },
  {
    name: "properties empty object → empty names",
    schema: { properties: { a: {} } },
    instance: {},
    expected: [{ keyword: "properties", value: [] }],
  },
  {
    name: "properties non-object → no production",
    schema: { properties: { a: {} } },
    instance: 5,
    expected: [],
  },
  // patternProperties: a name matching two patterns dedups keep-first, in
  // patterns-outer order.
  {
    name: "patternProperties dedup keep-first, patterns-outer order",
    schema: { patternProperties: { "^a": {}, a$: {} } },
    instance: { a: 1, ba: 2 },
    expected: [{ keyword: "patternProperties", value: ["a", "ba"] }],
  },
  // additionalProperties: uncovered names in instance order.
  {
    name: "additionalProperties uncovered names, both keywords produce",
    schema: { properties: { a: {} }, additionalProperties: {} },
    instance: { a: 1, b: 2, c: 3 },
    expected: [
      { keyword: "properties", value: ["a"] },
      { keyword: "additionalProperties", value: ["b", "c"] },
    ],
  },
  // prefixItems: partial → n-1, full → true, empty → none, non-array → none.
  {
    name: "prefixItems partial coverage → largest index",
    schema: { prefixItems: [{}, {}] },
    instance: [1, 2, 3],
    expected: [{ keyword: "prefixItems", value: 1 }],
  },
  {
    name: "prefixItems full coverage → true",
    schema: { prefixItems: [{}, {}] },
    instance: [1, 2],
    expected: [{ keyword: "prefixItems", value: true }],
  },
  {
    name: "prefixItems empty array → no production",
    schema: { prefixItems: [{}] },
    instance: [],
    expected: [],
  },
  {
    name: "prefixItems non-array → no production",
    schema: { prefixItems: [{}] },
    instance: "x",
    expected: [],
  },
  // items: applied → true, nothing past prefix → none.
  {
    name: "items applied past prefix → true",
    schema: { prefixItems: [{}], items: {} },
    instance: [1, 2, 3],
    expected: [
      { keyword: "prefixItems", value: 0 },
      { keyword: "items", value: true },
    ],
  },
  {
    name: "items nothing past prefix → no items production",
    schema: { prefixItems: [{}, {}], items: {} },
    instance: [1, 2],
    expected: [{ keyword: "prefixItems", value: true }],
  },
  // contains: sparse list, all-match → true, minContains:0 zero matches.
  {
    name: "contains sparse matched-index list",
    schema: { contains: { type: "integer" } },
    instance: [1, "x", 2, "y", 3],
    expected: [{ keyword: "contains", value: [0, 2, 4] }],
  },
  {
    name: "contains all items match → true",
    schema: { contains: { type: "integer" } },
    instance: [1, 2, 3],
    expected: [{ keyword: "contains", value: true }],
  },
  {
    name: "contains minContains:0 with zero matches → valid, no production",
    schema: { contains: { type: "integer" }, minContains: 0 },
    instance: ["x", "y"],
    expected: [],
  },
  // unevaluatedProperties / unevaluatedItems over static coverage.
  {
    name: "unevaluatedProperties over allOf-of-properties coverage",
    schema: {
      allOf: [{ properties: { a: {} } }],
      properties: { b: {} },
      unevaluatedProperties: {},
    },
    instance: { a: 1, b: 2, c: 3 },
    expected: [
      { keyword: "properties", value: ["b"] },
      { keyword: "unevaluatedProperties", value: ["c"] },
    ],
  },
  {
    name: "unevaluatedItems over prefixItems coverage → true",
    schema: { prefixItems: [{}], unevaluatedItems: {} },
    instance: [1, 2, 3],
    expected: [
      { keyword: "prefixItems", value: 0 },
      { keyword: "unevaluatedItems", value: true },
    ],
  },
  // 2019-09: tuple + schema items, additionalItems, both unevaluated keywords.
  {
    name: "2019-09 items tuple form → largest index",
    schema: { ...DIALECT_2019, items: [{}, {}] },
    instance: [1, 2, 3],
    expected: [{ keyword: "items", value: 1 }],
  },
  {
    name: "2019-09 items schema form → true",
    schema: { ...DIALECT_2019, items: {} },
    instance: [1, 2],
    expected: [{ keyword: "items", value: true }],
  },
  {
    name: "2019-09 additionalItems past tuple → true",
    schema: { ...DIALECT_2019, items: [{}], additionalItems: {} },
    instance: [1, 2, 3],
    expected: [
      { keyword: "items", value: 0 },
      { keyword: "additionalItems", value: true },
    ],
  },
  {
    name: "2019-09 unevaluatedItems over items-tuple coverage",
    schema: { ...DIALECT_2019, items: [{}], unevaluatedItems: {} },
    instance: [1, 2, 3],
    expected: [
      { keyword: "items", value: 0 },
      { keyword: "unevaluatedItems", value: true },
    ],
  },
  {
    name: "2019-09 unevaluatedProperties over properties coverage",
    schema: {
      ...DIALECT_2019,
      properties: { a: {} },
      unevaluatedProperties: {},
    },
    instance: { a: 1, b: 2 },
    expected: [
      { keyword: "properties", value: ["a"] },
      { keyword: "unevaluatedProperties", value: ["b"] },
    ],
  },
  // draft-07 and draft-06: items/additionalItems.
  {
    name: "draft-07 items tuple + additionalItems",
    schema: { ...DIALECT_07, items: [{}], additionalItems: {} },
    instance: [1, 2, 3],
    expected: [
      { keyword: "items", value: 0 },
      { keyword: "additionalItems", value: true },
    ],
  },
  {
    name: "draft-06 items schema form → true",
    schema: { ...DIALECT_06, items: {} },
    instance: [1, 2],
    expected: [{ keyword: "items", value: true }],
  },
  // draft-04 (custom dialect package): items tuple form.
  {
    name: "draft-04 items tuple form → largest index",
    schema: { items: [{}, {}] },
    instance: [1, 2, 3],
    expected: [{ keyword: "items", value: 1 }],
    dialectUri: DIALECT_DRAFT_04,
    setup: registerDraft04,
  },
  // annotationOnly constants: value-is-the-annotation.
  {
    name: "annotationOnly title constant",
    schema: { title: "Hi" },
    instance: 5,
    expected: [{ keyword: "title", value: "Hi" }],
  },
  {
    name: "annotationOnly deprecated constant",
    schema: { deprecated: true },
    instance: 5,
    expected: [{ keyword: "deprecated", value: true }],
  },
  {
    name: "annotationOnly format-as-annotation constant",
    schema: { format: "email" },
    instance: "x",
    expected: [{ keyword: "format", value: "email" }],
  },
];

describe("Leg A — produce recipes match the interpreter and their pinned values", () => {
  for (const c of TABLE) {
    it(c.name, () => {
      const engine = createEngine();
      c.setup?.(engine);
      const uri = engine.registerSchema(
        c.schema,
        `https://recipes.example/${encodeURIComponent(c.name)}`,
        c.dialectUri,
      );
      const plan = buildPlan(engine, uri, { output: "flag" });
      const unit = plan.units.get(plan.rootKey)!;
      // Static classification is a precondition of lowering; a demotion to
      // interpreted would silently stop exercising the recipe.
      expect(unit.kind, `${c.name}: root unit must be static`).toBe("static");

      const { valid, oracle, interpreter, divergence } = contractCompare(
        engine,
        unit,
        c.instance,
      );
      // The contract is valid-only, so every table instance must be valid.
      expect(valid, `${c.name}: instance must be valid at the unit`).toBe(true);
      expect(
        divergence,
        `${c.name}: oracle ≠ interpreter: ${JSON.stringify(divergence)}`,
      ).toBeNull();
      // Pin the interpreter (not just agreement) and the oracle to the value.
      expect(interpreter, `${c.name}: interpreter productions`).toEqual(
        c.expected,
      );
      expect(oracle, `${c.name}: oracle productions`).toEqual(c.expected);
    });
  }
});

// ---------------------------------------------------------------------------
// Leg B — suite sweep. Every static, self-contained unit at every valid trace
// position, oracle vs the interpreter's own productions, with exact per-
// dialect totals pinned (the plan-census exactRun discipline: run once, record
// the numbers, a suite bump is a deliberate pin update).
// ---------------------------------------------------------------------------

interface SweepPin {
  dir: string;
  defaultDialect?: string;
  setup?: (engine: Engine) => void;
  pairs: number;
  productions: number;
}

// Transcribed from a local run (deterministic — two runs agree). `pairs` is
// every compared (unit, instance-position); `productions` the total compared
// productions. Both substantial by construction.
const SWEEP: Record<string, SweepPin> = {
  "draft2020-12": { dir: "draft2020-12", pairs: 1719, productions: 639 },
  "draft2019-09": {
    dir: "draft2019-09",
    defaultDialect: DIALECT_2019_09,
    pairs: 1753,
    productions: 622,
  },
  draft7: {
    dir: "draft7",
    defaultDialect: DIALECT_DRAFT_07,
    pairs: 1272,
    productions: 358,
  },
  draft6: {
    dir: "draft6",
    defaultDialect: DIALECT_DRAFT_06,
    pairs: 1155,
    productions: 310,
  },
  draft4: {
    dir: "draft4",
    defaultDialect: DIALECT_DRAFT_04,
    setup: registerDraft04,
    pairs: 902,
    productions: 263,
  },
};

interface SuiteGroup {
  description: string;
  schema: JsonValue;
  tests: { description: string; data: JsonValue }[];
}

function walkTrace(node: TraceNode, visit: (n: TraceNode) => void): void {
  visit(node);
  for (const child of node.children) walkTrace(child, visit);
}

async function sweepDialect(
  pin: SweepPin,
): Promise<{ pairs: number; productions: number }> {
  const suiteDir = join(SUITE_ROOT, "tests", pin.dir);
  const files = readdirSync(suiteDir)
    .filter((f) => f.endsWith(".json"))
    .sort();
  let pairs = 0;
  let productions = 0;
  for (const file of files) {
    const groups = JSON.parse(
      readFileSync(join(suiteDir, file), "utf8"),
    ) as SuiteGroup[];
    for (let gi = 0; gi < groups.length; gi++) {
      const group = groups[gi]!;
      const engine = createEngine({
        loaders: [suiteRemotesLoader(REMOTES)],
        ...(pin.defaultDialect ? { defaultDialect: pin.defaultDialect } : {}),
      });
      pin.setup?.(engine);
      let uri: string;
      let plan;
      try {
        uri = await engine.loadSchema(
          group.schema,
          `https://recipes.example/${pin.dir}/${file}/${String(gi)}`,
        );
        plan = buildPlan(engine, uri, { output: "flag" });
      } catch {
        // Registration/planning failures (remote misses, D19 non-schema) are
        // covered by other legs; the census pins the same skips deterministically.
        continue;
      }
      // Self-contained static subtrees only: their apply verdicts cannot
      // depend on dynamic scope, so the standalone oracle is sound.
      const staticUnits = new Map<string, PlannedUnit>();
      for (const unit of plan.units.values()) {
        if (unit.kind === "static" && !unit.reachesInterpreted) {
          staticUnits.set(unit.key, unit);
        }
      }
      const registry = engine.registry;
      for (const test of group.tests) {
        let root: TraceNode | null;
        let all: Production[];
        try {
          const { state } = runEvaluation(
            registry,
            uri,
            test.data,
            true, // tracing
            null,
            engine.patternCache,
          );
          root = state.traceRoot;
          all = state.allProductions ?? [];
        } catch {
          continue; // maxDepth/infinite-loop cases: verdict legs cover them
        }
        if (!root) continue;
        walkTrace(root, (node) => {
          if (!node.valid) return; // valid-only contract
          const key = `${node.schemaRef.baseUri}#${node.schemaRef.pointer}`;
          const unit = staticUnits.get(key);
          if (!unit) return;
          const oracle = evaluateProduceRecipes(
            registry,
            engine.patternCache,
            unit,
            node.cursor.value,
          );
          // Own productions of THIS application share the node's pathNode
          // identity; unknown keywords (null vocabulary) are out of scope.
          const interp = all
            .filter(
              (p) => p.pathNode === node.pathNode && p.vocabularyUri !== null,
            )
            .map((p) => ({ keyword: p.keywordName, value: p.value }));
          const divergence = compareProductions(
            oracle,
            interp,
            `${pin.dir} ${file}#${String(gi)} @ ${key}`,
          );
          if (divergence) {
            throw new Error(
              `produce recipe divergence in ${divergence.location} ` +
                `(keyword ${String(divergence.keyword)}, ${divergence.reason}): ` +
                `oracle=${JSON.stringify(divergence.oracle)} ` +
                `interpreter=${JSON.stringify(divergence.interpreter)} ` +
                `data=${JSON.stringify(test.data)}`,
            );
          }
          pairs++;
          productions += oracle.length;
        });
      }
    }
  }
  return { pairs, productions };
}

describe("Leg B — full suite sweep, oracle ≡ interpreter own productions", () => {
  for (const [name, pin] of Object.entries(SWEEP)) {
    it(`${name} agrees on every static unit and matches the pinned totals`, async () => {
      const { pairs, productions } = await sweepDialect(pin);
      expect({ pairs, productions }, `${name} sweep totals`).toEqual({
        pairs: pin.pairs,
        productions: pin.productions,
      });
    });
  }
});

// ---------------------------------------------------------------------------
// Leg C — planted-divergence self-test: the gate that would catch the gate.
// A custom keyword whose lower() recipe disagrees with its evaluate() must be
// REPORTED by the same comparison machinery Leg A trusts.
// ---------------------------------------------------------------------------

const PLANTED_VOCAB = "urn:jse:test:planted";

// evaluate() produces one value; lower()'s recipe a different one.
const plantedWrong: KeywordBehavior = {
  id: `${PLANTED_VOCAB}#plantedWrong`,
  analyze: () => ({ produces: [`${PLANTED_VOCAB}#plantedWrong`] }),
  evaluate: (_value, _cursor, ctx) => {
    ctx.produce(["real"]);
    return true;
  },
  lower: (_value, lctx) => {
    lctx.emit({ kind: "produce", value: { kind: "const", value: "wrong" } });
  },
};

// evaluate() produces; lower() omits the produce entirely.
const plantedMissing: KeywordBehavior = {
  id: `${PLANTED_VOCAB}#plantedMissing`,
  analyze: () => ({ produces: [`${PLANTED_VOCAB}#plantedMissing`] }),
  evaluate: (_value, _cursor, ctx) => {
    ctx.produce(true);
    return true;
  },
  lower: () => {
    /* deliberately emits no produce */
  },
};

function plantedEngine(): Engine {
  const engine = createEngine();
  engine.registerVocabulary(PLANTED_VOCAB, { plantedWrong, plantedMissing });
  engine.registerDialect(PLANTED_VOCAB + ":dialect", [PLANTED_VOCAB]);
  return engine;
}

function plantedUnit(engine: Engine, schema: JsonValue): OracleUnit {
  const uri = engine.registerSchema(
    schema,
    "https://planted.example/" + Math.random().toString(36).slice(2),
    PLANTED_VOCAB + ":dialect",
  );
  const plan = buildPlan(engine, uri, { output: "flag" });
  return plan.units.get(plan.rootKey)!;
}

describe("Leg C — planted divergences are reported by the comparison", () => {
  it("a wrong-value recipe is caught", () => {
    const engine = plantedEngine();
    const unit = plantedUnit(engine, { plantedWrong: 1 });
    const { valid, divergence } = contractCompare(engine, unit, 5);
    expect(valid).toBe(true);
    expect(divergence, "wrong-value recipe must diverge").not.toBeNull();
    expect(divergence?.keyword).toBe("plantedWrong");
    expect(divergence?.oracle).toEqual({
      keyword: "plantedWrong",
      value: "wrong",
    });
    expect(divergence?.interpreter).toEqual({
      keyword: "plantedWrong",
      value: ["real"],
    });
  });

  it("an omitted-produce recipe is caught", () => {
    const engine = plantedEngine();
    const unit = plantedUnit(engine, { plantedMissing: 1 });
    const { valid, divergence } = contractCompare(engine, unit, 5);
    expect(valid).toBe(true);
    expect(divergence, "omitted-produce recipe must diverge").not.toBeNull();
    expect(divergence?.keyword).toBe("plantedMissing");
    // The interpreter produced; the oracle did not.
    expect(divergence?.oracle).toBeUndefined();
    expect(divergence?.interpreter).toEqual({
      keyword: "plantedMissing",
      value: true,
    });
  });

  // Honest keywords still agree, so the reports above are the plant, not noise.
  it("an honest recipe does not diverge", () => {
    const engine = createEngine();
    const uri = engine.registerSchema(
      { properties: { a: {} } },
      "https://planted.example/honest",
    );
    const plan = buildPlan(engine, uri, { output: "flag" });
    const unit = plan.units.get(plan.rootKey)!;
    const { divergence } = contractCompare(engine, unit, { a: 1 });
    expect(divergence).toBeNull();
  });
});
