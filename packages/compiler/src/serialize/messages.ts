// Error-unit rendering for list mode: messages, structured params, and the
// relevance mark that truncates a keyword's rejected sub-evaluation errors.

import {
  escapeSegment,
  type LowerMessage,
  type LowerParams,
} from "@json-schema-engine/core";
import { type CodeChunk, id, join, js, str } from "../emit.js";
import { ERRS, ST, TN } from "./names.js";
import { UnitContext, SerializeError } from "./context.js";
import { expr } from "./expressions.js";

/**
 * Renders a LowerMessage to a string expression. `tallyVar` binds the
 * message's tally placeholder (combine/count checks).
 */
export function renderMessage(
  ctx: UnitContext,
  msg: LowerMessage,
  tallyVar?: CodeChunk,
): CodeChunk {
  const parts = msg.map((part) => {
    if (typeof part === "string") return str(part);
    if (part.kind === "tally") {
      if (!tallyVar) throw new SerializeError("tally outside a counted check");
      return js`String(${tallyVar})`;
    }
    return js`String(${expr(ctx, part)})`;
  });
  if (parts.length === 0) return str("");
  return parts.length === 1 ? parts[0]! : js`(${join(" + ", parts)})`;
}

/**
 * Renders a LowerParams map to an object-literal expression, mirroring
 * renderError's includeParams shape. `tallyVar` binds tally placeholders
 * exactly as in {@link renderMessage}.
 */
export function paramsChunk(
  ctx: UnitContext,
  params: LowerParams | undefined,
  tallyVar?: CodeChunk,
  tallyListVar?: CodeChunk,
): CodeChunk {
  // pushError drops the chunk entirely when params are off — don't render
  // (a tallyList reference has no accumulator to bind to in that mode).
  if (!ctx.listParams || params === undefined) return js`{}`;
  const entries = Object.entries(params).map(([key, part]) => {
    let value: CodeChunk;
    if (part.kind === "tally" || part.kind === "tallyList") {
      const bound = part.kind === "tally" ? tallyVar : tallyListVar;
      if (!bound)
        throw new SerializeError(part.kind + " outside a counted check");
      value = bound;
    } else {
      value = expr(ctx, part);
    }
    return js`${str(key)}: ${value}`;
  });
  return js`{ ${join(", ", entries)} }`;
}

/**
 * List-mode failure: mark the unit invalid and push an interpreter-exact
 * error unit (renderError's shape — keyword suffix escaped on both
 * paths). Unit objects materialize only here, on the failure path (D9e).
 */
export function pushError(
  ctx: UnitContext,
  msg: CodeChunk,
  withKeyword = true,
  params?: CodeChunk,
): CodeChunk {
  const suffix = withKeyword ? "/" + escapeSegment(ctx.currentKeyword) : "";
  const sloc = ctx.unit.ref.baseUri + "#" + ctx.unit.ref.pointer + suffix;
  const vocab =
    ctx.currentVocab !== null
      ? js`vocabulary: ${str(ctx.currentVocab)}, `
      : js``;
  const extra = ctx.listParams
    ? withKeyword
      ? js`, keyword: ${str(ctx.currentKeyword)}, ${vocab}params: ${params ?? js`{}`}`
      : js`, params: ${params ?? js`{}`}`
    : js``;
  const fail = ctx.kwOk
    ? js`ok = false; ${ctx.kwOk} = false;`
    : js`ok = false;`;
  const unit = js`{ evaluationPath: ${id("ep")} + ${str(suffix)}, schemaLocation: ${str(sloc)}, inputLocation: ${id("ip")}, error: ${msg}${extra} }`;
  // Trace emission records the raising application with the unit.
  return ctx.trace
    ? js`${fail} ${id("h_err")}(${ST}, ${TN}, ${unit});`
    : js`${fail} ${ERRS}.push(${unit});`;
}

/** The error channel's current length: the value a relevance mark takes. */
export function errsLength(ctx: UnitContext): CodeChunk {
  return ctx.trace ? js`${ST}.errs.length` : js`${ERRS}.length`;
}

/**
 * Drop the errors pushed since mark `m` (an accepting keyword made them
 * irrelevant). Trace emission routes the cut through the runtime, which
 * discards or retains them by the artifact's level.
 */
export function errsCut(ctx: UnitContext, m: CodeChunk): CodeChunk {
  return ctx.trace
    ? js`${id("h_cutE")}(${ST}, ${m});`
    : js`${ERRS}.length = ${m};`;
}

/**
 * Error relevance (draft-03 §12.2) in list mode: a keyword that accepts
 * makes the errors its sub-evaluations pushed irrelevant. Callers take the
 * mark before the keyword's applies and truncate on the accept path;
 * every branch's errors land in the shared `errs` between the two.
 */
export function errMark(ctx: UnitContext): CodeChunk | null {
  return ctx.output === "list" ? id("m" + String(ctx.counters.temp++)) : null;
}
