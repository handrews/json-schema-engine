// External comparison benchmark: jse vs ata-validator vs json-schema-library,
// with ajv and @hyperjump/json-schema as reference points, on the corpora
// shared with bench/harness.ts (bench/corpora/index.ts).
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
import { mkdirSync, writeFileSync } from "node:fs";
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
import { corpora, type Corpus } from "../corpora/index.js";

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
const RESULTS = join(HERE, "results");
const BUDGET_MS = Number(process.env.BENCH_BUDGET ?? "250");

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
