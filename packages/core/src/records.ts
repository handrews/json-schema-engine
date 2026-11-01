// Interpreter-side rendering: the engine's evaluation records (path-node
// chains, schema refs, cursors) become the string-located units of the flat
// surface here, and its trace becomes the located tree the document
// renderers in output.ts consume — so those renderers stay free of engine
// internals and serve any producer of a RenderInput.

import { instancePointer } from "./cursor.js";
import { schemaLocation } from "./uri.js";
import { realize } from "./messages.js";
import {
  AnnotationRecord,
  ErrorRecord,
  KeywordTrace,
  PathNode,
  TraceNode,
  materializePath,
} from "./engine.js";
import {
  type AnnotationSelection,
  type AnnotationUnit,
  type ErrorUnit,
  type RenderInput,
  type RenderNode,
  NO_INDEXES,
  keywordSuffix,
  makeRecordPredicate,
} from "./output.js";

/**
 * The two fields of a schema reference that locate it; `node` is not
 * needed. `key` is the location string itself (`uri.schemaLocation`),
 * cached on a `SchemaRef` (the registry fills it for interned refs, the
 * cycle guard for the rest) so a position's location is built once however
 * many records and trace nodes name it.
 */
export interface LocationRef {
  baseUri: string;
  pointer: string;
  key?: string;
}

// A keyword's own segment is appended at render time, once per unit:
// sibling keywords share their application's path node and schema ref.
// `keywordName` is `null` for a boolean `false` schema, which has no
// keyword to name, so the unit sits at the application's own location.
const evaluationPathOf = (
  pathNode: PathNode | null,
  keywordName: string | null,
): string => {
  const path = materializePath(pathNode);
  return keywordName === null ? path : path + keywordSuffix(keywordName).plain;
};

/** Canonical schema location of a schema object, or of one of its keywords. */
export const schemaLocationOf = (
  ref: LocationRef,
  keywordName: string | null,
): string => {
  const location = (ref.key ??= schemaLocation(ref.baseUri, ref.pointer));
  return keywordName === null
    ? location
    : location + keywordSuffix(keywordName).fragment;
};

/** Renders one error record into its native unit. */
export function renderError(
  record: ErrorRecord,
  includeParams = false,
): ErrorUnit {
  // A deferred description is realized here, against the record's own
  // cursor value, and only here: most records are never rendered.
  const { message, params } =
    record.describe === undefined
      ? record
      : realize(record.describe(), record.cursor.value, includeParams);
  const unit: ErrorUnit = {
    evaluationPath: evaluationPathOf(record.pathNode, record.keywordName),
    schemaLocation: schemaLocationOf(record.schemaRef, record.keywordName),
    inputLocation: instancePointer(record.cursor),
    error: message,
  };
  if (includeParams) {
    if (record.keywordName !== null) unit.keyword = record.keywordName;
    if (record.vocabularyUri !== null) unit.vocabulary = record.vocabularyUri;
    unit.params = params ?? {};
  }
  return unit;
}

/** Renders one annotation record into its native unit. */
export function renderAnnotation(record: AnnotationRecord): AnnotationUnit {
  return {
    keyword: record.keywordName,
    ...(record.vocabularyUri === null
      ? {}
      : { vocabulary: record.vocabularyUri }),
    evaluationPath: evaluationPathOf(record.pathNode, record.keywordName),
    schemaLocation: schemaLocationOf(record.schemaRef, record.keywordName),
    inputLocation: instancePointer(record.cursor),
    annotation: record.value,
  };
}

/**
 * Selects and renders annotation records in one pass: each candidate is
 * rendered once and `keep` sees that unit. The survivors' records stay
 * positionally paired with their units so {@link toRenderInput} can index
 * them.
 */
export function renderSelected(
  records: readonly AnnotationRecord[],
  selection: boolean | AnnotationSelection,
): { records: AnnotationRecord[]; units: AnnotationUnit[] } {
  const byLists = makeRecordPredicate(selection);
  const keep = typeof selection === "object" ? selection.keep : undefined;
  const kept: AnnotationRecord[] = [];
  const units: AnnotationUnit[] = [];
  for (const record of records) {
    if (!byLists(record.behaviorId, record.keywordName, record.vocabularyUri)) {
      continue;
    }
    const unit = renderAnnotation(record);
    if (keep !== undefined && !keep(unit)) continue;
    kept.push(record);
    units.push(unit);
  }
  return { records: kept, units };
}

/** The record arrays the flat surface was rendered from, positionally paired with {@link UnitSets}. */
export interface RecordSets {
  errors: readonly ErrorRecord[];
  droppedErrors: readonly ErrorRecord[];
  annotations: readonly AnnotationRecord[];
  droppedAnnotations: readonly AnnotationRecord[];
}

/** The flat surface's unit arrays, positionally paired with {@link RecordSets}. */
export interface UnitSets {
  errors: readonly ErrorUnit[];
  droppedErrors: readonly ErrorUnit[];
  annotations: readonly AnnotationUnit[];
  droppedAnnotations: readonly AnnotationUnit[];
}

// Records attach to applications by path-node identity: every application
// mints its own PathNode, so identity is finer than the evaluation-path
// string (repeated applications of one keyword share the string). A custom
// keyword applying with no segment of its own shares its parent's node and
// therefore its parent's record group.
function indexByPath(
  records: readonly { pathNode: PathNode | null }[],
): Map<PathNode | null, number[]> {
  const at = new Map<PathNode | null, number[]>();
  records.forEach((r, i) => {
    const list = at.get(r.pathNode);
    if (list) list.push(i);
    else at.set(r.pathNode, [i]);
  });
  return at;
}

/**
 * Adapts the interpreter's trace into the located tree, materializing every
 * location once per application; the index lists point into the unit
 * arrays paired with `records`.
 *
 * With `pruneEmpty`, an application with no record in any of the four sets,
 * at itself or anywhere below, is left out together with its subtree; the
 * root always remains. That is the tree the relevant level renders:
 * `hierarchical`/`list` omit a unit with nothing to report and `detailed`
 * condenses one away, so the pruned tree renders to the same documents
 * while its size follows the records rather than the applications, and a
 * pruned application never materializes a location. The verbose level and
 * `trace` render every application and take the whole tree. Children are
 * filtered, never reordered, and a kept application keeps its parent, so
 * the {@link RenderNode} invariants hold either way.
 */
export function toRenderNode(
  root: TraceNode,
  records: RecordSets,
  pruneEmpty = false,
): RenderNode {
  const errorsAt = indexByPath(records.errors);
  const droppedErrorsAt = indexByPath(records.droppedErrors);
  const annotationsAt = indexByPath(records.annotations);
  const droppedAnnotationsAt = indexByPath(records.droppedAnnotations);
  const locate = (
    node: TraceNode,
    errors: readonly number[],
    droppedErrors: readonly number[],
    annotations: readonly number[],
    droppedAnnotations: readonly number[],
    children: RenderNode[],
  ): RenderNode => ({
    evaluationPath: materializePath(node.pathNode),
    schemaLocation: schemaLocationOf(node.schemaRef, null),
    inputLocation: instancePointer(node.cursor),
    valid: node.valid,
    keywords: node.keywords,
    errors,
    droppedErrors,
    annotations,
    droppedAnnotations,
    children,
  });
  const toNode = (node: TraceNode): RenderNode | undefined => {
    // Children first, then the record test, and only then the locations.
    const children: RenderNode[] = [];
    for (const child of node.children) {
      const kept = toNode(child);
      if (kept !== undefined) children.push(kept);
    }
    const key = node.pathNode;
    const errors = errorsAt.get(key);
    const droppedErrors = droppedErrorsAt.get(key);
    const annotations = annotationsAt.get(key);
    const droppedAnnotations = droppedAnnotationsAt.get(key);
    if (
      pruneEmpty &&
      children.length === 0 &&
      errors === undefined &&
      droppedErrors === undefined &&
      annotations === undefined &&
      droppedAnnotations === undefined
    ) {
      return undefined;
    }
    return locate(
      node,
      errors ?? NO_INDEXES,
      droppedErrors ?? NO_INDEXES,
      annotations ?? NO_INDEXES,
      droppedAnnotations ?? NO_INDEXES,
      children,
    );
  };
  // Nothing anywhere: the root alone, with every child pruned.
  return (
    toNode(root) ??
    locate(root, NO_INDEXES, NO_INDEXES, NO_INDEXES, NO_INDEXES, [])
  );
}

/**
 * Prunes record-free applications from a producer-built tree in place, as
 * {@link toRenderNode} does with `pruneEmpty` while building: every non-root
 * node with empty index lists and no surviving child is dropped from its
 * parent's `children`, in place and in order. For the relevant level only;
 * the verbose level and `trace` take the whole tree. Run it after the last
 * record has been attributed, and only where the renderer would otherwise
 * do more work per record-free node than this walk does (`detailed`).
 */
export function pruneRecordFree(root: MutableRenderNode): void {
  const prune = (node: MutableRenderNode): boolean => {
    const children = node.children;
    let kept = 0;
    for (const child of children) {
      if (prune(child)) children[kept++] = child;
    }
    children.length = kept;
    return (
      kept > 0 ||
      node.errors.length > 0 ||
      node.droppedErrors.length > 0 ||
      node.annotations.length > 0 ||
      node.droppedAnnotations.length > 0
    );
  };
  prune(root);
}

/**
 * A {@link RenderNode} still being filled by its producer: the index lists
 * grow as records are attributed, `valid` is settled when the application
 * ends. Assignable to `RenderNode` once complete.
 */
export interface MutableRenderNode extends RenderNode {
  valid: boolean;
  keywords: KeywordTrace[];
  errors: number[];
  droppedErrors: number[];
  annotations: number[];
  droppedAnnotations: number[];
  children: MutableRenderNode[];
}

/**
 * Converts a traced fragment into producer-side nodes. The evaluation path
 * comes from the fragment's path chain (a compiled caller seeds it with its
 * own prefix), the input location gets the caller's prefix, and `at` maps
 * each path node to the nodes sharing it so the caller can attribute the
 * fragment's records to their owners the way the interpreter's adapter does.
 */
export function traceToRenderNodes(
  root: TraceNode,
  inputPrefix: string,
): { root: MutableRenderNode; at: Map<PathNode | null, MutableRenderNode[]> } {
  const at = new Map<PathNode | null, MutableRenderNode[]>();
  const toNode = (node: TraceNode): MutableRenderNode => {
    const out: MutableRenderNode = {
      evaluationPath: materializePath(node.pathNode),
      schemaLocation: schemaLocationOf(node.schemaRef, null),
      inputLocation: inputPrefix + instancePointer(node.cursor),
      valid: node.valid,
      keywords: node.keywords,
      errors: [],
      droppedErrors: [],
      annotations: [],
      droppedAnnotations: [],
      children: [],
    };
    const sharing = at.get(node.pathNode);
    if (sharing) sharing.push(out);
    else at.set(node.pathNode, [out]);
    for (const child of node.children) out.children.push(toNode(child));
    return out;
  };
  return { root: toNode(root), at };
}

/** The located tree with its paired unit arrays: the renderers' input. */
export function toRenderInput(
  root: TraceNode,
  records: RecordSets,
  units: UnitSets,
): RenderInput {
  return {
    errors: units.errors,
    droppedErrors: units.droppedErrors,
    annotations: units.annotations,
    droppedAnnotations: units.droppedAnnotations,
    root: toRenderNode(root, records),
  };
}
