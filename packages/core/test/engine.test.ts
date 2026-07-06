// Cycle guard and dialect-registry behavior (DESIGN.md §5 cycle-guard note,
// D2 custom vocabulary/dialect path).

import { describe, it, expect } from "vitest";
import {
  childCursor, createEngine, InfiniteLoopError, JsonValue, KeywordBehavior,
  SchemaValidationError, UnknownVocabularyError,
} from "@jse/core";
import { parseJsonWithRanges } from "@jse/test-kit";

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

describe("source positions (D17: getRange, locate, unit decoration)", () => {
  const text = `{
  "$id": "https://pos.example/root",
  "$ref": "https://pos.example/leaf",
  "$defs": {
    "leaf": {
      "$id": "https://pos.example/leaf",
      "required": ["x"]
    }
  }
}`;

  async function loaded() {
    const engine = createEngine({
      loaders: [(uri) =>
        uri === "https://pos.example/root" ? parseJsonWithRanges(text) : undefined],
    });
    const uri = await engine.load("https://pos.example/root");
    return { engine, uri };
  }

  it("round-trips a position lookup through an embedded-$id resource", async () => {
    const { engine, uri } = await loaded();
    const r = engine.evaluate(uri, {}, { output: "list", positions: true });
    expect(r.valid).toBe(false);
    const unit = r.errors!.find((e) => e.error.includes("'x'"))!;
    expect(unit.schemaLocation).toBe("https://pos.example/leaf#/required");

    const source = unit.source!;
    expect(source.documentUri).toBe("https://pos.example/root");
    expect(source.pointer).toBe("/$defs/leaf/required");
    // The range must point at the `"required": ["x"]` member in the source:
    // key span at the keyword name, value span at the array.
    const valueLine = text.split("\n")[source.range!.value.start.line - 1]!;
    expect(valueLine).toContain('"required"');
    expect(source.range!.key).toBeDefined();
    expect(text.slice(source.range!.key!.start.offset!, source.range!.key!.end.offset!))
      .toBe('"required"');

    expect(engine.locate(unit.schemaLocation!)).toEqual(source);
  });

  it("locate degrades to pointer-only when the loader reports no positions", async () => {
    const engine = createEngine();
    engine.registerSchema(
      { $defs: { s: { type: "number" } } }, "https://pos.example/plain");
    expect(engine.locate("https://pos.example/plain#/$defs/s")).toEqual({
      documentUri: "https://pos.example/plain",
      pointer: "/$defs/s",
    });
  });
});

describe("$vocabulary processing and metaschema policy (M3)", () => {
  const META = "https://policy.example/meta";
  const CORE = "https://json-schema.org/draft/2020-12/vocab/core";
  const VALIDATION = "https://json-schema.org/draft/2020-12/vocab/validation";

  it("refuses a metaschema requiring an unknown vocabulary", async () => {
    const engine = createEngine({
      loaders: [(uri) => uri === META
        ? { value: { $id: META, $vocabulary: {
            [CORE]: true, "https://example.com/vocab/nonexistent": true } } }
        : undefined],
    });
    await expect(engine.loadSchema({ $schema: META }, "https://policy.example/s"))
      .rejects.toThrow(UnknownVocabularyError);
  });

  it("validates load targets against their metaschema when enabled", async () => {
    const metaschema: JsonValue = {
      $id: META,
      $vocabulary: { [CORE]: true, [VALIDATION]: true },
      type: ["object", "boolean"],
      properties: { maxLength: { type: "integer" } },
    };
    const engine = createEngine({
      validateSchemas: true,
      loaders: [(uri) => uri === META ? { value: metaschema } : undefined],
    });
    await expect(
      engine.loadSchema({ $schema: META, maxLength: "long" }, "https://policy.example/bad"),
    ).rejects.toThrow(SchemaValidationError);
    await expect(
      engine.loadSchema({ $schema: META, maxLength: 3 }, "https://policy.example/good"),
    ).resolves.toBe("https://policy.example/good");
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
