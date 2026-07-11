// Compiled twin of format4.test.ts (M7 harvest seam / M6.6): draft-04's
// asserting `format` is harvested from draft-07 via registerDraft04, with no
// source of its own in this package — this is the direct evidence that the
// harvested lower() reaches the compiled tier with ZERO changes here. Legs:
//  - direct classification: a known-format draft-04 schema stays static and
//    lists its format name in plan.formats (scoped twin of
//    packages/compiler/test/format-assertion.test.ts Leg 2, over
//    FORMATS_DRAFT_04 instead of the 2020-12 table);
//  - the official draft4 optional/format suite through the compiled tier
//    (flag + list), compared to the interpreter with an exact count and zero
//    skips — same FILES list and engine construction as format4.test.ts.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createEngine, type Engine, type JsonValue } from "@jse/core";
import { FORMATS_DRAFT_04 } from "@jse/formats";
import { buildPlan, compileValidator, compileList } from "@jse/compiler";
import { registerDraft04, DIALECT_DRAFT_04 } from "../src/index.js";

const SUITE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "test-suite",
  "tests",
  "draft4",
  "optional",
  "format",
);

// Same FILES list as format4.test.ts's interpreted leg — coverage must match
// exactly.
const FILES = [
  "date-time",
  "email",
  "hostname",
  "ipv4",
  "ipv6",
  "unknown",
  "uri",
];

function draft04Engine(): Engine {
  const engine = createEngine({
    defaultDialect: DIALECT_DRAFT_04,
    formats: FORMATS_DRAFT_04,
    assertFormats: true,
  });
  registerDraft04(engine);
  return engine;
}

// ---------------------------------------------------------------------------
// Leg 1 — direct classification. A known draft-04 format stays static and
// lists its name in plan.formats (the harvested lower() is what makes this
// so — this package contributes no format() lower() of its own).
// ---------------------------------------------------------------------------

describe("Leg 1 — a known draft-04 format stays static", () => {
  it("classifies static and lists its format name in plan.formats", () => {
    const engine = draft04Engine();
    const uri = engine.registerSchema(
      { format: "ipv4" },
      "https://d4fa.compile/known",
    );
    const plan = buildPlan(engine, uri, { output: "flag" });
    expect(plan.units.get(plan.rootKey)!.kind).toBe("static");
    expect(plan.formats).toEqual(["ipv4"]);
  });
});

// ---------------------------------------------------------------------------
// Leg 2 — the official draft4 optional/format suite through the compiled
// tier. Every group registers under the same asserting draft-04 engine as
// format4.test.ts; the compiled flag validator and list evaluator must match
// the interpreter (and the suite's expected verdict) exactly, zero skips.
// ---------------------------------------------------------------------------

interface SuiteGroup {
  description: string;
  schema: JsonValue;
  tests: { description: string; data: JsonValue; valid: boolean }[];
}

// Exact test count across the seven format files (date-time 29, email 20,
// hostname 28, ipv4 38, ipv6 40, unknown 7, uri 44); a suite bump is a
// one-glance pin update.
const FORMAT4_EXPECTED_RUN = 206;

describe("Leg 2 — compiled optional/format matches the interpreter", () => {
  it(`runs exactly ${String(FORMAT4_EXPECTED_RUN)} cases, compiled ≡ interpreter ≡ suite`, () => {
    let run = 0;
    for (const file of FILES) {
      const groups = JSON.parse(
        readFileSync(join(SUITE_DIR, `${file}.json`), "utf8"),
      ) as SuiteGroup[];
      for (let gi = 0; gi < groups.length; gi++) {
        const group = groups[gi]!;
        for (const test of group.tests) {
          run++;
          const label = `${file} / ${group.description} / ${test.description}`;
          const engine = draft04Engine();
          const uri = engine.registerSchema(
            group.schema,
            `https://d4fa.compile/${file}/${String(gi)}`,
          );
          const flag = compileValidator(engine, uri);
          const list = compileList(engine, uri, { errorParams: true });
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
    }
    expect(run).toBe(FORMAT4_EXPECTED_RUN);
  });
});
