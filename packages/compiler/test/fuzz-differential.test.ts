// M6.3 CI-budget differential fuzz: compiled ≡ interpreter over the whole
// draft2020-12 suite × seeded mutated instances. The compiled artifact
// trampolines every unlowerable node to the interpreter, so agreement must
// hold on EVERY schema — lowered or fully fallback. A divergence here is a
// compiler bug; the failure message carries the seed and a minimized repro.
//
// Budget: fixed default seed, N mutations per registrable group, capped so
// the run stays well under 30s while clearing the ≥20,000-case floor. The
// big-budget (≥50k) run lives in scripts/fuzz.ts (npm run fuzz).

import { describe, it, expect } from "vitest";
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
  subjectFromFactory,
  type DifferentialFactory,
} from "@jse/test-kit";

const SUITE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "test-suite",
  "tests",
  "draft2020-12",
);

// Fixed so CI is reproducible; override in the big-budget script, not here.
const SEED = 0x9e3779b9;
// Mutations per registrable group. 381 groups × 60 + own tests ≈ 24k cases,
// ~0.3s — comfortably under budget and over the 20k floor.
const MUTATIONS_PER_GROUP = 60;

interface SuiteGroup {
  description: string;
  schema: JsonValue;
  tests: { description: string; data: JsonValue; valid: boolean }[];
}

/** Flag-mode factory for one group: prepare() registers + compiles a validator. */
function flagFactoryFor(file: string, groupIndex: number): DifferentialFactory {
  const baseUri = `https://fuzz.example/${file}/${String(groupIndex)}`;
  return {
    prepare(schema) {
      try {
        const engine = createEngine();
        const uri = engine.registerSchema(schema, baseUri);
        const artifact = compileValidator(engine, uri);
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

describe("compiled ≡ interpreted differential fuzz (M6.3)", () => {
  const files = readdirSync(SUITE_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort();

  let totalCases = 0;
  let registrableGroups = 0;

  for (let fi = 0; fi < files.length; fi++) {
    const file = files[fi]!.replace(/\.json$/, "");
    const groups = JSON.parse(
      readFileSync(join(SUITE_DIR, files[fi]!), "utf8"),
    ) as SuiteGroup[];

    describe(file, () => {
      groups.forEach((group, gi) => {
        it(group.description, () => {
          const factory = flagFactoryFor(file, gi);
          const sides = factory.prepare(group.schema);
          if (sides === undefined) {
            // Groups needing remote loaders or unassembled dialects (e.g.
            // vocabulary.json) don't register locally — out of scope, the
            // full interpreter suite covers them.
            return;
          }
          registrableGroups++;

          const interpret = (x: JsonValue) => sides.interpret(x);
          const validate = (x: JsonValue) => sides.validate(x);

          const prng = new Prng(deriveSeed(SEED, fi, gi));
          const seeds = group.tests.map((t) => t.data);
          const pool = instancePool(
            prng,
            seeds,
            seeds.length + MUTATIONS_PER_GROUP,
          );

          for (let ci = 0; ci < pool.length; ci++) {
            const instance = pool[ci]!;
            totalCases++;
            const interpreted = interpret(instance);
            const compiled = validate(instance);
            if (!outcomesAgree(interpreted, compiled)) {
              // Shrink to a minimal witness before reporting.
              const subject = subjectFromFactory(factory);
              const min = minimizeDivergence(subject, group.schema, instance);
              throw new Error(
                `DIVERGENCE ${file} group ${String(gi)} case ${String(ci)}\n` +
                  `  seed=0x${SEED.toString(16)} deriveSeed(${String(SEED)}, ${String(fi)}, ${String(gi)})\n` +
                  `  minimized schema:   ${JSON.stringify(min.schema)}\n` +
                  `  minimized instance: ${JSON.stringify(min.instance)}\n` +
                  `  interpreted: ${describeOutcome(min.interpreted)}\n` +
                  `  compiled:    ${describeOutcome(min.compiled)}`,
              );
            }
          }
        });
      });
    });
  }

  it(`ran ≥20,000 cases with zero divergence (seed 0x${SEED.toString(16)})`, () => {
    // Floor per the M6.3 done-signal; the assertion also proves the loop
    // above actually executed rather than silently skipping every group.
    expect(registrableGroups).toBeGreaterThan(300);
    expect(totalCases).toBeGreaterThanOrEqual(20000);
  });
});

// List-mode leg (M8.6): the flag leg above only referees the boolean valid
// verdict, so a list-output bug (wrong error, wrong params, wrong field
// order) can hide behind an agreeing verdict — the incident that motivated
// the shared factory machinery. Runs a SUBSET (every 4th registrable group)
// because list-mode compilation is heavier than flag-mode; the full sweep
// lives in scripts/fuzz.ts (FUZZ_LIST=1 npm run fuzz).
const LIST_SEED = 0x9e3779b9;
// ~95 groups survive the every-4th subset; 45 mutations/group + own tests
// lands mid-range in the 3,000-6,000 target (measured ~4.6k), comfortably
// clear of the floor below.
const LIST_MUTATIONS_PER_GROUP = 45;

/** List-mode factory for one group: compares full {valid, errors} output. */
function listFactoryFor(file: string, groupIndex: number): DifferentialFactory {
  const baseUri = `https://fuzz.example/${file}/${String(groupIndex)}/list`;
  return {
    prepare(schema) {
      try {
        const engine = createEngine();
        const uri = engine.registerSchema(schema, baseUri);
        const artifact = compileList(engine, uri, { errorParams: true });
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
      } catch {
        return undefined;
      }
    },
  };
}

describe("compiled ≡ interpreted list-output differential fuzz (M8.6, subset)", () => {
  const files = readdirSync(SUITE_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort();

  let listCases = 0;
  let listRegistrableGroups = 0;

  for (let fi = 0; fi < files.length; fi++) {
    const file = files[fi]!.replace(/\.json$/, "");
    const groups = JSON.parse(
      readFileSync(join(SUITE_DIR, files[fi]!), "utf8"),
    ) as SuiteGroup[];

    describe(file, () => {
      groups.forEach((group, gi) => {
        it(`${group.description} (list mode)`, () => {
          const factory = listFactoryFor(file, gi);
          const sides = factory.prepare(group.schema);
          if (sides === undefined) return; // out of scope, same as the flag leg

          listRegistrableGroups++;
          if (listRegistrableGroups % 4 !== 0) return; // subset: every 4th

          const interpret = (x: JsonValue) => sides.interpret(x);
          const validate = (x: JsonValue) => sides.validate(x);

          const prng = new Prng(deriveSeed(LIST_SEED, fi, gi));
          const seeds = group.tests.map((t) => t.data);
          const pool = instancePool(
            prng,
            seeds,
            seeds.length + LIST_MUTATIONS_PER_GROUP,
          );

          for (let ci = 0; ci < pool.length; ci++) {
            const instance = pool[ci]!;
            listCases++;
            const interpreted = interpret(instance);
            const compiled = validate(instance);
            if (!outcomesAgree(interpreted, compiled)) {
              const subject = subjectFromFactory(factory);
              const min = minimizeDivergence(subject, group.schema, instance);
              throw new Error(
                `DIVERGENCE (list mode) ${file} group ${String(gi)} case ${String(ci)}\n` +
                  `  seed=0x${LIST_SEED.toString(16)} deriveSeed(${String(LIST_SEED)}, ${String(fi)}, ${String(gi)})\n` +
                  `  minimized schema:   ${JSON.stringify(min.schema)}\n` +
                  `  minimized instance: ${JSON.stringify(min.instance)}\n` +
                  `  interpreted: ${describeOutcome(min.interpreted)}\n` +
                  `  compiled:    ${describeOutcome(min.compiled)}`,
              );
            }
          }
        });
      });
    });
  }

  it(`ran ≥3,000 list-mode cases with zero divergence (seed 0x${LIST_SEED.toString(16)})`, () => {
    // Floor proves the subset loop above actually executed rather than
    // silently skipping every group (the FUZZ_LIST incident's failure mode).
    expect(listCases).toBeGreaterThanOrEqual(3000);
  });
});
