// draft-04 base identifiers (ADR 0005): `id: "#name"` is an anchor, an
// empty `id` names no resource and is refused, and the metaschema
// registers under `validateSchemas` like the bundled ones do.

import { describe, it, expect } from "vitest";
import { createEngine, InvalidIdentifierError } from "@json-schema-engine/core";
import {
  registerDraft04,
  DIALECT_DRAFT_04,
} from "@json-schema-engine/dialect-draft04";

describe("draft-04 identifiers", () => {
  it("reads a plain-fragment id as an anchor", () => {
    const engine = createEngine();
    registerDraft04(engine);
    const uri = engine.registerSchema(
      {
        definitions: { a: { id: "#a", type: "string" } },
        properties: { p: { $ref: "#a" } },
      },
      "https://d4.example/anchor",
      DIALECT_DRAFT_04,
    );
    expect(engine.evaluate(uri, { p: "s" }).valid).toBe(true);
    expect(engine.evaluate(uri, { p: 1 }).valid).toBe(false);
  });

  it("refuses an empty id and registers nothing", () => {
    const engine = createEngine();
    registerDraft04(engine);
    expect(() =>
      engine.registerSchema(
        { definitions: { a: { id: "" } } },
        "https://d4.example/empty",
        DIALECT_DRAFT_04,
      ),
    ).toThrow(InvalidIdentifierError);
    expect(engine.registry.has("https://d4.example/empty")).toBe(false);
  });

  it("registers its metaschema on an engine that validates schemas", () => {
    const engine = createEngine({ validateSchemas: true });
    registerDraft04(engine);
    const uri = engine.registerSchema(
      { minimum: 5, exclusiveMinimum: true },
      "https://d4.example/validated",
      DIALECT_DRAFT_04,
    );
    expect(engine.evaluate(uri, 6).valid).toBe(true);
    expect(engine.evaluate(uri, 5).valid).toBe(false);
  });
});
