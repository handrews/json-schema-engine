// Official-suite conformance for the draft-04 dialect (M10). Full draft4
// file list; nothing may be skipped (UNSUPPORTED: []). From optional/, only
// id.json runs (it pins the id-based identifier extractor): the remaining
// optional files test number representations JavaScript cannot distinguish
// after JSON.parse (bignum, float-overflow, zeroTerminatedFloats — draft-04's
// stricter "1.0 is not an integer" lives there, optional for exactly this
// reason) or regex-engine variance no other dialect's suite leg runs either
// (ecmascript-regex, non-bmp-regex).
// The elision differential leg mirrors core's elision.test.ts: flag mode
// (elision active) and hierarchical mode (tracing) must agree on every case.

import { describe, it, expect } from "vitest";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runSuiteFilesVitest, suiteRemotesLoader } from "@jse/test-kit";
import { createEngine } from "@jse/core";
import { registerDraft04, DIALECT_DRAFT_04 } from "@jse/dialect-draft04";

const SUITE_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "test-suite",
);
const SUITE_DIR = join(SUITE_ROOT, "tests", "draft4");
const REMOTES_DIR = join(SUITE_ROOT, "remotes");

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

const draft04Engine = () => {
  const engine = createEngine({
    defaultDialect: DIALECT_DRAFT_04,
    loaders: [suiteRemotesLoader(REMOTES_DIR)],
  });
  registerDraft04(engine);
  return engine;
};

runSuiteFilesVitest({
  suiteDir: SUITE_DIR,
  files: FILES,
  unsupportedKeywords: UNSUPPORTED,
  registerAndEvaluate: async (schema, retrievalUri, instance) => {
    const engine = draft04Engine();
    const uri = await engine.loadSchema(schema, retrievalUri);
    return engine.evaluate(uri, instance).valid;
  },
  minRun: 605,
  describe,
  it,
  expect: expect as never,
});

runSuiteFilesVitest({
  suiteDir: join(SUITE_DIR, "optional"),
  files: ["id"],
  unsupportedKeywords: UNSUPPORTED,
  registerAndEvaluate: async (schema, retrievalUri, instance) => {
    const engine = draft04Engine();
    const uri = await engine.loadSchema(schema, retrievalUri);
    return engine.evaluate(uri, instance).valid;
  },
  minRun: 3,
  describe: (name, fn) => describe(`optional: ${name}`, fn),
  it,
  expect: expect as never,
});

runSuiteFilesVitest({
  suiteDir: SUITE_DIR,
  files: FILES,
  unsupportedKeywords: UNSUPPORTED,
  registerAndEvaluate: async (schema, retrievalUri, instance) => {
    const engine = draft04Engine();
    const uri = await engine.loadSchema(schema, retrievalUri);
    const elided = engine.evaluate(uri, instance).valid;
    const traced = engine.evaluate(uri, instance, {
      output: "hierarchical",
      verbose: true,
    }).valid;
    if (elided !== traced) {
      throw new Error(`elision divergence: flag=${elided} traced=${traced}`);
    }
    return elided;
  },
  minRun: 605,
  describe: (name, fn) => describe(`elision differential draft4: ${name}`, fn),
  it,
  expect: expect as never,
});
