// Compilation-plan diagnostics (deferred-register item, built for the
// plan-census gates): interpreted fallback is always CORRECT, so a
// regression that silently flips units static→interpreted passes every
// suite/differential/fuzz gate — only a census over these summaries
// notices. The summarizer is pure read-only projection of plan data.

import type { CompilationPlan, FallbackCause } from "./plan.js";

/** One `$dynamicRef` site the planner resolved statically (ADR 0004). */
export interface ResolvedDynamicSite {
  /** canonical key of the unit holding the keyword */
  unit: string;
  keyword: string;
  ref: string;
  /** canonical key of the resolved target */
  target: string;
  /**
   * the resource whose `$dynamicAnchor` wins on every reaching path, or
   * `null` when the site resolves lexically (`DynamicResolution.winner`)
   */
  winner: string | null;
}

/** Aggregate view of one {@link CompilationPlan}'s unit classification. */
export interface CompilationExplanation {
  /** Every planned unit, static or not. */
  totalUnits: number;
  staticUnits: number;
  interpretedUnits: number;
  /** Interpreted-unit count per fallback cause; absent cause = zero. */
  causes: Partial<Record<FallbackCause, number>>;
  /**
   * Canonical `baseUri#pointer` keys of the interpreted units — for
   * diagnosis when a census count assertion fails, not for pinning (key
   * lists churn on suite reorganization without adding regression signal).
   */
  interpretedKeys: string[];
  /** Units whose apply paths can reach an interpreted unit. */
  reachesInterpretedCount: number;
  /**
   * Static consumer units compiled with runtime evaluated-set tracking (phase
   * B) — the flag-mode alternative to interpreting a dynamic-coverage consumer.
   */
  trackingUnits: number;
  /** Static units in some tracked unit's in-place coverage region (phase B). */
  regionUnits: number;
  /**
   * `$dynamicRef` sites discharged at plan time and compiled as static edges
   * — the "why did this site not island" answer. Sorted by unit key, then
   * keyword, then reference.
   */
  resolvedDynamicSites: ResolvedDynamicSite[];
}

/** Summarizes a plan's classification for census gates and diagnostics. */
export function explainCompilation(
  plan: CompilationPlan,
): CompilationExplanation {
  const causes: Partial<Record<FallbackCause, number>> = {};
  const interpretedKeys: string[] = [];
  let staticUnits = 0;
  let reachesInterpretedCount = 0;
  let trackingUnits = 0;
  let regionUnits = 0;
  const resolvedDynamicSites: ResolvedDynamicSite[] = [];
  for (const unit of plan.units.values()) {
    if (unit.kind === "static") {
      staticUnits++;
      for (const edge of unit.edges) {
        if (edge.dynamic === undefined) continue;
        resolvedDynamicSites.push({
          unit: unit.key,
          keyword: edge.keyword,
          ref: edge.app.ref ?? "",
          target: edge.targetKey,
          winner: edge.dynamic.winner,
        });
      }
    } else {
      interpretedKeys.push(unit.key);
      if (unit.cause !== undefined) {
        causes[unit.cause] = (causes[unit.cause] ?? 0) + 1;
      }
    }
    if (unit.reachesInterpreted) reachesInterpretedCount++;
    if (unit.tracking) trackingUnits++;
    if (unit.inRegion) regionUnits++;
  }
  interpretedKeys.sort();
  resolvedDynamicSites.sort(
    (a, b) =>
      a.unit.localeCompare(b.unit) ||
      a.keyword.localeCompare(b.keyword) ||
      a.ref.localeCompare(b.ref),
  );
  return {
    totalUnits: plan.units.size,
    staticUnits,
    interpretedUnits: plan.units.size - staticUnits,
    causes,
    interpretedKeys,
    reachesInterpretedCount,
    trackingUnits,
    regionUnits,
    resolvedDynamicSites,
  };
}
