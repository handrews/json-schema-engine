// Registration integrity (ADR 0005): a registration that throws writes
// nothing; one resource holds one schema and one anchor name names one
// object within it; a document is replaced by unregistering it first; a
// base-URI identifier must name a resource of its own.

import { describe, it, expect } from "vitest";
import {
  createEngine,
  DIALECT_2019_09,
  DIALECT_DRAFT_07,
  DuplicateAnchorError,
  DuplicateResourceError,
  InvalidIdentifierError,
  InvalidSchemaError,
  MaxDepthExceededError,
  NonUnicodeRegexError,
  UnknownFormatError,
  UnresolvableRefError,
  UnsafeRegexError,
  VOCAB_FORMAT_ASSERTION,
  DIALECT_2020_12,
  type Engine,
  type JsonValue,
  type KeywordBehavior,
} from "@json-schema-engine/core";

const CORE = "https://json-schema.org/draft/2020-12/vocab/core";
const EXTERNAL = "https://integrity.example/never-registered";

// The unions a failed walk must not widen.
function unions(engine: Engine) {
  const reg = engine.registry;
  return {
    produced: reg.producedIds().size,
    consumed: reg.consumedIds().size,
    coverage: reg.coverageIds().size,
  };
}

// Every failing document below claims anchor `keep` and references
// EXTERNAL before the point of failure, so a half-written registration
// would show up as a resolvable anchor or a queued fetch.
function expectNothingRegistered(
  engine: Engine,
  uri: string,
  before: ReturnType<typeof unions>,
) {
  const reg = engine.registry;
  expect(reg.has(uri)).toBe(false);
  expect(() => reg.resolveRef(`${uri}#keep`, uri)).toThrow(
    UnresolvableRefError,
  );
  expect(reg.takeUnresolved()).toEqual([]);
  expect(unions(engine)).toEqual(before);
  // The engine is still usable.
  expect(engine.registerSchema({ type: "string" }, `${uri}-after`)).toBe(
    `${uri}-after`,
  );
}

describe("a failed registration writes nothing", () => {
  const cases: [string, () => Engine, JsonValue, new () => Error][] = [
    [
      "non-schema value",
      () => createEngine(),
      {
        $anchor: "keep",
        $ref: EXTERNAL,
        unevaluatedProperties: false,
        properties: { p: 5 },
      },
      InvalidSchemaError,
    ],
    [
      "maxDepth",
      () => createEngine({ maxDepth: 3 }),
      {
        $anchor: "keep",
        $ref: EXTERNAL,
        unevaluatedProperties: false,
        not: { not: { not: { not: { not: true } } } },
      },
      MaxDepthExceededError,
    ],
    [
      "unresolvable embedded $id",
      () => createEngine(),
      {
        $anchor: "keep",
        $ref: EXTERNAL,
        unevaluatedProperties: false,
        $defs: { bad: { $id: "http://" } },
      },
      UnresolvableRefError,
    ],
    [
      "unsafe regex",
      () => createEngine({ rejectUnsafeRegex: true }),
      {
        $anchor: "keep",
        $ref: EXTERNAL,
        unevaluatedProperties: false,
        properties: { p: { pattern: "(a+)+$" } },
      },
      UnsafeRegexError,
    ],
    [
      "non-unicode regex",
      () => createEngine(),
      {
        $anchor: "keep",
        $ref: EXTERNAL,
        unevaluatedProperties: false,
        properties: { p: { pattern: "\\c" } },
      },
      NonUnicodeRegexError,
    ],
  ];
  for (const [label, build, schema, error] of cases) {
    it(`after ${label}`, () => {
      const engine = build();
      const before = unions(engine);
      const uri = `https://integrity.example/${label.replace(/\W+/g, "-")}`;
      expect(() => engine.registerSchema(schema, uri)).toThrow(error);
      expectNothingRegistered(engine, uri, before);
    });
  }

  it("after an unknown format under the format-assertion vocabulary", () => {
    const engine = createEngine({ formats: { ipv4: { test: () => true } } });
    const base = engine.dialects.getDialect(DIALECT_2020_12);
    const DIALECT = "urn:integrity:asserting";
    engine.registerDialect(DIALECT, [
      ...base.vocabularyUris.filter((u) => !u.includes("format-annotation")),
      VOCAB_FORMAT_ASSERTION,
    ]);
    const before = unions(engine);
    const uri = "https://integrity.example/format";
    expect(() =>
      engine.registerSchema(
        {
          $anchor: "keep",
          $ref: EXTERNAL,
          unevaluatedProperties: false,
          properties: { p: { format: "no-such-format" } },
        },
        uri,
        DIALECT,
      ),
    ).toThrow(UnknownFormatError);
    expectNothingRegistered(engine, uri, before);
  });

  it("after a custom keyword's analyze() throws", () => {
    const VOCAB = "urn:integrity:vocab";
    const DIALECT = "urn:integrity:dialect";
    const engine = createEngine();
    const boom: KeywordBehavior = {
      id: `${VOCAB}#boom`,
      analyze: () => {
        throw new Error("boom");
      },
      evaluate: () => true,
    };
    engine.registerVocabulary(VOCAB, { boom });
    engine.registerDialect(DIALECT, [CORE, VOCAB]);
    const before = unions(engine);
    const uri = "https://integrity.example/custom";
    expect(() =>
      engine.registerSchema(
        { $anchor: "keep", $ref: EXTERNAL, boom: true },
        uri,
        DIALECT,
      ),
    ).toThrow("boom");
    expectNothingRegistered(engine, uri, before);
  });

  it("after a native stack overflow, as the typed depth error", () => {
    const engine = createEngine({ maxDepth: 1e7 });
    const before = unions(engine);
    let schema: JsonValue = { type: "string" };
    for (let i = 0; i < 100_000; i++) schema = { not: schema };
    const uri = "https://integrity.example/overflow";
    expect(() =>
      engine.registerSchema(
        { $anchor: "keep", $ref: EXTERNAL, allOf: [schema] },
        uri,
      ),
    ).toThrow(MaxDepthExceededError);
    expectNothingRegistered(engine, uri, before);
  });

  it("keeps the registered version when an equal re-registration fails part-way", () => {
    const engine = createEngine();
    const uri = "https://integrity.example/keep-v1";
    const doc = { $defs: { x: { $anchor: "x", pattern: "a" } } };
    engine.registerSchema(doc, uri);
    const reg = engine.registry;
    const root = reg.rootRef(uri);
    const x = reg.resolveRef("#x", uri);
    // Equal at the root, so the registration is accepted as a rebinding —
    // and then a screen installed since rejects its pattern. v1 must still
    // be there, untouched: same objects, same anchors.
    reg.onRegex = () => {
      throw new UnsafeRegexError("screened");
    };
    expect(() => engine.registerSchema(structuredClone(doc), uri)).toThrow(
      UnsafeRegexError,
    );
    reg.onRegex = undefined;
    expect(reg.rootRef(uri)).toBe(root);
    expect(reg.resolveRef("#x", uri)).toBe(x);
  });

  it("leaves a snapshot's sharing intact when the walk fails", () => {
    const engine = createEngine();
    const uri = engine.registerSchema(
      { type: "string" },
      "https://integrity.example/shared",
    );
    const reg = engine.registry;
    const view = reg.snapshot();
    expect(() =>
      engine.registerSchema(
        { properties: { p: 5 } },
        "https://integrity.example/shared-fail",
      ),
    ).toThrow(InvalidSchemaError);
    // No commit ran, so the copy-on-write copy was never made: the live
    // registry still hands out the very object the view does.
    expect(view.rootRef(uri)).toBe(reg.rootRef(uri));
  });
});

describe("one resource, one schema", () => {
  it("refuses two embedded $ids naming one resource in a document", () => {
    const engine = createEngine();
    expect(() =>
      engine.registerSchema(
        {
          $defs: {
            a: { $id: "https://integrity.example/s", type: "string" },
            b: { $id: "https://integrity.example/s", type: "string" },
          },
        },
        "https://integrity.example/twice",
      ),
    ).toThrow(DuplicateResourceError);
    expect(engine.registry.has("https://integrity.example/twice")).toBe(false);
    expect(engine.registry.has("https://integrity.example/s")).toBe(false);
  });

  it("refuses an embedded $id that repeats the root's", () => {
    const engine = createEngine();
    expect(() =>
      engine.registerSchema(
        {
          $id: "https://integrity.example/root-twice",
          $defs: { a: { $id: "https://integrity.example/root-twice" } },
        },
        "https://integrity.example/root-twice",
      ),
    ).toThrow(DuplicateResourceError);
  });

  it("refuses a different document under a registered root URI, directly or through its alias", () => {
    const engine = createEngine();
    const declared = "https://integrity.example/declared";
    const retrieval = "https://integrity.example/retrieval";
    engine.registerSchema({ $id: declared, type: "string" }, retrieval);
    expect(() =>
      engine.registerSchema({ $id: declared, type: "integer" }, declared),
    ).toThrow(DuplicateResourceError);
    expect(() => engine.registerSchema({ type: "integer" }, retrieval)).toThrow(
      DuplicateResourceError,
    );
    expect(() =>
      engine.registerSchema(
        { $id: "https://integrity.example/other", type: "integer" },
        retrieval,
      ),
    ).toThrow(DuplicateResourceError);
    expect(engine.evaluate(declared, "still a string").valid).toBe(true);
    expect(engine.evaluate(retrieval, 1).valid).toBe(false);
    expect(engine.registry.has("https://integrity.example/other")).toBe(false);
  });

  it("accepts an equal re-registration, walking it again", () => {
    const engine = createEngine();
    const uri = "https://integrity.example/equal";
    const v1 = { $defs: { x: { $anchor: "x" } }, $ref: EXTERNAL };
    const v2 = { $ref: EXTERNAL, $defs: { x: { $anchor: "x" } } };
    engine.registerSchema(v1, uri);
    const reg = engine.registry;
    expect(reg.takeUnresolved()).toEqual([EXTERNAL]);
    engine.registerSchema(v2, uri);
    // The references are queued again, and the anchors now name the new
    // copy's objects (the interned ones, as always).
    expect(reg.takeUnresolved()).toEqual([EXTERNAL]);
    expect(reg.resolveRef("#x", uri).node).toBe(v2.$defs.x);
    expect(reg.resolveRef("#x", uri)).toBe(
      reg.child(reg.rootRef(uri), ["$defs", "x"]),
    );
  });

  it("refuses an embedded $id that another document holds with different content", () => {
    const engine = createEngine();
    const shared = "https://integrity.example/shared-sub";
    engine.registerSchema(
      { $defs: { s: { $id: shared, type: "string" } } },
      "https://integrity.example/holder-a",
    );
    expect(() =>
      engine.registerSchema(
        { $defs: { s: { $id: shared, type: "integer" } } },
        "https://integrity.example/holder-b",
      ),
    ).toThrow(DuplicateResourceError);
    expect(engine.registry.has("https://integrity.example/holder-b")).toBe(
      false,
    );
    expect(engine.evaluate(shared, "s").valid).toBe(true);
  });

  it("lets an equal embedded copy take the resource over, and follows it through unregister", () => {
    const engine = createEngine();
    const shared = "https://integrity.example/shared-eq";
    const a = engine.registerSchema(
      { $defs: { s: { $id: shared, type: "string" } } },
      "https://integrity.example/eq-a",
    );
    const b = engine.registerSchema(
      { $defs: { s: { $id: shared, type: "string" } } },
      "https://integrity.example/eq-b",
    );
    const reg = engine.registry;
    expect(reg.documentLocation(shared)?.documentUri).toBe(b);
    // The resource goes with its current owner: removing the older holder
    // keeps it, removing the newer one takes it away.
    engine.unregisterSchema(a);
    expect(reg.has(shared)).toBe(true);
    engine.unregisterSchema(b);
    expect(reg.has(shared)).toBe(false);
  });

  it("treats a root registration of another document's embedded resource the same way", () => {
    const engine = createEngine();
    const sub = "https://integrity.example/sub";
    const holder = engine.registerSchema(
      { $defs: { s: { $id: sub, type: "string" } } },
      "https://integrity.example/sub-holder",
    );
    expect(() =>
      engine.registerSchema({ $id: sub, type: "integer" }, sub),
    ).toThrow(DuplicateResourceError);
    expect(engine.registerSchema({ $id: sub, type: "string" }, sub)).toBe(sub);
    const reg = engine.registry;
    expect(reg.documentLocation(sub)).toEqual({
      documentUri: sub,
      pointer: "",
    });
    engine.unregisterSchema(holder);
    expect(reg.has(sub)).toBe(true);
    expect(engine.evaluate(sub, "s").valid).toBe(true);
  });

  it("refuses an $id equal to another document's retrieval URI", () => {
    const engine = createEngine();
    const retrieval = "https://integrity.example/alias-key";
    engine.registerSchema(
      { $id: "https://integrity.example/alias-target" },
      retrieval,
    );
    expect(() =>
      engine.registerSchema(
        { $defs: { a: { $id: retrieval, type: "string" } } },
        "https://integrity.example/alias-claimer",
      ),
    ).toThrow(DuplicateResourceError);
    expect(() => engine.registerSchema({ type: "string" }, retrieval)).toThrow(
      DuplicateResourceError,
    );
  });
});

describe("one anchor name, one object per resource", () => {
  it("refuses two $anchors of one name", () => {
    const engine = createEngine();
    expect(() =>
      engine.registerSchema(
        { $defs: { a: { $anchor: "n" }, b: { $anchor: "n" } } },
        "https://integrity.example/anchors",
      ),
    ).toThrow(DuplicateAnchorError);
  });

  it("refuses an $anchor and a $dynamicAnchor of one name on different objects", () => {
    const engine = createEngine();
    expect(() =>
      engine.registerSchema(
        { $defs: { a: { $anchor: "n" }, b: { $dynamicAnchor: "n" } } },
        "https://integrity.example/mixed-anchors",
      ),
    ).toThrow(DuplicateAnchorError);
  });

  it("accepts both keywords under one name on one object", () => {
    const engine = createEngine();
    const uri = engine.registerSchema(
      { $defs: { a: { $anchor: "n", $dynamicAnchor: "n", type: "string" } } },
      "https://integrity.example/both",
    );
    const reg = engine.registry;
    expect(reg.resolveRef("#n", uri)).toBe(reg.dynamicAnchor(uri, "n"));
  });

  it("accepts one name in two resources of one document", () => {
    const engine = createEngine();
    const uri = engine.registerSchema(
      {
        $defs: {
          a: { $anchor: "n", type: "string" },
          b: { $id: "https://integrity.example/inner", $anchor: "n" },
        },
      },
      "https://integrity.example/two-resources",
    );
    const reg = engine.registry;
    expect(reg.resolveRef("#n", uri).pointer).toBe("/$defs/a");
    expect(
      reg.resolveRef("#n", "https://integrity.example/inner").pointer,
    ).toBe("");
  });
});

describe("unregister", () => {
  it("removes a document and everything it owned, while a snapshot keeps it all", () => {
    const engine = createEngine({ defaultDialect: DIALECT_2019_09 });
    const declared = "https://integrity.example/u-declared";
    const retrieval = "https://integrity.example/u-retrieval";
    const inner = "https://integrity.example/u-inner";
    const range = {
      value: { start: { line: 1, column: 1 }, end: { line: 1, column: 2 } },
    };
    engine.registerSchema(
      {
        $id: declared,
        $recursiveAnchor: true,
        $defs: {
          a: { $anchor: "plain" },
          i: { $id: inner, $anchor: "in", $recursiveAnchor: true },
        },
      },
      retrieval,
      undefined,
      () => range,
    );
    const reg = engine.registry;
    const view = reg.snapshot();
    expect(engine.locate(`${declared}#`)?.range).toBe(range);

    engine.unregisterSchema(retrieval);

    for (const r of [declared, retrieval, inner]) {
      expect(reg.has(r)).toBe(false);
    }
    expect(() => reg.rootRef(retrieval)).toThrow(UnresolvableRefError);
    expect(() => reg.resolveRef("#plain", declared)).toThrow(
      UnresolvableRefError,
    );
    expect(() => reg.resolveRef("#in", inner)).toThrow(UnresolvableRefError);
    expect(reg.hasRecursiveRoot(declared)).toBe(false);
    expect(reg.hasRecursiveRoot(inner)).toBe(false);
    expect(engine.locate(`${declared}#`)).toBeUndefined();

    expect(view.rootRef(retrieval).baseUri).toBe(declared);
    expect(view.resolveRef("#plain", declared).pointer).toBe("/$defs/a");
    expect(view.resolveRef("#in", inner).pointer).toBe("");
    expect(view.hasRecursiveRoot(declared)).toBe(true);
    expect(view.hasRecursiveRoot(inner)).toBe(true);
    expect(view.documentLocation(inner)).toEqual({
      documentUri: declared,
      pointer: "/$defs/i",
    });
    expect(view.range(declared, "")).toBe(range);
  });

  it("is how a document is replaced", () => {
    const engine = createEngine();
    const uri = "https://integrity.example/replace";
    engine.registerSchema({ type: "string" }, uri);
    expect(() => engine.registerSchema({ type: "integer" }, uri)).toThrow(
      DuplicateResourceError,
    );
    engine.unregisterSchema(uri);
    engine.registerSchema({ type: "integer" }, uri);
    expect(engine.evaluate(uri, 1).valid).toBe(true);
  });

  it("drops a stale range lookup with the document", () => {
    const engine = createEngine();
    const uri = "https://integrity.example/ranges";
    const range = {
      value: { start: { line: 1, column: 1 }, end: { line: 1, column: 2 } },
    };
    engine.registerSchema({}, uri, undefined, () => range);
    engine.unregisterSchema(uri);
    engine.registerSchema({}, uri);
    expect(engine.locate(`${uri}#`)).toEqual({ documentUri: uri, pointer: "" });
  });

  it("refuses an unknown URI and a resource embedded in another document", () => {
    const engine = createEngine();
    const holder = engine.registerSchema(
      { $defs: { s: { $id: "https://integrity.example/embedded" } } },
      "https://integrity.example/embedder",
    );
    expect(() => {
      engine.unregisterSchema("https://integrity.example/nowhere");
    }).toThrow(UnresolvableRefError);
    expect(() => {
      engine.unregisterSchema("https://integrity.example/embedded");
    }).toThrow(holder);
    expect(engine.registry.has(holder)).toBe(true);
  });

  it("leaves the unions and the pending queue alone", () => {
    const engine = createEngine();
    const uri = engine.registerSchema(
      { $ref: EXTERNAL, properties: { p: true }, unevaluatedProperties: false },
      "https://integrity.example/unions",
    );
    const before = unions(engine);
    engine.unregisterSchema(uri);
    expect(unions(engine)).toEqual(before);
    expect(engine.registry.takeUnresolved()).toEqual([EXTERNAL]);
  });
});

describe("a base identifier must name a resource", () => {
  const dialects: [string, () => Engine, string | undefined][] = [
    ["2020-12", () => createEngine(), undefined],
    [
      "2019-09",
      () => createEngine({ defaultDialect: DIALECT_2019_09 }),
      undefined,
    ],
    [
      "a custom dialect on the 2020-12 core",
      () => {
        const engine = createEngine();
        engine.registerDialect("urn:integrity:custom", [CORE]);
        return engine;
      },
      "urn:integrity:custom",
    ],
  ];
  for (const [label, build, dialect] of dialects) {
    describe(`under ${label}`, () => {
      for (const id of ["#a", "", "#", "sub#frag"]) {
        it(`refuses an embedded $id of ${JSON.stringify(id)}`, () => {
          const engine = build();
          const uri = "https://integrity.example/frag";
          expect(() =>
            engine.registerSchema({ $defs: { a: { $id: id } } }, uri, dialect),
          ).toThrow(InvalidIdentifierError);
          expect(engine.registry.has(uri)).toBe(false);
        });
      }
      it("refuses a root $id with a fragment", () => {
        const engine = build();
        expect(() =>
          engine.registerSchema(
            { $id: "#a" },
            "https://integrity.example/root-frag",
            dialect,
          ),
        ).toThrow(InvalidIdentifierError);
      });
      it("accepts an empty trailing fragment", () => {
        const engine = build();
        const uri = engine.registerSchema(
          { $defs: { a: { $id: "sub#", type: "string" } } },
          "https://integrity.example/dir/root",
          dialect,
        );
        expect(
          engine.registry.rootRef("https://integrity.example/dir/sub").baseUri,
        ).toBe("https://integrity.example/dir/sub");
        expect(engine.evaluate(`${uri}#/$defs/a`, "s").valid).toBe(true);
      });
    });
  }

  it("reads a plain-fragment $id as an anchor under draft-07 and still refuses an empty one", () => {
    const engine = createEngine({ defaultDialect: DIALECT_DRAFT_07 });
    const uri = engine.registerSchema(
      {
        definitions: { a: { $id: "#a", type: "string" }, b: { $id: "#" } },
        properties: { p: { $ref: "#a" } },
      },
      "https://integrity.example/legacy",
    );
    expect(engine.evaluate(uri, { p: "s" }).valid).toBe(true);
    expect(engine.evaluate(uri, { p: 1 }).valid).toBe(false);
    expect(() =>
      engine.registerSchema(
        { definitions: { a: { $id: "" } } },
        "https://integrity.example/legacy-empty",
      ),
    ).toThrow(InvalidIdentifierError);
  });
});
