// LowerExpr rendering: instance access, type tests, helper calls, and the
// coverage-fold membership tests of region emission.

import { type LowerExpr } from "@jse/core";
import { type CodeChunk, id, join, js, raw, str, json } from "../emit.js";
import { bindingVar, regexConst, formatConst } from "./names.js";
import { UnitContext, SerializeError } from "./context.js";
import { ensureObjGuard } from "./guards.js";
import { applyCall } from "./apply.js";

export function expr(ctx: UnitContext, e: LowerExpr): CodeChunk {
  switch (e.kind) {
    case "instance":
      return ctx.valueVar;
    case "const":
      return json(e.value);
    case "member":
      return js`${expr(ctx, e.target)}[${str(e.key)}]`;
    case "item":
      return js`${expr(ctx, e.target)}[${expr(ctx, e.index)}]`;
    case "binding":
      return bindingVar(e.id);
    case "typeIs":
      return typeTest(ctx, e.target, e.types);
    case "hasOwn": {
      // Plain-data instance contract (DESIGN §7, M6.5): for JSON data,
      // presence-of-own-key ≡ `!== undefined` — V8 executes the load ~8x
      // faster than Object.hasOwn. Keys that exist on Object.prototype
      // (constructor, toString, …) or are "__proto__" would false-positive
      // through the prototype chain, so those keep an explicit own-check.
      if (typeof e.key === "string") {
        const dangerous = e.key === "__proto__" || e.key in Object.prototype;
        if (ctx.flags.plainData && !dangerous) {
          return js`(${expr(ctx, e.target)}[${str(e.key)}] !== undefined)`;
        }
        return js`${id("h_hop")}.call(${expr(ctx, e.target)}, ${str(e.key)})`;
      }
      return js`${id("h_hop")}.call(${expr(ctx, e.target)}, ${expr(ctx, e.key)})`;
    }
    case "cmp":
      return js`(${expr(ctx, e.left)} ${raw(e.op)} ${expr(ctx, e.right)})`;
    case "helper":
      return helperCall(ctx, e.helper, e.args);
    case "regexTest": {
      let idx = ctx.plan.patterns.indexOf(e.source);
      if (idx === -1) {
        // Coverage patterns can first appear here; the prologue is built
        // after all units serialize, so late additions still hoist.
        idx = ctx.plan.patterns.push(e.source) - 1;
      }
      return js`${regexConst(idx)}.test(${expr(ctx, e.target)})`;
    }
    case "formatTest": {
      let idx = ctx.plan.formats.indexOf(e.name);
      if (idx === -1) {
        // The prologue hoists after all units serialize (as with regexTest),
        // so a name first seen here still gets its lookup const.
        idx = ctx.plan.formats.push(e.name) - 1;
      }
      return js`${formatConst(idx)}.test(${expr(ctx, e.target)})`;
    }
    case "not":
      return js`!(${expr(ctx, e.expr)})`;
    case "logic": {
      const op = e.op === "and" ? " && " : " || ";
      return js`(${join(
        op,
        e.parts.map((p) => expr(ctx, p)),
      )})`;
    }
    case "tally":
    case "tallyList":
      throw new SerializeError(
        "'" + e.kind + "' is only meaningful inside a combineCheck message",
      );
    case "applyExpr":
      // The two legal applyExpr positions (`if`'s condition, contains'
      // probe) are intercepted at the statement level so their span can
      // mark/truncate. Reaching here in annotation mode means an
      // unrecognized shape whose records could not be discarded — fail
      // loud rather than lose annotations silently.
      // Region mode intercepts the two legal applyExpr positions at the
      // statement level (if-condition, contains-probe) so their channel span
      // can mark/truncate; reaching here means an unmarkable position.
      if (ctx.annMode || ctx.regionMode) {
        throw new SerializeError(
          "applyExpr in an unmarkable position for keyword '" +
            ctx.currentKeyword +
            "' (" +
            (ctx.annMode ? "annotation" : "region") +
            " mode)",
        );
      }
      // Same call expression an `apply` statement builds; `fold` on this
      // apply is not consulted here (it governs how a wrapping statement
      // uses the value, not how the call itself is rendered).
      return applyCall(ctx, e.apply);
    case "coverageCovers": {
      // Test the folded channel bound by a preceding coverageFold (rule 6):
      // set membership for names, prefix-or-index membership for indexes.
      if (!ctx.regionMode) {
        throw new SerializeError(
          "coverageCovers requires region emission (phase B)",
        );
      }
      const fold = ctx.coverageFolds.get(e.fold);
      if (!fold) {
        throw new SerializeError(
          "coverageCovers without a preceding coverageFold",
        );
      }
      const target = expr(ctx, e.target);
      if (fold.half === "names") return js`${fold.var}.has(${target})`;
      return js`(${target} < ${fold.var}.coveredPrefix || ${fold.var}.coveredIdx.has(${target}))`;
    }
  }
}

export function typeTest(
  ctx: UnitContext,
  target: LowerExpr,
  types: readonly string[],
): CodeChunk {
  const x = expr(ctx, target);
  const tests = types.map((t) => {
    switch (t) {
      case "object":
        // Inline (no helper call); CSE'd into one guard per unit value —
        // repeated per-property object tests dominated flag-mode profiles.
        if (x.text === ctx.valueVar.text && types.length === 1) {
          return ensureObjGuard(ctx);
        }
        return js`(typeof ${x} === "object" && ${x} !== null && !Array.isArray(${x}))`;
      case "array":
        return js`Array.isArray(${x})`;
      case "null":
        return js`(${x} === null)`;
      case "integer":
        return js`(typeof ${x} === "number" && Number.isInteger(${x}))`;
      case "string":
      case "boolean":
        return js`(typeof ${x} === ${str(t)})`;
      case "number":
        return js`(typeof ${x} === ${str("number")})`;
      default:
        throw new SerializeError("unknown type test '" + t + "'");
    }
  });
  return tests.length === 1 ? tests[0]! : js`(${join(" || ", tests)})`;
}

export function helperCall(
  ctx: UnitContext,
  helper: string,
  args: readonly LowerExpr[],
): CodeChunk {
  if (helper === "jsonEqual") {
    const prim = args.find(
      (a) =>
        a.kind === "const" && (a.value === null || typeof a.value !== "object"),
    );
    const other = args.find((a) => a !== prim);
    if (prim && other) {
      return js`(${expr(ctx, other)} === ${expr(ctx, prim)})`;
    }
  }
  const rendered = args.map((a) => expr(ctx, a));
  const hoisted: Record<string, string> = {
    codePointLength: "h_cpl",
    jsonEqual: "h_eq",
    canonicalKey: "h_ck",
    escapeSegment: "h_esc",
    isMultipleOf: "h_mof",
    hasDuplicateItems: "h_dup",
    firstDuplicatePair: "h_fdp",
  };
  switch (helper) {
    case "keysOf":
      return js`Object.keys(${rendered[0]!})`;
    case "lengthOf":
      return js`${rendered[0]!}.length`;
    case "codePointLength":
    case "jsonEqual":
    case "canonicalKey":
    case "escapeSegment":
    case "isMultipleOf":
    case "hasDuplicateItems":
    case "firstDuplicatePair":
      return js`${id(hoisted[helper]!)}(${join(", ", rendered)})`;
    default:
      throw new SerializeError("helper '" + helper + "' is not supported");
  }
}
