// Self-test for the suite-runner machinery itself (not a conformance test):
// asserts that collect mode's skip detection and pass/fail counting are
// correct, independent of any real evaluator. Two fixtures from the vendored
// official suite (test-suite/tests/draft2020-12) drive it:
//
//  - "type" with unsupportedKeywords: ["type"] — every group in type.json
//    uses `type` at the schema-position top level, so every one of its 80
//    cases must be reported skipped, none run.
//  - "enum" with an always-true evaluate — enum.json has 51 cases, 22
//    expected valid / 29 expected invalid; an evaluator that always returns
//    true must pass exactly the 22 valid-expected cases and fail the other
//    29, with nothing skipped (no unsupported keywords declared).
//
// Collect mode (no test-framework dependency) is exercised directly; a small
// vitest-mode check confirms the thin wrapper agrees with collect mode's
// counts.

import { describe, it, expect } from "vitest";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { runSuiteFiles, runSuiteFilesVitest, type JsonValue } from "./index.js";

const SUITE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..", "..", "..", "test-suite", "tests", "draft2020-12",
);

const alwaysTrue = (_schema: JsonValue, _instance: JsonValue): boolean => true;
const notImplemented = (): boolean => {
  throw new Error("not implemented");
};

describe("@jse/test-kit runSuiteFiles (collect mode)", () => {
  it("skips every case when the file's only keyword is declared unsupported", async () => {
    const summary = await runSuiteFiles({
      suiteDir: SUITE_DIR,
      files: ["type"],
      unsupportedKeywords: ["type"],
      evaluate: notImplemented,
    });

    expect(summary.totalRun).toBe(0);
    expect(summary.totalSkipped).toBe(80);
    expect(summary.files).toEqual([{ name: "type", run: 0, passed: 0, skipped: 80 }]);
    expect(summary.cases.length).toBe(80);
    expect(summary.cases.every((c) => c.status === "skipped")).toBe(true);
  });

  it("counts run/passed/failed correctly for an always-true evaluator", async () => {
    const summary = await runSuiteFiles({
      suiteDir: SUITE_DIR,
      files: ["enum"],
      unsupportedKeywords: [],
      evaluate: alwaysTrue,
    });

    const passed = summary.cases.filter((c) => c.status === "passed").length;
    const failed = summary.cases.filter((c) => c.status === "failed").length;

    expect(summary.totalRun).toBe(51);
    expect(summary.totalSkipped).toBe(0);
    expect(passed).toBe(22); // cases where valid=true, so always-true agrees
    expect(failed).toBe(29); // cases where valid=false, so always-true disagrees
    expect(passed + failed).toBe(summary.totalRun);
    expect(summary.files).toEqual([{ name: "enum", run: 51, passed: 22, skipped: 0 }]);
  });

  it("reports thrown evaluator errors as skips, not silent passes", async () => {
    const summary = await runSuiteFiles({
      suiteDir: SUITE_DIR,
      files: ["enum"],
      unsupportedKeywords: [],
      evaluate: notImplemented,
    });

    expect(summary.totalRun).toBe(0);
    expect(summary.totalSkipped).toBe(51);
    expect(summary.cases.every((c) => c.status === "errored")).toBe(true);
    expect(summary.skips.length).toBe(51);
  });
});

// Vitest-mode wrapper: confirm it agrees with collect mode by construction
// (it shares the same unsupportedIn/group-iteration logic) using the same
// two fixtures, registered as real vitest tests.
runSuiteFilesVitest({
  suiteDir: SUITE_DIR,
  files: ["type"],
  unsupportedKeywords: ["type"],
  evaluate: notImplemented,
  describe,
  it,
  expect,
});
