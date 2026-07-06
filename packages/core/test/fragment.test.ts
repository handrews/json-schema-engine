// evaluateFragment (M6.1): the compiled tier's trampoline into the
// interpreter. Pre-seeded dynamic scope, evaluation-path prefix, and depth
// budget; harvested productions with cursor identity intact.

import { describe, it, expect } from "vitest";
import {
  createEngine,
  evaluateFragment,
  materializePath,
  MaxDepthExceededError,
  rootCursor,
  type PathNode,
} from "@jse/core";

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
    // segment (see Production/ErrorRecord in engine.ts).
    expect(materializePath(bad.errors[0]!.pathNode)).toBe(
      "/properties/name/$ref",
    );
    expect(bad.errors[0]!.keywordName).toBe("minLength");
  });

  it("harvests root-frame productions with cursor identity intact", () => {
    const engine = createEngine();
    const uri = engine.registerSchema(
      { $defs: { obj: { properties: { a: true }, title: "T" } } },
      "https://frag.example/productions",
    );
    const target = engine.registry.resolveRef(`${uri}#/$defs/obj`, uri);
    const cursor = rootCursor({ a: 1 });

    const result = evaluateFragment(engine.registry, target, cursor, {});
    expect(result.valid).toBe(true);
    const byKeyword = new Map(
      result.productions.map((p) => [p.keywordName, p]),
    );
    expect(byKeyword.get("properties")?.value).toEqual(["a"]);
    expect(byKeyword.get("title")?.value).toBe("T");
    // Cursor identity is the channel/harvest key for the compiled caller.
    expect(byKeyword.get("properties")?.cursor).toBe(cursor);
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
    expect(result.productions).toHaveLength(0);
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
