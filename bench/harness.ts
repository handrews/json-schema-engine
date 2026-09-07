// M9a bench harness (ANALYSIS §9): real-world-shaped corpora measured for
// compile time, first validation, hot-path throughput, and annotations-on
// overhead, against ajv@8 and @hyperjump/json-schema. Report-only — the
// enforced performance gate is the spike bench (`npm run bench`); this
// harness exists to make the numbers reproducible (locally and as a CI
// artifact), not to gate.
//
// Methodology notes:
// - Format validation is disabled everywhere (jse asserts formats only by
//   opt-in; AJV would otherwise refuse unknown formats at compile). Format
//   throughput is a property of @jse/formats, not of the corpora here.
// - Hyperjump appears in hot-path tasks only: its global registry API does
//   not support repeated fresh compiles of the same URI, so compile/first
//   tasks would measure registry bookkeeping, not compilation.
// - Every subject must agree with every instance's expected verdict before
//   any timing runs (the spike's oracle discipline).
// - Compiled list+annotations output must also deep-equal the interpreter's
//   Result.annotations (order included), not just agree on verdict —
//   COMPILED-ANNOTATIONS.md's stage-3 bar.
// - Every output format is timed on both tiers, split by verdict partition
//   (valid/invalid render different costs — annotations vs. errors plus
//   dropped-record retention). Every row compiles; the verbose-level rows
//   (list+verbose, verbose) run against a separately compiled retaining
//   artifact (`verboseEvaluator`) so the relevant-level rows keep measuring
//   an artifact that does no retention. Every compiled row's document must
//   deep-equal the interpreter's for the same instance before timing runs —
//   the same oracle discipline as list+annotations, generalized to the
//   whole format table.
// - tinybench's `iterations`/`warmupIterations` floors are pinned low
//   (5/2): left at their defaults (64/16), a slow task would run for
//   seconds regardless of BENCH_BUDGET.
// - BENCH_FILTER=<regex> restricts which task names are timed (oracles
//   still run against every corpus); use it to iterate on one corpus or
//   partition without paying for the rest.
// - To compare a change: run on main, copy bench/results/results.json
//   aside, run again on the branch, then
//   `npm run bench:compare -- before.json after.json`.
// - records-sparse is where the compiled tier and AJV both drop to
//   interpreter speed: the presence probe `obj[key] !== undefined` goes
//   megamorphic over differing record shapes (bench/corpora/README.md).
//
// Run: npm run bench:harness
//   (BENCH_BUDGET=<ms per task>, default 250; BENCH_FILTER=<regex>, default all)

import { Bench } from "tinybench";
import { deepStrictEqual } from "node:assert";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import AjvMod from "ajv";
import Ajv2020Mod from "ajv/dist/2020.js";
import {
  registerSchema as hjRegister,
  validate as hjValidate,
} from "@hyperjump/json-schema/draft-2020-12";
import "@hyperjump/json-schema/draft-07";

import {
  createEngine,
  type Engine,
  type EvaluateOptions,
  type JsonValue,
  type Result,
} from "@jse/core";
import {
  compileValidator,
  compileList,
  compileEvaluator,
  type CompiledArtifact,
  type CompiledListArtifact,
  type CompiledEvaluator,
} from "@jse/compiler";
import { Ajv as CompatAjv, Ajv2020 as CompatAjv2020 } from "@jse/ajv-compat";

// CJS interop: at runtime module.exports is the class and also carries
// .default, but ajv's own types declare `.default` as always present.
// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
const Ajv2020 = Ajv2020Mod.default ?? Ajv2020Mod;
// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
const Ajv = AjvMod.default ?? AjvMod;

// strict:false is not a concession: AJV's strict mode refuses the official
// OAS 3.1 schema outright (patternProperties/property-name heuristics), so
// this is exactly how real consumers must configure AJV for this corpus.
const AJV_OPTIONS = {
  validateFormats: false,
  strict: false,
  logger: false as const,
};

const HERE = dirname(fileURLToPath(import.meta.url));
const CORPORA = join(HERE, "corpora");
const BUDGET_MS = Number(process.env.BENCH_BUDGET ?? "250");

const readJson = (name: string): JsonValue =>
  JSON.parse(readFileSync(join(CORPORA, name), "utf8")) as JsonValue;

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

interface Corpus {
  name: string;
  schema: JsonValue;
  uri: string;
  dialectHint: "2020-12" | "draft-07";
  instances: GeneratedInstance[];
  /** Subject exclusion with the recorded reason (surfaced in results). */
  ajvExcluded?: string;
  /** Generated in-harness rather than vendored from `bench/corpora/`. */
  generated?: true;
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

// --- Subjects ------------------------------------------------------------

type Verdict = (instance: JsonValue) => boolean;

interface Subject {
  name: string;
  verdict: Verdict;
}

const freshEngine = (corpus: Corpus): { engine: Engine; uri: string } => {
  const engine = createEngine();
  const uri = engine.registerSchema(corpus.schema, corpus.uri);
  return { engine, uri };
};

interface CorpusContext {
  subjects: Subject[];
  engine: Engine;
  uri: string;
  flag: CompiledArtifact;
  list: CompiledListArtifact;
  listAnn: CompiledListArtifact;
  evaluator: CompiledEvaluator;
  verboseEvaluator: CompiledEvaluator;
}

async function subjectsFor(corpus: Corpus): Promise<CorpusContext> {
  const { engine, uri } = freshEngine(corpus);
  const flag = compileValidator(engine, uri);
  const list = compileList(engine, uri, { errorParams: false });
  const listAnn = compileList(engine, uri, {
    errorParams: false,
    annotations: true,
  });
  // Backs the compiled hierarchical/detailed/list+trace rows: the same
  // selection as `listAnn`, rendered as documents.
  const evaluator = compileEvaluator(engine, uri, {
    errorParams: false,
    annotations: true,
  });
  // Backs the list+verbose and verbose rows: a separate artifact because
  // retention is fixed at compile time (D5), and the relevant-level rows
  // above must keep measuring an artifact that does no retention.
  const verboseEvaluator = compileEvaluator(engine, uri, {
    errorParams: false,
    annotations: true,
    verbose: true,
  });
  const subjects: Subject[] = [
    { name: "jse compiled flag", verdict: (x) => flag.validate(x) },
    { name: "jse compiled list", verdict: (x) => list.evaluateList(x).valid },
    {
      name: "jse compiled list+annotations",
      verdict: (x) => listAnn.evaluateList(x).valid,
    },
    {
      name: "jse interpreter flag",
      verdict: (x) => engine.evaluate(uri, x).valid,
    },
    {
      name: "jse interpreter list+annotations",
      verdict: (x) =>
        engine.evaluate(uri, x, { output: "list", annotations: true }).valid,
    },
  ];

  if (corpus.dialectHint === "2020-12") {
    if (corpus.ajvExcluded === undefined) {
      const ajv = new Ajv2020(AJV_OPTIONS);
      const ajvValidate = ajv.compile(corpus.schema as never);
      subjects.push({ name: "ajv (2020)", verdict: (x) => ajvValidate(x) });
    } else {
      console.log(`note: ${corpus.name}: ajv excluded — ${corpus.ajvExcluded}`);
    }
    // Unlike real AJV, ajv-compat has no independent 2020-12 implementation
    // to disagree with jse: it wraps the same engine the other jse subjects
    // do, so its verdicts should agree even on the corpus real AJV cannot
    // handle. Compiled once here (outside the timed loop) like every other
    // subject.
    const compat2020 = new CompatAjv2020(AJV_OPTIONS);
    const compat2020Validate = compat2020.compile(corpus.schema);
    subjects.push({
      name: "ajv-compat (2020)",
      verdict: (x) => compat2020Validate(x),
    });
    hjRegister(corpus.schema as never);
    const hj = await hjValidate(corpus.uri);
    subjects.push({ name: "hyperjump", verdict: (x) => hj(x).valid });
  } else {
    const ajv = new Ajv(AJV_OPTIONS);
    const ajvValidate = ajv.compile(corpus.schema as never);
    subjects.push({ name: "ajv (draft-07)", verdict: (x) => ajvValidate(x) });
    const compat = new CompatAjv(AJV_OPTIONS);
    const compatValidate = compat.compile(corpus.schema);
    subjects.push({
      name: "ajv-compat (draft-07)",
      verdict: (x) => compatValidate(x),
    });
  }
  return {
    subjects,
    engine,
    uri,
    flag,
    list,
    listAnn,
    evaluator,
    verboseEvaluator,
  };
}

// --- Output formats --------------------------------------------------------

// One tier's view of an output format. `run` is timed as-is (no wrapper
// allocation on the hot path); `probe` is what the oracle compares.
interface FormatSide {
  run: (x: JsonValue) => unknown;
  probe: (x: JsonValue) => { valid: boolean; document: unknown };
}

interface FormatEntry {
  /** Task subject: "jse interpreter <format>" / "jse compiled <format>". */
  format: string;
  interpreter: (ctx: CorpusContext) => FormatSide;
  /**
   * Absent until the compiled tier renders the format. Presence alone
   * adds the document-equality oracle and the timed task.
   */
  compiled?: (ctx: CorpusContext) => FormatSide;
}

const interpreted =
  (
    options: EvaluateOptions,
    document: (r: Result) => unknown = (r) => r.outputDocument,
  ) =>
  ({ engine, uri }: CorpusContext): FormatSide => ({
    run: (x) => engine.evaluate(uri, x, options),
    probe: (x) => {
      const r = engine.evaluate(uri, x, options);
      return { valid: r.valid, document: document(r) };
    },
  });

// `annotations: true` throughout: the full document is what a consumer of
// a structured format asks for, and on invalid instances annotations are
// not rendered anyway. No errorParams/positions — these rows isolate
// rendering cost and match the artifacts' `errorParams: false`.
const FORMATS: FormatEntry[] = [
  // Reference rows: every partition carries the whole cost ladder
  // (flag → flat list → basic → documents) on the same instances.
  {
    format: "flag",
    interpreter: interpreted({}, (r) => ({ valid: r.valid })),
    compiled: ({ flag }) => ({
      run: (x) => flag.validate(x),
      probe: (x) => {
        const valid = flag.validate(x);
        return { valid, document: { valid } };
      },
    }),
  },
  // The flat surface. On the interpreter this call also renders the list
  // document: it cannot produce the flat units without it.
  {
    format: "list+annotations",
    interpreter: interpreted({ output: "list", annotations: true }, (r) => ({
      errors: r.errors ?? [],
      annotations: r.annotations,
    })),
    compiled: ({ listAnn }) => ({
      run: (x) => listAnn.evaluateList(x),
      probe: (x) => {
        const r = listAnn.evaluateList(x);
        return {
          valid: r.valid,
          document: {
            errors: r.valid ? [] : r.errors,
            annotations: r.annotations,
          },
        };
      },
    }),
  },
  {
    format: "basic",
    interpreter: interpreted({ output: "basic", annotations: true }),
    compiled: ({ listAnn }) => ({
      run: (x) => listAnn.basic(x),
      probe: (x) => {
        const d = listAnn.basic(x);
        return { valid: d.valid, document: d };
      },
    }),
  },
  {
    format: "list+verbose",
    interpreter: interpreted({
      output: "list",
      verbose: true,
      annotations: true,
    }),
    compiled: ({ verboseEvaluator }) => ({
      run: (x) =>
        verboseEvaluator.evaluate(x, { output: "list", verbose: true }),
      probe: (x) => {
        const r = verboseEvaluator.evaluate(x, {
          output: "list",
          verbose: true,
        });
        return { valid: r.valid, document: r.outputDocument };
      },
    }),
  },
  // The ajv-compat escalation path (list evaluation with the trace kept).
  {
    format: "list+trace",
    interpreter: interpreted(
      { output: "list", annotations: true, trace: true },
      (r) => ({ document: r.outputDocument, trace: r.trace }),
    ),
    compiled: ({ evaluator }) => ({
      run: (x) => evaluator.evaluate(x, { output: "list", trace: true }),
      probe: (x) => {
        const r = evaluator.evaluate(x, { output: "list", trace: true });
        return {
          valid: r.valid,
          document: { document: r.outputDocument, trace: r.trace },
        };
      },
    }),
  },
  {
    format: "hierarchical",
    interpreter: interpreted({ output: "hierarchical", annotations: true }),
    compiled: ({ evaluator }) => ({
      run: (x) => evaluator.evaluate(x, { output: "hierarchical" }),
      probe: (x) => {
        const r = evaluator.evaluate(x, { output: "hierarchical" });
        return { valid: r.valid, document: r.outputDocument };
      },
    }),
  },
  {
    format: "detailed",
    interpreter: interpreted({ output: "detailed", annotations: true }),
    compiled: ({ evaluator }) => ({
      run: (x) => evaluator.evaluate(x, { output: "detailed" }),
      probe: (x) => {
        const r = evaluator.evaluate(x, { output: "detailed" });
        return { valid: r.valid, document: r.outputDocument };
      },
    }),
  },
  {
    format: "verbose",
    interpreter: interpreted({ output: "verbose", annotations: true }),
    compiled: ({ verboseEvaluator }) => ({
      run: (x) => verboseEvaluator.evaluate(x, { output: "verbose" }),
      probe: (x) => {
        const r = verboseEvaluator.evaluate(x, { output: "verbose" });
        return { valid: r.valid, document: r.outputDocument };
      },
    }),
  },
];

// --- Oracle, then timing ---------------------------------------------------

// tinybench also treats `iterations` (64) and `warmupIterations` (16) as
// floors, so a 30 ms/eval records task would run ~2 s regardless of the
// budget. Pin them low enough that BENCH_BUDGET governs; keep a small
// sample floor so the slowest interpreter tasks still yield a mean.
const MIN_SAMPLES = 5;
const bench = new Bench({
  time: BUDGET_MS,
  iterations: MIN_SAMPLES,
  warmupIterations: 2,
});
// BENCH_FILTER=<regex> times only matching task names; oracles always run.
const FILTER =
  process.env.BENCH_FILTER === undefined
    ? null
    : new RegExp(process.env.BENCH_FILTER);

type Partition = "hot" | "compile+first" | "valid" | "invalid";

interface TaskMeta {
  corpus: string;
  partition: Partition;
  subject: string;
}

const taskMeta = new Map<string, TaskMeta>();

function addTask(
  corpus: string,
  partition: Partition,
  subject: string,
  fn: () => unknown,
): void {
  const task = `${corpus} | ${partition} | ${subject}`;
  if (FILTER !== null && !FILTER.test(task)) return;
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

let oracleFailures = 0;
const fail = (msg: string): void => {
  oracleFailures++;
  console.error(`ORACLE FAIL: ${msg}`);
};

for (const corpus of corpora) {
  const ctx = await subjectsFor(corpus);
  for (const subject of ctx.subjects) {
    corpus.instances.forEach((instance, i) => {
      const got = subject.verdict(instance.value);
      if (got !== instance.valid) {
        fail(
          `${corpus.name}#${String(i)}: ${subject.name} said ` +
            `${String(got)}, expected ${String(instance.valid)}`,
        );
      }
    });
  }

  // Stronger than verdict agreement: the compiled annotation artifact must
  // reproduce the interpreter's Result.annotations exactly, order included
  // (COMPILED-ANNOTATIONS.md §5 "Bench" / stage 3).
  corpus.instances.forEach((instance, i) => {
    const compiledAnnotations = ctx.listAnn.evaluateList(
      instance.value,
    ).annotations;
    const interpreterAnnotations = ctx.engine.evaluate(
      ctx.uri,
      instance.value,
      { output: "list", annotations: true },
    ).annotations;
    try {
      deepStrictEqual(compiledAnnotations, interpreterAnnotations);
    } catch (e) {
      fail(
        `${corpus.name}#${String(i)}: compiled annotations diverge from ` +
          `the interpreter — ${(e as Error).message}`,
      );
    }
  });

  // Every format row must agree with the expected verdict, and a compiled
  // renderer must reproduce the interpreter's document exactly.
  for (const entry of FORMATS) {
    const interp = entry.interpreter(ctx);
    const comp = entry.compiled?.(ctx);
    corpus.instances.forEach((instance, i) => {
      const expected = interp.probe(instance.value);
      if (expected.valid !== instance.valid) {
        fail(
          `${corpus.name}#${String(i)}: jse interpreter ${entry.format} ` +
            `said ${String(expected.valid)}, expected ${String(instance.valid)}`,
        );
      }
      if (comp === undefined) return;
      const got = comp.probe(instance.value);
      if (got.valid !== instance.valid) {
        fail(
          `${corpus.name}#${String(i)}: jse compiled ${entry.format} said ` +
            `${String(got.valid)}, expected ${String(instance.valid)}`,
        );
      }
      try {
        deepStrictEqual(got.document, expected.document);
      } catch (e) {
        // A structured document can be megabytes; keep the report readable.
        fail(
          `${corpus.name}#${String(i)}: compiled ${entry.format} document ` +
            `diverges from the interpreter — ${(e as Error).message.slice(0, 400)}`,
        );
      }
    });
  }

  // Hot-path throughput: precompiled subjects, instances round-robin.
  const values = corpus.instances.map((instance) => instance.value);
  for (const subject of ctx.subjects) {
    addTask(
      corpus.name,
      "hot",
      subject.name,
      roundRobin(values, subject.verdict),
    );
  }

  // Format rows run per verdict partition: annotation rendering (valid) and
  // error rendering plus dropped-record retention (invalid) cost
  // differently, and a mixed average hides whichever one a change targets.
  const partitions: [Partition, JsonValue[]][] = [
    ["valid", corpus.instances.filter((x) => x.valid).map((x) => x.value)],
    ["invalid", corpus.instances.filter((x) => !x.valid).map((x) => x.value)],
  ];
  for (const [partition, partitionValues] of partitions) {
    for (const entry of FORMATS) {
      addTask(
        corpus.name,
        partition,
        `jse interpreter ${entry.format}`,
        roundRobin(partitionValues, entry.interpreter(ctx).run),
      );
      const comp = entry.compiled?.(ctx);
      if (comp !== undefined) {
        addTask(
          corpus.name,
          partition,
          `jse compiled ${entry.format}`,
          roundRobin(partitionValues, comp.run),
        );
      }
    }
  }

  // Compile + first validation (fresh everything per iteration). Hyperjump
  // is excluded — see the methodology note at the top.
  const first = corpus.instances[0]!.value;
  addTask(corpus.name, "compile+first", "jse compiled flag", () => {
    const { engine, uri } = freshEngine(corpus);
    compileValidator(engine, uri).validate(first);
  });
  addTask(corpus.name, "compile+first", "jse interpreter", () => {
    const { engine, uri } = freshEngine(corpus);
    engine.evaluate(uri, first);
  });
  if (corpus.dialectHint === "2020-12") {
    if (corpus.ajvExcluded === undefined) {
      addTask(corpus.name, "compile+first", "ajv (2020)", () => {
        new Ajv2020(AJV_OPTIONS).compile(corpus.schema as never)(first);
      });
    }
  } else {
    addTask(corpus.name, "compile+first", "ajv (draft-07)", () => {
      new Ajv(AJV_OPTIONS).compile(corpus.schema as never)(first);
    });
  }
}

if (oracleFailures > 0) {
  console.error(`${String(oracleFailures)} oracle failure(s) — aborted.`);
  process.exit(1);
}
console.log("Oracle: all subjects agree on all corpus verdicts.\n");

await bench.run();

const rows = bench.tasks.map((t) => {
  const r = t.result;
  const latencyMs = "latency" in r ? r.latency.mean : null;
  if (latencyMs === null) {
    // An aborted task means a subject crashed mid-benchmark — a real
    // failure even in a report-only harness.
    console.error(`task aborted: ${t.name}`);
    process.exitCode = 1;
  }
  const meta = taskMeta.get(t.name)!;
  return {
    task: t.name,
    corpus: meta.corpus,
    partition: meta.partition,
    subject: meta.subject,
    opsPerSec: latencyMs !== null ? Math.round(1000 / latencyMs) : null,
    meanNs: latencyMs !== null ? Math.round(latencyMs * 1e6) : null,
    samples: "latency" in r ? r.latency.samplesCount : 0,
  };
});
console.table(rows);

const RESULTS_DIR = join(HERE, "results");
mkdirSync(RESULTS_DIR, { recursive: true });
const payload = {
  generatedAt: new Date().toISOString(),
  node: process.version,
  budgetMs: BUDGET_MS,
  minSamples: MIN_SAMPLES,
  corpora: corpora.map((c) => ({
    name: c.name,
    instances: c.instances.length,
    generated: c.generated === true,
  })),
  exclusions: corpora
    .filter((c) => c.ajvExcluded !== undefined)
    .map((c) => ({
      corpus: c.name,
      subject: "ajv (2020)",
      reason: c.ajvExcluded,
    })),
  results: rows,
};
writeFileSync(
  join(RESULTS_DIR, "results.json"),
  JSON.stringify(payload, null, 2) + "\n",
);
console.log(
  `\nwrote bench/results/results.json (budget ${String(BUDGET_MS)}ms/task)`,
);
