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
import { createEngine } from "@json-schema-engine/core";
import { buildPlan, explainCompilation } from "@json-schema-engine/compiler";
import {
  runPlanCensus,
  suiteRemotesLoader,
  type PlanCensusResult,
} from "@json-schema-engine/test-kit";

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
  /** `$dynamicRef` sites resolved at plan time (ADR 0004); default 0. */
  resolvedDynamicSites?: number;
}

// Transcribed from a local run (deterministic — two runs hash-identical).
// FLAG mode compiles dynamic-coverage unevaluated* consumers with runtime
// tracking (phase B) and keeps static-coverage consumers on the static-license
// fast path. LIST mode never static-licenses (plan.ts: static coverage models
// the parent-success path only), so it tracks EVERY consumer: list
// trackingUnits EXCEED flag's, total units match flag's (tracked subtrees are
// planned), and the remaining `unlowerable` units are exactly the nested
// tracked consumers islanded by the region fixpoint. The flag pins must not
// move under a list-only change (their own rows assert that).
//
// draft2020-12's one `dynamic` unit is dynamicRef.json's "multiple dynamic
// paths to the $dynamicRef keyword" (genericList reached from numberList and
// stringList, which declare different anchors); every other `$dynamicRef`
// site — the rest of dynamicRef.json, the two `$ref`-to-metaschema groups,
// unevaluated*'s dynamic cases — resolves statically (ADR 0004), which is
// also why totalUnits exceeds the pre-ADR count (islanded subtrees are now
// planned). 2019-09's two `dynamic` units are recursiveRef.json's "multiple
// dynamic paths" and "dynamic destination" groups (the same two-declarer
// shape); its other 47 `$recursiveRef` sites — the rest of recursiveRef.json,
// the 19 sites of the 2019-09 metaschema reached by its two `$ref`-to-
// metaschema groups, unevaluated*'s recursive cases — resolve statically
// through the same analysis (ADR 0004's amendment).
const PINS: Record<string, DialectPin> = {
  "draft2020-12": {
    dir: "draft2020-12",
    flag: {
      groups: 383,
      totalUnits: 1370,
      interpretedUnits: 1,
      causes: { dynamic: 1 },
      trackingUnits: 20,
      regionUnits: 50,
      resolvedDynamicSites: 58,
    },
    list: {
      groups: 383,
      totalUnits: 1370,
      interpretedUnits: 8,
      causes: { dynamic: 1, unlowerable: 7 },
      trackingUnits: 78,
      regionUnits: 66,
      resolvedDynamicSites: 58,
    },
  },
  "draft2019-09": {
    dir: "draft2019-09",
    defaultDialect: "https://json-schema.org/draft/2019-09/schema",
    flag: {
      groups: 372,
      totalUnits: 1299,
      interpretedUnits: 2,
      causes: { dynamic: 2 },
      trackingUnits: 16,
      regionUnits: 43,
      resolvedDynamicSites: 47,
    },
    list: {
      groups: 372,
      totalUnits: 1299,
      interpretedUnits: 9,
      causes: { dynamic: 2, unlowerable: 7 },
      trackingUnits: 75,
      regionUnits: 62,
      resolvedDynamicSites: 47,
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
  expect(result.resolvedDynamicSites, diagnosis).toBe(
    expected.resolvedDynamicSites ?? 0,
  );
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
