// Channel spans at application boundaries: the annotation and coverage
// channels mark before an application and truncate when it fails (rule 3).

import { type CodeChunk, id, join, js } from "../emit.js";
import { ANNS, EV, ST, TN } from "./names.js";
import { UnitContext } from "./context.js";

/** One marked channel: the annotation channel or the coverage channel. */
export interface Span {
  kind: "anns" | "ev";
  m: CodeChunk;
}

/** The annotation channel's current length: the value a span mark takes. */
export function annsLength(ctx: UnitContext): CodeChunk {
  return ctx.trace ? js`${ST}.anns.length` : js`${ANNS}.length`;
}

/**
 * Drop the annotations pushed since mark `m` (a failed application's).
 * Trace emission routes the cut through the runtime, which discards or
 * retains them by the artifact's level.
 */
export function annsCut(ctx: UnitContext, m: CodeChunk): CodeChunk {
  return ctx.trace
    ? js`${id("h_cutA")}(${ST}, ${m});`
    : js`${ANNS}.length = ${m};`;
}

/** Push one annotation unit; trace emission records the application with it. */
export function annsPush(ctx: UnitContext, unit: CodeChunk): CodeChunk {
  return ctx.trace
    ? js`${id("h_ann")}(${ST}, ${TN}, ${unit});`
    : js`${ANNS}.push(${unit});`;
}

/**
 * The channel spans active at an application boundary: `anns` in annotation
 * mode, `ev` in region emission, both when composed, none otherwise. errs
 * is not one of them: a failed application keeps its errors (they become
 * irrelevant only when an enclosing KEYWORD accepts, draft-03 §12.2), so
 * error truncation is keyword-scoped — see errMark() — not per branch.
 */
export function channelSpans(ctx: UnitContext, includeEv = true): Span[] {
  const spans: Span[] = [];
  if (ctx.annMode) {
    spans.push({ kind: "anns", m: id("m" + String(ctx.counters.temp++)) });
  }
  if (ctx.regionMode && includeEv) {
    spans.push({ kind: "ev", m: id("m" + String(ctx.counters.temp++)) });
  }
  return spans;
}

export function spanDecls(ctx: UnitContext, spans: Span[]): CodeChunk {
  return join(
    " ",
    spans.map(({ kind, m }) =>
      kind === "anns"
        ? js`const ${m} = ${annsLength(ctx)};`
        : js`const ${m} = ${EV}.length;`,
    ),
  );
}

export function spanResets(ctx: UnitContext, spans: Span[]): CodeChunk {
  return join(
    " ",
    spans.map(({ kind, m }) =>
      kind === "anns" ? annsCut(ctx, m) : js`${EV}.length = ${m};`,
    ),
  );
}

/**
 * One grouped-fold branch: run `call`, apply `hit` on success, truncate the
 * active channel spans on failure (a failed branch's records and
 * coverage discard; a passing branch's merge — channel rule 3 per branch).
 */
export function branchSpan(
  ctx: UnitContext,
  call: CodeChunk,
  hit: CodeChunk,
): CodeChunk {
  const spans = channelSpans(ctx);
  if (spans.length === 0) return js`if (${call}) { ${hit} }`;
  return js`{ ${spanDecls(ctx, spans)} if (${call}) { ${hit} } else { ${spanResets(ctx, spans)} } }`;
}
