// Cycle guard and dialect-registry behavior (DESIGN.md §5 cycle-guard note,
// D2 custom vocabulary/dialect path).

import { describe, it, expect } from "vitest";
import {
  childCursor, createEngine, InfiniteLoopError, JsonValue, KeywordBehavior,
} from "@jse/core";

describe("cycle guard", () => {
  it("throws on true reference cycles", () => {
    const engine = createEngine();
    const uri = engine.registerSchema(
      { $ref: "#" }, "https://cycle.example/schema");
    expect(() => engine.evaluate(uri, 42)).toThrow(InfiniteLoopError);
  });

  it("allows re-evaluating the same schema at the same location sequentially", () => {
    const engine = createEngine();
    const uri = engine.registerSchema({
      $defs: { s: { type: "object" } },
      allOf: [{ $ref: "#/$defs/s" }, { $ref: "#/$defs/s" }],
    }, "https://cycle.example/sequential");
    expect(engine.evaluate(uri, {}).valid).toBe(true);
  });

  it("allows recursion that descends through the instance", () => {
    const engine = createEngine();
    const uri = engine.registerSchema({
      type: "object",
      properties: { child: { $ref: "#" } },
    }, "https://cycle.example/tree");
    expect(engine.evaluate(uri, { child: { child: {} } }).valid).toBe(true);
    expect(engine.evaluate(uri, { child: { child: 3 } }).valid).toBe(false);
  });
});

describe("source-position prefix table (D17)", () => {
  const A = "https://pos.example/A";
  const B = "https://pos.example/B";
  const C = "https://pos.example/C";

  function registered() {
    const engine = createEngine();
    engine.registerSchema({
      $id: A,
      $defs: {
        inner: {
          $id: B,
          required: ["x"],
          $defs: { deep: { $id: C, type: "string" } },
        },
      },
      $ref: B,
    }, "https://pos.example/doc");
    return engine;
  }

  it("maps resource URIs to document-rooted pointers, nested included", () => {
    const engine = registered();
    expect(engine.documentLocation(A)).toEqual({ documentUri: A, pointer: "" });
    expect(engine.documentLocation(B)).toEqual({ documentUri: A, pointer: "/$defs/inner" });
    expect(engine.documentLocation(C))
      .toEqual({ documentUri: A, pointer: "/$defs/inner/$defs/deep" });
    expect(engine.documentLocation("https://pos.example/unknown")).toBeUndefined();
  });

  it("translates a canonical error location to a document pointer", () => {
    const engine = registered();
    const r = engine.evaluate(A, {}, { output: "list" });
    expect(r.valid).toBe(false);
    const unit = r.errors!.find((e) => e.error.includes("'x'"))!;
    expect(unit.schemaLocation).toBe(`${B}#/required`);
    // schemaLocation = resourceUri + "#" + ptr; document pointer = prefix + ptr
    const [resourceUri, ptr] = unit.schemaLocation!.split("#");
    const loc = engine.documentLocation(resourceUri!)!;
    expect(loc.documentUri).toBe(A);
    expect(loc.pointer + ptr).toBe("/$defs/inner/required");
  });
});

describe("custom vocabularies and dialects (D2)", () => {
  const VOCAB = "https://dialect.example/vocab/each";
  const DIALECT = "https://dialect.example/dialect";

  // A custom applicator: applies its subschema to every member value.
  const eachValue: KeywordBehavior = {
    id: `${VOCAB}#eachValue`,
    analyze: () => ({ subschemas: [[]] }),
    evaluate: (_value, cursor, ctx) => {
      if (typeof cursor.value !== "object" || cursor.value === null
        || Array.isArray(cursor.value)) return true;
      let ok = true;
      for (const [name, member] of Object.entries(cursor.value)) {
        if (!ctx.apply(["eachValue"],
          childCursor(cursor, name, member as JsonValue))) ok = false;
      }
      return ok;
    },
  };

  function customEngine() {
    const engine = createEngine();
    engine.registerVocabulary(VOCAB, { eachValue });
    engine.registerDialect(DIALECT, [
      "https://json-schema.org/draft/2020-12/vocab/core",
      "https://json-schema.org/draft/2020-12/vocab/validation",
      VOCAB,
    ]);
    return engine;
  }

  it("evaluates a custom applicator registered like the built-ins", () => {
    const engine = customEngine();
    const uri = engine.registerSchema(
      { eachValue: { type: "integer" } },
      "https://dialect.example/schema", DIALECT);
    expect(engine.evaluate(uri, { a: 1, b: 2 }).valid).toBe(true);
    expect(engine.evaluate(uri, { a: 1, b: "x" }).valid).toBe(false);
  });

  it("walks custom-applicator subschemas for identifiers ($anchor)", () => {
    const engine = customEngine();
    const uri = engine.registerSchema({
      $defs: { viaAnchor: { $ref: "#target" } },
      eachValue: { $anchor: "target", type: "integer" },
      // exercise the anchor registered inside the custom applicator's child
      $ref: "#/$defs/viaAnchor",
    }, "https://dialect.example/anchors", DIALECT);
    expect(engine.evaluate(uri, 5).valid).toBe(true);
    expect(engine.evaluate(uri, "x").valid).toBe(false);
  });
});
