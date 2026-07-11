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
//
// Run: npm run bench:harness   (BENCH_BUDGET=<ms per task>, default 250)

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

import { createEngine, type Engine, type JsonValue } from "@jse/core";
import {
  compileValidator,
  compileList,
  type CompiledListArtifact,
} from "@jse/compiler";
import { Ajv as CompatAjv } from "@jse/ajv-compat";

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

interface Corpus {
  name: string;
  schema: JsonValue;
  uri: string;
  dialectHint: "2020-12" | "draft-07";
  instances: GeneratedInstance[];
  /** Subject exclusion with the recorded reason (surfaced in results). */
  ajvExcluded?: string;
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

interface CorpusSubjects {
  subjects: Subject[];
  engine: Engine;
  uri: string;
  listAnn: CompiledListArtifact;
}

async function subjectsFor(corpus: Corpus): Promise<CorpusSubjects> {
  const { engine, uri } = freshEngine(corpus);
  const flag = compileValidator(engine, uri);
  const list = compileList(engine, uri, { errorParams: false });
  const listAnn = compileList(engine, uri, {
    errorParams: false,
    collectAnnotations: true,
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
      verdict: (x) => engine.evaluate(uri, x, { output: "list" }).valid,
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
  return { subjects, engine, uri, listAnn };
}

// --- Oracle, then timing ---------------------------------------------------

const bench = new Bench({ time: BUDGET_MS });
let oracleFailures = 0;

for (const corpus of corpora) {
  const { subjects, engine, uri, listAnn } = await subjectsFor(corpus);
  for (const subject of subjects) {
    corpus.instances.forEach((instance, i) => {
      const got = subject.verdict(instance.value);
      if (got !== instance.valid) {
        oracleFailures++;
        console.error(
          `ORACLE FAIL: ${corpus.name}#${String(i)}: ${subject.name} said ` +
            `${String(got)}, expected ${String(instance.valid)}`,
        );
      }
    });
  }

  // Stronger than verdict agreement: the compiled annotation artifact must
  // reproduce the interpreter's Result.annotations exactly, order included
  // (COMPILED-ANNOTATIONS.md §5 "Bench" / stage 3).
  corpus.instances.forEach((instance, i) => {
    const compiledAnnotations = listAnn.evaluateList(
      instance.value,
    ).annotations;
    const interpreterAnnotations = engine.evaluate(uri, instance.value, {
      output: "list",
      collectAnnotations: true,
    }).annotations;
    try {
      deepStrictEqual(compiledAnnotations, interpreterAnnotations);
    } catch (e) {
      oracleFailures++;
      console.error(
        `ORACLE FAIL: ${corpus.name}#${String(i)}: compiled annotations ` +
          `diverge from the interpreter — ${(e as Error).message}`,
      );
    }
  });

  // Hot-path throughput: precompiled subjects, instances round-robin.
  for (const subject of subjects) {
    let i = 0;
    bench.add(`${corpus.name} | hot | ${subject.name}`, () => {
      subject.verdict(corpus.instances[i++ % corpus.instances.length]!.value);
    });
  }

  // Compile + first validation (fresh everything per iteration). Hyperjump
  // is excluded — see the methodology note at the top.
  const first = corpus.instances[0]!.value;
  bench.add(`${corpus.name} | compile+first | jse compiled flag`, () => {
    const { engine, uri } = freshEngine(corpus);
    compileValidator(engine, uri).validate(first);
  });
  bench.add(`${corpus.name} | compile+first | jse interpreter`, () => {
    const { engine, uri } = freshEngine(corpus);
    engine.evaluate(uri, first);
  });
  if (corpus.dialectHint === "2020-12") {
    if (corpus.ajvExcluded === undefined) {
      bench.add(`${corpus.name} | compile+first | ajv (2020)`, () => {
        new Ajv2020(AJV_OPTIONS).compile(corpus.schema as never)(first);
      });
    }
  } else {
    bench.add(`${corpus.name} | compile+first | ajv (draft-07)`, () => {
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
  return {
    task: t.name,
    opsPerSec: latencyMs !== null ? Math.round(1000 / latencyMs) : null,
    meanNs: latencyMs !== null ? Math.round(latencyMs * 1e6) : null,
  };
});
console.table(rows);

const RESULTS_DIR = join(HERE, "results");
mkdirSync(RESULTS_DIR, { recursive: true });
const payload = {
  generatedAt: new Date().toISOString(),
  node: process.version,
  budgetMs: BUDGET_MS,
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
