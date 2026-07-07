// IR serializer (M6.2): planned units + keyword lower() IR → artifact
// source. Flag-mode semantics: fail-fast within a unit (verdict-only),
// productions elided, anyOf short-circuit licensed because the planner
// interprets any node whose channel could be observed (slice licensing;
// DESIGN §7). All text assembly goes through the gated formatter (emit.ts).

import {
  type JsonValue,
  type LowerApply,
  type LowerCursor,
  type LowerExpr,
  type LowerStmt,
  type LoweringContext,
  type SchemaRegistry,
} from "@jse/core";
import { CodeChunk, frag, id, join, js, num, raw, str, json } from "./emit.js";
import type { CompilationPlan, PlannedUnit } from "./plan.js";

const V = id("v"); // instance parameter
const D = id("d"); // depth parameter
const S = id("s"); // dynamic-scope parameter
const R = id("R"); // runtime closure
const T = id("T"); // interpreted-target table

const unitFn = (index: number): CodeChunk => id("u" + String(index));
const bindingVar = (n: number): CodeChunk => id("b" + String(n));
const regexConst = (i: number): CodeChunk => id("r" + String(i));
const counterVar = (n: number): CodeChunk => id("c" + String(n));

class SerializeError extends Error {}

/**
 * Emission mode: "runtime" artifacts close over the Runtime object R
 * (instantiated via new Function); "standalone" artifacts are self-contained
 * ES modules whose preamble (standalone.ts) defines the same h_-named
 * helpers, so the body serialization is identical.
 */
export type EmitMode = "runtime" | "standalone";

/**
 * Optimization switches (M6.5). `conservative` artifacts disable inlining
 * and the plain-data fast paths — the fuzzer runs both configurations so an
 * optimization can never change a verdict unnoticed.
 */
export interface EmitFlags {
  inline: boolean;
  plainData: boolean;
}
const DEFAULT_FLAGS: EmitFlags = { inline: true, plainData: true };

/** Serializes one compilation plan into artifact source (flag mode). */
export function serializePlan(
  plan: CompilationPlan,
  registry: SchemaRegistry,
  mode: EmitMode = "runtime",
  flags: EmitFlags = DEFAULT_FLAGS,
): string {
  // Assign function indexes to static units, table slots to interpreted.
  const fnIndex = new Map<string, number>();
  const tableIndex = new Map<string, number>();
  let nextFn = 0;
  for (const unit of plan.units.values()) {
    if (unit.kind === "static") fnIndex.set(unit.key, nextFn++);
  }
  plan.targets.forEach((u, i) => tableIndex.set(u.key, i));

  const rendered: {
    key: string;
    boolean: boolean;
    chunk: CodeChunk;
    inlined: ReadonlySet<string>;
  }[] = [];
  for (const unit of plan.units.values()) {
    if (unit.kind !== "static") continue;
    rendered.push(
      serializeUnit(unit, plan, registry, fnIndex, tableIndex, flags),
    );
  }
  // Drop dead functions: units expanded into their caller (D9c) and boolean
  // units (their applications folded to literals). The root always stays.
  const inlinedEverywhere = new Set<string>();
  for (const r of rendered) for (const k of r.inlined) inlinedEverywhere.add(k);
  const functions = rendered
    .filter(
      (r) =>
        r.key === plan.rootKey || (!inlinedEverywhere.has(r.key) && !r.boolean),
    )
    .map((r) => r.chunk);

  const root = plan.units.get(plan.rootKey)!;
  const rootCall =
    root.kind === "static"
      ? js`${unitFn(fnIndex.get(root.key)!)}(${V}, 0, ${id("h_s0")})`
      : js`${id("h_frag")}(${T}[${num(tableIndex.get(root.key)!)}], ${V}, ${id("h_s0")}, 0)`;

  // Prologue hoists (D9f): helper bindings, the depth bound, and one const
  // per regex source — property/table lookups move out of the hot path.
  // Standalone mode: the module preamble (standalone.ts) already defines the
  // h_-named helpers; only the regex consts are emitted here, built through
  // the preamble's u-flag-with-fallback constructor.
  const prologue: CodeChunk[] = [];
  if (mode === "runtime") {
    prologue.push(
      js`const { isObject: h_obj, isInteger: h_int, jsonEqual: h_eq, canonicalKey: h_ck, codePointLength: h_cpl, escapeSegment: h_esc, isMultipleOf: h_mof, hasDuplicateItems: h_dup, frag: h_frag, tooDeep: h_deep } = ${R};`,
      js`const h_maxd = ${R}.maxDepth;`,
      // Shared empty dynamic scope: units append-by-copy, never mutate.
      js`const h_s0 = [];`,
      js`const h_hop = Object.prototype.hasOwnProperty;`,
    );
  }
  plan.patterns.forEach((source, i) => {
    prologue.push(
      mode === "runtime"
        ? js`const ${regexConst(i)} = ${R}.re[${str(source)}];`
        : js`const ${regexConst(i)} = ${id("h_rx")}(${str(source)});`,
    );
  });

  const footer =
    mode === "runtime"
      ? js`\nreturn function validate(${V}) { return ${rootCall}; };\n`
      : js`\nexport default function validate(${V}) { return ${rootCall}; };\n`;
  return frag(
    raw(mode === "runtime" ? '"use strict";\n' : ""),
    join("\n", prologue),
    raw("\n"),
    join("\n", functions),
    footer,
  ).text;
}

function serializeUnit(
  unit: PlannedUnit,
  plan: CompilationPlan,
  registry: SchemaRegistry,
  fnIndex: Map<string, number>,
  tableIndex: Map<string, number>,
  flags: EmitFlags,
): {
  key: string;
  boolean: boolean;
  chunk: CodeChunk;
  inlined: ReadonlySet<string>;
} {
  const fn = unitFn(fnIndex.get(unit.key)!);
  const node = unit.ref.node;

  if (typeof node === "boolean") {
    return {
      key: unit.key,
      boolean: true,
      chunk: js`function ${fn}() { return ${raw(String(node))}; }`,
      inlined: new Set(),
    };
  }

  const body: CodeChunk[] = [];
  if (unit.reachesInterpreted) {
    // Dynamic-scope contribution: appended once per application, duplicates
    // harmless (outermost-first resolution). Only threaded where a fragment
    // can consume it.
    body.push(js`${S} = [...${S}, ${str(unit.ref.baseUri)}];`);
  }

  const ctx = new UnitContext(
    unit,
    plan,
    registry,
    fnIndex,
    tableIndex,
    V,
    { binding: 0, tally: 0, temp: 0 },
    new Set([unit.key]),
    null,
    flags,
  );
  const unitStmts = ctx.unitBody();
  // Depth guard (D20 combined budget) only where a chain can grow: a
  // function that calls no unit/fragment cannot recurse, and its own entry
  // was budgeted by every caller on the way down.
  if (ctx.calledUnit) {
    body.unshift(js`if (${D} >= ${id("h_maxd")}) ${id("h_deep")}(); ${D}++;`);
  }
  const guard = ctx.guardDecl();
  if (guard) body.push(guard);
  body.push(...unitStmts);

  body.push(js`return true;`);
  return {
    key: unit.key,
    boolean: false,
    chunk: js`function ${fn}(${V}, ${D}, ${S}) { ${join("\n", body)} }`,
    inlined: ctx.inlinedKeys,
  };
}

/** Per-unit serialization state: bindings, keyword context, apply targets. */
interface Counters {
  binding: number;
  tally: number;
  temp: number;
}

class UnitContext {
  private currentKeyword = "";
  // Object-guard CSE: one `const gN = (typeof x === "object" && …)` per
  // unit value, prepended by the body builder when used. Inlined `here`-
  // cursor children share the parent's guard (same value, same variable).
  private objGuardVar: CodeChunk | null = null;
  objGuardUsed = false;
  /** set when this unit's body (incl. inlines) emits any unit/frag call */
  calledUnit = false;

  constructor(
    private unit: PlannedUnit,
    private plan: CompilationPlan,
    private registry: SchemaRegistry,
    private fnIndex: Map<string, number>,
    private tableIndex: Map<string, number>,
    /** JS variable holding this unit's instance value (V, or an inline temp) */
    private valueVar: CodeChunk,
    /** shared per-function counters so inlined bodies never collide */
    private counters: Counters,
    /** unit keys on the current inline chain (self-inline guard) */
    private inlineStack: ReadonlySet<string>,
    /** parent context sharing the same instance value (here-cursor inline) */
    private guardParent: UnitContext | null = null,
    private flags: EmitFlags = DEFAULT_FLAGS,
  ) {}

  /** The CSE'd object-test variable for this unit's own value. */
  ensureObjGuard(): CodeChunk {
    if (this.guardParent) return this.guardParent.ensureObjGuard();
    this.objGuardVar ??= id("g" + String(this.counters.temp++));
    this.objGuardUsed = true;
    return this.objGuardVar;
  }

  /** Declaration for the guard, when any statement used it. */
  guardDecl(): CodeChunk | null {
    if (this.guardParent || !this.objGuardUsed || !this.objGuardVar)
      return null;
    const x = this.valueVar;
    return js`const ${this.objGuardVar} = (typeof ${x} === "object" && ${x} !== null && !Array.isArray(${x}));`;
  }

  /** Serialize every present keyword of this unit, in dialect order. */
  unitBody(): CodeChunk[] {
    const node = this.unit.ref.node as Record<string, JsonValue>;
    const dialect = this.registry.dialectFor(this.unit.ref.baseUri);
    const out: CodeChunk[] = [];
    for (const entry of dialect.ordered) {
      if (!Object.hasOwn(node, entry.name)) continue;
      const behavior = entry.behavior;
      if (typeof behavior.lower !== "function") {
        throw new SerializeError(
          "planner accepted unlowerable keyword '" + entry.name + "' (bug)",
        );
      }
      const stmts = this.collect(entry.name, (lctx) => {
        behavior.lower!(node[entry.name]!, lctx);
      });
      out.push(...this.keywordStatements(stmts));
    }
    return out;
  }

  /** Run one keyword's lower() against a fresh LoweringContext, return its stmts. */
  collect(keyword: string, run: (lctx: LoweringContext) => void): LowerStmt[] {
    this.currentKeyword = keyword;
    const stmts: LowerStmt[] = [];
    const unit = this.unit;
    const lctx: LoweringContext = {
      instance: { kind: "instance" },
      schema: unit.ref.node as Record<string, JsonValue>,
      staticCoverage: () => unit.coverage,
      emit: (...s) => stmts.push(...s),
      binding: () => this.counters.binding++,
    };
    run(lctx);
    return stmts;
  }

  /**
   * Serialize one keyword's statement list. Runs of anyMayPass applies
   * (the anyOf shape) group into a single OR check; short-circuit emission
   * is licensed here because the planner interpreted every node whose
   * channel a consumer could observe (slice licensing, DESIGN §7). Runs of
   * exactlyOne applies (the oneOf shape) group into a counter block that
   * runs EVERY branch — never stop-at-first-success, since the count past 1
   * must still be exact.
   */
  keywordStatements(stmts: readonly LowerStmt[]): CodeChunk[] {
    const out: CodeChunk[] = [];
    let anyRun: CodeChunk[] = [];
    let oneRun: CodeChunk[] = [];
    const flushAny = () => {
      if (anyRun.length === 0) return;
      out.push(js`if (!(${join(" || ", anyRun)})) return false;`);
      anyRun = [];
    };
    const flushOne = () => {
      if (oneRun.length === 0) return;
      const c = counterVar(this.counters.tally++);
      const incs = oneRun.map((call) => js`if (${call}) ${c}++;`);
      out.push(
        js`let ${c} = 0; ${join(" ", incs)} if (${c} !== 1) return false;`,
      );
      oneRun = [];
    };
    for (const stmt of stmts) {
      if (stmt.kind === "apply" && stmt.apply.fold === "anyMayPass") {
        flushOne();
        anyRun.push(this.applyCall(stmt.apply));
        continue;
      }
      if (stmt.kind === "apply" && stmt.apply.fold === "exactlyOne") {
        flushAny();
        oneRun.push(this.applyCall(stmt.apply));
        continue;
      }
      flushAny();
      flushOne();
      out.push(this.statement(stmt));
    }
    flushAny();
    flushOne();
    return out;
  }

  statement(stmt: LowerStmt): CodeChunk {
    switch (stmt.kind) {
      case "if": {
        const thenBody = join(
          "\n",
          stmt.then.map((s) => this.statement(s)),
        );
        const cond = js`if (${this.expr(stmt.cond)}) { ${thenBody} }`;
        if (!stmt.else) return cond;
        const elseBody = join(
          "\n",
          stmt.else.map((s) => this.statement(s)),
        );
        return js`${cond} else { ${elseBody} }`;
      }
      case "forEachKey": {
        const b = bindingVar(stmt.binding);
        const body = join(
          "\n",
          stmt.body.map((s) => this.statement(s)),
        );
        // Plain for-in: under the plain-data instance contract (DESIGN §7)
        // instances carry no inherited enumerables, so for-in ≡ Object.keys
        // without the per-validation array allocation.
        const t = this.expr(stmt.target);
        if (this.flags.plainData) {
          return js`for (const ${b} in ${t}) { ${body} }`;
        }
        return js`for (const ${b} of Object.keys(${t})) { ${body} }`;
      }
      case "forEachIndex": {
        const b = bindingVar(stmt.binding);
        const body = join(
          "\n",
          stmt.body.map((s) => this.statement(s)),
        );
        return js`for (let ${b} = ${num(stmt.start ?? 0)}; ${b} < ${this.expr(stmt.target)}.length; ${b}++) { ${body} }`;
      }
      case "fail":
        // Flag mode: verdict-only, fail fast. (List-mode artifacts render
        // the message parts; M6.5.)
        return js`return false;`;
      case "produce":
        // Flag mode: productions are elided (nothing observes them —
        // consumer-bearing nodes were interpreted by the planner).
        return js``;
      case "apply":
        return this.applyStatement(stmt.apply);
      case "countRange": {
        const b = bindingVar(stmt.binding);
        const c = counterVar(this.counters.tally++);
        const loop = js`let ${c} = 0; for (let ${b} = 0; ${b} < ${this.expr(stmt.target)}.length; ${b}++) { if (${this.expr(stmt.countWhen)}) ${c}++; }`;
        const max = Number.isFinite(stmt.max) ? num(stmt.max) : null;
        const rangeCheck =
          max === null
            ? js`if (${c} < ${num(stmt.min)}) return false;`
            : js`if (${c} < ${num(stmt.min)} || ${c} > ${max}) return false;`;
        return js`${loop} ${rangeCheck}`;
      }
    }
  }

  private applyStatement(apply: LowerApply): CodeChunk {
    if (apply.fold === "allMustPass") {
      const inlined = this.tryInline(apply);
      if (inlined) return inlined;
    }
    const call = this.applyCall(apply);
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
        throw new SerializeError(
          "fold 'discard' is only legal inside applyExpr",
        );
    }
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
  private tryInline(apply: LowerApply): CodeChunk | null {
    if (!this.flags.inline) return null;
    let targetKey: string;
    if (apply.ref !== undefined) {
      targetKey = this.edgeTarget(apply.ref, null);
    } else {
      targetKey = this.edgeTarget(null, apply);
    }
    const target = this.plan.units.get(targetKey);
    if (
      target?.kind !== "static" ||
      typeof target.ref.node === "boolean" ||
      target.useCount !== 1 ||
      target.reachesInterpreted ||
      this.inlineStack.has(targetKey) ||
      this.inlineStack.size > 32
    ) {
      return null;
    }
    // A `here` cursor applies at the same instance value: reuse the host's
    // variable and its object guard instead of aliasing through a temp.
    const here = apply.cursor.kind === "here";
    const childVar = here
      ? this.valueVar
      : id("t" + String(this.counters.temp++));
    const child = new UnitContext(
      target,
      this.plan,
      this.registry,
      this.fnIndex,
      this.tableIndex,
      childVar,
      this.counters,
      new Set([...this.inlineStack, targetKey]),
      here ? this : null,
      this.flags,
    );
    const body = child.unitBody();
    if (child.calledUnit) this.calledUnit = true;
    this.inlinedKeys.add(targetKey);
    for (const k of child.inlinedKeys) this.inlinedKeys.add(k);
    const parts: CodeChunk[] = [];
    if (!here) {
      parts.push(js`const ${childVar} = ${this.cursorValue(apply.cursor)};`);
    }
    const childGuard = child.guardDecl();
    if (childGuard) parts.push(childGuard);
    parts.push(...body);
    return join("\n", parts);
  }

  /** Unit keys this context (transitively) inlined — their functions are omitted. */
  readonly inlinedKeys = new Set<string>();

  private applyCall(apply: LowerApply): CodeChunk {
    // Resolve the target exactly as the planner did.
    let targetKey: string;
    if (apply.ref !== undefined) {
      targetKey = this.edgeTarget(apply.ref, null);
    } else {
      targetKey = this.edgeTarget(null, apply);
    }
    const valueExpr = this.cursorValue(apply.cursor);
    const target = this.plan.units.get(targetKey);
    if (!target) {
      throw new SerializeError("apply target '" + targetKey + "' not planned");
    }
    if (target.kind === "static") {
      // Boolean subschemas fold to literals — no call, no unit function.
      if (typeof target.ref.node === "boolean") {
        return target.ref.node ? js`true` : js`false`;
      }
      const fn = unitFn(this.fnIndex.get(targetKey)!);
      const scope = this.unit.reachesInterpreted ? S : id("h_s0");
      this.calledUnit = true;
      return js`${fn}(${valueExpr}, ${D}, ${scope})`;
    }
    const slot = num(this.tableIndex.get(targetKey)!);
    this.calledUnit = true;
    return js`${id("h_frag")}(${T}[${slot}], ${valueExpr}, ${S}, ${D})`;
  }

  // The planner recorded edges in keyword order; match an apply back to its
  // edge by keyword + sibling + path/ref identity. `sibling` disambiguates a
  // keyword that emits more than one apply at the same path (if's condition
  // vs. its then/else edges, all path: []).
  private edgeTarget(ref: string | null, apply: LowerApply | null): string {
    for (const edge of this.unit.edges) {
      if (edge.keyword !== this.currentKeyword) continue;
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
      if (want.filter((w) => w !== "*").join(" ") === got.join(" "))
        return edge.targetKey;
    }
    throw new SerializeError(
      "no planned edge for keyword '" + this.currentKeyword + "'",
    );
  }

  private cursorValue(cursor: LowerCursor): CodeChunk {
    if (cursor.kind === "here") return this.valueVar;
    // propertyNames: the loop binding IS the instance (the key string),
    // not a child reached by descending from a parent cursor.
    if (cursor.kind === "key") return bindingVar(cursor.binding);
    const base = this.cursorValue(cursor.of);
    const seg = cursor.segment;
    if (typeof seg === "string") return js`${base}[${str(seg)}]`;
    if (typeof seg === "number") return js`${base}[${num(seg)}]`;
    return js`${base}[${this.expr(seg)}]`;
  }

  expr(e: LowerExpr): CodeChunk {
    switch (e.kind) {
      case "instance":
        return this.valueVar;
      case "const":
        return json(e.value);
      case "member":
        return js`${this.expr(e.target)}[${str(e.key)}]`;
      case "item":
        return js`${this.expr(e.target)}[${this.expr(e.index)}]`;
      case "binding":
        return bindingVar(e.id);
      case "typeIs":
        return this.typeTest(e.target, e.types);
      case "hasOwn": {
        // Plain-data instance contract (DESIGN §7, M6.5): for JSON data,
        // presence-of-own-key ≡ `!== undefined` — V8 executes the load ~8x
        // faster than Object.hasOwn. Keys that exist on Object.prototype
        // (constructor, toString, …) or are "__proto__" would false-positive
        // through the prototype chain, so those keep an explicit own-check.
        if (typeof e.key === "string") {
          const dangerous = e.key === "__proto__" || e.key in Object.prototype;
          if (this.flags.plainData && !dangerous) {
            return js`(${this.expr(e.target)}[${str(e.key)}] !== undefined)`;
          }
          return js`${id("h_hop")}.call(${this.expr(e.target)}, ${str(e.key)})`;
        }
        return js`${id("h_hop")}.call(${this.expr(e.target)}, ${this.expr(e.key)})`;
      }
      case "cmp":
        return js`(${this.expr(e.left)} ${raw(e.op)} ${this.expr(e.right)})`;
      case "helper":
        return this.helperCall(e.helper, e.args);
      case "regexTest": {
        let idx = this.plan.patterns.indexOf(e.source);
        if (idx === -1) {
          // Coverage patterns can first appear here; the prologue is built
          // after all units serialize, so late additions still hoist.
          idx = this.plan.patterns.push(e.source) - 1;
        }
        return js`${regexConst(idx)}.test(${this.expr(e.target)})`;
      }
      case "not":
        return js`!(${this.expr(e.expr)})`;
      case "logic": {
        const op = e.op === "and" ? " && " : " || ";
        return js`(${join(
          op,
          e.parts.map((p) => this.expr(p)),
        )})`;
      }
      case "applyExpr":
        // Same call expression an `apply` statement builds; `fold` on this
        // apply is not consulted here (it governs how a wrapping statement
        // uses the value, not how the call itself is rendered).
        return this.applyCall(e.apply);
    }
  }

  private typeTest(target: LowerExpr, types: readonly string[]): CodeChunk {
    const x = this.expr(target);
    const tests = types.map((t) => {
      switch (t) {
        case "object":
          // Inline (no helper call); CSE'd into one guard per unit value —
          // repeated per-property object tests dominated flag-mode profiles.
          if (x.text === this.valueVar.text && types.length === 1) {
            return this.ensureObjGuard();
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

  private helperCall(helper: string, args: readonly LowerExpr[]): CodeChunk {
    if (helper === "jsonEqual") {
      const prim = args.find(
        (a) =>
          a.kind === "const" &&
          (a.value === null || typeof a.value !== "object"),
      );
      const other = args.find((a) => a !== prim);
      if (prim && other) {
        return js`(${this.expr(other)} === ${this.expr(prim)})`;
      }
    }
    const rendered = args.map((a) => this.expr(a));
    const hoisted: Record<string, string> = {
      codePointLength: "h_cpl",
      jsonEqual: "h_eq",
      canonicalKey: "h_ck",
      escapeSegment: "h_esc",
      isMultipleOf: "h_mof",
      hasDuplicateItems: "h_dup",
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
        return js`${id(hoisted[helper]!)}(${join(", ", rendered)})`;
      default:
        throw new SerializeError("helper '" + helper + "' is not supported");
    }
  }
}
