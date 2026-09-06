// Interpreter-side rendering: the engine's evaluation records (path-node
// chains, schema refs, cursors) become the string-located units of the flat
// surface here, and its trace becomes the located tree the document
// renderers in output.ts consume — so those renderers stay free of engine
// internals and serve any producer of a RenderInput.

import { escapeSegment } from "./json.js";
import { instancePointer } from "./cursor.js";
import {
  AnnotationRecord,
  ErrorRecord,
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
  makeRecordPredicate,
} from "./output.js";

/** The two fields of a schema reference that locate it; `node` is not needed. */
export interface LocationRef {
  baseUri: string;
  pointer: string;
}

const keywordSuffix = (name: string | null): string =>
  name === null ? "" : "/" + escapeSegment(name);

const evaluationPathOf = (
  pathNode: PathNode | null,
  keywordName: string | null,
): string => materializePath(pathNode) + keywordSuffix(keywordName);

/** Canonical schema location of a schema object, or of one of its keywords. */
export const schemaLocationOf = (
  ref: LocationRef,
  keywordName: string | null,
): string => `${ref.baseUri}#${ref.pointer}${keywordSuffix(keywordName)}`;

/** Renders one error record into its native unit. */
export function renderError(
  record: ErrorRecord,
  includeParams = false,
): ErrorUnit {
  const unit: ErrorUnit = {
    evaluationPath: evaluationPathOf(record.pathNode, record.keywordName),
    schemaLocation: schemaLocationOf(record.schemaRef, record.keywordName),
    inputLocation: instancePointer(record.cursor),
    error: record.message,
  };
  if (includeParams) {
    if (record.keywordName !== null) unit.keyword = record.keywordName;
    if (record.vocabularyUri !== null) unit.vocabulary = record.vocabularyUri;
    unit.params = record.params ?? {};
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
 * Adapts the interpreter's trace and its paired record/unit arrays into the
 * renderers' input, materializing every location once per application.
 */
export function toRenderInput(
  root: TraceNode,
  records: RecordSets,
  units: UnitSets,
): RenderInput {
  const errorsAt = indexByPath(records.errors);
  const droppedErrorsAt = indexByPath(records.droppedErrors);
  const annotationsAt = indexByPath(records.annotations);
  const droppedAnnotationsAt = indexByPath(records.droppedAnnotations);
  const toNode = (node: TraceNode): RenderNode => ({
    evaluationPath: materializePath(node.pathNode),
    schemaLocation: schemaLocationOf(node.schemaRef, null),
    inputLocation: instancePointer(node.cursor),
    valid: node.valid,
    keywords: node.keywords,
    errors: errorsAt.get(node.pathNode) ?? NO_INDEXES,
    droppedErrors: droppedErrorsAt.get(node.pathNode) ?? NO_INDEXES,
    annotations: annotationsAt.get(node.pathNode) ?? NO_INDEXES,
    droppedAnnotations: droppedAnnotationsAt.get(node.pathNode) ?? NO_INDEXES,
    children: node.children.map(toNode),
  });
  return {
    errors: units.errors,
    droppedErrors: units.droppedErrors,
    annotations: units.annotations,
    droppedAnnotations: units.droppedAnnotations,
    root: toNode(root),
  };
}
