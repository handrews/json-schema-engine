// The format-assertion VOCABULARY (M7): $vocabulary-assembled dialects get
// an asserting `format`, and the two unknown-format postures hold — the
// vocabulary refuses what it cannot assert; the assertFormats
// configuration stays best-effort.

import { describe, it, expect } from "vitest";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runSuiteFilesVitest, suiteRemotesLoader } from "@jse/test-kit";
import {
  createEngine,
  UnknownFormatError,
  VOCAB_FORMAT_ASSERTION,
  DIALECT_2020_12,
} from "@jse/core";
import { FORMATS_2020_12 } from "@jse/formats";

const SUITE_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "test-suite",
);

// Official leg: custom metaschemas (served from remotes/) declare the
// format-assertion vocabulary true/false; the dialect assembly must honor
// each declaration.
runSuiteFilesVitest({
  suiteDir: join(SUITE_ROOT, "tests", "draft2020-12", "optional"),
  files: ["format-assertion"],
  unsupportedKeywords: [],
  registerAndEvaluate: async (schema, retrievalUri, instance) => {
    const engine = createEngine({
      formats: FORMATS_2020_12,
      loaders: [suiteRemotesLoader(join(SUITE_ROOT, "remotes"))],
    });
    const uri = await engine.loadSchema(schema, retrievalUri);
    return engine.evaluate(uri, instance).valid;
  },
  minRun: 4,
  describe,
  it,
  expect: expect as never,
});

describe("unknown-format postures (M7)", () => {
  const ASSERTING_DIALECT = "urn:test:dialect:asserting-formats";
  const buildEngine = () => {
    const engine = createEngine({ formats: FORMATS_2020_12 });
    // A dialect whose format keyword comes from the format-assertion
    // vocabulary (the rest of 2020-12 minus format-annotation).
    const base = engine.dialects.getDialect(DIALECT_2020_12);
    engine.registerDialect(ASSERTING_DIALECT, [
      ...base.vocabularyUris.filter((u) => !u.includes("format-annotation")),
      VOCAB_FORMAT_ASSERTION,
    ]);
    return engine;
  };

  it("the vocabulary refuses unsupported formats at registration", () => {
    const engine = buildEngine();
    expect(() =>
      engine.registerSchema(
        { format: "no-such-format" },
        "https://fa.example/unknown",
        ASSERTING_DIALECT,
      ),
    ).toThrow(UnknownFormatError);
  });

  it("the vocabulary asserts supported formats", () => {
    const engine = buildEngine();
    const uri = engine.registerSchema(
      { format: "ipv4" },
      "https://fa.example/known",
      ASSERTING_DIALECT,
    );
    expect(engine.evaluate(uri, "10.0.0.1").valid).toBe(true);
    expect(engine.evaluate(uri, "999.0.0.1").valid).toBe(false);
    expect(engine.evaluate(uri, 42).valid).toBe(true); // type-scoped
  });

  it("assertFormats is best-effort: unknown formats fall back to annotation", () => {
    const engine = createEngine({
      formats: FORMATS_2020_12,
      assertFormats: true,
    });
    const uri = engine.registerSchema(
      { format: "no-such-format" },
      "https://fa.example/best-effort",
    );
    const result = engine.evaluate(uri, "anything", {
      output: "list",
      collectAnnotations: true,
    });
    expect(result.valid).toBe(true);
    expect(
      result.annotations?.some(
        (a) => a.keyword === "format" && a.annotation === "no-such-format",
      ),
    ).toBe(true);
  });

  it("assertFormats asserts recognized formats across drafts", () => {
    const engine = createEngine({
      formats: FORMATS_2020_12,
      assertFormats: true,
    });
    const uri = engine.registerSchema(
      {
        $schema: "http://json-schema.org/draft-07/schema#",
        format: "ipv4",
      },
      "https://fa.example/legacy",
    );
    expect(engine.evaluate(uri, "999.9.9.9").valid).toBe(false);
  });

  it("without assertFormats, format stays annotation-only", () => {
    const engine = createEngine();
    const uri = engine.registerSchema(
      { format: "ipv4" },
      "https://fa.example/annotate",
    );
    const result = engine.evaluate(uri, "not-an-ip", {
      collectAnnotations: true,
    });
    expect(result.valid).toBe(true);
    expect(
      result.annotations?.some(
        (a) => a.keyword === "format" && a.annotation === "ipv4",
      ),
    ).toBe(true);
  });

  it("assertFormats without a table is a construction error", () => {
    expect(() => createEngine({ assertFormats: true })).toThrow(TypeError);
  });
});
