// Compiled-consumer runtime coverage tracking (COMPILED-CONSUMERS.md phase B):
// FLAG-mode plans compile dynamic-coverage unevaluated* consumers with a
// runtime evaluated-set channel instead of trampolining the whole subtree;
// LIST-mode plans track EVERY consumer (stage 3), because static licensing is
// list-unsound. The five compiled suite legs and the fuzz legs are the broad
// correctness gates; this file pins the SHAPES those gates under-exercise
// directly — the classification (root static+tracking, its in-place closure a
// region), the two channel paths (region variants; the nested-island fragCov
// harvest), and the M6.6 failing-contributor list shapes — so a regression in
// any is a loud, small failure rather than a census drift.

import { describe, it, expect } from "vitest";
import { createEngine, type JsonValue } from "@json-schema-engine/core";
import {
  buildPlan,
  compileList,
  compileValidator,
} from "@json-schema-engine/compiler";

/** Every verdict of the compiled artifact must match the interpreter. */
function expectVerdictParity(
  schema: JsonValue,
  uriTag: string,
  instances: JsonValue[],
): { source: string } {
  const engine = createEngine();
  const uri = engine.registerSchema(
    schema,
    `https://tracking.example/${uriTag}`,
  );
  const artifact = compileValidator(engine, uri);
  for (const instance of instances) {
    expect(artifact.validate(instance), JSON.stringify(instance)).toBe(
      engine.evaluate(uri, instance).valid,
    );
  }
  return { source: artifact.source };
}

describe("runtime coverage tracking (phase B)", () => {
  // A discriminated union whose evaluated names differ per branch: coverage is
  // dynamic (anyOf is conditional), so static licensing fails and the root is
  // tracked. Its anyOf branches become region members feeding the channel.
  const discriminatedUnion: JsonValue = {
    type: "object",
    properties: { kind: { enum: ["k1", "k2"] } },
    required: ["kind"],
    anyOf: [
      {
        properties: { kind: { const: "k1" }, a: { type: "string" } },
        required: ["a"],
      },
      {
        properties: { kind: { const: "k2" }, d: { type: "string" } },
        required: ["d"],
      },
    ],
    unevaluatedProperties: false,
  };

  it("classifies the discriminated-union root static + tracking with a region", () => {
    const engine = createEngine();
    const uri = engine.registerSchema(
      discriminatedUnion,
      "https://tracking.example/union-plan",
    );
    const plan = buildPlan(engine, uri);
    const root = plan.units.get(plan.rootKey)!;
    expect(root.kind).toBe("static");
    expect(root.tracking).toBe(true);
    // The two anyOf branches thread the channel (region members); nothing is
    // demoted to the interpreter (no dynamic island here).
    const region = [...plan.units.values()].filter((u) => u.inRegion);
    expect(region.length).toBe(2);
    expect(plan.targets.length).toBe(0);
  });

  it("matches the interpreter on discriminated-union instances", () => {
    expectVerdictParity(discriminatedUnion, "union", [
      { kind: "k1", a: "x" }, // valid k1
      { kind: "k2", d: "y" }, // valid k2
      { kind: "k1", a: "x", extra: 1 }, // invalid: 'extra' unevaluated
      { kind: "k1", d: "y" }, // invalid: k1 requires 'a'
      { kind: "k2", a: "z", d: "y" }, // 'a' unevaluated by the matched k2 branch
      { kind: "k3", a: "x" }, // invalid: kind out of enum
      5, // non-object: unevaluatedProperties is vacuous
    ]);
  });

  // A dynamic-coverage consumer reached IN-PLACE inside another tracked
  // consumer's closure cannot thread a nested channel (v1): it islands, and the
  // parent folds its harvested root coverage through fragCov.
  const nestedInPlaceConsumer: JsonValue = {
    anyOf: [{ properties: { p: { type: "string" } } }],
    allOf: [
      {
        anyOf: [{ properties: { b: { type: "string" } } }],
        unevaluatedProperties: false,
      },
    ],
    unevaluatedProperties: false,
  };

  it("islands a nested in-place tracked consumer and harvests its coverage", () => {
    const engine = createEngine();
    const uri = engine.registerSchema(
      nestedInPlaceConsumer,
      "https://tracking.example/nested-plan",
    );
    const plan = buildPlan(engine, uri);
    const root = plan.units.get(plan.rootKey)!;
    expect(root.tracking).toBe(true);
    const islands = [...plan.units.values()].filter(
      (u) => u.kind === "interpreted",
    );
    expect(islands.length).toBe(1);
    expect(islands[0]!.cause).toBe("unlowerable");
    const artifact = compileValidator(engine, uri);
    // The in-place island is trampolined through the coverage-harvesting frag.
    expect(artifact.source).toContain("h_fragc(");
  });

  it("matches the interpreter on nested-consumer instances", () => {
    expectVerdictParity(nestedInPlaceConsumer, "nested", [
      { p: "x", b: "y" }, // valid
      { p: "x", b: "y", extra: 1 }, // invalid: outer sees 'extra' unevaluated
      { b: "y", q: "z" }, // invalid: 'q' unevaluated by both scopes
      { p: 1, b: "y" }, // invalid: p not a string
      { p: "x", b: 1 }, // invalid: b not a string (inner island)
      {}, // valid: both anyOf branches vacuously match, nothing unevaluated
      5, // non-object
    ]);
  });

  // The dynamic-tuple idiom exercises the index channel (coveredPrefix folds)
  // and the countRange/contains matched-index push.
  it("matches the interpreter on a dynamic-tuple unevaluatedItems", () => {
    expectVerdictParity(
      {
        type: "array",
        if: { prefixItems: [{ const: "tagged" }] },
        then: { prefixItems: [true, { type: "number" }] },
        unevaluatedItems: { type: "boolean" },
      },
      "tuple",
      [
        ["tagged", 3], // valid: both prefix items covered
        ["tagged", 3, true], // valid: index 2 is a boolean
        ["tagged", 3, 5], // invalid: index 2 must be a boolean
        ["plain", true], // if-false: only index 0 covered, index 1 boolean ok
        ["plain", 5], // invalid: index 1 must be boolean
        "not-array", // non-array: vacuous
      ],
    );
  });

  it("matches the interpreter on contains-driven unevaluatedItems", () => {
    expectVerdictParity(
      {
        type: "array",
        prefixItems: [{ type: "string" }],
        contains: { type: "number", minimum: 10 },
        unevaluatedItems: { type: "boolean" },
      },
      "contains",
      [
        ["s", 12, true], // valid: index 0 prefix, 1 contains-matched, 2 boolean
        ["s", 12, "x"], // invalid: index 2 must be boolean (unmatched by contains)
        ["s", 5], // invalid: contains has no match (min 10)
        ["s", 12, 13, false], // multiple contains matches; index 3 boolean ok
      ],
    );
  });
});

// The M6.6 shapes: a consumer whose coverage contributor sits in a FAILING
// branch. Static coverage models the parent-success path only, so licensing
// these was list-unsound — the interpreter drops the failed branch's
// annotations and unevaluated* reports ADDITIONAL errors, verdict-invisible
// but list-visible. Runtime tracking reproduces that by construction (the
// failed application's channel span truncates, the sweep covers less); these
// pins hold list-mode compilation of consumers to the interpreter's exact
// error multiset AND order on exactly the cases static licensing got wrong.
describe("list-mode tracking: failing coverage contributors (M6.6 shapes)", () => {
  /** Compiled list output must equal the interpreter's, element by element. */
  function expectListParity(
    schema: JsonValue,
    uriTag: string,
    instances: JsonValue[],
  ): void {
    const engine = createEngine();
    const uri = engine.registerSchema(
      schema,
      `https://tracking.example/${uriTag}`,
    );
    const artifact = compileList(engine, uri, { errorParams: true });
    // The consumer must be COMPILED (tracked), or this proves nothing: an
    // interpreted fallback would pass trivially.
    const root = artifact.plan.units.get(artifact.plan.rootKey)!;
    expect(root.kind).toBe("static");
    expect(root.tracking).toBe(true);
    for (const instance of instances) {
      const expected = engine.evaluate(uri, instance, {
        output: "list",
        errorParams: true,
      });
      const got = artifact.evaluateList(instance);
      expect(
        { valid: got.valid, errors: got.valid ? [] : got.errors },
        JSON.stringify(instance),
      ).toEqual({ valid: expected.valid, errors: expected.errors ?? [] });
    }
  }

  it("unevaluatedItems sees a failed allOf branch's prefixItems as dropped", () => {
    expectListParity(
      {
        allOf: [{ prefixItems: [{ type: "string" }] }],
        unevaluatedItems: false,
      },
      "m66-items",
      [
        // prefixItems fails on item 0 → its annotation drops → unevaluatedItems
        // ALSO reports index 0 (two errors at the same instance location).
        [5],
        // branch passes → index 0 covered → unevaluatedItems reports only 1.
        ["ok", 5],
        [], // vacuous both ways
        ["ok"], // fully covered, valid
      ],
    );
  });

  it("unevaluatedProperties sees a failed anyOf branch's properties as dropped", () => {
    expectListParity(
      {
        anyOf: [
          { properties: { a: { type: "string" } }, required: ["a"] },
          { properties: { b: { type: "number" } }, required: ["b"] },
        ],
        unevaluatedProperties: false,
      },
      "m66-props",
      [
        // First branch fails (a not a string) while the second passes: 'a' is
        // dropped from coverage and unevaluatedProperties reports it too.
        { a: 5, b: 1 },
        // Both branches pass: both names covered, valid.
        { a: "ok", b: 1 },
        // Second branch fails: 'b' unevaluated, reported alongside its type error.
        { a: "ok", b: "no" },
        // Both branches fail: anyOf error AND both names swept as unevaluated.
        { a: 5, b: "no" },
      ],
    );
  });
});
