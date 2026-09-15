// Per-unit orchestration: run each present keyword's lower() in dialect
// order and hand its statements to the emitters.

import {
  escapeSegment,
  type JsonValue,
  type LowerStmt,
  type LoweringContext,
} from "@json-schema-engine/core";
import { type CodeChunk, id, join, js, str, json } from "../emit.js";
import { TN } from "./names.js";
import { UnitContext, SerializeError } from "./context.js";
import { beginKeyword } from "./keywords.js";
import { keywordStatements } from "./statements.js";
import { annsPush } from "./spans.js";

/** Serialize every present keyword of this unit, in dialect order. */
export function unitBody(ctx: UnitContext): CodeChunk[] {
  const node = ctx.unit.ref.node as Record<string, JsonValue>;
  const dialect = ctx.registry.dialectFor(ctx.unit.ref.baseUri);
  // Mirrors buildPlan's refOnly (plan.ts, citing engine.ts:397): the plan
  // only resolved edges for $ref when this is true, so siblings must be
  // skipped here too, or this would try to serialize applies the plan
  // never planned.
  const refOnly = dialect.refIgnoresSiblings && Object.hasOwn(node, "$ref");
  const out: CodeChunk[] = [];
  if (ctx.trace) {
    // One verdict slot per present non-structural keyword, declared up front:
    // `if` settles `then`/`else`'s verdicts before those keywords' own (empty)
    // statement lists run. Structural keywords record no entry (engine.ts).
    const slots: CodeChunk[] = [];
    for (const entry of dialect.ordered) {
      if (refOnly && entry.name !== "$ref") continue;
      if (!Object.hasOwn(node, entry.name)) continue;
      if (entry.behavior.structural === true) continue;
      const k = id("k" + String(ctx.counters.temp++));
      ctx.kwVerdicts.set(entry.name, k);
      slots.push(js`${k} = true`);
    }
    if (slots.length > 0) out.push(js`let ${join(", ", slots)};`);
  }
  for (const entry of dialect.ordered) {
    if (refOnly && entry.name !== "$ref") continue;
    if (!Object.hasOwn(node, entry.name)) continue;
    const behavior = entry.behavior;
    if (typeof behavior.lower !== "function") {
      throw new SerializeError(
        "planner accepted unlowerable keyword '" + entry.name + "' (bug)",
      );
    }
    const stmts = collect(ctx, entry.name, (lctx) => {
      behavior.lower!(node[entry.name]!, lctx);
    });
    ctx.currentVocab = entry.vocabularyUri;
    ctx.currentBehaviorId = behavior.id;
    // Accumulator declarations hoist above the keyword's statements: the
    // application call sites feed them, the produce reads them.
    const decls = beginKeyword(ctx, stmts);
    const chunks = keywordStatements(ctx, stmts);
    out.push(...decls, ...chunks);
    // The verdict entry follows the keyword's applications, as the
    // interpreter's traceKeyword does.
    if (ctx.trace && behavior.structural !== true) {
      const k = ctx.kwVerdicts.get(entry.name)!;
      out.push(
        js`${TN}.keywords.push({ name: ${str(entry.name)}, valid: ${k} });`,
      );
    }
  }
  // Unknown keywords collect as annotations (engine.ts:414): unconditional
  // constant annotations, in schema-key order, after every dialect keyword.
  // The refOnly break silences siblings, matching the interpreter. Trace
  // emission records each as an accepting keyword entry whether or not its
  // annotation is selected.
  if ((ctx.annMode || ctx.trace) && !refOnly) {
    for (const name of Object.keys(node)) {
      if (dialect.keywords.has(name)) continue;
      if (ctx.trace) {
        out.push(js`${TN}.keywords.push({ name: ${str(name)}, valid: true });`);
      }
      if (!ctx.annMode) continue;
      if (ctx.annKeep && !ctx.annKeep("", name, null)) continue;
      const suffix = "/" + escapeSegment(name);
      const sloc = ctx.unit.ref.baseUri + "#" + ctx.unit.ref.pointer + suffix;
      out.push(
        annsPush(
          ctx,
          js`{ keyword: ${str(name)}, evaluationPath: ${id("ep")} + ${str(suffix)}, schemaLocation: ${str(sloc)}, inputLocation: ${id("ip")}, annotation: ${json(node[name]!)} }`,
        ),
      );
    }
  }
  return out;
}

/** Run one keyword's lower() against a fresh LoweringContext, return its stmts. */
export function collect(
  ctx: UnitContext,
  keyword: string,
  run: (lctx: LoweringContext) => void,
): LowerStmt[] {
  ctx.currentKeyword = keyword;
  const stmts: LowerStmt[] = [];
  const unit = ctx.unit;
  const lctx: LoweringContext = {
    instance: { kind: "instance" },
    schema: unit.ref.node as Record<string, JsonValue>,
    staticCoverage: () => unit.coverage,
    // A tracked unit's consumers read the runtime channel; a static-coverage
    // consumer (even one that is a region member) keeps its static path and
    // instead PUSHES its produce onto the channel for the enclosing consumer.
    runtimeCoverage: () => unit.tracking === true,
    emit: (...s) => stmts.push(...s),
    binding: () => ctx.counters.binding++,
  };
  run(lctx);
  return stmts;
}
