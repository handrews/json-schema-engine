// M6.6: draft-07/06 legacy-dialect compiled lowering. The planner previously
// routed every non-2020-12 unit to the interpreter unconditionally (no
// lower() on the dialect-specific keywords); now that vocab7.ts/vocab2019.ts
// carry lower(), a draft-07/06 `$ref`-with-siblings unit is reachable for
// the first time — this file targets the refIgnoresSiblings planner fix
// (engine.ts:397 parity) that landed alongside those lowerings.

import { describe, it, expect } from "vitest";
import {
  createEngine,
  DIALECT_DRAFT_07,
  type JsonValue,
} from "@json-schema-engine/core";
import { compileValidator, compileList } from "@json-schema-engine/compiler";

describe("draft-07 refIgnoresSiblings (M6.6 planner fix)", () => {
  it("compiled and interpreter both ignore a $ref's sibling constraints", () => {
    const schema = {
      definitions: { foo: { type: "object" } },
      $ref: "#/definitions/foo",
      // Would reject {} on its own (D18: refIgnoresSiblings) — must be
      // ignored entirely because $ref is present on the same object.
      required: ["missing"],
    };
    const engine = createEngine({ defaultDialect: DIALECT_DRAFT_07 });
    const uri = engine.registerSchema(
      schema,
      "https://legacy.example/refignoressiblings",
    );
    const instance: JsonValue = {};
    expect(engine.evaluate(uri, instance).valid).toBe(true);
    const compiled = compileValidator(engine, uri);
    expect(compiled.validate(instance)).toBe(true);

    // Sanity check the fixture isn't vacuously valid for some other reason:
    // the same sibling, without a $ref present, really does fail.
    const control = createEngine({ defaultDialect: DIALECT_DRAFT_07 });
    const controlUri = control.registerSchema(
      { type: "object", required: ["missing"] },
      "https://legacy.example/refignoressiblings-control",
    );
    expect(control.evaluate(controlUri, instance).valid).toBe(false);
  });

  it("plans only the $ref edge when siblings are present (siblings act as absent)", () => {
    const engine = createEngine({ defaultDialect: DIALECT_DRAFT_07 });
    const uri = engine.registerSchema(
      {
        definitions: { foo: { type: "object" } },
        $ref: "#/definitions/foo",
        required: ["missing"],
        minProperties: 3,
      },
      "https://legacy.example/refignoressiblings-plan",
    );
    const { plan } = compileValidator(engine, uri);
    const root = plan.units.get(plan.rootKey)!;
    expect(root.edges.map((e) => e.keyword)).toEqual(["$ref"]);
  });

  it("plans every keyword (no $ref) once the sibling-suppression case doesn't apply", () => {
    const engine = createEngine({ defaultDialect: DIALECT_DRAFT_07 });
    const uri = engine.registerSchema(
      { type: "object", required: ["a"], minProperties: 1 },
      "https://legacy.example/refignoressiblings-noref",
    );
    const { plan } = compileValidator(engine, uri);
    const root = plan.units.get(plan.rootKey)!;
    // No $ref present: nothing is suppressed (all three keywords are
    // assertion-only here, so no edges — but the unit must still classify
    // static, proving the dialect gate itself, not just the $ref path).
    expect(root.kind).toBe("static");
  });

  it("compiled list mode matches the interpreter for a $ref+siblings unit", () => {
    const engine = createEngine({ defaultDialect: DIALECT_DRAFT_07 });
    const uri = engine.registerSchema(
      {
        definitions: { foo: { type: "string" } },
        $ref: "#/definitions/foo",
        // Irrelevant to a string in any case, but must not evaluate at all.
        minItems: 5,
      },
      "https://legacy.example/refignoressiblings-list",
    );
    const artifact = compileList(engine, uri, { errorParams: true });
    for (const instance of ["ok", 5, null] as JsonValue[]) {
      const expected = engine.evaluate(uri, instance, {
        output: "list",
        errorParams: true,
      });
      const got = artifact.evaluateList(instance);
      expect(got).toEqual({
        valid: expected.valid,
        errors: expected.errors ?? [],
      });
    }
  });
});
