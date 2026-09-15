// Structured error params (D13, M8.1): each failing keyword reports a
// params object alongside its message, surfaced only under the
// `errorParams` option. These pins define the params vocabulary — the
// compiled-list differential (compiler package) holds both tiers to it.

import { describe, it, expect } from "vitest";
import {
  createEngine,
  type JsonValue,
  type ErrorUnit,
} from "@json-schema-engine/core";

const failures = (
  schema: JsonValue,
  instance: JsonValue,
  uri: string,
): ErrorUnit[] => {
  const engine = createEngine();
  const id = engine.registerSchema(schema, uri);
  const result = engine.evaluate(id, instance, {
    output: "list",
    errorParams: true,
  });
  expect(result.valid).toBe(false);
  return result.errors!;
};

const only = (units: ErrorUnit[], keyword: string): ErrorUnit => {
  const hits = units.filter((u) => u.keyword === keyword);
  expect(hits).toHaveLength(1);
  return hits[0]!;
};

describe("errorParams pins (the params vocabulary)", () => {
  it("type", () => {
    const [u] = failures({ type: "string" }, 42, "https://p.example/type");
    expect(u!.params).toEqual({ expected: "string" });
    const [m] = failures(
      { type: ["string", "null"] },
      42,
      "https://p.example/type2",
    );
    expect(m!.params).toEqual({ expected: ["string", "null"] });
  });

  it("enum / const", () => {
    const [e] = failures({ enum: [1, "a"] }, 2, "https://p.example/enum");
    expect(e!.params).toEqual({ allowedValues: [1, "a"] });
    const [c] = failures({ const: { x: 1 } }, 2, "https://p.example/const");
    expect(c!.params).toEqual({ allowedValue: { x: 1 } });
  });

  it("bounds carry {limit}", () => {
    const cases: [JsonValue, JsonValue, string][] = [
      [{ minLength: 3 }, "ab", "minLength"],
      [{ maxLength: 1 }, "ab", "maxLength"],
      [{ minItems: 2 }, [1], "minItems"],
      [{ maxItems: 1 }, [1, 2], "maxItems"],
      [{ minProperties: 2 }, { a: 1 }, "minProperties"],
      [{ maxProperties: 1 }, { a: 1, b: 2 }, "maxProperties"],
      [{ minimum: 3 }, 2, "minimum"],
      [{ maximum: 1 }, 2, "maximum"],
      [{ exclusiveMinimum: 2 }, 2, "exclusiveMinimum"],
      [{ exclusiveMaximum: 2 }, 2, "exclusiveMaximum"],
    ];
    for (const [schema, instance, kw] of cases) {
      const units = failures(schema, instance, `https://p.example/${kw}`);
      const limit = (schema as Record<string, JsonValue>)[kw];
      expect(only(units, kw).params, kw).toEqual({ limit });
    }
  });

  it("multipleOf / pattern / format-shaped values", () => {
    const [m] = failures({ multipleOf: 3 }, 4, "https://p.example/mof");
    expect(m!.params).toEqual({ multipleOf: 3 });
    const [p] = failures({ pattern: "^a" }, "b", "https://p.example/pat");
    expect(p!.params).toEqual({ pattern: "^a" });
  });

  it("required: one error per missing property, each with missingProperty", () => {
    const units = failures(
      { required: ["a", "b", "c"] },
      { b: 1 },
      "https://p.example/req",
    );
    expect(units.map((u) => u.params)).toEqual([
      { missingProperty: "a" },
      { missingProperty: "c" },
    ]);
  });

  it("dependentRequired", () => {
    const units = failures(
      { dependentRequired: { a: ["b"] } },
      { a: 1 },
      "https://p.example/depreq",
    );
    expect(units[0]!.params).toEqual({ property: "a", missingProperty: "b" });
  });

  it("draft-07 dependencies (required form)", () => {
    const units = failures(
      {
        $schema: "http://json-schema.org/draft-07/schema#",
        dependencies: { a: ["b"] },
      },
      { a: 1 },
      "https://p.example/dep7",
    );
    expect(units[0]!.params).toEqual({ property: "a", missingProperty: "b" });
  });

  it("uniqueItems reports the first duplicate pair", () => {
    const units = failures(
      { uniqueItems: true },
      [1, 2, 1],
      "https://p.example/uniq",
    );
    expect(units[0]!.params).toEqual({ duplicates: [0, 2] });
  });

  it("contains reports count and bounds", () => {
    const units = failures(
      { contains: { type: "string" }, minContains: 2 },
      ["a", 1],
      "https://p.example/contains",
    );
    expect(only(units, "contains").params).toEqual({
      count: 1,
      minContains: 2,
    });
    const bounded = failures(
      { contains: { type: "string" }, maxContains: 1 },
      ["a", "b"],
      "https://p.example/contains2",
    );
    expect(only(bounded, "contains").params).toEqual({
      count: 2,
      minContains: 1,
      maxContains: 1,
    });
  });

  it("oneOf reports the passing branch indexes; anyOf/not stay empty", () => {
    const one = failures(
      { oneOf: [{ type: "integer" }, { minimum: 0 }] },
      3,
      "https://p.example/oneof",
    );
    expect(only(one, "oneOf").params).toEqual({ passing: [0, 1] });
    const none = failures(
      { oneOf: [{ type: "string" }] },
      3,
      "https://p.example/oneof0",
    );
    expect(only(none, "oneOf").params).toEqual({ passing: [] });
    const any = failures(
      { anyOf: [{ type: "string" }] },
      3,
      "https://p.example/anyof",
    );
    expect(only(any, "anyOf").params).toEqual({});
    const not = failures(
      { not: { type: "integer" } },
      3,
      "https://p.example/not",
    );
    expect(only(not, "not").params).toEqual({});
  });

  it("format under assertFormats", () => {
    const engine = createEngine({
      formats: { ipv4: { test: () => false } },
      assertFormats: true,
    });
    const id = engine.registerSchema(
      { format: "ipv4" },
      "https://p.example/fmt",
    );
    const result = engine.evaluate(id, "x", {
      output: "list",
      errorParams: true,
    });
    expect(result.errors![0]!.params).toEqual({ format: "ipv4" });
  });

  it("boolean false schema: params {} and no keyword field", () => {
    const units = failures(
      { properties: { a: false } },
      { a: 1 },
      "https://p.example/false",
    );
    expect(units[0]!.keyword).toBeUndefined();
    expect(units[0]!.params).toEqual({});
  });

  it("off by default: units carry neither keyword nor params", () => {
    const engine = createEngine();
    const id = engine.registerSchema(
      { type: "string" },
      "https://p.example/off",
    );
    const result = engine.evaluate(id, 42, { output: "list" });
    expect(result.errors![0]).not.toHaveProperty("keyword");
    expect(result.errors![0]).not.toHaveProperty("params");
  });
});
