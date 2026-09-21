// Static resolution of `$recursiveRef` (ADR 0004, amended): 2019-09's
// degenerate dynamic reference goes through the same per-root dataflow as
// `$dynamicRef`, with "the resource's root declares $recursiveAnchor: true"
// as the declarer predicate and the winner's root as the target. Same three
// legs as dynamic-resolution.test.ts:
//   1. the recursive fixture corpus classifies as declared, and every output
//      surface of a resolved site agrees with the interpreter;
//   2. over the official recursiveRef.json (plus unevaluated*'s recursive
//      cases), the target the planner chose for each resolved site is the
//      target the interpreter actually applied — observed through its trace
//      — and the set of groups that still island is pinned by description;
//   3. the 2019-09 metaschema plans with zero islands, as root and behind a
//      plain `$ref`, and a root self-loop is a cycle island on both tiers.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createEngine,
  DIALECT_2019_09,
  InfiniteLoopError,
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
  RECURSIVE_SEEDS,
  RECURSIVE_SEED_GROUPS,
  suiteRemotesLoader,
} from "@json-schema-engine/test-kit";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const SUITE_DIR = join(ROOT, "test-suite", "tests", "draft2019-09");
const REMOTES = join(ROOT, "test-suite", "remotes");

interface Group {
  description: string;
  schema: JsonValue;
  tests: { description: string; data: JsonValue; valid: boolean }[];
}

const readGroups = (file: string): Group[] =>
  JSON.parse(readFileSync(join(SUITE_DIR, file), "utf8")) as Group[];

const engine2019 = (loaders = false): Engine =>
  createEngine({
    defaultDialect: DIALECT_2019_09,
    ...(loaders ? { loaders: [suiteRemotesLoader(REMOTES)] } : {}),
  });

/** Every `$recursiveRef` application the interpreter made: site unit → targets. */
function observedResolutions(
  engine: Engine,
  uri: string,
  instances: readonly JsonValue[],
): Map<string, Set<string>> {
  const observed = new Map<string, Set<string>>();
  const walk = (node: TraceUnit): void => {
    for (const child of node.children) {
      if (child.segments[0] === "$recursiveRef") {
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
  for (const group of RECURSIVE_SEED_GROUPS) {
    it(`${group.description}: plans as ${group.classification}`, () => {
      for (const output of ["flag", "list"] as const) {
        const engine = engine2019();
        const uri = engine.registerSchema(
          group.schema,
          "https://rec.example/x",
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
      const engine = engine2019();
      const uri = engine.registerSchema(group.schema, "https://rec.example/x");
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

  it("names the winner: the extension's root, not the lexical base", () => {
    const engine = engine2019();
    const uri = engine.registerSchema(
      RECURSIVE_SEEDS.stableExtension.schema,
      "https://rec.example/ext",
    );
    const sites = explainCompilation(
      buildPlan(engine, uri),
    ).resolvedDynamicSites;
    expect(sites).toEqual([
      {
        unit: "https://rec.example/stable-extension-base#/properties/children/items",
        keyword: "$recursiveRef",
        ref: "#",
        target: "https://rec.example/stable-extension#",
        winner: "https://rec.example/stable-extension",
      },
    ]);
  });

  it("marks lexical resolutions with a null winner", () => {
    const engine = engine2019();
    for (const name of ["noAnchor", "pointerFragment"] as const) {
      const uri = engine.registerSchema(
        RECURSIVE_SEEDS[name].schema,
        `https://rec.example/${name}`,
      );
      const sites = explainCompilation(
        buildPlan(engine, uri),
      ).resolvedDynamicSites;
      expect(sites.length, name).toBeGreaterThan(0);
      for (const site of sites) expect(site.winner, name).toBeNull();
    }
    // A fragment-less external target from a silent root stays lexical at
    // the root's site; the target's own site rebinds to the target itself.
    const uri = engine.registerSchema(
      RECURSIVE_SEEDS.externalLexical.schema,
      "https://rec.example/externalLexical",
    );
    const sites = explainCompilation(
      buildPlan(engine, uri),
    ).resolvedDynamicSites;
    expect(sites.map((s) => [s.unit, s.winner])).toEqual([
      ["https://rec.example/external-lexical#/properties/item", null],
      [
        "https://rec.example/other#/properties/item",
        "https://rec.example/other",
      ],
    ]);
  });
});

describe("Leg 2 — official suite: planned targets are the interpreter's targets", () => {
  // The groups whose sites the planner cannot prove stable, by description.
  const EXPECTED_ISLANDS = new Set([
    "multiple dynamic paths to the $recursiveRef keyword",
    "dynamic $recursiveRef destination (not predictable at schema compile time)",
  ]);

  const cases: { file: string; group: Group; gi: number }[] = [];
  readGroups("recursiveRef.json").forEach((group, gi) => {
    cases.push({ file: "recursiveRef.json", group, gi });
  });
  for (const file of ["unevaluatedItems.json", "unevaluatedProperties.json"]) {
    readGroups(file).forEach((group, gi) => {
      if (JSON.stringify(group.schema).includes('"$recursiveRef"')) {
        cases.push({ file, group, gi });
      }
    });
  }

  it("covers the whole recursiveRef.json file plus unevaluated*'s recursive groups", () => {
    expect(cases.filter((c) => c.file === "recursiveRef.json").length).toBe(
      readGroups("recursiveRef.json").length,
    );
    expect(cases.length).toBe(readGroups("recursiveRef.json").length + 2);
  });

  for (const { file, group, gi } of cases) {
    it(`${file}#${String(gi)} ${group.description}`, async () => {
      const engine = engine2019(true);
      const uri = await engine.loadSchema(
        group.schema,
        `https://rec-suite.example/${file}/${String(gi)}`,
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

describe("Leg 3 — the metaschema and the degenerate shapes", () => {
  it("the 2019-09 metaschema as root: every site resolves to its root", () => {
    const engine = engine2019();
    const meta = explainCompilation(buildPlan(engine, DIALECT_2019_09));
    expect(meta.interpretedUnits).toBe(0);
    expect(meta.resolvedDynamicSites).toHaveLength(19);
    for (const site of meta.resolvedDynamicSites) {
      expect(site.keyword).toBe("$recursiveRef");
      expect(site.winner).toBe(DIALECT_2019_09);
      expect(site.target).toBe(`${DIALECT_2019_09}#`);
    }
  });

  it("a plain root that $refs the metaschema plans the same sites", () => {
    const engine = engine2019();
    const uri = engine.registerSchema(
      RECURSIVE_SEEDS.metaschemaWrapper.schema,
      "https://rec.example/wrapper",
    );
    const wrapper = explainCompilation(buildPlan(engine, uri));
    expect(wrapper.interpretedUnits).toBe(0);
    expect(wrapper.resolvedDynamicSites).toHaveLength(19);
    for (const site of wrapper.resolvedDynamicSites) {
      expect(site.winner).toBe(DIALECT_2019_09);
    }
  });

  it("a root self-loop is a cycle island, and both tiers throw InfiniteLoopError", () => {
    const engine = engine2019();
    const uri = engine.registerSchema(
      { $recursiveAnchor: true, $recursiveRef: "#" },
      "https://rec.example/self-loop",
    );
    const summary = explainCompilation(buildPlan(engine, uri));
    expect(summary.causes).toEqual({ cycle: 1 });
    expect(() => engine.evaluate(uri, 1)).toThrow(InfiniteLoopError);
    expect(() => compileValidator(engine, uri).validate(1)).toThrow(
      InfiniteLoopError,
    );
  });
});
