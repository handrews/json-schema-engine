// Compiled list-mode parity for draft-03 relevance: an accepting keyword's
// rejecting sub-evaluations leave no errors, a rejecting producer
// communicates no dependency data, and if/then/else are separate keyword
// results. The interpreter is the reference; results must match unit for
// unit and in order.

import { describe, it, expect } from "vitest";
import { createEngine, type JsonValue } from "@jse/core";
import { compileList, compileValidator } from "@jse/compiler";

const cases: { name: string; schema: JsonValue; instances: JsonValue[] }[] = [
  {
    name: "anyOf",
    schema: { anyOf: [{ type: "string" }, { type: "number" }], minimum: 10 },
    instances: [5, "x", 20],
  },
  {
    name: "oneOf",
    schema: { oneOf: [{ type: "number" }, { minimum: 0 }, { type: "string" }] },
    instances: [5, -1, "s", true],
  },
  {
    name: "not",
    schema: { not: { type: "string" } },
    instances: [5, "s"],
  },
  {
    name: "if/then/else",
    schema: {
      if: { type: "string" },
      then: { minLength: 3 },
      else: { minimum: 3 },
    },
    instances: [5, 1, "ab", "abc", true],
  },
  {
    name: "if without then/else",
    schema: { if: { type: "string" } },
    instances: [5, "s"],
  },
  {
    name: "contains",
    schema: { contains: { type: "string" } },
    instances: [[1, "a", 2], [1, 2], []],
  },
  {
    name: "contains with unevaluatedItems",
    schema: { contains: { type: "string" }, unevaluatedItems: false },
    instances: [[1, "a"], ["a"], [1]],
  },
  {
    name: "$ref into a rejecting branch",
    schema: {
      $defs: { s: { type: "string" } },
      anyOf: [{ $ref: "#/$defs/s" }, { type: "number" }],
    },
    instances: [5, true],
  },
  {
    name: "boolean false branch",
    schema: { anyOf: [false, { type: "number" }] },
    instances: [5, "s"],
  },
  {
    name: "Appendix D table 3 row 3",
    schema: {
      properties: { X: { type: "number" }, Y: { type: "number" } },
      unevaluatedProperties: false,
    },
    instances: [
      { X: "hello", Y: "world" },
      { X: 1, Y: 2, radius: 5 },
    ],
  },
  {
    name: "Appendix D table 5 row 4",
    schema: {
      $ref: "#/$defs/log",
      unevaluatedItems: false,
      $defs: {
        log: {
          prefixItems: [
            { type: "string" },
            { type: "string" },
            { type: "string" },
          ],
        },
      },
    },
    instances: [["t", 42], ["t", "u", "v", "w"], ["t"]],
  },
  {
    name: "if drives unevaluated coverage",
    schema: {
      if: { required: ["a"], properties: { a: true } },
      then: { properties: { b: true } },
      else: { properties: { c: true } },
      unevaluatedProperties: false,
    },
    instances: [{ a: 1, b: 2 }, { c: 3 }, { a: 1, c: 3 }, { b: 2 }],
  },
  {
    name: "nested combinators",
    schema: {
      allOf: [
        {
          anyOf: [
            { type: "string" },
            { properties: { a: { type: "number" } } },
          ],
        },
        { not: { required: ["z"] } },
      ],
      minProperties: 1,
    },
    instances: [{ a: 1 }, { a: "x" }, { z: 1 }, {}],
  },
];

describe("compiled list output matches the interpreter under relevance", () => {
  for (const c of cases) {
    it(c.name, () => {
      const engine = createEngine();
      const uri = engine.registerSchema(
        c.schema,
        `https://relevance.example/compiled/${encodeURIComponent(c.name)}`,
      );
      const plain = compileList(engine, uri);
      const params = compileList(engine, uri, { errorParams: true });
      const flag = compileValidator(engine, uri);
      for (const instance of c.instances) {
        const label = `${c.name} ${JSON.stringify(instance)}`;
        const expected = engine.evaluate(uri, instance, { output: "list" });
        const got = plain.evaluateList(instance);
        expect(got.valid, label).toBe(expected.valid);
        expect(got.errors, label).toEqual(expected.errors ?? []);
        const expectedParams = engine.evaluate(uri, instance, {
          output: "list",
          errorParams: true,
        });
        expect(params.evaluateList(instance).errors, label).toEqual(
          expectedParams.errors ?? [],
        );
        expect(flag.validate(instance), label).toBe(expected.valid);
      }
    });
  }
});
