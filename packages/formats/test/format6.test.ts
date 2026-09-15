// Optional format suite, draft-06, asserting configuration (M7). draft-06's
// optional/format/ directory is the smallest: no date.json, duration.json,
// regex.json, relative-json-pointer.json, time.json, iri.json, or
// iri-reference.json — FORMATS_DRAFT_06 already omits uuid/duration/iri/
// iri-reference/idn-* consistently with what's absent here.

import { describe, it, expect } from "vitest";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runSuiteFilesVitest } from "@json-schema-engine/test-kit";
import { createEngine, DIALECT_DRAFT_06 } from "@json-schema-engine/core";
import { FORMATS_DRAFT_06 } from "@json-schema-engine/formats";

const SUITE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "test-suite",
  "tests",
  "draft6",
  "optional",
  "format",
);

const FILES = [
  "ipv6",
  "unknown",
  "hostname",
  "ipv4",
  "json-pointer",
  "uri",
  "uri-reference",
  "uri-template",
  "email",
  "date-time",
];

runSuiteFilesVitest({
  suiteDir: SUITE_DIR,
  files: FILES,
  unsupportedKeywords: [],
  registerAndEvaluate: (schema, retrievalUri, instance) => {
    const engine = createEngine({
      defaultDialect: DIALECT_DRAFT_06,
      formats: FORMATS_DRAFT_06,
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
