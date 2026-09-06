// IR serializer (M6.2): planned units + keyword lower() IR → artifact
// source. Flag-mode semantics: fail-fast within a unit (verdict-only),
// annotations elided, anyOf short-circuit licensed because the planner
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
  type AnnotationSelection,
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
const EV = id("ev"); // runtime coverage channel (region emission, phase B)

const unitFn = (index: number): CodeChunk => id("u" + String(index));
// Region-variant of a unit function: same body with the trailing coverage
// channel threaded (COMPILED-CONSUMERS.md phase B). A distinct name so a unit
// can carry both a plain and a channel-threaded emission.
const unitFnRegion = (index: number): CodeChunk =>
  id("u" + String(index) + "c");
const bindingVar = (n: number): CodeChunk => id("b" + String(n));
const regexConst = (i: number): CodeChunk => id("r" + String(i));
const formatConst = (i: number): CodeChunk => id("fmt" + String(i));
const counterVar = (n: number): CodeChunk => id("c" + String(n));
const foldVar = (n: number): CodeChunk => id("f" + String(n));

class SerializeError extends Error {}

/**
 * Annotation-mode options threaded through serialization. Its presence (with
 * `output === "list"`) turns on annotation collection; the selection's
 * allow/deny lists are applied statically at annotate sites (the compiled
 * analogue of annotation elision — the same {@link makeRecordPredicate}
 * decision the interpreter's renderer makes). The `keep` predicate runs at
 * runtime in the artifact wrapper, never here.
 */
export interface AnnotateOptions {
  selection?: boolean | AnnotationSelection;
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

/** True when a keyword's lowered statement list contains an `annotate` node (searched into blocks). */
function hasAnnotate(stmts: readonly LowerStmt[]): boolean {
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
  // Runtime coverage tracking (COMPILED-CONSUMERS.md) composes with flag AND
  // list/annotation outputs — list plans track every consumer (plan.ts), so
  // region emission there is the normal case. Standalone stays out of scope.
  const hasRegion = [...plan.units.values()].some(
    (u) => u.tracking === true || u.inRegion === true,
  );
  if (hasRegion && mode === "standalone") {
    throw new SerializeError(
      "standalone emission does not support runtime coverage tracking (phase B)",
    );
  }
  // The coverage producers a consumer observes: a region producer pushes its
  // raw dependency data onto the channel only when a consumer reads it and
  // the data is coverage-shaped (rule 5; SchemaRegistry.coverageIds).
  const coverageIds = registry.coverageIds();
  // Annotation collection is a list-mode variant: it reuses the list plan and
  // fail-open, no-short-circuit discipline, adding a flat `anns` channel with
  // mark/truncate at every application boundary (channel rule 3).
  const annMode = annotate !== undefined && output === "list";
  // Static selection: the annotate/unknown-keyword allow/deny decision, applied
  // at emit time so ruled-out annotations never emit. `keep` is deferred.
  const annKeep: RecordPredicate | null = annMode
    ? makeRecordPredicate(annotate.selection ?? true)
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
    /** a channel-threaded region variant (never a dead-function candidate) */
    region: boolean;
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
        coverageIds,
        false,
      ),
    );
    // A region member carries a second emission whose signature takes the
    // coverage channel; the plain variant above still serves child-cursor
    // and non-region callers (phase B).
    if (unit.inRegion) {
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
          coverageIds,
          true,
        ),
      );
    }
  }
  // Drop dead functions: units expanded into their caller (D9c) and boolean
  // units (their applications folded to literals). The root always stays.
  // Region variants are always retained (correctness first; an uncalled one is
  // inert declaration bytes, phase B size note).
  const inlinedEverywhere = new Set<string>();
  for (const r of rendered) for (const k of r.inlined) inlinedEverywhere.add(k);
  // List mode calls boolean-false units (they report "schema is false"),
  // so their functions survive the dead-function filter there.
  const functions = rendered
    .filter(
      (r) =>
        r.region ||
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
    // Region emission (phase B) helpers: the two channel folds, plus the
    // coverage-harvesting island trampoline in flag mode (list islands go
    // through the list trampolines' trailing-`ev` overloads instead). Only
    // bound when a tracked/region unit exists, so consumer-free artifacts
    // keep their prologue unchanged.
    if (hasRegion) {
      prologue.push(
        output === "flag"
          ? js`const h_covN = ${R}.foldNameCoverage, h_covI = ${R}.foldIndexCoverage, h_fragc = ${R}.fragCov;`
          : js`const h_covN = ${R}.foldNameCoverage, h_covI = ${R}.foldIndexCoverage;`,
      );
    }
  }
  plan.patterns.forEach((source, i) => {
    prologue.push(
      mode === "runtime"
        ? js`const ${regexConst(i)} = ${R}.re[${str(source)}];`
        : js`const ${regexConst(i)} = ${id("h_rx")}(${str(source)});`,
    );
  });
  // One format-definition lookup per used name (runtime mode only). Standalone
  // never reaches a format-bearing plan — emitStandalone rejects plan.formats
  // (a format predicate like IDNA cannot be duplicated into a zero-import
  // module), so plan.formats is empty here in that mode.
  plan.formats.forEach((name, i) => {
    prologue.push(js`const ${formatConst(i)} = ${R}.formats[${str(name)}];`);
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
  coverageIds: ReadonlySet<string>,
  /** emitting the channel-threaded region variant of an inRegion unit */
  regionVariant: boolean,
): {
  key: string;
  boolean: boolean;
  chunk: CodeChunk;
  inlined: ReadonlySet<string>;
  region: boolean;
} {
  // Region emission (phase B) applies to a tracked unit's body (a local
  // channel `const ev = []`) and to an inRegion unit's region variant (the
  // channel is a trailing parameter). A tracked unit is never inRegion (nested
  // tracked consumers island), so the two never coincide.
  const regionMode = regionVariant || unit.tracking === true;
  if (regionVariant && unit.tracking) {
    throw new SerializeError("a tracked unit cannot also be a region member");
  }
  const fn = regionVariant
    ? unitFnRegion(fnIndex.get(unit.key)!)
    : unitFn(fnIndex.get(unit.key)!);
  const node = unit.ref.node;
  // Annotation mode extends the list signature with a trailing `anns` channel;
  // a region variant appends the coverage channel after every other parameter.
  const listSig = annMode
    ? regionVariant
      ? js`(${V}, ${D}, ${S}, ${id("ep")}, ${id("ip")}, ${id("errs")}, ${id("anns")}, ${EV})`
      : js`(${V}, ${D}, ${S}, ${id("ep")}, ${id("ip")}, ${id("errs")}, ${id("anns")})`
    : regionVariant
      ? js`(${V}, ${D}, ${S}, ${id("ep")}, ${id("ip")}, ${id("errs")}, ${EV})`
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
        ? js`function ${fn}${listSig} { ${id("errs")}.push({ evaluationPath: ${id("ep")}, schemaLocation: ${str(unit.ref.baseUri + "#" + unit.ref.pointer)}, inputLocation: ${id("ip")}, error: "schema is false"${falseParams} }); return false; }`
        : js`function ${fn}() { return ${raw(String(node))}; }`;
    return {
      key: unit.key,
      boolean: true,
      chunk,
      inlined: new Set(),
      region: false,
    };
  }

  const body: CodeChunk[] = [];
  if (unit.reachesInterpreted) {
    // Dynamic-scope contribution: appended once per application, duplicates
    // harmless (outermost-first resolution). Only threaded where a fragment
    // can consume it.
    body.push(js`${S} = [...${S}, ${str(unit.ref.baseUri)}];`);
  }

  // A unit that participates in region emission (a tracked unit, or an
  // inRegion unit — through EITHER variant) never inlines: a single-use child
  // inlined into the plain variant would be dropped by the dead-function
  // filter yet still called by the region variant (which does not inline).
  const unitFlags =
    regionMode || unit.inRegion === true ? { ...flags, inline: false } : flags;
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
    unitFlags,
    output,
    listParams,
    annMode,
    annKeep,
    regionMode,
    coverageIds,
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
  // A tracked unit owns its channel locally (it is entered like any plain
  // unit); a region variant receives the caller's channel as `ev`.
  if (regionMode && !regionVariant) body.push(js`const ${EV} = [];`);
  body.push(...unitStmts);

  if (output === "list") {
    body.push(js`return ok;`);
    return {
      key: unit.key,
      boolean: false,
      chunk: js`function ${fn}${listSig} { ${join("\n", body)} }`,
      inlined: ctx.inlinedKeys,
      region: regionVariant,
    };
  }
  body.push(js`return true;`);
  const sig = regionVariant
    ? js`(${V}, ${D}, ${S}, ${EV})`
    : js`(${V}, ${D}, ${S})`;
  return {
    key: unit.key,
    boolean: false,
    chunk: js`function ${fn}${sig} { ${join("\n", body)} }`,
    inlined: ctx.inlinedKeys,
    region: regionVariant,
  };
}

/** Per-unit serialization state: bindings, keyword context, apply targets. */
interface Counters {
  binding: number;
  tally: number;
  temp: number;
}

/**
 * The accumulator(s) a keyword's produce recipe reads: names build a deduped
 * `Set`, indexes a max tracker / applied flag / matched list. Set by
 * {@link UnitContext.beginKeyword} for a consumed producer in region emission,
 * and driven by the application call sites within the keyword's own
 * statements.
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
  // State for the keyword currently being emitted: whether its annotate is
  // retained (static lists), whether its produce feeds the runtime coverage
  // channel (consumed producer), and the accumulators the produce reads. The
  // two flags are independent — retention must never affect coverage.
  private annKwKept = false;
  private covKwKept = false;
  private annKw: KeywordAnn | null = null;
  // List-mode channel producers gate their push on the keyword's OWN verdict
  // (Appendix D: dependency data only from an accepting keyword); the unit's
  // `ok` cannot serve, since list mode continues past a failed sibling.
  private kwOk: CodeChunk | null = null;
  // Object-guard CSE: one `const gN = (typeof x === "object" && …)` per
  // unit value, prepended by the body builder when used. Inlined `here`-
  // cursor children share the parent's guard (same value, same variable).
  private objGuardVar: CodeChunk | null = null;
  objGuardUsed = false;
  /** set when this unit's body (incl. inlines) emits any unit/frag call */
  calledUnit = false;
  // Region emission (phase B): the current keyword's behavior id (for the
  // consumed-producer channel-push gate) and the JS variable + half bound by
  // each coverageFold, read by a following coverageCovers.
  private currentBehaviorId = "";
  private coverageFolds = new Map<
    number,
    { readonly var: CodeChunk; readonly half: "names" | "indexes" }
  >();

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
    /** region emission: thread the runtime coverage channel `ev` (phase B) */
    private regionMode = false,
    /** behavior ids a consumer observes (region channel-push gate, rule 5) */
    private coverageIds: ReadonlySet<string> = new Set(),
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
    const vocab =
      this.currentVocab !== null
        ? js`vocabulary: ${str(this.currentVocab)}, `
        : js``;
    const extra = this.listParams
      ? withKeyword
        ? js`, keyword: ${str(this.currentKeyword)}, ${vocab}params: ${params ?? js`{}`}`
        : js`, params: ${params ?? js`{}`}`
      : js``;
    const fail = this.kwOk
      ? js`ok = false; ${this.kwOk} = false;`
      : js`ok = false;`;
    return js`${fail} ${id("errs")}.push({ evaluationPath: ${id("ep")} + ${str(suffix)}, schemaLocation: ${str(sloc)}, inputLocation: ${id("ip")}, error: ${msg}${extra} });`;
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
      this.currentBehaviorId = behavior.id;
      // Accumulator declarations hoist above the keyword's statements: the
      // application call sites feed them, the produce reads them.
      const decls = this.beginKeyword(stmts);
      const chunks = this.keywordStatements(stmts);
      out.push(...decls, ...chunks);
    }
    // Unknown keywords collect as annotations (engine.ts:414): unconditional
    // constant annotations, in schema-key order, after every dialect keyword.
    // The refOnly break silences siblings, matching the interpreter.
    if (this.annMode && !refOnly) {
      for (const name of Object.keys(node)) {
        if (dialect.keywords.has(name)) continue;
        if (this.annKeep && !this.annKeep("", name, null)) continue;
        const suffix = "/" + escapeSegment(name);
        const sloc =
          this.unit.ref.baseUri + "#" + this.unit.ref.pointer + suffix;
        out.push(
          js`${id("anns")}.push({ keyword: ${str(name)}, evaluationPath: ${id("ep")} + ${str(suffix)}, schemaLocation: ${str(sloc)}, inputLocation: ${id("ip")}, annotation: ${json(node[name]!)} });`,
        );
      }
    }
    return out;
  }

  /**
   * Prepare the keyword currently being emitted: decide whether its annotate
   * survives the static retention lists, whether its produce feeds the
   * coverage channel, and allocate the produce's accumulator (declared by the
   * returned chunks). No-op outside annotation and region modes.
   */
  private beginKeyword(stmts: readonly LowerStmt[]): CodeChunk[] {
    this.annKw = null;
    this.annKwKept = false;
    this.covKwKept = false;
    this.kwOk = null;
    if (!this.annMode && !this.regionMode) return [];
    this.annKwKept =
      this.annMode &&
      hasAnnotate(stmts) &&
      (!this.annKeep ||
        this.annKeep("", this.currentKeyword, this.currentVocab));
    const value = findProduce(stmts);
    if (!value) return [];
    // Region channel-push gate (rule 5): only a coverage producer some
    // consumer reads feeds the channel. Retention never affects it —
    // dependency data is not output.
    this.covKwKept =
      this.regionMode && this.coverageIds.has(this.currentBehaviorId);
    if (!this.covKwKept) return [];
    const decls: CodeChunk[] = [];
    if (this.output === "list") {
      const k = id("k" + String(this.counters.temp++));
      this.kwOk = k;
      decls.push(js`let ${k} = true;`);
    }
    if (value.kind === "collectedNames") {
      const n = id("n" + String(this.counters.temp++));
      this.annKw = { produceKind: "collectedNames", names: n };
      decls.push(js`const ${n} = new Set();`);
    } else if (value.render === "largestOrTrue") {
      const m = id("n" + String(this.counters.temp++));
      this.annKw = { produceKind: "largestOrTrue", max: m };
      decls.push(js`let ${m} = -1;`);
    } else if (value.render === "appliedTrue") {
      const a = id("n" + String(this.counters.temp++));
      this.annKw = { produceKind: "appliedTrue", applied: a };
      decls.push(js`let ${a} = false;`);
    } else {
      const t = id("n" + String(this.counters.temp++));
      this.annKw = { produceKind: "matchedOrAllTrue", matched: t };
      decls.push(js`const ${t} = [];`);
    }
    return decls;
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
      // A tracked unit's consumers read the runtime channel; a static-coverage
      // consumer (even one that is a region member) keeps its static path and
      // instead PUSHES its produce onto the channel for the enclosing consumer.
      runtimeCoverage: () => unit.tracking === true,
      emit: (...s) => stmts.push(...s),
      binding: () => this.counters.binding++,
    };
    run(lctx);
    return stmts;
  }

  /**
   * The channel spans active at an application boundary: `anns` in annotation
   * mode, `ev` in region emission, both when composed, none otherwise. errs
   * is not one of them: a failed application keeps its errors (they become
   * irrelevant only when an enclosing KEYWORD accepts, draft-03 §12.2), so
   * error truncation is keyword-scoped — see errMark() — not per branch.
   */
  private channelSpans(includeEv = true): { chan: CodeChunk; m: CodeChunk }[] {
    const spans: { chan: CodeChunk; m: CodeChunk }[] = [];
    if (this.annMode) {
      spans.push({
        chan: id("anns"),
        m: id("m" + String(this.counters.temp++)),
      });
    }
    if (this.regionMode && includeEv) {
      spans.push({ chan: EV, m: id("m" + String(this.counters.temp++)) });
    }
    return spans;
  }

  private spanDecls(spans: { chan: CodeChunk; m: CodeChunk }[]): CodeChunk {
    return join(
      " ",
      spans.map(({ chan, m }) => js`const ${m} = ${chan}.length;`),
    );
  }

  private spanResets(spans: { chan: CodeChunk; m: CodeChunk }[]): CodeChunk {
    return join(
      " ",
      spans.map(({ chan, m }) => js`${chan}.length = ${m};`),
    );
  }

  /**
   * Error relevance (draft-03 §12.2) in list mode: a keyword that accepts
   * makes the errors its sub-evaluations pushed irrelevant. Callers take the
   * mark before the keyword's applies and truncate on the accept path;
   * every branch's errors land in the shared `errs` between the two.
   */
  private errMark(): CodeChunk | null {
    return this.output === "list"
      ? id("m" + String(this.counters.temp++))
      : null;
  }

  /**
   * One grouped-fold branch: run `call`, apply `hit` on success, truncate the
   * active channel spans on failure (a failed branch's records and
   * coverage discard; a passing branch's merge — channel rule 3 per branch).
   */
  private branchSpan(call: CodeChunk, hit: CodeChunk): CodeChunk {
    const spans = this.channelSpans();
    if (spans.length === 0) return js`if (${call}) { ${hit} }`;
    return js`{ ${this.spanDecls(spans)} if (${call}) { ${hit} } else { ${this.spanResets(spans)} } }`;
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
      if (this.output === "list") {
        // Every branch runs (§7: list artifacts never short-circuit), each
        // marking/truncating its channel spans (branchSpan). An accepting
        // run drops every branch's errors (errMark).
        const a = counterVar(this.counters.tally++);
        const em = this.errMark()!;
        const runs = anyRun.map((call) =>
          this.branchSpan(call, js`${a} = true;`),
        );
        const onFail = this.pushError(
          this.message(message ?? ["no branch matched"]),
          true,
          this.paramsChunk(params),
        );
        out.push(
          js`let ${a} = false; const ${em} = ${id("errs")}.length; ${join(" ", runs)} if (${a}) { ${id("errs")}.length = ${em}; } else { ${onFail} }`,
        );
      } else if (this.regionMode) {
        // Every branch runs (no short-circuit — a later branch's success
        // contributes coverage the interpreter would merge), each marking and
        // truncating its own channel span (rule 2). Flag failure on no match.
        const a = counterVar(this.counters.tally++);
        const runs = anyRun.map((call) =>
          this.branchSpan(call, js`${a} = true;`),
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
      const c = counterVar(this.counters.tally++);
      if (this.output === "list") {
        // Params referencing the passing-branch indexes (tallyList) need an
        // index accumulator next to the count; branch order IS run order.
        // Both-pass discards at the caller (the unit fails, its span
        // truncates); each branch marks/truncates its own spans here.
        const wantsList =
          this.listParams &&
          params !== undefined &&
          Object.values(params).some((p) => p.kind === "tallyList");
        const p = wantsList ? counterVar(this.counters.tally++) : undefined;
        const incs = oneRun.map((call, k) =>
          this.branchSpan(
            call,
            p ? js`${c}++; ${p}.push(${num(k)});` : js`${c}++;`,
          ),
        );
        const decl = p ? js`let ${c} = 0; const ${p} = [];` : js`let ${c} = 0;`;
        const onFail = this.pushError(
          this.message(message ?? [{ kind: "tally" }, " branches matched"], c),
          true,
          this.paramsChunk(params, c, p),
        );
        const em = this.errMark()!;
        out.push(
          js`${decl} const ${em} = ${id("errs")}.length; ${join(" ", incs)} if (${c} === 1) { ${id("errs")}.length = ${em}; } else { ${onFail} }`,
        );
      } else if (this.regionMode) {
        // Run every branch with a per-branch mark/truncate (rule 2): a passing
        // branch's coverage merges, a failing branch's truncates. On a non-unit
        // count the unit fails and the caller truncates the whole span.
        const incs = oneRun.map((call) => this.branchSpan(call, js`${c}++;`));
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
        if (
          (this.annMode || this.regionMode || this.output === "list") &&
          stmt.cond.kind === "applyExpr"
        ) {
          // `if`'s condition is in-place: hoist the call so its channel spans
          // mark/truncate on the condition verdict (a passing condition's
          // coverage merges, a failing one's — with the else taken — truncates;
          // rule 4). ann marks `anns`, region marks `ev`, composed both. The
          // condition's errors are always irrelevant (`if` accepts regardless
          // of its subschema), so list mode truncates them unconditionally.
          const spans = this.channelSpans();
          const t = id("m" + String(this.counters.temp++));
          const em = this.errMark();
          const call = this.applyCall(stmt.cond.apply);
          const errDecl = em ? js`const ${em} = ${id("errs")}.length; ` : js``;
          const errReset = em ? js` ${id("errs")}.length = ${em};` : js``;
          const resets =
            spans.length > 0
              ? js` if (!${t}) { ${this.spanResets(spans)} }`
              : js``;
          const head = js`${this.spanDecls(spans)} ${errDecl}const ${t} = ${call};${errReset}${resets}`;
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
      case "annotate": {
        // Annotation mode records the keyword's own value as a unit; every
        // other mode elides. The value is a schema constant (draft-03 §12.9).
        if (!this.annMode || !this.annKwKept) return js``;
        const value = (this.unit.ref.node as Record<string, JsonValue>)[
          this.currentKeyword
        ]!;
        return js`${id("anns")}.push(${this.annUnit(json(value))});`;
      }
      case "produce": {
        // Region mode pushes a consumed producer's dependency data onto the
        // channel (rule 5); dependency data is never an annotation unit. In
        // list mode the push waits on the keyword's own verdict (kwOk).
        if (!this.covKwKept) return js``;
        const push = this.produceChannel(stmt.value);
        return this.kwOk ? js`if (${this.kwOk}) { ${push} }` : push;
      }
      case "coverageFold": {
        // Bind the channel fold a following coverageCovers reads (rule 6). Only
        // a tracked unit's consumer emits this, and only in region mode.
        if (!this.regionMode) {
          throw new SerializeError(
            "coverageFold requires region emission (phase B)",
          );
        }
        const f = foldVar(this.counters.temp++);
        this.coverageFolds.set(stmt.binding, { var: f, half: stmt.half });
        if (stmt.half === "names") {
          return js`const ${f} = ${id("h_covN")}(${EV});`;
        }
        // indexes: fold over the current instance array's length (the enclosing
        // lower() guards this with an array-type test).
        return js`const ${f} = ${id("h_covI")}(${EV}, ${this.valueVar}.length);`;
      }
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
        // List mode: an accepting contains drops every probe's errors, a
        // rejecting one keeps them (§12.2) — one mark around the whole loop,
        // never per probe.
        const em = this.errMark();
        const errDecl = em ? js`const ${em} = ${id("errs")}.length; ` : js``;
        const check = em
          ? js`if (${outOfRange}) { ${onFail} } else { ${id("errs")}.length = ${em}; }`
          : js`if (${outOfRange}) { ${onFail} }`;
        // contains' probe IS a bare applyExpr (the only shape besides `if`'s
        // condition): mark/truncate each probe so a matching item's
        // annotations merge and a failing item's discard. collectIndexes feeds
        // the matched-index accumulator the following produce renders.
        if (this.annMode && stmt.countWhen.kind === "applyExpr") {
          const probe = this.applyCall(stmt.countWhen.apply);
          const m = id("m" + String(this.counters.temp++));
          const pushIdx =
            this.annKw?.matched && stmt.collectIndexes
              ? js` ${this.annKw.matched}.push(${b});`
              : js``;
          const loop = js`${errDecl}let ${c} = 0; for (let ${b} = 0; ${b} < ${this.expr(stmt.target)}.length; ${b}++) { const ${m} = ${id("anns")}.length; if (${probe}) { ${c}++;${pushIdx} } else ${id("anns")}.length = ${m}; }`;
          return js`${loop} ${check}`;
        }
        if (this.regionMode && stmt.countWhen.kind === "applyExpr") {
          // The probe is a CHILD-cursor apply (a plain call that never receives
          // `ev`), so there is no channel span to mark here — `contains`'
          // coverage reaches the channel only through its matched-index produce
          // (rule 5). Accumulate the matched indexes for that produce.
          const probe = this.applyCall(stmt.countWhen.apply);
          const pushIdx =
            this.annKw?.matched && stmt.collectIndexes
              ? js` ${this.annKw.matched}.push(${b});`
              : js``;
          const loop = js`${errDecl}let ${c} = 0; for (let ${b} = 0; ${b} < ${this.expr(stmt.target)}.length; ${b}++) { if (${probe}) { ${c}++;${pushIdx} } }`;
          return js`${loop} ${check}`;
        }
        const loop = js`${errDecl}let ${c} = 0; for (let ${b} = 0; ${b} < ${this.expr(stmt.target)}.length; ${b}++) { if (${this.expr(stmt.countWhen)}) ${c}++; }`;
        return js`${loop} ${check}`;
      }
    }
  }

  /**
   * Push a consumed producer's dependency data onto the runtime coverage
   * channel (rule 5), writing the value the interpreter would produce. The
   * "has data" guards match the interpreter's produce conditions so the
   * channel carries exactly what a consumer's visible-records fold sees.
   */
  private produceChannel(value: LowerProduceValue): CodeChunk {
    const v = this.valueVar;
    if (value.kind === "collectedNames") {
      // The enclosing lower() gates this produce behind an object-type test;
      // the (attempted, deduped) name array spreads from the Set.
      return js`${EV}.push([...${this.annKw!.names!}]);`;
    }
    if (value.render === "largestOrTrue") {
      const mx = this.annKw!.max!;
      return js`if (${mx} >= 0) ${EV}.push(${mx} + 1 === ${v}.length ? true : ${mx});`;
    }
    if (value.render === "appliedTrue") {
      const ap = this.annKw!.applied!;
      return js`if (${ap}) ${EV}.push(true);`;
    }
    const mt = this.annKw!.matched!;
    return js`if (${mt}.length > 0) ${EV}.push(${mt}.length === ${v}.length ? true : ${mt});`;
  }

  /**
   * The annotation-unit object literal for the current keyword: constant
   * keyword/vocabulary/schemaLocation, runtime evaluationPath (`ep` suffix)
   * and inputLocation (`ip`), key order matching core's renderAnnotation.
   * `vocabulary` is omitted when null (unknown keywords only).
   */
  private annUnit(valueExpr: CodeChunk): CodeChunk {
    const suffix = "/" + escapeSegment(this.currentKeyword);
    const sloc = this.unit.ref.baseUri + "#" + this.unit.ref.pointer + suffix;
    const vocab =
      this.currentVocab !== null
        ? js`vocabulary: ${str(this.currentVocab)}, `
        : js``;
    return js`{ keyword: ${str(this.currentKeyword)}, ${vocab}evaluationPath: ${id("ep")} + ${str(suffix)}, schemaLocation: ${str(sloc)}, inputLocation: ${id("ip")}, annotation: ${valueExpr} }`;
  }

  /**
   * Record an attempted child-of-here application's segment into the current
   * keyword's produce accumulator (before the verdict — the segment is
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
    // A call RECEIVES the coverage channel exactly when it is an in-place
    // apply to a non-boolean target (a region variant, or a coverage-
    // harvesting trampoline); a child-cursor apply is a plain call, and a
    // boolean folds to a literal or reports without producing — neither
    // touches the channel, so neither needs an ev mark/truncate span (rule 1).
    const evSpan =
      this.regionMode &&
      apply.cursor.kind === "here" &&
      call.text !== "true" &&
      call.text !== "false";
    if (this.output === "list") {
      switch (apply.fold) {
        case "allMustPass": {
          // Record the attempted segment (before the verdict) for the
          // keyword's produce accumulator, then mark the channel spans so a
          // failing application's annotations (annMode) and coverage (region
          // emission) truncate — its errors stay (the keyword rejects), and
          // list mode CONTINUES on failure (ok = false, no return): the
          // unit's remaining keywords, including a consumer sweep that now
          // covers less, still run.
          const rec = this.annRecordSegment(apply.cursor);
          const pre = rec ? js`${rec} ` : js``;
          const fail = this.kwOk
            ? js`ok = false; ${this.kwOk} = false;`
            : js`ok = false;`;
          const spans = this.channelSpans(evSpan);
          if (spans.length === 0) return js`${pre}if (!${call}) { ${fail} }`;
          return js`${pre}${this.spanDecls(spans)} if (!${call}) { ${fail} ${this.spanResets(spans)} }`;
        }
        case "negate": {
          // A failing negated subschema's spans truncate, and so do its
          // errors (`not` accepts, §12.2); a PASSING one's annotations and
          // coverage STAY (the interpreter merges any passing application
          // into the unit frame, and same-unit consumers see it) while the
          // unit records the not-error.
          const spans = this.channelSpans(evSpan);
          const em = this.errMark()!;
          const err = this.pushError(
            this.message(apply.message ?? ["must not match the subschema"]),
            true,
            this.paramsChunk(apply.params),
          );
          return js`${this.spanDecls(spans)} const ${em} = ${id("errs")}.length; if (${call}) { ${err} } else { ${id("errs")}.length = ${em}; ${this.spanResets(spans)} }`;
        }
        default:
          break; // grouped folds handled by keywordStatements; discard by applyExpr
      }
    } else if (this.regionMode) {
      switch (apply.fold) {
        case "allMustPass": {
          // Record the attempted child segment (before the verdict) for a
          // consumed producer's channel push (rule 5).
          const rec = this.annRecordSegment(apply.cursor);
          const pre = rec ? js`${rec} ` : js``;
          if (call.text === "true") return rec ?? js``;
          if (call.text === "false") return js`${pre}return false;`;
          if (evSpan) {
            // In-place conjunct: a failed span truncates and fails the unit;
            // the caller's own span then truncates this whole call (rule 2).
            const m = id("m" + String(this.counters.temp++));
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
          const m = id("m" + String(this.counters.temp++));
          return js`const ${m} = ${EV}.length; if (${call}) return false; ${EV}.length = ${m};`;
        }
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
    // Region emission never inlines: an in-place target is called through its
    // channel-threaded region variant, not expanded (rule 8).
    if (this.regionMode) return null;
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
      // A tracked unit owns a local channel and a region member is entered
      // through its channel-threaded variant; neither can be expanded verbatim
      // into a plain caller (phase B).
      target.tracking ||
      target.inRegion ||
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
      const scope = this.unit.reachesInterpreted ? S : id("h_s0");
      this.calledUnit = true;
      // Region emission: an in-place apply threads the channel through the
      // target's region variant (rule 5). Such a target is always a region
      // member — a would-be tracked one was islanded, a boolean folded above
      // or (list-mode `false`) reports without producing, so it keeps the
      // plain variant. Child-cursor applies use the plain variant too (a
      // child location's coverage never joins this unit's channel).
      const inPlaceRegion =
        this.regionMode &&
        apply.cursor.kind === "here" &&
        typeof target.ref.node !== "boolean";
      if (inPlaceRegion && !target.inRegion) {
        throw new SerializeError(
          "in-place region target '" + targetKey + "' is not a region member",
        );
      }
      const fn = inPlaceRegion
        ? unitFnRegion(this.fnIndex.get(targetKey)!)
        : unitFn(this.fnIndex.get(targetKey)!);
      if (this.annMode) {
        return inPlaceRegion
          ? js`${fn}(${valueExpr}, ${D}, ${scope}, ${this.applyEp(apply)}, ${this.applyIp(apply)}, ${id("errs")}, ${id("anns")}, ${EV})`
          : js`${fn}(${valueExpr}, ${D}, ${scope}, ${this.applyEp(apply)}, ${this.applyIp(apply)}, ${id("errs")}, ${id("anns")})`;
      }
      if (this.output === "list") {
        return inPlaceRegion
          ? js`${fn}(${valueExpr}, ${D}, ${scope}, ${this.applyEp(apply)}, ${this.applyIp(apply)}, ${id("errs")}, ${EV})`
          : js`${fn}(${valueExpr}, ${D}, ${scope}, ${this.applyEp(apply)}, ${this.applyIp(apply)}, ${id("errs")})`;
      }
      if (inPlaceRegion) return js`${fn}(${valueExpr}, ${D}, ${scope}, ${EV})`;
      return js`${fn}(${valueExpr}, ${D}, ${scope})`;
    }
    const slot = num(this.tableIndex.get(targetKey)!);
    this.calledUnit = true;
    // Region emission: an in-place island harvests its root coverage into the
    // channel (rule 7) — fragCov in flag mode, the trailing-`ev` overloads of
    // the list trampolines otherwise. A child-cursor island stays plain.
    const inPlaceRegion = this.regionMode && apply.cursor.kind === "here";
    if (this.annMode) {
      return inPlaceRegion
        ? js`${id("h_fragla")}(${T}[${slot}], ${valueExpr}, ${S}, ${D}, ${this.applyEp(apply)}, ${this.applyIp(apply)}, ${id("errs")}, ${id("anns")}, ${EV})`
        : js`${id("h_fragla")}(${T}[${slot}], ${valueExpr}, ${S}, ${D}, ${this.applyEp(apply)}, ${this.applyIp(apply)}, ${id("errs")}, ${id("anns")})`;
    }
    if (this.output === "list") {
      return inPlaceRegion
        ? js`${id("h_fragl")}(${T}[${slot}], ${valueExpr}, ${S}, ${D}, ${this.applyEp(apply)}, ${this.applyIp(apply)}, ${id("errs")}, ${EV})`
        : js`${id("h_fragl")}(${T}[${slot}], ${valueExpr}, ${S}, ${D}, ${this.applyEp(apply)}, ${this.applyIp(apply)}, ${id("errs")})`;
    }
    if (inPlaceRegion) {
      return js`${id("h_fragc")}(${T}[${slot}], ${valueExpr}, ${S}, ${D}, ${EV})`;
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
      case "formatTest": {
        let idx = this.plan.formats.indexOf(e.name);
        if (idx === -1) {
          // The prologue hoists after all units serialize (as with regexTest),
          // so a name first seen here still gets its lookup const.
          idx = this.plan.formats.push(e.name) - 1;
        }
        return js`${formatConst(idx)}.test(${this.expr(e.target)})`;
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
        // unrecognized shape whose records could not be discarded — fail
        // loud rather than lose annotations silently.
        // Region mode intercepts the two legal applyExpr positions at the
        // statement level (if-condition, contains-probe) so their channel span
        // can mark/truncate; reaching here means an unmarkable position.
        if (this.annMode || this.regionMode) {
          throw new SerializeError(
            "applyExpr in an unmarkable position for keyword '" +
              this.currentKeyword +
              "' (" +
              (this.annMode ? "annotation" : "region") +
              " mode)",
          );
        }
        // Same call expression an `apply` statement builds; `fold` on this
        // apply is not consulted here (it governs how a wrapping statement
        // uses the value, not how the call itself is rendered).
        return this.applyCall(e.apply);
      case "coverageCovers": {
        // Test the folded channel bound by a preceding coverageFold (rule 6):
        // set membership for names, prefix-or-index membership for indexes.
        if (!this.regionMode) {
          throw new SerializeError(
            "coverageCovers requires region emission (phase B)",
          );
        }
        const fold = this.coverageFolds.get(e.fold);
        if (!fold) {
          throw new SerializeError(
            "coverageCovers without a preceding coverageFold",
          );
        }
        const target = this.expr(e.target);
        if (fold.half === "names") return js`${fold.var}.has(${target})`;
        return js`(${target} < ${fold.var}.coveredPrefix || ${fold.var}.coveredIdx.has(${target}))`;
      }
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
