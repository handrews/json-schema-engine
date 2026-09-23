// Per-resource dialects in the compiled tier (ADR 0006): the planner keys
// every dialect lookup on the unit's own base URI, so a draft-07 resource
// embedded in a 2020-12 document compiles under draft-07 rules — array
// `items`, and a `$ref` whose siblings are absent — and the artifact
// agrees with the interpreter.

import { describe, it, expect } from "vitest";
import {
  createEngine,
  DIALECT_DRAFT_07,
  type JsonValue,
} from "@json-schema-engine/core";
import { compileValidator } from "@json-schema-engine/compiler";

const O = "https://mixed.test/outer";
const L = "https://mixed.test/legacy";

describe("compiled artifacts honor per-resource dialects", () => {
  it("agrees with the interpreter across both dialects", () => {
    const engine = createEngine();
    const uri = engine.registerSchema(
      {
        $id: O,
        $defs: {
          str: { type: "string" },
          legacy: {
            $id: L,
            $schema: DIALECT_DRAFT_07,
            definitions: { t: { $id: "#tag", type: "string" } },
            properties: { p: { $ref: "#tag", minLength: 100 } },
            items: [{ type: "string" }, { type: "number" }],
          },
        },
        properties: {
          modern: { $ref: "#/$defs/str", minLength: 100 },
          old: { $ref: L },
        },
      },
      O,
    );
    const flag = compileValidator(engine, uri);
    const instances: JsonValue[] = [
      { modern: "short" },
      { modern: "x".repeat(100) },
      { old: ["a", 1] },
      { old: [1, "a"] },
      { old: { p: "short" } },
      { old: { p: 1 } },
    ];
    for (const instance of instances) {
      expect(flag.validate(instance)).toBe(
        engine.evaluate(uri, instance).valid,
      );
    }
    expect(flag.validate({ old: ["a", 1] })).toBe(true);
    expect(flag.validate({ old: [1, "a"] })).toBe(false);
    expect(flag.validate({ modern: "short" })).toBe(false);
    expect(flag.validate({ old: { p: "short" } })).toBe(true);
  });
});
