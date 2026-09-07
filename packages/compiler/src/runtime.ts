// Runtime surface shared by every compiled artifact. Emitted code never
// re-implements a semantic: it calls these, which are core's own functions,
// so the compiled and interpreted tiers agree by construction (D9, M6).

import {
  MaxDepthExceededError,
  renderAnnotation,
  renderError,
  traceToRenderNodes,
  type AnnotationUnit,
  type ErrorUnit,
  type MutableRenderNode,
  type PathNode,
  type ResultUnits,
  canonicalKey,
  codePointLength,
  escapeSegment,
  evaluateFragment,
  firstDuplicatePair,
  foldIndexCoverage,
  foldNameCoverage,
  harvestCoverage,
  hasDuplicateItems,
  isMultipleOf,
  jsonEqual,
  makeRecordPredicate,
  rootCursor,
  type FormatTable,
  type FragmentOptions,
  type JsonValue,
  type AnnotationSelection,
  type SchemaRef,
  type SchemaRegistry,
  type RegexCache,
} from "@jse/core";

/** True for JSON objects (not arrays, not null). */
export const isObject = (v: unknown): v is Record<string, JsonValue> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** `n` is an integer-valued JSON number. */
export const isInteger = (v: unknown): boolean =>
  typeof v === "number" && Number.isInteger(v);

/**
 * The application(s) that raised one recorded unit: one node, or the nodes
 * sharing a path node inside a traced island (a segment-less custom apply
 * shares its parent's, as core's own adapter attributes it).
 */
export type NodeRef = MutableRenderNode | MutableRenderNode[];

/** A node's parent as emitted code sees it: the holder or another node. */
export interface NodeParent {
  children: MutableRenderNode[];
}

/**
 * Per-evaluation state of a trace artifact: the flat channels paired with
 * the application that raised each unit, and the tree under its holder.
 * Emitted code fills it; {@link finishTrace} turns it into renderer input.
 */
export interface TraceState {
  valid: boolean;
  errs: ErrorUnit[];
  errNodes: NodeRef[];
  /**
   * The errors an accepting keyword made irrelevant, in drop order (the
   * interpreter's `dropErrorsFrom` order). Filled only by a retaining
   * artifact; the relevant level discards at the cut.
   */
  droppedErrs: ErrorUnit[];
  droppedErrNodes: NodeRef[];
  anns: AnnotationUnit[];
  annNodes: NodeRef[];
  /**
   * Indexes into `anns` of the annotations a failed application made
   * irrelevant. A retaining artifact keeps every annotation in `anns` in
   * recording order and its cuts flag here instead of truncating, so the
   * dropped side renders in that order too; null on the relevant level.
   */
  annDropped: Set<number> | null;
  /** the root's parent: `hold.children[0]` is the root application */
  hold: NodeParent;
}

/**
 * Attributes every unit to its application and applies the selection's
 * `keep` predicate, yielding the flat surface and the tree. With `retain`
 * the irrelevant records a retaining artifact kept aside are rendered as
 * the dropped pair; without it they are left out, so a verbose artifact
 * serves a relevant-level demand exactly. An invalid run has no relevant
 * annotations (draft-03 §12.2): every one it recorded is a dropped one.
 */
export function finishTrace(
  st: TraceState,
  keep: ((unit: AnnotationUnit) => boolean) | undefined,
  retain: boolean,
): { units: ResultUnits; root: MutableRenderNode } {
  const attribute = (
    ref: NodeRef,
    list: "errors" | "droppedErrors" | "annotations" | "droppedAnnotations",
    index: number,
  ): void => {
    if (Array.isArray(ref)) for (const node of ref) node[list].push(index);
    else ref[list].push(index);
  };
  st.errs.forEach((_, i) => {
    attribute(st.errNodes[i]!, "errors", i);
  });
  const droppedErrors = retain ? st.droppedErrs : [];
  droppedErrors.forEach((_, i) => {
    attribute(st.droppedErrNodes[i]!, "droppedErrors", i);
  });
  const annotations: AnnotationUnit[] = [];
  const droppedAnnotations: AnnotationUnit[] = [];
  const flagged = st.annDropped;
  st.anns.forEach((unit, i) => {
    const irrelevant = !st.valid || flagged?.has(i) === true;
    if (irrelevant && !retain) return;
    // `keep` sees relevant and dropped units alike, as the interpreter's
    // selection does.
    if (keep !== undefined && !keep(unit)) return;
    if (irrelevant) {
      attribute(
        st.annNodes[i]!,
        "droppedAnnotations",
        droppedAnnotations.length,
      );
      droppedAnnotations.push(unit);
    } else {
      attribute(st.annNodes[i]!, "annotations", annotations.length);
      annotations.push(unit);
    }
  });
  return {
    units: {
      errors: st.errs,
      droppedErrors,
      annotations,
      droppedAnnotations,
    },
    root: st.hold.children[0]!,
  };
}

/**
 * The closure passed to every compiled unit function: shared helpers, the
 * regex table (pattern source → compiled RegExp, via the engine's cache),
 * and the interpreter trampoline for islands and fallbacks.
 */
export interface Runtime {
  readonly isObject: typeof isObject;
  readonly isInteger: typeof isInteger;
  readonly jsonEqual: typeof jsonEqual;
  readonly canonicalKey: typeof canonicalKey;
  readonly codePointLength: typeof codePointLength;
  readonly escapeSegment: typeof escapeSegment;
  readonly isMultipleOf: typeof isMultipleOf;
  readonly hasDuplicateItems: typeof hasDuplicateItems;
  readonly firstDuplicatePair: typeof firstDuplicatePair;
  /** compiled-consumer coverage folds (COMPILED-CONSUMERS.md phase B) */
  readonly foldNameCoverage: typeof foldNameCoverage;
  readonly foldIndexCoverage: typeof foldIndexCoverage;
  /** compiled RegExp by pattern source */
  readonly re: Record<string, { test(s: string): boolean }>;
  /** asserting-format definitions by name (the engine's format table, filtered) */
  readonly formats: Record<string, { test(v: JsonValue): boolean }>;
  /** the artifact's depth bound (D20), shared with trampolined fragments */
  readonly maxDepth: number;
  /** throws the typed depth error a compiled unit's guard trips (D20) */
  tooDeep(): never;
  /**
   * Trampoline into the interpreter for one island/fallback fragment,
   * charging `depth` against the shared budget (D20). Flag-mode callers use
   * only `.valid`.
   */
  frag(
    target: SchemaRef,
    value: JsonValue,
    scope: readonly string[],
    depth: number,
  ): boolean;
  /**
   * Coverage-harvesting trampoline (COMPILED-CONSUMERS.md phase B, §5): like
   * {@link frag} for an island applied IN-PLACE under a compiled consumer,
   * but the island's surviving root-cursor consumed dependency records are
   * folded into the parent's runtime coverage channel `ev`. Consumed ids are
   * always recorded (the M5.5 invariant), so an island always reports the
   * coverage a consumer would observe. A failed island's root records are
   * empty; the caller's mark/truncate is the uniform backstop either way.
   */
  fragCov(
    target: SchemaRef,
    value: JsonValue,
    scope: readonly string[],
    depth: number,
    ev: unknown[],
  ): boolean;
  /**
   * List-mode trampoline: evaluates the fragment with the caller's
   * evaluation-path prefix, maps its error records to interpreter-exact
   * units (instance locations re-rooted under `ip`), and appends them.
   * `ev` (an island applied IN-PLACE from a tracked consumer's region body)
   * additionally receives the {@link Runtime.fragCov} coverage harvest — the
   * error mapping is unconditional either way, because a failed in-place
   * island's ERRORS survive in list output (only its coverage span, which is
   * empty on failure anyway, is the caller's truncate concern).
   */
  fragList(
    target: SchemaRef,
    value: JsonValue,
    scope: readonly string[],
    depth: number,
    ep: string,
    ip: string,
    errs: ErrorUnit[],
    ev?: unknown[],
  ): boolean;
  /**
   * Annotation-mode list trampoline: like {@link fragList} for errors, then
   * harvests the island's surviving root annotation records as annotation
   * units (retention lists applied, instance locations re-rooted under `ip`)
   * onto `anns`. `ev` composes exactly as on {@link Runtime.fragList}.
   * Present only on annotation-mode artifacts.
   */
  fragListAnn?(
    target: SchemaRef,
    value: JsonValue,
    scope: readonly string[],
    depth: number,
    ep: string,
    ip: string,
    errs: ErrorUnit[],
    anns: AnnotationUnit[],
    ev?: unknown[],
  ): boolean;
  /** Trace emission: a fresh per-evaluation state. Present only on trace artifacts. */
  traceState?(): TraceState;
  /** Trace emission: the node of one application, linked under its parent. */
  traceNode?(
    tp: NodeParent,
    ep: string,
    sloc: string,
    ip: string,
  ): MutableRenderNode;
  /** Trace emission: an error unit with the application that raised it. */
  traceError?(st: TraceState, tn: MutableRenderNode, unit: ErrorUnit): void;
  /** Trace emission: an annotation unit with the application that raised it. */
  traceAnn?(st: TraceState, tn: MutableRenderNode, unit: AnnotationUnit): void;
  /**
   * Trace emission: an accepting keyword's cut of the errors since mark
   * `m`. The emitted source is level-neutral; the artifact's level decides
   * here whether the cut discards them or moves them aside as dropped.
   */
  cutErrors?(st: TraceState, m: number): void;
  /**
   * Trace emission: a failed application's cut of the annotations since
   * mark `m` — discarded, or flagged as dropped, by the artifact's level.
   */
  cutAnns?(st: TraceState, m: number): void;
  /**
   * Trace emission's island trampoline: the fragment runs traced, its
   * subtree is grafted under the calling application, and its records join
   * the channels attributed to the fragment nodes that raised them — on a
   * retaining artifact, the fragment's own dropped records included. `ev`
   * composes as on {@link Runtime.fragList}.
   */
  fragTrace?(
    target: SchemaRef,
    value: JsonValue,
    scope: readonly string[],
    depth: number,
    ep: string,
    ip: string,
    st: TraceState,
    tp: NodeParent,
    ev?: unknown[],
  ): boolean;
}

/**
 * Builds the {@link Runtime} closure for an artifact bound to one registry.
 * `retain` selects the verbose level's trace helpers: the relevance cuts
 * keep the irrelevant records aside instead of discarding them.
 */
export function makeRuntime(
  registry: SchemaRegistry,
  regexCache: RegexCache,
  patterns: readonly string[],
  maxDepth: number,
  listParams = false,
  annotate?: { selection?: boolean | AnnotationSelection },
  formatTable?: FormatTable,
  usedFormats: readonly string[] = [],
  trace = false,
  retain = false,
): Runtime {
  const re = Object.create(null) as Record<
    string,
    { test(s: string): boolean }
  >;
  for (const source of patterns) re[source] = regexCache.compile(source);
  // Filter the engine's format table down to the names the artifact tests,
  // exactly as `re` narrows the pattern cache. A used name with no backing
  // definition is unreachable via public paths (the constructor rejects
  // assertFormats without a table, and lower() only emits formatTest for
  // table-present names), so a miss here is a compiler bug — fail loudly.
  const formats = Object.create(null) as Record<
    string,
    { test(v: JsonValue): boolean }
  >;
  for (const name of usedFormats) {
    const definition = formatTable?.[name];
    if (definition === undefined) {
      throw new TypeError(
        `compiled artifact tests format '${name}' with no table definition`,
      );
    }
    formats[name] = definition;
  }
  // Flag-mode annotation elision: no annotation is ever rendered. Dependency
  // records for consumed behavior ids still record (M5.5 invariant, enforced
  // by the engine's produce()), so unevaluated* inside fragments sees its
  // channel.
  const shouldRecord = makeRecordPredicate(false);
  // Captured once: the coverage producers a consumer would observe, for the
  // coverage harvests (COMPILED-CONSUMERS.md §5).
  const coverageIds = registry.coverageIds();
  // Annotation harvest predicate (built once): an island records exactly the
  // annotations the selection's lists keep. `keep` runs later in the wrapper.
  const annRecord = annotate
    ? makeRecordPredicate(annotate.selection ?? true)
    : null;
  return {
    isObject,
    isInteger,
    jsonEqual,
    canonicalKey,
    codePointLength,
    escapeSegment,
    isMultipleOf,
    hasDuplicateItems,
    firstDuplicatePair,
    foldNameCoverage,
    foldIndexCoverage,
    re,
    formats,
    maxDepth,
    tooDeep: () => {
      throw new MaxDepthExceededError(
        `compiled evaluation exceeds maxDepth (${maxDepth})`,
      );
    },
    frag: (target, value, scope, depth) => {
      const options: FragmentOptions = {
        dynamicScope: scope,
        depth,
        regexCache,
        maxDepth,
        shouldRecord,
      };
      return evaluateFragment(registry, target, rootCursor(value), options)
        .valid;
    },
    fragCov: (target, value, scope, depth, ev) => {
      // The SAME cursor object must reach harvestCoverage: it filters root
      // records by cursor identity (coverage.ts), so a second rootCursor()
      // would match nothing.
      const cursor = rootCursor(value);
      const options: FragmentOptions = {
        dynamicScope: scope,
        depth,
        regexCache,
        maxDepth,
        shouldRecord,
      };
      const result = evaluateFragment(registry, target, cursor, options);
      ev.push(...harvestCoverage(result.dependencies, cursor, coverageIds));
      return result.valid;
    },
    fragList: (target, value, scope, depth, ep, ip, errs, ev) => {
      // One synthetic pre-escaped PathNode segment reproduces the caller's
      // whole evaluation-path prefix (materializePath joins on "/").
      const pathNode: PathNode | null =
        ep === "" ? null : { parent: null, segment: ep.slice(1) };
      // The SAME cursor object must reach harvestCoverage (see fragCov).
      const cursor = rootCursor(value);
      const options: FragmentOptions = {
        dynamicScope: scope,
        depth,
        regexCache,
        maxDepth,
        shouldRecord,
        pathNode,
      };
      const result = evaluateFragment(registry, target, cursor, options);
      for (const record of result.errors) {
        const unit = renderError(record, listParams);
        unit.inputLocation = ip + unit.inputLocation;
        errs.push(unit);
      }
      if (ev !== undefined) {
        ev.push(...harvestCoverage(result.dependencies, cursor, coverageIds));
      }
      return result.valid;
    },
    ...(annotate
      ? {
          fragListAnn: (
            target,
            value,
            scope,
            depth,
            ep,
            ip,
            errs,
            anns,
            ev,
          ) => {
            const pathNode: PathNode | null =
              ep === "" ? null : { parent: null, segment: ep.slice(1) };
            // The SAME cursor object must reach harvestCoverage (see fragCov).
            const cursor = rootCursor(value);
            const options: FragmentOptions = {
              dynamicScope: scope,
              depth,
              regexCache,
              maxDepth,
              shouldRecord: annRecord,
              pathNode,
            };
            const result = evaluateFragment(registry, target, cursor, options);
            for (const record of result.errors) {
              const unit = renderError(record, listParams);
              unit.inputLocation = ip + unit.inputLocation;
              errs.push(unit);
            }
            for (const a of result.annotations) {
              const unit = renderAnnotation(a);
              unit.inputLocation = ip + unit.inputLocation;
              anns.push(unit);
            }
            if (ev !== undefined) {
              ev.push(
                ...harvestCoverage(result.dependencies, cursor, coverageIds),
              );
            }
            return result.valid;
          },
        }
      : {}),
    ...(trace ? traceHelpers(retain) : {}),
  };

  function traceHelpers(
    retain: boolean,
  ): Pick<
    Runtime,
    | "traceState"
    | "traceNode"
    | "traceError"
    | "traceAnn"
    | "cutErrors"
    | "cutAnns"
    | "fragTrace"
  > {
    return {
      traceState: () => ({
        valid: true,
        errs: [],
        errNodes: [],
        droppedErrs: [],
        droppedErrNodes: [],
        anns: [],
        annNodes: [],
        annDropped: retain ? new Set() : null,
        hold: { children: [] },
      }),
      traceNode: (tp, ep, sloc, ip) => {
        const node: MutableRenderNode = {
          evaluationPath: ep,
          schemaLocation: sloc,
          inputLocation: ip,
          valid: true,
          keywords: [],
          errors: [],
          droppedErrors: [],
          annotations: [],
          droppedAnnotations: [],
          children: [],
        };
        tp.children.push(node);
        return node;
      },
      traceError: (st, tn, unit) => {
        st.errs.push(unit);
        st.errNodes.push(tn);
      },
      traceAnn: (st, tn, unit) => {
        st.anns.push(unit);
        st.annNodes.push(tn);
      },
      // The relevant level discards what an accepting keyword or a failed
      // application made irrelevant, exactly as list mode truncates. The
      // verbose level keeps it: dropped errors move aside in drop order
      // (the interpreter's `dropErrorsFrom`); dropped annotations stay in
      // place, flagged, so the marks that later cuts take remain positions
      // in the one recording-ordered channel.
      cutErrors: retain
        ? (st, m) => {
            const { errs, errNodes } = st;
            for (let i = m; i < errs.length; i++) {
              st.droppedErrs.push(errs[i]!);
              st.droppedErrNodes.push(errNodes[i]!);
            }
            errs.length = m;
            errNodes.length = m;
          }
        : (st, m) => {
            st.errs.length = m;
            st.errNodes.length = m;
          },
      cutAnns: retain
        ? (st, m) => {
            const flagged = st.annDropped!;
            for (let i = m; i < st.anns.length; i++) flagged.add(i);
          }
        : (st, m) => {
            st.anns.length = m;
            st.annNodes.length = m;
          },
      fragTrace: (target, value, scope, depth, ep, ip, st, tp, ev) => {
        const pathNode: PathNode | null =
          ep === "" ? null : { parent: null, segment: ep.slice(1) };
        // The SAME cursor object must reach harvestCoverage (see fragCov).
        const cursor = rootCursor(value);
        const options: FragmentOptions = {
          dynamicScope: scope,
          depth,
          regexCache,
          maxDepth,
          shouldRecord: annRecord ?? shouldRecord,
          pathNode,
          tracing: true,
        };
        const result = evaluateFragment(registry, target, cursor, options);
        // The fragment's tree hangs under the calling application whether or
        // not it passed: the interpreter keeps failed applications too.
        const { root, at } = traceToRenderNodes(result.traceRoot!, ip);
        tp.children.push(root);
        const owner = (node: PathNode | null): NodeRef => {
          const nodes = at.get(node)!;
          return nodes.length === 1 ? nodes[0]! : nodes;
        };
        for (const record of result.errors) {
          const unit = renderError(record, listParams);
          unit.inputLocation = ip + unit.inputLocation;
          st.errs.push(unit);
          st.errNodes.push(owner(record.pathNode));
        }
        if (retain) {
          // The fragment ran to completion between two compiled cuts, so
          // appending its drops here keeps the whole run's drop order.
          for (const record of result.droppedErrors) {
            const unit = renderError(record, listParams);
            unit.inputLocation = ip + unit.inputLocation;
            st.droppedErrs.push(unit);
            st.droppedErrNodes.push(owner(record.pathNode));
          }
          // Every annotation the fragment recorded, in recording order;
          // those outside its root frame's survivors are dropped — all of
          // them when the fragment failed, since a failed application's
          // frame is discarded whole.
          const relevant = result.valid ? new Set(result.annotations) : null;
          for (const a of result.allAnnotations) {
            const unit = renderAnnotation(a);
            unit.inputLocation = ip + unit.inputLocation;
            if (!relevant?.has(a)) {
              st.annDropped!.add(st.anns.length);
            }
            st.anns.push(unit);
            st.annNodes.push(owner(a.pathNode));
          }
        } else {
          for (const a of result.annotations) {
            const unit = renderAnnotation(a);
            unit.inputLocation = ip + unit.inputLocation;
            st.anns.push(unit);
            st.annNodes.push(owner(a.pathNode));
          }
        }
        if (ev !== undefined) {
          ev.push(...harvestCoverage(result.dependencies, cursor, coverageIds));
        }
        return result.valid;
      },
    };
  }
}
