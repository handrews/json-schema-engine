// Output rendering (DESIGN.md D6): one internal result, projected into
// either location-field vocabulary. Default is the current output spec's
// `evaluationPath`/`schemaLocation`; the 2020-12 names
// (`keywordLocation`/`absoluteKeywordLocation`) are the compatibility option.
// M1 ships flag + flat list (Basic-style) structures; hierarchical/verbose
// structures are M5.

import { escapeSegment } from "./json.js";
import { instancePointer } from "./cursor.js";
import {
  ErrorRecord, PathNode, Production, TraceNode, materializePath,
} from "./engine.js";
import { SourceLocation } from "./loader.js";

export type LocationVocabulary = "modern" | "2020-12";

export interface ErrorUnit {
  instanceLocation: string;
  error: string;
  // modern
  evaluationPath?: string;
  schemaLocation?: string;
  // 2020-12
  keywordLocation?: string;
  absoluteKeywordLocation?: string;
  /** schema-side source position, present with the `positions` option (D17) */
  source?: SourceLocation;
}

export interface AnnotationUnit extends Omit<ErrorUnit, "error"> {
  keyword: string;
  vocabulary?: string;
  annotation: unknown;
}

export interface RetentionPolicy {
  /** allow-list of keyword names; an empty array retains nothing */
  keywords?: readonly string[];
  /** allow-list of vocabulary URIs (OR-ed with `keywords`) */
  vocabularies?: readonly string[];
  /** arbitrary predicate over the rendered unit, AND-ed after the lists */
  keep?: (unit: AnnotationUnit) => boolean;
}

function locations(
  pathNode: PathNode | null,
  keywordName: string | null,
  schemaRef: { baseUri: string; pointer: string },
  vocabulary: LocationVocabulary,
): Pick<ErrorUnit, "evaluationPath" | "schemaLocation" | "keywordLocation" | "absoluteKeywordLocation"> {
  const keywordSuffix = keywordName === null ? "" : "/" + escapeSegment(keywordName);
  const evaluationPath = materializePath(pathNode) + keywordSuffix;
  const schemaLocation = `${schemaRef.baseUri}#${schemaRef.pointer}${keywordSuffix}`;
  return vocabulary === "modern"
    ? { evaluationPath, schemaLocation }
    : { keywordLocation: evaluationPath, absoluteKeywordLocation: schemaLocation };
}

export function renderError(record: ErrorRecord, vocabulary: LocationVocabulary): ErrorUnit {
  return {
    ...locations(record.pathNode, record.keywordName, record.schemaRef, vocabulary),
    instanceLocation: instancePointer(record.cursor),
    error: record.message,
  };
}

export function renderAnnotation(
  production: Production,
  vocabulary: LocationVocabulary,
): AnnotationUnit {
  return {
    keyword: production.keywordName,
    ...(production.vocabularyUri === null ? {} : { vocabulary: production.vocabularyUri }),
    ...locations(production.pathNode, production.keywordName, production.schemaRef, vocabulary),
    instanceLocation: instancePointer(production.cursor),
    annotation: production.value,
  };
}

/** The retention decision on raw productions, shared by every renderer. */
export function selectRetained(
  productions: readonly Production[],
  retention: RetentionPolicy | undefined,
  vocabulary: LocationVocabulary,
): Production[] {
  let selected = [...productions];
  if (retention?.keywords !== undefined || retention?.vocabularies !== undefined) {
    const names = new Set(retention.keywords ?? []);
    const vocabs = new Set(retention.vocabularies ?? []);
    selected = selected.filter(
      (p) => names.has(p.keywordName)
        || (p.vocabularyUri !== null && vocabs.has(p.vocabularyUri)),
    );
  }
  if (retention?.keep) {
    const keep = retention.keep;
    selected = selected.filter((p) => keep(renderAnnotation(p, vocabulary)));
  }
  return selected;
}

export function applyRetention(
  productions: readonly Production[],
  retention: RetentionPolicy | undefined,
  vocabulary: LocationVocabulary,
): AnnotationUnit[] {
  return selectRetained(productions, retention, vocabulary)
    .map((p) => renderAnnotation(p, vocabulary));
}

// Structured output unit (current output spec / 2020-12 output spec): the
// field vocabulary stays a projection knob, the structure is shared.
export interface OutputUnit {
  valid: boolean;
  instanceLocation: string;
  // modern
  evaluationPath?: string;
  schemaLocation?: string;
  // 2020-12
  keywordLocation?: string;
  absoluteKeywordLocation?: string;
  errors?: Record<string, string>;
  annotations?: Record<string, unknown>;
  droppedAnnotations?: Record<string, unknown>;
  details?: OutputUnit[];
}

export interface HierarchicalOptions {
  vocabulary: LocationVocabulary;
  /** keep valid, annotation-free units instead of pruning them */
  verbose?: boolean;
  retention?: RetentionPolicy;
}

/**
 * HIERARCHICAL structure over the evaluation trace. Units carry errors and
 * (retention-filtered) annotations keyed by keyword name; on failed units
 * annotations appear as droppedAnnotations, matching the frame-discard
 * semantics (§4 rule 3). Without `verbose`, units contributing nothing —
 * valid, no annotations, no details — are pruned; the root unit always
 * remains.
 */
export function renderHierarchical(
  root: TraceNode,
  errors: readonly ErrorRecord[],
  productions: readonly Production[],
  options: HierarchicalOptions,
): OutputUnit {
  const vocabulary = options.vocabulary;
  const errorsAt = new Map<PathNode | null, ErrorRecord[]>();
  for (const e of errors) {
    const list = errorsAt.get(e.pathNode);
    if (list) list.push(e);
    else errorsAt.set(e.pathNode, [e]);
  }
  const annotationsAt = new Map<PathNode | null, Production[]>();
  for (const p of selectRetained(productions, options.retention, vocabulary)) {
    const list = annotationsAt.get(p.pathNode);
    if (list) list.push(p);
    else annotationsAt.set(p.pathNode, [p]);
  }

  const toUnit = (node: TraceNode): OutputUnit | undefined => {
    const details = node.children
      .map(toUnit)
      .filter((u): u is OutputUnit => u !== undefined);

    const unit: OutputUnit = {
      valid: node.valid,
      ...locations(node.pathNode, null, node.schemaRef, vocabulary),
      instanceLocation: instancePointer(node.cursor),
    };

    const errs = errorsAt.get(node.pathNode);
    if (errs && errs.length > 0) {
      const byKeyword: Record<string, string> = {};
      for (const e of errs) {
        // A keyword may report several errors (required's missing names);
        // the unit field is one message per keyword, so join them.
        const key = e.keywordName ?? "";
        byKeyword[key] = byKeyword[key] === undefined
          ? e.message : `${byKeyword[key]}; ${e.message}`;
      }
      unit.errors = byKeyword;
    }

    const anns = annotationsAt.get(node.pathNode);
    if (anns && anns.length > 0) {
      const byKeyword: Record<string, unknown> = {};
      for (const a of anns) byKeyword[a.keywordName] = a.value;
      if (node.valid) unit.annotations = byKeyword;
      else unit.droppedAnnotations = byKeyword;
    }

    if (details.length > 0) unit.details = details;

    if (!options.verbose && node.valid
      && unit.annotations === undefined && unit.details === undefined) {
      return undefined;
    }
    return unit;
  };

  return toUnit(root) ?? {
    valid: root.valid,
    ...locations(root.pathNode, null, root.schemaRef, vocabulary),
    instanceLocation: instancePointer(root.cursor),
  };
}
