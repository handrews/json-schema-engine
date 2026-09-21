// evaluateFragment (M6.1): the compiled tier's trampoline into the
// interpreter. Pre-seeded dynamic scope, evaluation-path prefix, and depth
// budget; harvested records with cursor identity intact.

import { describe, it, expect } from "vitest";
import {
  createEngine,
  createFragmentRunner,
  evaluateFragment,
  materializePath,
  MaxDepthExceededError,
  rootCursor,
  type PathNode,
} from "@json-schema-engine/core";

describe("evaluateFragment (M6.1 trampoline)", () => {
  it("evaluates a subschema fragment and reports errors under the path prefix", () => {
    const engine = createEngine();
    const uri = engine.registerSchema(
      { $defs: { name: { type: "string", minLength: 2 } } },
      "https://frag.example/doc",
    );
    const target = engine.registry.resolveRef(`${uri}#/$defs/name`, uri);
    // The compiled caller's constant prefix: one synthetic pre-escaped node.
    const prefix: PathNode = { parent: null, segment: "properties/name/$ref" };

    const ok = evaluateFragment(engine.registry, target, rootCursor("ab"), {
      pathNode: prefix,
    });
    expect(ok.valid).toBe(true);
    expect(ok.errors).toHaveLength(0);

    const bad = evaluateFragment(engine.registry, target, rootCursor("a"), {
      pathNode: prefix,
    });
    expect(bad.valid).toBe(false);
    // Records carry the schema object's path; renderers append the keyword
    // segment (see AnnotationRecord/ErrorRecord in engine.ts).
    expect(materializePath(bad.errors[0]!.pathNode)).toBe(
      "/properties/name/$ref",
    );
    expect(bad.errors[0]!.keywordName).toBe("minLength");
  });

  it("harvests root-frame records with cursor identity intact", () => {
    const engine = createEngine();
    const uri = engine.registerSchema(
      { $defs: { obj: { properties: { a: true }, title: "T" } } },
      "https://frag.example/records",
    );
    const target = engine.registry.resolveRef(`${uri}#/$defs/obj`, uri);
    const cursor = rootCursor({ a: 1 });

    const result = evaluateFragment(engine.registry, target, cursor, {});
    expect(result.valid).toBe(true);
    const dependencies = new Map(
      result.dependencies.map((d) => [d.keywordName, d]),
    );
    const annotations = new Map(
      result.annotations.map((a) => [a.keywordName, a]),
    );
    expect(dependencies.get("properties")?.data).toEqual(["a"]);
    expect(annotations.get("title")?.value).toBe("T");
    // Cursor identity is the channel/harvest key for the compiled caller.
    expect(dependencies.get("properties")?.cursor).toBe(cursor);
  });

  it("honors the elision predicate a flag-mode artifact would pass", () => {
    const engine = createEngine();
    const uri = engine.registerSchema(
      { $defs: { obj: { title: "T" } } },
      "https://frag.example/elide",
    );
    const target = engine.registry.resolveRef(`${uri}#/$defs/obj`, uri);
    const result = evaluateFragment(engine.registry, target, rootCursor({}), {
      shouldRecord: () => false,
    });
    expect(result.valid).toBe(true);
    expect(result.annotations).toHaveLength(0);
  });

  it("resolves $dynamicRef through the passed-in dynamic scope (D8)", () => {
    const engine = createEngine();
    // A resource whose root mints the dynamic anchor "n" as a string check.
    const outer = engine.registerSchema(
      { $dynamicAnchor: "n", type: "string" },
      "https://frag.example/outer",
    );
    // The island's resource mints its own "n" fallback (boolean check) and
    // holds the $dynamicRef under $defs.
    const island = engine.registerSchema(
      {
        $dynamicAnchor: "n",
        type: "boolean",
        $defs: { use: { $dynamicRef: "#n" } },
      },
      "https://frag.example/island",
    );
    const target = engine.registry.resolveRef(`${island}#/$defs/use`, island);

    // No inherited scope: the island's own resource is outermost → boolean.
    const local = evaluateFragment(engine.registry, target, rootCursor(true));
    expect(local.valid).toBe(true);

    // A compiled caller that had entered `outer` passes its scope: the
    // outermost matching $dynamicAnchor now wins → string.
    const opts = { dynamicScope: [outer] };
    expect(
      evaluateFragment(engine.registry, target, rootCursor("x"), opts).valid,
    ).toBe(true);
    expect(
      evaluateFragment(engine.registry, target, rootCursor(true), opts).valid,
    ).toBe(false);
  });

  it("charges the caller's depth against the combined budget (D20)", () => {
    const engine = createEngine();
    const uri = engine.registerSchema(
      { $defs: { deep: { items: { $ref: "#/$defs/deep" } } } },
      "https://frag.example/depth",
    );
    const target = engine.registry.resolveRef(`${uri}#/$defs/deep`, uri);
    let nested: unknown[] = [];
    for (let i = 0; i < 20; i++) nested = [nested];

    // Plenty of room: fine.
    expect(
      evaluateFragment(engine.registry, target, rootCursor(nested as never), {
        maxDepth: 64,
      }).valid,
    ).toBe(true);
    // The same instance with most of the budget already consumed: typed error.
    expect(() =>
      evaluateFragment(engine.registry, target, rootCursor(nested as never), {
        maxDepth: 64,
        depth: 60,
      }),
    ).toThrow(MaxDepthExceededError);
  });
});

describe("evaluateFragment with tracing", () => {
  const engine = createEngine();
  const uri = engine.registerSchema(
    {
      $defs: {
        obj: { anyOf: [{ required: ["a"] }, { required: ["b"] }], title: "T" },
      },
    },
    "https://frag.example/traced",
  );
  const target = engine.registry.resolveRef(`${uri}#/$defs/obj`, uri);
  const prefix: PathNode = { parent: null, segment: "properties/o/$ref" };

  it("records the tree and the irrelevant records when asked to", () => {
    const r = evaluateFragment(engine.registry, target, rootCursor({ b: 1 }), {
      pathNode: prefix,
      tracing: true,
    });
    expect(r.valid).toBe(true);
    expect(r.traceRoot!.keywords).toEqual([
      { name: "anyOf", valid: true },
      { name: "title", valid: true },
    ]);
    // Every branch ran: the rejecting first branch is in the tree and its
    // error is retained as dropped (draft-03 §12.2).
    expect(r.traceRoot!.children.map((c) => c.valid)).toEqual([false, true]);
    expect(r.errors).toHaveLength(0);
    expect(r.droppedErrors.map((e) => e.keywordName)).toEqual(["required"]);
    expect(r.allAnnotations.map((a) => a.keywordName)).toEqual(["title"]);
    expect(materializePath(r.traceRoot!.children[0]!.pathNode)).toBe(
      "/properties/o/$ref/anyOf/0",
    );
  });

  it("builds nothing extra by default", () => {
    const r = evaluateFragment(engine.registry, target, rootCursor({ b: 1 }), {
      pathNode: prefix,
    });
    expect(r.traceRoot).toBeNull();
    expect(r.droppedErrors).toEqual([]);
    expect(r.allAnnotations).toEqual([]);
  });
});

describe("createFragmentRunner (flag-mode state reuse)", () => {
  it("gives independent verdicts across calls: nothing accumulates", () => {
    const engine = createEngine();
    const uri = engine.registerSchema(
      { $defs: { name: { type: "string", minLength: 2 } } },
      "https://frag.example/runner",
    );
    const target = engine.registry.resolveRef(`${uri}#/$defs/name`, uri);
    const runner = createFragmentRunner(engine.registry);
    expect(runner.valid(target, rootCursor("a"), undefined, 0)).toBe(false);
    expect(runner.valid(target, rootCursor("ab"), undefined, 0)).toBe(true);
    expect(runner.valid(target, rootCursor(1), undefined, 0)).toBe(false);
    expect(runner.valid(target, rootCursor("abc"), undefined, 0)).toBe(true);
  });

  it("resolves $dynamicRef through the passed-in scope, per call", () => {
    const engine = createEngine();
    const base = engine.registerSchema(
      {
        $defs: { item: { $dynamicAnchor: "item", type: "number" } },
        items: { $dynamicRef: "#item" },
      },
      "https://frag.example/runner-base",
    );
    const ext = engine.registerSchema(
      {
        $defs: { item: { $dynamicAnchor: "item", type: "string" } },
        $ref: base,
      },
      "https://frag.example/runner-ext",
    );
    const target = engine.registry.resolveRef(`${base}#/items`, base);
    const runner = createFragmentRunner(engine.registry);
    expect(runner.valid(target, rootCursor("x"), [ext, base], 0)).toBe(true);
    expect(runner.valid(target, rootCursor("x"), [base], 0)).toBe(false);
    expect(runner.valid(target, rootCursor(1), [ext, base], 0)).toBe(false);
    expect(runner.valid(target, rootCursor(1), [base], 0)).toBe(true);
  });

  it("is re-entrant: a keyword calling back in gets its own state", () => {
    const VOCAB = "urn:frag:vocab";
    const DIALECT = "urn:frag:dialect";
    const engine = createEngine();
    const box: {
      runner?: ReturnType<typeof createFragmentRunner>;
      inner?: ReturnType<typeof engine.registry.rootRef>;
    } = {};
    // `nested`: valid iff the runner says the `inner` member validates.
    engine.registerVocabulary(VOCAB, {
      nested: {
        id: `${VOCAB}#nested`,
        evaluate: (_value, cursor) => {
          const v = cursor.value;
          if (typeof v !== "object" || v === null || Array.isArray(v)) {
            return true;
          }
          return box.runner!.valid(
            box.inner!,
            rootCursor(v.inner ?? null),
            undefined,
            0,
          );
        },
      },
    });
    engine.registerDialect(DIALECT, [
      "https://json-schema.org/draft/2020-12/vocab/core",
      "https://json-schema.org/draft/2020-12/vocab/validation",
      VOCAB,
    ]);
    const uri = engine.registerSchema(
      { $defs: { inner: { type: "integer", minimum: 1 } }, nested: true },
      "https://frag.example/reenter",
      DIALECT,
    );
    box.inner = engine.registry.resolveRef("#/$defs/inner", uri);
    const runner = createFragmentRunner(engine.registry);
    box.runner = runner;
    const outer = engine.registry.rootRef(uri);
    expect(runner.valid(outer, rootCursor({ inner: 2 }), undefined, 0)).toBe(
      true,
    );
    expect(runner.valid(outer, rootCursor({ inner: 0 }), undefined, 0)).toBe(
      false,
    );
    expect(runner.valid(outer, rootCursor({ inner: "x" }), undefined, 0)).toBe(
      false,
    );
    expect(runner.valid(outer, rootCursor({ inner: 5 }), undefined, 0)).toBe(
      true,
    );
  });

  it("stays usable after a keyword throws", () => {
    const VOCAB = "urn:frag:boom";
    const DIALECT = "urn:frag:boom-dialect";
    const engine = createEngine();
    engine.registerVocabulary(VOCAB, {
      boom: {
        id: `${VOCAB}#boom`,
        evaluate: (_value, cursor) => {
          if (cursor.value === "boom") throw new Error("boom");
          return true;
        },
      },
    });
    engine.registerDialect(DIALECT, [
      "https://json-schema.org/draft/2020-12/vocab/core",
      "https://json-schema.org/draft/2020-12/vocab/validation",
      VOCAB,
    ]);
    const uri = engine.registerSchema(
      { boom: true, type: "string", minLength: 2 },
      "https://frag.example/boom",
      DIALECT,
    );
    const target = engine.registry.rootRef(uri);
    const runner = createFragmentRunner(engine.registry);
    expect(() =>
      runner.valid(target, rootCursor("boom"), undefined, 0),
    ).toThrow("boom");
    expect(runner.valid(target, rootCursor("ok"), undefined, 0)).toBe(true);
    expect(runner.valid(target, rootCursor("k"), undefined, 0)).toBe(false);
  });

  it("backs Engine.evaluate's flag output, re-entrantly", () => {
    const VOCAB = "urn:frag:engine";
    const DIALECT = "urn:frag:engine-dialect";
    const engine = createEngine();
    engine.registerVocabulary(VOCAB, {
      viaEngine: {
        id: `${VOCAB}#viaEngine`,
        evaluate: (value, cursor) =>
          typeof value === "string"
            ? engine.evaluate(value, cursor.value).valid
            : true,
      },
    });
    engine.registerDialect(DIALECT, [
      "https://json-schema.org/draft/2020-12/vocab/core",
      "https://json-schema.org/draft/2020-12/vocab/validation",
      VOCAB,
    ]);
    const leaf = engine.registerSchema(
      { type: "integer" },
      "https://frag.example/engine-leaf",
    );
    const uri = engine.registerSchema(
      { viaEngine: leaf, minimum: 1 },
      "https://frag.example/engine-root",
      DIALECT,
    );
    expect(engine.evaluate(uri, 3).valid).toBe(true);
    expect(engine.evaluate(uri, 0).valid).toBe(false);
    expect(engine.evaluate(uri, 1.5).valid).toBe(false);
    expect(engine.evaluate(uri, 2).valid).toBe(true);
    expect(engine.evaluate(uri, 0, { output: "list" }).errors).toHaveLength(1);
  });
});
