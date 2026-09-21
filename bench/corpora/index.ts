// Benchmark corpora shared by bench/harness.ts (the report-only harness
// against ajv and hyperjump) and bench/external/bench.ts (the external
// comparison). The vendored files live beside this module — provenance and
// licensing in README.md — and the payload and records corpora are
// generated here deterministically (seeded PRNG, no wall-clock, no
// third-party data). Anything that changes a corpus changes every
// benchmark that reads it, so the results files record which corpora ran.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { JsonValue } from "@json-schema-engine/core";

const HERE = dirname(fileURLToPath(import.meta.url));

const readJson = (name: string): JsonValue =>
  JSON.parse(readFileSync(join(HERE, name), "utf8")) as JsonValue;

// Deterministic payload instances: seeded PRNG, no wall-clock, no
// third-party data. Roughly a quarter are invalid in distinct ways so the
// hot path sees both verdict branches.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface GeneratedInstance {
  value: JsonValue;
  valid: boolean;
}

function generatePayloads(count: number): GeneratedInstance[] {
  const rand = mulberry32(0xbe5c0de);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;
  const uuid = (): string =>
    "xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx".replace(/x/g, () =>
      Math.floor(rand() * 16).toString(16),
    );
  const out: GeneratedInstance[] = [];
  for (let i = 0; i < count; i++) {
    const base: Record<string, JsonValue> = {
      id: uuid(),
      kind: pick(["order", "invoice", "shipment", "refund"]),
      createdAt: "2026-07-10T12:00:00Z",
      amount: Math.floor(rand() * 100000) / 100,
      currency: pick(["USD", "EUR", "JPY"]),
      tags: [`t${String(i)}`, "bench"],
      attributes: {
        status: pick(["pending", "settled", "failed", "cancelled"]),
        priority: 1 + Math.floor(rand() * 5),
        region: pick(["us-east", "eu-west"]),
      },
      lineItems: Array.from({ length: 1 + Math.floor(rand() * 4) }, () => ({
        sku: `SKU-${String(1000 + Math.floor(rand() * 9000))}`,
        quantity: 1 + Math.floor(rand() * 9),
        unitPrice: Math.floor(rand() * 10000) / 100,
        discount: Math.floor(rand() * 100) / 100,
      })),
    };
    const flavor = i % 4;
    if (flavor === 3) {
      const breakKind = i % 3;
      if (breakKind === 0)
        base.currency = "usd"; // pattern violation
      else if (breakKind === 1)
        delete base.attributes; // required violation
      else base.extra = true; // additionalProperties violation
      out.push({ value: base, valid: false });
    } else {
      out.push({ value: base, valid: true });
    }
  }
  return out;
}

// Wide-but-shallow record corpora: 150 typed properties applied through
// `items` to a large array, sharing this shape so records-uniform and
// records-sparse differ only in which fields each record actually
// carries. Hyperjump registers by `$id`, so each corpus needs its own —
// hence a function, not a shared literal.
function fieldType(p: number): "string" | "integer" | "boolean" {
  if (p % 3 === 0) return "string";
  if (p % 3 === 1) return "integer";
  return "boolean";
}

function fieldValue(p: number): JsonValue {
  const type = fieldType(p);
  if (type === "string") return `v${String(p)}`;
  if (type === "integer") return p;
  return p % 2 === 0;
}

function recordsSchema(id: string): JsonValue {
  const properties: Record<string, JsonValue> = {};
  for (let p = 0; p < 150; p++) {
    const property: Record<string, JsonValue> = { type: fieldType(p) };
    if (p % 4 === 0) property.title = `Field ${String(p)}`;
    properties[`f${String(p)}`] = property;
  }
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: id,
    type: "array",
    items: {
      type: "object",
      properties,
      required: ["f0"],
    },
  };
}

function coreRecord(): Record<string, JsonValue> {
  const record: Record<string, JsonValue> = {};
  for (let p = 0; p < 8; p++) record[`f${String(p)}`] = fieldValue(p);
  return record;
}

// Distinct field indices in [low, high], in selection order, so records
// differ in both field set and insertion order — the shape variety that
// defeats monomorphic property access.
function pickDistinct(
  rand: () => number,
  count: number,
  low: number,
  high: number,
): number[] {
  const chosen = new Set<number>();
  while (chosen.size < count) {
    chosen.add(low + Math.floor(rand() * (high - low + 1)));
  }
  return [...chosen];
}

// Records-corpus instances: 2000 records, valid and a tail-invalid variant
// (the last record's f1 becomes a string) so flag mode still walks the
// whole array before failing. Evaluation never mutates instances, so the
// invalid array shares every other record with the valid one.
function recordsInstances(
  build: (i: number) => Record<string, JsonValue>,
): GeneratedInstance[] {
  const records = Array.from({ length: 2000 }, (_, i) => build(i));
  const invalidRecords = records.slice();
  const last = invalidRecords.length - 1;
  invalidRecords[last] = { ...invalidRecords[last]!, f1: "not-an-integer" };
  return [
    { value: records, valid: true },
    { value: invalidRecords, valid: false },
  ];
}

// --- Corpora -----------------------------------------------------------

const oasSchema = readJson("oas-3.1-schema.json");
const oasDocument = readJson("openapi-document.json");
const oasInvalid = JSON.parse(JSON.stringify(oasDocument)) as Record<
  string,
  JsonValue
>;
oasInvalid.openapi = 4; // wrong type AND wrong pattern
const payloadSchema = readJson("api-payload-schema.json");
const payloads = generatePayloads(32);
const migrationSchema = readJson("migration-schema.json");
const migrationValid: JsonValue = {
  userId: 7,
  email: "user@example.com",
  displayName: "Bench User",
  roles: ["admin", "viewer"],
  settings: { theme: "dark", notifications: true, locale: "en-US" },
  createdAt: "2026-07-10T12:00:00Z",
};
const migrationInvalid: JsonValue = {
  userId: 0,
  email: "user@example.com",
  roles: [],
};

// Many applications with modest annotations is the shape where
// per-application trace and annotation-unit allocation shows up; the
// sparse variant's differing record shapes exercise property access that
// is monomorphic (one hidden class) in the uniform variant.
const recordsUniformUri = "https://bench.example/records-uniform";
const recordsUniformSchema = recordsSchema(recordsUniformUri);
const recordsUniformInstances = recordsInstances(() => coreRecord());

const recordsSparseUri = "https://bench.example/records-sparse";
const recordsSparseSchema = recordsSchema(recordsSparseUri);
const sparseRand = mulberry32(0x5eed5);
const recordsSparseInstances = recordsInstances((i) => {
  const record = coreRecord();
  for (const p of pickDistinct(sparseRand, i % 4, 8, 149)) {
    record[`f${String(p)}`] = fieldValue(p);
  }
  return record;
});

export interface Corpus {
  name: string;
  schema: JsonValue;
  uri: string;
  dialectHint: "2020-12" | "draft-07";
  instances: GeneratedInstance[];
  /** Subject exclusion with the recorded reason (surfaced in results). */
  ajvExcluded?: string;
  /** Generated by this module rather than vendored as a file beside it. */
  generated?: true;
}

export const corpora: Corpus[] = [
  {
    name: "oas-document",
    schema: oasSchema,
    uri: "https://spec.openapis.org/oas/3.1/schema/2025-09-15",
    dialectHint: "2020-12",
    instances: [
      { value: oasDocument, valid: true },
      { value: oasInvalid, valid: false },
    ],
    ajvExcluded:
      "rejects the valid document: known 2020-12 non-compliance " +
      "($dynamicRef + unevaluatedProperties; jse and hyperjump agree it is valid)",
  },
  {
    name: "api-payload",
    schema: payloadSchema,
    uri: "https://bench.example/api-payload",
    dialectHint: "2020-12",
    instances: payloads,
  },
  {
    name: "migration",
    schema: migrationSchema,
    uri: "https://bench.example/migration",
    dialectHint: "draft-07",
    instances: [
      { value: migrationValid, valid: true },
      { value: migrationInvalid, valid: false },
    ],
  },
  {
    name: "records-uniform",
    schema: recordsUniformSchema,
    uri: recordsUniformUri,
    dialectHint: "2020-12",
    instances: recordsUniformInstances,
    generated: true,
  },
  {
    name: "records-sparse",
    schema: recordsSparseSchema,
    uri: recordsSparseUri,
    dialectHint: "2020-12",
    instances: recordsSparseInstances,
    generated: true,
  },
];
