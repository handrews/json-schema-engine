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
//   FUZZ_LIST=1 npm run fuzz           # referee full list output
//   FUZZ_ANNOTATIONS=1 npm run fuzz    # referee list output + annotations
//   FUZZ_EVALUATOR=1 npm run fuzz      # referee the compiled evaluator (relevant + verbose)
//
// Deterministic: the summary reports the seed, and every case reproduces
// from (seed, fileIndex, groupIndex, caseIndex). Exit code is nonzero on any
// divergence, with the minimized (schema, instance) repro printed.

import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createEngine, type Engine, type JsonValue } from "@jse/core";
import { compileEvaluator, compileList, compileValidator } from "@jse/compiler";
import { DIALECT_DRAFT_04, registerDraft04 } from "@jse/dialect-draft04";
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
// FUZZ_ANNOTATIONS=1 referees annotation parity on top of the list encoding:
// both sides' {valid, errors, annotations?} results are compared as canonical
// JSON, so the comparison covers every annotation unit (keyword, vocabulary,
// locations, value) in ORDER, and the presence/absence of the annotations key
// itself. The suite corpus is extended with ANNOTATION_SEED_GROUPS because
// suite schemas barely use pure annotation producers. Takes precedence over
// FUZZ_LIST (it is a strict superset of that comparison), but yields to
// FUZZ_EVALUATOR below.
const ANNOTATIONS_MODE = process.env.FUZZ_ANNOTATIONS === "1";
// FUZZ_EVALUATOR=1 referees compileEvaluator against the interpreter over the
// WHOLE Result — hierarchical output with trace, errorParams, and every
// annotation — canonicalized the same way as the list/annotations legs
// (runListSide over the raw Result rather than a hand-picked subset), so the
// comparison covers errors, annotations, and the trace tree together in one
// pass. Both levels are refereed in one leg: a relevant artifact and a
// verbose artifact are compiled from the same schema and each side encodes
// one `{ relevant, verbose }` object, so a single divergence report pins
// which level (or both) disagreed. The verbose side compares the whole
// Result, droppedErrors/droppedAnnotations included — the retention channel
// has no relevant-level analogue to referee any other way. A strict superset
// of the FUZZ_ANNOTATIONS comparison, so it takes precedence over both
// FUZZ_ANNOTATIONS and FUZZ_LIST. Seeds from ANNOTATION_SEED_GROUPS exactly
// like FUZZ_ANNOTATIONS, for the same reason.
const EVALUATOR_MODE = process.env.FUZZ_EVALUATOR === "1";
const MODE_NAME = EVALUATOR_MODE
  ? "evaluator"
  : ANNOTATIONS_MODE
    ? "annotations"
    : LIST_MODE
      ? "list"
      : "flag";

// FUZZ_DIALECT seeds the corpus from another dialect's suite directory
// (M6.6: legacy dialects compile natively, so they need fuzz pressure too).
const DIALECTS: Record<
  string,
  { dir: string; uri?: string; setup?: (engine: Engine) => void }
> = {
  "draft2020-12": { dir: "draft2020-12" },
  "draft2019-09": {
    dir: "draft2019-09",
    uri: "https://json-schema.org/draft/2019-09/schema",
  },
  draft7: { dir: "draft7", uri: "http://json-schema.org/draft-07/schema" },
  draft6: { dir: "draft6", uri: "http://json-schema.org/draft-06/schema" },
  // The dialect package registers its keywords through the public surface.
  draft4: { dir: "draft4", uri: DIALECT_DRAFT_04, setup: registerDraft04 },
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
// Hoisted so the factory closure sees the narrowed dialect entry.
const DIALECT_SETUP = DIALECT.setup;

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
        DIALECT_SETUP?.(engine);
        const uri = engine.registerSchema(schema, baseUri);
        if (EVALUATOR_MODE) {
          const relevantArtifact = compileEvaluator(engine, uri, {
            ...COMPILE_OPTS,
            errorParams: true,
            annotations: true,
          });
          const verboseArtifact = compileEvaluator(engine, uri, {
            ...COMPILE_OPTS,
            errorParams: true,
            annotations: true,
            verbose: true,
          });
          return {
            interpret: runListSide((x) => ({
              relevant: engine.evaluate(uri, x, {
                output: "hierarchical",
                trace: true,
                annotations: true,
                errorParams: true,
              }),
              verbose: engine.evaluate(uri, x, {
                output: "hierarchical",
                trace: true,
                annotations: true,
                errorParams: true,
                verbose: true,
              }),
            })),
            validate: runListSide((x) => ({
              relevant: relevantArtifact.evaluate(x, {
                output: "hierarchical",
                trace: true,
              }),
              verbose: verboseArtifact.evaluate(x, {
                output: "hierarchical",
                verbose: true,
                trace: true,
              }),
            })),
          };
        }
        if (ANNOTATIONS_MODE) {
          const artifact = compileList(engine, uri, {
            ...COMPILE_OPTS,
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
              // Key presence is part of the contract: only spread the
              // annotations in when the side actually produced the key.
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
        }
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
  if (ANNOTATIONS_MODE || EVALUATOR_MODE) {
    // Annotation-producer corpus, appended exactly like another suite file.
    // FUZZ_EVALUATOR seeds it too: its comparison is a strict superset of
    // the annotations one, so it needs the same pressure.
    ANNOTATION_SEED_GROUPS.forEach((group, gi) => {
      const baseUri = `https://fuzz.example/annotation-seeds/${String(gi)}`;
      if (factoryFor(baseUri).prepare(group.schema) === undefined) return;
      registrable.push({
        file: "annotation-seeds",
        fi: files.length,
        gi,
        group,
      });
    });
  }
  // Compiled-consumer corpus (COMPILED-CONSUMERS.md phase B). Unlike the
  // annotation seeds, these matter in EVERY mode — the default flag leg is
  // exactly what runs coverage tracking, and list/annotations exercise the
  // same consumer sweeps — so they append regardless of FUZZ_LIST/ANNOTATIONS.
  CONSUMER_SEED_GROUPS.forEach((group, gi) => {
    const baseUri = `https://fuzz.example/consumer-seeds/${String(gi)}`;
    if (factoryFor(baseUri).prepare(group.schema) === undefined) return;
    registrable.push({
      file: "consumer-seeds",
      fi: files.length + 1,
      gi,
      group,
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
        // List/annotation witnesses must keep their divergence class while
        // shrinking, or a real content bug minimizes into an unrelated tier gap.
        const min = minimizeDivergence(
          subject,
          group.schema,
          instance,
          EVALUATOR_MODE
            ? { sameDivergence: sameListDivergenceClass }
            : ANNOTATIONS_MODE
              ? { sameDivergence: sameAnnotationsDivergenceClass }
              : LIST_MODE
                ? { sameDivergence: sameListDivergenceClass }
                : {},
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
      `mode=${MODE_NAME} dialect=${DIALECT_NAME} seed=0x${SEED.toString(16)} groups=${String(registrable.length)} ` +
      `perGroup=${String(perGroup)} ms=${String(ms)}`,
  );
  if (divergences > 0) process.exitCode = 1;
}

main();
