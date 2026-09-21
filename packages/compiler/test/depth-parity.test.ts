// Trampoline depth-budget parity (D20): the same MaxDepthExceededError
// class, at the same shared maxDepth, from all three in-process evaluation
// surfaces — interpreter, compiled flag, compiled list. A fully static
// recursive chain exercises the compiled tier's own depth counter; a
// $dynamicRef island exercises the frag/fragList trampoline back into the
// interpreter's depth counter. Both must agree with Engine.evaluate, and
// neither may silently swallow the bound.
//
// Standalone modules are the fourth surface and reach only structural
// parity: a zero-import module cannot share core's class object, so the
// last describe pins what is actually available there.

import { describe, it, expect } from "vitest";
import { DYNAMIC_SEEDS } from "@json-schema-engine/test-kit";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  DEFAULT_MAX_DEPTH,
  createEngine,
  MaxDepthExceededError,
  type JsonValue,
} from "@json-schema-engine/core";
import {
  buildPlan,
  compileEvaluator,
  compileList,
  compileValidator,
  emitStandalone,
} from "@json-schema-engine/compiler";

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

    const evaluator = compileEvaluator(engine, uri, { maxDepth: 64 });
    expect(() =>
      evaluator.evaluate(deep, { output: "hierarchical", trace: true }),
    ).toThrow(MaxDepthExceededError);
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

    const evaluator = compileEvaluator(engine, uri, { maxDepth: 64 });
    expect(
      evaluator.evaluate(shallow, { output: "hierarchical", trace: true }),
    ).toEqual(
      engine.evaluate(uri, shallow, { output: "hierarchical", trace: true }),
    );
  });
});

describe("$dynamicRef resolved statically: the compiled tier's own depth budget", () => {
  // A root-anchored $dynamicRef resolves at plan time (ADR 0004), so the
  // recursion below runs entirely on compiled units and their `d` counter —
  // no trampoline is involved, and the bound must still be the interpreter's.
  const SCHEMA = DYNAMIC_SEEDS.stableSingle.schema;

  it("plans no island and exhausts a small budget at the same bound", () => {
    const engine = createEngine({ maxDepth: 20 });
    const uri = engine.registerSchema(SCHEMA, "https://depth.example/static");
    const plan = buildPlan(engine, uri);
    expect(plan.targets).toHaveLength(0);
    let deep: JsonValue = {};
    for (let i = 0; i < 40; i++) deep = { child: deep };
    expect(() => engine.evaluate(uri, deep)).toThrow(MaxDepthExceededError);
    expect(() =>
      compileValidator(engine, uri, { maxDepth: 20 }).validate(deep),
    ).toThrow(MaxDepthExceededError);
    expect(() =>
      compileList(engine, uri, { maxDepth: 20 }).evaluateList(deep),
    ).toThrow(MaxDepthExceededError);
    let shallow: JsonValue = {};
    for (let i = 0; i < 10; i++) shallow = { child: shallow };
    expect(
      compileValidator(engine, uri, { maxDepth: 20 }).validate(shallow),
    ).toBe(true);
  });
});

describe("$dynamicRef island: shared depth budget through the frag trampoline", () => {
  // An UNSTABLE site (two declaring resources around a shared recursive one)
  // still islands, so nested instances recurse through the interpreter's
  // evaluateFragment depth counter (runtime.ts's frag/fragList), not the
  // compiled tier's own.
  const SCHEMA = DYNAMIC_SEEDS.unstableRecursive.schema;

  it("plans a non-empty island (an unstable $dynamicRef site is interpreted)", () => {
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

    const evaluator = compileEvaluator(engine, uri, { maxDepth: 20 });
    expect(() =>
      evaluator.evaluate(deep, { output: "hierarchical", trace: true }),
    ).toThrow(MaxDepthExceededError);
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

    const evaluator = compileEvaluator(engine, uri, { maxDepth: 20 });
    expect(() =>
      evaluator.evaluate(deep, { output: "hierarchical", trace: true }),
    ).toThrow(MaxDepthExceededError);
  });
});

describe("standalone modules: structural depth parity", () => {
  // The other three surfaces import core's MaxDepthExceededError, so
  // `toThrow(MaxDepthExceededError)` pins them nominally. A standalone
  // module has no imports at all — that is the format's purpose — so its
  // error is a distinct class object and instanceof against core's is false
  // by construction. What must hold is everything else: the same
  // constructor name, the same message, and the same bound.
  const SCHEMA = {
    properties: { next: { $ref: "#" } },
  };

  const emitAndLoad = async (
    source: string,
  ): Promise<(v: unknown) => boolean> => {
    const dir = mkdtempSync(join(tmpdir(), "jse-depth-standalone-"));
    const file = join(dir, "artifact.mjs");
    writeFileSync(file, source);
    try {
      const mod = (await import(/* @vite-ignore */ file)) as {
        default: (v: unknown) => boolean;
      };
      return mod.default;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  it("throws a MaxDepthExceededError-shaped error, not a RangeError", async () => {
    const engine = createEngine({ maxDepth: 64 });
    const uri = engine.registerSchema(
      SCHEMA,
      "https://depth.example/standalone-deep",
    );
    let deep: JsonValue = {};
    for (let i = 0; i < 200; i++) deep = { next: deep };

    const validate = await emitAndLoad(
      emitStandalone(engine, uri, { maxDepth: 64 }),
    );

    let thrown: unknown;
    try {
      validate(deep);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(Error);
    // Core converts a native stack RangeError INTO the typed error, so a
    // RangeError here would make the bound indistinguishable from a crash.
    expect(thrown).not.toBeInstanceOf(RangeError);
    expect((thrown as Error).constructor.name).toBe("MaxDepthExceededError");

    // The message matches what a runtime-compiled artifact reports.
    let runtimeThrown: unknown;
    try {
      compileValidator(engine, uri, { maxDepth: 64 }).validate(deep);
    } catch (err) {
      runtimeThrown = err;
    }
    expect((thrown as Error).message).toBe((runtimeThrown as Error).message);
    expect(runtimeThrown).toBeInstanceOf(MaxDepthExceededError);
  });

  it("bakes in core's DEFAULT_MAX_DEPTH when no bound is given", () => {
    const engine = createEngine();
    const uri = engine.registerSchema(
      SCHEMA,
      "https://depth.example/standalone-default",
    );
    // Pins the shared constant rather than a literal: a change to core's
    // default must reach emitted modules, not drift away from them.
    expect(emitStandalone(engine, uri)).toContain(
      `const h_maxd = ${String(DEFAULT_MAX_DEPTH)};`,
    );
  });

  it("a shallow instance still agrees with the interpreter", async () => {
    const engine = createEngine({ maxDepth: 64 });
    const uri = engine.registerSchema(
      SCHEMA,
      "https://depth.example/standalone-shallow",
    );
    const shallow: JsonValue = { next: { next: {} } };
    const validate = await emitAndLoad(
      emitStandalone(engine, uri, { maxDepth: 64 }),
    );
    expect(validate(shallow)).toBe(engine.evaluate(uri, shallow).valid);
  });
});
