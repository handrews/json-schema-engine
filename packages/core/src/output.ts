// Output rendering (DESIGN.md D6): one internal result, projected into
// either location-field vocabulary. Default is the current output spec's
// `evaluationPath`/`schemaLocation`; the 2020-12 names
// (`keywordLocation`/`absoluteKeywordLocation`) are the compatibility option.
// M1 ships flag + flat list (Basic-style) structures; hierarchical/verbose
// structures are M5.

import { escapeSegment, unescapeSegment } from "./json.js";
import { instancePointer } from "./cursor.js";
import { ErrorParams } from "./dialect.js";
import {
  AnnotationRecord,
  ErrorRecord,
  PathNode,
  RecordPredicate,
  TraceNode,
  materializePath,
} from "./engine.js";
import { SourceLocation } from "./loader.js";

/** Which location field names a rendered unit uses. */
export type LocationVocabulary = "modern" | "2020-12";

/** One rendered assertion failure. */
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
  /**
   * Failing keyword name + structured failure data (D13), present with the
   * `errorParams` option. Extensions beyond the spec output shapes, so
   * opt-in; `keyword` is absent when the schema itself was boolean `false`.
   */
  keyword?: string;
  params?: ErrorParams;
}

/** One rendered annotation record. */
export interface AnnotationUnit extends Omit<
  ErrorUnit,
  "error" | "keyword" | "params"
> {
  keyword: string;
  vocabulary?: string;
  annotation: unknown;
}

/** Which annotations survive into rendered output (D5). */
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
): Pick<
  ErrorUnit,
  | "evaluationPath"
  | "schemaLocation"
  | "keywordLocation"
  | "absoluteKeywordLocation"
> {
  const keywordSuffix =
    keywordName === null ? "" : "/" + escapeSegment(keywordName);
  const evaluationPath = materializePath(pathNode) + keywordSuffix;
  const schemaLocation = `${schemaRef.baseUri}#${schemaRef.pointer}${keywordSuffix}`;
  return vocabulary === "modern"
    ? { evaluationPath, schemaLocation }
    : {
        keywordLocation: evaluationPath,
        absoluteKeywordLocation: schemaLocation,
      };
}

/** Renders one error record into its output unit. */
export function renderError(
  record: ErrorRecord,
  vocabulary: LocationVocabulary,
  includeParams = false,
): ErrorUnit {
  const unit: ErrorUnit = {
    ...locations(
      record.pathNode,
      record.keywordName,
      record.schemaRef,
      vocabulary,
    ),
    instanceLocation: instancePointer(record.cursor),
    error: record.message,
  };
  if (includeParams) {
    if (record.keywordName !== null) unit.keyword = record.keywordName;
    unit.params = record.params ?? {};
  }
  return unit;
}

/** Renders one annotation record into its output unit. */
export function renderAnnotation(
  record: AnnotationRecord,
  vocabulary: LocationVocabulary,
): AnnotationUnit {
  return {
    keyword: record.keywordName,
    ...(record.vocabularyUri === null
      ? {}
      : { vocabulary: record.vocabularyUri }),
    ...locations(
      record.pathNode,
      record.keywordName,
      record.schemaRef,
      vocabulary,
    ),
    instanceLocation: instancePointer(record.cursor),
    annotation: record.value,
  };
}

// Retention applies to annotation records only (§4 rule 5); dependency
// records live in a separate store, so no retention setting can hide one
// from ctx.visible().

/**
 * Annotation recording decision (D5/M5.5): record iff the annotation output
 * path might read it — collection on, and the retention allow/deny lists do
 * not rule the keyword out. The `keep` predicate runs only at render:
 * recording a superset of what it keeps is correct, eliding on its behalf
 * would not be. This is also selectRetained's list stage, so the two can
 * never disagree.
 */
export function makeRecordPredicate(
  collectAnnotations: boolean,
  retention: RetentionPolicy | undefined,
): RecordPredicate {
  if (!collectAnnotations) return () => false;
  const allow =
    retention?.keywords !== undefined || retention?.vocabularies !== undefined
      ? {
          names: new Set(retention.keywords ?? []),
          vocabs: new Set(retention.vocabularies ?? []),
        }
      : null;
  const denyNames = new Set(retention?.excludeKeywords ?? []);
  const denyVocabs = new Set(retention?.excludeVocabularies ?? []);
  return (_behaviorId, keywordName, vocabularyUri) => {
    if (
      allow !== null &&
      !allow.names.has(keywordName) &&
      !(vocabularyUri !== null && allow.vocabs.has(vocabularyUri))
    ) {
      return false;
    }
    return (
      !denyNames.has(keywordName) &&
      !(vocabularyUri !== null && denyVocabs.has(vocabularyUri))
    );
  };
}

/** The retention decision on raw annotation records, shared by every renderer. */
export function selectRetained(
  annotations: readonly AnnotationRecord[],
  retention: RetentionPolicy | undefined,
  vocabulary: LocationVocabulary,
): AnnotationRecord[] {
  const byLists = makeRecordPredicate(true, retention);
  let selected = annotations.filter((a) =>
    byLists(a.behaviorId, a.keywordName, a.vocabularyUri),
  );
  if (retention?.keep) {
    const keep = retention.keep;
    selected = selected.filter((a) => keep(renderAnnotation(a, vocabulary)));
  }
  return selected;
}

/** Applies retention and renders the surviving annotation records into units. */
export function applyRetention(
  annotations: readonly AnnotationRecord[],
  retention: RetentionPolicy | undefined,
  vocabulary: LocationVocabulary,
): AnnotationUnit[] {
  return selectRetained(annotations, retention, vocabulary).map((a) =>
    renderAnnotation(a, vocabulary),
  );
}

/**
 * Structured output unit (current output spec / 2020-12 output spec): the
 * field vocabulary stays a projection knob, the structure is shared.
 */
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
  /** irrelevant errors (draft-03 §12.2), present only when `irrelevant: "mark"` */
  droppedErrors?: Record<string, string>;
  droppedAnnotations?: Record<string, unknown>;
  details?: OutputUnit[];
}

/**
 * The records of one evaluation, split by draft-03 §12.2 relevance, as the
 * structured renderers consume them.
 */
export interface EvaluationRecords {
  /** relevant errors, encounter order (`Result.errors` renders these) */
  errors: readonly ErrorRecord[];
  /** errors of rejecting sub-evaluations under an accepting keyword (tracing only) */
  droppedErrors: readonly ErrorRecord[];
  /** every annotation recorded (tracing), relevant or not */
  annotations: readonly AnnotationRecord[];
  /** the relevant subset of `annotations`: root-frame survivors of a valid run */
  relevant: ReadonlySet<AnnotationRecord>;
}

/**
 * How a structured renderer treats irrelevant records: "omit" drops them and
 * prunes the units left empty (the relevant level); "mark" keeps every unit
 * and renders them under `droppedErrors`/`droppedAnnotations`; "merge" keeps
 * every unit with irrelevant errors under `errors` and annotations placed by
 * unit validity (the 2020-12 Verbose document).
 */
export type IrrelevantRendering = "omit" | "mark" | "merge";

/** Options for {@link renderHierarchical}. */
export interface HierarchicalOptions {
  vocabulary: LocationVocabulary;
  irrelevant: IrrelevantRendering;
  retention?: RetentionPolicy;
}

function groupByPath<T extends { pathNode: PathNode | null }>(
  records: readonly T[],
): Map<PathNode | null, T[]> {
  const at = new Map<PathNode | null, T[]>();
  for (const r of records) {
    const list = at.get(r.pathNode);
    if (list) list.push(r);
    else at.set(r.pathNode, [r]);
  }
  return at;
}

function errorsByKeyword(errs: readonly ErrorRecord[]): Record<string, string> {
  const byKeyword: Record<string, string> = {};
  for (const e of errs) {
    // A keyword may report several errors (required's missing names); the
    // unit field is one message per keyword, so join them.
    const key = e.keywordName ?? "";
    byKeyword[key] =
      byKeyword[key] === undefined
        ? e.message
        : `${byKeyword[key]}; ${e.message}`;
  }
  return byKeyword;
}

/**
 * HIERARCHICAL structure over the evaluation trace. Units carry errors and
 * (retention-filtered) annotations keyed by keyword name. Irrelevant records
 * render per {@link IrrelevantRendering}; the root unit always remains.
 */
export function renderHierarchical(
  root: TraceNode,
  records: EvaluationRecords,
  options: HierarchicalOptions,
): OutputUnit {
  const { vocabulary, irrelevant } = options;
  const errorsAt = groupByPath(records.errors);
  const droppedAt =
    irrelevant === "omit" ? null : groupByPath(records.droppedErrors);
  const annotationsAt = groupByPath(
    selectRetained(records.annotations, options.retention, vocabulary),
  );

  const toUnit = (node: TraceNode): OutputUnit | undefined => {
    const details = node.children
      .map(toUnit)
      .filter((u): u is OutputUnit => u !== undefined);

    const unit: OutputUnit = {
      valid: node.valid,
      ...locations(node.pathNode, null, node.schemaRef, vocabulary),
      instanceLocation: instancePointer(node.cursor),
    };

    const errs = errorsAt.get(node.pathNode) ?? [];
    const dropped = droppedAt?.get(node.pathNode) ?? [];
    // A unit's errors are uniformly relevant or irrelevant (relevance
    // depends only on the ancestor keyword chain), so merging is a concat.
    const merged = irrelevant === "merge" ? [...errs, ...dropped] : errs;
    if (merged.length > 0) unit.errors = errorsByKeyword(merged);
    if (irrelevant === "mark" && dropped.length > 0) {
      unit.droppedErrors = errorsByKeyword(dropped);
    }

    const kept: Record<string, unknown> = {};
    const droppedAnns: Record<string, unknown> = {};
    let keptAny = false;
    let droppedAny = false;
    for (const a of annotationsAt.get(node.pathNode) ?? []) {
      const relevant =
        irrelevant === "merge" ? node.valid : records.relevant.has(a);
      if (relevant) {
        kept[a.keywordName] = a.value;
        keptAny = true;
      } else if (irrelevant !== "omit") {
        droppedAnns[a.keywordName] = a.value;
        droppedAny = true;
      }
    }
    if (keptAny) unit.annotations = kept;
    if (droppedAny) unit.droppedAnnotations = droppedAnns;

    if (details.length > 0) unit.details = details;

    // Relevant level (§13.4): a unit carrying nothing relevant is omitted.
    if (
      irrelevant === "omit" &&
      unit.errors === undefined &&
      unit.annotations === undefined &&
      unit.details === undefined
    ) {
      return undefined;
    }
    return unit;
  };

  return (
    toUnit(root) ?? {
      valid: root.valid,
      ...locations(root.pathNode, null, root.schemaRef, vocabulary),
      instanceLocation: instancePointer(root.cursor),
    }
  );
}

/**
 * Detailed output (2020-12 output spec): the identical tree shape as
 * HIERARCHICAL under the "2020-12" location vocabulary (D6).
 */
export function renderDetailed(
  root: TraceNode,
  records: EvaluationRecords,
  retention?: RetentionPolicy,
): OutputUnit {
  return renderHierarchical(root, records, {
    vocabulary: "2020-12",
    irrelevant: "omit",
    retention,
  });
}

/**
 * Verbose output (2020-12 output spec): the identical tree shape as
 * HIERARCHICAL under the "2020-12" location vocabulary, every unit kept and
 * irrelevant records merged in (D6).
 */
export function renderVerbose(
  root: TraceNode,
  records: EvaluationRecords,
  retention?: RetentionPolicy,
): OutputUnit {
  return renderHierarchical(root, records, {
    vocabulary: "2020-12",
    irrelevant: "merge",
    retention,
  });
}

/**
 * LIST structure over the evaluation trace (current output spec): the same
 * per-application units as HIERARCHICAL, flattened instead of nested — no
 * `details`. Irrelevant records render per the same option.
 */
export function renderList(
  root: TraceNode,
  records: EvaluationRecords,
  options: HierarchicalOptions,
): OutputUnit[] {
  const nested = renderHierarchical(root, records, options);
  const flat: OutputUnit[] = [];
  const collect = (unit: OutputUnit): void => {
    const { details, ...rest } = unit;
    flat.push(rest);
    details?.forEach(collect);
  };
  collect(nested);
  return flat;
}

/**
 * One schema application from a traced list evaluation.
 *
 * The tree mirrors the evaluation exactly, including applications inside
 * subtrees that ultimately passed — adapters need those to reconstruct
 * application context (e.g. which `anyOf` branches an error competed
 * against) without parsing location strings.
 */
export interface TraceUnit {
  /**
   * Evaluation-path segments from the parent application, decoded (no JSON
   * Pointer escaping). The first segment is the applying keyword
   * (`"anyOf"`, `"properties"`, `"$ref"`, ...); any following segments are
   * branch indexes or property/definition names. Empty at the root.
   */
  readonly segments: readonly string[];
  /** Canonical schema location of the applied subschema: `baseUri#pointer`. */
  readonly schemaLocation: string;
  /** JSON Pointer of the instance position this application evaluated. */
  readonly instanceLocation: string;
  readonly valid: boolean;
  /**
   * Indices into `Result.errors` (same run) of the relevant errors raised
   * directly at this application; a rejecting application under an
   * accepting keyword has none (draft-03 §12.2). Populated only when the
   * evaluation failed — `Result.errors` does not exist for a valid result.
   */
  readonly errorIndexes: readonly number[];
  /** Nested applications, in evaluation order. */
  readonly children: readonly TraceUnit[];
}

const NO_INDEXES: readonly number[] = [];

/**
 * Renders the evaluation trace into its public tree. `errors` must be the
 * exact record stream `Result.errors` was rendered from: the correlation is
 * positional (index i here is unit i there), which is what lets object
 * identity stay internal.
 */
export function renderTrace(
  root: TraceNode,
  errors: readonly ErrorRecord[],
): TraceUnit {
  const indexesAt = new Map<PathNode | null, number[]>();
  errors.forEach((e, i) => {
    const list = indexesAt.get(e.pathNode);
    if (list) list.push(i);
    else indexesAt.set(e.pathNode, [i]);
  });

  const toUnit = (node: TraceNode, parentPath: PathNode | null): TraceUnit => {
    // PathNode segments are stored pre-escaped (they concatenate straight
    // into pointers); the public tree carries decoded segments instead so
    // consumers never touch pointer escaping.
    const segments: string[] = [];
    for (let n = node.pathNode; n !== null && n !== parentPath; n = n.parent) {
      segments.push(unescapeSegment(n.segment));
    }
    segments.reverse();
    return {
      segments,
      schemaLocation: `${node.schemaRef.baseUri}#${node.schemaRef.pointer}`,
      instanceLocation: instancePointer(node.cursor),
      valid: node.valid,
      errorIndexes: indexesAt.get(node.pathNode) ?? NO_INDEXES,
      children: node.children.map((c) => toUnit(c, node.pathNode)),
    };
  };
  return toUnit(root, null);
}

/**
 * Basic output document (2020-12 output spec), structurally distinct from
 * OutputUnit's Detailed/Verbose/LIST shape: its errors/annotations are flat
 * arrays of full units (one per error/annotation record, each with its own
 * `keywordLocation`), not a details tree or a keyword-keyed record.
 */
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
  rootAnnotations: readonly AnnotationRecord[],
  retention: RetentionPolicy | undefined,
  vocabulary: LocationVocabulary,
): BasicOutputDocument {
  const doc: BasicOutputDocument = {
    valid,
    ...locations(null, null, rootSchemaRef, vocabulary),
    instanceLocation: "",
  };
  if (valid) {
    const anns = applyRetention(rootAnnotations, retention, vocabulary);
    if (anns.length > 0) doc.annotations = anns;
  } else {
    doc.errors = errors.map((e) => renderError(e, vocabulary));
  }
  return doc;
}
