// The relevant level renders only applications with records at or below
// them. The interpreter prunes while building its located tree; a compiled
// evaluator builds its tree in emitted code and prunes it afterwards. Both
// must render the same documents, leave `trace` whole, and keep the verbose
// level unpruned.

import { describe, it, expect } from "vitest";
import { DYNAMIC_SEEDS } from "@json-schema-engine/test-kit";
import { createEngine, type JsonValue } from "@json-schema-engine/core";
import { compileEvaluator } from "@json-schema-engine/compiler";

const FORMATS = ["list", "hierarchical", "detailed"] as const;

const CASES: { name: string; schema: JsonValue; instances: JsonValue[] }[] = [
  {
    name: "mixed siblings",
    schema: {
      properties: {
        a: { properties: { b: { type: "string", title: "B" } } },
        c: { title: "C" },
        d: true,
      },
    },
    instances: [
      { a: { b: "x" }, c: 1, d: 2 },
      { a: { b: 1 }, c: 1, d: 2 },
    ],
  },
  {
    name: "false under a record-free ref hop",
    schema: {
      properties: { a: { $ref: "#/$defs/no" }, b: { type: "integer" } },
      $defs: { no: false },
    },
    instances: [{ a: 1, b: 2 }, { b: 2 }],
  },
  {
    name: "one of two items pruned",
    schema: { items: { $ref: "#/$defs/p" }, $defs: { p: { required: ["x"] } } },
    instances: [
      [{ x: 1 }, {}],
      [{ x: 1 }, { x: 2 }],
    ],
  },
  {
    name: "dynamic island subtrees",
    schema: DYNAMIC_SEEDS.unstableRecursive.schema,
    instances: [{}, { child: { child: {} } }, { child: 5 }],
  },
];

describe("relevant-level pruning: compiled ≡ interpreter", () => {
  for (const { name, schema, instances } of CASES) {
    for (const annotations of [false, true]) {
      it(`${name}, annotations ${annotations}`, () => {
        const engine = createEngine();
        const uri = engine.registerSchema(
          schema,
          `https://prune.example/${name.replace(/\W+/g, "-")}`,
        );
        const evaluator = compileEvaluator(engine, uri, { annotations });
        for (const instance of instances) {
          for (const output of FORMATS) {
            for (const trace of [false, true]) {
              const expected = engine.evaluate(uri, instance, {
                output,
                annotations,
                trace,
              });
              const actual = evaluator.evaluate(instance, { output, trace });
              expect(actual).toEqual(expected);
            }
          }
        }
      });
    }
  }
});

describe("the compiled relevant level prunes the document, never the trace", () => {
  const schema: JsonValue = {
    properties: { a: { properties: { b: { type: "string" } } }, d: true },
  };
  for (const output of FORMATS) {
    it(`${output} with trace`, () => {
      const engine = createEngine();
      const uri = engine.registerSchema(schema, "https://prune.example/gate");
      const evaluator = compileEvaluator(engine, uri);
      const result = evaluator.evaluate(
        { a: { b: "x" }, d: 1 },
        { output, trace: true },
      );
      expect(result.valid).toBe(true);
      expect(result.trace.children.map((c) => c.segments)).toEqual([
        ["properties", "a"],
        ["properties", "d"],
      ]);
      const document = result.outputDocument as unknown as Record<
        string,
        unknown
      >;
      // list: a `details` array with nothing in it; hierarchical: the root
      // unit alone; detailed: the root with no nested results.
      if (output === "list") expect(document.details).toEqual([]);
      else expect(document.details ?? document.annotations).toBeUndefined();
    });
  }

  it("the verbose level keeps every application", () => {
    const engine = createEngine();
    const uri = engine.registerSchema(schema, "https://prune.example/verbose");
    const evaluator = compileEvaluator(engine, uri, { verbose: true });
    const result = evaluator.evaluate(
      { a: { b: "x" }, d: 1 },
      { output: "hierarchical", verbose: true },
    );
    const document = result.outputDocument as {
      details?: { evaluationPath: string }[];
    };
    expect(document.details?.map((d) => d.evaluationPath)).toEqual([
      "/properties/a",
      "/properties/d",
    ]);
  });
});
