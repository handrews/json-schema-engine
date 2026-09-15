// Optional format suite, draft-07, asserting configuration (M7). draft-07's
// optional/format/ directory has no uuid.json or duration.json — the format
// table derivation (FORMATS_DRAFT_07) already omits both, consistently.

import { describe, it, expect } from "vitest";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runSuiteFilesVitest } from "@json-schema-engine/test-kit";
import { createEngine, DIALECT_DRAFT_07 } from "@json-schema-engine/core";
import { FORMATS_DRAFT_07 } from "@json-schema-engine/formats";

const SUITE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "test-suite",
  "tests",
  "draft7",
  "optional",
  "format",
);

const FILES = [
  "ipv6",
  "unknown",
  "date",
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
      defaultDialect: DIALECT_DRAFT_07,
      formats: FORMATS_DRAFT_07,
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
