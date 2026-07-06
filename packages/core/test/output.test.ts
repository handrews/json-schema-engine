// Output rendering (DESIGN.md D6): both location-field vocabularies, modern
// default, flag vs list structures, constant paths through $ref.

import { describe, it, expect } from "vitest";
import { createEngine, JsonValue } from "@jse/core";

const schema: JsonValue = {
  $defs: { base: { required: ["id"] } },
  allOf: [{ $ref: "#/$defs/base" }],
};

function engineFor(s: JsonValue) {
  const engine = createEngine();
  const uri = engine.registerSchema(s, "https://output.example/schema");
  return { engine, uri };
}

describe("output rendering", () => {
  it("defaults to evaluationPath/schemaLocation (modern vocabulary)", () => {
    const { engine, uri } = engineFor(schema);
    const r = engine.evaluate(uri, {}, { output: "list" });
    expect(r.valid).toBe(false);
    expect(r.errors).toContainEqual({
      evaluationPath: "/allOf/0/$ref/required",
      schemaLocation: "https://output.example/schema#/$defs/base/required",
      instanceLocation: "",
      error: "missing required property 'id'",
    });
    expect(r.errors![0]).not.toHaveProperty("keywordLocation");
  });

  it("renders 2020-12 field names as the compatibility option", () => {
    const { engine, uri } = engineFor(schema);
    const r = engine.evaluate(
      uri,
      {},
      { output: "list", locations: "2020-12" },
    );
    expect(r.errors).toContainEqual({
      keywordLocation: "/allOf/0/$ref/required",
      absoluteKeywordLocation:
        "https://output.example/schema#/$defs/base/required",
      instanceLocation: "",
      error: "missing required property 'id'",
    });
    expect(r.errors![0]).not.toHaveProperty("evaluationPath");
  });

  it("renders annotations in the requested vocabulary", () => {
    const { engine, uri } = engineFor({ title: "T", type: "object" });
    const modern = engine.evaluate(uri, {}, { collectAnnotations: true });
    expect(modern.annotations).toContainEqual({
      keyword: "title",
      vocabulary: "https://json-schema.org/draft/2020-12/vocab/meta-data",
      evaluationPath: "/title",
      schemaLocation: "https://output.example/schema#/title",
      instanceLocation: "",
      annotation: "T",
    });
    const compat = engine.evaluate(
      uri,
      {},
      { collectAnnotations: true, locations: "2020-12" },
    );
    expect(compat.annotations![0]).toHaveProperty("keywordLocation", "/title");
    expect(compat.annotations![0]).toHaveProperty(
      "absoluteKeywordLocation",
      "https://output.example/schema#/title",
    );
  });

  it("flag output carries no error units", () => {
    const { engine, uri } = engineFor(schema);
    const r = engine.evaluate(uri, {});
    expect(r).toEqual({ valid: false });
  });

  it("reports a boolean false schema with schema-level locations", () => {
    const { engine, uri } = engineFor({ properties: { x: false } });
    const r = engine.evaluate(uri, { x: 1 }, { output: "list" });
    expect(r.errors).toContainEqual({
      evaluationPath: "/properties/x",
      schemaLocation: "https://output.example/schema#/properties/x",
      instanceLocation: "/x",
      error: "schema is false",
    });
  });

  it("escapes JSON Pointer segments in instance locations", () => {
    const { engine, uri } = engineFor({ additionalProperties: false });
    const r = engine.evaluate(uri, { "a/b~c": 1 }, { output: "list" });
    expect(r.errors![0]!.instanceLocation).toBe("/a~1b~0c");
  });
});

describe("hierarchical output (M5 exemplar)", () => {
  const hSchema: JsonValue = {
    title: "root",
    type: "object",
    properties: {
      name: { title: "the name", type: "string" },
      size: { type: "integer" },
    },
  };

  function run(instance: JsonValue, verbose = false) {
    const engine = createEngine();
    const uri = engine.registerSchema(hSchema, "https://h.example/schema");
    return engine.evaluate(uri, instance, { output: "hierarchical", verbose });
  }

  it("nests failing branches with modern location fields", () => {
    const r = run({ name: 3 });
    expect(r.valid).toBe(false);
    const root = r.outputDocument;
    expect(root.valid).toBe(false);
    expect(root.evaluationPath).toBe("");
    expect(root.instanceLocation).toBe("");
    const nameUnit = root.details!.find((d) => d.instanceLocation === "/name")!;
    expect(nameUnit.valid).toBe(false);
    expect(nameUnit.evaluationPath).toBe("/properties/name");
    expect(nameUnit.schemaLocation).toBe(
      "https://h.example/schema#/properties/name",
    );
    expect(nameUnit.errors!.type).toContain("string");
  });

  it("prunes contribution-free units, keeps annotations on valid ones", () => {
    const r = run({ name: "x" });
    expect(r.valid).toBe(true);
    const root = r.outputDocument;
    expect(root.annotations!.title).toBe("root");
    const nameUnit = root.details!.find((d) => d.instanceLocation === "/name")!;
    expect(nameUnit.annotations!.title).toBe("the name");
    // `size` is absent from the instance: its subschema is never applied.
    expect(root.details!.every((d) => d.instanceLocation !== "/size")).toBe(
      true,
    );
  });

  it("verbose keeps valid, annotation-free units", () => {
    const engine = createEngine();
    const uri = engine.registerSchema(
      { properties: { n: { type: "integer" } } },
      "https://h.example/plain",
    );
    const terse = engine.evaluate(uri, { n: 1 }, { output: "hierarchical" });
    const verbose = engine.evaluate(
      uri,
      { n: 1 },
      { output: "hierarchical", verbose: true },
    );
    expect(terse.outputDocument.details).toBeUndefined();
    expect(verbose.outputDocument.details!.length).toBe(1);
    expect(verbose.outputDocument.details![0]!.valid).toBe(true);
  });

  it("reports droppedAnnotations on failed units", () => {
    const r = run({ name: 3 });
    const nameUnit = r.outputDocument.details!.find(
      (d) => d.instanceLocation === "/name",
    )!;
    expect(nameUnit.droppedAnnotations!.title).toBe("the name");
  });
});

describe("retention deny lists (M5)", () => {
  const s: JsonValue = { title: "T", description: "D", type: "object" };

  it("excludeKeywords subtracts from the default (everything) retention", () => {
    const { engine, uri } = engineFor(s);
    const r = engine.evaluate(
      uri,
      {},
      {
        collectAnnotations: true,
        retention: { excludeKeywords: ["title"] },
      },
    );
    const names = r.annotations!.map((a) => a.keyword);
    expect(names).toContain("description");
    expect(names).not.toContain("title");
  });

  it("excludeKeywords subtracts after an allow-list", () => {
    const { engine, uri } = engineFor(s);
    const r = engine.evaluate(
      uri,
      {},
      {
        collectAnnotations: true,
        retention: {
          keywords: ["title", "description"],
          excludeKeywords: ["title"],
        },
      },
    );
    expect(r.annotations!.map((a) => a.keyword)).toEqual(["description"]);
  });

  it(
    "unevaluatedProperties still validates when retention denies everything " +
      "and collectAnnotations is off",
    () => {
      // Retention (§4 rule 5) must never affect channel visibility (rule 4):
      // unevaluatedProperties reads ctx.visible(), not the retained set.
      const { engine, uri } = engineFor({
        properties: { a: true },
        unevaluatedProperties: false,
      });
      const r = engine.evaluate(
        uri,
        { a: 1 },
        {
          output: "list",
          retention: {
            excludeKeywords: ["properties", "unevaluatedProperties"],
          },
        },
      );
      expect(r.valid).toBe(true);
      const r2 = engine.evaluate(
        uri,
        { a: 1, b: 2 },
        {
          output: "list",
          retention: {
            excludeKeywords: ["properties", "unevaluatedProperties"],
          },
        },
      );
      expect(r2.valid).toBe(false);
    },
  );
});

describe("Basic output document (M5)", () => {
  it("omits errors on success and lists flat error units on failure", () => {
    const { engine, uri } = engineFor(schema);
    const ok = engine.evaluate(
      uri,
      { id: 1 },
      { output: "list", locations: "2020-12" },
    );
    expect(ok.outputDocument).toEqual({
      valid: true,
      keywordLocation: "",
      instanceLocation: "",
      absoluteKeywordLocation: "https://output.example/schema#",
    });
    const bad = engine.evaluate(
      uri,
      {},
      { output: "list", locations: "2020-12" },
    );
    expect(bad.outputDocument.valid).toBe(false);
    expect(bad.outputDocument.errors).toContainEqual({
      keywordLocation: "/allOf/0/$ref/required",
      absoluteKeywordLocation:
        "https://output.example/schema#/$defs/base/required",
      instanceLocation: "",
      error: "missing required property 'id'",
    });
  });
});

describe("modern LIST output document (M5)", () => {
  it("flattens hierarchical units with no details field", () => {
    const { engine, uri } = engineFor(schema);
    const r = engine.evaluate(uri, {}, { output: "list" });
    const units = r.outputDocument;
    expect(Array.isArray(units)).toBe(true);
    for (const u of units) expect(u).not.toHaveProperty("details");
    const failing = units.find((u) => u.instanceLocation === "" && !u.valid);
    expect(failing).toBeDefined();
  });
});

describe("Detailed/Verbose output documents (M5)", () => {
  const hSchema: JsonValue = {
    title: "root",
    type: "object",
    properties: { name: { title: "the name", type: "string" } },
  };

  it("Detailed prunes contribution-free valid units with 2020-12 field names", () => {
    const engine = createEngine();
    const uri = engine.registerSchema(hSchema, "https://h.example/detailed");
    const r = engine.evaluate(
      uri,
      { name: 3 },
      { output: "hierarchical", locations: "2020-12" },
    );
    const root = r.outputDocument;
    expect(root.keywordLocation).toBe("");
    expect(root).not.toHaveProperty("evaluationPath");
    const nameUnit = root.details!.find((d) => d.instanceLocation === "/name")!;
    expect(nameUnit.keywordLocation).toBe("/properties/name");
    expect(nameUnit.absoluteKeywordLocation).toBe(
      "https://h.example/detailed#/properties/name",
    );
  });

  it("Verbose keeps valid, annotation-free units", () => {
    const engine = createEngine();
    const uri = engine.registerSchema(
      { properties: { n: { type: "integer" } } },
      "https://h.example/verbose",
    );
    const detailed = engine.evaluate(
      uri,
      { n: 1 },
      { output: "hierarchical", locations: "2020-12" },
    );
    const verbose = engine.evaluate(
      uri,
      { n: 1 },
      { output: "hierarchical", locations: "2020-12", verbose: true },
    );
    expect(detailed.outputDocument.details).toBeUndefined();
    expect(verbose.outputDocument.details!.length).toBe(1);
    expect(verbose.outputDocument.details![0]!.valid).toBe(true);
  });
});
