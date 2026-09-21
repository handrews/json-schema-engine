// `strictUnicodeRegex` (EngineOptions): a `pattern`/`patternProperties`
// regex that only the non-unicode (Annex B) grammar accepts is rejected at
// registration instead of compiling through schemaRegExp's fallback. The
// default stays lenient, and the screen composes with `rejectUnsafeRegex`.

import { describe, it, expect } from "vitest";
import {
  createEngine,
  classifyRegex,
  NonUnicodeRegexError,
  UnsafeRegexError,
} from "@json-schema-engine/core";

// `\a` is an identity escape only under Annex B; in unicode mode it is a
// SyntaxError. `\p{L}` is the reverse: unicode mode only.
const LEGACY = "^\\a$";
const UNICODE_ONLY = "^\\p{L}+$";
const INVALID = "(";

describe("classifyRegex", () => {
  it("distinguishes unicode-mode, legacy-only, and invalid patterns", () => {
    expect(classifyRegex("^[a-z]+$")).toBe("unicode");
    expect(classifyRegex(UNICODE_ONLY)).toBe("unicode");
    expect(classifyRegex(LEGACY)).toBe("legacy");
    expect(classifyRegex("[\\d-x]")).toBe("legacy");
    expect(classifyRegex(INVALID)).toBe("invalid");
  });
});

describe("strictUnicodeRegex", () => {
  it("is off by default: a legacy-only pattern compiles through the fallback", () => {
    const engine = createEngine();
    const uri = engine.registerSchema(
      { pattern: LEGACY },
      "https://rx.example/lenient",
    );
    expect(engine.evaluate(uri, "a").valid).toBe(true);
    expect(engine.evaluate(uri, "b").valid).toBe(false);
  });

  it("rejects a legacy-only `pattern` at registration", () => {
    const engine = createEngine({ strictUnicodeRegex: true });
    expect(() =>
      engine.registerSchema({ pattern: LEGACY }, "https://rx.example/strict"),
    ).toThrow(NonUnicodeRegexError);
    expect(() =>
      engine.registerSchema({ pattern: LEGACY }, "https://rx.example/strict"),
    ).toThrow(/legacy \(Annex B\)/);
  });

  it("rejects a legacy-only property-name pattern, naming its location", () => {
    const engine = createEngine({ strictUnicodeRegex: true });
    expect(() =>
      engine.registerSchema(
        { properties: { x: { patternProperties: { [LEGACY]: true } } } },
        "https://rx.example/strict-pp",
      ),
    ).toThrow(/properties\/x\/patternProperties/);
  });

  it("rejects a pattern invalid under both grammars", () => {
    const engine = createEngine({ strictUnicodeRegex: true });
    expect(() =>
      engine.registerSchema({ pattern: INVALID }, "https://rx.example/bad"),
    ).toThrow(NonUnicodeRegexError);
  });

  it("still registers unicode-mode patterns, including property escapes", () => {
    const engine = createEngine({ strictUnicodeRegex: true });
    const uri = engine.registerSchema(
      {
        pattern: UNICODE_ONLY,
        patternProperties: { "^[a-z]+$": { type: "string" } },
      },
      "https://rx.example/ok",
    );
    expect(engine.evaluate(uri, "héllo").valid).toBe(true);
    expect(engine.evaluate(uri, "h3llo").valid).toBe(false);
  });

  it("does not screen the trusted built-in metaschemas", () => {
    expect(() => createEngine({ strictUnicodeRegex: true })).not.toThrow();
  });

  it("composes with rejectUnsafeRegex: each screen still fires", () => {
    const engine = createEngine({
      strictUnicodeRegex: true,
      rejectUnsafeRegex: true,
    });
    expect(() =>
      engine.registerSchema({ pattern: "(a+)+$" }, "https://rx.example/unsafe"),
    ).toThrow(UnsafeRegexError);
    expect(() =>
      engine.registerSchema({ pattern: LEGACY }, "https://rx.example/legacy"),
    ).toThrow(NonUnicodeRegexError);
  });
});
