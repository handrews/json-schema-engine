// Emitted identifier names and IR scans shared by the serializer's modules.

import {
  type LowerProduceValue,
  type LowerStmt,
} from "@json-schema-engine/core";
import { type CodeChunk, id } from "../emit.js";
import type { EmitOutput, UnitContext } from "./context.js";

export const V = id("v"); // instance parameter
export const D = id("d"); // depth parameter
export const S = id("s"); // dynamic-scope parameter
export const R = id("R"); // runtime closure
export const T = id("T"); // interpreted-target table
export const EV = id("ev"); // runtime coverage channel (region emission, phase B)
export const EP = id("ep"); // evaluation-path prefix parameter (list emission)
export const IP = id("ip"); // instance-pointer prefix parameter (list emission)
export const ERRS = id("errs"); // error channel (list emission)
export const ANNS = id("anns"); // annotation channel (annotation mode)
export const ST = id("st"); // per-evaluation trace state (trace emission)
export const TP = id("tp"); // parent application node parameter (trace emission)
export const TN = id("tn"); // this application's node (trace emission)

/** Which channels an emission threads through every application. */
export interface ChannelShape {
  output: EmitOutput;
  annMode: boolean;
  trace: boolean;
}

export const shapeOf = (ctx: UnitContext): ChannelShape => ({
  output: ctx.output,
  annMode: ctx.annMode,
  trace: ctx.trace,
});

/**
 * The arguments every application carries after the instance, depth, and
 * scope: in list emission the two location prefixes and the record
 * channels (the trace state and parent node under trace emission), and the
 * coverage channel for an in-place region call. Unit signatures, unit
 * calls, trampolines, and the root call all build from here, so the
 * variants cannot drift apart. `locate` is called only in list emission —
 * a flag-mode apply never computes its prefixes.
 */
export function channelArgs(
  shape: ChannelShape,
  locate: () => [CodeChunk, CodeChunk],
  parent: CodeChunk,
  ev: boolean,
): CodeChunk[] {
  const args: CodeChunk[] = [];
  if (shape.output === "list") {
    args.push(...locate());
    if (shape.trace) args.push(ST, parent);
    else {
      args.push(ERRS);
      if (shape.annMode) args.push(ANNS);
    }
  }
  if (ev) args.push(EV);
  return args;
}

/** The interpreter trampoline an emission calls for an interpreted target. */
export function fragHelper(
  shape: ChannelShape,
  inPlaceRegion: boolean,
): CodeChunk {
  if (shape.output !== "list") return id(inPlaceRegion ? "h_fragc" : "h_frag");
  if (shape.trace) return id("h_fragt");
  return id(shape.annMode ? "h_fragla" : "h_fragl");
}

export const unitFn = (index: number): CodeChunk => id("u" + String(index));
// Region-variant of a unit function: same body with the trailing coverage
// channel threaded (COMPILED-CONSUMERS.md phase B). A distinct name so a unit
// can carry both a plain and a channel-threaded emission.
export const unitFnRegion = (index: number): CodeChunk =>
  id("u" + String(index) + "c");
export const bindingVar = (n: number): CodeChunk => id("b" + String(n));
export const regexConst = (i: number): CodeChunk => id("r" + String(i));
export const formatConst = (i: number): CodeChunk => id("fmt" + String(i));
export const counterVar = (n: number): CodeChunk => id("c" + String(n));
export const foldVar = (n: number): CodeChunk => id("f" + String(n));

/** First `produce` node in a keyword's lowered statement list (searched into blocks). */
export function findProduce(
  stmts: readonly LowerStmt[],
): LowerProduceValue | null {
  for (const stmt of stmts) {
    switch (stmt.kind) {
      case "produce":
        return stmt.value;
      case "if": {
        const t = findProduce(stmt.then);
        if (t) return t;
        if (stmt.else) {
          const e = findProduce(stmt.else);
          if (e) return e;
        }
        break;
      }
      case "forEachKey":
      case "forEachIndex": {
        const b = findProduce(stmt.body);
        if (b) return b;
        break;
      }
      default:
        break;
    }
  }
  return null;
}

/** True when a keyword's lowered statement list contains an `annotate` node (searched into blocks). */
export function hasAnnotate(stmts: readonly LowerStmt[]): boolean {
  for (const stmt of stmts) {
    switch (stmt.kind) {
      case "annotate":
        return true;
      case "if":
        if (hasAnnotate(stmt.then) || (stmt.else && hasAnnotate(stmt.else)))
          return true;
        break;
      case "forEachKey":
      case "forEachIndex":
        if (hasAnnotate(stmt.body)) return true;
        break;
      default:
        break;
    }
  }
  return false;
}
