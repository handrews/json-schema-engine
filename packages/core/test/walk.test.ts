// walkSchema (M8.6): the exported schema-position walk must descend exactly
// where keyword facts say subschemas live — tolerating malformed values —
// so consumers stop maintaining their own applicator tables.

import { describe, it, expect } from "vitest";
import {
  createEngine,
  walkSchema,
  DIALECT_2020_12,
  JsonValue,
  MaxDepthExceededError,
  SchemaWalkVisit,
} from "@json-schema-engine/core";

const dialect = createEngine().dialects.getDialect(DIALECT_2020_12);

function visits(schema: JsonValue): SchemaWalkVisit[] {
  const out: SchemaWalkVisit[] = [];
  walkSchema(schema, dialect, (v) => out.push(v));
  return out;
}

describe("walkSchema", () => {
  it("visits nested subschemas with pointers and applying keywords", () => {
    const got = visits({
      properties: { a: { items: { type: "string" } } },
      anyOf: [{ minimum: 1 }],
    });
    expect(got.map((v) => [v.pointer, v.keyword])).toEqual([
      ["", null],
      ["/properties/a", "properties"],
      ["/properties/a/items", "items"],
      ["/anyOf/0", "anyOf"],
    ]);
  });

  it("visits boolean subschemas and boolean roots", () => {
    const got = visits({ additionalProperties: false });
    expect(got.map((v) => [v.pointer, v.node])).toContainEqual([
      "/additionalProperties",
      false,
    ]);
    expect(visits(true)).toEqual([{ node: true, pointer: "", keyword: null }]);
  });

  it("skips malformed keyword values without aborting the walk", () => {
    const got = visits({
      anyOf: 42,
      properties: { ok: { type: "string" } },
    });
    expect(got.map((v) => v.pointer)).toEqual(["", "/properties/ok"]);
  });

  it("skips non-schema values in schema position", () => {
    // properties declares one position per entry; a null entry is skipped
    const got = visits({ properties: { bad: null, ok: {} } });
    expect(got.map((v) => v.pointer)).toEqual(["", "/properties/ok"]);
    expect(visits(7)).toEqual([]);
  });

  it("never descends unknown keywords' values", () => {
    const got = visits({
      "x-vendor": { properties: { hidden: { type: "string" } } },
    });
    expect(got.map((v) => v.pointer)).toEqual([""]);
  });

  it("escapes name segments in pointers", () => {
    const got = visits({ properties: { "a/b~c": {} } });
    expect(got[1]!.pointer).toBe("/properties/a~1b~0c");
  });

  it("covers sibling-driven positions (if/then) via the declaring keyword", () => {
    const got = visits({ if: { type: "string" }, then: { minLength: 1 } });
    const pointers = got.map((v) => v.pointer);
    expect(pointers).toContain("/if");
    expect(pointers).toContain("/then");
  });

  it("enforces the depth bound", () => {
    let deep: JsonValue = { type: "string" };
    for (let i = 0; i < 600; i++) deep = { items: deep };
    let count = 0;
    expect(() => {
      walkSchema(deep, dialect, () => {
        count++;
      });
    }).toThrow(MaxDepthExceededError);
    expect(count).toBeGreaterThan(0);
  });
});
