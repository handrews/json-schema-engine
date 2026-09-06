// Channel record kinds (DESIGN.md §4; draft-03 §12.9 and Appendix D):
// an annotation carries a keyword's own value to applications, dependency
// data carries computed information between keywords and never reaches
// output. Applicator keywords are dependency producers only (ADR 0002).

import { describe, it, expect } from "vitest";
import {
  createEngine,
  evaluateFragment,
  makeRecordPredicate,
  rootCursor,
  runEvaluation,
  UndeclaredProductionError,
  type EvaluateOptions,
  type JsonValue,
  type KeywordBehavior,
  type Result,
} from "@jse/core";

const DEPENDENCY_PRODUCERS = [
  "properties",
  "patternProperties",
  "additionalProperties",
  "prefixItems",
  "items",
  "contains",
  "unevaluatedProperties",
  "unevaluatedItems",
];

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

function run(options?: EvaluateOptions): Result {
  const engine = createEngine();
  const uri = engine.registerSchema(schema, "https://records.example/mixed");
  return engine.evaluate(uri, instance, {
    annotations: true,
    output: "list",
    ...options,
  });
}

describe("annotation output carries keyword values only", () => {
  it("renders every annotation keyword with its exact value and no applicator", () => {
    const r = run();
    expect(r.valid).toBe(true);
    const units = (r.annotations ?? []).map((a) => [
      a.keyword,
      a.inputLocation,
      a.annotation,
    ]);
    expect(units).toEqual(
      expect.arrayContaining([
        ["title", "", "Record kinds"],
        ["default", "", { nested: [1, { deep: true }] }],
        ["x-note", "", ["vendor", { data: 1 }]],
        ["format", "/a", "email"],
        ["title", "/extra", "extra"],
      ]),
    );
    expect(units).toHaveLength(5);
    for (const [keyword] of units) {
      expect(DEPENDENCY_PRODUCERS).not.toContain(keyword);
    }
  });

  it("keeps the same output when every structure is requested", () => {
    const list = run({ output: "list" });
    const hierarchical = run({ output: "hierarchical", verbose: true });
    const text = JSON.stringify(hierarchical.outputDocument);
    for (const keyword of DEPENDENCY_PRODUCERS) {
      expect(text).not.toContain(`"${keyword}":`);
    }
    expect(list.annotations).toHaveLength(5);
  });

  it("selecting only an applicator keyword retains nothing", () => {
    const r = run({ annotations: { keywords: ["properties"] } });
    expect(r.valid).toBe(true);
    expect(r.annotations).toEqual([]);
  });

  it("records the two kinds in separate stores", () => {
    const engine = createEngine();
    const uri = engine.registerSchema(schema, "https://records.example/stores");
    const { valid, state } = runEvaluation(engine.registry, uri, instance);
    expect(valid).toBe(true);
    const annotationKeywords = state.rootAnnotations.map((a) => a.keywordName);
    expect(annotationKeywords.sort()).toEqual(
      ["default", "format", "title", "title", "x-note"].sort(),
    );
    const dependencyKeywords = new Set(
      state.rootDependencies.map((d) => d.keywordName),
    );
    expect([...dependencyKeywords].sort()).toEqual(
      [...DEPENDENCY_PRODUCERS].sort(),
    );
    for (const a of state.rootAnnotations) expect(a.kind).toBe("annotation");
    for (const d of state.rootDependencies) expect(d.kind).toBe("dependency");
  });
});

describe("dependency data still drives consumers", () => {
  it("unevaluatedProperties sees properties through allOf", () => {
    const engine = createEngine();
    const uri = engine.registerSchema(
      { allOf: [{ properties: { a: true } }], unevaluatedProperties: false },
      "https://records.example/names",
    );
    expect(engine.evaluate(uri, { a: 1 }).valid).toBe(true);
    expect(engine.evaluate(uri, { a: 1, b: 2 }).valid).toBe(false);
  });

  it("unevaluatedItems sees prefixItems through allOf", () => {
    const engine = createEngine();
    const uri = engine.registerSchema(
      { allOf: [{ prefixItems: [true] }], unevaluatedItems: false },
      "https://records.example/indexes",
    );
    expect(engine.evaluate(uri, [1]).valid).toBe(true);
    expect(engine.evaluate(uri, [1, 2]).valid).toBe(false);
  });
});

describe("custom producers and consumers", () => {
  const VOCAB = "urn:jse:test:vocab:records";
  const DIALECT = "urn:jse:test:dialect:records";
  const undeclared: KeywordBehavior = {
    id: `${VOCAB}#undeclared`,
    evaluate: (_value, _cursor, ctx) => {
      ctx.produce(["x"]);
      return true;
    },
  };
  const declared: KeywordBehavior = {
    id: `${VOCAB}#declared`,
    analyze: () => ({ produces: [`${VOCAB}#declared`] }),
    evaluate: (_value, _cursor, ctx) => {
      ctx.produce(["x"]);
      return true;
    },
  };
  const reader: KeywordBehavior = {
    id: `${VOCAB}#reader`,
    phase: 1,
    analyze: () => ({ consumes: [`${VOCAB}#declared`] }),
    evaluate: (_value, _cursor, ctx) => {
      const seen = ctx.visible([`${VOCAB}#declared`]);
      return (
        seen.length === 1 &&
        seen[0]!.behaviorId === `${VOCAB}#declared` &&
        JSON.stringify(seen[0]!.data) === '["x"]'
      );
    },
  };

  function engineWith(): ReturnType<typeof createEngine> {
    const engine = createEngine();
    engine.registerVocabulary(VOCAB, { undeclared, declared, reader });
    engine.registerDialect(DIALECT, [
      "https://json-schema.org/draft/2020-12/vocab/core",
      VOCAB,
    ]);
    return engine;
  }

  it("throws when a keyword produces without declaring it", () => {
    const engine = engineWith();
    const uri = engine.registerSchema(
      { undeclared: true },
      "https://records.example/undeclared",
      DIALECT,
    );
    expect(() => engine.evaluate(uri, 1)).toThrow(UndeclaredProductionError);
    expect(() => engine.evaluate(uri, 1, { output: "hierarchical" })).toThrow(
      UndeclaredProductionError,
    );
  });

  it("delivers declared data to a declared consumer under every output", () => {
    const engine = engineWith();
    const uri = engine.registerSchema(
      { declared: true, reader: true },
      "https://records.example/declared",
      DIALECT,
    );
    expect(engine.evaluate(uri, 1).valid).toBe(true);
    expect(
      engine.evaluate(uri, 1, { output: "list", annotations: true })
        .annotations,
    ).toEqual([]);
    expect(engine.evaluate(uri, 1, { output: "hierarchical" }).valid).toBe(
      true,
    );
  });

  it("elides declared data nobody consumes", () => {
    const engine = engineWith();
    const uri = engine.registerSchema(
      { declared: true },
      "https://records.example/unconsumed",
      DIALECT,
    );
    const { state } = runEvaluation(
      engine.registry,
      uri,
      1,
      false,
      makeRecordPredicate(false),
    );
    expect(state.rootDependencies).toEqual([]);
    const traced = runEvaluation(engine.registry, uri, 1, true);
    expect(traced.state.rootDependencies.map((d) => d.data)).toEqual([["x"]]);
  });
});

describe("evaluateFragment", () => {
  it("returns annotations and dependency data with cursor identity intact", () => {
    const engine = createEngine();
    const uri = engine.registerSchema(
      { $defs: { obj: { properties: { a: true }, title: "T" } } },
      "https://records.example/fragment",
    );
    const target = engine.registry.resolveRef(`${uri}#/$defs/obj`, uri);
    const cursor = rootCursor({ a: 1 });
    const result = evaluateFragment(engine.registry, target, cursor);
    expect(result.valid).toBe(true);
    expect(result.annotations.map((a) => [a.keywordName, a.value])).toEqual([
      ["title", "T"],
    ]);
    expect(result.dependencies.map((d) => [d.keywordName, d.data])).toEqual([
      ["properties", ["a"]],
    ]);
    expect(result.dependencies[0]!.cursor).toBe(cursor);
    expect(result.annotations[0]!.cursor).toBe(cursor);
  });
});
