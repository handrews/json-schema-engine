// LowerStmt rendering: the per-keyword statement list with its grouped
// anyOf/oneOf runs, every statement kind, and the apply folds.

import {
  type JsonValue,
  type LowerApply,
  type LowerMessage,
  type LowerParams,
  type LowerStmt,
} from "@jse/core";
import { type CodeChunk, id, join, js, num, json } from "../emit.js";
import { EV, bindingVar, counterVar, foldVar } from "./names.js";
import { UnitContext, SerializeError } from "./context.js";
import { renderMessage, paramsChunk, pushError, errMark } from "./messages.js";
import { channelSpans, spanDecls, spanResets, branchSpan } from "./spans.js";
import { annUnit, annRecordSegment, produceChannel } from "./keywords.js";
import { expr } from "./expressions.js";
import { applyCall, tryInline } from "./apply.js";

/**
 * Serialize one keyword's statement list. Runs of anyMayPass applies
 * (the anyOf shape) group into a single OR check; short-circuit emission
 * is licensed here because the planner interpreted every node whose
 * channel a consumer could observe (slice licensing, DESIGN §7). Runs of
 * exactlyOne applies (the oneOf shape) group into a counter block that
 * runs EVERY branch — never stop-at-first-success, since the count past 1
 * must still be exact.
 */
export function keywordStatements(
  ctx: UnitContext,
  stmts: readonly LowerStmt[],
): CodeChunk[] {
  const out: CodeChunk[] = [];
  let anyRun: CodeChunk[] = [];
  let oneRun: CodeChunk[] = [];
  const flushAny = (message?: LowerMessage, params?: LowerParams) => {
    if (anyRun.length === 0) return;
    if (ctx.output === "list") {
      // Every branch runs (§7: list artifacts never short-circuit), each
      // marking/truncating its channel spans (branchSpan). An accepting
      // run drops every branch's errors (errMark).
      const a = counterVar(ctx.counters.tally++);
      const em = errMark(ctx)!;
      const runs = anyRun.map((call) =>
        branchSpan(ctx, call, js`${a} = true;`),
      );
      const onFail = pushError(
        ctx,
        renderMessage(ctx, message ?? ["no branch matched"]),
        true,
        paramsChunk(ctx, params),
      );
      out.push(
        js`let ${a} = false; const ${em} = ${id("errs")}.length; ${join(" ", runs)} if (${a}) { ${id("errs")}.length = ${em}; } else { ${onFail} }`,
      );
    } else if (ctx.regionMode) {
      // Every branch runs (no short-circuit — a later branch's success
      // contributes coverage the interpreter would merge), each marking and
      // truncating its own channel span (rule 2). Flag failure on no match.
      const a = counterVar(ctx.counters.tally++);
      const runs = anyRun.map((call) =>
        branchSpan(ctx, call, js`${a} = true;`),
      );
      out.push(
        js`let ${a} = false; ${join(" ", runs)} if (!${a}) return false;`,
      );
    } else {
      out.push(js`if (!(${join(" || ", anyRun)})) return false;`);
    }
    anyRun = [];
  };
  const flushOne = (message?: LowerMessage, params?: LowerParams) => {
    if (oneRun.length === 0) return;
    const c = counterVar(ctx.counters.tally++);
    if (ctx.output === "list") {
      // Params referencing the passing-branch indexes (tallyList) need an
      // index accumulator next to the count; branch order IS run order.
      // Both-pass discards at the caller (the unit fails, its span
      // truncates); each branch marks/truncates its own spans here.
      const wantsList =
        ctx.listParams &&
        params !== undefined &&
        Object.values(params).some((p) => p.kind === "tallyList");
      const p = wantsList ? counterVar(ctx.counters.tally++) : undefined;
      const incs = oneRun.map((call, k) =>
        branchSpan(
          ctx,
          call,
          p ? js`${c}++; ${p}.push(${num(k)});` : js`${c}++;`,
        ),
      );
      const decl = p ? js`let ${c} = 0; const ${p} = [];` : js`let ${c} = 0;`;
      const onFail = pushError(
        ctx,
        renderMessage(
          ctx,
          message ?? [{ kind: "tally" }, " branches matched"],
          c,
        ),
        true,
        paramsChunk(ctx, params, c, p),
      );
      const em = errMark(ctx)!;
      out.push(
        js`${decl} const ${em} = ${id("errs")}.length; ${join(" ", incs)} if (${c} === 1) { ${id("errs")}.length = ${em}; } else { ${onFail} }`,
      );
    } else if (ctx.regionMode) {
      // Run every branch with a per-branch mark/truncate (rule 2): a passing
      // branch's coverage merges, a failing branch's truncates. On a non-unit
      // count the unit fails and the caller truncates the whole span.
      const incs = oneRun.map((call) => branchSpan(ctx, call, js`${c}++;`));
      out.push(
        js`let ${c} = 0; ${join(" ", incs)} if (${c} !== 1) return false;`,
      );
    } else {
      const incs = oneRun.map((call) => js`if (${call}) ${c}++;`);
      out.push(
        js`let ${c} = 0; ${join(" ", incs)} if (${c} !== 1) return false;`,
      );
    }
    oneRun = [];
  };
  for (const stmt of stmts) {
    if (stmt.kind === "apply" && stmt.apply.fold === "anyMayPass") {
      flushOne();
      anyRun.push(applyCall(ctx, stmt.apply));
      continue;
    }
    if (stmt.kind === "apply" && stmt.apply.fold === "exactlyOne") {
      flushAny();
      oneRun.push(applyCall(ctx, stmt.apply));
      continue;
    }
    if (stmt.kind === "combineCheck") {
      // Closes the pending run with the keyword's own failure message.
      flushAny(stmt.message, stmt.params);
      flushOne(stmt.message, stmt.params);
      continue;
    }
    flushAny();
    flushOne();
    out.push(statement(ctx, stmt));
  }
  flushAny();
  flushOne();
  return out;
}

/** An `if` statement; an applyExpr condition is hoisted so its channel spans and error mark bracket the call. */
function emitIf(
  ctx: UnitContext,
  stmt: Extract<LowerStmt, { kind: "if" }>,
): CodeChunk {
  // `if`'s condition IS a bare applyExpr (the only such shape besides
  // contains' probe): hoist the call so its span marks/truncates before
  // the branch reads the verdict. Any other applyExpr position throws in
  // annotation mode (expr()), so no silent annotation loss.
  if (
    (ctx.annMode || ctx.regionMode || ctx.output === "list") &&
    stmt.cond.kind === "applyExpr"
  ) {
    // `if`'s condition is in-place: hoist the call so its channel spans
    // mark/truncate on the condition verdict (a passing condition's
    // coverage merges, a failing one's — with the else taken — truncates;
    // rule 4). ann marks `anns`, region marks `ev`, composed both. The
    // condition's errors are always irrelevant (`if` accepts regardless
    // of its subschema), so list mode truncates them unconditionally.
    const spans = channelSpans(ctx);
    const t = id("m" + String(ctx.counters.temp++));
    const em = errMark(ctx);
    const call = applyCall(ctx, stmt.cond.apply);
    const errDecl = em ? js`const ${em} = ${id("errs")}.length; ` : js``;
    const errReset = em ? js` ${id("errs")}.length = ${em};` : js``;
    const resets =
      spans.length > 0 ? js` if (!${t}) { ${spanResets(ctx, spans)} }` : js``;
    const head = js`${spanDecls(ctx, spans)} ${errDecl}const ${t} = ${call};${errReset}${resets}`;
    const thenBody = join(
      "\n",
      stmt.then.map((s) => statement(ctx, s)),
    );
    if (!stmt.else) return js`${head} if (${t}) { ${thenBody} }`;
    const elseBody = join(
      "\n",
      stmt.else.map((s) => statement(ctx, s)),
    );
    return js`${head} if (${t}) { ${thenBody} } else { ${elseBody} }`;
  }
  const thenBody = join(
    "\n",
    stmt.then.map((s) => statement(ctx, s)),
  );
  const cond = js`if (${expr(ctx, stmt.cond)}) { ${thenBody} }`;
  if (!stmt.else) return cond;
  const elseBody = join(
    "\n",
    stmt.else.map((s) => statement(ctx, s)),
  );
  return js`${cond} else { ${elseBody} }`;
}

/** A sweep over an object's own keys (plain for-in under the plain-data contract). */
function emitForEachKey(
  ctx: UnitContext,
  stmt: Extract<LowerStmt, { kind: "forEachKey" }>,
): CodeChunk {
  const b = bindingVar(stmt.binding);
  const body = join(
    "\n",
    stmt.body.map((s) => statement(ctx, s)),
  );
  // Plain for-in: under the plain-data instance contract (DESIGN §7)
  // instances carry no inherited enumerables, so for-in ≡ Object.keys
  // without the per-validation array allocation.
  const t = expr(ctx, stmt.target);
  if (ctx.flags.plainData) {
    return js`for (const ${b} in ${t}) { ${body} }`;
  }
  return js`for (const ${b} of Object.keys(${t})) { ${body} }`;
}

/** A sweep over an array's indexes. */
function emitForEachIndex(
  ctx: UnitContext,
  stmt: Extract<LowerStmt, { kind: "forEachIndex" }>,
): CodeChunk {
  const b = bindingVar(stmt.binding);
  const body = join(
    "\n",
    stmt.body.map((s) => statement(ctx, s)),
  );
  return js`for (let ${b} = ${num(stmt.start ?? 0)}; ${b} < ${expr(ctx, stmt.target)}.length; ${b}++) { ${body} }`;
}

/** A keyword failure: an error unit in list mode, fail-fast in flag mode. */
function emitFail(
  ctx: UnitContext,
  stmt: Extract<LowerStmt, { kind: "fail" }>,
): CodeChunk {
  if (ctx.output === "list") {
    return pushError(
      ctx,
      renderMessage(ctx, stmt.message),
      true,
      paramsChunk(ctx, stmt.params),
    );
  }
  // Flag mode: verdict-only, fail fast.
  return js`return false;`;
}

/** The keyword's own value as an annotation unit (annotation mode only). */
function emitAnnotate(
  ctx: UnitContext,
  _stmt: Extract<LowerStmt, { kind: "annotate" }>,
): CodeChunk {
  // Annotation mode records the keyword's own value as a unit; every
  // other mode elides. The value is a schema constant (draft-03 §12.9).
  if (!ctx.annMode || !ctx.annKwKept) return js``;
  const value = (ctx.unit.ref.node as Record<string, JsonValue>)[
    ctx.currentKeyword
  ]!;
  return js`${id("anns")}.push(${annUnit(ctx, json(value))});`;
}

/** A consumed producer's dependency data onto the coverage channel (region mode only). */
function emitProduce(
  ctx: UnitContext,
  stmt: Extract<LowerStmt, { kind: "produce" }>,
): CodeChunk {
  // Region mode pushes a consumed producer's dependency data onto the
  // channel (rule 5); dependency data is never an annotation unit. In
  // list mode the push waits on the keyword's own verdict (kwOk).
  if (!ctx.covKwKept) return js``;
  const push = produceChannel(ctx, stmt.value);
  return ctx.kwOk ? js`if (${ctx.kwOk}) { ${push} }` : push;
}

/** Bind the channel fold a following coverageCovers reads (region mode only). */
function emitCoverageFold(
  ctx: UnitContext,
  stmt: Extract<LowerStmt, { kind: "coverageFold" }>,
): CodeChunk {
  // Bind the channel fold a following coverageCovers reads (rule 6). Only
  // a tracked unit's consumer emits this, and only in region mode.
  if (!ctx.regionMode) {
    throw new SerializeError("coverageFold requires region emission (phase B)");
  }
  const f = foldVar(ctx.counters.temp++);
  ctx.coverageFolds.set(stmt.binding, { var: f, half: stmt.half });
  if (stmt.half === "names") {
    return js`const ${f} = ${id("h_covN")}(${EV});`;
  }
  // indexes: fold over the current instance array's length (the enclosing
  // lower() guards this with an array-type test).
  return js`const ${f} = ${id("h_covI")}(${EV}, ${ctx.valueVar}.length);`;
}

/** The contains shape: count matching items, then check the range; the probe's spans and the loop's error mark follow the mode. */
function emitCountRange(
  ctx: UnitContext,
  stmt: Extract<LowerStmt, { kind: "countRange" }>,
): CodeChunk {
  const b = bindingVar(stmt.binding);
  const c = counterVar(ctx.counters.tally++);
  const max = Number.isFinite(stmt.max) ? num(stmt.max) : null;
  const outOfRange =
    max === null
      ? js`${c} < ${num(stmt.min)}`
      : js`${c} < ${num(stmt.min)} || ${c} > ${max}`;
  const onFail =
    ctx.output === "list"
      ? pushError(
          ctx,
          renderMessage(ctx, stmt.outOfRangeMessage, c),
          true,
          paramsChunk(ctx, stmt.outOfRangeParams, c),
        )
      : js`return false;`;
  // List mode: an accepting contains drops every probe's errors, a
  // rejecting one keeps them (§12.2) — one mark around the whole loop,
  // never per probe.
  const em = errMark(ctx);
  const errDecl = em ? js`const ${em} = ${id("errs")}.length; ` : js``;
  const check = em
    ? js`if (${outOfRange}) { ${onFail} } else { ${id("errs")}.length = ${em}; }`
    : js`if (${outOfRange}) { ${onFail} }`;
  // contains' probe IS a bare applyExpr (the only shape besides `if`'s
  // condition): mark/truncate each probe so a matching item's
  // annotations merge and a failing item's discard. collectIndexes feeds
  // the matched-index accumulator the following produce renders.
  if (ctx.annMode && stmt.countWhen.kind === "applyExpr") {
    const probe = applyCall(ctx, stmt.countWhen.apply);
    const m = id("m" + String(ctx.counters.temp++));
    const pushIdx =
      ctx.annKw?.matched && stmt.collectIndexes
        ? js` ${ctx.annKw.matched}.push(${b});`
        : js``;
    const loop = js`${errDecl}let ${c} = 0; for (let ${b} = 0; ${b} < ${expr(ctx, stmt.target)}.length; ${b}++) { const ${m} = ${id("anns")}.length; if (${probe}) { ${c}++;${pushIdx} } else ${id("anns")}.length = ${m}; }`;
    return js`${loop} ${check}`;
  }
  if (ctx.regionMode && stmt.countWhen.kind === "applyExpr") {
    // The probe is a CHILD-cursor apply (a plain call that never receives
    // `ev`), so there is no channel span to mark here — `contains`'
    // coverage reaches the channel only through its matched-index produce
    // (rule 5). Accumulate the matched indexes for that produce.
    const probe = applyCall(ctx, stmt.countWhen.apply);
    const pushIdx =
      ctx.annKw?.matched && stmt.collectIndexes
        ? js` ${ctx.annKw.matched}.push(${b});`
        : js``;
    const loop = js`${errDecl}let ${c} = 0; for (let ${b} = 0; ${b} < ${expr(ctx, stmt.target)}.length; ${b}++) { if (${probe}) { ${c}++;${pushIdx} } }`;
    return js`${loop} ${check}`;
  }
  const loop = js`${errDecl}let ${c} = 0; for (let ${b} = 0; ${b} < ${expr(ctx, stmt.target)}.length; ${b}++) { if (${expr(ctx, stmt.countWhen)}) ${c}++; }`;
  return js`${loop} ${check}`;
}

export function statement(ctx: UnitContext, stmt: LowerStmt): CodeChunk {
  switch (stmt.kind) {
    case "if":
      return emitIf(ctx, stmt);
    case "forEachKey":
      return emitForEachKey(ctx, stmt);
    case "forEachIndex":
      return emitForEachIndex(ctx, stmt);
    case "fail":
      return emitFail(ctx, stmt);
    case "annotate":
      return emitAnnotate(ctx, stmt);
    case "produce":
      return emitProduce(ctx, stmt);
    case "coverageFold":
      return emitCoverageFold(ctx, stmt);
    case "apply":
      return applyStatement(ctx, stmt.apply);
    case "combineCheck":
      throw new SerializeError(
        "combineCheck must directly follow its anyMayPass/exactlyOne run",
      );
    case "countRange":
      return emitCountRange(ctx, stmt);
  }
}

/** List-mode conjunct and negation folds (null for the grouped folds). */
function emitListApply(
  ctx: UnitContext,
  apply: LowerApply,
  call: CodeChunk,
  evSpan: boolean,
): CodeChunk | null {
  switch (apply.fold) {
    case "allMustPass": {
      // Record the attempted segment (before the verdict) for the
      // keyword's produce accumulator, then mark the channel spans so a
      // failing application's annotations (annMode) and coverage (region
      // emission) truncate — its errors stay (the keyword rejects), and
      // list mode CONTINUES on failure (ok = false, no return): the
      // unit's remaining keywords, including a consumer sweep that now
      // covers less, still run.
      const rec = annRecordSegment(ctx, apply.cursor);
      const pre = rec ? js`${rec} ` : js``;
      const fail = ctx.kwOk
        ? js`ok = false; ${ctx.kwOk} = false;`
        : js`ok = false;`;
      const spans = channelSpans(ctx, evSpan);
      if (spans.length === 0) return js`${pre}if (!${call}) { ${fail} }`;
      return js`${pre}${spanDecls(ctx, spans)} if (!${call}) { ${fail} ${spanResets(ctx, spans)} }`;
    }
    case "negate": {
      // A failing negated subschema's spans truncate, and so do its
      // errors (`not` accepts, §12.2); a PASSING one's annotations and
      // coverage STAY (the interpreter merges any passing application
      // into the unit frame, and same-unit consumers see it) while the
      // unit records the not-error.
      const spans = channelSpans(ctx, evSpan);
      const em = errMark(ctx)!;
      const err = pushError(
        ctx,
        renderMessage(ctx, apply.message ?? ["must not match the subschema"]),
        true,
        paramsChunk(ctx, apply.params),
      );
      return js`${spanDecls(ctx, spans)} const ${em} = ${id("errs")}.length; if (${call}) { ${err} } else { ${id("errs")}.length = ${em}; ${spanResets(ctx, spans)} }`;
    }
    default:
      return null; // grouped folds handled by keywordStatements; discard by applyExpr
  }
}

/** Region-mode conjunct and negation folds (null for the grouped folds). */
function emitRegionApply(
  ctx: UnitContext,
  apply: LowerApply,
  call: CodeChunk,
  evSpan: boolean,
): CodeChunk | null {
  switch (apply.fold) {
    case "allMustPass": {
      // Record the attempted child segment (before the verdict) for a
      // consumed producer's channel push (rule 5).
      const rec = annRecordSegment(ctx, apply.cursor);
      const pre = rec ? js`${rec} ` : js``;
      if (call.text === "true") return rec ?? js``;
      if (call.text === "false") return js`${pre}return false;`;
      if (evSpan) {
        // In-place conjunct: a failed span truncates and fails the unit;
        // the caller's own span then truncates this whole call (rule 2).
        const m = id("m" + String(ctx.counters.temp++));
        return js`const ${m} = ${EV}.length; if (!${call}) { ${EV}.length = ${m}; return false; }`;
      }
      // Child-cursor conjunct (a swept property/item): no channel span.
      return js`${pre}if (!${call}) return false;`;
    }
    case "negate": {
      if (call.text === "true") return js`return false;`;
      if (call.text === "false") return js``;
      // A passing negated subschema dies with the unit (return false → the
      // caller truncates); a failing one truncates its own span (rule 3).
      const m = id("m" + String(ctx.counters.temp++));
      return js`const ${m} = ${EV}.length; if (${call}) return false; ${EV}.length = ${m};`;
    }
    default:
      return null; // grouped folds handled by keywordStatements; discard by applyExpr
  }
}

export function applyStatement(ctx: UnitContext, apply: LowerApply): CodeChunk {
  if (apply.fold === "allMustPass") {
    const inlined = tryInline(ctx, apply);
    if (inlined) return inlined;
  }
  const call = applyCall(ctx, apply);
  // A call RECEIVES the coverage channel exactly when it is an in-place
  // apply to a non-boolean target (a region variant, or a coverage-
  // harvesting trampoline); a child-cursor apply is a plain call, and a
  // boolean folds to a literal or reports without producing — neither
  // touches the channel, so neither needs an ev mark/truncate span (rule 1).
  const evSpan =
    ctx.regionMode &&
    apply.cursor.kind === "here" &&
    call.text !== "true" &&
    call.text !== "false";
  if (ctx.output === "list") {
    const folded = emitListApply(ctx, apply, call, evSpan);
    if (folded) return folded;
  } else if (ctx.regionMode) {
    const folded = emitRegionApply(ctx, apply, call, evSpan);
    if (folded) return folded;
  }
  if (apply.fold === "allMustPass" && call.text === "true") return js``;
  if (apply.fold === "allMustPass" && call.text === "false")
    return js`return false;`;
  switch (apply.fold) {
    case "allMustPass":
      return js`if (!${call}) return false;`;
    case "negate":
      return js`if (${call}) return false;`;
    case "anyMayPass":
    case "exactlyOne":
      // keywordStatements groups consecutive runs of these before they
      // reach here (a lone run of one is still a "run").
      throw new SerializeError(
        "fold '" + apply.fold + "' must be grouped by keywordStatements",
      );
    case "discard":
      // A bare discard apply statement has no verdict-folding meaning —
      // it's only legal as an applyExpr operand (the if/contains probe
      // shape), never a standalone statement.
      throw new SerializeError("fold 'discard' is only legal inside applyExpr");
  }
}
