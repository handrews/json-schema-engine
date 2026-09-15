// Error-params pins (D13/M8.1) for the keywords whose draft-04 behaviors
// are defined in this package: minimum/maximum keep the shared bounds
// {limit} shape whether or not the sibling boolean makes them exclusive
// (exclusivity is recoverable from the schema, never smuggled into params).
// Harvested keywords are pinned in core's error-params.test.ts.

import { describe, it, expect } from "vitest";
import {
  createEngine,
  type JsonValue,
  type ErrorUnit,
} from "@json-schema-engine/core";
import {
  registerDraft04,
  DIALECT_DRAFT_04,
} from "@json-schema-engine/dialect-draft04";

const failures = (
  schema: JsonValue,
  instance: JsonValue,
  uri: string,
): ErrorUnit[] => {
  const engine = createEngine({ defaultDialect: DIALECT_DRAFT_04 });
  registerDraft04(engine);
  const id = engine.registerSchema(schema, uri);
  const result = engine.evaluate(id, instance, {
    output: "list",
    errorParams: true,
  });
  expect(result.valid).toBe(false);
  return result.errors!;
};

describe("draft-04 errorParams pins", () => {
  it("minimum / maximum carry {limit} in both inclusive and exclusive forms", () => {
    const cases: [JsonValue, JsonValue, string, number][] = [
      [{ minimum: 3 }, 2, "minimum", 3],
      [{ minimum: 3, exclusiveMinimum: true }, 3, "minimum", 3],
      [{ maximum: 1 }, 2, "maximum", 1],
      [{ maximum: 1, exclusiveMaximum: true }, 1, "maximum", 1],
    ];
    for (const [i, [schema, instance, keyword, limit]] of cases.entries()) {
      const units = failures(
        schema,
        instance,
        `https://p4.example/${keyword}-${i}`,
      );
      expect(units, keyword).toHaveLength(1);
      expect(units[0]!.keyword, keyword).toBe(keyword);
      expect(units[0]!.params, keyword).toEqual({ limit });
    }
  });

  it("harvested required / dependencies keep their core params shapes", () => {
    const [r] = failures(
      { required: ["a"] },
      {},
      "https://p4.example/required",
    );
    expect(r!.params).toEqual({ missingProperty: "a" });
    const [d] = failures(
      { dependencies: { a: ["b"] } },
      { a: 1 },
      "https://p4.example/dependencies",
    );
    expect(d!.params).toEqual({ property: "a", missingProperty: "b" });
  });
});
