// Evaluation engine: frame-scoped production channel (DESIGN.md §4,
// normative), evaluation-path tracking with lazy string materialization,
// cycle guard, retention policy.
//
// Channel rules implemented here and nowhere else:
//  1. each schema application pushes a frame;
//  2. produce() appends to the current frame;
//  3. on success the frame merges into its parent, on failure it is
//     discarded;
//  4. visibility = current frame filtered by cursor identity;
//  5. the annotation result is the root frame filtered by retention;
//     retention never affects rule 4.

import { JsonValue, isObject, escapeSegment } from "./json.js";
import { resolveUri, splitFragment } from "./uri.js";
import { Cursor, rootCursor } from "./cursor.js";
import { SchemaRef } from "./ref.js";
import {
  Dialect,
  DialectKeyword,
  ErrorParams,
  KeywordContext,
  ProductionView,
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
/** Thrown when a keyword reads a channel behavior id it never declared via `analyze().consumes`. */
export class UndeclaredConsumptionError extends Error {}

/**
 * Produce-time elision (D5/M5.5): when set, a production is recorded only if
 * this returns true. Correctness rests on two invariants: consumed behavior
 * ids (per registry-accumulated StaticFacts.consumes) always record, and the
 * predicate is never set while tracing (verbose output needs everything).
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

/** One channel production (DESIGN.md §4). */
export interface Production {
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

/** One assertion failure. */
export interface ErrorRecord {
  /** `null` when the schema itself failed (boolean `false`). */
  keywordName: string | null;
  schemaRef: SchemaRef;
  pathNode: PathNode | null;
  cursor: Cursor;
  message: string;
  params?: ErrorParams;
}

/** One channel frame: the productions of an in-flight schema application. */
export interface Frame {
  productions: Production[];
}

/**
 * One schema application, recorded only when tracing (M5 structured
 * outputs): hierarchical/verbose renderers need application boundaries and
 * per-branch validity, which the flat error list cannot reconstruct.
 */
export interface TraceNode {
  schemaRef: SchemaRef;
  pathNode: PathNode | null;
  cursor: Cursor;
  valid: boolean;
  children: TraceNode[];
}

/** Mutable state for one evaluation run: frames, errors, dynamic scope, and tracing. */
export class EvalState {
  frames: Frame[] = [{ productions: [] }];
  errors: ErrorRecord[] = [];
  // Dynamic scope (D8): resources entered by schema application, outermost
  // first. Duplicates are fine — resolution takes the first (outermost) hit.
  dynamicScope: string[] = [];
  // Tracing (opt-in, zero cost when off): every application as a tree, and
  // every production regardless of frame discard — failed-branch
  // productions surface as droppedAnnotations in verbose outputs.
  traceRoot: TraceNode | null = null;
  allProductions: Production[] | null = null;
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
    if (tracing) this.allProductions = [];
  }

  /** True when tracing is active for this run. */
  get tracing(): boolean {
    return this.allProductions !== null;
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

  /** The innermost open frame. */
  get frame(): Frame {
    return this.frames[this.frames.length - 1]!;
  }
  /** Productions retained at the root frame — the annotation result before retention filtering. */
  get rootProductions(): Production[] {
    return this.frames[0]!.productions;
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
  constructor(
    private state: EvalState,
    private schemaRef: SchemaRef,
    private entry: {
      name: string;
      behaviorId: string;
      vocabularyUri: string | null;
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

  produce(value: unknown): void {
    const record = this.state.shouldRecord;
    if (
      record &&
      !record(this.entry.behaviorId, this.entry.name, this.entry.vocabularyUri)
    ) {
      return;
    }
    const production = {
      behaviorId: this.entry.behaviorId,
      keywordName: this.entry.name,
      vocabularyUri: this.entry.vocabularyUri,
      schemaRef: this.schemaRef,
      pathNode: this.pathNode,
      cursor: this.cursor,
      value,
    };
    this.state.frame.productions.push(production);
    // Frames discard on failure; the trace keeps everything so verbose
    // outputs can report droppedAnnotations.
    this.state.allProductions?.push(production);
  }

  visible(behaviorIds: readonly string[]): readonly ProductionView[] {
    // Under elision, reading an id nobody declared via StaticFacts.consumes
    // means the productions may already be gone — fail loud, not wrong.
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
    return this.state.frame.productions.filter(
      (p) => p.cursor === this.cursor && behaviorIds.includes(p.behaviorId),
    );
  }

  error(message: string, params?: ErrorParams): void {
    this.state.errors.push({
      keywordName: this.entry.name,
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
  state.frames.push({ productions: [] });
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
      if (state.shouldRecord && !state.shouldRecord(behaviorId, name, null))
        continue;
      const production = {
        behaviorId,
        keywordName: name,
        vocabularyUri: null,
        schemaRef,
        pathNode,
        cursor,
        value: node[name],
      };
      state.frame.productions.push(production);
      state.allProductions?.push(production);
    }
  } finally {
    const frame = state.frames.pop()!;
    if (valid) state.frame.productions.push(...frame.productions);
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
  const ctx = new KeywordContextImpl(
    state,
    schemaRef,
    {
      name: entry.name,
      behaviorId: entry.behavior.id,
      vocabularyUri: entry.vocabularyUri,
    },
    cursor,
    pathNode,
  );
  const value = (schemaRef.node as Record<string, JsonValue>)[entry.name]!;
  return entry.behavior.evaluate(value, cursor, ctx);
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
    tracing ? null : shouldRecord,
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
  /** produce-time elision predicate (D5); null records everything */
  shouldRecord?: RecordPredicate | null;
  regexCache?: RegexCache;
  maxDepth?: number;
}

/**
 * Evaluates one schema fragment with pre-seeded state: the compiled tier's
 * trampoline into the interpreter (M6), used for dynamic islands and for
 * fallback units alike. Returns the fragment's verdict, its errors, and its
 * root frame's surviving productions — cursor identities intact, so a
 * compiled caller can merge them under channel rule 3 and filter under
 * rule 4 exactly as an interpreted parent would.
 */
export function evaluateFragment(
  registry: SchemaRegistry,
  target: SchemaRef,
  cursor: Cursor,
  options: FragmentOptions = {},
): { valid: boolean; errors: ErrorRecord[]; productions: Production[] } {
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const state = new EvalState(
    registry,
    false,
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
  return { valid, errors: state.errors, productions: state.rootProductions };
}
