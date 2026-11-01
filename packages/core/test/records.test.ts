// Channel record kinds (DESIGN.md §4; draft-03 §12.9 and Appendix D):
// an annotation carries a keyword's own value to applications, dependency
// data carries computed information between keywords and never reaches
// output. Applicator keywords are dependency producers only (ADR 0002).

import { describe, it, expect } from "vitest";
import {
  childCursor,
  createEngine,
  evaluateFragment,
  makeRecordPredicate,
  renderDetailed,
  renderHierarchical,
  renderList,
  rootCursor,
  runEvaluation,
  toRenderNode,
  traceToRenderNodes,
  UndeclaredProductionError,
  type Cursor,
  type EvaluateOptions,
  type JsonValue,
  type KeywordBehavior,
  type PathNode,
  type RenderNode,
  type Result,
  type TraceNode,
} from "@json-schema-engine/core";

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

describe("traceToRenderNodes", () => {
  it("locates a traced fragment under the caller's prefixes", () => {
    const engine = createEngine();
    const uri = engine.registerSchema(
      {
        $defs: {
          obj: {
            anyOf: [{ required: ["a"] }, { required: ["b"] }],
            title: "T",
          },
        },
      },
      "https://records.example/graft",
    );
    const target = engine.registry.resolveRef(`${uri}#/$defs/obj`, uri);
    const r = evaluateFragment(engine.registry, target, rootCursor({ b: 1 }), {
      pathNode: { parent: null, segment: "properties/o/$ref" },
      tracing: true,
    });
    const { root, at } = traceToRenderNodes(r.traceRoot!, "/o");
    expect(root.evaluationPath).toBe("/properties/o/$ref");
    expect(root.schemaLocation).toBe(`${uri}#/$defs/obj`);
    expect(root.inputLocation).toBe("/o");
    expect(root.valid).toBe(true);
    expect(root.keywords.map((k) => k.name)).toEqual(["anyOf", "title"]);
    expect(root.children.map((c) => c.evaluationPath)).toEqual([
      "/properties/o/$ref/anyOf/0",
      "/properties/o/$ref/anyOf/1",
    ]);
    expect(root.children.map((c) => c.valid)).toEqual([false, true]);
    // Owners by path-node identity: the dropped error belongs to branch 0.
    expect(at.get(r.droppedErrors[0]!.pathNode)).toEqual([root.children[0]]);
    expect(at.get(r.allAnnotations[0]!.pathNode)).toEqual([root]);
    expect(root.errors).toEqual([]);
  });
});

// --- the located tree at the relevant level ---------------------------------

type Sets = Parameters<typeof toRenderNode>[1];

describe("toRenderNode pruning", () => {
  // A hand-built trace: every application mints its own path node, records
  // attach by that identity.
  const node = (
    segment: string | null,
    parent: PathNode | null,
  ): PathNode | null => (segment === null ? parent : { parent, segment });
  const trace = (
    pathNode: PathNode | null,
    cursor: Cursor,
    children: TraceNode[] = [],
    valid = true,
  ): TraceNode => ({
    schemaRef: REF,
    pathNode,
    cursor,
    valid,
    keywords: [],
    children,
  });
  const REF = {
    node: {},
    baseUri: "https://records.example/tree",
    pointer: "",
  };
  const root = rootCursor({ a: { b: "x" }, c: 1, d: 2 });
  const sets = (
    overrides: Partial<Record<keyof Sets, { pathNode: PathNode | null }[]>>,
  ): Sets =>
    ({
      errors: [],
      droppedErrors: [],
      annotations: [],
      droppedAnnotations: [],
      ...overrides,
    }) as unknown as Sets;
  const paths = (n: RenderNode): string[] => [
    n.evaluationPath,
    ...n.children.flatMap(paths),
  ];

  // root → [/properties/a → [/properties/a/properties/b (annotation)],
  //         /properties/c (annotation), /properties/d (nothing)]
  const pA = node("a", node("properties", null));
  const pB = node("b", node("properties", pA));
  const pC = node("c", node("properties", null));
  const pD = node("d", node("properties", null));
  const tree = trace(null, root, [
    trace(pA, childCursor(root, "a", { b: "x" }), [
      trace(pB, childCursor(childCursor(root, "a", { b: "x" }), "b", "x")),
    ]),
    trace(pC, childCursor(root, "c", 1)),
    trace(pD, childCursor(root, "d", 2)),
  ]);
  const annotated = sets({ annotations: [{ pathNode: pB }, { pathNode: pC }] });

  it("keeps an application for a record below it and drops record-free ones, in order", () => {
    expect(paths(toRenderNode(tree, annotated))).toEqual([
      "",
      "/properties/a",
      "/properties/a/properties/b",
      "/properties/c",
      "/properties/d",
    ]);
    expect(paths(toRenderNode(tree, annotated, true))).toEqual([
      "",
      "/properties/a",
      "/properties/a/properties/b",
      "/properties/c",
    ]);
  });

  it("keeps the root alone when nothing carries a record", () => {
    const pruned = toRenderNode(tree, sets({}), true);
    expect(pruned.children).toEqual([]);
    expect(pruned.evaluationPath).toBe("");
    expect(pruned.valid).toBe(true);
  });

  it("counts a record in any of the four sets", () => {
    const pruned = toRenderNode(
      tree,
      sets({ droppedErrors: [{ pathNode: pD }] }),
      true,
    );
    expect(paths(pruned)).toEqual(["", "/properties/d"]);
    expect(pruned.children[0]!.droppedErrors).toEqual([0]);
  });

  it("renders the same relevant-level documents from the pruned tree", () => {
    const units = {
      errors: [],
      droppedErrors: [],
      annotations: [
        {
          evaluationPath: "/properties/a/properties/b/title",
          schemaLocation: `${REF.baseUri}#/properties/a/properties/b/title`,
          inputLocation: "/a/b",
          keyword: "title",
          annotation: "B",
        },
        {
          evaluationPath: "/properties/c/title",
          schemaLocation: `${REF.baseUri}#/properties/c/title`,
          inputLocation: "/c",
          keyword: "title",
          annotation: "C",
        },
      ],
      droppedAnnotations: [],
    };
    const full = { ...units, root: toRenderNode(tree, annotated) };
    const pruned = { ...units, root: toRenderNode(tree, annotated, true) };
    expect(renderHierarchical(pruned, "omit")).toEqual(
      renderHierarchical(full, "omit"),
    );
    expect(renderList(pruned, "omit")).toEqual(renderList(full, "omit"));
    expect(renderDetailed(pruned)).toEqual(renderDetailed(full));
  });
});

describe("the relevant level prunes only the document, never the trace", () => {
  const schema: JsonValue = {
    properties: { a: { properties: { b: { type: "string" } } }, d: true },
  };
  for (const output of ["list", "hierarchical", "detailed"] as const) {
    it(`${output} with trace: the trace holds every application`, () => {
      const engine = createEngine();
      const uri = engine.registerSchema(schema, "https://prune.example/gate");
      const result = engine.evaluate(
        uri,
        { a: { b: "x" }, d: 1 },
        { output, trace: true },
      );
      expect(result.valid).toBe(true);
      expect(result.trace.children.map((c) => c.segments)).toEqual([
        ["properties", "a"],
        ["properties", "d"],
      ]);
      const document = result.outputDocument as unknown as Record<
        string,
        unknown
      >;
      // list: a `details` array with nothing in it; hierarchical: the root
      // unit alone; detailed: the root with no nested results.
      if (output === "list") expect(document.details).toEqual([]);
      else expect(document.details ?? document.annotations).toBeUndefined();
    });
  }
});

describe("stray applications render in evaluation order", () => {
  // A custom keyword may apply a subschema under a structural member (a
  // first segment that is no keyword of the node) or with no segment at all
  // (sharing the node's path). Such applications are strays of the draft-03
  // tree: they hang under the application in the order they ran, child by
  // child — not grouped by first segment, which would let the first child of
  // a group decide where the whole group lands.
  const VOCAB = "urn:jse:test:vocab:strays";
  const DIALECT = "urn:jse:test:dialect:strays";
  const behaviors: Record<string, KeywordBehavior> = {
    // Holds subschemas; evaluates to nothing.
    x: { id: `${VOCAB}#x`, structural: true, evaluate: () => true },
    // Applies `x/y` (always `true`): a record-free application.
    a: {
      id: `${VOCAB}#a`,
      evaluate: (_v, cursor, ctx) => ctx.apply(["x", "y"], cursor),
    },
    // Applies the whole schema again at `/p`, with no segment of its own.
    c: {
      id: `${VOCAB}#c`,
      evaluate: (_v, cursor, ctx) => {
        const value = cursor.value;
        if (typeof value !== "object" || value === null || Array.isArray(value))
          return true;
        return (
          !("p" in value) || ctx.apply([], childCursor(cursor, "p", value.p))
        );
      },
    },
    // Applies `x/z` (`type: string`), rejecting an object.
    d: {
      id: `${VOCAB}#d`,
      evaluate: (_v, cursor, ctx) => ctx.apply(["x", "z"], cursor),
    },
  };

  it("places a later stray group after an earlier one", () => {
    const engine = createEngine();
    engine.registerVocabulary(VOCAB, behaviors);
    engine.registerDialect(DIALECT, [
      "https://json-schema.org/draft/2020-12/vocab/core",
      "https://json-schema.org/draft/2020-12/vocab/validation",
      VOCAB,
    ]);
    const uri = engine.registerSchema(
      { x: { y: true, z: { type: "string" } }, a: true, c: true, d: true },
      "https://strays.example/schema",
      DIALECT,
    );
    const result = engine.evaluate(uri, { p: 1 }, { output: "detailed" });
    expect(result.valid).toBe(false);
    const document = result.outputDocument as {
      errors: { keywordLocation: string; instanceLocation: string }[];
    };
    // Children ran as: x/y at "" (record-free, condensed away), the whole
    // schema at /p, then x/z at "" — so the /p application's result comes
    // before the root's own x/z error.
    expect(
      document.errors.map((e) => [e.keywordLocation, e.instanceLocation]),
    ).toEqual([
      ["/x/z/type", "/p"],
      ["/x/z/type", ""],
    ]);
  });
});
