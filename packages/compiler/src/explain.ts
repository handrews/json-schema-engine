// Compilation-plan diagnostics (deferred-register item, built for the
// plan-census gates): interpreted fallback is always CORRECT, so a
// regression that silently flips units static→interpreted passes every
// suite/differential/fuzz gate — only a census over these summaries
// notices. The summarizer is pure read-only projection of plan data.

import type { CompilationPlan, FallbackCause } from "./plan.js";

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
  for (const unit of plan.units.values()) {
    if (unit.kind === "static") staticUnits++;
    else {
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
  return {
    totalUnits: plan.units.size,
    staticUnits,
    interpretedUnits: plan.units.size - staticUnits,
    causes,
    interpretedKeys,
    reachesInterpretedCount,
    trackingUnits,
    regionUnits,
  };
}
