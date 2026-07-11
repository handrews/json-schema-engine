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
   * List-mode trampoline: evaluates the fragment with the caller's
   * evaluation-path prefix, maps its error records to interpreter-exact
   * units (instance locations re-rooted under `ip`), and appends them.
   */
  fragList(
    target: SchemaRef,
    value: JsonValue,
    scope: readonly string[],
    depth: number,
    ep: string,
    ip: string,
    errs: ErrorUnit[],
  ): boolean;
  /**
   * Annotation-mode list trampoline: like {@link fragList} for errors, then
   * harvests the island's surviving root productions as annotation units
   * (retention lists applied, instance locations re-rooted under `ip`) onto
   * `anns`. Present only on annotation-mode artifacts.
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
    fragList: (target, value, scope, depth, ep, ip, errs) => {
      // One synthetic pre-escaped PathNode segment reproduces the caller's
      // whole evaluation-path prefix (materializePath joins on "/").
      const pathNode: PathNode | null =
        ep === "" ? null : { parent: null, segment: ep.slice(1) };
      const options: FragmentOptions = {
        dynamicScope: scope,
        depth,
        regexCache,
        maxDepth,
        shouldRecord,
        pathNode,
      };
      const result = evaluateFragment(
        registry,
        target,
        rootCursor(value),
        options,
      );
      for (const record of result.errors) {
        const unit = renderError(record, "modern", listParams);
        unit.instanceLocation = ip + unit.instanceLocation;
        errs.push(unit);
      }
      return result.valid;
    },
    ...(annotate
      ? {
          fragListAnn: (target, value, scope, depth, ep, ip, errs, anns) => {
            const pathNode: PathNode | null =
              ep === "" ? null : { parent: null, segment: ep.slice(1) };
            const options: FragmentOptions = {
              dynamicScope: scope,
              depth,
              regexCache,
              maxDepth,
              shouldRecord: annRecord,
              pathNode,
            };
            const result = evaluateFragment(
              registry,
              target,
              rootCursor(value),
              options,
            );
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
            return result.valid;
          },
        }
      : {}),
  };
}
