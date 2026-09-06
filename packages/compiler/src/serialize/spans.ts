// Channel spans at application boundaries: the annotation and coverage
// channels mark before an application and truncate when it fails (rule 3).

import { type CodeChunk, id, join, js } from "../emit.js";
import { EV } from "./names.js";
import { UnitContext } from "./context.js";

/**
 * The channel spans active at an application boundary: `anns` in annotation
 * mode, `ev` in region emission, both when composed, none otherwise. errs
 * is not one of them: a failed application keeps its errors (they become
 * irrelevant only when an enclosing KEYWORD accepts, draft-03 §12.2), so
 * error truncation is keyword-scoped — see errMark() — not per branch.
 */
export function channelSpans(
  ctx: UnitContext,
  includeEv = true,
): { chan: CodeChunk; m: CodeChunk }[] {
  const spans: { chan: CodeChunk; m: CodeChunk }[] = [];
  if (ctx.annMode) {
    spans.push({
      chan: id("anns"),
      m: id("m" + String(ctx.counters.temp++)),
    });
  }
  if (ctx.regionMode && includeEv) {
    spans.push({ chan: EV, m: id("m" + String(ctx.counters.temp++)) });
  }
  return spans;
}

export function spanDecls(
  ctx: UnitContext,
  spans: { chan: CodeChunk; m: CodeChunk }[],
): CodeChunk {
  return join(
    " ",
    spans.map(({ chan, m }) => js`const ${m} = ${chan}.length;`),
  );
}

export function spanResets(
  ctx: UnitContext,
  spans: { chan: CodeChunk; m: CodeChunk }[],
): CodeChunk {
  return join(
    " ",
    spans.map(({ chan, m }) => js`${chan}.length = ${m};`),
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
