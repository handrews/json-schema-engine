// Compiled list/Basic output (D9e): interpreter-exact error units. The
// gate is the full local draft2020-12 suite compared element-by-element,
// ordered — list artifacts never short-circuit (DESIGN §7), so the error
// multiset AND order match Engine.evaluate(..., { output: "list" }).

import { describe, it, expect } from "vitest";
import { DYNAMIC_SEEDS } from "@json-schema-engine/test-kit";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createEngine, type JsonValue } from "@json-schema-engine/core";
import { compileList } from "@json-schema-engine/compiler";

const SUITE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "test-suite",
  "tests",
  "draft2020-12",
);

interface SuiteGroup {
  description: string;
  schema: JsonValue;
  tests: { description: string; data: JsonValue }[];
}

const runFullSuite = (errorParams: boolean): number => {
  let cases = 0;
  for (const file of readdirSync(SUITE_DIR).filter((f) =>
    f.endsWith(".json"),
  )) {
    const groups = JSON.parse(
      readFileSync(join(SUITE_DIR, file), "utf8"),
    ) as SuiteGroup[];
    groups.forEach((group, gi) => {
      const engine = createEngine();
      let uri: string;
      try {
        uri = engine.registerSchema(
          group.schema,
          `https://list.example/${file}/${String(gi)}`,
        );
      } catch {
        return; // remote-loader/D19 registration cases: other legs cover
      }
      const artifact = compileList(engine, uri, { errorParams });
      for (const test of group.tests) {
        cases++;
        let interpreted: unknown, compiled: unknown;
        try {
          const r = engine.evaluate(uri, test.data, {
            output: "list",
            errorParams,
          });
          interpreted = { valid: r.valid, errors: r.errors ?? [] };
        } catch (err) {
          interpreted = (err as Error).constructor.name;
        }
        try {
          const r = artifact.evaluateList(test.data);
          compiled = { valid: r.valid, errors: r.valid ? [] : r.errors };
        } catch (err) {
          compiled = (err as Error).constructor.name;
        }
        expect(compiled, `${file}#${String(gi)} ${test.description}`).toEqual(
          interpreted,
        );
      }
    });
  }
  return cases;
};

describe("compiled list output ≡ interpreter (full local suite)", () => {
  it("agrees on every case, ordered", () => {
    expect(runFullSuite(false)).toBeGreaterThan(1200);
  });

  it("agrees on every case with structured params (M8.1)", () => {
    expect(runFullSuite(true)).toBeGreaterThan(1200);
  });

  it("Basic adapter matches the interpreter's Basic document", () => {
    const engine = createEngine();
    const uri = engine.registerSchema(
      {
        type: "object",
        required: ["id"],
        properties: { id: { type: "integer" }, name: { minLength: 2 } },
      },
      "https://list.example/basic",
    );
    const artifact = compileList(engine, uri);
    // Invalid instances: exact Basic-document parity. Valid ones differ by
    // design — the interpreter's Basic document carries annotations, which
    // compiled artifacts do not collect (DESIGN §7 scope line).
    for (const instance of [{ name: "x" }, "nope"] as JsonValue[]) {
      const expected = engine.evaluate(uri, instance, {
        output: "basic",
      }).outputDocument;
      expect(artifact.basic(instance)).toEqual(expected);
    }
    const valid = artifact.basic({ id: 1, name: "ok" });
    expect(valid).toEqual({
      valid: true,
      keywordLocation: "",
      absoluteKeywordLocation: "https://list.example/basic#",
      instanceLocation: "",
    });
  });

  it("islands report errors through the list trampoline with full prefixes", () => {
    // An unstable $dynamicRef site (ADR 0004) is what still islands.
    const engine = createEngine();
    const uri = engine.registerSchema(
      DYNAMIC_SEEDS.unstableRecursive.schema,
      "https://list.example/dyn",
    );
    const artifact = compileList(engine, uri);
    expect(artifact.plan.targets.length).toBeGreaterThan(0);
    const bad = { child: { child: "not-an-object" } } as JsonValue;
    const expected = engine.evaluate(uri, bad, { output: "list" });
    const got = artifact.evaluateList(bad);
    expect(got.valid).toBe(false);
    expect(got).toEqual({ valid: expected.valid, errors: expected.errors });
  });

  it("island errors carry params through the list trampoline", () => {
    const engine = createEngine();
    const uri = engine.registerSchema(
      DYNAMIC_SEEDS.unstableRecursive.schema,
      "https://list.example/dynp",
    );
    const artifact = compileList(engine, uri, { errorParams: true });
    expect(artifact.plan.targets.length).toBeGreaterThan(0);
    const bad = { child: { child: "not-an-object" } } as JsonValue;
    const expected = engine.evaluate(uri, bad, {
      output: "list",
      errorParams: true,
    });
    const got = artifact.evaluateList(bad);
    expect(got).toEqual({ valid: expected.valid, errors: expected.errors });
    expect(got.errors.some((e) => e.keyword === "type")).toBe(true);
  });

  it("compiled params carry runtime pieces (duplicates, tally, sweeps)", () => {
    const engine = createEngine();
    const uri = engine.registerSchema(
      {
        type: "object",
        properties: {
          items: { uniqueItems: true },
          pick: { oneOf: [{ type: "integer" }, { minimum: 0 }] },
        },
        required: ["id"],
      },
      "https://list.example/params",
    );
    const artifact = compileList(engine, uri, { errorParams: true });
    const bad = { items: [1, 2, 1], pick: 3 } as JsonValue;
    const expected = engine.evaluate(uri, bad, {
      output: "list",
      errorParams: true,
    });
    const got = artifact.evaluateList(bad);
    expect(got).toEqual({ valid: false, errors: expected.errors });
    const byKeyword = Object.fromEntries(
      got.errors.map((e) => [e.keyword ?? "(schema)", e.params]),
    );
    expect(byKeyword.uniqueItems).toEqual({ duplicates: [0, 2] });
    expect(byKeyword.oneOf).toEqual({ passing: [0, 1] });
    expect(byKeyword.required).toEqual({ missingProperty: "id" });
  });

  it("D9e: valid instances allocate no error units (flag parity preserved)", () => {
    const engine = createEngine();
    const uri = engine.registerSchema(
      { properties: { a: { type: "string" } } },
      "https://list.example/lazy",
    );
    const artifact = compileList(engine, uri);
    const r = artifact.evaluateList({ a: "x" });
    expect(r).toEqual({ valid: true, errors: [] });
  });

  it("unevaluated* under a FAILING coverage contributor reports like the interpreter", () => {
    // Static coverage models the parent-success path only: when the allOf
    // branch's prefixItems fails, the interpreter drops its annotations and
    // unevaluatedItems reports additional errors. Verdict-invisible (flag
    // artifacts stay statically licensed), but list artifacts must
    // reproduce the interpreter's units exactly — found by the list-mode
    // fuzz leg, pinned here deterministically. Runtime evaluated-set
    // tracking is what makes COMPILING this consumer sound where static
    // licensing was not (the failed contributor's channel span truncates,
    // so the sweep covers less), so the list plan must classify it tracked
    // — never static-licensed, never demoted.
    const engine = createEngine();
    const uri = engine.registerSchema(
      {
        prefixItems: [{ type: "string" }],
        allOf: [{ prefixItems: [true, { type: "number" }], items: true }],
        unevaluatedItems: false,
      },
      "https://list.example/unevaluated-failing-contributor",
    );
    const artifact = compileList(engine, uri, { errorParams: true });
    const root = artifact.plan.units.get(artifact.plan.rootKey)!;
    expect(root.kind).toBe("static");
    expect(root.tracking).toBe(true);
    for (const instance of [
      [{ "/": 1 }, [], true] as JsonValue,
      [{}] as JsonValue,
      ["ok", 2] as JsonValue,
    ]) {
      const expected = engine.evaluate(uri, instance, {
        output: "list",
        errorParams: true,
      });
      const got = artifact.evaluateList(instance);
      expect(got.valid).toBe(expected.valid);
      expect(got.valid ? [] : got.errors).toEqual(expected.errors ?? []);
    }
  });
});
