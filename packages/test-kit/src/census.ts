// Plan-classification census over a suite directory. Interpreted fallback
// is always correct, so classification regressions are invisible to every
// behavioral gate; census tests pin exact per-dialect counts instead.
// Validator-agnostic like the rest of test-kit: the caller injects
// loadAndPlan (engine construction, remote loading, buildPlan, summary),
// so this module carries no @json-schema-engine/core or @json-schema-engine/compiler dependency.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { JsonValue } from "./index.js";

/** The per-group summary the caller's `loadAndPlan` returns. */
export interface PlanCensusSummary {
  totalUnits: number;
  interpretedUnits: number;
  /** Interpreted-unit count per fallback cause; absent cause = zero. */
  causes: Readonly<Partial<Record<string, number>>>;
  /** Canonical keys of interpreted units, for failure diagnosis. */
  interpretedKeys?: readonly string[];
  /** Consumer units compiled with runtime coverage tracking (phase B). */
  trackingUnits?: number;
  /** Units in some tracked unit's coverage region (phase B). */
  regionUnits?: number;
}

/** Aggregated census over every group of every file in a suite directory. */
export interface PlanCensusResult {
  files: number;
  groups: number;
  /** Groups whose loadAndPlan returned undefined (did not register). */
  registerFailures: number;
  totalUnits: number;
  interpretedUnits: number;
  causes: Record<string, number>;
  /** Diagnosis payload: every interpreted unit key, tagged by group. */
  interpretedKeys: string[];
  /** Consumer units compiled with runtime coverage tracking (phase B). */
  trackingUnits: number;
  /** Units in some tracked unit's coverage region (phase B). */
  regionUnits: number;
}

/**
 * Runs `loadAndPlan` over every group of every `*.json` file in `suiteDir`
 * and aggregates the summaries. Deterministic given a deterministic
 * `loadAndPlan` (files are sorted); async because remote-bearing groups
 * load through an engine's async loader path.
 */
export async function runPlanCensus(options: {
  suiteDir: string;
  loadAndPlan(
    schema: JsonValue,
    retrievalUri: string,
  ): Promise<PlanCensusSummary | undefined>;
}): Promise<PlanCensusResult> {
  const result: PlanCensusResult = {
    files: 0,
    groups: 0,
    registerFailures: 0,
    totalUnits: 0,
    interpretedUnits: 0,
    causes: {},
    interpretedKeys: [],
    trackingUnits: 0,
    regionUnits: 0,
  };
  const files = readdirSync(options.suiteDir)
    .filter((f) => f.endsWith(".json"))
    .sort();
  for (const fileName of files) {
    result.files++;
    const groups = JSON.parse(
      readFileSync(join(options.suiteDir, fileName), "utf8"),
    ) as { description: string; schema: JsonValue }[];
    for (let gi = 0; gi < groups.length; gi++) {
      result.groups++;
      const retrievalUri = `https://census.example/${fileName.replace(/\.json$/, "")}/${String(gi)}`;
      const summary = await options.loadAndPlan(
        groups[gi]!.schema,
        retrievalUri,
      );
      if (summary === undefined) {
        result.registerFailures++;
        continue;
      }
      result.totalUnits += summary.totalUnits;
      result.interpretedUnits += summary.interpretedUnits;
      result.trackingUnits += summary.trackingUnits ?? 0;
      result.regionUnits += summary.regionUnits ?? 0;
      for (const [cause, count] of Object.entries(summary.causes)) {
        if (count === undefined || count === 0) continue;
        result.causes[cause] = (result.causes[cause] ?? 0) + count;
      }
      for (const key of summary.interpretedKeys ?? []) {
        result.interpretedKeys.push(`${fileName}#${String(gi)} ${key}`);
      }
    }
  }
  return result;
}
