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
}

/** Summarizes a plan's classification for census gates and diagnostics. */
export function explainCompilation(
  plan: CompilationPlan,
): CompilationExplanation {
  const causes: Partial<Record<FallbackCause, number>> = {};
  const interpretedKeys: string[] = [];
  let staticUnits = 0;
  let reachesInterpretedCount = 0;
  for (const unit of plan.units.values()) {
    if (unit.kind === "static") staticUnits++;
    else {
      interpretedKeys.push(unit.key);
      if (unit.cause !== undefined) {
        causes[unit.cause] = (causes[unit.cause] ?? 0) + 1;
      }
    }
    if (unit.reachesInterpreted) reachesInterpretedCount++;
  }
  interpretedKeys.sort();
  return {
    totalUnits: plan.units.size,
    staticUnits,
    interpretedUnits: plan.units.size - staticUnits,
    causes,
    interpretedKeys,
    reachesInterpretedCount,
  };
}
