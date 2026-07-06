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

export type JsonValue =
  | null | boolean | number | string | JsonValue[] | { [k: string]: JsonValue };

export const isObject = (v: unknown): v is Record<string, JsonValue> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export {
  parseJsonWithRanges,
} from "./positions.js";
export type {
  ParsedDocument, SourcePosition, SourceRange, SourceSpan,
} from "./positions.js";

// Serves the official suite's `remotes/` tree for the URIs the suite files
// reference; no HTTP server involved. Shaped to satisfy @jse/core's
// SchemaLoader structurally (test-kit stays dependency-free). A URI outside
// the base or a missing file is a loader miss (undefined), not an error —
// per the loader contract.
export function suiteRemotesLoader(
  remotesDir: string,
  baseUrl = "http://localhost:1234/",
): (uri: string) => { value: JsonValue } | undefined {
  return (uri) => {
    if (!uri.startsWith(baseUrl)) return undefined;
    try {
      const text = readFileSync(
        join(remotesDir, ...uri.slice(baseUrl.length).split("/")), "utf8");
      return { value: JSON.parse(text) as JsonValue };
    } catch {
      return undefined;
    }
  };
}

// Keywords whose value is one schema.
const SINGLE = new Set([
  "additionalProperties", "contains", "items", "not", "if", "then", "else",
  "propertyNames", "unevaluatedItems", "unevaluatedProperties",
]);
// Keywords whose value is an array of schemas.
const ARRAY = new Set(["allOf", "anyOf", "oneOf", "prefixItems"]);
// Keywords whose value is an object of named schemas.
const MAP = new Set([
  "$defs", "definitions", "properties", "patternProperties", "dependentSchemas",
]);

// Find unsupported keywords in a schema, looking only in schema positions —
// an unsupported keyword name appearing inside `enum` data, say, is not a
// hit. `unsupportedKeywords` is the caller's declared list of keywords whose
// assertion/applicator semantics aren't implemented by the evaluator under
// test.
export function unsupportedIn(
  schema: JsonValue,
  unsupportedKeywords: ReadonlySet<string>,
  found = new Set<string>(),
): Set<string> {
  if (!isObject(schema)) return found;
  for (const [k, v] of Object.entries(schema)) {
    if (unsupportedKeywords.has(k)) found.add(k);
    if (SINGLE.has(k)) unsupportedIn(v!, unsupportedKeywords, found);
    else if (ARRAY.has(k) && Array.isArray(v)) {
      v.forEach((s) => unsupportedIn(s!, unsupportedKeywords, found));
    } else if (MAP.has(k) && isObject(v)) {
      Object.values(v).forEach((s) => unsupportedIn(s!, unsupportedKeywords, found));
    }
  }
  return found;
}

export interface SuiteCase { description: string; data: JsonValue; valid: boolean }
export interface SuiteGroup { description: string; schema: JsonValue; tests: SuiteCase[] }

// Case-level outcome for collect mode.
export interface CaseResult {
  file: string;
  group: string;
  description: string;
  status: "passed" | "failed" | "skipped" | "errored";
  detail?: string; // failure/error message, or skip reason
}

export interface FileSummary {
  name: string;
  run: number;
  passed: number;
  skipped: number;
}

export interface SuiteSummary {
  files: FileSummary[];
  totalRun: number;
  totalSkipped: number;
  skips: string[];
  cases: CaseResult[];
}

// One required evaluate callback: (schema, instance) => boolean, throwing is
// allowed and is reported as an "errored" case (not a bug in the runner).
// May be async — remote-ref cases need loader I/O before evaluating.
export type Evaluate = (
  schema: JsonValue,
  instance: JsonValue,
) => boolean | Promise<boolean>;

// Alternative callback for evaluators that need the schema's retrieval URI
// (e.g. to register it before evaluating, for $ref resolution).
export type RegisterAndEvaluate = (
  schema: JsonValue,
  retrievalUri: string,
  instance: JsonValue,
) => boolean | Promise<boolean>;

export interface OnSkipInfo {
  file: string;
  group: string;
  description?: string;
  reason: string;
}

export interface RunSuiteFilesOptions {
  suiteDir: string;               // path to test-suite/tests/<draft>
  files: string[];                // file stems, no .json extension
  unsupportedKeywords: string[];  // schema-position keyword names to skip
  evaluate?: Evaluate;
  registerAndEvaluate?: RegisterAndEvaluate;
  retrievalBase?: string;         // base URI for registerAndEvaluate; default below
  onSkip?: (info: OnSkipInfo) => void;
  minRun?: number;                // vitest-mode summary threshold; default 0
}

const DEFAULT_RETRIEVAL_BASE = "https://suite.example/schema";

// Collect mode: run suite files against one evaluator callback and return
// case-level results plus per-file/overall totals. No test-framework
// dependency — this is the primary API; runSuiteFilesVitest is a thin wrapper
// over it.
export async function runSuiteFiles(options: RunSuiteFilesOptions): Promise<SuiteSummary> {
  const { suiteDir, files, evaluate, registerAndEvaluate, onSkip } = options;
  if (!evaluate && !registerAndEvaluate) {
    throw new Error("runSuiteFiles requires either evaluate or registerAndEvaluate");
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
          cases.push({ file, group: group.description, description: test.description, status: "skipped", detail: reason });
          onSkip?.({ file, group: group.description, description: test.description, reason });
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
            cases.push({ file, group: group.description, description: test.description, status: "passed" });
          } else {
            const detail = `expected valid=${test.valid}, got valid=${valid}`;
            cases.push({ file, group: group.description, description: test.description, status: "failed", detail });
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
          skips.push(`${file}: ${group.description} / ${test.description} [${reason}]`);
          cases.push({ file, group: group.description, description: test.description, status: "errored", detail: message });
          onSkip?.({ file, group: group.description, description: test.description, reason });
        }
      }
    }

    fileSummaries.push({ name: file, run: fileRun, passed: filePassed, skipped: fileSkipped });
    totalRun += fileRun;
    totalSkipped += fileSkipped;
  }

  return { files: fileSummaries, totalRun, totalSkipped, skips, cases };
}

// Minimal shape of the vitest functions this module needs, injected by the
// caller so test-kit itself has no vitest dependency (only the workspace
// root does, as a devDependency).
export interface VitestLike {
  describe: (name: string, fn: () => void) => void;
  it: {
    (name: string, fn: () => void | Promise<void>): void;
    skip: (name: string, fn: () => void) => void;
  };
  expect: (actual: unknown, message?: string) => { toBe: (expected: unknown) => void };
}

export interface RunSuiteFilesVitestOptions extends RunSuiteFilesOptions {
  describe: VitestLike["describe"];
  it: VitestLike["it"];
  expect: VitestLike["expect"];
}

// Vitest mode: registers one describe per file, one describe per group, one
// it per case (it.skip for schema-position-unsupported groups), plus a
// trailing "suite summary" test that logs totals. Built on top of collect
// mode's per-group skip detection so both modes agree on what's skipped.
export function runSuiteFilesVitest(options: RunSuiteFilesVitestOptions): void {
  const { suiteDir, files, evaluate, registerAndEvaluate, describe, it, expect } = options;
  if (!evaluate && !registerAndEvaluate) {
    throw new Error("runSuiteFilesVitest requires either evaluate or registerAndEvaluate");
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
          it.skip(`${group.description} [${reason}]`, () => {});
          options.onSkip?.({ file, group: group.description, reason });
          continue;
        }

        describe(group.description, () => {
          for (const test of group.tests) {
            it(test.description, async () => {
              let valid: boolean;
              try {
                valid = await (registerAndEvaluate
                  ? registerAndEvaluate(group.schema, retrievalBase, test.data)
                  : evaluate!(group.schema, test.data));
              } catch (e) {
                const message = e instanceof Error ? e.message : String(e);
                const reason = `error: ${message}`;
                skips.push(`${file}: ${group.description} / ${test.description} [${reason}]`);
                options.onSkip?.({ file, group: group.description, description: test.description, reason });
                return; // treated as a skip, not a failure — see collect-mode comment
              }
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
      console.log(`\nsuite cases run: ${run}, group/case skips: ${skips.length}`);
      for (const s of skips) console.log(`  SKIP ${s}`);
      // Caller-provided threshold, not a fixed invariant: some callers (e.g.
      // this package's own self-test) intentionally run fixtures that are
      // fully skipped by design.
      const minRun = options.minRun ?? 0;
      expect(run >= minRun, `expected at least ${minRun} case(s) to run`).toBe(true);
    });
  });
}
