// Official-suite conformance for @json-schema-engine/core via the test-kit runner.
// M3: the full draft2020-12 file list, with the suite's remote resources
// served from the submodule's remotes/ tree through a loader.

import { describe, it, expect } from "vitest";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  runSuiteFilesVitest,
  suiteRemotesLoader,
} from "@json-schema-engine/test-kit";
import { createEngine } from "@json-schema-engine/core";

const SUITE_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "test-suite",
);
const SUITE_DIR = join(SUITE_ROOT, "tests", "draft2020-12");
const REMOTES_DIR = join(SUITE_ROOT, "remotes");

const FILES = [
  "type",
  "enum",
  "const",
  "pattern",
  "required",
  "minLength",
  "maxLength",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "minItems",
  "maxItems",
  "minProperties",
  "maxProperties",
  "properties",
  "patternProperties",
  "additionalProperties",
  "prefixItems",
  "items",
  "contains",
  "allOf",
  "anyOf",
  "oneOf",
  "not",
  "if-then-else",
  "dependentSchemas",
  "ref",
  "defs",
  "boolean_schema",
  "unevaluatedProperties",
  "unevaluatedItems",
  "infinite-loop-detection",
  "anchor",
  "content",
  "default",
  "dependentRequired",
  "format",
  "maxContains",
  "minContains",
  "multipleOf",
  "propertyNames",
  "uniqueItems",
  "dynamicRef",
  "refRemote",
  "vocabulary",
];

// 2019-09 keywords owed by M4; nothing in draft2020-12 should use them, so
// this is a guard, not an expected skip source.
const UNSUPPORTED = ["$recursiveRef", "$recursiveAnchor"];

runSuiteFilesVitest({
  suiteDir: SUITE_DIR,
  files: FILES,
  unsupportedKeywords: UNSUPPORTED,
  registerAndEvaluate: async (schema, retrievalUri, instance) => {
    const engine = createEngine({ loaders: [suiteRemotesLoader(REMOTES_DIR)] });
    const uri = await engine.loadSchema(schema, retrievalUri);
    return engine.evaluate(uri, instance).valid;
  },
  exactRun: 1299,
  describe,
  it,
  expect: expect as never,
});
