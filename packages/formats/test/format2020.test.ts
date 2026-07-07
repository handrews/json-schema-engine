// Optional format suite, draft 2020-12, asserting configuration (M7).
// FILES grows format-by-format as implementations land; the zero-skip
// discipline applies to the listed files at every step. unknown.json runs
// from day one: unrecognized formats annotate (best-effort assertFormats
// posture), so its cases pass with no implementation at all.

import { describe, it, expect } from "vitest";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runSuiteFilesVitest } from "@jse/test-kit";
import { createEngine } from "@jse/core";
import { FORMATS_2020_12 } from "@jse/formats";

const SUITE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "test-suite",
  "tests",
  "draft2020-12",
  "optional",
  "format",
);

// Exemplars now; the M7 fan-out appends one entry per landed format.
const FILES = ["uuid", "ipv6", "unknown"];

runSuiteFilesVitest({
  suiteDir: SUITE_DIR,
  files: FILES,
  unsupportedKeywords: [],
  registerAndEvaluate: (schema, retrievalUri, instance) => {
    const engine = createEngine({
      formats: FORMATS_2020_12,
      assertFormats: true,
    });
    const uri = engine.registerSchema(schema, retrievalUri);
    return engine.evaluate(uri, instance).valid;
  },
  minRun: 30,
  describe,
  it,
  expect: expect as never,
});
