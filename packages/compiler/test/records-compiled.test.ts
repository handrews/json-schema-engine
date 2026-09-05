// Compiled-tier parity for the two channel record kinds: annotation output
// carries keyword values only (ADR 0002), while dependency data still reaches
// compiled consumers through the coverage channel.

import { describe, it, expect } from "vitest";
import { createEngine, type JsonValue } from "@jse/core";
import { compileList, compileValidator } from "@jse/compiler";

const schema: JsonValue = {
  title: "Record kinds",
  default: { nested: [1, { deep: true }] },
  type: "object",
  properties: {
    a: { type: "string", format: "email" },
    list: {
      prefixItems: [true],
      contains: { type: "string" },
      unevaluatedItems: true,
    },
    other: { items: true },
  },
  patternProperties: { "^x": true },
  additionalProperties: { title: "extra" },
  unevaluatedProperties: false,
  "x-note": ["vendor", { data: 1 }],
};

const instance: JsonValue = {
  a: "x@y.z",
  list: [1, "s", 2],
  other: [3],
  xq: 2,
  extra: 3,
};

describe("compiled annotation output", () => {
  it("equals the interpreter's and carries no applicator keyword", () => {
    const engine = createEngine();
    const uri = engine.registerSchema(schema, "https://records.example/c");
    const interpreted = engine.evaluate(uri, instance, {
      output: "list",
      collectAnnotations: true,
    });
    const compiled = compileList(engine, uri, {
      collectAnnotations: true,
    }).evaluateList(instance);
    expect(compiled.valid).toBe(true);
    expect(compiled.annotations).toEqual(interpreted.annotations);
    expect(compiled.annotations!.map((a) => a.keyword).sort()).toEqual(
      ["default", "format", "title", "title", "x-note"].sort(),
    );
  });

  it("keeps a retention allow-list of an applicator keyword empty", () => {
    const engine = createEngine();
    const uri = engine.registerSchema(schema, "https://records.example/r");
    const compiled = compileList(engine, uri, {
      collectAnnotations: true,
      retention: { keywords: ["properties"] },
    }).evaluateList(instance);
    expect(compiled.valid).toBe(true);
    expect(compiled.annotations).toEqual([]);
  });
});

describe("compiled dependency data still drives consumers", () => {
  const cases: {
    name: string;
    schema: JsonValue;
    ok: JsonValue;
    bad: JsonValue;
  }[] = [
    {
      name: "unevaluatedProperties through allOf",
      schema: {
        allOf: [{ properties: { a: true } }],
        unevaluatedProperties: false,
      },
      ok: { a: 1 },
      bad: { a: 1, b: 2 },
    },
    {
      name: "unevaluatedItems through allOf",
      schema: { allOf: [{ prefixItems: [true] }], unevaluatedItems: false },
      ok: [1],
      bad: [1, 2],
    },
  ];
  for (const c of cases) {
    it(c.name, () => {
      const engine = createEngine();
      const uri = engine.registerSchema(
        c.schema,
        `https://records.example/${encodeURIComponent(c.name)}`,
      );
      const flag = compileValidator(engine, uri);
      const list = compileList(engine, uri);
      expect(flag.validate(c.ok)).toBe(true);
      expect(flag.validate(c.bad)).toBe(false);
      expect(list.evaluateList(c.ok).valid).toBe(true);
      expect(list.evaluateList(c.bad).valid).toBe(false);
    });
  }
});
