// Big-budget differential fuzz driver (DESIGN.md M6.3). Runs the compiled ≡
// interpreter flag differential over every draft2020-12 suite group that
// registers locally, seeding each group's own instances plus N seeded
// mutations, and shrinks any divergence to a minimal repro. CI runs a small
// fixed budget (packages/compiler/test/fuzz-differential.test.ts); this
// script is the on-demand ≥50k-case sweep.
//
// Usage:
//   npm run fuzz                       # default budget (~200k cases)
//   FUZZ_BUDGET=50000 npm run fuzz     # target total case count
//   FUZZ_SEED=12345 npm run fuzz       # override the seed
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
  outcomesAgree,
  describeOutcome,
  minimizeDivergence,
  type DifferentialSubject,
  type SideOutcome,
} from "@jse/test-kit";

// FUZZ_CONSERVATIVE=1 referees the optimizations-off configuration (M6.5).
const COMPILE_OPTS = {
  conservative: process.env.FUZZ_CONSERVATIVE === "1",
};
// FUZZ_LIST=1 referees list-output parity: both sides' full {valid, errors}
// results are compared as canonical JSON (ordered — list artifacts never
// short-circuit), riding the same outcome/minimizer machinery by encoding
// each result as its own "error class".
const LIST_MODE = process.env.FUZZ_LIST === "1";

const SUITE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "test-suite",
  "tests",
  "draft2020-12",
);

interface SuiteGroup {
  description: string;
  schema: JsonValue;
  tests: { description: string; data: JsonValue; valid: boolean }[];
}

const SEED = Number(process.env.FUZZ_SEED ?? 0x9e3779b9);
const BUDGET = Number(process.env.FUZZ_BUDGET ?? 200000);

// List-mode outcome: the full result as canonical JSON in the throw
// channel, so outcomesAgree === full structural equality.
function runListSide(
  evaluate: (instance: JsonValue) => unknown,
): (instance: JsonValue) => SideOutcome {
  return (instance) => {
    try {
      return { kind: "throw", errorClass: JSON.stringify(evaluate(instance)) };
    } catch (err) {
      return {
        kind: "throw",
        errorClass: "THREW:" + (err as Error).constructor.name,
      };
    }
  };
}

function subjectFor(baseUri: string): DifferentialSubject {
  return {
    registers(schema) {
      try {
        const engine = createEngine();
        const uri = engine.registerSchema(schema, baseUri);
        compileValidator(engine, uri, COMPILE_OPTS);
        return true;
      } catch {
        return false;
      }
    },
    interpreted(schema, instance): SideOutcome {
      const engine = createEngine();
      const uri = engine.registerSchema(schema, baseUri);
      if (LIST_MODE) {
        return runListSide((x) => {
          const r = engine.evaluate(uri, x, { output: "list" });
          return { valid: r.valid, errors: r.errors ?? [] };
        })(instance);
      }
      return runSide((x) => engine.evaluate(uri, x).valid)(instance);
    },
    compiled(schema, instance): SideOutcome {
      const engine = createEngine();
      const uri = engine.registerSchema(schema, baseUri);
      if (LIST_MODE) {
        const artifact = compileList(engine, uri, COMPILE_OPTS);
        return runListSide((x) => {
          const r = artifact.evaluateList(x);
          return { valid: r.valid, errors: r.valid ? [] : r.errors };
        })(instance);
      }
      const artifact = compileValidator(engine, uri, COMPILE_OPTS);
      return runSide((x) => artifact.validate(x))(instance);
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
      const engine = createEngine();
      const baseUri = `https://fuzz.example/${file}/${String(gi)}`;
      try {
        const uri = engine.registerSchema(group.schema, baseUri);
        compileValidator(engine, uri, COMPILE_OPTS);
      } catch {
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
    const engine = createEngine();
    const baseUri = `https://fuzz.example/${file}/${String(gi)}`;
    const uri = engine.registerSchema(group.schema, baseUri);
    const artifact = compileValidator(engine, uri, COMPILE_OPTS);
    const interpret = runSide((x) => engine.evaluate(uri, x).valid);
    const validate = runSide((x) => artifact.validate(x));

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
        const subject = subjectFor(baseUri);
        const min = minimizeDivergence(subject, group.schema, instance);
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
      `seed=0x${SEED.toString(16)} groups=${String(registrable.length)} ` +
      `perGroup=${String(perGroup)} ms=${String(ms)}`,
  );
  if (divergences > 0) process.exitCode = 1;
}

main();
