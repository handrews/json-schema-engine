// Output option validation (ADR 0003): every combination of controls is
// either supported or rejected with OutputOptionsError before evaluation —
// no silent no-ops. The minimal level (`flag`) carries no records, so every
// record-bearing control is rejected there; `basic` and `detailed` are
// relevant-level by definition and `verbose` is the verbose level by
// definition (IETF draft-03 §13.4).

import { describe, it, expect } from "vitest";
import {
  createEngine,
  OutputOptionsError,
  type EvaluateOptions,
  type OutputFormat,
} from "@jse/core";

function engineFor() {
  const engine = createEngine();
  const uri = engine.registerSchema(
    { title: "t", anyOf: [{ type: "string" }, { type: "number" }] },
    "https://options.example/schema",
  );
  return { engine, uri };
}

describe("rejected combinations", () => {
  const rejected: [string, EvaluateOptions, RegExp][] = [
    ["verbose on the default flag output", { verbose: true }, /'verbose'/],
    ["annotations on flag", { annotations: true }, /'annotations'/],
    [
      "an annotation selection on flag",
      { output: "flag", annotations: { keywords: ["title"] } },
      /'annotations'/,
    ],
    ["errorParams on flag", { errorParams: true }, /'errorParams'/],
    ["positions on flag", { positions: true }, /'positions'/],
    ["trace on flag", { output: "flag", trace: true }, /'trace'/],
    ["verbose on basic", { output: "basic", verbose: true }, /"basic"/],
    [
      "verbose on detailed",
      { output: "detailed", verbose: true },
      /"detailed"/,
    ],
    [
      "verbose: false on the verbose format",
      { output: "verbose", verbose: false },
      /contradicts/,
    ],
    [
      "an unknown format name",
      { output: "xml" as unknown as OutputFormat },
      /unknown output format 'xml'/,
    ],
  ];
  for (const [name, options, message] of rejected) {
    it(name, () => {
      const { engine, uri } = engineFor();
      expect(() => engine.evaluate(uri, "x", options)).toThrow(
        OutputOptionsError,
      );
      expect(() => engine.evaluate(uri, "x", options)).toThrow(message);
    });
  }
});

describe("accepted combinations", () => {
  it("explicit false values are accepted on flag", () => {
    const { engine, uri } = engineFor();
    const r = engine.evaluate(uri, "x", {
      output: "flag",
      verbose: false,
      annotations: false,
      errorParams: false,
      positions: false,
      trace: false,
    });
    expect(r).toEqual({ valid: true });
  });

  it("verbose: true on the verbose format is redundant, not contradictory", () => {
    const { engine, uri } = engineFor();
    const r = engine.evaluate(uri, 5, { output: "verbose", verbose: true });
    expect(r.outputDocument.valid).toBe(true);
    expect(r.droppedErrors).toHaveLength(1);
  });

  const formats: Exclude<OutputFormat, "flag">[] = [
    "basic",
    "detailed",
    "verbose",
    "list",
    "hierarchical",
  ];
  for (const output of formats) {
    it(`honors every control on ${output}`, () => {
      const { engine, uri } = engineFor();
      const r = engine.evaluate(uri, true, {
        output,
        annotations: true,
        errorParams: true,
        positions: true,
        trace: true,
      });
      expect(r.valid).toBe(false);
      expect(r.outputDocument.valid).toBe(false);
      expect(r.trace.valid).toBe(false);
      expect(r.errors!.map((e) => e.keyword)).toEqual([
        "type",
        "type",
        "anyOf",
      ]);
      expect(r.errors![0]!.params).toEqual({ expected: "string" });
      expect(r.errors![0]!.vocabulary).toBe(
        "https://json-schema.org/draft/2020-12/vocab/validation",
      );
      const ok = engine.evaluate(uri, "x", { output, annotations: true });
      expect(ok.annotations!.map((a) => a.keyword)).toEqual(["title"]);
    });
  }

  it("the verbose level of list and hierarchical exposes irrelevant records", () => {
    const { engine, uri } = engineFor();
    for (const output of ["list", "hierarchical"] as const) {
      const relevantLevel = engine.evaluate(uri, 5, { output });
      expect(relevantLevel.droppedErrors).toBeUndefined();
      const verboseLevel = engine.evaluate(uri, 5, { output, verbose: true });
      expect(verboseLevel.droppedErrors!.map((e) => e.evaluationPath)).toEqual([
        "/anyOf/0/type",
      ]);
    }
  });

  it("basic builds no trace unless asked", () => {
    const { engine, uri } = engineFor();
    expect(engine.evaluate(uri, "x", { output: "basic" }).trace).toBe(
      undefined,
    );
    const traced = engine.evaluate(uri, "x", { output: "basic", trace: true });
    expect(traced.trace.valid).toBe(true);
  });
});
