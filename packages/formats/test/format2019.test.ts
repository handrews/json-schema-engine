// Optional format suite, draft 2019-09, asserting configuration (M7).
// 2019-09 shares 2020-12's format list (FORMATS_2019_09 re-exports it), and
// its optional/format/ directory carries the same file set.

import { describe, it, expect } from "vitest";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runSuiteFilesVitest } from "@jse/test-kit";
import { createEngine, DIALECT_2019_09 } from "@jse/core";
import { FORMATS_2019_09 } from "@jse/formats";

const SUITE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "test-suite",
  "tests",
  "draft2019-09",
  "optional",
  "format",
);

const FILES = [
  "uuid",
  "ipv6",
  "unknown",
  "date",
  "duration",
  "hostname",
  "ipv4",
  "json-pointer",
  "relative-json-pointer",
  "regex",
  "uri",
  "uri-reference",
  "uri-template",
  "email",
  "iri",
  "iri-reference",
  "date-time",
  "time",
  "idn-hostname",
  "idn-email",
];

runSuiteFilesVitest({
  suiteDir: SUITE_DIR,
  files: FILES,
  unsupportedKeywords: [],
  registerAndEvaluate: (schema, retrievalUri, instance) => {
    const engine = createEngine({
      defaultDialect: DIALECT_2019_09,
      formats: FORMATS_2019_09,
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
