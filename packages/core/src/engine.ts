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
  KeywordContext,
  ProductionView,
  unknownKeywordId,
} from "./dialect.js";
import { SchemaRegistry } from "./registry.js";

export class InfiniteLoopError extends Error {}
export class UnknownKeywordError extends Error {}
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

// Evaluation-path node: one pre-escaped segment, parent-linked, materialized
// only when a unit escapes to output.
export interface PathNode {
  readonly parent: PathNode | null;
  readonly segment: string;
}

export function materializePath(node: PathNode | null): string {
  let s = "";
  for (let n = node; n !== null; n = n.parent) s = "/" + n.segment + s;
  return s;
}

export interface Production {
  behaviorId: string;
  keywordName: string;
  vocabularyUri: string | null; // null for unknown keywords
  schemaRef: SchemaRef;
  pathNode: PathNode | null; // path of the schema object (keyword appended on render)
  cursor: Cursor;
  value: unknown;
}

export interface ErrorRecord {
  keywordName: string | null; // null: the schema itself failed (boolean false)
  schemaRef: SchemaRef;
  pathNode: PathNode | null;
  cursor: Cursor;
  message: string;
}

interface Frame {
  productions: Production[];
}

// One schema application, recorded only when tracing (M5 structured
// outputs): hierarchical/verbose renderers need application boundaries and
// per-branch validity, which the flat error list cannot reconstruct.
export interface TraceNode {
  schemaRef: SchemaRef;
  pathNode: PathNode | null;
  cursor: Cursor;
  valid: boolean;
  children: TraceNode[];
}

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
  private traceStack: TraceNode[] = [];
  private active = new Map<Cursor, Set<string>>();

  constructor(
    public registry: SchemaRegistry,
    tracing = false,
    public shouldRecord: RecordPredicate | null = null,
  ) {
    if (tracing) this.allProductions = [];
  }

  get tracing(): boolean {
    return this.allProductions !== null;
  }

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

  traceExit(node: TraceNode, valid: boolean): void {
    node.valid = valid;
    this.traceStack.pop();
  }

  get frame(): Frame {
    return this.frames[this.frames.length - 1]!;
  }
  get rootProductions(): Production[] {
    return this.frames[0]!.productions;
  }

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

  error(message: string): void {
    this.state.errors.push({
      keywordName: this.entry.name,
      schemaRef: this.schemaRef,
      pathNode: this.pathNode,
      cursor: this.cursor,
      message,
    });
  }
}

export function applySchema(
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
  if (!isObject(node)) return true;

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

export function runEvaluation(
  registry: SchemaRegistry,
  schemaUri: string,
  instance: JsonValue,
  tracing = false,
  shouldRecord: RecordPredicate | null = null,
): { valid: boolean; state: EvalState } {
  const state = new EvalState(registry, tracing, tracing ? null : shouldRecord);
  const valid = applySchema(
    state,
    registry.rootRef(schemaUri),
    rootCursor(instance),
    null,
  );
  return { valid, state };
}
