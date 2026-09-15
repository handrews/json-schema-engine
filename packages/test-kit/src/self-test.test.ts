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
// Collect mode (no test-framework dependency) is exercised directly.
// Vitest mode is exercised through a RECORDING VitestLike implementation,
// never the real vitest functions: the fixtures deliberately produce skips
// and failures, and injecting real vitest would surface those in the repo's
// test totals — the repo invariant is 0 skipped, so the expected skips must
// be reported as passing assertions about the recorder's contents.

import { describe, it, expect } from "vitest";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  runSuiteFiles,
  runSuiteFilesVitest,
  type JsonValue,
  type VitestLike,
} from "./index.js";

const SUITE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "test-suite",
  "tests",
  "draft2020-12",
);

const alwaysTrue = (_schema: JsonValue, _instance: JsonValue): boolean => true;
const notImplemented = (): boolean => {
  throw new Error("not implemented");
};

describe("@json-schema-engine/test-kit runSuiteFiles (collect mode)", () => {
  it("skips every case when the file's only keyword is declared unsupported", async () => {
    const summary = await runSuiteFiles({
      suiteDir: SUITE_DIR,
      files: ["type"],
      unsupportedKeywords: ["type"],
      evaluate: notImplemented,
    });

    expect(summary.totalRun).toBe(0);
    expect(summary.totalSkipped).toBe(80);
    expect(summary.files).toEqual([
      { name: "type", run: 0, passed: 0, skipped: 80 },
    ]);
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
    expect(summary.files).toEqual([
      { name: "enum", run: 51, passed: 22, skipped: 0 },
    ]);
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

// Recording VitestLike: registration collects test bodies without running
// them (mirroring vitest's collect-then-run), `execute()` runs them
// sequentially so the runner's internal case counter increments in order,
// and `expect` records pass/fail instead of throwing so failure-path
// behavior (the exactRun summary tripping) is assertable, not fatal.
interface Recorder {
  vitest: Pick<VitestLike, "describe" | "it" | "expect">;
  skipped: string[];
  registered: () => string[];
  expectations: { pass: boolean; message: string | undefined }[];
  thrown: { name: string; message: string }[];
  execute: () => Promise<void>;
}

function makeRecorder(): Recorder {
  const bodies: { name: string; fn: () => void | Promise<void> }[] = [];
  const skipped: string[] = [];
  const expectations: Recorder["expectations"] = [];
  const thrown: Recorder["thrown"] = [];

  const itFn = (name: string, fn: () => void | Promise<void>): void => {
    bodies.push({ name, fn });
  };
  const vitest: Recorder["vitest"] = {
    describe: (_name, fn) => {
      fn();
    },
    it: Object.assign(itFn, {
      skip: (name: string, _fn: () => void): void => {
        skipped.push(name);
      },
    }),
    expect: (actual, message) => ({
      toBe: (expected) => {
        expectations.push({ pass: actual === expected, message });
      },
    }),
  };

  return {
    vitest,
    skipped,
    registered: () => bodies.map((b) => b.name),
    expectations,
    thrown,
    execute: async () => {
      for (const body of bodies) {
        try {
          await body.fn();
        } catch (e) {
          thrown.push({
            name: body.name,
            message: e instanceof Error ? e.message : String(e),
          });
        }
      }
    },
  };
}

describe("@json-schema-engine/test-kit runSuiteFilesVitest (recorder harness)", () => {
  it("registers a skip per unsupported group and runs no case bodies", async () => {
    const recorder = makeRecorder();
    runSuiteFilesVitest({
      suiteDir: SUITE_DIR,
      files: ["type"],
      unsupportedKeywords: ["type"],
      evaluate: notImplemented,
      ...recorder.vitest,
    });
    await recorder.execute();

    expect(recorder.skipped.length).toBe(11); // every group in type.json
    expect(recorder.skipped.every((name) => name.endsWith("[uses type]"))).toBe(
      true,
    );
    expect(recorder.registered()).toEqual(["reports coverage"]); // summary only
    expect(recorder.thrown).toEqual([]);
    expect(recorder.expectations).toEqual([
      { pass: true, message: "expected at least 0 case(s) to run" },
    ]);
  });

  it("agrees with collect mode's pass/fail counts and satisfies exactRun", async () => {
    const recorder = makeRecorder();
    runSuiteFilesVitest({
      suiteDir: SUITE_DIR,
      files: ["enum"],
      unsupportedKeywords: [],
      evaluate: alwaysTrue,
      exactRun: 51,
      ...recorder.vitest,
    });
    await recorder.execute();

    expect(recorder.skipped).toEqual([]);
    expect(recorder.registered().length).toBe(52); // 51 cases + summary
    const cases = recorder.expectations.slice(0, -1);
    expect(cases.filter((e) => e.pass).length).toBe(22);
    expect(cases.filter((e) => !e.pass).length).toBe(29);
    expect(recorder.expectations.at(-1)).toEqual({
      pass: true,
      message: "expected exactly 51 case(s) to run, got 51",
    });
  });

  it("propagates evaluation errors as case failures, not silent skips", async () => {
    const recorder = makeRecorder();
    runSuiteFilesVitest({
      suiteDir: SUITE_DIR,
      files: ["enum"],
      unsupportedKeywords: [],
      evaluate: notImplemented,
      ...recorder.vitest,
    });
    await recorder.execute();

    expect(recorder.skipped).toEqual([]);
    expect(recorder.thrown.length).toBe(51);
    expect(recorder.thrown.every((t) => t.message === "not implemented")).toBe(
      true,
    );
  });

  it("fails the exactRun summary when errors prevent cases from running", async () => {
    const recorder = makeRecorder();
    runSuiteFilesVitest({
      suiteDir: SUITE_DIR,
      files: ["enum"],
      unsupportedKeywords: [],
      evaluate: notImplemented,
      exactRun: 51,
      ...recorder.vitest,
    });
    await recorder.execute();

    expect(recorder.expectations.at(-1)).toEqual({
      pass: false,
      message: "expected exactly 51 case(s) to run, got 0",
    });
  });
});
