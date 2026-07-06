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
import { compileValidator } from "@jse/compiler";
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

/** Build the differential subject for one group (re-registers per candidate). */
function subjectFor(file: string, groupIndex: number): DifferentialSubject {
  const baseUri = `https://fuzz.example/${file}/${String(groupIndex)}`;
  return {
    registers(candidate) {
      try {
        const engine = createEngine();
        const uri = engine.registerSchema(candidate, baseUri);
        compileValidator(engine, uri);
        return true;
      } catch {
        return false;
      }
    },
    interpreted(candidate, instance): SideOutcome {
      const engine = createEngine();
      const uri = engine.registerSchema(candidate, baseUri);
      return runSide((x) => engine.evaluate(uri, x).valid)(instance);
    },
    compiled(candidate, instance): SideOutcome {
      const engine = createEngine();
      const uri = engine.registerSchema(candidate, baseUri);
      const artifact = compileValidator(engine, uri);
      return runSide((x) => artifact.validate(x))(instance);
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
          const engine = createEngine();
          const baseUri = `https://fuzz.example/${file}/${String(gi)}`;
          let uri: string;
          let artifact;
          try {
            uri = engine.registerSchema(group.schema, baseUri);
            artifact = compileValidator(engine, uri);
          } catch {
            // Groups needing remote loaders or unassembled dialects (e.g.
            // vocabulary.json) don't register locally — out of scope, the
            // full interpreter suite covers them.
            return;
          }
          registrableGroups++;

          const interpret = runSide((x) => engine.evaluate(uri, x).valid);
          const validate = runSide((x) => artifact.validate(x));

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
              const subject = subjectFor(file, gi);
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
