// Compiled twin of format-assertion.test.ts (M7 "runtime format-table
// lowering", commit 16c460a): the asserting `format` keyword lowers, so the
// compiled tier must match the interpreter over the same postures. Legs:
//  - direct classification: a known format stays static and lists its name
//    in plan.formats; an unknown format under assertFormats stays static and
//    produce-only (mirrors packages/compiler/test/format-assertion.test.ts
//    Leg 2, scoped to this package's own FORMATS_2020_12 table);
//  - annotations: compileList({ annotations: true }) on a valid
//    instance matches the interpreter's format-name annotation exactly;
//  - the official optional/format-assertion suite through the compiled tier
//    (flag + list), compared to the interpreter with an exact count and zero
//    skips — same suite leg as format-assertion.test.ts's vocabulary posture.
//
// emitStandalone rejection of format-asserting plans is not re-tested here:
// packages/compiler/test/standalone.test.ts already covers exactly this case
// ("refuses format-asserting schemas"), and pulling @jse/compiler's
// standalone entry point into this package for a byte-identical scenario
// would duplicate that gate without adding coverage.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createEngine, type Engine, type JsonValue } from "@jse/core";
import { FORMATS_2020_12 } from "@jse/formats";
import { buildPlan, compileValidator, compileList } from "@jse/compiler";
import { suiteRemotesLoader } from "@jse/test-kit";

const SUITE_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "test-suite",
);
const REMOTES = join(SUITE_ROOT, "remotes");

// ---------------------------------------------------------------------------
// Leg 1 — direct classification. A known format stays static and lists its
// name in plan.formats; an unknown format under the best-effort posture
// stays static but produce-only (no table entry, so plan.formats is empty).
// ---------------------------------------------------------------------------

describe("Leg 1 — format-bearing schemas stay static", () => {
  const engine = createEngine({
    formats: FORMATS_2020_12,
    assertFormats: true,
  });

  it("a known format is static and appears in plan.formats", () => {
    const uri = engine.registerSchema(
      { format: "ipv4" },
      "https://fa.formats-compile/known",
    );
    const plan = buildPlan(engine, uri, { output: "flag" });
    expect(plan.units.get(plan.rootKey)!.kind).toBe("static");
    expect(plan.formats).toEqual(["ipv4"]);
  });

  it("an unknown format is static and produce-only (no table entry)", () => {
    const uri = engine.registerSchema(
      { format: "no-such-format" },
      "https://fa.formats-compile/unknown",
    );
    const plan = buildPlan(engine, uri, { output: "flag" });
    expect(plan.units.get(plan.rootKey)!.kind).toBe("static");
    expect(plan.formats).toEqual([]);
    expect(compileValidator(engine, uri).validate("anything")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Leg 2 — annotations. The annotation-only default still runs the format
// against the table for its annotation value; the compiled list artifact's
// annotations must equal the interpreter's exactly.
// ---------------------------------------------------------------------------

describe("Leg 2 — compiled annotations match the interpreter", () => {
  it("the annotations option on a valid instance yields the format-name annotation", () => {
    const engine = createEngine({ formats: FORMATS_2020_12 });
    const uri = engine.registerSchema(
      { format: "ipv4" },
      "https://fa.formats-compile/annotate",
    );
    const list = compileList(engine, uri, { annotations: true });
    const compiled = list.evaluateList("not-an-ip");
    const interpreted = engine.evaluate(uri, "not-an-ip", {
      output: "list",
      annotations: true,
    });
    expect(compiled.valid).toBe(interpreted.valid);
    expect(compiled.annotations).toStrictEqual(interpreted.annotations);
    expect(
      compiled.annotations?.some(
        (a) => a.keyword === "format" && a.annotation === "ipv4",
      ),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Leg 3 — the official optional/format-assertion suite through the compiled
// tier. Custom metaschemas (remotes/) declare the format-assertion vocabulary
// true/false; the compiled flag validator and list evaluator must match the
// interpreter (and the suite's expected verdict) exactly, with zero skips.
// ---------------------------------------------------------------------------

interface SuiteGroup {
  description: string;
  schema: JsonValue;
  tests: { description: string; data: JsonValue; valid: boolean }[];
}

const FA_FILE = join(
  SUITE_ROOT,
  "tests",
  "draft2020-12",
  "optional",
  "format-assertion.json",
);

// Exact test count: two groups (format-assertion false/true metaschemas), two
// tests each. A suite bump is a one-glance pin update.
const FA_EXPECTED_RUN = 4;

function faEngine(): Engine {
  return createEngine({
    formats: FORMATS_2020_12,
    loaders: [suiteRemotesLoader(REMOTES)],
  });
}

describe("Leg 3 — compiled optional/format-assertion matches the interpreter", () => {
  const groups = JSON.parse(readFileSync(FA_FILE, "utf8")) as SuiteGroup[];

  it(`runs exactly ${String(FA_EXPECTED_RUN)} cases, compiled ≡ interpreter ≡ suite`, async () => {
    let run = 0;
    for (let gi = 0; gi < groups.length; gi++) {
      const group = groups[gi]!;
      const engine = faEngine();
      const uri = await engine.loadSchema(
        group.schema,
        `https://fa.formats-compile/suite/${String(gi)}`,
      );
      const flag = compileValidator(engine, uri);
      const list = compileList(engine, uri, { errorParams: true });
      for (const test of group.tests) {
        run++;
        const label = `${group.description} / ${test.description}`;
        const interp = engine.evaluate(uri, test.data).valid;
        const interpList = engine.evaluate(uri, test.data, {
          output: "list",
          errorParams: true,
        });
        // Compiled flag verdict ≡ interpreter ≡ the suite's own expectation.
        expect(flag.validate(test.data), `${label}: flag`).toBe(interp);
        expect(interp, `${label}: interpreter vs suite`).toBe(test.valid);
        // Compiled list ≡ interpreter list (verdict + error units).
        const compiledList = list.evaluateList(test.data);
        expect(compiledList.valid, `${label}: list valid`).toBe(
          interpList.valid,
        );
        expect(compiledList.errors, `${label}: list errors`).toEqual(
          interpList.errors ?? [],
        );
      }
    }
    expect(run).toBe(FA_EXPECTED_RUN);
  });
});
