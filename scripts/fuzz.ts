// Big-budget differential fuzz driver (DESIGN.md M6.3). Runs the compiled ≡
// interpreter differential over every suite group of the chosen dialect
// that registers locally, seeding each group's own instances plus N seeded
// mutations, and shrinks any divergence to a minimal repro. CI runs a small
// fixed budget (packages/compiler/test/fuzz-differential.test.ts); this
// script is the on-demand ≥50k-case sweep.
//
// Usage:
//   npm run fuzz                       # default budget (~200k cases)
//   FUZZ_BUDGET=50000 npm run fuzz     # target total case count
//   FUZZ_SEED=12345 npm run fuzz       # override the seed
//   FUZZ_DIALECT=draft7 npm run fuzz   # seed from another dialect's suite
//
// Deterministic: the summary reports the seed, and every case reproduces
// from (seed, fileIndex, groupIndex, caseIndex). Exit code is nonzero on any
// divergence, with the minimized (schema, instance) repro printed.

import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createEngine, type JsonValue } from "@jse/core";
import { compileList, compileValidator } from "@jse/compiler";
import {
  Prng,
  deriveSeed,
  instancePool,
  runSide,
  runListSide,
  outcomesAgree,
  describeOutcome,
  minimizeDivergence,
  sameListDivergenceClass,
  subjectFromFactory,
  type DifferentialFactory,
} from "@jse/test-kit";

// FUZZ_CONSERVATIVE=1 referees the optimizations-off configuration (M6.5).
const COMPILE_OPTS = {
  conservative: process.env.FUZZ_CONSERVATIVE === "1",
};
// FUZZ_LIST=1 referees list-output parity: both sides' full {valid, errors}
// results are compared as canonical JSON (ordered — list artifacts never
// short-circuit), riding the same outcome/minimizer machinery by encoding
// each result as its own "error class". Structured params ride along
// (errorParams on both sides), so the JSON comparison also referees the
// M8.1 params channel — including field order.
const LIST_MODE = process.env.FUZZ_LIST === "1";

// FUZZ_DIALECT seeds the corpus from another dialect's suite directory
// (M6.6: legacy dialects compile natively, so they need fuzz pressure too).
const DIALECTS: Record<string, { dir: string; uri?: string }> = {
  "draft2020-12": { dir: "draft2020-12" },
  "draft2019-09": {
    dir: "draft2019-09",
    uri: "https://json-schema.org/draft/2019-09/schema",
  },
  draft7: { dir: "draft7", uri: "http://json-schema.org/draft-07/schema" },
  draft6: { dir: "draft6", uri: "http://json-schema.org/draft-06/schema" },
};
const DIALECT_NAME = process.env.FUZZ_DIALECT ?? "draft2020-12";
const DIALECT = DIALECTS[DIALECT_NAME];
if (DIALECT === undefined) {
  throw new Error(
    `FUZZ_DIALECT must be one of: ${Object.keys(DIALECTS).join(", ")}`,
  );
}
const ENGINE_OPTS =
  DIALECT.uri === undefined ? {} : { defaultDialect: DIALECT.uri };

const SUITE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "test-suite",
  "tests",
  DIALECT.dir,
);

interface SuiteGroup {
  description: string;
  schema: JsonValue;
  tests: { description: string; data: JsonValue; valid: boolean }[];
}

const SEED = Number(process.env.FUZZ_SEED ?? 0x9e3779b9);
const BUDGET = Number(process.env.FUZZ_BUDGET ?? 200000);

// One factory per baseUri, shared by the hot loop and the minimizer
// (subjectFromFactory), so a mode change (LIST_MODE) cannot diverge between
// them — both derive their sides from this same `prepare`.
function factoryFor(baseUri: string): DifferentialFactory {
  return {
    prepare(schema) {
      try {
        const engine = createEngine(ENGINE_OPTS);
        const uri = engine.registerSchema(schema, baseUri);
        if (LIST_MODE) {
          const artifact = compileList(engine, uri, {
            ...COMPILE_OPTS,
            errorParams: true,
          });
          return {
            interpret: runListSide((x) => {
              const r = engine.evaluate(uri, x, {
                output: "list",
                errorParams: true,
              });
              return { valid: r.valid, errors: r.errors ?? [] };
            }),
            validate: runListSide((x) => {
              const r = artifact.evaluateList(x);
              return { valid: r.valid, errors: r.valid ? [] : r.errors };
            }),
          };
        }
        const artifact = compileValidator(engine, uri, COMPILE_OPTS);
        return {
          interpret: runSide((x) => engine.evaluate(uri, x).valid),
          validate: runSide((x) => artifact.validate(x)),
        };
      } catch {
        return undefined;
      }
    },
  };
}

function main(): void {
  const files = readdirSync(SUITE_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort();

  // First pass: count registrable groups so we can size N to hit the budget.
  interface Group {
    file: string;
    fi: number;
    gi: number;
    group: SuiteGroup;
  }
  const registrable: Group[] = [];
  files.forEach((fileName, fi) => {
    const file = fileName.replace(/\.json$/, "");
    const groups = JSON.parse(
      readFileSync(join(SUITE_DIR, fileName), "utf8"),
    ) as SuiteGroup[];
    groups.forEach((group, gi) => {
      const baseUri = `https://fuzz.example/${file}/${String(gi)}`;
      if (factoryFor(baseUri).prepare(group.schema) === undefined) {
        return; // needs remote loaders / unassembled dialect — out of scope
      }
      registrable.push({ file, fi, gi, group });
    });
  });

  const ownTests = registrable.reduce((s, g) => s + g.group.tests.length, 0);
  const perGroup = Math.max(
    1,
    Math.ceil((BUDGET - ownTests) / registrable.length),
  );

  let cases = 0;
  let divergences = 0;
  const t0 = Date.now();

  for (const { file, fi, gi, group } of registrable) {
    const baseUri = `https://fuzz.example/${file}/${String(gi)}`;
    const factory = factoryFor(baseUri);
    // The hot loop and the minimizer both derive their sides from this one
    // factory, so a mode change (e.g. LIST_MODE) cannot diverge between them.
    const sides = factory.prepare(group.schema)!;
    const interpret = (x: JsonValue) => sides.interpret(x);
    const validate = (x: JsonValue) => sides.validate(x);

    const prng = new Prng(deriveSeed(SEED, fi, gi));
    const seeds = group.tests.map((t) => t.data);
    const pool = instancePool(prng, seeds, seeds.length + perGroup);

    for (let ci = 0; ci < pool.length; ci++) {
      const instance = pool[ci]!;
      cases++;
      const a = interpret(instance);
      const b = validate(instance);
      if (!outcomesAgree(a, b)) {
        divergences++;
        const subject = subjectFromFactory(factory);
        // List witnesses must keep their divergence class while shrinking,
        // or a real error-content bug minimizes into an unrelated tier gap.
        const min = minimizeDivergence(
          subject,
          group.schema,
          instance,
          LIST_MODE ? { sameDivergence: sameListDivergenceClass } : {},
        );
        console.error(
          `\nDIVERGENCE ${file} group ${String(gi)} case ${String(ci)}\n` +
            `  seed=0x${SEED.toString(16)} deriveSeed(${String(SEED)}, ${String(fi)}, ${String(gi)}) caseIndex=${String(ci)}\n` +
            `  minimized schema:   ${JSON.stringify(min.schema)}\n` +
            `  minimized instance: ${JSON.stringify(min.instance)}\n` +
            `  interpreted: ${describeOutcome(min.interpreted)}\n` +
            `  compiled:    ${describeOutcome(min.compiled)}`,
        );
      }
    }
  }

  const ms = Date.now() - t0;
  console.log(
    `fuzz summary: cases=${String(cases)} divergences=${String(divergences)} ` +
      `dialect=${DIALECT_NAME} seed=0x${SEED.toString(16)} groups=${String(registrable.length)} ` +
      `perGroup=${String(perGroup)} ms=${String(ms)}`,
  );
  if (divergences > 0) process.exitCode = 1;
}

main();
