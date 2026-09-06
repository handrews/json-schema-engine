// Emitted identifier names and IR scans shared by the serializer's modules.

import { type LowerProduceValue, type LowerStmt } from "@jse/core";
import { type CodeChunk, id } from "../emit.js";

export const V = id("v"); // instance parameter
export const D = id("d"); // depth parameter
export const S = id("s"); // dynamic-scope parameter
export const R = id("R"); // runtime closure
export const T = id("T"); // interpreted-target table
export const EV = id("ev"); // runtime coverage channel (region emission, phase B)

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
