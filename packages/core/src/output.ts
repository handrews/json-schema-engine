// Output rendering (DESIGN.md D6; ADR 0003): one evaluation record set
// (errors, annotations, relevance, the trace) rendered by format name into
// each documented structure. Flat units carry the engine's native field
// names (evaluationPath, schemaLocation, inputLocation); each document uses
// its source's field vocabulary: IETF draft-03 §13 for basic/detailed/verbose,
// the machines-oriented output proposal for list/hierarchical.

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

/** One rendered assertion failure, native field names. */
export interface ErrorUnit {
  evaluationPath: string;
  schemaLocation: string;
  inputLocation: string;
  error: string;
  /**
   * Failing keyword name, present with the `errorParams` option; absent when
   * the schema itself was boolean `false`.
   */
  keyword?: string;
  /** The keyword's vocabulary URI, present with `errorParams` when known. */
  vocabulary?: string;
  /** Structured failure data (D13), present with `errorParams`. */
  params?: ErrorParams;
  /** Schema-side source position, present with the `positions` option (D17). */
  source?: SourceLocation;
}

/** One rendered annotation, native field names. */
export interface AnnotationUnit {
  keyword: string;
  /** The keyword's vocabulary URI, when known. */
  vocabulary?: string;
  evaluationPath: string;
  schemaLocation: string;
  inputLocation: string;
  annotation: unknown;
  /** Schema-side source position, present with the `positions` option (D17). */
  source?: SourceLocation;
}

/**
 * Which annotations reach output (ADR 0003): a control independent of the
 * output format and level. The allow-lists are OR-ed, the deny-lists
 * subtract after them, and `keep` runs last on the rendered native unit.
 */
export interface AnnotationSelection {
  /** allow-list of keyword names; an empty array selects nothing */
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

interface LocationRef {
  baseUri: string;
  pointer: string;
}

const keywordSuffix = (name: string | null): string =>
  name === null ? "" : "/" + escapeSegment(name);

const evaluationPathOf = (
  pathNode: PathNode | null,
  keywordName: string | null,
): string => materializePath(pathNode) + keywordSuffix(keywordName);

const schemaLocationOf = (
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

// Selection applies to annotation records only (§4 rule 5); dependency
// records live in a separate store, so no selection can hide one from
// ctx.visible().

/**
 * Annotation recording decision (D5): record iff the selection might render
 * the annotation — `false` records nothing, `true` everything, and a
 * selection object's allow/deny lists rule keywords out. The `keep`
 * predicate runs only at render: recording a superset of what it keeps is
 * correct, eliding on its behalf would not be. This is also
 * selectAnnotations' list stage, so the two can never disagree. It applies
 * at every output level: a deselected keyword's annotation is never
 * rendered, relevant or not.
 */
export function makeRecordPredicate(
  selection: boolean | AnnotationSelection,
): RecordPredicate {
  if (selection === false) return () => false;
  if (selection === true) return () => true;
  const allow =
    selection.keywords !== undefined || selection.vocabularies !== undefined
      ? {
          names: new Set(selection.keywords ?? []),
          vocabs: new Set(selection.vocabularies ?? []),
        }
      : null;
  const denyNames = new Set(selection.excludeKeywords ?? []);
  const denyVocabs = new Set(selection.excludeVocabularies ?? []);
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

/** The selection decision on raw annotation records, shared by every renderer. */
export function selectAnnotations(
  annotations: readonly AnnotationRecord[],
  selection: boolean | AnnotationSelection,
): AnnotationRecord[] {
  const byLists = makeRecordPredicate(selection);
  let selected = annotations.filter((a) =>
    byLists(a.behaviorId, a.keywordName, a.vocabularyUri),
  );
  const keep = typeof selection === "object" ? selection.keep : undefined;
  if (keep) selected = selected.filter((a) => keep(renderAnnotation(a)));
  return selected;
}

/** Selects and renders annotation records into native units. */
export function renderAnnotations(
  annotations: readonly AnnotationRecord[],
  selection: boolean | AnnotationSelection,
): AnnotationUnit[] {
  return selectAnnotations(annotations, selection).map(renderAnnotation);
}

/**
 * Output unit of the machines-oriented proposal (`list`, `hierarchical`):
 * errors and annotations keyed by keyword name, nested results under
 * `details`. At the verbose level `droppedErrors`/`droppedAnnotations` mark
 * irrelevant records (draft-03 §12.2): the proposal defines
 * `droppedAnnotations` for a failed unit's own annotations, and the verbose
 * level extends the marker to every irrelevant record.
 */
export interface OutputUnit {
  valid: boolean;
  evaluationPath: string;
  schemaLocation: string;
  instanceLocation: string;
  errors?: Record<string, string>;
  annotations?: Record<string, unknown>;
  droppedErrors?: Record<string, string>;
  droppedAnnotations?: Record<string, unknown>;
  details?: OutputUnit[];
}

/** The `list` document: a root unit carrying `valid` and the flat `details` list. */
export interface ListOutputDocument {
  valid: boolean;
  details: OutputUnit[];
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
 * How a `list`/`hierarchical` renderer treats irrelevant records: "omit"
 * drops them and prunes the units left empty (the relevant level); "mark"
 * keeps every unit and renders them under `droppedErrors`/
 * `droppedAnnotations` (the verbose level).
 */
export type IrrelevantRendering = "omit" | "mark";

/** Options for {@link renderHierarchical} and {@link renderList}. */
export interface HierarchicalOptions {
  irrelevant: IrrelevantRendering;
  annotations: boolean | AnnotationSelection;
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

// A keyword may report several errors (required's missing names); a
// one-message-per-keyword field joins them.
const joinMessages = (errs: readonly ErrorRecord[]): string =>
  errs.map((e) => e.message).join("; ");

function errorsByKeyword(errs: readonly ErrorRecord[]): Record<string, string> {
  const byKeyword: Record<string, string> = {};
  for (const e of errs) {
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
 * selected annotations keyed by keyword name. Irrelevant records render per
 * {@link IrrelevantRendering}; the root unit always remains.
 */
export function renderHierarchical(
  root: TraceNode,
  records: EvaluationRecords,
  options: HierarchicalOptions,
): OutputUnit {
  const { irrelevant } = options;
  const errorsAt = groupByPath(records.errors);
  const droppedAt =
    irrelevant === "omit" ? null : groupByPath(records.droppedErrors);
  const annotationsAt = groupByPath(
    selectAnnotations(records.annotations, options.annotations),
  );

  const unitOf = (node: TraceNode): OutputUnit => ({
    valid: node.valid,
    evaluationPath: materializePath(node.pathNode),
    schemaLocation: schemaLocationOf(node.schemaRef, null),
    instanceLocation: instancePointer(node.cursor),
  });

  const toUnit = (node: TraceNode): OutputUnit | undefined => {
    const details = node.children
      .map(toUnit)
      .filter((u): u is OutputUnit => u !== undefined);

    const unit = unitOf(node);

    const errs = errorsAt.get(node.pathNode) ?? [];
    if (errs.length > 0) unit.errors = errorsByKeyword(errs);
    const dropped = droppedAt?.get(node.pathNode) ?? [];
    if (dropped.length > 0) unit.droppedErrors = errorsByKeyword(dropped);

    const kept: Record<string, unknown> = {};
    const droppedAnns: Record<string, unknown> = {};
    let keptAny = false;
    let droppedAny = false;
    for (const a of annotationsAt.get(node.pathNode) ?? []) {
      if (records.relevant.has(a)) {
        kept[a.keywordName] = a.value;
        keptAny = true;
      } else if (irrelevant === "mark") {
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

  return toUnit(root) ?? unitOf(root);
}

/**
 * LIST structure over the evaluation trace: the same per-application units
 * as HIERARCHICAL, flattened under a root unit that carries only `valid` and
 * `details`. At the relevant level only units that report an error or an
 * annotation appear (the proposal's SHOULD); the verbose level includes
 * every unit.
 */
export function renderList(
  root: TraceNode,
  records: EvaluationRecords,
  options: HierarchicalOptions,
): ListOutputDocument {
  const nested = renderHierarchical(root, records, options);
  const details: OutputUnit[] = [];
  const collect = (unit: OutputUnit): void => {
    const { details: children, ...rest } = unit;
    if (
      options.irrelevant === "mark" ||
      rest.errors !== undefined ||
      rest.annotations !== undefined
    ) {
      details.push(rest);
    }
    children?.forEach(collect);
  };
  collect(nested);
  return { valid: root.valid, details };
}

/**
 * Output unit of IETF draft-03 §13.3 for the `detailed` and `verbose`
 * structures: one node per keyword evaluation or schema application, with a
 * local `error`/`annotation` and nested results under `errors` (failed
 * node) or `annotations` (successful node).
 */
export interface DetailedOutputUnit {
  valid: boolean;
  keywordLocation: string;
  absoluteKeywordLocation: string;
  instanceLocation: string;
  error?: string;
  annotation?: unknown;
  errors?: DetailedOutputUnit[];
  annotations?: DetailedOutputUnit[];
}

function attachNested(
  unit: DetailedOutputUnit,
  nested: readonly DetailedOutputUnit[],
): void {
  if (nested.length === 0) return;
  // §13.3.5: nested results key on the node's own result.
  if (unit.valid) unit.annotations = [...nested];
  else unit.errors = [...nested];
}

const nestedOf = (unit: DetailedOutputUnit): DetailedOutputUnit[] =>
  unit.errors ?? unit.annotations ?? [];

// The first evaluation-path segment of a child application below its parent
// names the applying keyword.
function segmentBelow(
  child: PathNode | null,
  parent: PathNode | null,
): string | null {
  let segment: string | null = null;
  for (let n = child; n !== null && n !== parent; n = n.parent) {
    segment = n.segment;
  }
  return segment === null ? null : unescapeSegment(segment);
}

/**
 * The draft-03 keyword-level tree (§13.4.3–13.4.4). Every schema application
 * becomes a node whose children are one node per keyword evaluation, in
 * evaluation order; each keyword node carries the keyword's own error or
 * annotation and the applications it performed. At the relevant level only
 * relevant records appear; the verbose level includes every record and
 * relies on `valid` per node as the relevance marker.
 */
function buildDraft03Tree(
  root: TraceNode,
  records: EvaluationRecords,
  selection: boolean | AnnotationSelection,
  level: "relevant" | "verbose",
): DetailedOutputUnit {
  // A trace node's errors are uniformly relevant or irrelevant, so
  // concatenating the two lists keeps encounter order within every node.
  const errorsAt = groupByPath(
    level === "verbose"
      ? [...records.errors, ...records.droppedErrors]
      : records.errors,
  );
  const annotationsAt = groupByPath(
    selectAnnotations(records.annotations, selection).filter(
      (a) => level === "verbose" || records.relevant.has(a),
    ),
  );

  const build = (node: TraceNode): DetailedOutputUnit => {
    const keywordLocation = materializePath(node.pathNode);
    const absoluteKeywordLocation = schemaLocationOf(node.schemaRef, null);
    const instanceLocation = instancePointer(node.cursor);
    const unit: DetailedOutputUnit = {
      valid: node.valid,
      keywordLocation,
      absoluteKeywordLocation,
      instanceLocation,
    };
    const errs = errorsAt.get(node.pathNode) ?? [];
    const anns = annotationsAt.get(node.pathNode) ?? [];
    // A boolean `false` schema's error belongs to the application itself.
    const own = errs.filter((e) => e.keywordName === null);
    if (own.length > 0) unit.error = joinMessages(own);

    const childrenOf = new Map<string | null, TraceNode[]>();
    for (const child of node.children) {
      const key = segmentBelow(child.pathNode, node.pathNode);
      const list = childrenOf.get(key);
      if (list) list.push(child);
      else childrenOf.set(key, [child]);
    }

    const nested: DetailedOutputUnit[] = [];
    for (const k of node.keywords) {
      const suffix = "/" + escapeSegment(k.name);
      const kwUnit: DetailedOutputUnit = {
        valid: k.valid,
        keywordLocation: keywordLocation + suffix,
        absoluteKeywordLocation: absoluteKeywordLocation + suffix,
        instanceLocation,
      };
      const kwErrs = errs.filter((e) => e.keywordName === k.name);
      if (kwErrs.length > 0) kwUnit.error = joinMessages(kwErrs);
      const kwAnn = anns.find((a) => a.keywordName === k.name);
      if (kwAnn !== undefined) kwUnit.annotation = kwAnn.value;
      const applied = childrenOf.get(k.name);
      if (applied !== undefined) {
        childrenOf.delete(k.name);
        attachNested(kwUnit, applied.map(build));
      }
      nested.push(kwUnit);
    }
    // Applications not attributable to a keyword entry (a custom keyword
    // applying with no segment of its own) stay under the application node,
    // appended one by one: a stray list holds one entry per application, and
    // an argument spread over it has a native-stack ceiling.
    for (const stray of childrenOf.values()) {
      for (const child of stray) nested.push(build(child));
    }
    attachNested(unit, nested);
    return unit;
  };
  return build(root);
}

// Detailed condensation (§13.4.3): nodes with no children are removed, nodes
// with a single child are replaced by the child; the root always remains.
function condense(
  unit: DetailedOutputUnit,
  isRoot: boolean,
): DetailedOutputUnit | undefined {
  const nested = nestedOf(unit)
    .map((n) => condense(n, false))
    .filter((n): n is DetailedOutputUnit => n !== undefined);
  const local = unit.error !== undefined || unit.annotation !== undefined;
  if (!local && !isRoot) {
    if (nested.length === 0) return undefined;
    if (nested.length === 1) return nested[0];
  }
  const out: DetailedOutputUnit = {
    valid: unit.valid,
    keywordLocation: unit.keywordLocation,
    absoluteKeywordLocation: unit.absoluteKeywordLocation,
    instanceLocation: unit.instanceLocation,
  };
  if (unit.error !== undefined) out.error = unit.error;
  if (unit.annotation !== undefined) out.annotation = unit.annotation;
  attachNested(out, nested);
  return out;
}

/** Detailed output document (IETF draft-03 §13.4.3): the condensed keyword-level tree of relevant results. */
export function renderDetailed(
  root: TraceNode,
  records: EvaluationRecords,
  selection: boolean | AnnotationSelection,
): DetailedOutputUnit {
  return condense(
    buildDraft03Tree(root, records, selection, "relevant"),
    true,
  )!;
}

/** Verbose output document (IETF draft-03 §13.4.4): the full keyword-level tree, irrelevant results included. */
export function renderVerbose(
  root: TraceNode,
  records: EvaluationRecords,
  selection: boolean | AnnotationSelection,
): DetailedOutputUnit {
  return buildDraft03Tree(root, records, selection, "verbose");
}

/**
 * One schema application from a traced evaluation.
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
  /** JSON Pointer of the input position this application evaluated. */
  readonly inputLocation: string;
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
      schemaLocation: schemaLocationOf(node.schemaRef, null),
      inputLocation: instancePointer(node.cursor),
      valid: node.valid,
      errorIndexes: indexesAt.get(node.pathNode) ?? NO_INDEXES,
      children: node.children.map((c) => toUnit(c, node.pathNode)),
    };
  };
  return toUnit(root, null);
}

/** One error of the Basic document (IETF draft-03 §13.4.2). */
export interface BasicErrorUnit {
  keywordLocation: string;
  absoluteKeywordLocation: string;
  instanceLocation: string;
  error: string;
}

/** One annotation of the Basic document (IETF draft-03 §13.4.2). */
export interface BasicAnnotationUnit {
  keywordLocation: string;
  absoluteKeywordLocation: string;
  instanceLocation: string;
  annotation: unknown;
}

/**
 * Basic output document (IETF draft-03 §13.4.2): a root unit with a flat
 * `errors` array on failure or `annotations` array on success, one unit per
 * record, each located at its keyword.
 */
export interface BasicOutputDocument {
  valid: boolean;
  keywordLocation: string;
  absoluteKeywordLocation: string;
  instanceLocation: string;
  errors?: BasicErrorUnit[];
  annotations?: BasicAnnotationUnit[];
}

/**
 * Basic output document: per the suite's output-tests basic fixtures,
 * `errors` is absent on success; `annotations` appears only when selected
 * and non-empty.
 */
export function renderBasic(
  valid: boolean,
  rootRef: LocationRef,
  errors: readonly ErrorRecord[],
  rootAnnotations: readonly AnnotationRecord[],
  selection: boolean | AnnotationSelection,
): BasicOutputDocument {
  const doc: BasicOutputDocument = {
    valid,
    keywordLocation: "",
    absoluteKeywordLocation: schemaLocationOf(rootRef, null),
    instanceLocation: "",
  };
  if (valid) {
    const anns = selectAnnotations(rootAnnotations, selection).map(
      (a): BasicAnnotationUnit => ({
        keywordLocation: evaluationPathOf(a.pathNode, a.keywordName),
        absoluteKeywordLocation: schemaLocationOf(a.schemaRef, a.keywordName),
        instanceLocation: instancePointer(a.cursor),
        annotation: a.value,
      }),
    );
    if (anns.length > 0) doc.annotations = anns;
  } else {
    doc.errors = errors.map((e): BasicErrorUnit => ({
      keywordLocation: evaluationPathOf(e.pathNode, e.keywordName),
      absoluteKeywordLocation: schemaLocationOf(e.schemaRef, e.keywordName),
      instanceLocation: instancePointer(e.cursor),
      error: e.message,
    }));
  }
  return doc;
}
