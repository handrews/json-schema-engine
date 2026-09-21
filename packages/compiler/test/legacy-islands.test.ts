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
  // it is dynamic-scope-sensitive by construction (core.ts), so this pin is
  // mostly about proving the legacy dialect actually reaches that
  // classification through the planner's per-keyword dialect.ordered walk,
  // not a special case in the planner itself. It also guards ADR 0004's
  // exclusion: `$recursiveRef` is deliberately NOT resolved statically.
  const SCHEMA = {
    $recursiveAnchor: true,
    type: "object",
    properties: { child: { $recursiveRef: "#" } },
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
  });

  it("compiled flag verdicts match the interpreter on a valid and invalid recursive instance", () => {
    const engine = createEngine({ defaultDialect: DIALECT_2019_09 });
    const uri = engine.registerSchema(
      SCHEMA,
      "https://legacy-islands.example/recursive-flag",
    );
    const flag = compileValidator(engine, uri);

    const good: JsonValue = { child: { child: {} } };
    const bad: JsonValue = { child: { child: "nope" } };
    expect(flag.validate(good)).toBe(engine.evaluate(uri, good).valid);
    expect(flag.validate(bad)).toBe(engine.evaluate(uri, bad).valid);
    expect(engine.evaluate(uri, good).valid).toBe(true);
    expect(engine.evaluate(uri, bad).valid).toBe(false);
  });

  it("compiled list error units deep-equal the interpreter's", () => {
    const engine = createEngine({ defaultDialect: DIALECT_2019_09 });
    const uri = engine.registerSchema(
      SCHEMA,
      "https://legacy-islands.example/recursive-list",
    );
    const list = compileList(engine, uri, { errorParams: true });

    const bad: JsonValue = { child: { child: "nope" } };
    const got = list.evaluateList(bad);
    const expected = engine.evaluate(uri, bad, {
      output: "list",
      errorParams: true,
    });
    expect(got.valid).toBe(expected.valid);
    expect(got.errors).toEqual(expected.errors);
  });
});
