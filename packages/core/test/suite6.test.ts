// Official-suite conformance for @jse/core's draft-06 dialect (M4-B).
// Full draft6 file list (no optional/); nothing may be skipped (UNSUPPORTED: []).

import { describe, it, expect } from "vitest";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runSuiteFilesVitest, suiteRemotesLoader } from "@jse/test-kit";
import { createEngine, DIALECT_DRAFT_06 } from "@jse/core";

const SUITE_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "test-suite",
);
const SUITE_DIR = join(SUITE_ROOT, "tests", "draft6");
const REMOTES_DIR = join(SUITE_ROOT, "remotes");

const FILES = [
  "additionalItems",
  "additionalProperties",
  "allOf",
  "anyOf",
  "boolean_schema",
  "const",
  "contains",
  "default",
  "definitions",
  "dependencies",
  "enum",
  "exclusiveMaximum",
  "exclusiveMinimum",
  "format",
  "infinite-loop-detection",
  "items",
  "maxItems",
  "maxLength",
  "maxProperties",
  "maximum",
  "minItems",
  "minLength",
  "minProperties",
  "minimum",
  "multipleOf",
  "not",
  "oneOf",
  "pattern",
  "patternProperties",
  "properties",
  "propertyNames",
  "ref",
  "refRemote",
  "required",
  "type",
  "uniqueItems",
];

const UNSUPPORTED: string[] = [];

runSuiteFilesVitest({
  suiteDir: SUITE_DIR,
  files: FILES,
  unsupportedKeywords: UNSUPPORTED,
  registerAndEvaluate: async (schema, retrievalUri, instance) => {
    const engine = createEngine({
      defaultDialect: DIALECT_DRAFT_06,
      loaders: [suiteRemotesLoader(REMOTES_DIR)],
    });
    const uri = await engine.loadSchema(schema, retrievalUri);
    return engine.evaluate(uri, instance).valid;
  },
  minRun: 822,
  describe,
  it,
  expect: expect as never,
});
