// Evaluation engine: frame-scoped record channel (DESIGN.md §4, normative),
// evaluation-path tracking with lazy string materialization, cycle guard,
// annotation retention.
//
// Channel rules implemented here and nowhere else:
//  1. each schema application pushes a frame;
//  2. annotate() appends an annotation record (the keyword's own value) and
//     produce() a dependency record (computed data for other keywords) to
//     the current frame;
//  3. on success the frame merges into its parent, on failure it is
//     discarded;
//  4. visibility = the current frame's dependency records filtered by
//     cursor identity;
//  5. the annotation result is the root frame's annotation records filtered
//     by the annotation selection; selection never affects rule 4;
//  6. relevance (draft-03 §12.2): a keyword that accepts makes the errors of
//     its rejecting sub-evaluations irrelevant — evaluateKeyword drops them
//     (kept aside only when tracing, for verbose output); rule 3 is the same
//     transition for a rejecting schema object's accepting sub-evaluations.

import { JsonValue, isObject, escapeSegment } from "./json.js";
import { resolveUri, splitFragment } from "./uri.js";
import { Cursor, rootCursor } from "./cursor.js";
import { SchemaRef } from "./ref.js";
import {
  DependencyView,
  Dialect,
  DialectKeyword,
  ErrorParams,
  KeywordContext,
  unknownKeywordId,
} from "./dialect.js";
import {
  DEFAULT_MAX_DEPTH,
  InvalidSchemaError,
  MaxDepthExceededError,
  SchemaRegistry,
  describeNonSchema,
} from "./registry.js";
import { CompiledRegex, RegexCache } from "./regex.js";

/** Thrown when a schema is re-entered at the same instance location (D8/cycle guard). */
export class InfiniteLoopError extends Error {}
/** Thrown when a dialect disallows unknown keywords and one is present. */
export class UnknownKeywordError extends Error {}
/** Thrown when a keyword reads a dependency behavior id it never declared via `analyze().consumes`. */
export class UndeclaredConsumptionError extends Error {}
/** Thrown when a keyword produces dependency data without declaring its own id via `analyze().produces`. */
export class UndeclaredProductionError extends Error {}
/** Thrown when a keyword reports an error through `ctx.error()` yet accepts the input. */
export class KeywordContractError extends Error {}

/**
 * Annotation elision (D5/M5.5): when set, an annotation record is recorded
 * only if this returns true, and dependency records are recorded only for
 * behavior ids some registered keyword consumes. Applies at every output
 * level: a deselected keyword's annotation is never rendered, relevant or
 * not.
 */
export type RecordPredicate = (
  behaviorId: string,
  keywordName: string,
  vocabularyUri: string | null,
) => boolean;

/**
 * Evaluation-path node: one pre-escaped segment, parent-linked, materialized
 * only when a unit escapes to output.
 */
export interface PathNode {
  readonly parent: PathNode | null;
  readonly segment: string;
}

/** Materializes a path node chain into its JSON Pointer string. */
export function materializePath(node: PathNode | null): string {
  let s = "";
  for (let n = node; n !== null; n = n.parent) s = "/" + n.segment + s;
  return s;
}

/**
 * An annotation (DESIGN.md §4): application-facing output whose value is
 * the keyword's own value (draft-03 §12.9). The only record kind renderers
 * accept.
 */
export interface AnnotationRecord {
  readonly kind: "annotation";
  behaviorId: string;
  keywordName: string;
  /** `null` for unknown keywords. */
  vocabularyUri: string | null;
  schemaRef: SchemaRef;
  /** Path of the schema object; the keyword segment is appended on render. */
  pathNode: PathNode | null;
  cursor: Cursor;
  value: unknown;
}

/**
 * Dependency information (DESIGN.md §4; draft-03 Appendix D): computed data
 * one keyword communicates to another through the channel. Never rendered.
 */
export interface DependencyRecord {
  readonly kind: "dependency";
  behaviorId: string;
  keywordName: string;
  schemaRef: SchemaRef;
  /** Path of the schema object the producing keyword belongs to. */
  pathNode: PathNode | null;
  cursor: Cursor;
  data: unknown;
}

/** One assertion failure. */
export interface ErrorRecord {
  /** `null` when the schema itself failed (boolean `false`). */
  keywordName: string | null;
  /** `null` when the schema itself failed (boolean `false`). */
  vocabularyUri: string | null;
  schemaRef: SchemaRef;
  pathNode: PathNode | null;
  cursor: Cursor;
  message: string;
  params?: ErrorParams;
}

// Appends with a loop: an argument spread puts every element on the native
// stack, so `dst.push(...src)` throws past ~120k elements — a ceiling a wide
// instance reaches long before maxDepth does.
function appendAll<T>(dst: T[], src: readonly T[]): void {
  for (const x of src) dst.push(x);
}

/** One channel frame: the records of an in-flight schema application. */
export interface Frame {
  annotations: AnnotationRecord[];
  dependencies: DependencyRecord[];
}

/** One keyword evaluation within a traced schema application. */
export interface KeywordTrace {
  name: string;
  valid: boolean;
}

/**
 * One schema application, recorded only when tracing (structured outputs):
 * the structured renderers need application boundaries, per-branch
 * validity, and each keyword's verdict in evaluation order (draft-03 Verbose
 * renders one node per keyword), which the flat error list cannot
 * reconstruct.
 */
export interface TraceNode {
  schemaRef: SchemaRef;
  pathNode: PathNode | null;
  cursor: Cursor;
  valid: boolean;
  /** keyword evaluations of this application, in order (structural keywords excluded) */
  keywords: KeywordTrace[];
  children: TraceNode[];
}

/** Mutable state for one evaluation run: frames, errors, dynamic scope, and tracing. */
export class EvalState {
  frames: Frame[] = [{ annotations: [], dependencies: [] }];
  /** Relevant errors, in encounter order (rule 6). */
  errors: ErrorRecord[] = [];
  // Errors made irrelevant by an accepting ancestor keyword (rule 6), kept
  // only when tracing so verbose output can show them.
  droppedErrors: ErrorRecord[] | null = null;
  // Dynamic scope (D8): resources entered by schema application, outermost
  // first. Duplicates are fine — resolution takes the first (outermost) hit.
  dynamicScope: string[] = [];
  // Tracing (opt-in, zero cost when off): every application as a tree, and
  // every record regardless of frame discard — failed-branch annotations
  // surface as droppedAnnotations in verbose outputs; dependency records are
  // kept for diagnostics and never rendered.
  traceRoot: TraceNode | null = null;
  allAnnotations: AnnotationRecord[] | null = null;
  allDependencies: DependencyRecord[] | null = null;
  // Active schema-application nesting, bounded by maxDepth (see applySchema).
  depth = 0;
  private traceStack: TraceNode[] = [];
  private active = new Map<Cursor, Set<string>>();

  constructor(
    public registry: SchemaRegistry,
    tracing = false,
    public shouldRecord: RecordPredicate | null = null,
    public regexCache: RegexCache = new RegexCache(),
    public maxDepth: number = DEFAULT_MAX_DEPTH,
  ) {
    if (tracing) {
      this.allAnnotations = [];
      this.allDependencies = [];
      this.droppedErrors = [];
    }
  }

  /** True when tracing is active for this run. */
  get tracing(): boolean {
    return this.allAnnotations !== null;
  }

  /** Removes the errors pushed since `mark`: rejecting sub-evaluations of a keyword that accepted (rule 6). */
  dropErrorsFrom(mark: number): void {
    const dropped = this.errors.splice(mark);
    if (this.droppedErrors !== null) appendAll(this.droppedErrors, dropped);
  }

  /** Opens a trace node for a schema application and links it under the current one. */
  traceEnter(
    schemaRef: SchemaRef,
    pathNode: PathNode | null,
    cursor: Cursor,
  ): TraceNode {
    const node: TraceNode = {
      schemaRef,
      pathNode,
      cursor,
      valid: true,
      keywords: [],
      children: [],
    };
    const parent = this.traceStack[this.traceStack.length - 1];
    if (parent) parent.children.push(node);
    else this.traceRoot = node;
    this.traceStack.push(node);
    return node;
  }

  /** Closes the current trace node with its final validity. */
  traceExit(node: TraceNode, valid: boolean): void {
    node.valid = valid;
    this.traceStack.pop();
  }

  /** Records one keyword evaluation's verdict on the current trace node. */
  traceKeyword(name: string, valid: boolean): void {
    this.traceStack[this.traceStack.length - 1]?.keywords.push({ name, valid });
  }

  /** The innermost open frame. */
  get frame(): Frame {
    return this.frames[this.frames.length - 1]!;
  }
  /** Annotations surviving at the root frame — the annotation result before retention filtering. */
  get rootAnnotations(): AnnotationRecord[] {
    return this.frames[0]!.annotations;
  }
  /** Dependency records surviving at the root frame. */
  get rootDependencies(): DependencyRecord[] {
    return this.frames[0]!.dependencies;
  }

  /**
   * Records entry into a schema application for cycle detection.
   * @throws InfiniteLoopError if this schema is already active at this cursor.
   */
  enter(schemaRef: SchemaRef, cursor: Cursor): void {
    const key = `${schemaRef.baseUri}#${schemaRef.pointer}`;
    let keys = this.active.get(cursor);
    if (keys === undefined) {
      keys = new Set();
      this.active.set(cursor, keys);
    } else if (keys.has(key)) {
      throw new InfiniteLoopError(
        `schema '${key}' re-entered at the same instance location`,
      );
    }
    keys.add(key);
  }

  /** Records exit from a schema application, releasing its cycle-detection entry. */
  exit(schemaRef: SchemaRef, cursor: Cursor): void {
    const keys = this.active.get(cursor)!;
    keys.delete(`${schemaRef.baseUri}#${schemaRef.pointer}`);
    if (keys.size === 0) this.active.delete(cursor);
  }
}

class KeywordContextImpl implements KeywordContext {
  /** Set once this keyword reports an error of its own (the contract check in evaluateKeyword). */
  reported = false;

  constructor(
    private state: EvalState,
    private schemaRef: SchemaRef,
    private entry: {
      name: string;
      behaviorId: string;
      vocabularyUri: string | null;
      value: JsonValue;
    },
    public cursor: Cursor,
    private pathNode: PathNode | null,
  ) {}

  get schema(): Record<string, JsonValue> {
    return this.schemaRef.node as Record<string, JsonValue>;
  }

  apply(segments: readonly (string | number)[], cursor: Cursor): boolean {
    const child = this.state.registry.child(this.schemaRef, segments);
    let pathNode = this.pathNode;
    for (const seg of segments) {
      pathNode = { parent: pathNode, segment: escapeSegment(String(seg)) };
    }
    return applySchema(this.state, child, cursor, pathNode);
  }

  resolveRef(ref: string): SchemaRef {
    return this.state.registry.resolveRef(ref, this.schemaRef.baseUri);
  }

  resolveDynamic(ref: string): SchemaRef {
    const registry = this.state.registry;
    // Lexical resolution first (spec: the initial target must exist); the
    // rebinding below only applies to plain-name fragments minted by a
    // dynamic anchor — pointer fragments behave exactly like $ref.
    const target = registry.resolveRef(ref, this.schemaRef.baseUri);
    const { resource, fragment } = splitFragment(
      resolveUri(ref, this.schemaRef.baseUri),
    );
    if (fragment === null || fragment === "" || fragment.startsWith("/"))
      return target;
    if (registry.dynamicAnchor(resource, fragment) === undefined) return target;
    for (const scopeUri of this.state.dynamicScope) {
      const hit = registry.dynamicAnchor(scopeUri, fragment);
      if (hit !== undefined) return hit;
    }
    return target;
  }

  resolveRecursive(ref: string): SchemaRef {
    const registry = this.state.registry;
    // 2019-09: the reference is "#"; anything with a non-empty fragment
    // behaves like $ref. Rebinding is all-or-nothing on the root-level
    // $recursiveAnchor flag rather than a named anchor.
    const target = registry.resolveRef(ref, this.schemaRef.baseUri);
    const { resource, fragment } = splitFragment(
      resolveUri(ref, this.schemaRef.baseUri),
    );
    if (fragment !== null && fragment !== "") return target;
    if (!registry.hasRecursiveRoot(resource)) return target;
    for (const scopeUri of this.state.dynamicScope) {
      if (registry.hasRecursiveRoot(scopeUri))
        return registry.rootRef(scopeUri);
    }
    return target;
  }

  applyResolved(target: SchemaRef): boolean {
    const pathNode = {
      parent: this.pathNode,
      segment: escapeSegment(this.entry.name),
    };
    return applySchema(this.state, target, this.cursor, pathNode);
  }

  compileRegex(pattern: string): CompiledRegex {
    return this.state.regexCache.compile(pattern);
  }

  annotate(): void {
    const record = this.state.shouldRecord;
    if (
      record &&
      !record(this.entry.behaviorId, this.entry.name, this.entry.vocabularyUri)
    ) {
      return;
    }
    const annotation: AnnotationRecord = {
      kind: "annotation",
      behaviorId: this.entry.behaviorId,
      keywordName: this.entry.name,
      vocabularyUri: this.entry.vocabularyUri,
      schemaRef: this.schemaRef,
      pathNode: this.pathNode,
      cursor: this.cursor,
      value: this.entry.value,
    };
    this.state.frame.annotations.push(annotation);
    // Frames discard on failure; the trace keeps everything so verbose
    // outputs can report droppedAnnotations.
    this.state.allAnnotations?.push(annotation);
  }

  produce(data: unknown): void {
    // A producer nobody declared is invisible to elision analysis and to the
    // compiler's channel routing — fail loud, not wrong. The check is per
    // behavior id: the registry unions every occurrence's declarations.
    const registry = this.state.registry;
    if (!registry.producedIds().has(this.entry.behaviorId)) {
      throw new UndeclaredProductionError(
        `'${this.entry.behaviorId}' produces dependency data without declaring it in analyze().produces`,
      );
    }
    // Under elision, dependency data nobody consumes is never read.
    if (
      this.state.shouldRecord !== null &&
      !registry.consumedIds().has(this.entry.behaviorId)
    ) {
      return;
    }
    const dependency: DependencyRecord = {
      kind: "dependency",
      behaviorId: this.entry.behaviorId,
      keywordName: this.entry.name,
      schemaRef: this.schemaRef,
      pathNode: this.pathNode,
      cursor: this.cursor,
      data,
    };
    this.state.frame.dependencies.push(dependency);
    this.state.allDependencies?.push(dependency);
  }

  visible(
    behaviorIds: readonly string[],
    scope: "all" | "adjacent" = "all",
  ): readonly DependencyView[] {
    // Under elision, reading an id nobody declared via StaticFacts.consumes
    // means the records may already be gone — fail loud, not wrong.
    if (this.state.shouldRecord !== null) {
      const consumed = this.state.registry.consumedIds();
      for (const id of behaviorIds) {
        if (!consumed.has(id)) {
          throw new UndeclaredConsumptionError(
            `'${this.entry.behaviorId}' reads '${id}' without declaring it in analyze().consumes`,
          );
        }
      }
    }
    // Every keyword of one schema application shares its pathNode, so
    // identity picks out the adjacent keywords' records.
    return this.state.frame.dependencies.filter(
      (d) =>
        d.cursor === this.cursor &&
        behaviorIds.includes(d.behaviorId) &&
        (scope === "all" || d.pathNode === this.pathNode),
    );
  }

  error(message: string, params?: ErrorParams): void {
    this.reported = true;
    this.state.errors.push({
      keywordName: this.entry.name,
      vocabularyUri: this.entry.vocabularyUri,
      schemaRef: this.schemaRef,
      pathNode: this.pathNode,
      cursor: this.cursor,
      message,
      ...(params === undefined ? {} : { params }),
    });
  }
}

/**
 * Applies one schema to one instance cursor: pushes a frame, evaluates the
 * dialect's keywords in order, merges or discards the frame per DESIGN.md §4.
 * @throws InfiniteLoopError if the schema is already active at this cursor.
 * @throws UnknownKeywordError if the dialect disallows an unknown keyword present in the schema.
 */
export function applySchema(
  state: EvalState,
  schemaRef: SchemaRef,
  cursor: Cursor,
  pathNode: PathNode | null,
): boolean {
  if (state.depth >= state.maxDepth) {
    throw new MaxDepthExceededError(
      `schema application exceeds maxDepth (${state.maxDepth}) at ` +
        `'${schemaRef.baseUri}#${schemaRef.pointer}'`,
    );
  }
  state.depth++;
  try {
    return applySchemaAtDepth(state, schemaRef, cursor, pathNode);
  } finally {
    state.depth--;
  }
}

function applySchemaAtDepth(
  state: EvalState,
  schemaRef: SchemaRef,
  cursor: Cursor,
  pathNode: PathNode | null,
): boolean {
  const node = schemaRef.node;
  if (typeof node === "boolean") {
    if (!node) {
      state.errors.push({
        keywordName: null,
        vocabularyUri: null,
        schemaRef,
        pathNode,
        cursor,
        message: "schema is false",
      });
    }
    if (state.tracing) {
      state.traceExit(state.traceEnter(schemaRef, pathNode, cursor), node);
    }
    return node;
  }
  // Backstop for the registration walk's eager D19 check: a position the
  // walk never saw (e.g. a $ref whose pointer lands inside an unknown
  // keyword's value) still fails loud when applied, never silently passes.
  if (!isObject(node)) {
    throw new InvalidSchemaError(
      `non-schema value (${describeNonSchema(node)}) applied as a schema ` +
        `at '${schemaRef.baseUri}#${schemaRef.pointer}'`,
    );
  }

  const dialect: Dialect = state.registry.dialectFor(schemaRef.baseUri);

  // draft-07/06 (D18): a $ref makes every sibling keyword act as if absent.
  const refOnly = dialect.refIgnoresSiblings && Object.hasOwn(node, "$ref");

  state.enter(schemaRef, cursor);
  state.dynamicScope.push(schemaRef.baseUri);
  state.frames.push({ annotations: [], dependencies: [] });
  const traceNode = state.tracing
    ? state.traceEnter(schemaRef, pathNode, cursor)
    : null;
  let valid = true;
  try {
    for (const entry of dialect.ordered) {
      if (refOnly && entry.name !== "$ref") continue;
      if (!Object.hasOwn(node, entry.name)) continue;
      if (!evaluateKeyword(state, schemaRef, entry, cursor, pathNode))
        valid = false;
    }
    for (const name of Object.keys(node)) {
      if (refOnly) break;
      if (dialect.keywords.has(name)) continue;
      if (!dialect.allowUnknownKeywords) {
        throw new UnknownKeywordError(
          `dialect '${dialect.uri}' does not allow unknown keyword '${name}'`,
        );
      }
      // Unknown keywords are collected as annotations: the keyword's value is
      // the annotation value (spec SHOULD).
      const behaviorId = unknownKeywordId(name);
      if (state.tracing) state.traceKeyword(name, true);
      if (state.shouldRecord && !state.shouldRecord(behaviorId, name, null))
        continue;
      const annotation: AnnotationRecord = {
        kind: "annotation",
        behaviorId,
        keywordName: name,
        vocabularyUri: null,
        schemaRef,
        pathNode,
        cursor,
        value: node[name],
      };
      state.frame.annotations.push(annotation);
      state.allAnnotations?.push(annotation);
    }
  } finally {
    const frame = state.frames.pop()!;
    if (valid) {
      const parent = state.frame;
      appendAll(parent.annotations, frame.annotations);
      appendAll(parent.dependencies, frame.dependencies);
    }
    if (traceNode) state.traceExit(traceNode, valid);
    state.dynamicScope.pop();
    state.exit(schemaRef, cursor);
  }
  return valid;
}

function evaluateKeyword(
  state: EvalState,
  schemaRef: SchemaRef,
  entry: DialectKeyword,
  cursor: Cursor,
  pathNode: PathNode | null,
): boolean {
  const value = (schemaRef.node as Record<string, JsonValue>)[entry.name]!;
  const ctx = new KeywordContextImpl(
    state,
    schemaRef,
    {
      name: entry.name,
      behaviorId: entry.behavior.id,
      vocabularyUri: entry.vocabularyUri,
      value,
    },
    cursor,
    pathNode,
  );
  const mark = state.errors.length;
  const ok = entry.behavior.evaluate(value, cursor, ctx);
  if (ok) {
    // Rule 6 keys on the keyword's verdict, so a keyword that reports and
    // still accepts would have its own error silently dropped — fail loud.
    if (ctx.reported) {
      throw new KeywordContractError(
        `'${entry.behavior.id}' reported an error but accepted the input`,
      );
    }
    if (state.errors.length > mark) state.dropErrorsFrom(mark);
  }
  // Identifier and reserved-location keywords evaluate to nothing and appear
  // in no output unit (draft-03 §12.6, §12.10).
  if (state.tracing && entry.behavior.structural !== true) {
    state.traceKeyword(entry.name, ok);
  }
  return ok;
}

/** Evaluates an instance against a registered root schema, returning validity and final state. */
export function runEvaluation(
  registry: SchemaRegistry,
  schemaUri: string,
  instance: JsonValue,
  tracing = false,
  shouldRecord: RecordPredicate | null = null,
  regexCache: RegexCache = new RegexCache(),
  maxDepth: number = DEFAULT_MAX_DEPTH,
): { valid: boolean; state: EvalState } {
  const state = new EvalState(
    registry,
    tracing,
    shouldRecord,
    regexCache,
    maxDepth,
  );
  const valid = applyWithOverflowBackstop(
    state,
    registry.rootRef(schemaUri),
    rootCursor(instance),
    null,
    maxDepth,
  );
  return { valid, state };
}

// Backstop: if maxDepth is set above the runtime's own stack ceiling, a
// native overflow surfaces as a RangeError. Convert it to the same typed,
// catchable error so callers never face an uncatchable-by-type crash.
function applyWithOverflowBackstop(
  state: EvalState,
  target: SchemaRef,
  cursor: Cursor,
  pathNode: PathNode | null,
  maxDepth: number,
): boolean {
  try {
    return applySchema(state, target, cursor, pathNode);
  } catch (err) {
    if (err instanceof RangeError && /call stack/i.test(err.message)) {
      throw new MaxDepthExceededError(
        `evaluation exceeded the native call stack (maxDepth=${maxDepth}); ` +
          `reduce nesting or lower maxDepth`,
      );
    }
    throw err;
  }
}

/** Options for {@link evaluateFragment}: state pre-seeded by a compiled caller. */
export interface FragmentOptions {
  /** dynamic scope inherited from the caller's path, outermost first (D8) */
  dynamicScope?: readonly string[];
  /** evaluation-path prefix for output locations */
  pathNode?: PathNode | null;
  /** depth already consumed by the caller's nesting (D20 combined budget) */
  depth?: number;
  /** annotation elision predicate (D5); null records everything */
  shouldRecord?: RecordPredicate | null;
  regexCache?: RegexCache;
  maxDepth?: number;
  /**
   * Record the trace: every branch runs (a trace is verbose demand, ADR
   * 0003) and the irrelevant records are retained, so a compiled evaluator
   * can graft the fragment under its own located tree.
   */
  tracing?: boolean;
}

/**
 * Evaluates one schema fragment with pre-seeded state: the compiled tier's
 * trampoline into the interpreter (M6), used for dynamic islands and for
 * fallback units alike. Returns the fragment's verdict, its errors, and its
 * root frame's surviving annotation and dependency records — cursor
 * identities intact, so a compiled caller can merge them under channel rule
 * 3 and filter under rule 4 exactly as an interpreted parent would. With
 * `tracing`, also the trace and the retained irrelevant records.
 */
export function evaluateFragment(
  registry: SchemaRegistry,
  target: SchemaRef,
  cursor: Cursor,
  options: FragmentOptions = {},
): {
  valid: boolean;
  errors: ErrorRecord[];
  annotations: AnnotationRecord[];
  dependencies: DependencyRecord[];
  /** the fragment's application tree; null unless `tracing` */
  traceRoot: TraceNode | null;
  /** errors dropped by an accepting keyword, in drop order; empty unless `tracing` */
  droppedErrors: ErrorRecord[];
  /** every annotation recorded, relevant or not; empty unless `tracing` */
  allAnnotations: AnnotationRecord[];
} {
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const state = new EvalState(
    registry,
    options.tracing === true,
    options.shouldRecord ?? null,
    options.regexCache ?? new RegexCache(),
    maxDepth,
  );
  state.dynamicScope.push(...(options.dynamicScope ?? []));
  state.depth = options.depth ?? 0;
  const valid = applyWithOverflowBackstop(
    state,
    target,
    cursor,
    options.pathNode ?? null,
    maxDepth,
  );
  return {
    valid,
    errors: state.errors,
    annotations: state.rootAnnotations,
    dependencies: state.rootDependencies,
    traceRoot: state.traceRoot,
    droppedErrors: state.droppedErrors ?? [],
    allAnnotations: state.allAnnotations ?? [],
  };
}
