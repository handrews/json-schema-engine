// IR serializer (M6.2): planned units + keyword lower() IR → artifact
// source. Flag-mode semantics: fail-fast within a unit (verdict-only),
// annotations elided, anyOf short-circuit licensed because the planner
// interprets any node whose channel could be observed (slice licensing;
// DESIGN §7). All text assembly goes through the gated formatter (emit.ts).

import {
  makeRecordPredicate,
  type RecordPredicate,
  type SchemaRegistry,
} from "@jse/core";
import { type CodeChunk, frag, id, join, js, num, raw, str } from "../emit.js";
import type { CompilationPlan, PlannedUnit } from "../plan.js";
import {
  V,
  D,
  S,
  R,
  T,
  EV,
  EP,
  IP,
  ST,
  TP,
  TN,
  type ChannelShape,
  unitFn,
  unitFnRegion,
  regexConst,
  formatConst,
  channelArgs,
  fragHelper,
} from "./names.js";
import {
  UnitContext,
  SerializeError,
  type EmitMode,
  type EmitFlags,
  DEFAULT_FLAGS,
  type SerializeOptions,
} from "./context.js";
import { guardDecl } from "./guards.js";
import { unitBody } from "./unit.js";

export type {
  AnnotateOptions,
  EmitFlags,
  EmitMode,
  EmitOutput,
  SerializeOptions,
} from "./context.js";

/** The root application call the footer wraps: static function or trampoline, per mode. */
function rootCallChunk(
  plan: CompilationPlan,
  fnIndex: Map<string, number>,
  tableIndex: Map<string, number>,
  shape: ChannelShape,
): CodeChunk {
  const root = plan.units.get(plan.rootKey)!;
  // The root's prefixes are empty; under trace emission its parent is the
  // state's holder node.
  const args = channelArgs(
    shape,
    () => [str(""), str("")],
    js`${ST}.hold`,
    false,
  );
  if (root.kind === "static") {
    const fn = unitFn(fnIndex.get(root.key)!);
    return js`${fn}(${join(", ", [V, num(0), id("h_s0"), ...args])})`;
  }
  const slot = num(tableIndex.get(root.key)!);
  const helper = fragHelper(shape, false);
  return js`${helper}(${join(", ", [js`${T}[${slot}]`, V, id("h_s0"), num(0), ...args])})`;
}

/** Helper bindings, the depth bound, and the hoisted regex/format consts (D9f). */
function prologueChunks(
  plan: CompilationPlan,
  mode: EmitMode,
  shape: ChannelShape,
  hasRegion: boolean,
): CodeChunk[] {
  const { output, annMode, trace } = shape;
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
    if (annMode && !trace) {
      prologue.push(js`const h_fragla = ${R}.fragListAnn;`);
    }
    // Trace emission records through the runtime: node creation, the record
    // pushes that name their application, the level-dependent cuts, and the
    // traced island trampoline.
    if (trace) {
      prologue.push(
        js`const { traceState: h_tstate, traceNode: h_tnode, traceError: h_err, traceAnn: h_ann, cutErrors: h_cutE, cutAnns: h_cutA, fragTrace: h_fragt } = ${R};`,
      );
    }
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
  return prologue;
}

/** The artifact's entry function, per output and mode. */
function footerChunk(
  mode: EmitMode,
  shape: ChannelShape,
  rootCall: CodeChunk,
): CodeChunk {
  const { output, annMode, trace } = shape;
  const ERRS = id("errs");
  const ANNS = id("anns");
  if (trace) {
    // The state carries the flat channels with their owners and the tree;
    // the artifact wrapper turns it into a Result.
    return js`\nreturn function evaluateTrace(${V}) { const ${ST} = ${id("h_tstate")}(); const ok = ${rootCall}; ${ST}.valid = ok; return ${ST}; };\n`;
  }
  const footer = annMode
    ? js`\nreturn function evaluateList(${V}) { const ${ERRS} = []; const ${ANNS} = []; const ok = ${rootCall}; return { valid: ok, errors: ${ERRS}, annotations: ${ANNS} }; };\n`
    : output === "list"
      ? js`\nreturn function evaluateList(${V}) { const ${ERRS} = []; const ok = ${rootCall}; return { valid: ok, errors: ${ERRS} }; };\n`
      : mode === "runtime"
        ? js`\nreturn function validate(${V}) { return ${rootCall}; };\n`
        : js`\nexport default function validate(${V}) { return ${rootCall}; };\n`;
  return footer;
}

/** Serializes one compilation plan into artifact source. */
export function serializePlan(
  plan: CompilationPlan,
  registry: SchemaRegistry,
  options: SerializeOptions = {},
): string {
  const {
    mode = "runtime",
    flags = DEFAULT_FLAGS,
    output = "flag",
    listParams = false,
    annotate,
    trace = false,
  } = options;
  if (output === "list" && mode === "standalone") {
    throw new SerializeError("standalone emission is flag-only (M6.5 scope)");
  }
  if (trace && output !== "list") {
    throw new SerializeError("trace emission is a list-mode variant");
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
  const shape: ChannelShape = { output, annMode, trace };
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
        shape,
        listParams,
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
          shape,
          listParams,
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

  const rootCall = rootCallChunk(plan, fnIndex, tableIndex, shape);
  const prologue = prologueChunks(plan, mode, shape, hasRegion);
  const footer = footerChunk(mode, shape, rootCall);
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
  shape: ChannelShape,
  listParams: boolean,
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
  const { output, annMode, trace } = shape;
  const sloc = str(unit.ref.baseUri + "#" + unit.ref.pointer);
  // Trace emission: every application, boolean schemas included, is a node.
  const enterNode = js`const ${TN} = ${id("h_tnode")}(${TP}, ${EP}, ${sloc}, ${IP});`;
  // The unit signature carries the channels of the emission (channelArgs); a
  // region variant appends the coverage channel after every other parameter.
  const sig = js`(${join(", ", [V, D, S, ...channelArgs(shape, () => [EP, IP], TP, regionVariant)])})`;

  if (typeof node === "boolean") {
    // List mode: `false` reports the interpreter's boolean-schema error
    // (keywordName null — no keyword suffix on either location).
    // Structured-params mode: keywordName is null here, so the unit gets
    // empty params and no keyword field (renderError's includeParams shape).
    // A `false` schema never produces an annotation; the `anns` parameter is
    // carried only to match the call signature.
    const falseParams = listParams ? js`, params: {}` : js``;
    const falseUnit = js`{ evaluationPath: ${id("ep")}, schemaLocation: ${sloc}, inputLocation: ${id("ip")}, error: "schema is false"${falseParams} }`;
    const chunk = trace
      ? node
        ? js`function ${fn}${sig} { ${id("h_tnode")}(${TP}, ${EP}, ${sloc}, ${IP}); return true; }`
        : js`function ${fn}${sig} { ${enterNode} ${TN}.valid = false; ${id("h_err")}(${ST}, ${TN}, ${falseUnit}); return false; }`
      : output === "list" && !node
        ? js`function ${fn}${sig} { ${id("errs")}.push(${falseUnit}); return false; }`
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
  if (trace) body.push(enterNode);

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
    shape.trace,
  );
  const unitStmts = unitBody(ctx);
  // Depth guard (D20 combined budget) only where a chain can grow: a
  // function that calls no unit/fragment cannot recurse, and its own entry
  // was budgeted by every caller on the way down.
  if (ctx.calledUnit) {
    body.unshift(js`if (${D} >= ${id("h_maxd")}) ${id("h_deep")}(); ${D}++;`);
  }
  const guard = guardDecl(ctx);
  if (guard) body.push(guard);
  if (output === "list") body.push(js`let ok = true;`);
  // A tracked unit owns its channel locally (it is entered like any plain
  // unit); a region variant receives the caller's channel as `ev`.
  if (regionMode && !regionVariant) body.push(js`const ${EV} = [];`);
  body.push(...unitStmts);

  if (output === "list") {
    if (trace) body.push(js`${TN}.valid = ok;`);
    body.push(js`return ok;`);
    return {
      key: unit.key,
      boolean: false,
      chunk: js`function ${fn}${sig} { ${join("\n", body)} }`,
      inlined: ctx.inlinedKeys,
      region: regionVariant,
    };
  }
  body.push(js`return true;`);
  return {
    key: unit.key,
    boolean: false,
    chunk: js`function ${fn}${sig} { ${join("\n", body)} }`,
    inlined: ctx.inlinedKeys,
    region: regionVariant,
  };
}
