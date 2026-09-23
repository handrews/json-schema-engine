// Per-resource dialects (ADR 0006, backlog D11): `$schema` governs the
// schema resource it roots, not the document. The boundary is decided by
// the enclosing dialect's identifier syntax, the contents by the resource's
// own `$schema`; a `$schema` where no resource starts is ignored; pointer
// navigation switches syntax at each boundary; a dialect an embedded
// resource demands is assembled on demand by the async paths;
// `validateSchemas` checks each resource under its own metaschema; and a
// `$ref`'s siblings contribute nothing at registration under draft-07/06.

import { describe, it, expect } from "vitest";
import {
  createEngine,
  DIALECT_2019_09,
  DIALECT_2020_12,
  DIALECT_DRAFT_06,
  DIALECT_DRAFT_07,
  InvalidIdentifierError,
  InvalidSchemaError,
  SchemaValidationError,
  UnknownDialectError,
  UnresolvableRefError,
  UnsafeRegexError,
  type JsonValue,
  type SchemaLoader,
} from "@json-schema-engine/core";

const CORE = "https://json-schema.org/draft/2020-12/vocab/core";
const VALIDATION = "https://json-schema.org/draft/2020-12/vocab/validation";

const O = "https://mixed.test/outer";
const L = "https://mixed.test/legacy";

// A 2020-12 document embedding a draft-07 resource: array-form `items` and
// a `$ref` whose `minLength` sibling is ignored inside, asserted outside.
const mixed = (): JsonValue => ({
  $id: O,
  $defs: {
    str: { type: "string" },
    legacy: {
      $id: L,
      $schema: DIALECT_DRAFT_07,
      definitions: { t: { $id: "#tag", type: "string" } },
      properties: { p: { $ref: "#tag", minLength: 100 } },
      items: [{ type: "string" }, { type: "number" }],
    },
  },
  properties: {
    modern: { $ref: "#/$defs/str", minLength: 100 },
    old: { $ref: L },
  },
});

const counting = (
  docs: Record<string, JsonValue>,
): { loader: SchemaLoader; calls: string[] } => {
  const calls: string[] = [];
  return {
    calls,
    loader: (uri) => {
      const doc = docs[uri];
      if (doc === undefined) return undefined;
      calls.push(uri);
      return { value: doc };
    },
  };
};

describe("the walk rebinds the dialect at an embedded resource", () => {
  it("an inner dialect rejects what the outer would accept", () => {
    const engine = createEngine({ defaultDialect: DIALECT_DRAFT_07 });
    const inner = "https://m.test/inner";
    expect(() =>
      engine.registerSchema(
        {
          definitions: {
            inner: {
              $id: inner,
              $schema: DIALECT_2020_12,
              $defs: { x: { $id: "#foo" } },
            },
          },
        },
        "https://m.test/outer",
      ),
    ).toThrow(InvalidIdentifierError);
    expect(() =>
      engine.registerSchema(
        {
          definitions: {
            inner: {
              $id: inner,
              $schema: DIALECT_2020_12,
              $defs: { x: { $id: "#foo" } },
            },
          },
        },
        "https://m.test/outer",
      ),
    ).toThrow(`${inner}#/$defs/x`);
    expect(engine.registry.has("https://m.test/outer")).toBe(false);
    expect(engine.registry.has(inner)).toBe(false);
  });

  it("the same document is legal under draft-07 throughout", () => {
    const engine = createEngine({ defaultDialect: DIALECT_DRAFT_07 });
    const inner = "https://m.test/inner7";
    const uri = engine.registerSchema(
      {
        definitions: {
          inner: {
            $id: inner,
            $schema: DIALECT_DRAFT_07,
            definitions: { x: { $id: "#foo", type: "string" } },
          },
        },
      },
      "https://m.test/outer7",
    );
    expect(engine.registry.dialectUriFor(uri)).toBe(DIALECT_DRAFT_07);
    expect(engine.registry.resolveRef("#foo", inner).pointer).toBe(
      "/definitions/x",
    );
  });

  it("an embedded resource keeps its own dialect", () => {
    const engine = createEngine();
    const uri = engine.registerSchema(mixed(), O);
    const reg = engine.registry;
    expect(reg.dialectUriFor(uri)).toBe(DIALECT_2020_12);
    expect(reg.dialectUriFor(L)).toBe(DIALECT_DRAFT_07);
    expect(engine.evaluate(uri, { old: ["a", 1] }).valid).toBe(true);
    expect(engine.evaluate(uri, { old: [1, "a"] }).valid).toBe(false);
  });

  it("legacy identifier syntax applies inside the inner resource", () => {
    const engine = createEngine();
    engine.registerSchema(mixed(), O);
    expect(engine.registry.resolveRef("#tag", L).pointer).toBe(
      "/definitions/t",
    );
  });

  it("refIgnoresSiblings applies only inside the legacy resource", () => {
    const engine = createEngine();
    const uri = engine.registerSchema(mixed(), O);
    // 2020-12: the sibling asserts.
    expect(engine.evaluate(uri, { modern: "short" }).valid).toBe(false);
    expect(engine.evaluate(uri, { modern: "x".repeat(100) }).valid).toBe(true);
    // draft-07: the sibling is absent.
    expect(engine.evaluate(uri, { old: { p: "short" } }).valid).toBe(true);
    expect(engine.evaluate(uri, { old: { p: 1 } }).valid).toBe(false);
  });

  it("an embedded resource without $schema inherits", () => {
    const engine = createEngine({ defaultDialect: DIALECT_DRAFT_07 });
    const inner = "https://m.test/inherit";
    const uri = engine.registerSchema(
      {
        definitions: { i: { $id: inner, items: [{ type: "string" }] } },
        properties: { p: { $ref: inner } },
      },
      "https://m.test/inherit-outer",
    );
    expect(engine.registry.dialectUriFor(inner)).toBe(DIALECT_DRAFT_07);
    expect(engine.evaluate(uri, { p: ["a"] }).valid).toBe(true);
    expect(engine.evaluate(uri, { p: [1] }).valid).toBe(false);
  });

  it("an embedded $schema naming the dialect already in force is a no-op", () => {
    const engine = createEngine({ defaultDialect: DIALECT_2019_09 });
    const uri = engine.registerSchema(
      {
        $schema: DIALECT_2019_09,
        $defs: {
          s: {
            $schema: DIALECT_2019_09,
            $id: "/schemas/same",
            items: [{ type: "string" }],
          },
        },
      },
      "https://m.test/same",
    );
    expect(engine.registry.dialectUriFor(uri)).toBe(DIALECT_2019_09);
    expect(engine.registry.dialectUriFor("https://m.test/schemas/same")).toBe(
      DIALECT_2019_09,
    );
  });

  for (const dialect of [
    DIALECT_2020_12,
    DIALECT_2019_09,
    DIALECT_DRAFT_07,
    DIALECT_DRAFT_06,
  ]) {
    it(`ignores a misplaced $schema under ${dialect}`, () => {
      const engine = createEngine();
      // Bowtie's "allows nothing" spelling.
      const nothing = engine.registerSchema(
        { $schema: dialect, not: { $schema: dialect } },
        "https://m.test/nothing",
      );
      const anything = engine.registerSchema(
        { $schema: dialect, properties: { a: { $schema: dialect } } },
        "https://m.test/anything",
      );
      expect(engine.evaluate(nothing, 1).valid).toBe(false);
      expect(engine.evaluate(anything, { a: 1 }).valid).toBe(true);
    });
  }

  it("a misplaced $schema does not switch dialects", () => {
    const engine = createEngine();
    expect(() =>
      engine.registerSchema(
        {
          properties: {
            a: { $schema: DIALECT_DRAFT_07, items: [{ type: "string" }] },
          },
        },
        "https://m.test/misplaced",
      ),
    ).toThrow(InvalidSchemaError);
  });
});

describe("pointer navigation switches syntax at a boundary", () => {
  it("a pointer crossing a boundary uses the inner syntax", () => {
    const engine = createEngine();
    engine.registerSchema(mixed(), O);
    const reg = engine.registry;
    // Under 2020-12 syntax `$id: "#tag"` would rebase; under draft-07 it is
    // an anchor and the pointer stays.
    const viaRef = reg.resolveRef("#/$defs/legacy/definitions/t", O);
    expect(viaRef.baseUri).toBe(L);
    expect(viaRef.pointer).toBe("/definitions/t");
    const path = ["$defs", "legacy", "definitions", "t"];
    const viaChild = reg.child(reg.rootRef(O), path);
    expect(viaChild).toBe(viaRef);
    expect(reg.child(reg.rootRef(O), path)).toBe(viaChild);
  });

  it("navigation into an unindexed base still resolves", () => {
    const engine = createEngine();
    // An $id inside an unknown keyword: never walked, never indexed.
    const uri = engine.registerSchema(
      { "x-side": { $id: "https://m.test/ghost", type: "string" } },
      "https://m.test/unindexed",
    );
    const reg = engine.registry;
    const hit = reg.resolveRef("#/x-side", uri);
    expect(hit.baseUri).toBe("https://m.test/ghost");
    expect(hit.pointer).toBe("");
    expect(reg.child(reg.rootRef(uri), ["x-side"]).baseUri).toBe(
      "https://m.test/ghost",
    );
  });
});

describe("a dialect an embedded resource demands", () => {
  const META = "https://v.test/meta";
  const inner = "https://v.test/inner";
  const embedding = (): JsonValue => ({
    $defs: { s: { $id: inner, $schema: META, maxLength: 3 } },
    $ref: inner,
  });

  it("is refused by registerSchema, naming the URI and registering nothing", () => {
    const engine = createEngine();
    let caught: unknown;
    try {
      engine.registerSchema(embedding(), "https://v.test/root");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(UnknownDialectError);
    expect((caught as UnknownDialectError).dialectUri).toBe(META);
    expect(engine.registry.has("https://v.test/root")).toBe(false);
    expect(engine.registry.has(inner)).toBe(false);
  });

  it("is refused by loadSchema when no loader provides its metaschema", async () => {
    const engine = createEngine();
    await expect(
      engine.loadSchema(embedding(), "https://v.test/root"),
    ).rejects.toMatchObject({ dialectUri: META });
    expect(engine.registry.has("https://v.test/root")).toBe(false);
  });

  it("is assembled on demand with exactly one fetch", async () => {
    const { loader, calls } = counting({
      [META]: { $id: META, $vocabulary: { [CORE]: true, [VALIDATION]: true } },
    });
    const engine = createEngine({ loaders: [loader] });
    const uri = await engine.loadSchema(embedding(), "https://v.test/root");
    expect(calls).toEqual([META]);
    expect(engine.registry.dialectUriFor(inner)).toBe(META);
    expect(engine.evaluate(uri, "abc").valid).toBe(true);
    expect(engine.evaluate(uri, "abcd").valid).toBe(false);
  });

  it("two embedded dialects cost two fetches and no spinning", async () => {
    const A = "https://v.test/meta-a";
    const B = "https://v.test/meta-b";
    const vocab = { [CORE]: true, [VALIDATION]: true };
    const { loader, calls } = counting({
      [A]: { $id: A, $vocabulary: vocab },
      [B]: { $id: B, $vocabulary: vocab },
    });
    const engine = createEngine({ loaders: [loader] });
    await engine.loadSchema(
      {
        $defs: {
          a: { $id: "https://v.test/a", $schema: A },
          b: { $id: "https://v.test/b", $schema: B },
        },
      },
      "https://v.test/two",
    );
    expect([...calls].sort()).toEqual([A, B]);
    expect(engine.registry.dialectUriFor("https://v.test/a")).toBe(A);
    expect(engine.registry.dialectUriFor("https://v.test/b")).toBe(B);
  });

  it("an unknown root dialect is named too", () => {
    const engine = createEngine();
    let caught: unknown;
    try {
      engine.registerSchema({ $schema: META }, "https://v.test/root-only");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(UnknownDialectError);
    expect((caught as UnknownDialectError).dialectUri).toBe(META);
  });

  it("a self-describing metaschema loads", async () => {
    const { loader, calls } = counting({
      [META]: {
        $id: META,
        $schema: META,
        $vocabulary: { [CORE]: true, [VALIDATION]: true },
      },
    });
    const engine = createEngine({ loaders: [loader] });
    const uri = await engine.loadSchema(
      { $schema: META, maxLength: 3 },
      "https://v.test/self-root",
    );
    expect(calls).toEqual([META]);
    expect(engine.registry.has(META)).toBe(true);
    expect(engine.registry.dialectUriFor(META)).toBe(META);
    expect(engine.registry.dialectUriFor(uri)).toBe(META);
    expect(engine.evaluate(uri, "abcd").valid).toBe(false);
  });

  it("a two-metaschema cycle is named", async () => {
    const A = "https://v.test/cycle-a";
    const B = "https://v.test/cycle-b";
    const { loader } = counting({
      [A]: { $id: A, $schema: B, $vocabulary: { [CORE]: true } },
      [B]: { $id: B, $schema: A, $vocabulary: { [CORE]: true } },
    });
    const engine = createEngine({ loaders: [loader] });
    await expect(
      engine.loadSchema({ $schema: A }, "https://v.test/cyclic"),
    ).rejects.toThrow(/metaschema cycle/);
    await expect(
      engine.loadSchema({ $schema: A }, "https://v.test/cyclic"),
    ).rejects.toMatchObject({ dialectUri: A });
    expect(engine.dialects.hasDialect(A)).toBe(false);
    expect(engine.dialects.hasDialect(B)).toBe(false);
  });

  it("a metaschema's own missing dialect is the one named", async () => {
    const DEEPER = "https://v.test/deeper";
    const { loader } = counting({
      [META]: { $id: META, $schema: DEEPER, $vocabulary: { [CORE]: true } },
    });
    const engine = createEngine({ loaders: [loader] });
    await expect(
      engine.loadSchema({ $schema: META }, "https://v.test/deep-root"),
    ).rejects.toMatchObject({ dialectUri: DEEPER });
  });
});

describe("validateSchemas checks each resource under its own metaschema", () => {
  it("a mixed document validates per resource and passes", () => {
    const engine = createEngine({ validateSchemas: true });
    const uri = engine.registerSchema(mixed(), O);
    expect(engine.evaluate(uri, { old: ["a", 1] }).valid).toBe(true);
  });

  it("masking is what lets it pass: the raw root fails the root metaschema", () => {
    const engine = createEngine();
    // Negative control: the 2020-12 metaschema rejects the embedded
    // draft-07 array `items` when it sees the whole document.
    expect(engine.evaluate(DIALECT_2020_12, mixed()).valid).toBe(false);
  });

  it("an invalid embedded resource is caught by its own metaschema and nothing registers", () => {
    const engine = createEngine({ validateSchemas: true });
    const doc: JsonValue = {
      $id: O,
      $defs: { legacy: { $id: L, $schema: DIALECT_DRAFT_07, type: 123 } },
    };
    expect(() => engine.registerSchema(doc, O)).toThrow(SchemaValidationError);
    expect(() => engine.registerSchema(doc, O)).toThrow(
      `schema '${L}' fails its metaschema '${DIALECT_DRAFT_07}'`,
    );
    expect(engine.registry.has(O)).toBe(false);
    expect(engine.registry.has(L)).toBe(false);
  });

  it("skips a resource whose dialect has no metaschema", () => {
    const engine = createEngine({ validateSchemas: true });
    engine.registerDialect("urn:nometa", [CORE, VALIDATION]);
    const uri = engine.registerSchema(
      {
        $id: O,
        $defs: { s: { $id: L, $schema: "urn:nometa", type: 123 } },
      },
      O,
    );
    expect(engine.registry.dialectUriFor(L)).toBe("urn:nometa");
    expect(uri).toBe(O);
  });
});

describe("a $ref's siblings contribute nothing at registration under draft-07", () => {
  const bundled = (): JsonValue => ({
    $ref: "#/definitions/a",
    pattern: "(a+)+$",
    properties: { p: { $ref: "https://never.example/x" } },
    definitions: { a: { $id: "#anch", type: "string" } },
  });

  it("registers without screening or queuing what a $ref makes absent", () => {
    const engine = createEngine({
      defaultDialect: DIALECT_DRAFT_07,
      rejectUnsafeRegex: true,
    });
    const uri = engine.registerSchema(bundled(), "https://s.test/bundled");
    expect(engine.registry.takeUnresolved()).toEqual([]);
    expect(engine.evaluate(uri, "s").valid).toBe(true);
    expect(engine.evaluate(uri, 1).valid).toBe(false);
  });

  it("screens the same object under 2020-12", () => {
    const engine = createEngine({ rejectUnsafeRegex: true });
    expect(() =>
      engine.registerSchema(bundled(), "https://s.test/modern"),
    ).toThrow(UnsafeRegexError);
  });

  it("still resolves a pointer into a sibling, but mints no anchor there", () => {
    const engine = createEngine({ defaultDialect: DIALECT_DRAFT_07 });
    const uri = engine.registerSchema(bundled(), "https://s.test/pointer");
    const reg = engine.registry;
    expect(reg.resolveRef("#/definitions/a", uri).node).toEqual({
      $id: "#anch",
      type: "string",
    });
    expect(() => reg.resolveRef("#anch", uri)).toThrow(UnresolvableRefError);
  });
});
