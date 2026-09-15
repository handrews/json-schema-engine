// Official-suite conformance for @json-schema-engine/compiler's compiled tier over the
// draft-07 dialect (M6.6). Same FILES list and remotes loader as @json-schema-engine/core's
// suite7.test.ts (M4-B): every group registers and evaluates through the
// interpreter as always, but the verdict comes from
// compileValidator(...).validate(instance) instead of
// engine.evaluate(...).valid — the compiled tier must be exactly as
// complete as the interpreter (the refIgnoresSiblings planner fix and any
// remaining fallback cause trampoline straight back to it), so this run's
// totals must match the interpreter leg's exactly, with zero skips.

import { describe, it, expect } from "vitest";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  runSuiteFilesVitest,
  suiteRemotesLoader,
} from "@json-schema-engine/test-kit";
import { createEngine, DIALECT_DRAFT_07 } from "@json-schema-engine/core";
import { compileValidator } from "@json-schema-engine/compiler";

const SUITE_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "test-suite",
);
const SUITE_DIR = join(SUITE_ROOT, "tests", "draft7");
const REMOTES_DIR = join(SUITE_ROOT, "remotes");

// Same FILES list as packages/core/test/suite7.test.ts (the interpreter
// leg) — coverage must match exactly.
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
  "if-then-else",
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
      defaultDialect: DIALECT_DRAFT_07,
      loaders: [suiteRemotesLoader(REMOTES_DIR)],
    });
    const uri = await engine.loadSchema(schema, retrievalUri);
    return compileValidator(engine, uri).validate(instance);
  },
  exactRun: 927,
  describe,
  it,
  expect: expect as never,
});
