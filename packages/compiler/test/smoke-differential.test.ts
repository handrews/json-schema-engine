// M6.2 smoke differential: compiled ≡ interpreter (flag verdicts) over the
// exemplar-keyword schemas and the mandated suite subset. Files with
// keywords outside the exemplar set still pass — their nodes classify as
// interpreted units and trampoline, which is the fallback working as
// designed, not a gap.

import { describe, it, expect } from "vitest";
import { DYNAMIC_SEEDS } from "@json-schema-engine/test-kit";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { createEngine, type JsonValue } from "@json-schema-engine/core";
import {
  compileValidator,
  explainCompilation,
} from "@json-schema-engine/compiler";

const SUITE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "test-suite",
  "tests",
  "draft2020-12",
);

// The M6.2 done-signal set: exemplar keywords, references, dynamic scope
// (island classification + agreement), cycles, and a metaschema-$ref case.
const FILES = [
  "properties",
  "ref",
  "anyOf",
  "unevaluatedProperties",
  "dynamicRef",
  "infinite-loop-detection",
  "pattern",
  "type",
];

interface SuiteGroup {
  description: string;
  schema: JsonValue;
  tests: { description: string; data: JsonValue; valid: boolean }[];
}

describe("compiled ≡ interpreted (M6.2 smoke differential)", () => {
  let caseCount = 0;

  for (const file of FILES) {
    const groups = JSON.parse(
      readFileSync(join(SUITE_DIR, `${file}.json`), "utf8"),
    ) as SuiteGroup[];

    describe(file, () => {
      groups.forEach((group, gi) => {
        it(group.description, () => {
          const engine = createEngine();
          let uri: string;
          try {
            uri = engine.registerSchema(
              group.schema,
              `https://smoke.example/${file}/${String(gi)}`,
            );
          } catch {
            // Registration-time rejections (D19/remote-refs needing loaders)
            // are out of scope here; the full-suite leg covers them.
            return;
          }
          let compiled;
          try {
            compiled = compileValidator(engine, uri);
          } catch (err) {
            // Plan-time errors are compiler bugs — fallback should absorb
            // everything. Fail loudly with the schema for reproduction.
            throw new Error(
              `compileValidator threw for ${JSON.stringify(group.schema)}`,
              { cause: err },
            );
          }
          for (const test of group.tests) {
            let interpreted: boolean | { threw: string };
            let compiledResult: boolean | { threw: string };
            try {
              interpreted = engine.evaluate(uri, test.data).valid;
            } catch (err) {
              interpreted = { threw: (err as Error).constructor.name };
            }
            try {
              compiledResult = compiled.validate(test.data);
            } catch (err) {
              compiledResult = { threw: (err as Error).constructor.name };
            }
            caseCount++;
            expect(compiledResult, test.description).toEqual(interpreted);
          }
        });
      });
    });
  }

  it("exercised a real case volume", () => {
    expect(caseCount).toBeGreaterThan(300);
  });

  it("actually compiles static units (not everything falls back)", () => {
    const engine = createEngine();
    const uri = engine.registerSchema(
      {
        type: "object",
        properties: {
          name: { type: "string", pattern: "^[a-z]+$" },
          tags: { anyOf: [{ type: "string" }, { type: "array" }] },
        },
      },
      "https://smoke.example/static-proof",
    );
    const { plan, validate, source } = compileValidator(engine, uri);
    const kinds = [...plan.units.values()].map((u) => u.kind);
    expect(kinds.every((k) => k === "static")).toBe(true);
    expect(source).not.toContain("frag(");
    expect(validate({ name: "ok", tags: "x" })).toBe(true);
    expect(validate({ name: "NOPE" })).toBe(false);
  });

  it("resolves a root-anchored $dynamicRef statically and still agrees", () => {
    const engine = createEngine();
    const uri = engine.registerSchema(
      {
        $id: "https://smoke.example/dyn-tree",
        $dynamicAnchor: "node",
        type: "object",
        properties: {
          data: true,
          children: {
            type: "array",
            items: { $dynamicRef: "#node" },
          },
        },
      },
      "https://smoke.example/dyn-tree",
    );
    const { plan, validate } = compileValidator(engine, uri);
    expect(plan.targets).toHaveLength(0);
    expect(explainCompilation(plan).resolvedDynamicSites).toEqual([
      {
        unit: "https://smoke.example/dyn-tree#/properties/children/items",
        keyword: "$dynamicRef",
        ref: "#node",
        target: "https://smoke.example/dyn-tree#",
        winner: "https://smoke.example/dyn-tree",
      },
    ]);
    const ok = { data: 1, children: [{ data: 2, children: [] }] };
    const bad = { data: 1, children: [{ data: 2, children: [3] }] };
    expect(validate(ok)).toBe(engine.evaluate(uri, ok).valid);
    expect(validate(bad)).toBe(engine.evaluate(uri, bad).valid);
    expect(validate(ok)).toBe(true);
    expect(validate(bad)).toBe(false);
  });

  it("classifies an unstable $dynamicRef site as an island and still agrees", () => {
    const engine = createEngine();
    const group = DYNAMIC_SEEDS.unstableTwoPaths;
    const uri = engine.registerSchema(
      group.schema,
      "https://smoke.example/unstable",
    );
    const { plan, validate } = compileValidator(engine, uri);
    expect(plan.targets.length).toBeGreaterThan(0);
    for (const t of group.tests) {
      expect(validate(t.data), t.description).toBe(t.valid);
      expect(validate(t.data), t.description).toBe(
        engine.evaluate(uri, t.data).valid,
      );
    }
  });

  it("static unevaluatedProperties lowers with own-trio coverage", () => {
    const engine = createEngine();
    const uri = engine.registerSchema(
      {
        properties: { a: { type: "integer" } },
        patternProperties: { "^x": { type: "string" } },
        unevaluatedProperties: false,
      },
      "https://smoke.example/unevaluated-static",
    );
    const { plan, validate } = compileValidator(engine, uri);
    const root = plan.units.get(plan.rootKey)!;
    expect(root.kind).toBe("static");
    for (const instance of [
      { a: 1 },
      { a: 1, xray: "s" },
      { a: 1, other: true },
      { xray: 2 },
      {},
      "not an object",
    ] as JsonValue[]) {
      expect(validate(instance)).toBe(engine.evaluate(uri, instance).valid);
    }
  });
});
