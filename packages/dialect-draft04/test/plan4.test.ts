// Plan-classification census for the draft-04 dialect (M6.6): every group
// schema in the official draft4 suite (remotes resolved, same loader as
// suite4.test.ts) builds a plan pinned to exact counts — zero interpreted
// units at all under the annotation-only format default (no formats table,
// no assertFormats; format4-compiled.test.ts covers the asserting posture
// separately). This is the direct evidence that draft-04's vocabulary —
// the harvested draft-07 behaviors plus this package's own minimum/maximum
// lower() and the inert structural() lower() — is fully capable, and the
// exact pins make a silent static→interpreted regression loud (interpreted
// fallback is always correct, so no behavioral gate would notice).

import { describe, it, expect } from "vitest";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createEngine } from "@json-schema-engine/core";
import { buildPlan, explainCompilation } from "@json-schema-engine/compiler";
import {
  runPlanCensus,
  suiteRemotesLoader,
} from "@json-schema-engine/test-kit";
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

async function census(output: "flag" | "list") {
  return runPlanCensus({
    suiteDir: SUITE_DIR,
    loadAndPlan: async (schema, retrievalUri) => {
      try {
        const engine = createEngine({
          defaultDialect: DIALECT_DRAFT_04,
          loaders: [suiteRemotesLoader(REMOTES_DIR)],
        });
        registerDraft04(engine);
        const loaded = await engine.loadSchema(schema, retrievalUri);
        return explainCompilation(buildPlan(engine, loaded, { output }));
      } catch {
        return undefined;
      }
    },
  });
}

describe("draft-04 plan classification (M6.6)", () => {
  it("flag plan matches the pinned census: all static", async () => {
    const result = await census("flag");
    const diagnosis =
      "draft4/flag interpreted units:\n  " +
      result.interpretedKeys.join("\n  ");
    expect(result.registerFailures).toBe(0);
    expect(result.totalUnits, diagnosis).toBe(510);
    expect(result.interpretedUnits, diagnosis).toBe(0);
    expect(result.causes, diagnosis).toEqual({});
  });

  it("list plan equals the flag plan (no unevaluated* to demote)", async () => {
    const flag = await census("flag");
    const list = await census("list");
    expect({
      totalUnits: list.totalUnits,
      interpretedUnits: list.interpretedUnits,
      causes: list.causes,
    }).toEqual({
      totalUnits: flag.totalUnits,
      interpretedUnits: flag.interpretedUnits,
      causes: flag.causes,
    });
  });
});
