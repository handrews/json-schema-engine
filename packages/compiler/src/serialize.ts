// IR serializer (M6.2): planned units + keyword lower() IR → artifact
// source. Flag-mode semantics: fail-fast within a unit (verdict-only),
// productions elided, anyOf short-circuit licensed because the planner
// interprets any node whose channel could be observed (slice licensing;
// DESIGN §7). All text assembly goes through the gated formatter (emit.ts).

import {
  type Dialect,
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
const counterVar = (n: number): CodeChunk => id("c" + String(n));

class SerializeError extends Error {}

/** Serializes one compilation plan into artifact source (flag mode). */
export function serializePlan(
  plan: CompilationPlan,
  registry: SchemaRegistry,
): string {
  // Assign function indexes to static units, table slots to interpreted.
  const fnIndex = new Map<string, number>();
  const tableIndex = new Map<string, number>();
  let nextFn = 0;
  for (const unit of plan.units.values()) {
    if (unit.kind === "static") fnIndex.set(unit.key, nextFn++);
  }
  plan.targets.forEach((u, i) => tableIndex.set(u.key, i));

  const functions: CodeChunk[] = [];
  for (const unit of plan.units.values()) {
    if (unit.kind !== "static") continue;
    functions.push(serializeUnit(unit, plan, registry, fnIndex, tableIndex));
  }

  const root = plan.units.get(plan.rootKey)!;
  const rootCall =
    root.kind === "static"
      ? js`${unitFn(fnIndex.get(root.key)!)}(${V}, 0, [])`
      : js`${R}.frag(${T}[${num(tableIndex.get(root.key)!)}], ${V}, [], 0)`;

  return frag(
    raw('"use strict";\n'),
    join("\n", functions),
    js`\nreturn function validate(${V}) { return ${rootCall}; };\n`,
  ).text;
}

function serializeUnit(
  unit: PlannedUnit,
  plan: CompilationPlan,
  registry: SchemaRegistry,
  fnIndex: Map<string, number>,
  tableIndex: Map<string, number>,
): CodeChunk {
  const fn = unitFn(fnIndex.get(unit.key)!);
  const node = unit.ref.node;

  if (typeof node === "boolean") {
    return js`function ${fn}() { return ${raw(String(node))}; }`;
  }

  const dialect: Dialect = registry.dialectFor(unit.ref.baseUri);
  const body: CodeChunk[] = [];
  // Depth guard mirrors applySchema's (D20): combined budget with fragments.
  body.push(js`if (${D} >= ${R}.maxDepth) ${R}.tooDeep(); ${D}++;`);
  if (unit.reachesInterpreted) {
    // Dynamic-scope contribution: appended once per application, duplicates
    // harmless (outermost-first resolution). Only threaded where a fragment
    // can consume it.
    body.push(js`${S} = [...${S}, ${str(unit.ref.baseUri)}];`);
  }

  const ctx = new UnitContext(unit, plan, registry, fnIndex, tableIndex);
  for (const entry of dialect.ordered) {
    const schema = node as Record<string, JsonValue>;
    if (!Object.hasOwn(schema, entry.name)) continue;
    const behavior = entry.behavior;
    if (typeof behavior.lower !== "function") {
      throw new SerializeError(
        "planner accepted unlowerable keyword '" + entry.name + "' (bug)",
      );
    }
    const stmts = ctx.collect(entry.name, (lctx) => {
      behavior.lower!(schema[entry.name]!, lctx);
    });
    body.push(...ctx.keywordStatements(stmts));
  }

  body.push(js`return true;`);
  return js`function ${fn}(${V}, ${D}, ${S}) { ${join("\n", body)} }`;
}

/** Per-unit serialization state: bindings, keyword context, apply targets. */
class UnitContext {
  private bindingCounter = 0;
  private counterCounter = 0;
  private currentKeyword = "";

  constructor(
    private unit: PlannedUnit,
    private plan: CompilationPlan,
    private registry: SchemaRegistry,
    private fnIndex: Map<string, number>,
    private tableIndex: Map<string, number>,
  ) {}

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
      binding: () => this.bindingCounter++,
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
      const c = counterVar(this.counterCounter++);
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
        return js`for (const ${b} of Object.keys(${this.expr(stmt.target)})) { ${body} }`;
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
        const c = counterVar(this.counterCounter++);
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
    const call = this.applyCall(apply);
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
      const fn = unitFn(this.fnIndex.get(targetKey)!);
      const scope = this.unit.reachesInterpreted ? S : js`[]`;
      return js`${fn}(${valueExpr}, ${D}, ${scope})`;
    }
    const slot = num(this.tableIndex.get(targetKey)!);
    return js`${R}.frag(${T}[${slot}], ${valueExpr}, ${S}, ${D})`;
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
    if (cursor.kind === "here") return V;
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
        return V;
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
        const key = typeof e.key === "string" ? str(e.key) : this.expr(e.key);
        return js`Object.hasOwn(${this.expr(e.target)}, ${key})`;
      }
      case "cmp":
        return js`(${this.expr(e.left)} ${raw(e.op)} ${this.expr(e.right)})`;
      case "helper":
        return this.helperCall(e.helper, e.args);
      case "regexTest":
        if (!this.plan.patterns.includes(e.source)) {
          this.plan.patterns.push(e.source); // coverage patterns arrive here
        }
        return js`${R}.re[${str(e.source)}].test(${this.expr(e.target)})`;
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
          return js`${R}.isObject(${x})`;
        case "array":
          return js`Array.isArray(${x})`;
        case "null":
          return js`(${x} === null)`;
        case "integer":
          return js`${R}.isInteger(${x})`;
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
    const rendered = args.map((a) => this.expr(a));
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
        return js`${R}.${id(helper)}(${join(", ", rendered)})`;
      default:
        throw new SerializeError("helper '" + helper + "' is not supported");
    }
  }
}
