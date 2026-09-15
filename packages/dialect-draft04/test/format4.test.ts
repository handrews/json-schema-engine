// Optional format suite, draft-04, asserting configuration. draft-04
// defines only date-time/email/hostname/ipv4/ipv6/uri; FORMATS_DRAFT_04
// matches, so everything else (unknown.json) stays best-effort annotation.
// The format behavior itself is harvested from draft-07 by registerDraft04,
// which is what makes the engine's formats/assertFormats options apply.

import { describe, it, expect } from "vitest";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runSuiteFilesVitest } from "@json-schema-engine/test-kit";
import { createEngine } from "@json-schema-engine/core";
import { FORMATS_DRAFT_04 } from "@json-schema-engine/formats";
import {
  registerDraft04,
  DIALECT_DRAFT_04,
} from "@json-schema-engine/dialect-draft04";

const SUITE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "test-suite",
  "tests",
  "draft4",
  "optional",
  "format",
);

const FILES = [
  "date-time",
  "email",
  "hostname",
  "ipv4",
  "ipv6",
  "unknown",
  "uri",
];

runSuiteFilesVitest({
  suiteDir: SUITE_DIR,
  files: FILES,
  unsupportedKeywords: [],
  registerAndEvaluate: (schema, retrievalUri, instance) => {
    const engine = createEngine({
      defaultDialect: DIALECT_DRAFT_04,
      formats: FORMATS_DRAFT_04,
      assertFormats: true,
    });
    registerDraft04(engine);
    const uri = engine.registerSchema(schema, retrievalUri);
    return engine.evaluate(uri, instance).valid;
  },
  minRun: 200,
  describe,
  it,
  expect: expect as never,
});
