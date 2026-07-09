// Plan-classification census for the draft-04 dialect (M6.6): every group
// schema in the official draft4 suite (remotes resolved, same loader as
// suite4.test.ts) builds a plan with zero units falling back to the
// interpreter for cause "unlowerable". This is the direct evidence that
// draft-04's vocabulary — the harvested draft-07 behaviors plus this
// package's own minimum/maximum lower() and the now-inert structural()
// lower() for id/exclusiveMinimum/exclusiveMaximum — is fully capable.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createEngine, type JsonValue } from "@jse/core";
import { buildPlan, type FallbackCause } from "@jse/compiler";
import { suiteRemotesLoader } from "@jse/test-kit";
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

interface SuiteGroup {
  description: string;
  schema: JsonValue;
  tests: unknown[];
}

describe("draft-04 plan classification (M6.6)", () => {
  it("every registerable group schema plans with zero unlowerable units", async () => {
    let total = 0;
    const causeCounts: Partial<Record<FallbackCause, number>> = {};
    let registerFailures = 0;

    for (const file of readdirSync(SUITE_DIR).filter((f) =>
      f.endsWith(".json"),
    )) {
      const groups = JSON.parse(
        readFileSync(join(SUITE_DIR, file), "utf8"),
      ) as SuiteGroup[];
      for (const [gi, group] of groups.entries()) {
        const engine = createEngine({
          defaultDialect: DIALECT_DRAFT_04,
          loaders: [suiteRemotesLoader(REMOTES_DIR)],
        });
        registerDraft04(engine);
        const retrievalUri = `https://plan4.example/${file}/${String(gi)}`;
        let uri: string;
        try {
          uri = await engine.loadSchema(group.schema, retrievalUri);
        } catch {
          registerFailures++;
          continue; // D19/registration-shape cases: suite4.test.ts's interpreter leg covers these
        }
        const plan = buildPlan(engine, uri);
        for (const unit of plan.units.values()) {
          total++;
          if (unit.kind === "interpreted" && unit.cause) {
            causeCounts[unit.cause] = (causeCounts[unit.cause] ?? 0) + 1;
          }
        }
      }
    }

    expect(total).toBeGreaterThan(490);
    expect(registerFailures).toBe(0);
    expect(causeCounts.unlowerable ?? 0).toBe(0);
  });
});
