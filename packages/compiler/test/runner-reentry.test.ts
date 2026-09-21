// The compiled flag trampoline reuses one evaluation state per artifact
// (createFragmentRunner). A keyword inside an island that re-enters the same
// artifact — user code running inside the trampoline — must get correct
// nested verdicts, and a throwing island must leave the artifact usable.

import { describe, it, expect } from "vitest";
import { createEngine } from "@json-schema-engine/core";
import {
  buildPlan,
  compileValidator,
  type CompiledArtifact,
} from "@json-schema-engine/compiler";

const VOCAB = "urn:reentry:vocab";
const DIALECT = "urn:reentry:dialect";

describe("compiled flag trampoline: state reuse", () => {
  it("re-enters the same artifact from inside an island", () => {
    const engine = createEngine();
    const box: { validator?: CompiledArtifact } = {};
    engine.registerVocabulary(VOCAB, {
      reenter: {
        id: `${VOCAB}#reenter`,
        evaluate: (_value, cursor) => {
          const v = cursor.value;
          if (typeof v !== "object" || v === null || Array.isArray(v)) {
            return true;
          }
          // Validate the nested member against the whole artifact again.
          return v.child === undefined || box.validator!.validate(v.child);
        },
      },
    });
    engine.registerDialect(DIALECT, [
      "https://json-schema.org/draft/2020-12/vocab/core",
      "https://json-schema.org/draft/2020-12/vocab/applicator",
      "https://json-schema.org/draft/2020-12/vocab/validation",
      VOCAB,
    ]);
    const uri = engine.registerSchema(
      {
        type: "object",
        properties: { n: { type: "integer", minimum: 1 } },
        required: ["n"],
        reenter: true,
      },
      "https://reentry.example/root",
      DIALECT,
    );
    // The custom keyword has no lowering: the root islands.
    expect(buildPlan(engine, uri).targets.length).toBeGreaterThan(0);
    const validator = compileValidator(engine, uri);
    box.validator = validator;
    expect(validator.validate({ n: 1 })).toBe(true);
    expect(validator.validate({ n: 1, child: { n: 2 } })).toBe(true);
    expect(validator.validate({ n: 1, child: { n: 0 } })).toBe(false);
    expect(validator.validate({ n: 1, child: { n: 2, child: {} } })).toBe(
      false,
    );
    expect(validator.validate({ n: 1, child: { n: 2, child: { n: 3 } } })).toBe(
      true,
    );
    expect(validator.validate({ n: 0 })).toBe(false);
    expect(validator.validate({ n: 1 })).toBe(true);
  });

  it("stays usable after an island throws", () => {
    const engine = createEngine();
    engine.registerVocabulary(VOCAB, {
      boom: {
        id: `${VOCAB}#boom`,
        evaluate: (_value, cursor) => {
          if (cursor.value === "boom") throw new Error("boom");
          return true;
        },
      },
    });
    engine.registerDialect(DIALECT, [
      "https://json-schema.org/draft/2020-12/vocab/core",
      "https://json-schema.org/draft/2020-12/vocab/validation",
      VOCAB,
    ]);
    const uri = engine.registerSchema(
      { boom: true, type: "string", minLength: 2 },
      "https://reentry.example/boom",
      DIALECT,
    );
    const validator = compileValidator(engine, uri);
    expect(() => validator.validate("boom")).toThrow("boom");
    expect(validator.validate("ok")).toBe(true);
    expect(validator.validate("k")).toBe(false);
  });
});
