// Mutation-trio oracle (M8.3, D15): AJV EXECUTED — never read — to pin
// coerceTypes/useDefaults/removeAdditional behavior the docs leave open:
// top-level coercion visibility, tuple-item defaults, insertion identity,
// removeAdditional "all" without properties, and the exact post-validation
// data. Output: test/fixtures/ajv-mutation.json.
//
// Re-run after an AJV devDependency bump:
//   npx tsx packages/ajv-compat/test/oracle/capture-mutation.ts

import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import AjvImport from "ajv";
import Ajv2020Import from "ajv/dist/2020.js";

type AjvCtor = new (options?: Record<string, unknown>) => {
  compile(schema: unknown): ((data: unknown) => boolean) & {
    errors?: unknown[] | null;
  };
};
const unwrap = <T>(m: T): T =>
  (m as { default?: T }).default !== undefined
    ? (m as { default: T }).default
    : m;
const Ajv = unwrap(AjvImport) as unknown as AjvCtor;
const Ajv2020 = unwrap(Ajv2020Import) as unknown as AjvCtor;

interface OracleCase {
  name: string;
  dialect?: "draft-07" | "2020-12";
  options: Record<string, unknown>;
  schema: unknown;
  data: unknown;
}

const CASES: OracleCase[] = [
  // ---- coerceTypes -------------------------------------------------------
  {
    name: "coerce-top-level-scalar",
    options: { coerceTypes: true },
    schema: { type: "number" },
    data: "1",
  },
  {
    name: "coerce-nested-string-to-number",
    options: { coerceTypes: true },
    schema: { type: "object", properties: { n: { type: "number" } } },
    data: { n: "2.5" },
  },
  {
    name: "coerce-string-to-boolean",
    options: { coerceTypes: true },
    schema: { type: "object", properties: { b: { type: "boolean" } } },
    data: { b: "true" },
  },
  {
    name: "coerce-string-false-to-boolean",
    options: { coerceTypes: true },
    schema: { type: "object", properties: { b: { type: "boolean" } } },
    data: { b: "false" },
  },
  {
    name: "coerce-empty-string-to-null",
    options: { coerceTypes: true },
    schema: { type: "object", properties: { x: { type: "null" } } },
    data: { x: "" },
  },
  {
    name: "coerce-number-to-string",
    options: { coerceTypes: true },
    schema: { type: "object", properties: { s: { type: "string" } } },
    data: { s: 7 },
  },
  {
    name: "coerce-zero-to-boolean",
    options: { coerceTypes: true },
    schema: { type: "object", properties: { b: { type: "boolean" } } },
    data: { b: 0 },
  },
  {
    name: "coerce-null-to-number",
    options: { coerceTypes: true },
    schema: { type: "object", properties: { n: { type: "number" } } },
    data: { n: null },
  },
  {
    name: "coerce-impossible",
    options: { coerceTypes: true },
    schema: { type: "object", properties: { n: { type: "number" } } },
    data: { n: "abc" },
  },
  {
    name: "coerce-integer-rejects-fraction-string",
    options: { coerceTypes: true },
    schema: { type: "object", properties: { i: { type: "integer" } } },
    data: { i: "2.5" },
  },
  {
    name: "coerce-array-wrap",
    options: { coerceTypes: "array" },
    schema: {
      type: "object",
      properties: { a: { type: "array", items: { type: "number" } } },
    },
    data: { a: 3 },
  },
  {
    name: "coerce-array-unwrap",
    options: { coerceTypes: "array" },
    schema: { type: "object", properties: { s: { type: "string" } } },
    data: { s: ["only"] },
  },
  {
    name: "coerce-array-wrap-coerces-items",
    options: { coerceTypes: "array" },
    schema: {
      type: "object",
      properties: { a: { type: "array", items: { type: "number" } } },
    },
    data: { a: "4" },
  },
  {
    name: "coerce-union-order",
    options: { coerceTypes: true, allowUnionTypes: true },
    schema: {
      type: "object",
      properties: { v: { type: ["boolean", "number"] } },
    },
    data: { v: "1" },
  },
  {
    name: "coerce-in-array-items",
    options: { coerceTypes: true },
    schema: { type: "array", items: { type: "integer" } },
    data: ["1", "2", "x"],
  },
  {
    name: "no-coerce-when-type-matches",
    options: { coerceTypes: true },
    schema: { type: "object", properties: { n: { type: "number" } } },
    data: { n: 5 },
  },
  // ---- useDefaults -------------------------------------------------------
  {
    name: "defaults-insert-missing",
    options: { useDefaults: true },
    schema: {
      type: "object",
      properties: {
        a: { type: "string", default: "A" },
        b: { type: "number" },
      },
    },
    data: { b: 1 },
  },
  {
    name: "defaults-keep-present",
    options: { useDefaults: true },
    schema: {
      type: "object",
      properties: { a: { type: "string", default: "A" } },
    },
    data: { a: "keep" },
  },
  {
    name: "defaults-empty-mode",
    options: { useDefaults: "empty" },
    schema: {
      type: "object",
      properties: {
        a: { type: "string", default: "A" },
        b: { type: "string", default: "B" },
      },
    },
    data: { a: null, b: "" },
  },
  {
    name: "defaults-object-value-identity",
    options: { useDefaults: true },
    schema: {
      type: "object",
      properties: { o: { type: "object", default: { seed: [] } } },
    },
    data: {},
  },
  {
    name: "defaults-tuple-items-draft7",
    dialect: "draft-07",
    options: { useDefaults: true },
    schema: {
      type: "array",
      items: [
        { type: "number", default: 1 },
        { type: "number", default: 2 },
      ],
    },
    data: [],
  },
  {
    name: "defaults-nested-after-parent-default",
    options: { useDefaults: true },
    schema: {
      type: "object",
      properties: {
        o: {
          type: "object",
          default: {},
          properties: { x: { type: "number", default: 9 } },
        },
      },
    },
    data: {},
  },
  {
    name: "defaults-inside-allOf",
    options: { useDefaults: true },
    schema: {
      type: "object",
      allOf: [{ properties: { a: { type: "number", default: 3 } } }],
    },
    data: {},
  },
  // ---- removeAdditional ----------------------------------------------------
  {
    name: "remove-true-ap-false",
    options: { removeAdditional: true },
    schema: {
      type: "object",
      properties: { keep: {} },
      additionalProperties: false,
    },
    data: { keep: 1, extra: 2 },
  },
  {
    name: "remove-true-ap-schema-keeps",
    options: { removeAdditional: true },
    schema: {
      type: "object",
      properties: { keep: {} },
      additionalProperties: { type: "number" },
    },
    data: { keep: 1, bad: "str" },
  },
  {
    name: "remove-true-no-ap-keeps",
    options: { removeAdditional: true },
    schema: { type: "object", properties: { keep: {} } },
    data: { keep: 1, extra: 2 },
  },
  {
    name: "remove-all-without-ap",
    options: { removeAdditional: "all" },
    schema: { type: "object", properties: { keep: {} } },
    data: { keep: 1, extra: 2 },
  },
  {
    name: "remove-all-bare-object-schema",
    options: { removeAdditional: "all" },
    schema: { type: "object" },
    data: { a: 1 },
  },
  {
    name: "remove-all-pattern-properties",
    options: { removeAdditional: "all" },
    schema: {
      type: "object",
      properties: { keep: {} },
      patternProperties: { "^x-": {} },
    },
    data: { keep: 1, "x-ok": 2, drop: 3 },
  },
  {
    name: "remove-failing",
    options: { removeAdditional: "failing" },
    schema: {
      type: "object",
      properties: { keep: {} },
      additionalProperties: { type: "number" },
    },
    data: { keep: 1, ok: 2, bad: "str" },
  },
  {
    name: "remove-failing-ap-false",
    options: { removeAdditional: "failing" },
    schema: {
      type: "object",
      properties: { keep: {} },
      additionalProperties: false,
    },
    data: { keep: 1, extra: 2 },
  },
  // ---- fastify default configuration ----------------------------------------
  {
    name: "fastify-default-config",
    options: {
      coerceTypes: "array",
      useDefaults: true,
      removeAdditional: true,
      allErrors: false,
      addUsedSchema: false,
    },
    schema: {
      type: "object",
      required: ["id"],
      additionalProperties: false,
      properties: {
        id: { type: "integer" },
        tags: { type: "array", items: { type: "string" } },
        page: { type: "integer", default: 1 },
      },
    },
    data: { id: "42", tags: "solo", junk: true },
  },
  {
    name: "fastify-config-invalid-after-mutation",
    options: {
      coerceTypes: "array",
      useDefaults: true,
      removeAdditional: true,
      allErrors: false,
    },
    schema: {
      type: "object",
      required: ["id"],
      properties: { id: { type: "integer" } },
    },
    data: { id: "not-a-number" },
  },
];

const results: Record<string, unknown> = {};
for (const c of CASES) {
  const ajv =
    c.dialect === "draft-07" ? new Ajv(c.options) : new Ajv2020(c.options);
  try {
    const validate = ajv.compile(c.schema);
    // Deep-copy so the fixture keeps the ORIGINAL data alongside the
    // mutated result.
    const working = JSON.parse(JSON.stringify(c.data)) as unknown;
    const valid = validate(working);
    const entry: Record<string, unknown> = {
      dialect: c.dialect ?? "2020-12",
      options: c.options,
      schema: c.schema,
      data: c.data,
      valid,
      dataAfter: working,
      errors: JSON.parse(JSON.stringify(validate.errors ?? null)) as unknown,
    };
    if (c.name === "defaults-object-value-identity") {
      // Insertion identity: does a second validation share the first's
      // inserted object (mutating one mutates the "default")?
      const second: Record<string, unknown> = {};
      validate(second);
      ((working as Record<string, unknown>).o as { seed: unknown[] }).seed.push(
        "polluted",
      );
      entry.secondInsertSeesMutation =
        (second.o as { seed: unknown[] }).seed.length > 0;
    }
    results[c.name] = entry;
  } catch (err) {
    results[c.name] = { compileError: String(err) };
  }
}

const out = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "fixtures",
  "ajv-mutation.json",
);
writeFileSync(out, JSON.stringify(results, null, 2) + "\n");
console.log(`captured ${String(Object.keys(results).length)} cases -> ${out}`);
