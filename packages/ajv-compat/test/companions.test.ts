// The ajv-formats/ajv-errors/ajv-keywords companion modules vs the AJV
// companion-package oracle: fixtures captured by
// test/oracle/capture-companions.ts (the real packages executed, never
// read — D15). Format-table + per-format accept/reject cases pin
// formats.ts's table; format-comparison/ajv-errors/ajv-keywords cases run
// end-to-end through the Ajv class.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { JsonValue } from "@jse/core";
import { Ajv2020 } from "../src/index.js";
import addFormats, { AJV_FORMATS_TABLE } from "../src/formats.js";
import ajvErrors from "../src/ajv-errors.js";
import ajvKeywords from "../src/ajv-keywords.js";

interface FormatTableCase {
  names: string[];
}
interface FormatProbeCase {
  format: string;
  values: { value: JsonValue; valid: boolean }[];
}
interface EndToEndCase {
  schema: JsonValue;
  data: JsonValue;
  options?: Record<string, unknown>;
  valid: boolean;
  errors: Record<string, unknown>[] | null;
}

const FIXTURE = JSON.parse(
  readFileSync(
    join(
      dirname(fileURLToPath(import.meta.url)),
      "fixtures",
      "ajv-companions.json",
    ),
    "utf8",
  ),
) as Record<string, unknown>;

describe("addFormats: format table", () => {
  it("registers the exact 26-name set the oracle pins", () => {
    const c = FIXTURE["format-table"] as FormatTableCase;
    expect(Object.keys(AJV_FORMATS_TABLE).sort()).toEqual(c.names);
  });
});

const FORMAT_PROBE_NAMES = [
  "iso-time",
  "iso-date-time",
  "int32",
  "int64",
  "float",
  "double",
  "password",
  "binary",
  "byte",
  "json-pointer-uri-fragment",
  "url",
];

describe("addFormats: per-format accept/reject", () => {
  for (const name of FORMAT_PROBE_NAMES) {
    it(name, () => {
      const c = FIXTURE[name] as FormatProbeCase;
      const ajv = new Ajv2020({ logger: false });
      addFormats(ajv);
      const validate = ajv.compile({ format: c.format });
      for (const { value, valid } of c.values) {
        expect(validate(value), JSON.stringify(value)).toBe(valid);
      }
    });
  }

  it("fast mode maps to the same (full-strength) implementations", () => {
    const ajv = new Ajv2020({ logger: false });
    addFormats(ajv, { mode: "fast" });
    const validate = ajv.compile({ type: "string", format: "date" });
    expect(validate("2021-02-29")).toBe(false); // not a leap year
  });

  it("string-array form restricts to the named formats", () => {
    const ajv = new Ajv2020({ logger: false });
    addFormats(ajv, ["date"]);
    expect(() => ajv.compile({ type: "string", format: "time" })).toThrow(
      /unknown format/,
    );
  });
});

const FORMAT_COMPARISON_NAMES = [
  "date-min-fail",
  "date-max",
  "time-exclusiveMin-utc-normalized",
  "time-min-utc-normalized-pass",
  "formatMinimum-non-string-vacuous",
];

describe("addFormats: keywords (formatMinimum/Maximum/Exclusive*)", () => {
  for (const name of FORMAT_COMPARISON_NAMES) {
    it(name, () => {
      const c = FIXTURE[name] as EndToEndCase;
      const ajv = new Ajv2020({ allErrors: true, logger: false });
      addFormats(ajv, { keywords: true });
      const validate = ajv.compile(c.schema);
      expect(validate(c.data), "verdict").toBe(c.valid);
      expect(validate.errors).toEqual(c.valid ? null : c.errors);
    });
  }

  it("$data option is unsupported (constructor-level, matches every keyword)", () => {
    expect(() => new Ajv2020({ $data: true, logger: false })).toThrow(/\$data/);
  });

  // NOTE (doc-vs-behavior surprise): AJV throws these two from
  // ajv.compile() itself, before any data is validated. This adapter's
  // compat keywords only run their `validate` body from inside evaluate()
  // (see index.ts's toBehavior) — there is no eager per-keyword
  // compile-time hook the way discriminator.ts's checkDiscriminators gets
  // one — so both throw on the FIRST validate() call instead. Documented
  // here rather than silently diverging.
  it("missing sibling format throws (at first validate, not compile)", () => {
    const ajv = new Ajv2020({ logger: false });
    addFormats(ajv, { keywords: true });
    const validate = ajv.compile({ type: "string", formatMinimum: "x" });
    expect(() => validate("y")).toThrow(
      /dependencies of formatMinimum: format/,
    );
  });

  it("format without a comparator throws (at first validate, not compile)", () => {
    const ajv = new Ajv2020({ logger: false });
    addFormats(ajv, { keywords: true });
    const validate = ajv.compile({
      type: "string",
      format: "email",
      formatMinimum: "a",
    });
    expect(() => validate("a@b.com")).toThrow(/does not define "compare"/);
  });
});

const AJV_ERRORS_NAMES = [
  "string-form",
  "per-keyword",
  "per-property-required",
  "properties-map-through-allof",
  "default-catchall",
  "items-repeat",
  "nested-errorMessage",
  "outer-covers-inner-replaced",
  "keepErrors",
  "singleError-same-path",
  "singleError-custom-sep",
  "per-keyword-no-single",
  "template-pointer",
  "template-relative-pointer-propname",
  "prefixItems-nested",
];

describe("ajvErrors ≡ AJV oracle", () => {
  for (const name of AJV_ERRORS_NAMES) {
    it(name, () => {
      const c = FIXTURE[name] as EndToEndCase;
      const ajv = new Ajv2020({ allErrors: true, logger: false });
      ajvErrors(ajv, c.options);
      const validate = ajv.compile(c.schema);
      expect(validate(c.data), "verdict").toBe(c.valid);
      expect(validate.errors).toEqual(c.valid ? null : c.errors);
    });
  }

  it("requires allErrors: true", () => {
    const ajv = new Ajv2020({ logger: false });
    expect(() => ajvErrors(ajv)).toThrow(/allErrors must be true/);
  });

  it("errorMessage is a known keyword once registered (strict mode)", () => {
    const ajv = new Ajv2020({ allErrors: true, logger: false });
    ajvErrors(ajv);
    expect(() =>
      ajv.compile({ type: "string", errorMessage: "bad" }),
    ).not.toThrow();
  });
});

describe("ajvKeywords ≡ AJV oracle", () => {
  const CASES: [string, string[]][] = [
    ["typeof-pass", ["typeof"]],
    ["typeof-fail", ["typeof"]],
    ["typeof-array", ["typeof"]],
    ["instanceof-array-pass", ["instanceof"]],
    ["instanceof-fail", ["instanceof"]],
    ["uniqueItemProperties-dup", ["uniqueItemProperties"]],
    ["uniqueItemProperties-both-missing", ["uniqueItemProperties"]],
    ["uniqueItemProperties-one-missing-pass", ["uniqueItemProperties"]],
    ["prohibited-non-object-vacuous", ["prohibited"]],
  ];
  for (const [name, names] of CASES) {
    it(name, () => {
      const c = FIXTURE[name] as EndToEndCase;
      const ajv = new Ajv2020({
        allErrors: true,
        logger: false,
        strict: false,
      });
      ajvKeywords(ajv, names);
      const validate = ajv.compile(c.schema);
      expect(validate(c.data), "verdict").toBe(c.valid);
      expect(validate.errors).toEqual(c.valid ? null : c.errors);
    });
  }

  // The real ajv-keywords composes `prohibited` from `not`+`anyRequired`
  // internally (README: "equivalent to {not: {anyRequired: [...]}}") and
  // that macro expansion surfaces a companion `not` error alongside its
  // own — an implementation detail this adapter doesn't replicate (macro
  // expansion is out of scope, see AjvCompatUnsupportedError elsewhere);
  // this adapter's `prohibited` reports only its own verdict and error.
  it("prohibited-fail (verdict only; the real package's companion `not` error is not replicated)", () => {
    const c = FIXTURE["prohibited-fail"] as EndToEndCase;
    const ajv = new Ajv2020({ allErrors: true, logger: false, strict: false });
    ajvKeywords(ajv, ["prohibited"]);
    const validate = ajv.compile(c.schema);
    expect(validate(c.data)).toBe(c.valid);
    expect(validate.errors).toHaveLength(1);
    expect(validate.errors![0]!.keyword).toBe("prohibited");
  });

  it("transform/dynamicDefaults activate (no longer refused) and mutate", () => {
    const ajv = new Ajv2020({ logger: false });
    expect(() => ajvKeywords(ajv, "transform")).not.toThrow();
    expect(() => ajvKeywords(ajv, "dynamicDefaults")).not.toThrow();
    const fn = ajv.compile({
      type: "object",
      properties: { v: { type: "string", transform: ["trim"] } },
    });
    const data = { v: "  x  " } as JsonValue;
    expect(fn(data)).toBe(true);
    expect(data).toEqual({ v: "x" });
  });

  it("$data-dependent names raise AjvCompatUnsupportedError", () => {
    const ajv = new Ajv2020({ logger: false });
    expect(() => ajvKeywords(ajv, "select")).toThrow(/\$data/);
  });

  it("unknown names raise AjvCompatUnsupportedError", () => {
    const ajv = new Ajv2020({ logger: false });
    expect(() => ajvKeywords(ajv, "nope")).toThrow(
      /not part of the supported subset/,
    );
  });

  it("a custom modifying:true keyword is still refused (generic mutation out of scope)", () => {
    const ajv = new Ajv2020({ logger: false });
    expect(() => ajv.addKeyword({ keyword: "myMod", modifying: true })).toThrow(
      /out of scope/,
    );
  });

  it("activation is a compile-time snapshot; a fresh compile after it mutates", () => {
    // strictSchema:false so a transform-bearing schema compiles BEFORE
    // activation (transform present but inert) — this isolates the
    // activation, not strict-mode keyword rejection.
    const ajv = new Ajv2020({ logger: false, strictSchema: false });
    const schema = {
      type: "object",
      properties: { v: { type: "string", transform: ["trim"] } },
    };
    const before = ajv.compile(schema);
    const d1 = { v: "  a  " } as JsonValue;
    expect(before(d1)).toBe(true);
    expect(d1).toEqual({ v: "  a  " }); // inert: transform not active yet

    ajvKeywords(ajv, "transform"); // activates + invalidates caches

    // `before` is a compile-time snapshot: still non-mutating.
    const d2 = { v: "  a  " } as JsonValue;
    expect(before(d2)).toBe(true);
    expect(d2).toEqual({ v: "  a  " });

    // A fresh compile (equal-but-distinct object recompiles past the object
    // cache) picks up the activation and mutates.
    const after = ajv.compile(JSON.parse(JSON.stringify(schema)) as JsonValue);
    const d3 = { v: "  a  " } as JsonValue;
    expect(after(d3)).toBe(true);
    expect(d3).toEqual({ v: "a" });
  });
});
