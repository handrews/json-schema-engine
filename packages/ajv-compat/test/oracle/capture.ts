// Oracle capture (M8.2, D15): AJV is EXECUTED here — never read — to pin
// the parts of its public behavior its docs leave out: params shapes for
// undocumented keywords, default message texts, and schemaPath rendering
// across $ref. Output: test/fixtures/ajv-oracle.json, committed so the
// mapping tests run without invoking AJV.
//
// Re-run after an AJV devDependency bump:
//   npx tsx packages/ajv-compat/test/oracle/capture.ts

import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import AjvImport from "ajv";
import Ajv2020Import from "ajv/dist/2020.js";
import addFormatsImport from "ajv-formats";

// AJV ships CJS with a `default` export; under NodeNext the namespace and
// the class need untangling at runtime (tsx) AND in types.
type AjvCtor = new (options?: Record<string, unknown>) => {
  compile(schema: unknown): ((data: unknown) => boolean) & {
    errors?: unknown[] | null;
  };
  errorsText(errors?: unknown[] | null): string;
};
const unwrap = <T>(m: T): T =>
  (m as { default?: T }).default !== undefined
    ? (m as { default: T }).default
    : m;
const Ajv = unwrap(AjvImport) as unknown as AjvCtor;
const Ajv2020 = unwrap(Ajv2020Import) as unknown as AjvCtor;
const addFormats = unwrap(addFormatsImport) as unknown as (
  ajv: unknown,
  opts?: Record<string, unknown>,
) => void;

interface OracleCase {
  name: string;
  dialect: "draft-07" | "2020-12";
  options?: Record<string, unknown>;
  formats?: boolean;
  schema: unknown;
  data: unknown;
}

const CASES: OracleCase[] = [
  {
    name: "type-single",
    dialect: "2020-12",
    schema: { type: "string" },
    data: 42,
  },
  {
    name: "type-union",
    dialect: "2020-12",
    options: { allowUnionTypes: true },
    schema: { type: ["string", "null"] },
    data: 42,
  },
  { name: "enum", dialect: "2020-12", schema: { enum: [1, "a"] }, data: 2 },
  { name: "const", dialect: "2020-12", schema: { const: { x: 1 } }, data: 2 },
  {
    name: "required",
    dialect: "2020-12",
    schema: { type: "object", required: ["a", "b"] },
    data: { b: 1 },
  },
  {
    name: "required-multi-allErrors",
    dialect: "2020-12",
    options: { allErrors: true },
    schema: { type: "object", required: ["a", "b", "c"] },
    data: {},
  },
  {
    name: "additionalProperties",
    dialect: "2020-12",
    schema: {
      type: "object",
      properties: { a: {} },
      additionalProperties: false,
    },
    data: { a: 1, extra: 2 },
  },
  {
    name: "nested-instancePath",
    dialect: "2020-12",
    schema: {
      type: "object",
      properties: { list: { type: "array", items: { type: "integer" } } },
    },
    data: { list: [1, "x"] },
  },
  {
    name: "minLength",
    dialect: "2020-12",
    schema: { type: "string", minLength: 3 },
    data: "ab",
  },
  {
    name: "maxLength",
    dialect: "2020-12",
    schema: { type: "string", maxLength: 1 },
    data: "ab",
  },
  {
    name: "minItems",
    dialect: "2020-12",
    schema: { type: "array", minItems: 2 },
    data: [1],
  },
  {
    name: "maxItems",
    dialect: "2020-12",
    schema: { type: "array", maxItems: 1 },
    data: [1, 2],
  },
  {
    name: "minProperties",
    dialect: "2020-12",
    schema: { type: "object", minProperties: 2 },
    data: { a: 1 },
  },
  {
    name: "maxProperties",
    dialect: "2020-12",
    schema: { type: "object", maxProperties: 1 },
    data: { a: 1, b: 2 },
  },
  {
    name: "minimum",
    dialect: "2020-12",
    schema: { type: "number", minimum: 3 },
    data: 2,
  },
  {
    name: "maximum",
    dialect: "2020-12",
    schema: { type: "number", maximum: 1 },
    data: 2,
  },
  {
    name: "exclusiveMinimum",
    dialect: "2020-12",
    schema: { type: "number", exclusiveMinimum: 2 },
    data: 2,
  },
  {
    name: "exclusiveMaximum",
    dialect: "2020-12",
    schema: { type: "number", exclusiveMaximum: 2 },
    data: 2,
  },
  {
    name: "multipleOf",
    dialect: "2020-12",
    schema: { type: "number", multipleOf: 3 },
    data: 4,
  },
  {
    name: "pattern",
    dialect: "2020-12",
    schema: { type: "string", pattern: "^a" },
    data: "b",
  },
  {
    name: "uniqueItems",
    dialect: "2020-12",
    schema: { type: "array", uniqueItems: true },
    data: [1, 2, 1],
  },
  {
    name: "contains-min",
    dialect: "2020-12",
    schema: { type: "array", contains: { type: "string" }, minContains: 2 },
    data: ["a", 1],
  },
  {
    name: "contains-max",
    dialect: "2020-12",
    schema: { type: "array", contains: { type: "string" }, maxContains: 1 },
    data: ["a", "b"],
  },
  {
    name: "oneOf-two-matches",
    dialect: "2020-12",
    schema: { oneOf: [{ type: "integer" }, { minimum: 0 }] },
    data: 3,
  },
  {
    name: "oneOf-no-match",
    dialect: "2020-12",
    options: { allErrors: true },
    schema: { oneOf: [{ type: "string" }, { type: "boolean" }] },
    data: 3,
  },
  {
    name: "anyOf-no-match",
    dialect: "2020-12",
    options: { allErrors: true },
    schema: { anyOf: [{ type: "string" }] },
    data: 3,
  },
  {
    name: "not",
    dialect: "2020-12",
    schema: { not: { type: "integer" } },
    data: 3,
  },
  {
    name: "if-then",
    dialect: "2020-12",
    options: { allErrors: true },
    schema: { if: { type: "integer" }, then: { minimum: 10 } },
    data: 3,
  },
  {
    name: "propertyNames",
    dialect: "2020-12",
    schema: { type: "object", propertyNames: { maxLength: 2 } },
    data: { long: 1 },
  },
  {
    name: "dependentRequired",
    dialect: "2020-12",
    schema: { type: "object", dependentRequired: { a: ["b"] } },
    data: { a: 1 },
  },
  {
    name: "dependencies-draft7",
    dialect: "draft-07",
    schema: { type: "object", dependencies: { a: ["b"] } },
    data: { a: 1 },
  },
  {
    name: "unevaluatedProperties",
    dialect: "2020-12",
    schema: {
      type: "object",
      properties: { a: {} },
      unevaluatedProperties: false,
    },
    data: { a: 1, extra: 2 },
  },
  {
    name: "unevaluatedItems",
    dialect: "2020-12",
    schema: { type: "array", prefixItems: [{}], unevaluatedItems: false },
    data: [1, 2],
  },
  {
    name: "items-2020",
    dialect: "2020-12",
    schema: { type: "array", items: { type: "string" } },
    data: [1],
  },
  {
    name: "prefixItems",
    dialect: "2020-12",
    schema: { type: "array", prefixItems: [{ type: "string" }] },
    data: [1],
  },
  {
    name: "additionalItems-draft7",
    dialect: "draft-07",
    schema: { type: "array", items: [{}], additionalItems: false },
    data: [1, 2],
  },
  {
    name: "format",
    dialect: "2020-12",
    formats: true,
    schema: { type: "string", format: "ipv4" },
    data: "x",
  },
  {
    name: "format-comparison",
    dialect: "2020-12",
    formats: true,
    schema: { type: "string", format: "date", formatMinimum: "2020-01-01" },
    data: "2019-01-01",
  },
  {
    name: "ref-local",
    dialect: "2020-12",
    schema: {
      $defs: { positive: { type: "number", minimum: 0 } },
      $ref: "#/$defs/positive",
    },
    data: -1,
  },
  {
    name: "ref-external-id",
    dialect: "2020-12",
    options: {
      schemas: [
        { $id: "https://oracle.example/pos", type: "number", minimum: 0 },
      ],
    },
    schema: { $ref: "https://oracle.example/pos" },
    data: -1,
  },
  {
    name: "discriminator",
    dialect: "2020-12",
    options: { discriminator: true },
    schema: {
      type: "object",
      discriminator: { propertyName: "kind" },
      required: ["kind"],
      oneOf: [
        { properties: { kind: { const: "a" }, x: { type: "number" } } },
        { properties: { kind: { const: "b" } } },
      ],
    },
    data: { kind: "c" },
  },
  {
    name: "verbose-fields",
    dialect: "2020-12",
    options: { verbose: true },
    schema: { type: "object", properties: { a: { type: "string" } } },
    data: { a: 1 },
  },
  {
    name: "false-schema",
    dialect: "2020-12",
    schema: { type: "object", properties: { a: false } },
    data: { a: 1 },
  },
  {
    name: "dependentRequired-two-deps",
    dialect: "2020-12",
    schema: { type: "object", dependentRequired: { a: ["b", "c"] } },
    data: { a: 1 },
  },
  {
    name: "anyOf-pass-sibling-fail",
    dialect: "2020-12",
    options: { allErrors: true },
    schema: {
      type: "object",
      anyOf: [{ required: ["x"] }, { required: ["y"] }],
      required: ["z"],
    },
    data: { y: 1 },
  },
];

const results: Record<string, unknown> = {};
for (const c of CASES) {
  const options = { ...(c.options ?? {}) };
  const ajv = c.dialect === "2020-12" ? new Ajv2020(options) : new Ajv(options);
  if (c.formats) addFormats(ajv, { keywords: true });
  try {
    const validate = ajv.compile(c.schema);
    const valid = validate(c.data);
    results[c.name] = {
      dialect: c.dialect,
      options: c.options ?? {},
      schema: c.schema,
      data: c.data,
      valid,
      // verbose adds schema/parentSchema/data object references; JSON
      // round-trip keeps the capture plain.
      errors: JSON.parse(JSON.stringify(validate.errors ?? null)) as unknown,
      errorsText: valid ? null : ajv.errorsText(validate.errors),
    };
  } catch (err) {
    results[c.name] = { compileError: String(err) };
  }
}

const out = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "fixtures",
  "ajv-oracle.json",
);
writeFileSync(out, JSON.stringify(results, null, 2) + "\n");
console.log(`captured ${String(Object.keys(results).length)} cases -> ${out}`);
