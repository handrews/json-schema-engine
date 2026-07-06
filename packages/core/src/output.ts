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
  /** deny-list of keyword names, subtracted after the allow-lists */
  excludeKeywords?: readonly string[];
  /** deny-list of vocabulary URIs, subtracted after the allow-lists */
  excludeVocabularies?: readonly string[];
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

// Retention only runs in renderers (§4 rule 5: it never affects rule 4's
// channel visibility), so deny lists here can never hide a production from
// ctx.visible() — the concern the M5.5 elision milestone must keep separate.

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
  if (retention?.excludeKeywords !== undefined || retention?.excludeVocabularies !== undefined) {
    const names = new Set(retention.excludeKeywords ?? []);
    const vocabs = new Set(retention.excludeVocabularies ?? []);
    selected = selected.filter(
      (p) => !names.has(p.keywordName)
        && !(p.vocabularyUri !== null && vocabs.has(p.vocabularyUri)),
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

// Detailed/Verbose (2020-12 names) are the identical tree shape as
// HIERARCHICAL — the field vocabulary was always orthogonal to the
// structure (D6) — so they reuse renderHierarchical under the "2020-12"
// vocabulary rather than duplicating the pruning logic.
export function renderDetailed(
  root: TraceNode,
  errors: readonly ErrorRecord[],
  productions: readonly Production[],
  retention?: RetentionPolicy,
): OutputUnit {
  return renderHierarchical(root, errors, productions,
    { vocabulary: "2020-12", verbose: false, retention });
}

export function renderVerbose(
  root: TraceNode,
  errors: readonly ErrorRecord[],
  productions: readonly Production[],
  retention?: RetentionPolicy,
): OutputUnit {
  return renderHierarchical(root, errors, productions,
    { vocabulary: "2020-12", verbose: true, retention });
}

/**
 * LIST structure over the evaluation trace (current output spec): the same
 * per-application units as HIERARCHICAL, flattened instead of nested — no
 * `details`. Pruning matches HIERARCHICAL's non-verbose rule (contribution-
 * free valid units drop).
 */
export function renderList(
  root: TraceNode,
  errors: readonly ErrorRecord[],
  productions: readonly Production[],
  options: HierarchicalOptions,
): OutputUnit[] {
  const nested = renderHierarchical(root, errors, productions, options);
  const flat: OutputUnit[] = [];
  const collect = (unit: OutputUnit): void => {
    const { details, ...rest } = unit;
    flat.push(rest);
    details?.forEach(collect);
  };
  collect(nested);
  return flat;
}

// Basic (2020-12) is structurally distinct from OutputUnit's
// Detailed/Verbose/LIST shape: its errors/annotations are flat arrays of
// full units (one per error/production record, each with its own
// keywordLocation), not a details tree or a keyword-keyed record.
export interface BasicOutputDocument {
  valid: boolean;
  instanceLocation: string;
  evaluationPath?: string;
  schemaLocation?: string;
  keywordLocation?: string;
  absoluteKeywordLocation?: string;
  errors?: ErrorUnit[];
  annotations?: AnnotationUnit[];
}

/**
 * Basic output document: a wrapper unit (`valid`, empty root locations) with
 * a flat `errors` array on failure or `annotations` array on success — per
 * the suite's output-tests basic fixtures, `errors` is absent on success.
 */
export function renderBasic(
  valid: boolean,
  rootSchemaRef: { baseUri: string; pointer: string },
  errors: readonly ErrorRecord[],
  rootProductions: readonly Production[],
  retention: RetentionPolicy | undefined,
  vocabulary: LocationVocabulary,
): BasicOutputDocument {
  const doc: BasicOutputDocument = {
    valid,
    ...locations(null, null, rootSchemaRef, vocabulary),
    instanceLocation: "",
  };
  if (valid) {
    const anns = applyRetention(rootProductions, retention, vocabulary);
    if (anns.length > 0) doc.annotations = anns;
  } else {
    doc.errors = errors.map((e) => renderError(e, vocabulary));
  }
  return doc;
}
