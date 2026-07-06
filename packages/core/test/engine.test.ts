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
