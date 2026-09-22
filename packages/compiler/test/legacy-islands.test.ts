// Focused island pins for the legacy dialects (M6.6): one static-vs-
// interpreted classification per fallback cause the legacy planner actually
// reaches, plus flag/list parity on that classification. Not a corpus — the
// suite legs (suiteN(-compiled).test.ts) already cover breadth; these pin
// the plan SHAPE (cause) a regression could silently flip without any
// suite/differential gate noticing (see explain.ts's own rationale).

import { describe, it, expect } from "vitest";
import {
  createEngine,
  DIALECT_2019_09,
  DIALECT_DRAFT_06,
  DIALECT_DRAFT_07,
  type JsonValue,
} from "@json-schema-engine/core";
import {
  buildPlan,
  compileList,
  compileValidator,
  explainCompilation,
} from "@json-schema-engine/compiler";

describe.each([
  ["draft-07", DIALECT_DRAFT_07],
  ["draft-06", DIALECT_DRAFT_06],
])('%s: in-place $ref cycle (cause "cycle")', (_name, dialect) => {
  // definitions/a <-> definitions/b chase each other by $ref forever with no
  // base case, so the planner must fall back rather than compile a
  // recursive-but-terminating unit. The cycle sits behind `items`
  // (a descending edge, not in-place) so it only fires when an element is
  // actually evaluated — an empty array never touches it, giving a clean
  // pass/fail pair that doesn't collide with the interpreter's
  // same-cursor InfiniteLoopError (that error is a separate, already-
  // covered concern, not what this pin is about).
  const SCHEMA = {
    type: "array",
    items: { $ref: "#/definitions/a" },
    definitions: {
      a: { $ref: "#/definitions/b" },
      b: { $ref: "#/definitions/a" },
    },
  };

  it('plans an interpreted unit with cause "cycle"', () => {
    const engine = createEngine({ defaultDialect: dialect });
    const uri = engine.registerSchema(
      SCHEMA,
      "https://legacy-islands.example/cycle",
    );
    const plan = buildPlan(engine, uri);
    const summary = explainCompilation(plan);
    expect(summary.causes.cycle).toBe(1);
    const cyclic = plan.targets.find((t) => t.cause === "cycle");
    expect(cyclic).toBeDefined();
  });

  it("compiled flag verdicts match the interpreter", () => {
    const engine = createEngine({ defaultDialect: dialect });
    const uri = engine.registerSchema(
      SCHEMA,
      "https://legacy-islands.example/cycle-flag",
    );
    const flag = compileValidator(engine, uri);

    const passing: JsonValue = [];
    const failing: JsonValue = "nope";
    expect(flag.validate(passing)).toBe(engine.evaluate(uri, passing).valid);
    expect(flag.validate(failing)).toBe(engine.evaluate(uri, failing).valid);
    expect(engine.evaluate(uri, passing).valid).toBe(true);
    expect(engine.evaluate(uri, failing).valid).toBe(false);
  });

  it("compiled list error units deep-equal the interpreter's", () => {
    const engine = createEngine({ defaultDialect: dialect });
    const uri = engine.registerSchema(
      SCHEMA,
      "https://legacy-islands.example/cycle-list",
    );
    const list = compileList(engine, uri, { errorParams: true });

    const failing: JsonValue = "nope";
    const got = list.evaluateList(failing);
    const expected = engine.evaluate(uri, failing, {
      output: "list",
      errorParams: true,
    });
    expect(got.valid).toBe(expected.valid);
    expect(got.errors).toEqual(expected.errors);
  });
});

describe('2019-09: $recursiveRef island (cause "dynamic")', () => {
  // $recursiveRef is 2019-09's degenerate $dynamicRef: any unit that carries
  // it is dynamic-scope-sensitive by construction (core.ts), and the planner
  // resolves a site statically when every path yields the same target (ADR
  // 0004, amended for $recursiveRef). This pin is the unstable shape — the
  // suite's "multiple dynamic paths": the site inside `generic` is reached
  // under `numbers` and under `strings`, whose roots both declare the
  // anchor, so the trampoline stays covered for the legacy dialect.
  const SCHEMA = {
    $id: "https://legacy-islands.example/recursive",
    if: { properties: { kind: { const: "numbers" } }, required: ["kind"] },
    then: { $ref: "numbers" },
    else: { $ref: "strings" },
    $defs: {
      generic: {
        $id: "generic",
        $recursiveAnchor: true,
        type: "object",
        properties: {
          child: { $recursiveRef: "#" },
        },
      },
      numbers: {
        $id: "numbers",
        $recursiveAnchor: true,
        $ref: "generic",
        properties: { value: { type: "number" } },
      },
      strings: {
        $id: "strings",
        $recursiveAnchor: true,
        $ref: "generic",
        properties: { value: { type: "string" } },
      },
    },
  };

  it('plans an interpreted unit with cause "dynamic"', () => {
    const engine = createEngine({ defaultDialect: DIALECT_2019_09 });
    const uri = engine.registerSchema(
      SCHEMA,
      "https://legacy-islands.example/recursive-plan",
    );
    const plan = buildPlan(engine, uri);
    const summary = explainCompilation(plan);
    expect(summary.causes.dynamic).toBe(1);
    expect(summary.resolvedDynamicSites).toHaveLength(0);
  });

  it("the single-declarer shape resolves statically instead (ADR 0004)", () => {
    const engine = createEngine({ defaultDialect: DIALECT_2019_09 });
    const uri = engine.registerSchema(
      {
        $recursiveAnchor: true,
        type: "object",
        properties: { child: { $recursiveRef: "#" } },
      },
      "https://legacy-islands.example/recursive-static",
    );
    const summary = explainCompilation(buildPlan(engine, uri));
    expect(summary.interpretedUnits).toBe(0);
    expect(summary.resolvedDynamicSites).toEqual([
      {
        unit: `${uri}#/properties/child`,
        keyword: "$recursiveRef",
        ref: "#",
        target: `${uri}#`,
        winner: uri,
      },
    ]);
    const flag = compileValidator(engine, uri);
    expect(flag.validate({ child: { child: {} } })).toBe(true);
    expect(flag.validate({ child: { child: "nope" } })).toBe(false);
  });

  it("compiled flag verdicts match the interpreter on a valid and invalid recursive instance", () => {
    const engine = createEngine({ defaultDialect: DIALECT_2019_09 });
    const uri = engine.registerSchema(
      SCHEMA,
      "https://legacy-islands.example/recursive-flag",
    );
    const flag = compileValidator(engine, uri);

    const good: JsonValue = { kind: "numbers", child: { value: 1 } };
    const bad: JsonValue = { kind: "numbers", child: { value: "nope" } };
    expect(flag.validate(good)).toBe(engine.evaluate(uri, good).valid);
    expect(flag.validate(bad)).toBe(engine.evaluate(uri, bad).valid);
    expect(engine.evaluate(uri, good).valid).toBe(true);
    expect(engine.evaluate(uri, bad).valid).toBe(false);
    // Under `strings`, the same child rebinds the other way.
    expect(flag.validate({ child: { value: "ok" } })).toBe(true);
    expect(flag.validate({ child: { value: 1 } })).toBe(false);
  });

  it("compiled list error units deep-equal the interpreter's", () => {
    const engine = createEngine({ defaultDialect: DIALECT_2019_09 });
    const uri = engine.registerSchema(
      SCHEMA,
      "https://legacy-islands.example/recursive-list",
    );
    const list = compileList(engine, uri, { errorParams: true });

    const bad: JsonValue = { kind: "numbers", child: { value: "nope" } };
    const got = list.evaluateList(bad);
    const expected = engine.evaluate(uri, bad, {
      output: "list",
      errorParams: true,
    });
    expect(got.valid).toBe(expected.valid);
    expect(got.errors).toEqual(expected.errors);
  });
});
