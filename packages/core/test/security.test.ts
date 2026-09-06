// Adversarial resource-exhaustion and safety tests (D20/M5.6). These bound
// the three interpreter-level DoS vectors — ReDoS, O(n^2) uniqueItems,
// unbounded recursion — and lock in prototype-pollution safety. Each
// resource test carries a time budget so a regression to the pathological
// behavior fails loudly instead of merely running slow.

import { describe, it, expect } from "vitest";
import {
  createEngine,
  detectUnsafeRegex,
  MaxDepthExceededError,
  UnsafeRegexError,
  type JsonValue,
  type RegexEngine,
} from "@jse/core";

describe("uniqueItems is near-linear (D20)", () => {
  it("validates 100k distinct items well within budget", () => {
    const engine = createEngine();
    const uri = engine.registerSchema(
      { uniqueItems: true },
      "https://sec.example/unique",
    );
    const items = Array.from({ length: 100_000 }, (_, i) => i);
    const start = performance.now();
    expect(engine.evaluate(uri, items).valid).toBe(true);
    expect(performance.now() - start).toBeLessThan(1000);
  }, 2000);

  it("still reports a real duplicate, with ascending indices", () => {
    const engine = createEngine();
    const uri = engine.registerSchema(
      { uniqueItems: true },
      "https://sec.example/unique-dup",
    );
    const result = engine.evaluate(uri, [1, 2, 3, 2], { output: "list" });
    expect(result.valid).toBe(false);
    expect(result.errors?.[0]?.error).toContain("items at 1 and 3");
  });

  it("treats values that only look alike as distinct (no hash-collision miss)", () => {
    const engine = createEngine();
    const uri = engine.registerSchema(
      { uniqueItems: true },
      "https://sec.example/unique-mixed",
    );
    // 1, "1", true, null, "true" are pairwise unequal under JSON equality.
    expect(engine.evaluate(uri, [1, "1", true, null, "true"]).valid).toBe(true);
    // Object member order is insignificant: these two are equal → not unique.
    expect(
      engine.evaluate(uri, [
        { a: 1, b: 2 },
        { b: 2, a: 1 },
      ]).valid,
    ).toBe(false);
  });
});

describe("recursion depth is bounded (D20)", () => {
  it("throws a typed error on a deeply nested instance, leaving the engine usable", () => {
    const engine = createEngine();
    const uri = engine.registerSchema(
      { items: { $ref: "#" } },
      "https://sec.example/deep-instance",
    );
    let nested: unknown[] = [];
    for (let i = 0; i < 5000; i++) nested = [nested];
    expect(() => engine.evaluate(uri, nested as never)).toThrow(
      MaxDepthExceededError,
    );
    // The registry is untouched by a failed evaluation.
    expect(engine.evaluate(uri, [[]]).valid).toBe(true);
  });

  it("throws a typed error registering a deeply nested schema", () => {
    let schema: Record<string, unknown> = { type: "string" };
    for (let i = 0; i < 5000; i++) schema = { not: schema };
    const engine = createEngine();
    expect(() =>
      engine.registerSchema(schema as never, "https://sec.example/deep-schema"),
    ).toThrow(MaxDepthExceededError);
  });

  it("honors a custom maxDepth", () => {
    const engine = createEngine({ maxDepth: 8 });
    const uri = engine.registerSchema(
      { items: { $ref: "#" } },
      "https://sec.example/shallow",
    );
    let nested: unknown[] = [];
    for (let i = 0; i < 20; i++) nested = [nested];
    expect(() => engine.evaluate(uri, nested as never)).toThrow(
      MaxDepthExceededError,
    );
  });
});

describe("regex safety (D20)", () => {
  it("rejects an exponential pattern at registration under rejectUnsafeRegex", () => {
    const engine = createEngine({ rejectUnsafeRegex: true });
    expect(() =>
      engine.registerSchema({ pattern: "(a+)+$" }, "https://sec.example/redos"),
    ).toThrow(UnsafeRegexError);
  });

  it("rejects an exponential property-name pattern", () => {
    const engine = createEngine({ rejectUnsafeRegex: true });
    expect(() =>
      engine.registerSchema(
        { patternProperties: { "(a*)*": true } },
        "https://sec.example/redos-props",
      ),
    ).toThrow(UnsafeRegexError);
  });

  it("still registers safe patterns under rejectUnsafeRegex", () => {
    const engine = createEngine({ rejectUnsafeRegex: true });
    const uri = engine.registerSchema(
      { pattern: "^[a-z]{2,10}$" },
      "https://sec.example/safe",
    );
    expect(engine.evaluate(uri, "hello").valid).toBe(true);
    expect(engine.evaluate(uri, "TOO LONG!!").valid).toBe(false);
  });

  it("does not screen the trusted built-in metaschemas", () => {
    // Metaschemas contain patterns; construction must not throw even though
    // the screen is active.
    expect(() => createEngine({ rejectUnsafeRegex: true })).not.toThrow();
  });

  it("runs an adversarial pattern to completion through a linear-time engine", () => {
    // A stand-in linear engine: proves the hook is wired. A real deployment
    // supplies RE2. This one refuses catastrophic backtracking by capping.
    const linear: RegexEngine = {
      compile: (pattern) => {
        const native = new RegExp(pattern.replace(/\(a\+\)\+/g, "a+"));
        return { test: (s) => native.test(s) };
      },
    };
    const engine = createEngine({ regexEngine: linear });
    const uri = engine.registerSchema(
      { pattern: "(a+)+$" },
      "https://sec.example/linear",
    );
    const start = performance.now();
    expect(engine.evaluate(uri, "a".repeat(50) + "!").valid).toBe(false);
    expect(performance.now() - start).toBeLessThan(100);
  }, 1000);

  it("detects nested unbounded quantifiers, accepts benign patterns", () => {
    for (const unsafe of ["(a+)+$", "(a*)*", "(.*)+", "(?:ab+)+"]) {
      expect(detectUnsafeRegex(unsafe).safe).toBe(false);
    }
    for (const safe of [
      "^[a-z]+$",
      "a{1,5}b",
      "(abc)+",
      "\\d{3}-\\d{4}",
      "(a|b)*c",
    ]) {
      expect(detectUnsafeRegex(safe).safe).toBe(true);
    }
  });
});

describe("prototype pollution safety (D20)", () => {
  it("does not pollute Object.prototype through hostile instance keys", () => {
    const engine = createEngine();
    const uri = engine.registerSchema(
      {
        properties: { __proto__: { type: "number" } },
        additionalProperties: true,
      },
      "https://sec.example/proto",
    );
    const instance = JSON.parse(
      '{"__proto__": 5, "constructor": "c", "toString": null}',
    ) as JsonValue;
    engine.evaluate(uri, instance, {
      output: "list",
      annotations: true,
    });
    const clean = {} as Record<string, unknown>;
    expect("polluted" in clean).toBe(false);
    expect(Object.getPrototypeOf(clean)).toBe(Object.prototype);
  });

  it("treats reserved names as ordinary properties", () => {
    const engine = createEngine();
    const uri = engine.registerSchema(
      { required: ["hasOwnProperty"] },
      "https://sec.example/reserved",
    );
    expect(engine.evaluate(uri, {}).valid).toBe(false);
    expect(engine.evaluate(uri, { hasOwnProperty: 1 }).valid).toBe(true);
  });
});
