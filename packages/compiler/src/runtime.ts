// Runtime surface shared by every compiled artifact. Emitted code never
// re-implements a semantic: it calls these, which are core's own functions,
// so the compiled and interpreted tiers agree by construction (D9, M6).

import {
  MaxDepthExceededError,
  renderAnnotation,
  renderError,
  type AnnotationUnit,
  type ErrorUnit,
  type PathNode,
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
  type FragmentOptions,
  type JsonValue,
  type RetentionPolicy,
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
   * but the island's surviving root-cursor consumed productions are folded
   * into the parent's runtime coverage channel `ev`. `shouldRecord` already
   * records consumed ids (the M5.5 invariant), so an island always reports the
   * coverage a consumer would observe. A failed island's root productions are
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
   * harvests the island's surviving root productions as annotation units
   * (retention lists applied, instance locations re-rooted under `ip`) onto
   * `anns`. `ev` composes exactly as on {@link Runtime.fragList} — the
   * recording predicate here already includes every consumed id, so the
   * coverage harvest sees the same productions a consumer would. Present
   * only on annotation-mode artifacts.
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
}

/** Builds the {@link Runtime} closure for an artifact bound to one registry. */
export function makeRuntime(
  registry: SchemaRegistry,
  regexCache: RegexCache,
  patterns: readonly string[],
  maxDepth: number,
  listParams = false,
  annotate?: { retention?: RetentionPolicy },
): Runtime {
  const re = Object.create(null) as Record<
    string,
    { test(s: string): boolean }
  >;
  for (const source of patterns) re[source] = regexCache.compile(source);
  // Flag-mode elision predicate. NOT `() => false`: consumed behavior ids
  // must always record (M5.5 invariant) or unevaluated* inside fragments
  // would see an empty channel.
  const shouldRecord = makeRecordPredicate(
    registry.consumedIds(),
    false,
    undefined,
  );
  // Captured once: the behavior ids a consumer would observe, for fragCov's
  // coverage harvest (COMPILED-CONSUMERS.md §5).
  const consumedIds = registry.consumedIds();
  // Annotation harvest predicates (built once): an island records consumed
  // AND retainable productions so consumers inside it still see their
  // channel; the lists-only pass then drops consumed-only survivors, leaving
  // exactly what retention would keep. `keep` runs later in the wrapper.
  const retention = annotate?.retention;
  const annRecord = annotate
    ? makeRecordPredicate(registry.consumedIds(), true, retention)
    : null;
  const annLists = annotate
    ? makeRecordPredicate(new Set(), true, retention)
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
      // productions by cursor identity (coverage.ts), so a second rootCursor()
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
      ev.push(...harvestCoverage(result.productions, cursor, consumedIds));
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
        const unit = renderError(record, "modern", listParams);
        unit.instanceLocation = ip + unit.instanceLocation;
        errs.push(unit);
      }
      if (ev !== undefined) {
        ev.push(...harvestCoverage(result.productions, cursor, consumedIds));
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
              const unit = renderError(record, "modern", listParams);
              unit.instanceLocation = ip + unit.instanceLocation;
              errs.push(unit);
            }
            // Drop consumed-only productions the lists would not retain; the
            // island's own channel consumers already read them inside it.
            for (const p of result.productions) {
              if (!annLists!(p.behaviorId, p.keywordName, p.vocabularyUri))
                continue;
              const unit = renderAnnotation(p, "modern");
              unit.instanceLocation = ip + unit.instanceLocation;
              anns.push(unit);
            }
            if (ev !== undefined) {
              ev.push(
                ...harvestCoverage(result.productions, cursor, consumedIds),
              );
            }
            return result.valid;
          },
        }
      : {}),
  };
}
