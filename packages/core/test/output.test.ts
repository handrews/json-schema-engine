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
    const r = engine.evaluate(uri, {}, { output: "list", locations: "2020-12" });
    expect(r.errors).toContainEqual({
      keywordLocation: "/allOf/0/$ref/required",
      absoluteKeywordLocation: "https://output.example/schema#/$defs/base/required",
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
    const compat = engine.evaluate(uri, {},
      { collectAnnotations: true, locations: "2020-12" });
    expect(compat.annotations![0]).toHaveProperty("keywordLocation", "/title");
    expect(compat.annotations![0]).toHaveProperty(
      "absoluteKeywordLocation", "https://output.example/schema#/title");
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
