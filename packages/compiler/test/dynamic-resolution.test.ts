// Static resolution of `$dynamicRef` (ADR 0004). The planner resolves a
// site at plan time when every path that can reach it yields the same
// target, and islands it otherwise. Three legs:
//   1. the fixture corpus classifies as declared, and every output surface of
//      a resolved site agrees with the interpreter;
//   2. over the official dynamicRef.json (plus unevaluated*'s dynamic cases),
//      the target the planner chose for each resolved site is the target the
//      interpreter actually applied — observed through its trace — and the
//      set of groups that still island is pinned by description;
//   3. the schemas the change was measured on plan with zero islands.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createEngine,
  type Engine,
  type JsonValue,
  type TraceUnit,
} from "@json-schema-engine/core";
import {
  buildPlan,
  compileEvaluator,
  compileList,
  compileValidator,
  explainCompilation,
} from "@json-schema-engine/compiler";
import {
  DYNAMIC_SEEDS,
  DYNAMIC_SEED_GROUPS,
  suiteRemotesLoader,
} from "@json-schema-engine/test-kit";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const SUITE_DIR = join(ROOT, "test-suite", "tests", "draft2020-12");
const REMOTES = join(ROOT, "test-suite", "remotes");

interface Group {
  description: string;
  schema: JsonValue;
  tests: { description: string; data: JsonValue; valid: boolean }[];
}

const readGroups = (file: string): Group[] =>
  JSON.parse(readFileSync(join(SUITE_DIR, file), "utf8")) as Group[];

/** Every `$dynamicRef` application the interpreter made: site unit → targets. */
function observedResolutions(
  engine: Engine,
  uri: string,
  instances: readonly JsonValue[],
): Map<string, Set<string>> {
  const observed = new Map<string, Set<string>>();
  const walk = (node: TraceUnit): void => {
    for (const child of node.children) {
      if (child.segments[0] === "$dynamicRef") {
        const targets = observed.get(node.schemaLocation) ?? new Set();
        targets.add(child.schemaLocation);
        observed.set(node.schemaLocation, targets);
      }
      walk(child);
    }
  };
  for (const instance of instances) {
    let trace: TraceUnit;
    try {
      trace = engine.evaluate(uri, instance, {
        output: "list",
        trace: true,
      }).trace;
    } catch {
      continue; // depth/loop cases: the verdict legs own those
    }
    walk(trace);
  }
  return observed;
}

describe("Leg 1 — fixture corpus: classification and output parity", () => {
  for (const group of DYNAMIC_SEED_GROUPS) {
    it(`${group.description}: plans as ${group.classification}`, () => {
      for (const output of ["flag", "list"] as const) {
        const engine = createEngine();
        const uri = engine.registerSchema(
          group.schema,
          "https://dyn.example/x",
        );
        const plan = buildPlan(engine, uri, { output });
        const explanation = explainCompilation(plan);
        if (group.classification === "static") {
          expect(plan.targets, output).toHaveLength(0);
          expect(
            explanation.resolvedDynamicSites.length,
            output,
          ).toBeGreaterThan(0);
        } else {
          expect(
            plan.targets.filter((t) => t.cause === "dynamic").length,
            output,
          ).toBeGreaterThan(0);
        }
      }
    });

    it(`${group.description}: every surface agrees with the interpreter`, () => {
      const engine = createEngine();
      const uri = engine.registerSchema(group.schema, "https://dyn.example/x");
      const flag = compileValidator(engine, uri);
      const list = compileList(engine, uri, {
        errorParams: true,
        annotations: true,
      });
      const evaluator = compileEvaluator(engine, uri, {
        errorParams: true,
        annotations: true,
      });
      for (const t of group.tests) {
        expect(flag.validate(t.data), t.description).toBe(t.valid);
        const expected = engine.evaluate(uri, t.data, {
          output: "list",
          errorParams: true,
          annotations: true,
        });
        const got = list.evaluateList(t.data);
        expect(got.valid, t.description).toBe(t.valid);
        expect(got.errors, t.description).toEqual(expected.errors ?? []);
        expect(got.annotations, t.description).toEqual(expected.annotations);
        const hier = engine.evaluate(uri, t.data, {
          output: "hierarchical",
          errorParams: true,
          annotations: true,
          trace: true,
        });
        const compiledHier = evaluator.evaluate(t.data, {
          output: "hierarchical",
          trace: true,
        });
        expect(compiledHier.outputDocument, t.description).toEqual(
          hier.outputDocument,
        );
        expect(compiledHier.trace, t.description).toEqual(hier.trace);
      }
    });
  }
});

describe("Leg 2 — official suite: planned targets are the interpreter's targets", () => {
  // The groups whose sites the planner cannot prove stable, by description.
  const EXPECTED_ISLANDS = new Set([
    "multiple dynamic paths to the $dynamicRef keyword",
  ]);

  // Every dynamicRef.json group (several reach their site through a suite
  // remote, so no textual filter), plus unevaluated*'s dynamic groups.
  const cases: { file: string; group: Group; gi: number }[] = [];
  readGroups("dynamicRef.json").forEach((group, gi) => {
    cases.push({ file: "dynamicRef.json", group, gi });
  });
  for (const file of ["unevaluatedItems.json", "unevaluatedProperties.json"]) {
    readGroups(file).forEach((group, gi) => {
      if (JSON.stringify(group.schema).includes('"$dynamicRef"')) {
        cases.push({ file, group, gi });
      }
    });
  }

  it("covers the whole dynamicRef.json file plus unevaluated*'s dynamic groups", () => {
    expect(cases.filter((c) => c.file === "dynamicRef.json").length).toBe(
      readGroups("dynamicRef.json").length,
    );
    expect(cases.length).toBeGreaterThan(21);
  });

  for (const { file, group, gi } of cases) {
    it(`${file}#${String(gi)} ${group.description}`, async () => {
      const engine = createEngine({ loaders: [suiteRemotesLoader(REMOTES)] });
      const uri = await engine.loadSchema(
        group.schema,
        `https://dyn-suite.example/${file}/${String(gi)}`,
      );
      const plan = buildPlan(engine, uri);
      const explanation = explainCompilation(plan);
      const islanded = plan.targets.some((t) => t.cause === "dynamic");
      expect(islanded, "island classification").toBe(
        EXPECTED_ISLANDS.has(group.description),
      );
      const observed = observedResolutions(
        engine,
        uri,
        group.tests.map((t) => t.data),
      );
      for (const site of explanation.resolvedDynamicSites) {
        const seen = observed.get(site.unit);
        if (seen === undefined) continue; // site not reached by these instances
        expect([...seen], `${site.unit} → ${site.target}`).toEqual([
          site.target,
        ]);
      }
      // And the compiled verdicts still match the suite.
      const flag = compileValidator(engine, uri);
      for (const t of group.tests) {
        expect(flag.validate(t.data), t.description).toBe(t.valid);
      }
    });
  }
});

describe("Leg 3 — the measured schemas plan with zero islands", () => {
  it("OpenAPI 3.1: four sites resolve to the root's `meta` anchor", () => {
    const schema = JSON.parse(
      readFileSync(
        join(ROOT, "bench", "corpora", "oas-3.1-schema.json"),
        "utf8",
      ),
    ) as JsonValue;
    const engine = createEngine();
    const uri = engine.registerSchema(
      schema,
      "https://spec.openapis.org/oas/3.1/schema/2025-09-15",
    );
    const explanation = explainCompilation(buildPlan(engine, uri));
    expect(explanation.interpretedUnits).toBe(0);
    expect(explanation.resolvedDynamicSites).toHaveLength(4);
    for (const site of explanation.resolvedDynamicSites) {
      expect(site.winner).toBe(
        "https://spec.openapis.org/oas/3.1/schema/2025-09-15",
      );
    }
  });

  it("the 2020-12 metaschema as root, and a plain root that $refs it", () => {
    const engine = createEngine();
    const meta = explainCompilation(
      buildPlan(engine, "https://json-schema.org/draft/2020-12/schema"),
    );
    expect(meta.interpretedUnits).toBe(0);
    expect(meta.resolvedDynamicSites.length).toBeGreaterThan(10);
    for (const site of meta.resolvedDynamicSites) {
      expect(site.winner).toBe("https://json-schema.org/draft/2020-12/schema");
    }
    const wrapperUri = engine.registerSchema(
      DYNAMIC_SEEDS.metaschemaWrapper.schema,
      "https://dyn.example/wrapper",
    );
    const wrapper = explainCompilation(buildPlan(engine, wrapperUri));
    expect(wrapper.interpretedUnits).toBe(0);
    expect(wrapper.resolvedDynamicSites.length).toBe(
      meta.resolvedDynamicSites.length,
    );
  });
});
