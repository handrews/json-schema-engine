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
import { createEngine, type JsonValue } from "@json-schema-engine/core";
import { compileList, compileValidator } from "@json-schema-engine/compiler";
import {
  Prng,
  deriveSeed,
  instancePool,
  runSide,
  runListSide,
  runAnnotationsSide,
  outcomesAgree,
  describeOutcome,
  minimizeDivergence,
  sameListDivergenceClass,
  sameAnnotationsDivergenceClass,
  subjectFromFactory,
  ANNOTATION_SEED_GROUPS,
  CONSUMER_SEED_GROUPS,
  DYNAMIC_SEED_GROUPS,
  type DifferentialFactory,
} from "@json-schema-engine/test-kit";

// Seed corpora that run in full on every leg: the compiled-consumer corpus
// (COMPILED-CONSUMERS.md phase B) and the `$dynamicRef` corpus (ADR 0004:
// statically resolved sites and unstable islands). `extra` keeps each
// corpus's per-group seed streams distinct.
const SEED_CORPORA: readonly [
  name: string,
  groups: typeof CONSUMER_SEED_GROUPS,
  extra: number,
][] = [
  ["consumer-seeds", CONSUMER_SEED_GROUPS, 0],
  ["dynamic-seeds", DYNAMIC_SEED_GROUPS, 1],
];

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

  // Compiled-consumer corpus (COMPILED-CONSUMERS.md phase B): the suite
  // under-represents the dynamic-coverage shapes where flag-mode runtime
  // tracking can be subtly wrong, so — like annotation-seeds — this corpus
  // always runs in full, never subsetted. It belongs on the FLAG leg above
  // all: the flag verdict is exactly what coverage tracking decides.
  for (const [corpus, groups, extra] of SEED_CORPORA)
    describe(corpus, () => {
      groups.forEach((group, gi) => {
        it(group.description, () => {
          const factory = flagFactoryFor(corpus, gi);
          const sides = factory.prepare(group.schema);
          expect(sides).toBeDefined(); // the corpus must register, or the nudge is vacuous
          registrableGroups++;

          const prng = new Prng(deriveSeed(SEED, files.length + extra, gi));
          const seeds = group.tests.map((t) => t.data);
          const pool = instancePool(
            prng,
            seeds,
            seeds.length + MUTATIONS_PER_GROUP,
          );
          for (let ci = 0; ci < pool.length; ci++) {
            const instance = pool[ci]!;
            totalCases++;
            const interpreted = sides!.interpret(instance);
            const compiled = sides!.validate(instance);
            if (!outcomesAgree(interpreted, compiled)) {
              const subject = subjectFromFactory(factory);
              const min = minimizeDivergence(subject, group.schema, instance);
              throw new Error(
                `DIVERGENCE ${corpus} group ${String(gi)} case ${String(ci)}\n` +
                  `  seed=0x${SEED.toString(16)} deriveSeed(${String(SEED)}, ${String(files.length + extra)}, ${String(gi)})\n` +
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
              // Class-preserving shrink: the witness must stay the same
              // kind of list divergence it started as.
              const min = minimizeDivergence(subject, group.schema, instance, {
                sameDivergence: sameListDivergenceClass,
              });
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

  // Compiled-consumer corpus in list mode: the consumer sweep also emits
  // errors, so list-output parity (error content and order) over these shapes
  // needs its own pressure. Full corpus, never subsetted.
  for (const [corpus, groups, extra] of SEED_CORPORA)
    describe(corpus, () => {
      groups.forEach((group, gi) => {
        it(`${group.description} (list mode)`, () => {
          const factory = listFactoryFor(corpus, gi);
          const sides = factory.prepare(group.schema);
          expect(sides).toBeDefined(); // the corpus must register, or the nudge is vacuous

          const prng = new Prng(
            deriveSeed(LIST_SEED, files.length + extra, gi),
          );
          const seeds = group.tests.map((t) => t.data);
          const pool = instancePool(
            prng,
            seeds,
            seeds.length + LIST_MUTATIONS_PER_GROUP,
          );
          for (let ci = 0; ci < pool.length; ci++) {
            const instance = pool[ci]!;
            listCases++;
            const interpreted = sides!.interpret(instance);
            const compiled = sides!.validate(instance);
            if (!outcomesAgree(interpreted, compiled)) {
              const subject = subjectFromFactory(factory);
              const min = minimizeDivergence(subject, group.schema, instance, {
                sameDivergence: sameListDivergenceClass,
              });
              throw new Error(
                `DIVERGENCE (list mode) ${corpus} group ${String(gi)} case ${String(ci)}\n` +
                  `  seed=0x${LIST_SEED.toString(16)} deriveSeed(${String(LIST_SEED)}, ${String(files.length + extra)}, ${String(gi)})\n` +
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

  it(`ran ≥3,000 list-mode cases with zero divergence (seed 0x${LIST_SEED.toString(16)})`, () => {
    // Floor proves the subset loop above actually executed rather than
    // silently skipping every group (the FUZZ_LIST incident's failure mode).
    expect(listCases).toBeGreaterThanOrEqual(3000);
  });
});

// Annotations leg: the list leg above referees {valid, errors} only, so an
// annotation bug (wrong value, wrong order, dropped unit, missing key) can
// hide behind agreeing errors. Same subset/budget shape as the list leg,
// plus the ANNOTATION_SEED_GROUPS corpus (the suite's schemas barely use
// pure annotation producers) which always runs, never subsetted. The full
// sweep lives in scripts/fuzz.ts (FUZZ_ANNOTATIONS=1 npm run fuzz).
const ANN_SEED = 0x9e3779b9;
const ANN_MUTATIONS_PER_GROUP = 45;

/** Annotations-mode factory: compares full {valid, errors, annotations?} output. */
function annotationsFactoryFor(
  file: string,
  groupIndex: number,
): DifferentialFactory {
  const baseUri = `https://fuzz.example/${file}/${String(groupIndex)}/ann`;
  return {
    prepare(schema) {
      try {
        const engine = createEngine();
        const uri = engine.registerSchema(schema, baseUri);
        const artifact = compileList(engine, uri, {
          errorParams: true,
          annotations: true,
        });
        return {
          interpret: runAnnotationsSide((x) => {
            const r = engine.evaluate(uri, x, {
              output: "list",
              errorParams: true,
              annotations: true,
            });
            const base = { valid: r.valid, errors: r.errors ?? [] };
            // Key presence is part of the contract: only spread annotations
            // in when the side actually produced the key.
            return r.annotations === undefined
              ? base
              : { ...base, annotations: r.annotations };
          }),
          validate: runAnnotationsSide((x) => {
            const r = artifact.evaluateList(x);
            const base = { valid: r.valid, errors: r.valid ? [] : r.errors };
            return r.annotations === undefined
              ? base
              : { ...base, annotations: r.annotations };
          }),
        };
      } catch {
        return undefined;
      }
    },
  };
}

describe("compiled ≡ interpreted annotations differential fuzz (subset)", () => {
  const files = readdirSync(SUITE_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort();

  let annCases = 0;
  let annRegistrableGroups = 0;

  const runPool = (
    factory: DifferentialFactory,
    sides: NonNullable<ReturnType<DifferentialFactory["prepare"]>>,
    file: string,
    fi: number,
    gi: number,
    group: SuiteGroup,
  ): void => {
    const prng = new Prng(deriveSeed(ANN_SEED, fi, gi));
    const seeds = group.tests.map((t) => t.data);
    const pool = instancePool(
      prng,
      seeds,
      seeds.length + ANN_MUTATIONS_PER_GROUP,
    );

    for (let ci = 0; ci < pool.length; ci++) {
      const instance = pool[ci]!;
      annCases++;
      const interpreted = sides.interpret(instance);
      const compiled = sides.validate(instance);
      if (!outcomesAgree(interpreted, compiled)) {
        const subject = subjectFromFactory(factory);
        // Class-preserving shrink: an annotation-content witness must not
        // wander into a verdict or tier-gap class while shrinking.
        const min = minimizeDivergence(subject, group.schema, instance, {
          sameDivergence: sameAnnotationsDivergenceClass,
        });
        throw new Error(
          `DIVERGENCE (annotations mode) ${file} group ${String(gi)} case ${String(ci)}\n` +
            `  seed=0x${ANN_SEED.toString(16)} deriveSeed(${String(ANN_SEED)}, ${String(fi)}, ${String(gi)})\n` +
            `  minimized schema:   ${JSON.stringify(min.schema)}\n` +
            `  minimized instance: ${JSON.stringify(min.instance)}\n` +
            `  interpreted: ${describeOutcome(min.interpreted)}\n` +
            `  compiled:    ${describeOutcome(min.compiled)}`,
        );
      }
    }
  };

  for (let fi = 0; fi < files.length; fi++) {
    const file = files[fi]!.replace(/\.json$/, "");
    const groups = JSON.parse(
      readFileSync(join(SUITE_DIR, files[fi]!), "utf8"),
    ) as SuiteGroup[];

    describe(file, () => {
      groups.forEach((group, gi) => {
        it(`${group.description} (annotations mode)`, () => {
          const factory = annotationsFactoryFor(file, gi);
          const sides = factory.prepare(group.schema);
          if (sides === undefined) return; // out of scope, same as the other legs

          annRegistrableGroups++;
          if (annRegistrableGroups % 4 !== 0) return; // subset: every 4th
          runPool(factory, sides, file, fi, gi, group);
        });
      });
    });
  }

  // The annotation-producer corpus runs in full — it exists precisely
  // because the suite under-exercises the channel, so it never subsets.
  describe("annotation-seeds", () => {
    ANNOTATION_SEED_GROUPS.forEach((group, gi) => {
      it(`${group.description} (annotations mode)`, () => {
        const factory = annotationsFactoryFor("annotation-seeds", gi);
        const sides = factory.prepare(group.schema);
        expect(sides).toBeDefined(); // the corpus must register, or the nudge is vacuous
        runPool(factory, sides!, "annotation-seeds", files.length, gi, group);
      });
    });
  });

  // The compiled-consumer corpus also runs in full here: a consumer sweep
  // both reads coverage and re-emits the annotations that fed it, so its
  // annotation output needs the same full pressure. Distinct fi so its
  // per-group seed streams never collide with annotation-seeds.
  for (const [corpus, groups, extra] of SEED_CORPORA)
    describe(corpus, () => {
      groups.forEach((group, gi) => {
        it(`${group.description} (annotations mode)`, () => {
          const factory = annotationsFactoryFor(corpus, gi);
          const sides = factory.prepare(group.schema);
          expect(sides).toBeDefined(); // the corpus must register, or the nudge is vacuous
          runPool(factory, sides!, corpus, files.length + 1 + extra, gi, group);
        });
      });
    });

  it(`ran ≥3,000 annotations-mode cases with zero divergence (seed 0x${ANN_SEED.toString(16)})`, () => {
    // Floor proves the loops above actually executed rather than silently
    // skipping every group (the FUZZ_LIST incident's failure mode).
    expect(annCases).toBeGreaterThanOrEqual(3000);
  });
});
