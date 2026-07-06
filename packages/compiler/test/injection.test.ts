// Codegen-injection exemplars (M6.2; full adversarial corpus lands with the
// M6.3 harness). Hostile schema-derived strings must reach emitted source
// only through the gated formatter — these cases prove the compiled
// artifact parses, agrees with the interpreter, and never executes or
// leaks anything at compile time.

import { describe, it, expect } from "vitest";
import { createEngine, type JsonValue } from "@jse/core";
import { compileValidator } from "@jse/compiler";

const HOSTILE_NAMES = [
  'quote" + globalThis.polluted = 1 + "',
  "backtick` + `${globalThis.x}`",
  "${injected}",
  "*/ dead(); /*",
  "line\u2028sep\u2029arator",
  "__proto__",
  "constructor",
  "back\\slash",
  "new\nline",
];

describe("codegen injection exemplars (M6.2)", () => {
  it("hostile property names emit as data, never as code", () => {
    for (const name of HOSTILE_NAMES) {
      const engine = createEngine();
      const uri = engine.registerSchema(
        { properties: { [name]: { type: "string" } } },
        "https://inj.example/props",
      );
      const { validate, source } = compileValidator(engine, uri);
      // The artifact compiled (new Function parsed it) and behaves.
      const good = { [name]: "s" } as unknown as JsonValue;
      const bad = { [name]: 5 } as unknown as JsonValue;
      expect(validate(good)).toBe(engine.evaluate(uri, good).valid);
      expect(validate(bad)).toBe(engine.evaluate(uri, bad).valid);
      expect(validate(bad)).toBe(false);
      // U+2028/U+2029 never appear raw in emitted source.
      expect(source.includes("\u2028")).toBe(false);
      expect(source.includes("\u2029")).toBe(false);
    }
    const clean = {} as Record<string, unknown>;
    expect("polluted" in globalThis).toBe(false);
    expect(Object.getPrototypeOf(clean)).toBe(Object.prototype);
  });

  it("hostile pattern sources are table lookups, not literals", () => {
    const engine = createEngine();
    const hostile = "['\"`]"; // valid regex; quotes/backtick are code-hostile
    const uri = engine.registerSchema(
      { pattern: hostile },
      "https://inj.example/pattern",
    );
    const { validate, source } = compileValidator(engine, uri);
    expect(validate("abc")).toBe(engine.evaluate(uri, "abc").valid);
    expect("hacked" in globalThis).toBe(false);
    // The pattern reaches code only as an escaped string key of R.re.
    expect(source).toContain("R.re[");
    expect(source.includes(hostile)).toBe(false); // escaped, not verbatim
  });

  it("hostile const values round-trip without touching prototypes", () => {
    const engine = createEngine();
    const uri = engine.registerSchema(
      {
        properties: {
          a: {
            // annotation-only keyword with a __proto__-carrying value:
            // must emit via the JSON.parse path, not an object literal.
            default: JSON.parse('{"__proto__": {"polluted": true}}') as never,
            type: "object",
          },
        },
      },
      "https://inj.example/proto-const",
    );
    const { validate } = compileValidator(engine, uri);
    expect(validate({ a: {} })).toBe(true);
    const clean = {} as Record<string, unknown>;
    expect("polluted" in clean).toBe(false);
  });
});
