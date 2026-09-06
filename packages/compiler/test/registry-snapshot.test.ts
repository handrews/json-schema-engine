// E1 regression (DESIGN.md deferred register): a compiled artifact binds to
// a snapshot of both registries, so registrations after compilation cannot
// change what its interpreted islands resolve — a reference unresolved at
// compile time stays unresolved for that artifact while a new artifact sees
// the target. The interpreter itself keeps reading the live registry.

import { describe, it, expect } from "vitest";
import {
  createEngine,
  UnresolvableRefError,
  type KeywordBehavior,
} from "@jse/core";
import { compileList, compileValidator } from "@jse/compiler";

const CORE = "https://json-schema.org/draft/2020-12/vocab/core";

describe("artifacts bind to a registry snapshot", () => {
  it("a reference unresolved at compile time stays unresolved for the artifact", () => {
    const engine = createEngine();
    const uri = engine.registerSchema(
      { properties: { p: { $ref: "https://snap.example/target" } } },
      "https://snap.example/root",
    );
    const flag = compileValidator(engine, uri);
    const list = compileList(engine, uri);
    // The unresolvable $ref makes its unit an interpreted island.
    expect(flag.plan.targets.length).toBeGreaterThan(0);
    expect(flag.validate({})).toBe(true);
    expect(() => flag.validate({ p: 1 })).toThrow(UnresolvableRefError);
    expect(() => list.evaluateList({ p: 1 })).toThrow(UnresolvableRefError);

    engine.registerSchema({ type: "string" }, "https://snap.example/target");
    expect(() => flag.validate({ p: 1 })).toThrow(UnresolvableRefError);
    expect(() => list.evaluateList({ p: 1 })).toThrow(UnresolvableRefError);
    // The interpreter, not an artifact, sees the live registry.
    expect(engine.evaluate(uri, { p: 1 }).valid).toBe(false);

    const flag2 = compileValidator(engine, uri);
    const list2 = compileList(engine, uri);
    expect(flag2.validate({ p: 1 })).toBe(false);
    expect(flag2.validate({ p: "s" })).toBe(true);
    expect(
      list2.evaluateList({ p: 1 }).errors.map((e) => e.evaluationPath),
    ).toEqual(["/properties/p/$ref/type"]);
    expect(() => flag.validate({ p: 1 })).toThrow(UnresolvableRefError);
  });

  it("keeps the resource it was compiled against when the source re-registers it", () => {
    const engine = createEngine();
    engine.registerSchema({ type: "string" }, "https://snap.example/t");
    // $dynamicRef keeps the reference an interpreted island, resolved at
    // evaluation time against the artifact's view.
    const uri = engine.registerSchema(
      { properties: { p: { $dynamicRef: "https://snap.example/t" } } },
      "https://snap.example/root2",
    );
    const flag = compileValidator(engine, uri);
    const list = compileList(engine, uri);
    expect(flag.plan.targets.length).toBeGreaterThan(0);
    expect(flag.validate({ p: "s" })).toBe(true);
    expect(flag.validate({ p: 1 })).toBe(false);

    engine.registerSchema({ type: "integer" }, "https://snap.example/t");
    expect(flag.validate({ p: "s" })).toBe(true);
    expect(flag.validate({ p: 1 })).toBe(false);
    expect(list.evaluateList({ p: 1 }).errors).toHaveLength(1);
    expect(engine.evaluate(uri, { p: 1 }).valid).toBe(true);
    const flag2 = compileValidator(engine, uri);
    expect(flag2.validate({ p: "s" })).toBe(false);
    expect(flag2.validate({ p: 1 })).toBe(true);
  });

  it("keeps the dialect it was compiled against when the source re-registers it", () => {
    const VOCAB = "urn:snap:vocab";
    const DIALECT = "urn:snap:dialect";
    const engine = createEngine();
    // No lower(): the keyword's unit is an interpreted island that looks up
    // its behavior through the artifact's dialect view.
    const even: KeywordBehavior = {
      id: `${VOCAB}#even`,
      evaluate: (_value, cursor) =>
        typeof cursor.value !== "number" || cursor.value % 2 === 0,
    };
    engine.registerVocabulary(VOCAB, { even });
    engine.registerDialect(DIALECT, [CORE, VOCAB]);
    const uri = engine.registerSchema(
      { even: true },
      "https://snap.example/d",
      DIALECT,
    );
    const flag = compileValidator(engine, uri);
    expect(flag.plan.targets.length).toBeGreaterThan(0);
    expect(flag.validate(2)).toBe(true);
    expect(flag.validate(3)).toBe(false);

    const odd: KeywordBehavior = {
      id: `${VOCAB}#even`,
      evaluate: (_value, cursor) =>
        typeof cursor.value !== "number" || cursor.value % 2 === 1,
    };
    engine.registerVocabulary(VOCAB, { even: odd });
    engine.registerDialect(DIALECT, [CORE, VOCAB]);
    expect(flag.validate(2)).toBe(true);
    expect(flag.validate(3)).toBe(false);
    expect(engine.evaluate(uri, 3).valid).toBe(true);
    expect(compileValidator(engine, uri).validate(3)).toBe(true);
  });
});
