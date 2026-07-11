// Reusable official JSON-Schema-Test-Suite runner (DESIGN.md D12).
//
// Generalizes the schema-position-only unsupported-keyword scan and
// group/test iteration from the F2 prototype (prototype/suite.test.ts) into a
// runner usable by any evaluator shape. "Collect" mode is the primary API: it
// runs suite files and returns case-level results with no test-framework
// dependency. "Vitest" mode is a thin wrapper that registers describe/it over
// collect mode, with describe/it/expect injected by the caller so this
// package does not depend on vitest itself.
//
// IP policy (DESIGN.md D15): this runner is implementation-from-spec/suite
// only; AJV and @hyperjump/json-schema are never read or ported, here or
// anywhere else in this repo.

import { readFileSync } from "node:fs";
import { join } from "node:path";

/** A JSON-representable value. */
export type JsonValue =
  null | boolean | number | string | JsonValue[] | { [k: string]: JsonValue };

/** True for JSON objects, excluding arrays and `null`. */
export const isObject = (v: unknown): v is Record<string, JsonValue> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export {
  Prng,
  deriveSeed,
  mutateInstance,
  mutateChain,
  instancePool,
  NUMERIC_EDGES,
  STRING_EDGES,
  PROTO_TRAP_KEYS,
  POINTER_ESCAPE_KEYS,
  ANNOTATION_SEED_GROUPS,
  CONSUMER_SEED_GROUPS,
} from "./fuzz.js";
export {
  runSide,
  runListSide,
  runAnnotationsSide,
  outcomesAgree,
  describeOutcome,
  minimizeDivergence,
  sameListDivergenceClass,
  sameAnnotationsDivergenceClass,
  subjectFromFactory,
} from "./differential.js";
export type {
  SideOutcome,
  DifferentialSubject,
  DifferentialSides,
  DifferentialFactory,
  Divergence,
  MinimizeOptions,
} from "./differential.js";

export { runPlanCensus } from "./census.js";
export type { PlanCensusSummary, PlanCensusResult } from "./census.js";

export { evaluateProduceRecipes } from "./produce-oracle.js";
export type {
  OracleUnit,
  OracleCoverage,
  RecipeProduction,
} from "./produce-oracle.js";

export { parseJsonWithRanges } from "./positions.js";
export type {
  ParsedDocument,
  SourcePosition,
  SourceRange,
  SourceSpan,
} from "./positions.js";

/**
 * Serves the official suite's `remotes/` tree for the URIs the suite files
 * reference; no HTTP server involved. Shaped to satisfy \@jse/core's
 * SchemaLoader structurally (test-kit stays dependency-free). A URI outside
 * the base or a missing file is a loader miss (undefined), not an error —
 * per the loader contract.
 */
export function suiteRemotesLoader(
  remotesDir: string,
  baseUrl = "http://localhost:1234/",
): (uri: string) => { value: JsonValue } | undefined {
  return (uri) => {
    if (!uri.startsWith(baseUrl)) return undefined;
    try {
      const text = readFileSync(
        join(remotesDir, ...uri.slice(baseUrl.length).split("/")),
        "utf8",
      );
      return { value: JSON.parse(text) as JsonValue };
    } catch {
      return undefined;
    }
  };
}

// Keywords whose value is one schema.
const SINGLE = new Set([
  "additionalProperties",
  "contains",
  "items",
  "not",
  "if",
  "then",
  "else",
  "propertyNames",
  "unevaluatedItems",
  "unevaluatedProperties",
]);
// Keywords whose value is an array of schemas.
const ARRAY = new Set(["allOf", "anyOf", "oneOf", "prefixItems"]);
// Keywords whose value is an object of named schemas.
const MAP = new Set([
  "$defs",
  "definitions",
  "properties",
  "patternProperties",
  "dependentSchemas",
]);

/**
 * Finds unsupported keywords in a schema, looking only in schema positions —
 * an unsupported keyword name appearing inside `enum` data, say, is not a
 * hit. `unsupportedKeywords` is the caller's declared list of keywords whose
 * assertion/applicator semantics aren't implemented by the evaluator under
 * test.
 */
export function unsupportedIn(
  schema: JsonValue,
  unsupportedKeywords: ReadonlySet<string>,
  found = new Set<string>(),
): Set<string> {
  if (!isObject(schema)) return found;
  for (const [k, v] of Object.entries(schema)) {
    if (unsupportedKeywords.has(k)) found.add(k);
    if (SINGLE.has(k)) unsupportedIn(v, unsupportedKeywords, found);
    else if (ARRAY.has(k) && Array.isArray(v)) {
      v.forEach((s) => unsupportedIn(s, unsupportedKeywords, found));
    } else if (MAP.has(k) && isObject(v)) {
      Object.values(v).forEach((s) =>
        unsupportedIn(s, unsupportedKeywords, found),
      );
    }
  }
  return found;
}

/** One official-suite test case. */
export interface SuiteCase {
  description: string;
  data: JsonValue;
  valid: boolean;
}
/** One official-suite test group: a schema plus its test cases. */
export interface SuiteGroup {
  description: string;
  schema: JsonValue;
  tests: SuiteCase[];
}

/** Case-level outcome for collect mode. */
export interface CaseResult {
  file: string;
  group: string;
  description: string;
  status: "passed" | "failed" | "skipped" | "errored";
  /** Failure/error message, or skip reason. */
  detail?: string;
}

/** Per-file case counts. */
export interface FileSummary {
  name: string;
  run: number;
  passed: number;
  skipped: number;
}

/** Overall result of {@link runSuiteFiles}. */
export interface SuiteSummary {
  files: FileSummary[];
  totalRun: number;
  totalSkipped: number;
  skips: string[];
  cases: CaseResult[];
}

/**
 * Evaluate callback: `(schema, instance) => boolean`. Throwing is allowed
 * and is reported as an "errored" case, not a bug in the runner. May be
 * async — remote-ref cases need loader I/O before evaluating.
 */
export type Evaluate = (
  schema: JsonValue,
  instance: JsonValue,
) => boolean | Promise<boolean>;

/**
 * Alternative callback for evaluators that need the schema's retrieval URI
 * (e.g. to register it before evaluating, for `$ref` resolution).
 */
export type RegisterAndEvaluate = (
  schema: JsonValue,
  retrievalUri: string,
  instance: JsonValue,
) => boolean | Promise<boolean>;

/** Info passed to {@link RunSuiteFilesOptions.onSkip}. */
export interface OnSkipInfo {
  file: string;
  group: string;
  description?: string;
  reason: string;
}

/** Options for {@link runSuiteFiles} and {@link runSuiteFilesVitest}. */
export interface RunSuiteFilesOptions {
  /** Path to test-suite/tests/\<draft\>. */
  suiteDir: string;
  /** File stems, no .json extension. */
  files: string[];
  /** Schema-position keyword names to skip. */
  unsupportedKeywords: string[];
  evaluate?: Evaluate;
  registerAndEvaluate?: RegisterAndEvaluate;
  /** Base URI for `registerAndEvaluate`; default {@link DEFAULT_RETRIEVAL_BASE}. */
  retrievalBase?: string;
  onSkip?: (info: OnSkipInfo) => void;
  /** vitest-mode summary threshold; default 0. */
  minRun?: number;
  /**
   * vitest-mode exact-count assertion, for legs where the suite is fixed
   * (a submodule pin, not a growing local fixture set): when set, the
   * summary asserts `run === exactRun` instead of `run >= minRun`, so a
   * deliberate suite-submodule bump is a one-glance count update rather
   * than a silent pass-through.
   */
  exactRun?: number;
}

const DEFAULT_RETRIEVAL_BASE = "https://suite.example/schema";

/**
 * Collect mode: runs suite files against one evaluator callback and returns
 * case-level results plus per-file/overall totals. No test-framework
 * dependency — this is the primary API; {@link runSuiteFilesVitest} is a
 * thin wrapper over it.
 * @throws Error if neither `evaluate` nor `registerAndEvaluate` is supplied.
 */
export async function runSuiteFiles(
  options: RunSuiteFilesOptions,
): Promise<SuiteSummary> {
  const { suiteDir, files, evaluate, registerAndEvaluate, onSkip } = options;
  if (!evaluate && !registerAndEvaluate) {
    throw new Error(
      "runSuiteFiles requires either evaluate or registerAndEvaluate",
    );
  }
  const unsupportedKeywords = new Set(options.unsupportedKeywords);
  const retrievalBase = options.retrievalBase ?? DEFAULT_RETRIEVAL_BASE;

  const fileSummaries: FileSummary[] = [];
  const skips: string[] = [];
  const cases: CaseResult[] = [];
  let totalRun = 0;
  let totalSkipped = 0;

  for (const file of files) {
    const groups = JSON.parse(
      readFileSync(join(suiteDir, `${file}.json`), "utf8"),
    ) as SuiteGroup[];

    let fileRun = 0;
    let filePassed = 0;
    let fileSkipped = 0;

    for (const group of groups) {
      const unsupported = unsupportedIn(group.schema, unsupportedKeywords);
      if (unsupported.size > 0) {
        const reason = `uses ${[...unsupported].join(", ")}`;
        for (const test of group.tests) {
          const detail = `${group.description} / ${test.description} [${reason}]`;
          skips.push(`${file}: ${detail}`);
          cases.push({
            file,
            group: group.description,
            description: test.description,
            status: "skipped",
            detail: reason,
          });
          onSkip?.({
            file,
            group: group.description,
            description: test.description,
            reason,
          });
        }
        fileSkipped += group.tests.length;
        continue;
      }

      for (const test of group.tests) {
        fileRun++;
        try {
          const valid = await (registerAndEvaluate
            ? registerAndEvaluate(group.schema, retrievalBase, test.data)
            : evaluate!(group.schema, test.data));
          if (valid === test.valid) {
            filePassed++;
            cases.push({
              file,
              group: group.description,
              description: test.description,
              status: "passed",
            });
          } else {
            const detail = `expected valid=${test.valid}, got valid=${valid}`;
            cases.push({
              file,
              group: group.description,
              description: test.description,
              status: "failed",
              detail,
            });
          }
        } catch (e) {
          // A thrown error (e.g. unresolvable remote ref) is reported as a
          // skip-by-error, mirroring the prototype's UnresolvableRefError
          // handling: it's out of the evaluator's declared scope, not a bug
          // in the runner, but it must not silently count as a pass.
          const message = e instanceof Error ? e.message : String(e);
          fileRun--;
          fileSkipped++;
          const reason = `error: ${message}`;
          skips.push(
            `${file}: ${group.description} / ${test.description} [${reason}]`,
          );
          cases.push({
            file,
            group: group.description,
            description: test.description,
            status: "errored",
            detail: message,
          });
          onSkip?.({
            file,
            group: group.description,
            description: test.description,
            reason,
          });
        }
      }
    }

    fileSummaries.push({
      name: file,
      run: fileRun,
      passed: filePassed,
      skipped: fileSkipped,
    });
    totalRun += fileRun;
    totalSkipped += fileSkipped;
  }

  return { files: fileSummaries, totalRun, totalSkipped, skips, cases };
}

// Official output-tests runner (test-suite/output-tests, DESIGN.md M5): each
// group carries its own schema+data; each test names an output-format key
// (only "basic" is populated as of this writing per output-tests/README) with
// an output-validating schema. The runner is evaluator-agnostic like
// runSuiteFiles above — the caller supplies both the evaluate-to-document
// step and the self-validate-the-document step, keeping test-kit dependency-
// free of @jse/core.

/** One official output-tests test case: an instance plus its expected document per output format. */
export interface OutputTestCase {
  description: string;
  data: JsonValue;
  /** Keyed by format: "basic" | "list" | "detailed" | "verbose". */
  output: Record<string, JsonValue>;
}
/** One official output-tests test group: a schema plus its test cases. */
export interface OutputTestGroup {
  description: string;
  schema: JsonValue;
  tests: OutputTestCase[];
}

/** Case-level outcome for {@link runOutputTests}. */
export interface OutputCaseResult {
  file: string;
  group: string;
  description: string;
  status: "passed" | "failed" | "skipped";
  detail?: string;
}

/** Overall result of {@link runOutputTests}. */
export interface OutputTestSummary {
  totalRun: number;
  totalSkipped: number;
  cases: OutputCaseResult[];
}

/** Options for {@link runOutputTests}. */
export interface RunOutputTestsOptions {
  /** Path to test-suite/output-tests/\<draft\>/content. */
  contentDir: string;
  /** File stems, no .json extension. */
  files: string[];
  /** format keys this runner can produce a document for; others are skipped */
  supportedFormats: readonly string[];
  /**
   * Evaluate `data` against `schema` (registered at `retrievalUri`), render
   * the named format, and return the document as plain JSON.
   */
  renderDocument: (
    schema: JsonValue,
    retrievalUri: string,
    data: JsonValue,
    format: string,
  ) => JsonValue | Promise<JsonValue>;
  /**
   * Validate `document` against the case's `outputSchema` using the
   * evaluator's own engine — "the output document must validate" is the
   * pass condition, not a structural diff. `outputSchemaUri` is a fallback
   * retrieval URI for schemas without their own `$id` (the vendored fixtures
   * all carry one).
   */
  validateDocument: (
    outputSchema: JsonValue,
    outputSchemaUri: string,
    document: JsonValue,
  ) => boolean | Promise<boolean>;
  /** base URI for the fallback retrieval URIs above; per-file/group/test */
  retrievalBase?: string;
  onSkip?: (info: {
    file: string;
    group: string;
    description: string;
    reason: string;
  }) => void;
}

const OUTPUT_TEST_RETRIEVAL_BASE = "https://output-suite.example/schema";

/**
 * Runs the official output-tests fixtures against the caller-supplied
 * render/validate steps. Sequential (not vitest-mode): callers drive vitest
 * describe/it themselves since they also need to register per-draft
 * output-schema documents once, outside the per-case loop.
 */
export async function runOutputTests(
  options: RunOutputTestsOptions,
): Promise<OutputTestSummary> {
  const {
    contentDir,
    files,
    supportedFormats,
    renderDocument,
    validateDocument,
    onSkip,
  } = options;
  const formats = new Set(supportedFormats);
  const retrievalBase = options.retrievalBase ?? OUTPUT_TEST_RETRIEVAL_BASE;

  const cases: OutputCaseResult[] = [];
  let totalRun = 0;
  let totalSkipped = 0;

  for (const file of files) {
    const groups = JSON.parse(
      readFileSync(join(contentDir, `${file}.json`), "utf8"),
    ) as OutputTestGroup[];

    for (let groupIndex = 0; groupIndex < groups.length; groupIndex++) {
      const group = groups[groupIndex]!;
      const retrievalUri = `${retrievalBase}/${file}/${groupIndex}`;
      for (let testIndex = 0; testIndex < group.tests.length; testIndex++) {
        const test = group.tests[testIndex]!;
        const availableFormats = Object.keys(test.output);
        const format = availableFormats.find((f) => formats.has(f));
        if (format === undefined) {
          const reason = `no supported format among [${availableFormats.join(", ")}]`;
          totalSkipped++;
          cases.push({
            file,
            group: group.description,
            description: test.description,
            status: "skipped",
            detail: reason,
          });
          onSkip?.({
            file,
            group: group.description,
            description: test.description,
            reason,
          });
          continue;
        }
        totalRun++;
        const outputSchema = test.output[format]!;
        const outputSchemaUri = `${retrievalUri}/tests/${testIndex}/${format}`;
        const document = await renderDocument(
          group.schema,
          retrievalUri,
          test.data,
          format,
        );
        const valid = await validateDocument(
          outputSchema,
          outputSchemaUri,
          document,
        );
        cases.push({
          file,
          group: group.description,
          description: test.description,
          status: valid ? "passed" : "failed",
          detail: valid
            ? undefined
            : `document ${JSON.stringify(document)} failed its output schema`,
        });
      }
    }
  }
  return { totalRun, totalSkipped, cases };
}

/**
 * Minimal shape of the vitest functions this module needs, injected by the
 * caller so test-kit itself has no vitest dependency (only the workspace
 * root does, as a devDependency).
 */
export interface VitestLike {
  describe: (name: string, fn: () => void) => void;
  it: {
    (name: string, fn: () => void | Promise<void>): void;
    skip: (name: string, fn: () => void) => void;
  };
  expect: (
    actual: unknown,
    message?: string,
  ) => { toBe: (expected: unknown) => void };
}

/** Options for {@link runSuiteFilesVitest}. */
export interface RunSuiteFilesVitestOptions extends RunSuiteFilesOptions {
  describe: VitestLike["describe"];
  it: VitestLike["it"];
  expect: VitestLike["expect"];
}

/**
 * Vitest mode: registers one describe per file, one describe per group, one
 * it per case (it.skip for schema-position-unsupported groups), plus a
 * trailing "suite summary" test that logs totals. Shares collect mode's
 * per-group skip detection so both modes agree on what a group-level skip
 * is; evaluation-error semantics deliberately differ — see the case body.
 * @throws Error if neither `evaluate` nor `registerAndEvaluate` is supplied.
 */
export function runSuiteFilesVitest(options: RunSuiteFilesVitestOptions): void {
  const {
    suiteDir,
    files,
    evaluate,
    registerAndEvaluate,
    describe,
    it,
    expect,
  } = options;
  if (!evaluate && !registerAndEvaluate) {
    throw new Error(
      "runSuiteFilesVitest requires either evaluate or registerAndEvaluate",
    );
  }
  const unsupportedKeywords = new Set(options.unsupportedKeywords);
  const retrievalBase = options.retrievalBase ?? DEFAULT_RETRIEVAL_BASE;

  const skips: string[] = [];
  let run = 0;

  for (const file of files) {
    const groups = JSON.parse(
      readFileSync(join(suiteDir, `${file}.json`), "utf8"),
    ) as SuiteGroup[];

    describe(file, () => {
      for (const group of groups) {
        const unsupported = unsupportedIn(group.schema, unsupportedKeywords);
        if (unsupported.size > 0) {
          const reason = `uses ${[...unsupported].join(", ")}`;
          skips.push(`${file}: ${group.description} [${reason}]`);
          // Empty body: vitest's `it.skip` requires a callback even though a skipped test never runs it.
          // eslint-disable-next-line @typescript-eslint/no-empty-function
          it.skip(`${group.description} [${reason}]`, () => {});
          options.onSkip?.({ file, group: group.description, reason });
          continue;
        }

        describe(group.description, () => {
          for (const test of group.tests) {
            it(test.description, async () => {
              // No error tolerance here, unlike collect mode: vitest mode is
              // the CI conformance gate, where a thrown evaluation error is
              // always a regression (zero-skip discipline), so it propagates
              // and fails the case with the real stack. Collect mode stays
              // tolerant — programmatic callers inspect "errored" statuses
              // and set policy themselves.
              const valid = await (registerAndEvaluate
                ? registerAndEvaluate(group.schema, retrievalBase, test.data)
                : evaluate!(group.schema, test.data));
              run++;
              expect(valid, `expected valid=${test.valid}`).toBe(test.valid);
            });
          }
        });
      }
    });
  }

  describe("suite summary", () => {
    it("reports coverage", () => {
      console.log(
        `\nsuite cases run: ${run}, group/case skips: ${skips.length}`,
      );
      for (const s of skips) console.log(`  SKIP ${s}`);
      // Caller-provided threshold, not a fixed invariant: some callers (e.g.
      // this package's own self-test) intentionally run fixtures that are
      // fully skipped by design.
      if (options.exactRun !== undefined) {
        const exactRun = options.exactRun;
        expect(
          run === exactRun,
          `expected exactly ${exactRun} case(s) to run, got ${run}`,
        ).toBe(true);
      } else {
        const minRun = options.minRun ?? 0;
        expect(
          run >= minRun,
          `expected at least ${minRun} case(s) to run`,
        ).toBe(true);
      }
    });
  });
}
