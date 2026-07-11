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
  type LowerMessage,
  type LowerParams,
  type LowerProduceValue,
  type LowerStmt,
  type LoweringContext,
  type RecordPredicate,
  type RetentionPolicy,
  type SchemaRegistry,
  makeRecordPredicate,
} from "@jse/core";
import { CodeChunk, frag, id, join, js, num, raw, str, json } from "./emit.js";
import { escapeSegment } from "@jse/core";
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
 * Annotation-mode options threaded through serialization. Its presence (with
 * `output === "list"`) turns on annotation collection; `retention`'s
 * allow/deny lists are applied statically at produce sites (the compiled
 * analogue of produce-time elision — the same {@link makeRecordPredicate}
 * decision the interpreter's renderer makes). The `keep` predicate runs at
 * runtime in the artifact wrapper, never here.
 */
export interface AnnotateOptions {
  retention?: RetentionPolicy;
}

/** First `produce` node in a keyword's lowered statement list (searched into blocks). */
function findProduce(stmts: readonly LowerStmt[]): LowerProduceValue | null {
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

/**
 * Output tier of the artifact (D10/M7-adjacent): "flag" = verdict-only,
 * fail-fast, zero allocation on the hot path; "list" = full error
 * collection with interpreter-exact units — no fail-fast, no
 * short-circuit, every branch runs (DESIGN §7 licensing), and error-unit
 * objects materialize only on failure paths (D9e).
 */
export type EmitOutput = "flag" | "list";
const DEFAULT_FLAGS: EmitFlags = { inline: true, plainData: true };

/** Serializes one compilation plan into artifact source (flag mode). */
export function serializePlan(
  plan: CompilationPlan,
  registry: SchemaRegistry,
  mode: EmitMode = "runtime",
  flags: EmitFlags = DEFAULT_FLAGS,
  output: EmitOutput = "flag",
  listParams = false,
  annotate?: AnnotateOptions,
): string {
  if (output === "list" && mode === "standalone") {
    throw new SerializeError("standalone emission is flag-only (M6.5 scope)");
  }
  // Annotation collection is a list-mode variant: it reuses the list plan and
  // fail-open, no-short-circuit discipline, adding a flat `anns` channel with
  // mark/truncate at every application boundary (channel rule 3).
  const annMode = annotate !== undefined && output === "list";
  // Static retention: the produce/unknown-keyword allow/deny decision, applied
  // at emit time so ruled-out productions never emit. `keep` is deferred.
  const annKeep: RecordPredicate | null = annMode
    ? makeRecordPredicate(new Set(), true, annotate.retention)
    : null;
  // List mode disables inlining and boolean-literal folding: shared units
  // carry the evaluation-path/instance-pointer parameters, and a `false`
  // subschema must report "schema is false" rather than fold away.
  const effFlags: EmitFlags =
    output === "list" ? { ...flags, inline: false } : flags;
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
      serializeUnit(
        unit,
        plan,
        registry,
        fnIndex,
        tableIndex,
        effFlags,
        output,
        listParams,
        annMode,
        annKeep,
      ),
    );
  }
  // Drop dead functions: units expanded into their caller (D9c) and boolean
  // units (their applications folded to literals). The root always stays.
  const inlinedEverywhere = new Set<string>();
  for (const r of rendered) for (const k of r.inlined) inlinedEverywhere.add(k);
  // List mode calls boolean-false units (they report "schema is false"),
  // so their functions survive the dead-function filter there.
  const functions = rendered
    .filter(
      (r) =>
        r.key === plan.rootKey ||
        (!inlinedEverywhere.has(r.key) && (!r.boolean || output === "list")),
    )
    .map((r) => r.chunk);

  const root = plan.units.get(plan.rootKey)!;
  const ERRS = id("errs");
  const ANNS = id("anns");
  const rootStatic = root.kind === "static";
  const rootFn = rootStatic ? unitFn(fnIndex.get(root.key)!) : null;
  const rootSlot = rootStatic ? null : num(tableIndex.get(root.key)!);
  const rootCall = annMode
    ? rootStatic
      ? js`${rootFn!}(${V}, 0, ${id("h_s0")}, "", "", ${ERRS}, ${ANNS})`
      : js`${id("h_fragla")}(${T}[${rootSlot!}], ${V}, ${id("h_s0")}, 0, "", "", ${ERRS}, ${ANNS})`
    : output === "list"
      ? rootStatic
        ? js`${rootFn!}(${V}, 0, ${id("h_s0")}, "", "", ${ERRS})`
        : js`${id("h_fragl")}(${T}[${rootSlot!}], ${V}, ${id("h_s0")}, 0, "", "", ${ERRS})`
      : rootStatic
        ? js`${rootFn!}(${V}, 0, ${id("h_s0")})`
        : js`${id("h_frag")}(${T}[${rootSlot!}], ${V}, ${id("h_s0")}, 0)`;

  // Prologue hoists (D9f): helper bindings, the depth bound, and one const
  // per regex source — property/table lookups move out of the hot path.
  // Standalone mode: the module preamble (standalone.ts) already defines the
  // h_-named helpers; only the regex consts are emitted here, built through
  // the preamble's u-flag-with-fallback constructor.
  const prologue: CodeChunk[] = [];
  if (mode === "runtime") {
    prologue.push(
      js`const { isObject: h_obj, isInteger: h_int, jsonEqual: h_eq, canonicalKey: h_ck, codePointLength: h_cpl, escapeSegment: h_esc, isMultipleOf: h_mof, hasDuplicateItems: h_dup, firstDuplicatePair: h_fdp, frag: h_frag, fragList: h_fragl, tooDeep: h_deep } = ${R};`,
      js`const h_maxd = ${R}.maxDepth;`,
      // Shared empty dynamic scope: units append-by-copy, never mutate.
      js`const h_s0 = [];`,
      js`const h_hop = Object.prototype.hasOwnProperty;`,
    );
    if (annMode) prologue.push(js`const h_fragla = ${R}.fragListAnn;`);
  }
  plan.patterns.forEach((source, i) => {
    prologue.push(
      mode === "runtime"
        ? js`const ${regexConst(i)} = ${R}.re[${str(source)}];`
        : js`const ${regexConst(i)} = ${id("h_rx")}(${str(source)});`,
    );
  });

  const footer = annMode
    ? js`\nreturn function evaluateList(${V}) { const ${ERRS} = []; const ${ANNS} = []; const ok = ${rootCall}; return { valid: ok, errors: ${ERRS}, annotations: ${ANNS} }; };\n`
    : output === "list"
      ? js`\nreturn function evaluateList(${V}) { const ${ERRS} = []; const ok = ${rootCall}; return { valid: ok, errors: ${ERRS} }; };\n`
      : mode === "runtime"
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
  output: EmitOutput,
  listParams: boolean,
  annMode: boolean,
  annKeep: RecordPredicate | null,
): {
  key: string;
  boolean: boolean;
  chunk: CodeChunk;
  inlined: ReadonlySet<string>;
} {
  const fn = unitFn(fnIndex.get(unit.key)!);
  const node = unit.ref.node;
  // Annotation mode extends the list signature with a trailing `anns` channel.
  const listSig = annMode
    ? js`(${V}, ${D}, ${S}, ${id("ep")}, ${id("ip")}, ${id("errs")}, ${id("anns")})`
    : js`(${V}, ${D}, ${S}, ${id("ep")}, ${id("ip")}, ${id("errs")})`;

  if (typeof node === "boolean") {
    // List mode: `false` reports the interpreter's boolean-schema error
    // (keywordName null — no keyword suffix on either location).
    // Structured-params mode: keywordName is null here, so the unit gets
    // empty params and no keyword field (renderError's includeParams shape).
    // A `false` schema never produces an annotation; the `anns` parameter is
    // carried only to match the call signature.
    const falseParams = listParams ? js`, params: {}` : js``;
    const chunk =
      output === "list" && !node
        ? js`function ${fn}${listSig} { ${id("errs")}.push({ evaluationPath: ${id("ep")}, schemaLocation: ${str(unit.ref.baseUri + "#" + unit.ref.pointer)}, instanceLocation: ${id("ip")}, error: "schema is false"${falseParams} }); return false; }`
        : js`function ${fn}() { return ${raw(String(node))}; }`;
    return { key: unit.key, boolean: true, chunk, inlined: new Set() };
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
    output,
    listParams,
    annMode,
    annKeep,
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
  if (output === "list") body.push(js`let ok = true;`);
  body.push(...unitStmts);

  if (output === "list") {
    body.push(js`return ok;`);
    return {
      key: unit.key,
      boolean: false,
      chunk: js`function ${fn}${listSig} { ${join("\n", body)} }`,
      inlined: ctx.inlinedKeys,
    };
  }
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

/**
 * The accumulator(s) a keyword's collected-value produce reads: names build a
 * deduped `Set`, indexes a max tracker / applied flag / matched list. Set by
 * {@link UnitContext.beginKeyword} for a retained collected-value producer, and
 * driven by the application call sites within the keyword's own statements.
 */
interface KeywordAnn {
  produceKind:
    "collectedNames" | "largestOrTrue" | "appliedTrue" | "matchedOrAllTrue";
  names?: CodeChunk;
  max?: CodeChunk;
  applied?: CodeChunk;
  matched?: CodeChunk;
}

class UnitContext {
  private currentKeyword = "";
  private currentVocab: string | null = null;
  // Annotation state for the keyword currently being emitted: whether its
  // produce is retained (static lists), and the collected-value accumulators.
  private annKwKept = false;
  private annKw: KeywordAnn | null = null;
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
    private output: EmitOutput = "flag",
    private listParams = false,
    private annMode = false,
    private annKeep: RecordPredicate | null = null,
  ) {}

  /**
   * Renders a LowerMessage to a string expression. `tallyVar` binds the
   * message's tally placeholder (combine/count checks).
   */
  private message(msg: LowerMessage, tallyVar?: CodeChunk): CodeChunk {
    const parts = msg.map((part) => {
      if (typeof part === "string") return str(part);
      if (part.kind === "tally") {
        if (!tallyVar)
          throw new SerializeError("tally outside a counted check");
        return js`String(${tallyVar})`;
      }
      return js`String(${this.expr(part)})`;
    });
    if (parts.length === 0) return str("");
    return parts.length === 1 ? parts[0]! : js`(${join(" + ", parts)})`;
  }

  /**
   * Renders a LowerParams map to an object-literal expression, mirroring
   * renderError's includeParams shape. `tallyVar` binds tally placeholders
   * exactly as in {@link message}.
   */
  private paramsChunk(
    params: LowerParams | undefined,
    tallyVar?: CodeChunk,
    tallyListVar?: CodeChunk,
  ): CodeChunk {
    // pushError drops the chunk entirely when params are off — don't render
    // (a tallyList reference has no accumulator to bind to in that mode).
    if (!this.listParams || params === undefined) return js`{}`;
    const entries = Object.entries(params).map(([key, part]) => {
      let value: CodeChunk;
      if (part.kind === "tally" || part.kind === "tallyList") {
        const bound = part.kind === "tally" ? tallyVar : tallyListVar;
        if (!bound)
          throw new SerializeError(part.kind + " outside a counted check");
        value = bound;
      } else {
        value = this.expr(part);
      }
      return js`${str(key)}: ${value}`;
    });
    return js`{ ${join(", ", entries)} }`;
  }

  /**
   * List-mode failure: mark the unit invalid and push an interpreter-exact
   * error unit (renderError's shape — keyword suffix escaped on both
   * paths). Unit objects materialize only here, on the failure path (D9e).
   */
  private pushError(
    msg: CodeChunk,
    withKeyword = true,
    params?: CodeChunk,
  ): CodeChunk {
    const suffix = withKeyword ? "/" + escapeSegment(this.currentKeyword) : "";
    const sloc = this.unit.ref.baseUri + "#" + this.unit.ref.pointer + suffix;
    const extra = this.listParams
      ? withKeyword
        ? js`, keyword: ${str(this.currentKeyword)}, params: ${params ?? js`{}`}`
        : js`, params: ${params ?? js`{}`}`
      : js``;
    return js`ok = false; ${id("errs")}.push({ evaluationPath: ${id("ep")} + ${str(suffix)}, schemaLocation: ${str(sloc)}, instanceLocation: ${id("ip")}, error: ${msg}${extra} });`;
  }

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
    // Mirrors buildPlan's refOnly (plan.ts, citing engine.ts:397): the plan
    // only resolved edges for $ref when this is true, so siblings must be
    // skipped here too, or this would try to serialize applies the plan
    // never planned.
    const refOnly = dialect.refIgnoresSiblings && Object.hasOwn(node, "$ref");
    const out: CodeChunk[] = [];
    for (const entry of dialect.ordered) {
      if (refOnly && entry.name !== "$ref") continue;
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
      this.currentVocab = entry.vocabularyUri;
      // Accumulator declarations hoist above the keyword's statements: the
      // application call sites feed them, the produce reads them.
      const decls = this.beginKeyword(stmts);
      const chunks = this.keywordStatements(stmts);
      out.push(...decls, ...chunks);
    }
    // Unknown keywords collect as annotations (engine.ts:414): unconditional
    // constant productions, in schema-key order, after every dialect keyword.
    // The refOnly break silences siblings, matching the interpreter.
    if (this.annMode && !refOnly) {
      for (const name of Object.keys(node)) {
        if (dialect.keywords.has(name)) continue;
        if (this.annKeep && !this.annKeep("", name, null)) continue;
        const suffix = "/" + escapeSegment(name);
        const sloc =
          this.unit.ref.baseUri + "#" + this.unit.ref.pointer + suffix;
        out.push(
          js`${id("anns")}.push({ keyword: ${str(name)}, evaluationPath: ${id("ep")} + ${str(suffix)}, schemaLocation: ${str(sloc)}, instanceLocation: ${id("ip")}, annotation: ${json(node[name]!)} });`,
        );
      }
    }
    return out;
  }

  /**
   * Prepare the keyword currently being emitted for annotation mode: decide
   * whether its produce survives the static retention lists, and allocate any
   * collected-value accumulator (declared by the returned chunks). No-op
   * outside annotation mode or for keywords that never produce.
   */
  private beginKeyword(stmts: readonly LowerStmt[]): CodeChunk[] {
    this.annKw = null;
    this.annKwKept = false;
    if (!this.annMode) return [];
    const value = findProduce(stmts);
    if (!value) return [];
    this.annKwKept =
      !this.annKeep || this.annKeep("", this.currentKeyword, this.currentVocab);
    if (!this.annKwKept) return [];
    if (value.kind === "collectedNames") {
      const n = id("n" + String(this.counters.temp++));
      this.annKw = { produceKind: "collectedNames", names: n };
      return [js`const ${n} = new Set();`];
    }
    if (value.kind === "collectedIndexes") {
      if (value.render === "largestOrTrue") {
        const m = id("n" + String(this.counters.temp++));
        this.annKw = { produceKind: "largestOrTrue", max: m };
        return [js`let ${m} = -1;`];
      }
      if (value.render === "appliedTrue") {
        const a = id("n" + String(this.counters.temp++));
        this.annKw = { produceKind: "appliedTrue", applied: a };
        return [js`let ${a} = false;`];
      }
      const t = id("n" + String(this.counters.temp++));
      this.annKw = { produceKind: "matchedOrAllTrue", matched: t };
      return [js`const ${t} = [];`];
    }
    // const / expr: retained, but the produce reads its value directly.
    return [];
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
    const flushAny = (message?: LowerMessage, params?: LowerParams) => {
      if (anyRun.length === 0) return;
      if (this.annMode) {
        // Every branch runs; a failed branch's productions truncate, a passing
        // branch's merge (channel rule 3 per anyOf branch).
        const a = counterVar(this.counters.tally++);
        const runs = anyRun.map((call) => {
          const m = id("m" + String(this.counters.temp++));
          return js`{ const ${m} = ${id("anns")}.length; if (${call}) ${a} = true; else ${id("anns")}.length = ${m}; }`;
        });
        const onFail = this.pushError(
          this.message(message ?? ["no branch matched"]),
          true,
          this.paramsChunk(params),
        );
        out.push(
          js`let ${a} = false; ${join(" ", runs)} if (!${a}) { ${onFail} }`,
        );
      } else if (this.output === "list") {
        // Every branch runs (§7: list artifacts never short-circuit).
        const a = counterVar(this.counters.tally++);
        const runs = anyRun.map((call) => js`if (${call}) ${a} = true;`);
        const onFail = this.pushError(
          this.message(message ?? ["no branch matched"]),
          true,
          this.paramsChunk(params),
        );
        out.push(
          js`let ${a} = false; ${join(" ", runs)} if (!${a}) { ${onFail} }`,
        );
      } else {
        out.push(js`if (!(${join(" || ", anyRun)})) return false;`);
      }
      anyRun = [];
    };
    const flushOne = (message?: LowerMessage, params?: LowerParams) => {
      if (oneRun.length === 0) return;
      const c = counterVar(this.counters.tally++);
      if (this.annMode) {
        // Both-pass discards at the caller (the unit fails, its span
        // truncates); each branch marks/truncates its own span here.
        const wantsList =
          this.listParams &&
          params !== undefined &&
          Object.values(params).some((p) => p.kind === "tallyList");
        const p = wantsList ? counterVar(this.counters.tally++) : undefined;
        const incs = oneRun.map((call, k) => {
          const m = id("m" + String(this.counters.temp++));
          const hit = p ? js`${c}++; ${p}.push(${num(k)});` : js`${c}++;`;
          return js`{ const ${m} = ${id("anns")}.length; if (${call}) { ${hit} } else ${id("anns")}.length = ${m}; }`;
        });
        const decl = p ? js`let ${c} = 0; const ${p} = [];` : js`let ${c} = 0;`;
        const onFail = this.pushError(
          this.message(message ?? [{ kind: "tally" }, " branches matched"], c),
          true,
          this.paramsChunk(params, c, p),
        );
        out.push(js`${decl} ${join(" ", incs)} if (${c} !== 1) { ${onFail} }`);
      } else if (this.output === "list") {
        // Params referencing the passing-branch indexes (tallyList) need an
        // index accumulator next to the count; branch order IS run order.
        const wantsList =
          this.listParams &&
          params !== undefined &&
          Object.values(params).some((p) => p.kind === "tallyList");
        const p = wantsList ? counterVar(this.counters.tally++) : undefined;
        const incs = oneRun.map((call, k) =>
          p
            ? js`if (${call}) { ${c}++; ${p}.push(${num(k)}); }`
            : js`if (${call}) ${c}++;`,
        );
        const decl = p ? js`let ${c} = 0; const ${p} = [];` : js`let ${c} = 0;`;
        const onFail = this.pushError(
          this.message(message ?? [{ kind: "tally" }, " branches matched"], c),
          true,
          this.paramsChunk(params, c, p),
        );
        out.push(js`${decl} ${join(" ", incs)} if (${c} !== 1) { ${onFail} }`);
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
        anyRun.push(this.applyCall(stmt.apply));
        continue;
      }
      if (stmt.kind === "apply" && stmt.apply.fold === "exactlyOne") {
        flushAny();
        oneRun.push(this.applyCall(stmt.apply));
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
      out.push(this.statement(stmt));
    }
    flushAny();
    flushOne();
    return out;
  }

  statement(stmt: LowerStmt): CodeChunk {
    switch (stmt.kind) {
      case "if": {
        // `if`'s condition IS a bare applyExpr (the only such shape besides
        // contains' probe): hoist the call so its span marks/truncates before
        // the branch reads the verdict. Any other applyExpr position throws in
        // annotation mode (expr()), so no silent annotation loss.
        if (this.annMode && stmt.cond.kind === "applyExpr") {
          const m = id("m" + String(this.counters.temp++));
          const t = id("m" + String(this.counters.temp++));
          const call = this.applyCall(stmt.cond.apply);
          const head = js`const ${m} = ${id("anns")}.length; const ${t} = ${call}; if (!${t}) ${id("anns")}.length = ${m};`;
          const thenBody = join(
            "\n",
            stmt.then.map((s) => this.statement(s)),
          );
          if (!stmt.else) return js`${head} if (${t}) { ${thenBody} }`;
          const elseBody = join(
            "\n",
            stmt.else.map((s) => this.statement(s)),
          );
          return js`${head} if (${t}) { ${thenBody} } else { ${elseBody} }`;
        }
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
        if (this.output === "list") {
          return this.pushError(
            this.message(stmt.message),
            true,
            this.paramsChunk(stmt.params),
          );
        }
        // Flag mode: verdict-only, fail fast.
        return js`return false;`;
      case "produce":
        // Only annotation mode observes productions; flag/list-without-
        // annotations elide them (consumer-bearing nodes were interpreted by
        // the planner). Retention lists rule some out at emit (annKwKept).
        if (this.annMode && this.annKwKept)
          return this.produceStatement(stmt.value);
        return js``;
      case "apply":
        return this.applyStatement(stmt.apply);
      case "combineCheck":
        throw new SerializeError(
          "combineCheck must directly follow its anyMayPass/exactlyOne run",
        );
      case "countRange": {
        const b = bindingVar(stmt.binding);
        const c = counterVar(this.counters.tally++);
        const max = Number.isFinite(stmt.max) ? num(stmt.max) : null;
        const outOfRange =
          max === null
            ? js`${c} < ${num(stmt.min)}`
            : js`${c} < ${num(stmt.min)} || ${c} > ${max}`;
        const onFail =
          this.output === "list"
            ? this.pushError(
                this.message(stmt.outOfRangeMessage, c),
                true,
                this.paramsChunk(stmt.outOfRangeParams, c),
              )
            : js`return false;`;
        // contains' probe IS a bare applyExpr (the only shape besides `if`'s
        // condition): mark/truncate each probe so a matching item's
        // productions merge and a failing item's discard. collectIndexes feeds
        // the matched-index accumulator the following produce renders.
        if (this.annMode && stmt.countWhen.kind === "applyExpr") {
          const probe = this.applyCall(stmt.countWhen.apply);
          const m = id("m" + String(this.counters.temp++));
          const pushIdx =
            this.annKw?.matched && stmt.collectIndexes
              ? js` ${this.annKw.matched}.push(${b});`
              : js``;
          const loop = js`let ${c} = 0; for (let ${b} = 0; ${b} < ${this.expr(stmt.target)}.length; ${b}++) { const ${m} = ${id("anns")}.length; if (${probe}) { ${c}++;${pushIdx} } else ${id("anns")}.length = ${m}; }`;
          return js`${loop} if (${outOfRange}) { ${onFail} }`;
        }
        const loop = js`let ${c} = 0; for (let ${b} = 0; ${b} < ${this.expr(stmt.target)}.length; ${b}++) { if (${this.expr(stmt.countWhen)}) ${c}++; }`;
        return js`${loop} if (${outOfRange}) { ${onFail} }`;
      }
    }
  }

  /** Emit the annotation-unit push for a retained keyword's produce. */
  private produceStatement(value: LowerProduceValue): CodeChunk {
    switch (value.kind) {
      case "const":
        return js`${id("anns")}.push(${this.annUnit(json(value.value))});`;
      case "expr":
        return js`${id("anns")}.push(${this.annUnit(this.expr(value.expr))});`;
      case "collectedNames":
        // lower() already gated this produce behind the object-type check; the
        // Set spreads to an array in insertion (attempted) order.
        return js`${id("anns")}.push(${this.annUnit(js`[...${this.annKw!.names!}]`)});`;
      case "collectedIndexes": {
        const v = this.valueVar;
        if (value.render === "largestOrTrue") {
          const mx = this.annKw!.max!;
          return js`if (${mx} >= 0) ${id("anns")}.push(${this.annUnit(js`${mx} + 1 === ${v}.length ? true : ${mx}`)});`;
        }
        if (value.render === "appliedTrue") {
          const ap = this.annKw!.applied!;
          return js`if (${ap}) ${id("anns")}.push(${this.annUnit(js`true`)});`;
        }
        const mt = this.annKw!.matched!;
        return js`if (${mt}.length > 0) ${id("anns")}.push(${this.annUnit(js`${mt}.length === ${v}.length ? true : ${mt}`)});`;
      }
    }
  }

  /**
   * The annotation-unit object literal for the current keyword: constant
   * keyword/vocabulary/schemaLocation, runtime evaluationPath (`ep` suffix)
   * and instanceLocation (`ip`), key order matching core's renderAnnotation.
   * `vocabulary` is omitted when null (unknown keywords only).
   */
  private annUnit(valueExpr: CodeChunk): CodeChunk {
    const suffix = "/" + escapeSegment(this.currentKeyword);
    const sloc = this.unit.ref.baseUri + "#" + this.unit.ref.pointer + suffix;
    const vocab =
      this.currentVocab !== null
        ? js`vocabulary: ${str(this.currentVocab)}, `
        : js``;
    return js`{ keyword: ${str(this.currentKeyword)}, ${vocab}evaluationPath: ${id("ep")} + ${str(suffix)}, schemaLocation: ${str(sloc)}, instanceLocation: ${id("ip")}, annotation: ${valueExpr} }`;
  }

  /**
   * Record an attempted child-of-here application's segment into the current
   * keyword's collected-value accumulator (before the verdict — the segment is
   * "attempted", not "succeeded"). Non-child-of-here cursors, and keywords
   * without an active accumulator, record nothing.
   */
  private annRecordSegment(cursor: LowerCursor): CodeChunk | null {
    if (!this.annKw) return null;
    if (cursor.kind !== "child" || cursor.of.kind !== "here") return null;
    const seg = cursor.segment;
    const segExpr =
      typeof seg === "string"
        ? str(seg)
        : typeof seg === "number"
          ? num(seg)
          : this.expr(seg);
    switch (this.annKw.produceKind) {
      case "collectedNames":
        return js`${this.annKw.names!}.add(${segExpr});`;
      case "largestOrTrue":
        return js`if (${segExpr} > ${this.annKw.max!}) ${this.annKw.max!} = ${segExpr};`;
      case "appliedTrue":
        return js`${this.annKw.applied!} = true;`;
      default:
        // matchedOrAllTrue records inside its countRange, not at apply sites.
        return null;
    }
  }

  private applyStatement(apply: LowerApply): CodeChunk {
    if (apply.fold === "allMustPass") {
      const inlined = this.tryInline(apply);
      if (inlined) return inlined;
    }
    const call = this.applyCall(apply);
    if (this.annMode) {
      switch (apply.fold) {
        case "allMustPass": {
          // Record the attempted segment (before the verdict), then mark the
          // span so a failing child's productions truncate (rule 3 discard).
          const rec = this.annRecordSegment(apply.cursor);
          const pre = rec ? js`${rec} ` : js``;
          const m = id("m" + String(this.counters.temp++));
          return js`${pre}const ${m} = ${id("anns")}.length; if (!${call}) { ok = false; ${id("anns")}.length = ${m}; }`;
        }
        case "negate": {
          // A passing negated subschema merges (the unit then fails and the
          // caller truncates the whole span); a failing one truncates here.
          const m = id("m" + String(this.counters.temp++));
          return js`const ${m} = ${id("anns")}.length; if (${call}) { ${this.pushError(
            this.message(apply.message ?? ["must not match the subschema"]),
            true,
            this.paramsChunk(apply.params),
          )} } else { ${id("anns")}.length = ${m}; }`;
        }
        default:
          break; // grouped folds handled by keywordStatements; discard by applyExpr
      }
    }
    if (this.output === "list") {
      switch (apply.fold) {
        case "allMustPass":
          return js`if (!${call}) ok = false;`;
        case "negate":
          return js`if (${call}) { ${this.pushError(
            this.message(apply.message ?? ["must not match the subschema"]),
            true,
            this.paramsChunk(apply.params),
          )} }`;
        default:
          break; // grouped folds handled by keywordStatements; discard by applyExpr
      }
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
      this.output,
      this.listParams,
      this.annMode,
      this.annKeep,
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
      // Boolean subschemas fold to literals — except in list mode, where a
      // `false` schema must report its "schema is false" error unit.
      if (typeof target.ref.node === "boolean") {
        if (this.output !== "list") {
          return target.ref.node ? js`true` : js`false`;
        }
        if (target.ref.node) return js`true`;
      }
      const fn = unitFn(this.fnIndex.get(targetKey)!);
      const scope = this.unit.reachesInterpreted ? S : id("h_s0");
      this.calledUnit = true;
      if (this.annMode) {
        return js`${fn}(${valueExpr}, ${D}, ${scope}, ${this.applyEp(apply)}, ${this.applyIp(apply)}, ${id("errs")}, ${id("anns")})`;
      }
      if (this.output === "list") {
        return js`${fn}(${valueExpr}, ${D}, ${scope}, ${this.applyEp(apply)}, ${this.applyIp(apply)}, ${id("errs")})`;
      }
      return js`${fn}(${valueExpr}, ${D}, ${scope})`;
    }
    const slot = num(this.tableIndex.get(targetKey)!);
    this.calledUnit = true;
    if (this.annMode) {
      return js`${id("h_fragla")}(${T}[${slot}], ${valueExpr}, ${S}, ${D}, ${this.applyEp(apply)}, ${this.applyIp(apply)}, ${id("errs")}, ${id("anns")})`;
    }
    if (this.output === "list") {
      return js`${id("h_fragl")}(${T}[${slot}], ${valueExpr}, ${S}, ${D}, ${this.applyEp(apply)}, ${this.applyIp(apply)}, ${id("errs")})`;
    }
    return js`${id("h_frag")}(${T}[${slot}], ${valueExpr}, ${S}, ${D})`;
  }

  /**
   * The child's evaluation-path prefix: the caller's `ep` plus this apply's
   * constant segment chain — the keyword name (or the driven sibling's, or
   * just the reference keyword for ref applies) plus any static path
   * segments. Bindings never appear in apply paths (only in cursors), so
   * the suffix is always a compile-time constant.
   */
  private applyEp(apply: LowerApply): CodeChunk {
    const segments =
      apply.sibling !== undefined
        ? [apply.sibling, ...apply.path]
        : [this.currentKeyword, ...apply.path];
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
  private applyIp(apply: LowerApply): CodeChunk {
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
    return js`${id("ip")} + "/" + ${id("h_esc")}(String(${this.expr(seg)}))`;
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
      if (want.filter((w) => w !== "*").join("\u0000") === got.join("\u0000"))
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
      case "tally":
      case "tallyList":
        throw new SerializeError(
          "'" + e.kind + "' is only meaningful inside a combineCheck message",
        );
      case "applyExpr":
        // The two legal applyExpr positions (`if`'s condition, contains'
        // probe) are intercepted at the statement level so their span can
        // mark/truncate. Reaching here in annotation mode means an
        // unrecognized shape whose productions could not be discarded — fail
        // loud rather than lose annotations silently.
        if (this.annMode) {
          throw new SerializeError(
            "applyExpr in an unmarkable position for keyword '" +
              this.currentKeyword +
              "' (annotation mode)",
          );
        }
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
}
