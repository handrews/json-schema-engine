// Interpreter-side rendering: the engine's evaluation records (path-node
// chains, schema refs, cursors) become the string-located units of the flat
// surface here, so the document renderers in output.ts consume units and
// stay free of engine internals.

import { escapeSegment } from "./json.js";
import { instancePointer } from "./cursor.js";
import {
  AnnotationRecord,
  ErrorRecord,
  PathNode,
  materializePath,
} from "./engine.js";
import type { AnnotationUnit, ErrorUnit } from "./output.js";

/** The two fields of a schema reference that locate it; `node` is not needed. */
export interface LocationRef {
  baseUri: string;
  pointer: string;
}

const keywordSuffix = (name: string | null): string =>
  name === null ? "" : "/" + escapeSegment(name);

/** Evaluation path of a schema object, or of one of its keywords. */
export const evaluationPathOf = (
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
