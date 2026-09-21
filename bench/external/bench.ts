// External comparison benchmark: jse vs ata-validator vs json-schema-library,
// with ajv and @hyperjump/json-schema as reference points, on the same
// corpora as bench/harness.ts (the vendored files under bench/corpora plus
// the two generated records corpora — the generators are duplicated here
// verbatim because harness.ts runs its benchmark on import).
//
// Rules, as in harness.ts: format assertion off in every subject, defaults
// and coercion off, every subject must reproduce every expected verdict
// before it is timed (a subject that disagrees is excluded for that corpus
// and the reason recorded), instances round-robin, tinybench floors pinned.
//
// Two subject-specific notes:
// - ata-validator builds a failure result's `errors` lazily; the `validate`
//   rows time the verdict only and the `validate+errors` rows read
//   `errors.length` so error construction is inside the timing.
// - json-schema-library's compileSchema is lazy ($ref resolves on first use),
//   which its compile+first row reflects.
//
// Run: npm run compare:bench   (BENCH_BUDGET=<ms per task>, default 250)
// Writes bench/external/results/bench.json.

import { Bench } from "tinybench";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import AjvMod from "ajv";
import Ajv2020Mod from "ajv/dist/2020.js";
import {
  registerSchema as hjRegister,
  validate as hjValidate,
} from "@hyperjump/json-schema/draft-2020-12";
import "@hyperjump/json-schema/draft-07";
import { createEngine, type JsonValue } from "@json-schema-engine/core";
import { compileList, compileValidator } from "@json-schema-engine/compiler";
import {
  Validator as AtaValidator,
  type ValidatorOptions as AtaOptions,
} from "ata-validator";
import { compileSchema, type JsonSchema } from "json-schema-library";

// CJS interop, as in harness.ts.
// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
const Ajv2020 = Ajv2020Mod.default ?? Ajv2020Mod;
// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
const Ajv = AjvMod.default ?? AjvMod;

// `toOutput` (ata-validator's spec-output renderer) is exported from the
// CommonJS entry only — not from index.mjs and not from index.d.ts.
interface AtaOutputDocument {
  valid: boolean;
}
type AtaToOutput = (
  validator: AtaValidator,
  data: unknown,
  options: { format: "flag" | "basic" },
) => AtaOutputDocument;
const cjsRequire = createRequire(import.meta.url);
const { toOutput: ataToOutput } = cjsRequire("ata-validator") as {
  toOutput: AtaToOutput;
};

const AJV_OPTIONS = {
  validateFormats: false,
  strict: false,
  logger: false as const,
};
const ATA_OPTIONS = { assertFormat: false, useDefaults: false };
const JSL_OPTIONS = { formatAssertion: false };

const HERE = dirname(fileURLToPath(import.meta.url));
const CORPORA = join(HERE, "..", "corpora");
const RESULTS = join(HERE, "results");
const BUDGET_MS = Number(process.env.BENCH_BUDGET ?? "250");

const readJson = (name: string): JsonValue =>
  JSON.parse(readFileSync(join(CORPORA, name), "utf8")) as JsonValue;

// --- Corpora (copied from bench/harness.ts) --------------------------------

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

interface GeneratedInstance {
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
    if (i % 4 === 3) {
      const breakKind = i % 3;
      if (breakKind === 0) base.currency = "usd";
      else if (breakKind === 1) delete base.attributes;
      else base.extra = true;
      out.push({ value: base, valid: false });
    } else {
      out.push({ value: base, valid: true });
    }
  }
  return out;
}

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
    items: { type: "object", properties, required: ["f0"] },
  };
}

function coreRecord(): Record<string, JsonValue> {
  const record: Record<string, JsonValue> = {};
  for (let p = 0; p < 8; p++) record[`f${String(p)}`] = fieldValue(p);
  return record;
}

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

const oasSchema = readJson("oas-3.1-schema.json");
const oasDocument = readJson("openapi-document.json");
const oasInvalid = JSON.parse(JSON.stringify(oasDocument)) as Record<
  string,
  JsonValue
>;
oasInvalid.openapi = 4;
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
const recordsUniformUri = "https://bench.example/records-uniform";
const recordsSparseUri = "https://bench.example/records-sparse";
const sparseRand = mulberry32(0x5eed5);

interface Corpus {
  name: string;
  schema: JsonValue;
  uri: string;
  dialectHint: "2020-12" | "draft-07";
  instances: GeneratedInstance[];
}

const corpora: Corpus[] = [
  {
    name: "oas-document",
    schema: oasSchema,
    uri: "https://spec.openapis.org/oas/3.1/schema/2025-09-15",
    dialectHint: "2020-12",
    instances: [
      { value: oasDocument, valid: true },
      { value: oasInvalid, valid: false },
    ],
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
    schema: recordsSchema(recordsUniformUri),
    uri: recordsUniformUri,
    dialectHint: "2020-12",
    instances: recordsInstances(() => coreRecord()),
  },
  {
    name: "records-sparse",
    schema: recordsSchema(recordsSparseUri),
    uri: recordsSparseUri,
    dialectHint: "2020-12",
    instances: recordsInstances((i) => {
      const record = coreRecord();
      for (const p of pickDistinct(sparseRand, i % 4, 8, 149)) {
        record[`f${String(p)}`] = fieldValue(p);
      }
      return record;
    }),
  },
];

// --- Subjects --------------------------------------------------------------

interface Subject {
  name: string;
  /** Timed as-is. */
  run: (x: JsonValue) => unknown;
  /** What the oracle compares. */
  verdict: (x: JsonValue) => boolean;
}

// Reads a lazily built errors array so its construction is timed.
const touchErrors = (r: { valid: boolean; errors: unknown[] }): number =>
  r.valid ? 0 : r.errors.length;

const jslSchema = (schema: JsonValue): JsonSchema =>
  schema as unknown as JsonSchema;

const newAjv = (corpus: Corpus, options: object) =>
  corpus.dialectHint === "2020-12"
    ? new Ajv2020({ ...AJV_OPTIONS, ...options })
    : new Ajv({ ...AJV_OPTIONS, ...options });

async function subjectsFor(corpus: Corpus): Promise<Subject[]> {
  const engine = createEngine();
  const uri = engine.registerSchema(corpus.schema, corpus.uri);
  const flag = compileValidator(engine, uri);
  const list = compileList(engine, uri, { errorParams: false });
  const listAnn = compileList(engine, uri, {
    errorParams: false,
    annotations: true,
  });
  const subjects: Subject[] = [
    {
      name: "jse compiled flag",
      run: (x) => flag.validate(x),
      verdict: (x) => flag.validate(x),
    },
    {
      name: "jse compiled list",
      run: (x) => list.evaluateList(x),
      verdict: (x) => list.evaluateList(x).valid,
    },
    {
      name: "jse compiled basic+annotations",
      run: (x) => listAnn.basic(x),
      verdict: (x) => listAnn.basic(x).valid,
    },
    {
      name: "jse interpreter flag",
      run: (x) => engine.evaluate(uri, x),
      verdict: (x) => engine.evaluate(uri, x).valid,
    },
    {
      name: "jse interpreter list",
      run: (x) => engine.evaluate(uri, x, { output: "list" }),
      verdict: (x) => engine.evaluate(uri, x, { output: "list" }).valid,
    },
    {
      name: "jse interpreter list+annotations",
      run: (x) =>
        engine.evaluate(uri, x, { output: "list", annotations: true }),
      verdict: (x) =>
        engine.evaluate(uri, x, { output: "list", annotations: true }).valid,
    },
    {
      name: "jse interpreter basic+annotations",
      run: (x) =>
        engine.evaluate(uri, x, { output: "basic", annotations: true }),
      verdict: (x) =>
        engine.evaluate(uri, x, { output: "basic", annotations: true }).valid,
    },
  ];

  try {
    const ajvValidate = newAjv(corpus, {}).compile(corpus.schema as never);
    subjects.push({
      name: "ajv",
      run: (x) => ajvValidate(x),
      verdict: (x) => ajvValidate(x),
    });
    const ajvAll = newAjv(corpus, { allErrors: true }).compile(
      corpus.schema as never,
    );
    subjects.push({
      name: "ajv allErrors",
      run: (x) => ajvAll(x),
      verdict: (x) => ajvAll(x),
    });
  } catch (e) {
    console.log(
      `note: ${corpus.name}: ajv failed to compile: ${(e as Error).message}`,
    );
  }

  // ata-validator: `engine()` reports which of its engines answered.
  const ata = new AtaValidator(corpus.schema as never, ATA_OPTIONS);
  const tag = `[${ata.engine()}]`;
  subjects.push(
    {
      name: `ata validate ${tag}`,
      run: (x) => ata.validate(x),
      verdict: (x) => ata.validate(x).valid,
    },
    {
      name: `ata validate+errors ${tag}`,
      run: (x) => touchErrors(ata.validate(x)),
      verdict: (x) => ata.validate(x).valid,
    },
    {
      name: `ata toOutput basic ${tag}`,
      run: (x) => ataToOutput(ata, x, { format: "basic" }),
      verdict: (x) => ataToOutput(ata, x, { format: "basic" }).valid,
    },
    {
      name: `ata isValidObject ${tag}`,
      run: (x) => ata.isValidObject(x),
      verdict: (x) => ata.isValidObject(x),
    },
  );
  const ataEarly = new AtaValidator(corpus.schema as never, {
    ...ATA_OPTIONS,
    abortEarly: true,
  });
  subjects.push({
    name: `ata validate abortEarly [${ataEarly.engine()}]`,
    run: (x) => ataEarly.validate(x),
    verdict: (x) => ataEarly.validate(x).valid,
  });
  // `engine: "interpreter"` is documented and honored at runtime but is not
  // declared in ata-validator 1.27.1's published typings.
  const ataInterp = new AtaValidator(
    corpus.schema as never,
    {
      ...ATA_OPTIONS,
      engine: "interpreter",
    } as AtaOptions,
  );
  subjects.push({
    name: `ata validate [${ataInterp.engine()} forced]`,
    run: (x) => ataInterp.validate(x),
    verdict: (x) => ataInterp.validate(x).valid,
  });

  const node = compileSchema(jslSchema(corpus.schema), JSL_OPTIONS);
  subjects.push({
    name: "jsl validate",
    run: (x) => node.validate(x),
    verdict: (x) => node.validate(x).valid,
  });

  // Hyperjump: hot path only (global registry; see harness.ts).
  if (corpus.dialectHint === "2020-12") {
    hjRegister(corpus.schema as never);
    const hj = await hjValidate(corpus.uri);
    subjects.push({
      name: "hyperjump",
      run: (x) => hj(x),
      verdict: (x) => hj(x).valid,
    });
  }
  return subjects;
}

// --- Oracle, then timing ---------------------------------------------------

const MIN_SAMPLES = 5;
const bench = new Bench({
  time: BUDGET_MS,
  iterations: MIN_SAMPLES,
  warmupIterations: 2,
});

type Partition = "hot" | "valid" | "invalid" | "compile+first";

interface TaskMeta {
  corpus: string;
  partition: Partition;
  subject: string;
}

const taskMeta = new Map<string, TaskMeta>();
const exclusions: { corpus: string; subject: string; reason: string }[] = [];

function addTask(
  corpus: string,
  partition: Partition,
  subject: string,
  fn: () => unknown,
): void {
  const task = `${corpus} | ${partition} | ${subject}`;
  taskMeta.set(task, { corpus, partition, subject });
  bench.add(task, () => {
    fn();
  });
}

const roundRobin = (
  xs: readonly JsonValue[],
  run: (x: JsonValue) => unknown,
): (() => void) => {
  let i = 0;
  return () => {
    run(xs[i++ % xs.length]!);
  };
};

for (const corpus of corpora) {
  const subjects = await subjectsFor(corpus);
  const all = corpus.instances.map((x) => x.value);
  const valid = corpus.instances.filter((x) => x.valid).map((x) => x.value);
  const invalid = corpus.instances.filter((x) => !x.valid).map((x) => x.value);
  for (const s of subjects) {
    let bad: string | null = null;
    for (const [i, inst] of corpus.instances.entries()) {
      try {
        const got = s.verdict(inst.value);
        if (got !== inst.valid) {
          bad = `instance #${String(i)}: said ${String(got)}, expected ${String(inst.valid)}`;
        }
      } catch (e) {
        bad = `instance #${String(i)}: threw ${(e as Error).message.slice(0, 120)}`;
      }
      if (bad !== null) break;
    }
    if (bad !== null) {
      exclusions.push({ corpus: corpus.name, subject: s.name, reason: bad });
      console.log(`EXCLUDED ${corpus.name} / ${s.name}: ${bad}`);
      continue;
    }
    addTask(corpus.name, "hot", s.name, roundRobin(all, s.run));
    addTask(corpus.name, "valid", s.name, roundRobin(valid, s.run));
    addTask(corpus.name, "invalid", s.name, roundRobin(invalid, s.run));
  }

  // Compile + first validation, fresh per iteration. A unique $comment
  // defeats any schema-content compile cache so every subject really
  // compiles each time.
  const first = corpus.instances[0]!.value;
  let n = 0;
  const fresh = (): JsonValue => ({
    ...(corpus.schema as Record<string, JsonValue>),
    $comment: `b${String(n++)}`,
  });
  addTask(corpus.name, "compile+first", "jse compiled flag", () => {
    const e = createEngine();
    const u = e.registerSchema(fresh(), corpus.uri);
    compileValidator(e, u).validate(first);
  });
  addTask(corpus.name, "compile+first", "jse interpreter flag", () => {
    const e = createEngine();
    const u = e.registerSchema(fresh(), corpus.uri);
    e.evaluate(u, first);
  });
  if (
    !exclusions.some((x) => x.corpus === corpus.name && x.subject === "ajv")
  ) {
    addTask(corpus.name, "compile+first", "ajv", () => {
      newAjv(corpus, {}).compile(fresh() as never)(first);
    });
  }
  addTask(corpus.name, "compile+first", "ata validate", () => {
    new AtaValidator(fresh() as never, ATA_OPTIONS).validate(first);
  });
  addTask(corpus.name, "compile+first", "jsl validate", () => {
    compileSchema(jslSchema(fresh()), JSL_OPTIONS).validate(first);
  });
}

await bench.run();

interface Row {
  corpus: string;
  partition: Partition;
  subject: string;
  meanUs: number | null;
  opsPerSec: number | null;
  samples: number;
}

const rows: Row[] = bench.tasks.map((t) => {
  const r = t.result;
  const latencyMs = "latency" in r ? r.latency.mean : null;
  if (latencyMs === null) {
    console.error(`task aborted: ${t.name}`);
    process.exitCode = 1;
  }
  const meta = taskMeta.get(t.name)!;
  return {
    corpus: meta.corpus,
    partition: meta.partition,
    subject: meta.subject,
    meanUs: latencyMs !== null ? Math.round(latencyMs * 1e5) / 100 : null,
    opsPerSec: latencyMs !== null ? Math.round(1000 / latencyMs) : null,
    samples: "latency" in r ? r.latency.samplesCount : 0,
  };
});

// Grouped, readable summary; the JSON carries the same rows.
const groups = new Map<string, Row[]>();
for (const row of rows) {
  const key = `${row.corpus} | ${row.partition}`;
  const g = groups.get(key) ?? [];
  g.push(row);
  groups.set(key, g);
}
for (const [key, g] of groups) {
  console.log(`\n== ${key}`);
  for (const row of g) {
    console.log(
      `${String(row.meanUs).padStart(12)} us  ${String(row.opsPerSec).padStart(10)} ops/s  ${row.subject}`,
    );
  }
}

mkdirSync(RESULTS, { recursive: true });
const out = join(RESULTS, "bench.json");
writeFileSync(
  out,
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      node: process.version,
      arch: process.arch,
      budgetMs: BUDGET_MS,
      minSamples: MIN_SAMPLES,
      exclusions,
      results: rows,
    },
    null,
    2,
  ) + "\n",
);
console.log(`\nwrote ${out} (budget ${String(BUDGET_MS)}ms/task)`);
