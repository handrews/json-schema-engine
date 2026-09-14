// Standalone emission (M6.5): helper drift guards against core originals,
// end-to-end module execution, and the fully-static scope line. The bulk
// CSP evidence lives in `npm run csp:check` (plain node child process with
// --disallow-code-generation-from-strings); these tests cover the pieces
// vitest can assert directly.

import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  canonicalKey,
  codePointLength,
  createEngine,
  escapeSegment,
  hasDuplicateItems,
  isMultipleOf,
  jsonEqual,
  MaxDepthExceededError,
  type JsonValue,
} from "@jse/core";
import { emitStandalone, StandaloneUnsupportedError } from "@jse/compiler";
import { FORMATS_2020_12 } from "@jse/formats";
import { STANDALONE_PREAMBLE } from "../src/standalone.js";

interface PreambleHelpers {
  h_eq: (a: JsonValue, b: JsonValue) => boolean;
  h_ck: (v: JsonValue) => string;
  h_dup: (items: JsonValue[]) => boolean;
  h_cpl: (s: string) => number;
  h_esc: (s: string) => string;
  h_mof: (a: number, b: number) => boolean;
  MaxDepthExceededError: new (message: string) => Error;
}

// Materialize the preamble's helpers for direct comparison. new Function is
// fine here — this is a test, not a CSP context.
// eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
const preambleFactory = new Function(
  STANDALONE_PREAMBLE +
    "return { h_eq, h_ck, h_dup, h_cpl, h_esc, h_mof, MaxDepthExceededError };",
) as () => PreambleHelpers;
const helpers = preambleFactory();

describe("standalone preamble drift guards (M6.5)", () => {
  const values: JsonValue[] = [
    null,
    true,
    false,
    0,
    -0,
    1,
    5e-324,
    1e308,
    9007199254740992,
    "",
    "a",
    "𝄞clef",
    "true",
    "~/~1",
    [],
    [1, 2],
    [[null]],
    {},
    { a: 1, b: [2] },
    { b: [2], a: 1 },
    { nested: { x: [1, "1", true] } },
  ];

  it("h_eq matches jsonEqual over the vector cross product", () => {
    for (const a of values) {
      for (const b of values) {
        expect(helpers.h_eq(a, b), JSON.stringify([a, b])).toBe(
          jsonEqual(a, b),
        );
      }
    }
  });

  it("h_ck matches canonicalKey", () => {
    for (const v of values) {
      expect(helpers.h_ck(v)).toBe(canonicalKey(v));
    }
  });

  it("h_dup matches hasDuplicateItems", () => {
    const arrays: JsonValue[][] = [
      [],
      [1, 2, 3],
      [1, "1", true, null],
      [
        { a: 1, b: 2 },
        { b: 2, a: 1 },
      ],
      [[1], [1]],
      values,
    ];
    for (const arr of arrays) {
      expect(helpers.h_dup(arr), JSON.stringify(arr)).toBe(
        hasDuplicateItems(arr),
      );
    }
  });

  it("h_cpl matches codePointLength", () => {
    for (const s of ["", "abc", "𝄞", "a𝄞b𝄞", "\u{1F600}\u{1F600}"]) {
      expect(helpers.h_cpl(s)).toBe(codePointLength(s));
    }
  });

  it("h_esc matches escapeSegment", () => {
    for (const s of ["", "a", "~", "/", "~1", "a/b~c", "~0/"]) {
      expect(helpers.h_esc(s)).toBe(escapeSegment(s));
    }
  });

  it("h_mof matches isMultipleOf", () => {
    const pairs: [number, number][] = [
      [10, 5],
      [10, 3],
      [0.0075, 0.0001],
      [1e308, 1e-8],
      [3, 0.5],
      [9007199254740992, 2],
      [-0, 1],
      [1.5, 0.3],
    ];
    for (const [a, b] of pairs) {
      expect(helpers.h_mof(a, b), `${String(a)} % ${String(b)}`).toBe(
        isMultipleOf(a, b),
      );
    }
  });

  it("the mirrored MaxDepthExceededError matches core's class shape", () => {
    const mirrored = new helpers.MaxDepthExceededError("m");
    const original = new MaxDepthExceededError("m");

    // Same discriminator a standalone consumer can actually reach: the
    // constructor name. instanceof cannot match across the boundary — the
    // module has no imports — so it is asserted false deliberately rather
    // than left as an unstated surprise.
    expect(mirrored.constructor.name).toBe(original.constructor.name);
    expect(mirrored).not.toBeInstanceOf(MaxDepthExceededError);

    // Core sets no own `name`, so the mirror must not either: a standalone
    // module reporting "MaxDepthExceededError" where core reports "Error"
    // would be its own divergence.
    expect(mirrored.name).toBe(original.name);
    expect(mirrored.message).toBe(original.message);
    expect(mirrored).toBeInstanceOf(Error);
    expect(mirrored).not.toBeInstanceOf(RangeError);
  });
});

describe("emitStandalone (M6.5)", () => {
  it("emits a working self-contained module for a static schema", async () => {
    const engine = createEngine();
    const uri = engine.registerSchema(
      {
        type: "object",
        required: ["id"],
        properties: {
          id: { type: "integer", minimum: 1 },
          name: { type: "string", pattern: "^[a-z]+$", maxLength: 10 },
        },
        unevaluatedProperties: false,
      },
      "https://standalone.example/user",
    );
    const source = emitStandalone(engine, uri);
    expect(source).not.toContain("import ");
    expect(source).toContain("export default function validate");

    const dir = mkdtempSync(join(tmpdir(), "jse-standalone-"));
    try {
      const file = join(dir, "artifact.mjs");
      writeFileSync(file, source);
      const { default: validate } = (await import(/* @vite-ignore */ file)) as {
        default: (v: unknown) => boolean;
      };
      for (const instance of [
        { id: 1, name: "ok" },
        { id: 0, name: "ok" },
        { id: 1, name: "NOPE" },
        { id: 1, extra: true },
        { name: "ok" },
        "not an object",
      ]) {
        expect(validate(instance), JSON.stringify(instance)).toBe(
          engine.evaluate(uri, instance as never).valid,
        );
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses format-asserting schemas (the table's predicates cannot be inlined)", () => {
    const engine = createEngine({
      formats: FORMATS_2020_12,
      assertFormats: true,
    });
    const uri = engine.registerSchema(
      { format: "ipv4" },
      "https://standalone.example/fmt",
    );
    expect(() => emitStandalone(engine, uri)).toThrow(
      StandaloneUnsupportedError,
    );
  });

  it("refuses island plans, naming the interpreter as the CSP path", () => {
    const engine = createEngine();
    const uri = engine.registerSchema(
      { $dynamicAnchor: "n", items: { $dynamicRef: "#n" } },
      "https://standalone.example/dyn",
    );
    expect(() => emitStandalone(engine, uri)).toThrow(
      StandaloneUnsupportedError,
    );
  });
});
