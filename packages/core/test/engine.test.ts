// Cycle guard and dialect-registry behavior (DESIGN.md §5 cycle-guard note,
// D2 custom vocabulary/dialect path).

import { describe, it, expect } from "vitest";
import {
  childCursor,
  createEngine,
  InfiniteLoopError,
  InvalidSchemaError,
  JsonValue,
  KeywordBehavior,
  SchemaValidationError,
  UnknownVocabularyError,
  identifiersLegacy,
  identifiers2019,
} from "@json-schema-engine/core";
import { parseJsonWithRanges } from "@json-schema-engine/test-kit";

describe("cycle guard", () => {
  it("throws on true reference cycles", () => {
    const engine = createEngine();
    const uri = engine.registerSchema(
      { $ref: "#" },
      "https://cycle.example/schema",
    );
    expect(() => engine.evaluate(uri, 42)).toThrow(InfiniteLoopError);
  });

  it("allows re-evaluating the same schema at the same location sequentially", () => {
    const engine = createEngine();
    const uri = engine.registerSchema(
      {
        $defs: { s: { type: "object" } },
        allOf: [{ $ref: "#/$defs/s" }, { $ref: "#/$defs/s" }],
      },
      "https://cycle.example/sequential",
    );
    expect(engine.evaluate(uri, {}).valid).toBe(true);
  });

  it("allows recursion that descends through the instance", () => {
    const engine = createEngine();
    const uri = engine.registerSchema(
      {
        type: "object",
        properties: { child: { $ref: "#" } },
      },
      "https://cycle.example/tree",
    );
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
    engine.registerSchema(
      {
        $id: A,
        $defs: {
          inner: {
            $id: B,
            required: ["x"],
            $defs: { deep: { $id: C, type: "string" } },
          },
        },
        $ref: B,
      },
      "https://pos.example/doc",
    );
    return engine;
  }

  it("maps resource URIs to document-rooted pointers, nested included", () => {
    const engine = registered();
    expect(engine.documentLocation(A)).toEqual({ documentUri: A, pointer: "" });
    expect(engine.documentLocation(B)).toEqual({
      documentUri: A,
      pointer: "/$defs/inner",
    });
    expect(engine.documentLocation(C)).toEqual({
      documentUri: A,
      pointer: "/$defs/inner/$defs/deep",
    });
    expect(
      engine.documentLocation("https://pos.example/unknown"),
    ).toBeUndefined();
  });

  it("translates a canonical error location to a document pointer", () => {
    const engine = registered();
    const r = engine.evaluate(A, {}, { output: "list" });
    expect(r.valid).toBe(false);
    const unit = r.errors!.find((e) => e.error.includes("'x'"))!;
    expect(unit.schemaLocation).toBe(`${B}#/required`);
    // schemaLocation = resourceUri + "#" + ptr; document pointer = prefix + ptr
    const [resourceUri, ptr] = unit.schemaLocation.split("#");
    const loc = engine.documentLocation(resourceUri!)!;
    expect(loc.documentUri).toBe(A);
    expect(loc.pointer + ptr!).toBe("/$defs/inner/required");
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
      loaders: [
        (uri) =>
          uri === "https://pos.example/root"
            ? parseJsonWithRanges(text)
            : undefined,
      ],
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
    expect(
      text.slice(
        source.range!.key!.start.offset,
        source.range!.key!.end.offset,
      ),
    ).toBe('"required"');

    expect(engine.locate(unit.schemaLocation)).toEqual(source);
  });

  it("locate degrades to pointer-only when the loader reports no positions", () => {
    const engine = createEngine();
    engine.registerSchema(
      { $defs: { s: { type: "number" } } },
      "https://pos.example/plain",
    );
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
      loaders: [
        (uri) =>
          uri === META
            ? {
                value: {
                  $id: META,
                  $vocabulary: {
                    [CORE]: true,
                    "https://example.com/vocab/nonexistent": true,
                  },
                },
              }
            : undefined,
      ],
    });
    await expect(
      engine.loadSchema({ $schema: META }, "https://policy.example/s"),
    ).rejects.toThrow(UnknownVocabularyError);
  });

  it("resolves $refs to the bundled 2020-12 metaschema without loaders", () => {
    const engine = createEngine();
    const uri = engine.registerSchema(
      { $ref: "https://json-schema.org/draft/2020-12/schema" },
      "https://policy.example/meta-ref",
    );
    expect(engine.evaluate(uri, { minLength: 1 }).valid).toBe(true);
    expect(engine.evaluate(uri, { minLength: -1 }).valid).toBe(false);
  });

  it("validates against the bundled standard metaschema when enabled", () => {
    const engine = createEngine({ validateSchemas: true });
    expect(() =>
      engine.registerSchema({ type: 123 }, "https://policy.example/bad-type"),
    ).toThrow(SchemaValidationError);
    expect(
      engine.registerSchema({ type: "string" }, "https://policy.example/ok"),
    ).toBe("https://policy.example/ok");
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
      loaders: [(uri) => (uri === META ? { value: metaschema } : undefined)],
    });
    await expect(
      engine.loadSchema(
        { $schema: META, maxLength: "long" },
        "https://policy.example/bad",
      ),
    ).rejects.toThrow(SchemaValidationError);
    await expect(
      engine.loadSchema(
        { $schema: META, maxLength: 3 },
        "https://policy.example/good",
      ),
    ).resolves.toBe("https://policy.example/good");
  });
});

describe("identifier strategies and legacy $ref semantics (D18)", () => {
  const LEGACY = "urn:jse:test:dialect:legacy";
  const V2020 = "https://json-schema.org/draft/2020-12/vocab/";

  function legacyEngine() {
    const engine = createEngine();
    engine.registerDialect(
      LEGACY,
      [`${V2020}core`, `${V2020}applicator`, `${V2020}validation`],
      { identifiers: identifiersLegacy, refIgnoresSiblings: true },
    );
    return engine;
  }

  it("treats siblings of $ref as absent when refIgnoresSiblings is set", () => {
    const engine = legacyEngine();
    const uri = engine.registerSchema(
      {
        $defs: { s: { type: "string" } },
        $ref: "#/$defs/s",
        type: "number",
      },
      "https://legacy.example/ref-siblings",
      LEGACY,
    );
    expect(engine.evaluate(uri, "hi").valid).toBe(true);
    expect(engine.evaluate(uri, 3).valid).toBe(false);
  });

  it("mints anchors from plain-fragment $id, without a base change", () => {
    const engine = legacyEngine();
    const uri = engine.registerSchema(
      {
        $defs: { a: { $id: "#foo", type: "integer" } },
        $ref: "#foo",
      },
      "https://legacy.example/id-anchor",
      LEGACY,
    );
    expect(engine.evaluate(uri, 5).valid).toBe(true);
    expect(engine.evaluate(uri, "x").valid).toBe(false);
  });

  it("ignores a sibling $id next to $ref for base resolution", () => {
    const engine = legacyEngine();
    const uri = engine.registerSchema(
      {
        $defs: {
          s: { type: "string" },
          viaRef: {
            $id: "https://legacy.example/elsewhere",
            $ref: "#/$defs/s",
          },
        },
        $ref: "#/$defs/viaRef",
      },
      "https://legacy.example/sibling-id",
      LEGACY,
    );
    // If the sibling $id changed the base, "#/$defs/s" would not resolve.
    expect(engine.evaluate(uri, "ok").valid).toBe(true);
  });
});

describe("$recursiveRef/$recursiveAnchor (D8 degenerate case)", () => {
  const DIALECT = "urn:jse:test:dialect:2019ish";
  const V2020 = "https://json-schema.org/draft/2020-12/vocab/";
  const BASE = "https://rec.example/tree";
  const EXT = "https://rec.example/strict-tree";

  async function engineWithTrees() {
    const { $recursiveRef, $recursiveAnchor } =
      await import("../src/keywords/core.js");
    const engine = createEngine();
    engine.registerVocabulary("urn:jse:test:vocab:recursive", {
      $recursiveRef,
      $recursiveAnchor,
    });
    engine.registerDialect(
      DIALECT,
      [
        `${V2020}core`,
        `${V2020}applicator`,
        `${V2020}validation`,
        "urn:jse:test:vocab:recursive",
      ],
      { identifiers: identifiers2019 },
    );
    engine.registerSchema(
      {
        $id: BASE,
        $recursiveAnchor: true,
        type: "object",
        properties: {
          data: true,
          children: { type: "array", items: { $recursiveRef: "#" } },
        },
      },
      BASE,
      DIALECT,
    );
    engine.registerSchema(
      {
        $id: EXT,
        $recursiveAnchor: true,
        $ref: BASE,
        properties: { data: { type: "string" } },
      },
      EXT,
      DIALECT,
    );
    return engine;
  }

  it("rebinds to the outermost recursive-anchored resource", async () => {
    const engine = await engineWithTrees();
    // Through EXT, the recursion must re-enter EXT (data must be a string)…
    expect(engine.evaluate(EXT, { children: [{ data: "ok" }] }).valid).toBe(
      true,
    );
    expect(engine.evaluate(EXT, { children: [{ data: 42 }] }).valid).toBe(
      false,
    );
    // …while BASE alone accepts any data.
    expect(engine.evaluate(BASE, { children: [{ data: 42 }] }).valid).toBe(
      true,
    );
  });
});

describe("non-schema values in schema positions (D19)", () => {
  it("rejects a non-schema document root at registration", () => {
    const engine = createEngine();
    expect(() => engine.registerSchema(42, "https://d19.example/root")).toThrow(
      InvalidSchemaError,
    );
  });

  it("rejects a non-schema in a claimed schema position at registration", () => {
    const engine = createEngine();
    expect(() =>
      engine.registerSchema({ not: "not-a-schema" }, "https://d19.example/not"),
    ).toThrow(InvalidSchemaError);
    expect(() =>
      engine.registerSchema(
        { properties: { a: [true] } },
        "https://d19.example/props",
      ),
    ).toThrow(InvalidSchemaError);
  });

  it("dialect decides what is a schema position: tuple items", async () => {
    const shape: JsonValue = { items: [{ type: "string" }] };
    const { DIALECT_DRAFT_07 } = await import("@json-schema-engine/core");
    const legacy = createEngine({ defaultDialect: DIALECT_DRAFT_07 });
    // Valid draft-07: array-form items claims each element, not the array.
    expect(
      legacy.evaluate(
        legacy.registerSchema(shape, "https://d19.example/legacy"),
        ["x"],
      ).valid,
    ).toBe(true);
    // Invalid 2020-12: items claims its whole value as one schema.
    const modern = createEngine();
    expect(() =>
      modern.registerSchema(shape, "https://d19.example/modern"),
    ).toThrow(InvalidSchemaError);
  });

  it("boolean subschemas remain valid everywhere", () => {
    const engine = createEngine();
    const uri = engine.registerSchema(
      { properties: { a: true, b: false } },
      "https://d19.example/booleans",
    );
    expect(engine.evaluate(uri, { a: 1 }).valid).toBe(true);
    expect(engine.evaluate(uri, { b: 1 }).valid).toBe(false);
  });

  it("backstops $refs that point into unwalked non-schema data", () => {
    const engine = createEngine();
    // x-data is an unknown keyword: the walk never descends into it, so
    // only the evaluation-time backstop can catch the bad target.
    const uri = engine.registerSchema(
      { "x-data": { num: 5 }, $ref: "#/x-data/num" },
      "https://d19.example/ref-into-data",
    );
    expect(() => engine.evaluate(uri, 1)).toThrow(InvalidSchemaError);
  });
});

describe("legacy dialect keyword sets (D11/D18)", () => {
  it("accepts a defaultDialect spelled with the canonical empty fragment", () => {
    const engine = createEngine({
      defaultDialect: "http://json-schema.org/draft-07/schema#",
    });
    const uri = engine.registerSchema(
      { items: [{ type: "boolean" }] },
      "https://legacy.example/frag-dialect",
    );
    expect(engine.evaluate(uri, [true]).valid).toBe(true);
    expect(engine.evaluate(uri, [3]).valid).toBe(false);
  });

  it("treats post-draft-07 validation keywords as unknown in draft-07", async () => {
    const { DIALECT_DRAFT_07 } = await import("@json-schema-engine/core");
    const engine = createEngine({ defaultDialect: DIALECT_DRAFT_07 });
    const uri = engine.registerSchema(
      { dependentRequired: { a: ["b"] }, contains: true, minContains: 2 },
      "https://legacy.example/unknown-keywords",
    );
    // dependentRequired must not assert, minContains must not raise
    // contains' bound — both are unknown keywords in draft-07.
    expect(engine.evaluate(uri, { a: 1 }).valid).toBe(true);
    expect(engine.evaluate(uri, [1]).valid).toBe(true);
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
      if (
        typeof cursor.value !== "object" ||
        cursor.value === null ||
        Array.isArray(cursor.value)
      )
        return true;
      let ok = true;
      for (const [name, member] of Object.entries(cursor.value)) {
        if (!ctx.apply(["eachValue"], childCursor(cursor, name, member)))
          ok = false;
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
      "https://dialect.example/schema",
      DIALECT,
    );
    expect(engine.evaluate(uri, { a: 1, b: 2 }).valid).toBe(true);
    expect(engine.evaluate(uri, { a: 1, b: "x" }).valid).toBe(false);
  });

  it("walks custom-applicator subschemas for identifiers ($anchor)", () => {
    const engine = customEngine();
    const uri = engine.registerSchema(
      {
        $defs: { viaAnchor: { $ref: "#target" } },
        eachValue: { $anchor: "target", type: "integer" },
        // exercise the anchor registered inside the custom applicator's child
        $ref: "#/$defs/viaAnchor",
      },
      "https://dialect.example/anchors",
      DIALECT,
    );
    expect(engine.evaluate(uri, 5).valid).toBe(true);
    expect(engine.evaluate(uri, "x").valid).toBe(false);
  });
});
