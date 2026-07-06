// M5.5 (D5): produce-time elision. The differential leg is the milestone's
// done-signal — flag mode (elision active) and hierarchical mode (tracing,
// no elision) must agree on every official case in every dialect, proving
// the "MUST NOT break channels" requirement over real unevaluated*/contains
// interplay rather than hand-picked cases.

import { readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { runSuiteFilesVitest, suiteRemotesLoader } from "@jse/test-kit";
import {
  createEngine, DialectRegistry, SchemaRegistry, JsonValue,
  UndeclaredConsumptionError, KeywordBehavior,
  DIALECT_2020_12, DIALECT_2019_09, DIALECT_DRAFT_07, DIALECT_DRAFT_06,
} from "@jse/core";
import { runEvaluation } from "../src/engine.js";
import { makeRecordPredicate } from "../src/output.js";
import { registerStandardDialects } from "../src/keywords/vocab2020.js";

const SUITE_ROOT = join(dirname(fileURLToPath(import.meta.url)),
  "..", "..", "..", "test-suite");
const REMOTES_DIR = join(SUITE_ROOT, "remotes");

const DRAFTS: readonly (readonly [string, string, number])[] = [
  ["draft2020-12", DIALECT_2020_12, 1270],
  ["draft2019-09", DIALECT_2019_09, 1230],
  ["draft7", DIALECT_DRAFT_07, 900],
  ["draft6", DIALECT_DRAFT_06, 820],
];

for (const [dir, dialect, minRun] of DRAFTS) {
  const suiteDir = join(SUITE_ROOT, "tests", dir);
  const files = readdirSync(suiteDir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.slice(0, -".json".length));

  runSuiteFilesVitest({
    suiteDir,
    files,
    unsupportedKeywords: [],
    registerAndEvaluate: async (schema, retrievalUri, instance) => {
      const engine = createEngine({
        defaultDialect: dialect, loaders: [suiteRemotesLoader(REMOTES_DIR)],
      });
      const uri = await engine.loadSchema(schema as JsonValue, retrievalUri);
      const elided = engine.evaluate(uri, instance as JsonValue).valid;
      const traced = engine.evaluate(uri, instance as JsonValue,
        { output: "hierarchical", verbose: true }).valid;
      if (elided !== traced) {
        throw new Error(`elision divergence: flag=${elided} traced=${traced}`);
      }
      return elided;
    },
    minRun,
    describe: (name, fn) => describe(`elision differential ${dir}: ${name}`, fn),
    it,
    expect: expect as never,
  });
}

describe("produce-time elision (white box)", () => {
  function bareRegistry() {
    const dialects = new DialectRegistry();
    registerStandardDialects(dialects);
    return new SchemaRegistry(dialects, DIALECT_2020_12);
  }

  it("records nothing when no consumer exists and collection is off", () => {
    const registry = bareRegistry();
    registry.register(
      { title: "T", type: "object", properties: { a: { title: "A" } } },
      "https://elide.example/plain");
    const predicate = makeRecordPredicate(registry.consumedIds(), false, undefined);
    const { valid, state } = runEvaluation(
      registry, "https://elide.example/plain", { a: 1 }, false, predicate);
    expect(valid).toBe(true);
    expect(state.rootProductions).toEqual([]);
  });

  it("keeps consumed productions once any registered schema consumes them", () => {
    const registry = bareRegistry();
    registry.register(
      { properties: { a: true }, unevaluatedProperties: false },
      "https://elide.example/consumer");
    const predicate = makeRecordPredicate(registry.consumedIds(), false, undefined);
    const { valid, state } = runEvaluation(
      registry, "https://elide.example/consumer", { a: 1 }, false, predicate);
    expect(valid).toBe(true);
    // properties' production had to survive for unevaluatedProperties.
    expect(state.rootProductions.some((p) => p.keywordName === "properties"))
      .toBe(true);
    // title-class annotations still elide.
    expect(state.rootProductions.some((p) => p.keywordName === "title"))
      .toBe(false);
  });

  it("respects retention allow and deny lists at produce time", () => {
    const engine = createEngine();
    const uri = engine.registerSchema(
      { title: "T", description: "D", type: "object" },
      "https://elide.example/retention");
    const allowed = engine.evaluate(uri, {}, {
      collectAnnotations: true, retention: { keywords: ["title"] },
    });
    expect(allowed.annotations!.map((a) => a.keyword)).toEqual(["title"]);
    const denied = engine.evaluate(uri, {}, {
      collectAnnotations: true, retention: { excludeKeywords: ["title"] },
    });
    expect(denied.annotations!.some((a) => a.keyword === "title")).toBe(false);
    expect(denied.annotations!.some((a) => a.keyword === "description")).toBe(true);
  });

  it("unevaluatedProperties still validates under a deny-everything policy", () => {
    const engine = createEngine();
    const uri = engine.registerSchema({
      properties: { a: true },
      unevaluatedProperties: false,
    }, "https://elide.example/deny-all");
    const options = {
      retention: {
        excludeKeywords: ["properties", "unevaluatedProperties", "title"],
        excludeVocabularies: [
          "https://json-schema.org/draft/2020-12/vocab/applicator",
          "https://json-schema.org/draft/2020-12/vocab/unevaluated",
        ],
      },
    };
    expect(engine.evaluate(uri, { a: 1 }, options).valid).toBe(true);
    expect(engine.evaluate(uri, { a: 1, b: 2 }, options).valid).toBe(false);
  });

  it("fails loud when a consumer reads an undeclared production id", () => {
    const VOCAB = "urn:jse:test:vocab:undeclared";
    const sneaky: KeywordBehavior = {
      id: `${VOCAB}#sneaky`,
      // No analyze().consumes declaration — reading via visible() under
      // elision must throw, not silently see an empty channel.
      evaluate: (_value, _cursor, ctx) => {
        ctx.visible(["https://json-schema.org/draft/2020-12/vocab/meta-data#title"]);
        return true;
      },
    };
    const engine = createEngine();
    engine.registerVocabulary(VOCAB, { sneaky });
    engine.registerDialect("urn:jse:test:dialect:undeclared", [
      "https://json-schema.org/draft/2020-12/vocab/core", VOCAB,
    ]);
    const uri = engine.registerSchema({ sneaky: true },
      "https://elide.example/sneaky", "urn:jse:test:dialect:undeclared");
    expect(() => engine.evaluate(uri, 1)).toThrow(UndeclaredConsumptionError);
    // With tracing (no elision) the same read is permitted.
    expect(engine.evaluate(uri, 1, { output: "hierarchical" }).valid).toBe(true);
  });
});
