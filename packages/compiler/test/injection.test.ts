// Adversarial codegen-injection corpus (M6.2 exemplars + M6.3 full corpus).
// Every schema-derived string that could reach emitted source must arrive
// only through the gated formatter (emit.ts), escaped by construction. These
// cases prove, for hostile property names, pattern sources, $anchor values,
// enum/const/annotation values, and required entries, that the artifact:
//   - compiles (new Function parsed the emitted source),
//   - agrees with the interpreter on matching and non-matching instances,
//   - adds no property to globalThis and leaves Object.prototype unpolluted,
//   - never emits a raw U+2028/U+2029, and never splices a hostile string in
//     a code-active (literal-escaping) position.
//
// Note on coverage: several keywords (enum/const/required/title) have no
// M6.2 lower(), so their schema objects classify as interpreted units and
// trampoline — the hostile value then stays interpreter data and never
// reaches codegen at all (the safest outcome). `pattern`/`patternProperties`
// are the path that genuinely embeds a schema string into source; the
// escaping assertions bite hardest there.

import { describe, it, expect } from "vitest";
import { createEngine, type JsonValue } from "@jse/core";
import { compileValidator } from "@jse/compiler";

// Line/paragraph separators built from code points so this source file itself
// carries no raw U+2028/U+2029 (which would defeat the "source is clean" test).
const LS = String.fromCharCode(0x2028);
const PS = String.fromCharCode(0x2029);

const HOSTILE_NAMES = [
  'quote" + globalThis.polluted = 1 + "',
  "backtick` + `${globalThis.x}`",
  "${injected}",
  "*/ dead(); /*",
  "line" + LS + "sep" + PS + "arator",
  "__proto__",
  "constructor",
  "back\\slash",
  "new\nline",
];

/**
 * Characters that, if a schema string reached source raw, would break out of
 * the double-quoted JS string literal the gated formatter emits — the ONLY
 * shape schema strings take (never template literals, never comments;
 * serialize.ts is ESLint-fenced against both). Only an unescaped `"` or a raw
 * newline/CR terminates such a literal; backtick, `${`, and comment delimiters
 * are inert inside it. A backslash is not a terminator either — it always
 * escapes the next char and JSON.stringify doubles it, so checking for it
 * yields superstring false positives (an escaped `\\u0000` literal contains
 * the raw six-char sequence the payload was). Raw U+2028/U+2029 checked
 * separately.
 */
const BREAKOUT = /["\n\r]/;

/**
 * Assert the emitted source carries no code-active form of a hostile payload.
 * Raw U+2028/U+2029 must never appear (they were line terminators pre-ES2019
 * and still trip tooling). If the payload contains a literal-terminating
 * character ({@link BREAKOUT}), its raw form must be absent: JSON.stringify
 * escapes those, so a verbatim hit would mean the string escaped its literal.
 */
function assertSourceSafe(source: string, hostile: string): void {
  expect(source.includes(LS)).toBe(false);
  expect(source.includes(PS)).toBe(false);
  if (BREAKOUT.test(hostile)) {
    expect(source.includes(hostile)).toBe(false);
  }
}

/** Snapshot globalThis keys; returns a checker that asserts none were added. */
function guardGlobals(): () => void {
  const before = new Set(Object.keys(globalThis));
  return () => {
    const added = Object.keys(globalThis).filter((k) => !before.has(k));
    expect(added).toEqual([]);
    expect("polluted" in globalThis).toBe(false);
    expect("hacked" in globalThis).toBe(false);
  };
}

/** Assert Object.prototype was not polluted by a __proto__-bearing payload. */
function assertProtoClean(): void {
  const probe = {} as Record<string, unknown>;
  expect(Object.getPrototypeOf(probe)).toBe(Object.prototype);
  expect("polluted" in probe).toBe(false);
  expect(
    (Object.prototype as Record<string, unknown>).polluted,
  ).toBeUndefined();
}

/** Compile + differential-check one schema on a set of instances; return source. */
function checkAgreement(
  schema: JsonValue,
  uri: string,
  instances: JsonValue[],
): string {
  const engine = createEngine();
  const registered = engine.registerSchema(schema, uri);
  const { validate, source } = compileValidator(engine, registered);
  for (const inst of instances) {
    let interp: boolean | string;
    let comp: boolean | string;
    try {
      interp = engine.evaluate(registered, inst).valid;
    } catch (e) {
      interp = `throw:${(e as Error).constructor.name}`;
    }
    try {
      comp = validate(inst);
    } catch (e) {
      comp = `throw:${(e as Error).constructor.name}`;
    }
    expect(comp, JSON.stringify(inst)).toEqual(interp);
  }
  return source;
}

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
      expect(source.includes(LS)).toBe(false);
      expect(source.includes(PS)).toBe(false);
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

describe("codegen injection corpus (M6.3)", () => {
  // Valid regexes that carry every code-hostile character class. Each must
  // survive compilation and reach source only as an escaped R.re key.
  const HOSTILE_PATTERNS = [
    "['\"`]", // quotes and backtick
    "a`b", // bare backtick
    "\\$\\{x\\}", // literal ${x}
    "/\\*x\\*/", // comment delimiters
    "[\\u2028\\u2029]", // escaped separators (source form)
    "line\\nbreak", // escaped newline in the pattern source
    "\\\\backslash", // escaped backslash
    "(?:a|b)+c", // ordinary, as a control
    "['\"]\\s*[`]", // mixed
  ];

  it("hostile pattern sources: escaped R.re keys, agree, no leaks", () => {
    for (let i = 0; i < HOSTILE_PATTERNS.length; i++) {
      const source = "^" + HOSTILE_PATTERNS[i]! + "$";
      const guard = guardGlobals();
      const emitted = checkAgreement(
        { type: "string", pattern: source },
        `https://inj.example/pat/${String(i)}`,
        ["", "abc", "a`b", '"q"', "${x}", "/*c*/", "x y", "😀"],
      );
      // Pattern must reach source, and only as an escaped R.re key.
      expect(emitted).toContain("R.re[");
      assertSourceSafe(emitted, source);
      guard();
      assertProtoClean();
    }
  });

  it("hostile patternProperties keys and subschemas stay data", () => {
    // patternProperties keys are regex sources — must be valid regexes that
    // still carry code-hostile characters.
    for (const key of ['a`${x}"', "/\\*x\\*/", "[\"'`]", "k k"]) {
      const guard = guardGlobals();
      const emitted = checkAgreement(
        { patternProperties: { [key]: { type: "string" } } },
        "https://inj.example/patprop/" + encodeURIComponent(key),
        [{}, { a: "s" }, { a: 1 }, { "a`b": "s" }, { x: {} }],
      );
      assertSourceSafe(emitted, key);
      guard();
      assertProtoClean();
    }
  });

  it("hostile property names across matching/non-matching instances", () => {
    const extraNames = [
      "toString",
      "hasOwnProperty",
      "valueOf",
      "a`${globalThis.polluted=1}`b",
      '"; globalThis.polluted = 1; "',
      "/*", // dangling comment opener
      "*/", // dangling comment closer
      "\\u0000",
    ];
    for (const name of [...HOSTILE_NAMES, ...extraNames]) {
      const guard = guardGlobals();
      const emitted = checkAgreement(
        { type: "object", properties: { [name]: { type: "integer" } } },
        "https://inj.example/name/" + encodeURIComponent(name),
        [
          {},
          { [name]: 1 },
          { [name]: "no" },
          { [name]: 1.5 },
          { other: 1 },
        ] as JsonValue[],
      );
      assertSourceSafe(emitted, name);
      guard();
      assertProtoClean();
    }
  });

  it("hostile $anchor values never reach source", () => {
    for (const anchor of ["a`b", "x${y}", 'q"z', "s" + LS + "p"]) {
      const guard = guardGlobals();
      const emitted = checkAgreement(
        {
          $defs: { t: { $anchor: anchor, type: "string" } },
          $ref: "#" + anchor,
        },
        "https://inj.example/anchor/" + encodeURIComponent(anchor),
        ["ok", 5, null, {}],
      );
      // Anchors are resolution metadata; they must not appear in source.
      assertSourceSafe(emitted, anchor);
      guard();
    }
  });

  it("enum/const with deep __proto__ and escape hazards agree, no pollution", () => {
    const hazardKey = "k\"'`${}\\\n";
    const deepProto = JSON.parse(
      '{"a":{"b":{"__proto__":{"polluted":true}}}}',
    ) as JsonValue;
    const cases: { schema: JsonValue; instances: JsonValue[] }[] = [
      {
        schema: { enum: [deepProto, "a b", "x`${y}"] },
        instances: [deepProto, "a b", "x`${y}", "other", 1, null],
      },
      {
        schema: { const: { [hazardKey]: "v\nx", nested: deepProto } },
        instances: [
          { [hazardKey]: "v\nx", nested: deepProto },
          { [hazardKey]: "different" },
          "not-object",
        ],
      },
      {
        schema: {
          properties: {
            p: {
              const: JSON.parse('{"__proto__":{"x":1}}') as JsonValue,
            },
          },
        },
        instances: [{ p: {} }, { p: { a: 1 } }, {}],
      },
    ];
    for (let i = 0; i < cases.length; i++) {
      const guard = guardGlobals();
      const emitted = checkAgreement(
        cases[i]!.schema,
        "https://inj.example/enumconst/" + String(i),
        cases[i]!.instances,
      );
      assertSourceSafe(emitted, hazardKey);
      guard();
      assertProtoClean();
    }
  });

  it("annotation keyword values (title/default) never splice into code", () => {
    const hostileAnnotations: JsonValue[] = [
      "t`${globalThis.polluted=1}`",
      '"; globalThis.polluted = 1; "',
      "line" + LS + "sep" + PS,
      JSON.parse('{"__proto__":{"polluted":true}}') as JsonValue,
      { "*/": "/*", "`${x}`": 1 },
    ];
    for (let i = 0; i < hostileAnnotations.length; i++) {
      const value = hostileAnnotations[i]!;
      const guard = guardGlobals();
      const emitted = checkAgreement(
        {
          type: "object",
          properties: { a: { type: "string", title: "x", default: value } },
        },
        "https://inj.example/annot/" + String(i),
        [{ a: "s" }, { a: 1 }, {}],
      );
      if (typeof value === "string") assertSourceSafe(emitted, value);
      // Flag-mode elides annotation productions, so the hostile value should
      // not appear in source at all — and never as raw separators.
      expect(emitted.includes(LS)).toBe(false);
      expect(emitted.includes(PS)).toBe(false);
      guard();
      assertProtoClean();
    }
  });

  it("required arrays with hostile entries stay data", () => {
    const requiredSets: string[][] = [
      ["a`${x}", "__proto__", "b c"],
      ['"; drop(); "', "toString", "s" + LS + "p"],
      ["*/", "/*", "`"],
    ];
    for (let i = 0; i < requiredSets.length; i++) {
      const req = requiredSets[i]!;
      const guard = guardGlobals();
      const emitted = checkAgreement(
        { type: "object", required: req },
        "https://inj.example/req/" + String(i),
        [{}, Object.fromEntries(req.map((k) => [k, 1])), { [req[0]!]: 1 }],
      );
      for (const entry of req) assertSourceSafe(emitted, entry);
      guard();
      assertProtoClean();
    }
  });
});
