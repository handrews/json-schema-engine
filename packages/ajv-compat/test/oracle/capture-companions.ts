// Oracle capture (M8.4, D15): ajv-formats/ajv-errors/ajv-keywords are
// EXECUTED here — never read — to pin the companion-package behavior
// their docs leave out (exact format-name list, format-comparison
// semantics, errorMessage post-processing rules, ajv-keywords error
// shapes). Output: test/fixtures/ajv-companions.json, committed so the
// companion-module tests run without invoking the real packages.
//
// Re-run after an ajv-formats/ajv-errors/ajv-keywords devDependency bump:
//   npx tsx packages/ajv-compat/test/oracle/capture-companions.ts

import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020Import from "ajv/dist/2020.js";
import addFormatsImport from "ajv-formats";
import ajvErrorsImport from "ajv-errors";
import ajvKeywordsImport from "ajv-keywords";

// Same CJS/ESM unwrap as capture.ts — every companion ships a `default`
// export under NodeNext's interop.
const unwrap = <T>(m: T): T =>
  (m as { default?: T }).default !== undefined
    ? (m as { default: T }).default
    : m;
type AjvCtor = new (options?: Record<string, unknown>) => {
  compile(schema: unknown): ((data: unknown) => boolean) & {
    errors?: unknown[] | null;
  };
  errorsText(errors?: unknown[] | null): string;
};
const Ajv2020 = unwrap(Ajv2020Import) as unknown as AjvCtor;
const addFormats = unwrap(addFormatsImport) as unknown as (
  ajv: unknown,
  opts?: Record<string, unknown>,
) => void;
const ajvErrors = unwrap(ajvErrorsImport) as unknown as (
  ajv: unknown,
  opts?: Record<string, unknown>,
) => void;
const ajvKeywords = unwrap(ajvKeywordsImport) as unknown as (
  ajv: unknown,
  names?: string | string[],
) => void;

interface FormatProbeCase {
  name: string;
  format: string;
  mode?: "fast" | "full";
  values: unknown[];
}

// The exact 26-name table + representative accept/reject boundary values
// per name — this is what pins formats.ts's AJV_FORMATS_TABLE against the
// executed package (rather than just the README's prose list).
const FORMAT_PROBES: FormatProbeCase[] = [
  { name: "format-table", format: "__names__", values: [] },
  {
    name: "iso-time",
    format: "iso-time",
    values: [
      "10:00:00",
      "10:00:00Z",
      "10:00:00+01:00",
      "not-a-time",
      "10:00",
      "24:00:00",
      "23:59:60Z",
      "10:00:00+23:59",
      "10:00:00+24:00",
    ],
  },
  {
    name: "iso-date-time",
    format: "iso-date-time",
    values: [
      "2020-01-01T10:00:00",
      "2020-01-01T10:00:00Z",
      "2020-01-01",
      "not-a-datetime",
      "2020-01-01T10:00:00+01:00",
      "2020-02-30T10:00:00Z",
      "2020-01-01 10:00:00Z",
      "2020-01-01X10:00:00Z",
    ],
  },
  {
    name: "int32",
    format: "int32",
    values: [0, 2147483647, 2147483648, -2147483648, -2147483649, 1.5],
  },
  {
    name: "int64",
    format: "int64",
    values: [0, Number.MAX_SAFE_INTEGER, 1.5],
  },
  { name: "float", format: "float", values: [0, 1.5, Infinity, -Infinity] },
  { name: "double", format: "double", values: [0, 1.5, Infinity, -Infinity] },
  { name: "password", format: "password", values: ["anything", 5, null] },
  { name: "binary", format: "binary", values: ["anything", 5, null] },
  {
    name: "byte",
    format: "byte",
    values: ["", "aGVsbG8=", "not base64!!", "abc", "AAAA", "AAA=", "AA"],
  },
  {
    name: "json-pointer-uri-fragment",
    format: "json-pointer-uri-fragment",
    values: ["#/a/b", "#", "/a/b", "#/a~0b", "not-a-fragment ptr"],
  },
  {
    name: "url",
    format: "url",
    values: [
      "https://example.com",
      "http://foo.com/path?q=1#frag",
      "http://foo.com?q=1",
      "mailto:a@b.com",
      "http://999.999.999.999",
      "http://foo",
    ],
  },
];

const FORMAT_COMPARISON_CASES = [
  {
    name: "date-min-fail",
    schema: { type: "string", format: "date", formatMinimum: "2020-01-01" },
    data: "2019-01-01",
  },
  {
    name: "date-max",
    schema: { type: "string", format: "date", formatMaximum: "2020-01-01" },
    data: "2020-01-02",
  },
  {
    name: "time-exclusiveMin-utc-normalized",
    schema: {
      type: "string",
      format: "time",
      formatExclusiveMinimum: "05:00:00Z",
    },
    data: "06:00:00+01:00", // == 05:00 UTC, exclusive -> fails
  },
  {
    name: "time-min-utc-normalized-pass",
    schema: { type: "string", format: "time", formatMinimum: "05:00:00Z" },
    data: "03:00:00-03:00", // == 06:00 UTC, >= 05:00 -> passes (lexicographic would fail)
  },
  {
    name: "formatMinimum-non-string-vacuous",
    schema: { format: "date", formatMinimum: "2020-01-01" },
    data: 5,
  },
];

interface AjvErrorsCase {
  name: string;
  schema: unknown;
  data: unknown;
  options?: Record<string, unknown>;
}

const AJV_ERRORS_CASES: AjvErrorsCase[] = [
  {
    name: "string-form",
    schema: {
      type: "object",
      required: ["foo"],
      properties: { foo: { type: "integer" } },
      additionalProperties: false,
      errorMessage: "should be an object with an integer property foo only",
    },
    data: { foo: "a", bar: 2 },
  },
  {
    name: "per-keyword",
    schema: {
      type: "object",
      required: ["foo"],
      properties: { foo: { type: "integer" } },
      additionalProperties: false,
      errorMessage: {
        type: "should be an object",
        required: "should have property foo",
        additionalProperties: "should not have properties other than foo",
      },
    },
    data: { foo: "a", bar: 2 },
  },
  {
    name: "per-property-required",
    schema: {
      type: "object",
      required: ["foo", "bar"],
      properties: { foo: { type: "integer" }, bar: { type: "string" } },
      errorMessage: {
        required: {
          foo: 'should have an integer property "foo"',
          bar: 'should have a string property "bar"',
        },
      },
    },
    data: {},
  },
  {
    name: "properties-map-through-allof",
    schema: {
      type: "object",
      required: ["foo", "bar"],
      allOf: [
        {
          properties: {
            foo: { type: "integer", minimum: 2 },
            bar: { type: "string", minLength: 2 },
          },
          additionalProperties: false,
        },
      ],
      errorMessage: {
        properties: {
          foo: "data.foo should be integer >= 2",
          bar: "data.bar should be string with length >= 2",
        },
      },
    },
    data: { foo: 1, bar: "a" },
  },
  {
    name: "default-catchall",
    schema: {
      type: "object",
      required: ["foo", "bar"],
      errorMessage: {
        type: "data should be an object",
        _: 'data should have properties "foo" and "bar" only',
      },
    },
    data: {},
  },
  {
    name: "items-repeat",
    schema: {
      type: "array",
      items: { type: "integer", errorMessage: "must be integer" },
    },
    data: ["x", "y", 5],
  },
  {
    name: "nested-errorMessage",
    schema: {
      type: "object",
      properties: {
        foo: { type: "integer", errorMessage: "foo must be integer" },
      },
      required: ["foo"],
      errorMessage: { required: "foo is required" },
    },
    data: { foo: "x" },
  },
  {
    name: "outer-covers-inner-replaced",
    schema: {
      type: "object",
      properties: {
        foo: { type: "integer", errorMessage: "foo must be integer" },
      },
      errorMessage: "outer bad",
    },
    data: { foo: "x" },
  },
  {
    name: "keepErrors",
    schema: { type: "string", errorMessage: "must be string" },
    data: 5,
    options: { keepErrors: true },
  },
  {
    name: "singleError-same-path",
    schema: {
      type: "string",
      minLength: 5,
      pattern: "^a",
      errorMessage: { minLength: "too short", pattern: "must start with a" },
    },
    data: "b",
    options: { singleError: true },
  },
  {
    name: "singleError-custom-sep",
    schema: {
      type: "string",
      minLength: 5,
      pattern: "^a",
      errorMessage: { minLength: "too short", pattern: "must start with a" },
    },
    data: "b",
    options: { singleError: " | " },
  },
  {
    name: "per-keyword-no-single",
    schema: {
      type: "string",
      minLength: 5,
      pattern: "^a",
      errorMessage: { minLength: "too short", pattern: "must start with a" },
    },
    data: "b",
  },
  {
    name: "template-pointer",
    schema: {
      type: "object",
      properties: { size: { type: "number", minimum: 4 } },
      errorMessage: {
        properties: {
          size: "size should be a number bigger or equal to 4, current value is ${/size}",
        },
      },
    },
    data: { size: 2 },
  },
  {
    name: "template-relative-pointer-propname",
    schema: {
      type: "object",
      properties: { size: { type: "number" } },
      additionalProperties: {
        not: true,
        errorMessage: "extra property is ${0#}",
      },
    },
    data: { extra: 1 },
  },
  {
    name: "prefixItems-nested",
    schema: {
      type: "array",
      prefixItems: [{ type: "object", properties: { x: { type: "integer" } } }],
      errorMessage: "bad prefix",
    },
    data: [{ x: "a" }],
  },
];

interface AjvKeywordsCase {
  name: string;
  names: string | string[];
  schema: unknown;
  data: unknown;
}

const AJV_KEYWORDS_CASES: AjvKeywordsCase[] = [
  {
    name: "typeof-pass",
    names: "typeof",
    schema: { typeof: "number" },
    data: 5,
  },
  {
    name: "typeof-fail",
    names: "typeof",
    schema: { typeof: "undefined" },
    data: null,
  },
  {
    name: "typeof-array",
    names: "typeof",
    schema: { typeof: ["undefined", "object"] },
    data: null,
  },
  {
    name: "instanceof-array-pass",
    names: "instanceof",
    schema: { instanceof: "Array" },
    data: [],
  },
  {
    name: "instanceof-fail",
    names: "instanceof",
    schema: { instanceof: "Array" },
    data: {},
  },
  {
    name: "uniqueItemProperties-dup",
    names: "uniqueItemProperties",
    schema: { type: "array", uniqueItemProperties: ["id"] },
    data: [{ id: 1 }, { id: 1 }],
  },
  {
    name: "uniqueItemProperties-both-missing",
    names: "uniqueItemProperties",
    schema: { uniqueItemProperties: ["id"] },
    data: [{ foo: 1 }, { bar: 2 }],
  },
  {
    name: "uniqueItemProperties-one-missing-pass",
    names: "uniqueItemProperties",
    schema: { uniqueItemProperties: ["id"] },
    data: [{ id: 1 }, { foo: 2 }],
  },
  {
    name: "prohibited-fail",
    names: "prohibited",
    schema: { type: "object", prohibited: ["foo", "bar"] },
    data: { foo: 1 },
  },
  {
    name: "prohibited-non-object-vacuous",
    names: "prohibited",
    schema: { prohibited: ["foo"] },
    data: "nope",
  },
];

const results: Record<string, unknown> = {};

// --- formats -----------------------------------------------------------
{
  const probe = new Ajv2020({ strict: false, logger: false });
  addFormats(probe);
  const names = Object.keys(
    (probe as unknown as { formats: Record<string, unknown> }).formats,
  ).sort();
  results["format-table"] = { names };
}

for (const c of FORMAT_PROBES) {
  if (c.name === "format-table") continue;
  const ajv = new Ajv2020({ logger: false });
  addFormats(ajv);
  const validate = ajv.compile({ format: c.format });
  results[c.name] = {
    format: c.format,
    values: c.values.map((v) => ({ value: v, valid: validate(v) })),
  };
}

for (const c of FORMAT_COMPARISON_CASES) {
  const ajv = new Ajv2020({ allErrors: true, logger: false });
  addFormats(ajv, { keywords: true });
  const validate = ajv.compile(c.schema);
  const valid = validate(c.data);
  results[c.name] = {
    schema: c.schema,
    data: c.data,
    valid,
    errors: JSON.parse(JSON.stringify(validate.errors ?? null)) as unknown,
  };
}

// --- ajv-errors ----------------------------------------------------------
for (const c of AJV_ERRORS_CASES) {
  const ajv = new Ajv2020({ allErrors: true, logger: false });
  ajvErrors(ajv, c.options);
  const validate = ajv.compile(c.schema);
  const valid = validate(c.data);
  results[c.name] = {
    schema: c.schema,
    data: c.data,
    options: c.options ?? {},
    valid,
    errors: JSON.parse(JSON.stringify(validate.errors ?? null)) as unknown,
  };
}

// --- ajv-keywords ----------------------------------------------------------
for (const c of AJV_KEYWORDS_CASES) {
  const ajv = new Ajv2020({ allErrors: true, logger: false, strict: false });
  ajvKeywords(ajv, c.names);
  const validate = ajv.compile(c.schema);
  const valid = validate(c.data);
  results[c.name] = {
    schema: c.schema,
    data: c.data,
    valid,
    errors: JSON.parse(JSON.stringify(validate.errors ?? null)) as unknown,
  };
}

const out = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "fixtures",
  "ajv-companions.json",
);
writeFileSync(out, JSON.stringify(results, null, 2) + "\n");
console.log(`captured ${String(Object.keys(results).length)} cases -> ${out}`);
