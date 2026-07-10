// Official-suite conformance for @jse/compiler's compiled tier (M6.4). Same
// FILES list and remotes loader as @jse/core's suite.test.ts (M3): every
// group registers and evaluates through the interpreter as always, but the
// verdict comes from compileValidator(...).validate(instance) instead of
// engine.evaluate(...).valid — the compiled tier must be exactly as
// complete as the interpreter (dynamic islands and any fallback cause
// trampoline straight back to it), so this run's totals must match the
// interpreter leg's exactly, with zero skips.

import { describe, it, expect } from "vitest";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runSuiteFilesVitest, suiteRemotesLoader } from "@jse/test-kit";
import { createEngine } from "@jse/core";
import { compileValidator } from "@jse/compiler";

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
    return compileValidator(engine, uri).validate(instance);
  },
  exactRun: 1299,
  describe,
  it,
  expect: expect as never,
});
