// Mixed registry (M10 gate): draft-04 and 2020-12 resources cross-reference
// in ONE engine — the downstream OpenAPI-tooling shape, where an OAS 3.0-era schema (draft-04
// based) and modern schemas must coexist. Each resource keeps its own
// dialect's semantics across the $ref boundary in both directions.

import { describe, it, expect } from "vitest";
import { createEngine, DIALECT_2020_12 } from "@jse/core";
import { registerDraft04, DIALECT_DRAFT_04 } from "@jse/dialect-draft04";

const DRAFT04_URI = "https://mixed.example/legacy";
const MODERN_URI = "https://mixed.example/modern";

function mixedEngine() {
  const engine = createEngine();
  registerDraft04(engine);
  engine.registerSchema(
    {
      id: DRAFT04_URI,
      definitions: {
        tuple: { items: [{ type: "string" }], additionalItems: false },
        bounded: { minimum: 5, exclusiveMinimum: true },
      },
      properties: {
        tuple: { $ref: "#/definitions/tuple" },
        bounded: { $ref: "#/definitions/bounded" },
        modern: { $ref: MODERN_URI },
      },
    },
    DRAFT04_URI,
    DIALECT_DRAFT_04,
  );
  engine.registerSchema(
    {
      $id: MODERN_URI,
      prefixItems: [{ type: "string" }],
      items: false,
      $defs: {
        back: { $ref: `${DRAFT04_URI}#/definitions/bounded` },
      },
    },
    MODERN_URI,
  );
  return engine;
}

describe("mixed registry: draft-04 and 2020-12 in one engine", () => {
  it("draft-04 semantics apply inside the draft-04 resource", () => {
    const engine = mixedEngine();
    // Tuple items + additionalItems: draft-04 forms, not 2020-12's.
    expect(engine.evaluate(DRAFT04_URI, { tuple: ["a"] }).valid).toBe(true);
    expect(engine.evaluate(DRAFT04_URI, { tuple: ["a", "b"] }).valid).toBe(
      false,
    );
    // Boolean exclusiveMinimum modifies the sibling minimum.
    expect(engine.evaluate(DRAFT04_URI, { bounded: 5 }).valid).toBe(false);
    expect(engine.evaluate(DRAFT04_URI, { bounded: 6 }).valid).toBe(true);
  });

  it("a draft-04 $ref into a 2020-12 resource applies 2020-12 semantics", () => {
    const engine = mixedEngine();
    // prefixItems/items:false — keywords draft-04 does not even know.
    expect(engine.evaluate(DRAFT04_URI, { modern: ["a"] }).valid).toBe(true);
    expect(engine.evaluate(DRAFT04_URI, { modern: ["a", "b"] }).valid).toBe(
      false,
    );
  });

  it("a 2020-12 $ref into a draft-04 resource applies draft-04 semantics", () => {
    const engine = mixedEngine();
    const probe = engine.registerSchema(
      {
        $id: "https://mixed.example/probe",
        $ref: `${MODERN_URI}#/$defs/back`,
      },
      "https://mixed.example/probe",
      DIALECT_2020_12,
    );
    expect(engine.evaluate(probe, 5).valid).toBe(false);
    expect(engine.evaluate(probe, 6).valid).toBe(true);
  });

  it("$schema drives dialect selection without an explicit dialect argument", () => {
    const engine = createEngine();
    registerDraft04(engine);
    const uri = engine.registerSchema(
      {
        $schema: "http://json-schema.org/draft-04/schema#",
        id: "https://mixed.example/by-schema",
        minimum: 2,
        exclusiveMinimum: true,
      },
      "https://mixed.example/by-schema",
    );
    expect(engine.evaluate(uri, 2).valid).toBe(false);
    expect(engine.evaluate(uri, 3).valid).toBe(true);
  });
});
