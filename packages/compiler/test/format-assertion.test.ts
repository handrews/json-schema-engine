// Compiled format-assertion gate (M7 "runtime format-table lowering"). The
// asserting `format` behavior now lowers: a formatTest against the engine's
// format table, hoisted like a regex. Three legs:
//  - a plan census proving format assertion demotes nothing (the assertFormats
//    plan is byte-identical to the plain-engine plan — format lowers in both
//    postures, so no unit falls back "unlowerable" because of it);
//  - direct classification of known/unknown formats;
//  - the official optional/format-assertion suite through the compiled tier
//    (flag + list), compared to the interpreter with exact counts, zero skips.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createEngine,
  type Engine,
  type JsonValue,
} from "@json-schema-engine/core";
import { FORMATS_2020_12 } from "@json-schema-engine/formats";
import {
  buildPlan,
  compileEvaluator,
  compileValidator,
  compileList,
  explainCompilation,
} from "@json-schema-engine/compiler";
import {
  runPlanCensus,
  suiteRemotesLoader,
} from "@json-schema-engine/test-kit";

const SUITE_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "test-suite",
);
const REMOTES = join(SUITE_ROOT, "remotes");

// ---------------------------------------------------------------------------
// Leg 1 — plan census. The assertFormats plan must equal the plain plan unit
// for unit: format lowers under both the annotation-only default and the
// assertFormats posture, so enabling assertion changes classification nowhere.
// The pinned numbers duplicate plan-census.test.ts's draft2020-12 rows (which
// use the plain engine); the deep-equal below is what proves "zero format-
// caused fallback" — the pins are documentation of the shared shape.
// ---------------------------------------------------------------------------

interface CensusPin {
  groups: number;
  totalUnits: number;
  interpretedUnits: number;
  causes: Record<string, number>;
  trackingUnits: number;
  regionUnits: number;
}

const CENSUS: Record<"flag" | "list", CensusPin> = {
  flag: {
    groups: 383,
    totalUnits: 1338,
    interpretedUnits: 59,
    causes: { dynamic: 59 },
    trackingUnits: 20,
    regionUnits: 50,
  },
  // The 7 unlowerable units are the nested tracked consumers the region
  // fixpoint islands (plan-census.test.ts documents them); none is format-
  // caused, which the deep-equal against the plain plan asserts directly.
  list: {
    groups: 383,
    totalUnits: 1338,
    interpretedUnits: 66,
    causes: { dynamic: 59, unlowerable: 7 },
    trackingUnits: 76,
    regionUnits: 64,
  },
};

async function census(
  output: "flag" | "list",
  withFormats: boolean,
): Promise<CensusPin> {
  const r = await runPlanCensus({
    suiteDir: join(SUITE_ROOT, "tests", "draft2020-12"),
    loadAndPlan: async (schema, uri) => {
      try {
        const engine = createEngine({
          loaders: [suiteRemotesLoader(REMOTES)],
          ...(withFormats
            ? { formats: FORMATS_2020_12, assertFormats: true }
            : {}),
        });
        const loaded = await engine.loadSchema(schema, uri);
        return explainCompilation(buildPlan(engine, loaded, { output }));
      } catch {
        return undefined;
      }
    },
  });
  return {
    groups: r.groups,
    totalUnits: r.totalUnits,
    interpretedUnits: r.interpretedUnits,
    causes: r.causes,
    trackingUnits: r.trackingUnits,
    regionUnits: r.regionUnits,
  };
}

describe("Leg 1 — assertFormats plan census matches the plain-engine census", () => {
  for (const output of ["flag", "list"] as const) {
    it(`${output}: assertFormats plan equals plain plan and matches the pins`, async () => {
      const asserting = await census(output, true);
      const plain = await census(output, false);
      // Format assertion adds no fallback: the two censuses agree exactly.
      expect(asserting).toEqual(plain);
      expect(asserting).toEqual(CENSUS[output]);
    });
  }
});

// ---------------------------------------------------------------------------
// Leg 2 — direct classification. A known format stays static and lists its
// name in plan.formats; an unknown format under the best-effort posture also
// stays static but produce-only (no table entry needed, so plan.formats empty).
// ---------------------------------------------------------------------------

describe("Leg 2 — format-bearing schemas stay static", () => {
  const engine = createEngine({
    formats: FORMATS_2020_12,
    assertFormats: true,
  });

  it("a known format is static and appears in plan.formats", () => {
    const uri = engine.registerSchema(
      { format: "ipv4" },
      "https://fa.compile/known",
    );
    const plan = buildPlan(engine, uri, { output: "flag" });
    expect(plan.units.get(plan.rootKey)!.kind).toBe("static");
    expect(plan.formats).toEqual(["ipv4"]);
  });

  it("an unknown format is static and produce-only (no table entry)", () => {
    const uri = engine.registerSchema(
      { format: "no-such-format" },
      "https://fa.compile/unknown",
    );
    const plan = buildPlan(engine, uri, { output: "flag" });
    expect(plan.units.get(plan.rootKey)!.kind).toBe("static");
    expect(plan.formats).toEqual([]);
    // Produce-only: it compiles and passes any instance (annotation elided).
    expect(compileValidator(engine, uri).validate("anything")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Leg 3 — the official optional/format-assertion suite through the compiled
// tier. Custom metaschemas (remotes/) declare the format-assertion vocabulary
// true/false; the compiled flag validator and list evaluator must match the
// interpreter (and the suite's expected verdict) exactly, with zero skips.
// ---------------------------------------------------------------------------

interface SuiteGroup {
  description: string;
  schema: JsonValue;
  tests: { description: string; data: JsonValue; valid: boolean }[];
}

const FA_FILE = join(
  SUITE_ROOT,
  "tests",
  "draft2020-12",
  "optional",
  "format-assertion.json",
);

// Exact test count: two groups (format-assertion false/true metaschemas), two
// tests each. A suite bump is a one-glance pin update.
const FA_EXPECTED_RUN = 4;

function faEngine(): Engine {
  return createEngine({
    formats: FORMATS_2020_12,
    loaders: [suiteRemotesLoader(REMOTES)],
  });
}

describe("Leg 3 — compiled optional/format-assertion matches the interpreter", () => {
  const groups = JSON.parse(readFileSync(FA_FILE, "utf8")) as SuiteGroup[];

  it(`runs exactly ${String(FA_EXPECTED_RUN)} cases, compiled ≡ interpreter ≡ suite`, async () => {
    let run = 0;
    for (let gi = 0; gi < groups.length; gi++) {
      const group = groups[gi]!;
      const engine = faEngine();
      const uri = await engine.loadSchema(
        group.schema,
        `https://fa.compile/suite/${String(gi)}`,
      );
      const flag = compileValidator(engine, uri);
      const list = compileList(engine, uri, { errorParams: true });
      const evaluator = compileEvaluator(engine, uri, { errorParams: true });
      for (const test of group.tests) {
        run++;
        const label = `${group.description} / ${test.description}`;
        const interp = engine.evaluate(uri, test.data).valid;
        const interpList = engine.evaluate(uri, test.data, {
          output: "list",
          errorParams: true,
        });
        // Compiled flag verdict ≡ interpreter ≡ the suite's own expectation.
        expect(flag.validate(test.data), `${label}: flag`).toBe(interp);
        expect(interp, `${label}: interpreter vs suite`).toBe(test.valid);
        // Compiled list ≡ interpreter list (verdict + error units).
        const compiledList = list.evaluateList(test.data);
        expect(compiledList.valid, `${label}: list valid`).toBe(
          interpList.valid,
        );
        expect(compiledList.errors, `${label}: list errors`).toEqual(
          interpList.errors ?? [],
        );
        // Compiled evaluator ≡ interpreter, on both { output: "list" } and
        // { output: "hierarchical" } — the format-assertion vocabulary must
        // lower identically no matter which surface renders the verdict.
        const evalList = evaluator.evaluate(test.data, { output: "list" });
        expect(evalList.valid, `${label}: evaluator list valid`).toBe(
          interpList.valid,
        );
        expect(
          evalList.errors ?? [],
          `${label}: evaluator list errors`,
        ).toEqual(interpList.errors ?? []);
        const interpHier = engine.evaluate(uri, test.data, {
          output: "hierarchical",
          trace: true,
          errorParams: true,
        });
        const evalHier = evaluator.evaluate(test.data, {
          output: "hierarchical",
          trace: true,
        });
        expect(evalHier, `${label}: evaluator hierarchical`).toEqual(
          interpHier,
        );
      }
    }
    expect(run).toBe(FA_EXPECTED_RUN);
  });
});
