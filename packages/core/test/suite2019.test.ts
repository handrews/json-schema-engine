// Official-suite conformance for @jse/core's 2019-09 dialect (M4-A).
// Full draft2019-09 file list; nothing may be skipped (UNSUPPORTED: []).

import { describe, it, expect } from "vitest";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runSuiteFilesVitest, suiteRemotesLoader } from "@jse/test-kit";
import { createEngine, DIALECT_2019_09 } from "@jse/core";

const SUITE_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "test-suite",
);
const SUITE_DIR = join(SUITE_ROOT, "tests", "draft2019-09");
const REMOTES_DIR = join(SUITE_ROOT, "remotes");

const FILES = [
  "additionalItems",
  "additionalProperties",
  "allOf",
  "anchor",
  "anyOf",
  "boolean_schema",
  "const",
  "contains",
  "content",
  "default",
  "defs",
  "dependentRequired",
  "dependentSchemas",
  "enum",
  "exclusiveMaximum",
  "exclusiveMinimum",
  "format",
  "if-then-else",
  "infinite-loop-detection",
  "items",
  "maxContains",
  "maxItems",
  "maxLength",
  "maxProperties",
  "maximum",
  "minContains",
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
  "recursiveRef",
  "ref",
  "refRemote",
  "required",
  "type",
  "unevaluatedItems",
  "unevaluatedProperties",
  "uniqueItems",
  "vocabulary",
];

const UNSUPPORTED: string[] = [];

runSuiteFilesVitest({
  suiteDir: SUITE_DIR,
  files: FILES,
  unsupportedKeywords: UNSUPPORTED,
  registerAndEvaluate: async (schema, retrievalUri, instance) => {
    const engine = createEngine({
      defaultDialect: DIALECT_2019_09,
      loaders: [suiteRemotesLoader(REMOTES_DIR)],
    });
    const uri = await engine.loadSchema(schema, retrievalUri);
    return engine.evaluate(uri, instance).valid;
  },
  minRun: 1234,
  describe,
  it,
  expect: expect as never,
});
