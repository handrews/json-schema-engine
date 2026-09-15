// Official-suite conformance for @json-schema-engine/compiler's compiled tier over the
// 2019-09 dialect (M6.6 stretch). Same FILES list and remotes loader as
// @json-schema-engine/core's suite2019.test.ts (M4-A): every group registers and
// evaluates through the interpreter as always, but the verdict comes from
// compileValidator(...).validate(instance) instead of
// engine.evaluate(...).valid — the compiled tier must be exactly as
// complete as the interpreter ($recursiveRef-class dynamic islands and any
// remaining fallback cause trampoline straight back to it), so this run's
// totals must match the interpreter leg's exactly, with zero skips.

import { describe, it, expect } from "vitest";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  runSuiteFilesVitest,
  suiteRemotesLoader,
} from "@json-schema-engine/test-kit";
import { createEngine, DIALECT_2019_09 } from "@json-schema-engine/core";
import { compileValidator } from "@json-schema-engine/compiler";

const SUITE_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "test-suite",
);
const SUITE_DIR = join(SUITE_ROOT, "tests", "draft2019-09");
const REMOTES_DIR = join(SUITE_ROOT, "remotes");

// Same FILES list as packages/core/test/suite2019.test.ts (the interpreter
// leg) — coverage must match exactly.
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
    return compileValidator(engine, uri).validate(instance);
  },
  exactRun: 1259,
  describe,
  it,
  expect: expect as never,
});
