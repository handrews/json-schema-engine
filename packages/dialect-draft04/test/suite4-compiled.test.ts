// Official-suite conformance for @json-schema-engine/compiler's compiled tier over the
// draft-04 dialect (M6.6). Same FILES list, remotes loader, and exactRun
// pin as suite4.test.ts's interpreter leg — every group registers as
// always, but the verdict comes from compileValidator(...).validate(instance)
// instead of engine.evaluate(...).valid. Now that draft-04's own
// minimum/maximum carry lower(), every keyword this engine construction
// exercises (no formats table, so `format` stays annotation-only) is
// compilable, so this run's totals must match the interpreter leg's
// exactly, with zero skips.

import { describe, it, expect } from "vitest";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  runSuiteFilesVitest,
  suiteRemotesLoader,
} from "@json-schema-engine/test-kit";
import { createEngine } from "@json-schema-engine/core";
import { compileValidator } from "@json-schema-engine/compiler";
import { registerDraft04, DIALECT_DRAFT_04 } from "../src/index.js";

const SUITE_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "test-suite",
);
const SUITE_DIR = join(SUITE_ROOT, "tests", "draft4");
const REMOTES_DIR = join(SUITE_ROOT, "remotes");

// Same FILES list as suite4.test.ts's interpreter leg — coverage must match
// exactly.
const FILES = [
  "additionalItems",
  "additionalProperties",
  "allOf",
  "anyOf",
  "default",
  "definitions",
  "dependencies",
  "enum",
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
      defaultDialect: DIALECT_DRAFT_04,
      loaders: [suiteRemotesLoader(REMOTES_DIR)],
    });
    registerDraft04(engine);
    const uri = await engine.loadSchema(schema, retrievalUri);
    return compileValidator(engine, uri).validate(instance);
  },
  exactRun: 618,
  describe,
  it,
  expect: expect as never,
});
