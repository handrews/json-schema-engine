// Subschema applications: the unit/trampoline call for a LowerApply, its
// evaluation-path and instance-pointer arguments, and D9c inlining.

import {
  escapeSegment,
  type LowerApply,
  type LowerCursor,
} from "@json-schema-engine/core";
import { type CodeChunk, id, join, js, num, str } from "../emit.js";
import {
  D,
  S,
  T,
  TN,
  unitFn,
  unitFnRegion,
  bindingVar,
  channelArgs,
  fragHelper,
  shapeOf,
} from "./names.js";
import { UnitContext, SerializeError } from "./context.js";
import { guardDecl } from "./guards.js";
import { expr } from "./expressions.js";
import { unitBody } from "./unit.js";

export function applyCall(ctx: UnitContext, apply: LowerApply): CodeChunk {
  // Resolve the target exactly as the planner did.
  let targetKey: string;
  if (apply.ref !== undefined) {
    targetKey = edgeTarget(ctx, apply.ref, null);
  } else {
    targetKey = edgeTarget(ctx, null, apply);
  }
  const valueExpr = cursorValue(ctx, apply.cursor);
  const target = ctx.plan.units.get(targetKey);
  if (!target) {
    throw new SerializeError("apply target '" + targetKey + "' not planned");
  }
  const locate = (): [CodeChunk, CodeChunk] => [
    applyEp(ctx, apply),
    applyIp(ctx, apply),
  ];
  if (target.kind === "static") {
    // Boolean subschemas fold to literals — except in list mode, where a
    // `false` schema must report its "schema is false" error unit, and in
    // trace emission, where every application is a node.
    if (typeof target.ref.node === "boolean") {
      if (ctx.output !== "list") {
        return target.ref.node ? js`true` : js`false`;
      }
      if (target.ref.node && !ctx.trace) return js`true`;
    }
    const scope = ctx.unit.reachesInterpreted ? S : id("h_s0");
    ctx.calledUnit = true;
    // Region emission: an in-place apply threads the channel through the
    // target's region variant (rule 5). Such a target is always a region
    // member — a would-be tracked one was islanded, a boolean folded above
    // or (list-mode `false`) reports without producing, so it keeps the
    // plain variant. Child-cursor applies use the plain variant too (a
    // child location's coverage never joins this unit's channel).
    const inPlaceRegion =
      ctx.regionMode &&
      apply.cursor.kind === "here" &&
      typeof target.ref.node !== "boolean";
    if (inPlaceRegion && !target.inRegion) {
      throw new SerializeError(
        "in-place region target '" + targetKey + "' is not a region member",
      );
    }
    const fn = inPlaceRegion
      ? unitFnRegion(ctx.fnIndex.get(targetKey)!)
      : unitFn(ctx.fnIndex.get(targetKey)!);
    const args = channelArgs(shapeOf(ctx), locate, TN, inPlaceRegion);
    return js`${fn}(${join(", ", [valueExpr, D, scope, ...args])})`;
  }
  const slot = num(ctx.tableIndex.get(targetKey)!);
  ctx.calledUnit = true;
  // Region emission: an in-place island harvests its root coverage into the
  // channel (rule 7) — fragCov in flag mode, the trailing-`ev` overloads of
  // the list trampolines otherwise. A child-cursor island stays plain.
  const inPlaceRegion = ctx.regionMode && apply.cursor.kind === "here";
  const helper = fragHelper(shapeOf(ctx), inPlaceRegion);
  const args = channelArgs(shapeOf(ctx), locate, TN, inPlaceRegion);
  return js`${helper}(${join(", ", [js`${T}[${slot}]`, valueExpr, S, D, ...args])})`;
}

/**
 * The child's evaluation-path prefix: the caller's `ep` plus this apply's
 * constant segment chain — the keyword name (or the driven sibling's, or
 * just the reference keyword for ref applies) plus any static path
 * segments. Bindings never appear in apply paths (only in cursors), so
 * the suffix is always a compile-time constant.
 */
export function applyEp(ctx: UnitContext, apply: LowerApply): CodeChunk {
  const segments =
    apply.sibling !== undefined
      ? [apply.sibling, ...apply.path]
      : [ctx.currentKeyword, ...apply.path];
  const suffix = segments
    .map((seg) => {
      if (typeof seg === "object") {
        throw new SerializeError("binding segments are cursor-only");
      }
      return "/" + escapeSegment(String(seg));
    })
    .join("");
  return js`${id("ep")} + ${str(suffix)}`;
}

/** The child's instance-pointer prefix (RFC 6901-escaped at runtime for swept names). */
export function applyIp(ctx: UnitContext, apply: LowerApply): CodeChunk {
  const cursor = apply.cursor;
  if (cursor.kind === "here") return id("ip");
  if (cursor.kind === "key") {
    // propertyNames: the violation's instance location points at the
    // property itself (interpreter: childCursor(parent, name, name)).
    return js`${id("ip")} + "/" + ${id("h_esc")}(String(${bindingVar(cursor.binding)}))`;
  }
  if (cursor.of.kind !== "here") {
    throw new SerializeError("nested child cursors are not emitted (M6)");
  }
  const seg = cursor.segment;
  if (typeof seg === "string") {
    return js`${id("ip")} + ${str("/" + escapeSegment(seg))}`;
  }
  if (typeof seg === "number") {
    return js`${id("ip")} + ${str("/" + String(seg))}`;
  }
  return js`${id("ip")} + "/" + ${id("h_esc")}(String(${expr(ctx, seg)}))`;
}

// The planner recorded edges in keyword order; match an apply back to its
// edge by keyword + sibling + path/ref identity. `sibling` disambiguates a
// keyword that emits more than one apply at the same path (if's condition
// vs. its then/else edges, all path: []).
export function edgeTarget(
  ctx: UnitContext,
  ref: string | null,
  apply: LowerApply | null,
): string {
  for (const edge of ctx.unit.edges) {
    if (edge.keyword !== ctx.currentKeyword) continue;
    if ((edge.app.sibling ?? null) !== (apply?.sibling ?? null)) continue;
    if (ref !== null) {
      if (edge.app.ref === ref) return edge.targetKey;
      continue;
    }
    const want = apply!.path.map((p) =>
      typeof p === "object" ? "*" : String(p),
    );
    const got = edge.app.path.map(String);
    // Sweep applications bind runtime segments; their planned path is the
    // static prefix (often empty).
    if (want.filter((w) => w !== "*").join("\u0000") === got.join("\u0000"))
      return edge.targetKey;
  }
  throw new SerializeError(
    "no planned edge for keyword '" + ctx.currentKeyword + "'",
  );
}

export function cursorValue(ctx: UnitContext, cursor: LowerCursor): CodeChunk {
  if (cursor.kind === "here") return ctx.valueVar;
  // propertyNames: the loop binding IS the instance (the key string),
  // not a child reached by descending from a parent cursor.
  if (cursor.kind === "key") return bindingVar(cursor.binding);
  const base = cursorValue(ctx, cursor.of);
  const seg = cursor.segment;
  if (typeof seg === "string") return js`${base}[${str(seg)}]`;
  if (typeof seg === "number") return js`${base}[${num(seg)}]`;
  return js`${base}[${expr(ctx, seg)}]`;
}

/**
 * D9c inlining: a single-use, static, non-island, non-boolean target of an
 * allMustPass apply expands into the caller — its lowered `return false`
 * IS the caller's correct failure action, so the body drops in verbatim
 * with the instance rebound to a temp. The inline stack guards
 * self-recursion; recursive chains keep their function calls (the depth
 * budget bounds them). Inlined units skip the per-call depth tick: their
 * nesting is statically bounded, and maxDepth is a resource bound, not an
 * exact-count contract (D20/§7).
 */
export function tryInline(
  ctx: UnitContext,
  apply: LowerApply,
): CodeChunk | null {
  if (!ctx.flags.inline) return null;
  // Region emission never inlines: an in-place target is called through its
  // channel-threaded region variant, not expanded (rule 8). Trace emission
  // never inlines either: an application is a node only as a call.
  if (ctx.regionMode || ctx.trace) return null;
  let targetKey: string;
  if (apply.ref !== undefined) {
    targetKey = edgeTarget(ctx, apply.ref, null);
  } else {
    targetKey = edgeTarget(ctx, null, apply);
  }
  const target = ctx.plan.units.get(targetKey);
  if (
    target?.kind !== "static" ||
    typeof target.ref.node === "boolean" ||
    target.useCount !== 1 ||
    target.reachesInterpreted ||
    // A tracked unit owns a local channel and a region member is entered
    // through its channel-threaded variant; neither can be expanded verbatim
    // into a plain caller (phase B).
    target.tracking ||
    target.inRegion ||
    ctx.inlineStack.has(targetKey) ||
    ctx.inlineStack.size > 32
  ) {
    return null;
  }
  // A `here` cursor applies at the same instance value: reuse the host's
  // variable and its object guard instead of aliasing through a temp.
  const here = apply.cursor.kind === "here";
  const childVar = here ? ctx.valueVar : id("t" + String(ctx.counters.temp++));
  const child = new UnitContext(
    target,
    ctx.plan,
    ctx.registry,
    ctx.fnIndex,
    ctx.tableIndex,
    childVar,
    ctx.counters,
    new Set([...ctx.inlineStack, targetKey]),
    here ? ctx : null,
    ctx.flags,
    ctx.output,
    ctx.listParams,
    ctx.annMode,
    ctx.annKeep,
    false,
    new Set(),
    ctx.trace,
  );
  const body = unitBody(child);
  if (child.calledUnit) ctx.calledUnit = true;
  ctx.inlinedKeys.add(targetKey);
  for (const k of child.inlinedKeys) ctx.inlinedKeys.add(k);
  const parts: CodeChunk[] = [];
  if (!here) {
    parts.push(js`const ${childVar} = ${cursorValue(ctx, apply.cursor)};`);
  }
  const childGuard = guardDecl(child);
  if (childGuard) parts.push(childGuard);
  parts.push(...body);
  return join("\n", parts);
}
