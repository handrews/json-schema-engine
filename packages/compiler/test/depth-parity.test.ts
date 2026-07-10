// Trampoline depth-budget parity (D20): the same MaxDepthExceededError
// class, at the same shared maxDepth, from all three evaluation surfaces —
// interpreter, compiled flag, compiled list. A fully static recursive chain
// exercises the compiled tier's own depth counter; a $dynamicRef island
// exercises the frag/fragList trampoline back into the interpreter's depth
// counter. Both must agree with Engine.evaluate, and neither may silently
// swallow the bound.

import { describe, it, expect } from "vitest";
import { createEngine, MaxDepthExceededError, type JsonValue } from "@jse/core";
import { buildPlan, compileList, compileValidator } from "@jse/compiler";

describe("static recursive chain: shared depth budget", () => {
  const SCHEMA = {
    properties: {
      next: { $ref: "#" },
      leaf: { type: "string" },
    },
  };

  it("plans entirely static (a trampoline regression here would silently defeat this pin)", () => {
    const engine = createEngine({ maxDepth: 64 });
    const uri = engine.registerSchema(SCHEMA, "https://depth.example/chain");
    const plan = buildPlan(engine, uri);
    for (const unit of plan.units.values()) {
      expect(unit.kind).toBe("static");
    }
    expect(plan.targets).toHaveLength(0);
  });

  it("a ~200-deep instance exceeds a 64-deep budget on every surface", () => {
    const engine = createEngine({ maxDepth: 64 });
    const uri = engine.registerSchema(
      SCHEMA,
      "https://depth.example/chain-deep",
    );
    let deep: JsonValue = { leaf: "x" };
    for (let i = 0; i < 200; i++) deep = { next: deep };

    expect(() => engine.evaluate(uri, deep)).toThrow(MaxDepthExceededError);

    const flag = compileValidator(engine, uri, { maxDepth: 64 });
    expect(() => flag.validate(deep)).toThrow(MaxDepthExceededError);

    const list = compileList(engine, uri, { maxDepth: 64 });
    expect(() => list.evaluateList(deep)).toThrow(MaxDepthExceededError);
  });

  it("a shallow instance agrees valid across all three surfaces", () => {
    const engine = createEngine({ maxDepth: 64 });
    const uri = engine.registerSchema(
      SCHEMA,
      "https://depth.example/chain-shallow",
    );
    const shallow: JsonValue = { next: { next: { leaf: "y" } } };

    expect(engine.evaluate(uri, shallow).valid).toBe(true);

    const flag = compileValidator(engine, uri, { maxDepth: 64 });
    expect(flag.validate(shallow)).toBe(true);

    const list = compileList(engine, uri, { maxDepth: 64 });
    expect(list.evaluateList(shallow).valid).toBe(true);
  });
});

describe("$dynamicRef island: shared depth budget through the frag trampoline", () => {
  // Same island shape as list-output.test.ts's dynamic-scope tests: a
  // $dynamicAnchor root whose own property re-enters through $dynamicRef,
  // so nested instances recurse through the interpreter's evaluateFragment
  // depth counter (runtime.ts's frag/fragList), not the compiled tier's own.
  const SCHEMA = {
    $id: "https://depth.example/island",
    $dynamicAnchor: "n",
    type: "object",
    properties: { child: { $dynamicRef: "#n" } },
  };

  it("plans a non-empty island (a $dynamicRef unit is always interpreted)", () => {
    const engine = createEngine({ maxDepth: 20 });
    const uri = engine.registerSchema(
      SCHEMA,
      "https://depth.example/island-plan",
    );
    const plan = buildPlan(engine, uri);
    expect(plan.targets.length).toBeGreaterThan(0);
    const child = plan.targets.find((t) => t.cause === "dynamic");
    expect(child).toBeDefined();
  });

  it("a small budget is exhausted through the fragment trampoline: flag surfaces", () => {
    const engine = createEngine({ maxDepth: 20 });
    const uri = engine.registerSchema(
      SCHEMA,
      "https://depth.example/island-flag",
    );
    let deep: JsonValue = {};
    for (let i = 0; i < 40; i++) deep = { child: deep };

    expect(() => engine.evaluate(uri, deep)).toThrow(MaxDepthExceededError);

    const flag = compileValidator(engine, uri, { maxDepth: 20 });
    expect(() => flag.validate(deep)).toThrow(MaxDepthExceededError);
  });

  it("a small budget is exhausted through the fragment trampoline: list surfaces", () => {
    const engine = createEngine({ maxDepth: 20 });
    const uri = engine.registerSchema(
      SCHEMA,
      "https://depth.example/island-list",
    );
    let deep: JsonValue = {};
    for (let i = 0; i < 40; i++) deep = { child: deep };

    expect(() => engine.evaluate(uri, deep, { output: "list" })).toThrow(
      MaxDepthExceededError,
    );

    const list = compileList(engine, uri, { maxDepth: 20 });
    expect(() => list.evaluateList(deep)).toThrow(MaxDepthExceededError);
  });
});
