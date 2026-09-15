// Per-keyword state in annotation and region modes: the produce accumulator
// both channels read, the annotation-unit literal, and the channel push.

import {
  escapeSegment,
  type LowerCursor,
  type LowerProduceValue,
  type LowerStmt,
} from "@json-schema-engine/core";
import { type CodeChunk, id, js, num, str } from "../emit.js";
import { EV, findProduce, hasAnnotate } from "./names.js";
import { UnitContext } from "./context.js";
import { expr } from "./expressions.js";

/**
 * Prepare the keyword currently being emitted: decide whether its annotate
 * survives the static retention lists, whether its produce feeds the
 * coverage channel, and allocate the produce's accumulator (declared by the
 * returned chunks). No-op outside annotation and region modes.
 */
export function beginKeyword(
  ctx: UnitContext,
  stmts: readonly LowerStmt[],
): CodeChunk[] {
  ctx.annKw = null;
  ctx.annKwKept = false;
  ctx.covKwKept = false;
  // Trace emission pre-declared every keyword's verdict slot (unit.ts).
  ctx.kwOk = ctx.trace
    ? (ctx.kwVerdicts.get(ctx.currentKeyword) ?? null)
    : null;
  if (!ctx.annMode && !ctx.regionMode) return [];
  ctx.annKwKept =
    ctx.annMode &&
    hasAnnotate(stmts) &&
    (!ctx.annKeep || ctx.annKeep("", ctx.currentKeyword, ctx.currentVocab));
  const value = findProduce(stmts);
  if (!value) return [];
  // Region channel-push gate (rule 5): only a coverage producer some
  // consumer reads feeds the channel. Retention never affects it —
  // dependency data is not output.
  ctx.covKwKept = ctx.regionMode && ctx.coverageIds.has(ctx.currentBehaviorId);
  if (!ctx.covKwKept) return [];
  const decls: CodeChunk[] = [];
  if (ctx.output === "list" && !ctx.trace) {
    const k = id("k" + String(ctx.counters.temp++));
    ctx.kwOk = k;
    decls.push(js`let ${k} = true;`);
  }
  if (value.kind === "collectedNames") {
    const n = id("n" + String(ctx.counters.temp++));
    ctx.annKw = { produceKind: "collectedNames", names: n };
    decls.push(js`const ${n} = new Set();`);
  } else if (value.render === "largestOrTrue") {
    const m = id("n" + String(ctx.counters.temp++));
    ctx.annKw = { produceKind: "largestOrTrue", max: m };
    decls.push(js`let ${m} = -1;`);
  } else if (value.render === "appliedTrue") {
    const a = id("n" + String(ctx.counters.temp++));
    ctx.annKw = { produceKind: "appliedTrue", applied: a };
    decls.push(js`let ${a} = false;`);
  } else {
    const t = id("n" + String(ctx.counters.temp++));
    ctx.annKw = { produceKind: "matchedOrAllTrue", matched: t };
    decls.push(js`const ${t} = [];`);
  }
  return decls;
}

/**
 * The annotation-unit object literal for the current keyword: constant
 * keyword/vocabulary/schemaLocation, runtime evaluationPath (`ep` suffix)
 * and inputLocation (`ip`), key order matching core's renderAnnotation.
 * `vocabulary` is omitted when null (unknown keywords only).
 */
export function annUnit(ctx: UnitContext, valueExpr: CodeChunk): CodeChunk {
  const suffix = "/" + escapeSegment(ctx.currentKeyword);
  const sloc = ctx.unit.ref.baseUri + "#" + ctx.unit.ref.pointer + suffix;
  const vocab =
    ctx.currentVocab !== null
      ? js`vocabulary: ${str(ctx.currentVocab)}, `
      : js``;
  return js`{ keyword: ${str(ctx.currentKeyword)}, ${vocab}evaluationPath: ${id("ep")} + ${str(suffix)}, schemaLocation: ${str(sloc)}, inputLocation: ${id("ip")}, annotation: ${valueExpr} }`;
}

/**
 * Record an attempted child-of-here application's segment into the current
 * keyword's produce accumulator (before the verdict — the segment is
 * "attempted", not "succeeded"). Non-child-of-here cursors, and keywords
 * without an active accumulator, record nothing.
 */
export function annRecordSegment(
  ctx: UnitContext,
  cursor: LowerCursor,
): CodeChunk | null {
  if (!ctx.annKw) return null;
  if (cursor.kind !== "child" || cursor.of.kind !== "here") return null;
  const seg = cursor.segment;
  const segExpr =
    typeof seg === "string"
      ? str(seg)
      : typeof seg === "number"
        ? num(seg)
        : expr(ctx, seg);
  switch (ctx.annKw.produceKind) {
    case "collectedNames":
      return js`${ctx.annKw.names!}.add(${segExpr});`;
    case "largestOrTrue":
      return js`if (${segExpr} > ${ctx.annKw.max!}) ${ctx.annKw.max!} = ${segExpr};`;
    case "appliedTrue":
      return js`${ctx.annKw.applied!} = true;`;
    default:
      // matchedOrAllTrue records inside its countRange, not at apply sites.
      return null;
  }
}

/**
 * Push a consumed producer's dependency data onto the runtime coverage
 * channel (rule 5), writing the value the interpreter would produce. The
 * "has data" guards match the interpreter's produce conditions so the
 * channel carries exactly what a consumer's visible-records fold sees.
 */
export function produceChannel(
  ctx: UnitContext,
  value: LowerProduceValue,
): CodeChunk {
  const v = ctx.valueVar;
  if (value.kind === "collectedNames") {
    // The enclosing lower() gates this produce behind an object-type test;
    // the (attempted, deduped) name array spreads from the Set.
    return js`${EV}.push([...${ctx.annKw!.names!}]);`;
  }
  if (value.render === "largestOrTrue") {
    const mx = ctx.annKw!.max!;
    return js`if (${mx} >= 0) ${EV}.push(${mx} + 1 === ${v}.length ? true : ${mx});`;
  }
  if (value.render === "appliedTrue") {
    const ap = ctx.annKw!.applied!;
    return js`if (${ap}) ${EV}.push(true);`;
  }
  const mt = ctx.annKw!.matched!;
  return js`if (${mt}.length > 0) ${EV}.push(${mt}.length === ${v}.length ? true : ${mt});`;
}
