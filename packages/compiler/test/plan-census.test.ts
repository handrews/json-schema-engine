// Plan-classification census (testing-lessons hardening): interpreted
// fallback is always CORRECT, so a regression that flips units
// static→interpreted passes every suite/differential/fuzz gate — only
// these exact pins notice. Counts change ONLY on deliberate compiler or
// suite-submodule changes; update the pins in the same commit, with the
// diff explaining why. On failure the interpreted-unit keys print for
// diagnosis.

import { describe, it, expect } from "vitest";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createEngine } from "@jse/core";
import { buildPlan, explainCompilation } from "@jse/compiler";
import {
  runPlanCensus,
  suiteRemotesLoader,
  type PlanCensusResult,
} from "@jse/test-kit";

const SUITE_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "test-suite",
);
const REMOTES = join(SUITE_ROOT, "remotes");

interface DialectPin {
  dir: string;
  defaultDialect?: string;
  flag: Expected;
  /** Absent = list plan must equal the flag plan exactly. */
  list?: Expected;
}
interface Expected {
  groups: number;
  totalUnits: number;
  interpretedUnits: number;
  causes: Record<string, number>;
  /** Consumer units compiled with runtime coverage tracking (phase B); default 0. */
  trackingUnits?: number;
  /** Units in a tracked unit's coverage region (phase B); default 0. */
  regionUnits?: number;
}

// Transcribed from a local run (deterministic — two runs hash-identical).
// FLAG mode compiles dynamic-coverage unevaluated* consumers with runtime
// tracking (phase B): the former `unlowerable` interpreted units become
// static `trackingUnits`, their in-place closures become `regionUnits`, and
// their now-planned subtrees raise `totalUnits`. LIST mode still demotes every
// such consumer (its static-coverage license is flag-only) — a demoted unit's
// subtree is never planned — so list plans have FEWER total units, MORE
// interpreted ones, and NO tracking. The list pins must not move under a
// flag-only change (asserted below).
const PINS: Record<string, DialectPin> = {
  "draft2020-12": {
    dir: "draft2020-12",
    flag: {
      groups: 383,
      totalUnits: 1338,
      interpretedUnits: 59,
      causes: { dynamic: 59 },
      trackingUnits: 20,
      regionUnits: 50,
    },
    list: {
      groups: 383,
      totalUnits: 1056,
      interpretedUnits: 134,
      causes: { dynamic: 58, unlowerable: 76 },
    },
  },
  "draft2019-09": {
    dir: "draft2019-09",
    defaultDialect: "https://json-schema.org/draft/2019-09/schema",
    flag: {
      groups: 372,
      totalUnits: 1297,
      interpretedUnits: 49,
      causes: { dynamic: 49 },
      trackingUnits: 16,
      regionUnits: 43,
    },
    list: {
      groups: 372,
      totalUnits: 1034,
      interpretedUnits: 122,
      causes: { dynamic: 49, unlowerable: 73 },
    },
  },
  draft7: {
    dir: "draft7",
    defaultDialect: "http://json-schema.org/draft-07/schema",
    flag: {
      groups: 257,
      totalUnits: 761,
      interpretedUnits: 0,
      causes: {},
    },
  },
  draft6: {
    dir: "draft6",
    defaultDialect: "http://json-schema.org/draft-06/schema",
    flag: {
      groups: 232,
      totalUnits: 679,
      interpretedUnits: 0,
      causes: {},
    },
  },
};

async function census(
  pin: DialectPin,
  output: "flag" | "list",
): Promise<PlanCensusResult> {
  return runPlanCensus({
    suiteDir: join(SUITE_ROOT, "tests", pin.dir),
    loadAndPlan: async (schema, retrievalUri) => {
      try {
        const engine = createEngine({
          loaders: [suiteRemotesLoader(REMOTES)],
          ...(pin.defaultDialect === undefined
            ? {}
            : { defaultDialect: pin.defaultDialect }),
        });
        const loaded = await engine.loadSchema(schema, retrievalUri);
        return explainCompilation(buildPlan(engine, loaded, { output }));
      } catch {
        return undefined;
      }
    },
  });
}

function assertPinned(
  result: PlanCensusResult,
  expected: Expected,
  label: string,
): void {
  const diagnosis =
    `${label}: interpreted units:\n  ` + result.interpretedKeys.join("\n  ");
  expect(result.registerFailures, `${label}: register failures`).toBe(0);
  expect(result.groups, `${label}: groups`).toBe(expected.groups);
  expect(result.totalUnits, diagnosis).toBe(expected.totalUnits);
  expect(result.interpretedUnits, diagnosis).toBe(expected.interpretedUnits);
  expect(result.causes, diagnosis).toEqual(expected.causes);
  expect(result.trackingUnits, `${label}: tracking units`).toBe(
    expected.trackingUnits ?? 0,
  );
  expect(result.regionUnits, `${label}: region units`).toBe(
    expected.regionUnits ?? 0,
  );
}

describe("plan-classification census (exact pins per dialect)", () => {
  for (const [name, pin] of Object.entries(PINS)) {
    it(`${name} flag plan matches the pinned census`, async () => {
      assertPinned(await census(pin, "flag"), pin.flag, `${name}/flag`);
    });
    if (pin.list) {
      const list = pin.list;
      it(`${name} list plan matches the pinned census`, async () => {
        assertPinned(await census(pin, "list"), list, `${name}/list`);
      });
    } else {
      it(`${name} list plan equals the flag plan (no unevaluated* to demote)`, async () => {
        const flag = await census(pin, "flag");
        const list = await census(pin, "list");
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
    }
  }
});
