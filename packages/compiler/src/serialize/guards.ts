// Object-guard CSE: one typeof/null/array test per unit value, shared by an
// inlined here-cursor child with its parent.

import { type CodeChunk, id, js } from "../emit.js";
import { UnitContext } from "./context.js";

/** The CSE'd object-test variable for this unit's own value. */
export function ensureObjGuard(ctx: UnitContext): CodeChunk {
  if (ctx.guardParent) return ensureObjGuard(ctx.guardParent);
  ctx.objGuardVar ??= id("g" + String(ctx.counters.temp++));
  ctx.objGuardUsed = true;
  return ctx.objGuardVar;
}

/** Declaration for the guard, when any statement used it. */
export function guardDecl(ctx: UnitContext): CodeChunk | null {
  if (ctx.guardParent || !ctx.objGuardUsed || !ctx.objGuardVar) return null;
  const x = ctx.valueVar;
  return js`const ${ctx.objGuardVar} = (typeof ${x} === "object" && ${x} !== null && !Array.isArray(${x}));`;
}
