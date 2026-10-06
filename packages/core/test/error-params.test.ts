// Structured error params (D13): each failing keyword reports a params
// object alongside its message, surfaced only under the `errorParams`
// option. These pins define the params vocabulary — the compiled-list
// differential (compiler package) holds both tiers to it, and the Python
// engine reports the same shapes.

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
  it("type: expected names, the apparent type, and the value", () => {
    const [u] = failures({ type: "string" }, 42, "https://p.example/type");
    expect(u!.params).toEqual({
      expected: ["string"],
      actual: "integer",
      value: 42,
    });
    const [m] = failures(
      { type: ["string", "null"] },
      4.5,
      "https://p.example/type2",
    );
    expect(m!.params).toEqual({
      expected: ["string", "null"],
      actual: "number",
      value: 4.5,
    });
  });

  it("enum / const carry the allowed and the actual value", () => {
    const [e] = failures({ enum: [1, "a"] }, 2, "https://p.example/enum");
    expect(e!.params).toEqual({ allowedValues: [1, "a"], value: 2 });
    const [c] = failures({ const: { x: 1 } }, 2, "https://p.example/const");
    expect(c!.params).toEqual({ allowedValue: { x: 1 }, value: 2 });
  });

  it("numeric bounds carry {limit, value}", () => {
    const cases: [JsonValue, number, string][] = [
      [{ minimum: 3 }, 2, "minimum"],
      [{ maximum: 1 }, 2, "maximum"],
      [{ exclusiveMinimum: 2 }, 2, "exclusiveMinimum"],
      [{ exclusiveMaximum: 2 }, 2, "exclusiveMaximum"],
    ];
    for (const [schema, instance, kw] of cases) {
      const units = failures(schema, instance, `https://p.example/${kw}`);
      const limit = (schema as Record<string, JsonValue>)[kw];
      expect(only(units, kw).params, kw).toEqual({ limit, value: instance });
    }
  });

  it("lengths carry {limit, value, length}; counts carry {limit, count}", () => {
    const [short] = failures({ minLength: 3 }, "ab", "https://p.example/minl");
    expect(short!.params).toEqual({ limit: 3, value: "ab", length: 2 });
    const [long] = failures({ maxLength: 1 }, "𝄞𝄞", "https://p.example/maxl");
    expect(long!.params).toEqual({ limit: 1, value: "𝄞𝄞", length: 2 });
    const counts: [JsonValue, JsonValue, string, number][] = [
      [{ minItems: 2 }, [1], "minItems", 1],
      [{ maxItems: 1 }, [1, 2], "maxItems", 2],
      [{ minProperties: 2 }, { a: 1 }, "minProperties", 1],
      [{ maxProperties: 1 }, { a: 1, b: 2 }, "maxProperties", 2],
    ];
    for (const [schema, instance, kw, count] of counts) {
      const units = failures(schema, instance, `https://p.example/${kw}`);
      const limit = (schema as Record<string, JsonValue>)[kw];
      expect(only(units, kw).params, kw).toEqual({ limit, count });
    }
  });

  it("multipleOf / pattern carry the value", () => {
    const [m] = failures({ multipleOf: 3 }, 4, "https://p.example/mof");
    expect(m!.params).toEqual({ multipleOf: 3, value: 4 });
    const [p] = failures({ pattern: "^a" }, "b", "https://p.example/pat");
    expect(p!.params).toEqual({ pattern: "^a", value: "b" });
  });

  it("required: one error naming every missing property", () => {
    const units = failures(
      { required: ["a", "b", "c"] },
      { b: 1 },
      "https://p.example/req",
    );
    expect(units.map((u) => u.params)).toEqual([{ missing: ["a", "c"] }]);
    expect(units[0]!.error).toBe('missing required properties "a", "c"');
  });

  it("dependentRequired: one error, present name → missing dependencies", () => {
    const units = failures(
      { dependentRequired: { a: ["b", "c"], d: ["e"] } },
      { a: 1, c: 1 },
      "https://p.example/depreq",
    );
    expect(units.map((u) => u.params)).toEqual([{ missing: { a: ["b"] } }]);
    expect(units[0]!.error).toBe('"a" requires "b"');
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
    expect(units[0]!.params).toEqual({ missing: { a: ["b"] } });
  });

  it("uniqueItems reports every group of equal items", () => {
    const units = failures(
      { uniqueItems: true },
      [1, 2, 1, 2, 3],
      "https://p.example/uniq",
    );
    expect(units[0]!.params).toEqual({
      duplicates: [
        [0, 2],
        [1, 3],
      ],
    });
    expect(units[0]!.error).toBe(
      "items are not unique: [0, 2] are equal; [1, 3] are equal",
    );
  });

  it("contains reports count, matched indexes and bounds", () => {
    const units = failures(
      { contains: { type: "string" }, minContains: 2 },
      ["a", 1],
      "https://p.example/contains",
    );
    expect(only(units, "contains").params).toEqual({
      count: 1,
      matched: [0],
      minContains: 2,
    });
    const bounded = failures(
      { contains: { type: "string" }, maxContains: 1 },
      ["a", "b"],
      "https://p.example/contains2",
    );
    expect(only(bounded, "contains").params).toEqual({
      count: 2,
      matched: [0, 1],
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
    expect(only(one, "oneOf").error).toBe(
      "matched 2 branches (0, 1), expected exactly 1 of 2",
    );
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
    expect(result.errors![0]!.params).toEqual({ format: "ipv4", value: "x" });
  });

  it("an applicator names the keys a false subschema rejects", () => {
    const props = failures(
      { properties: { a: false, b: {} } },
      { a: 1, b: 2 },
      "https://p.example/props-false",
    );
    expect(props).toHaveLength(1);
    expect(only(props, "properties").params).toEqual({ properties: ["a"] });
    const extra = failures(
      { properties: { a: {} }, additionalProperties: false },
      { a: 1, b: 2, c: 3 },
      "https://p.example/ap-false",
    );
    expect(only(extra, "additionalProperties").params).toEqual({
      properties: ["b", "c"],
    });
    expect(only(extra, "additionalProperties").inputLocation).toBe("");
    const tail = failures(
      { prefixItems: [{}], items: false },
      [1, 2, 3],
      "https://p.example/items-false",
    );
    expect(only(tail, "items").params).toEqual({ start: 1, failed: [[1, 2]] });
    const branches = failures(
      { allOf: [{}, false, false] },
      1,
      "https://p.example/allof-false",
    );
    expect(only(branches, "allOf").params).toEqual({ failed: [1, 2] });
  });

  it("boolean false schema: params {} and no keyword field", () => {
    const units = failures(
      { $ref: "#/$defs/f", $defs: { f: false } },
      1,
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
