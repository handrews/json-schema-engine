// Official-suite conformance for @jse/core via the test-kit runner.
// File list and skip list carried over from the F2 prototype (DESIGN.md M1
// done-signal), plus infinite-loop-detection (needs the cycle guard).

import { describe, it, expect } from "vitest";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runSuiteFilesVitest } from "@jse/test-kit";
import { createEngine, JsonValue } from "@jse/core";

const SUITE_DIR = join(dirname(fileURLToPath(import.meta.url)),
  "..", "..", "..", "test-suite", "tests", "draft2020-12");

const FILES = [
  "type", "enum", "const", "pattern", "required",
  "minLength", "maxLength", "minimum", "maximum",
  "exclusiveMinimum", "exclusiveMaximum", "minItems", "maxItems",
  "minProperties", "maxProperties",
  "properties", "patternProperties", "additionalProperties",
  "prefixItems", "items", "contains",
  "allOf", "anyOf", "oneOf", "not", "if-then-else", "dependentSchemas",
  "ref", "defs", "boolean_schema",
  "unevaluatedProperties", "unevaluatedItems",
  "infinite-loop-detection",
  "anchor", "content", "default", "dependentRequired", "format",
  "maxContains", "minContains", "multipleOf", "propertyNames", "uniqueItems",
];

// 2020-12 keywords whose dynamic-scope semantics are owed by M3; core throws
// on them (loud placeholders), and the runner skips groups using them in
// schema positions.
const UNSUPPORTED = [
  "$dynamicRef", "$dynamicAnchor", "$recursiveRef", "$recursiveAnchor",
];

runSuiteFilesVitest({
  suiteDir: SUITE_DIR,
  files: FILES,
  unsupportedKeywords: UNSUPPORTED,
  registerAndEvaluate: (schema, retrievalUri, instance) => {
    const engine = createEngine();
    const uri = engine.registerSchema(schema as JsonValue, retrievalUri);
    return engine.evaluate(uri, instance as JsonValue).valid;
  },
  minRun: 1186,
  describe,
  it,
  expect: expect as never,
});
