// Output rendering (DESIGN.md D6; ADR 0003): the flat surface — units with
// the engine's native field names (evaluationPath, schemaLocation,
// inputLocation) — plus a located tree of schema applications, rendered by
// format name into each documented structure: IETF draft-03 §13 for
// basic/detailed/verbose, the machines-oriented output proposal for
// list/hierarchical. Everything here consumes strings and indexes, never
// engine records, so any producer of a RenderInput — the interpreter's
// trace (records.ts) or a compiled artifact — renders through one code path.

import { escapeSegment, unescapeSegment } from "./json.js";
import { pointerFragment } from "./uri.js";
import { ErrorParams } from "./dialect.js";
import type { KeywordTrace, RecordPredicate } from "./engine.js";
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
 * subtract after them, and `keep` runs last on the rendered native unit —
 * the very unit the flat surface then carries.
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

// Selection applies to annotation records only (§4 rule 5); dependency
// records live in a separate store, so no selection can hide one from
// ctx.visible().

/**
 * Annotation recording decision (D5): record iff the selection might render
 * the annotation — `false` records nothing, `true` everything, and a
 * selection object's allow/deny lists rule keywords out. The `keep`
 * predicate runs only at render: recording a superset of what it keeps is
 * correct, eliding on its behalf would not be. This is also the list stage
 * of the interpreter's render-time selection (records.ts), so the two can
 * never disagree. It applies at every output level: a deselected keyword's
 * annotation is never rendered, relevant or not.
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

/**
 * One schema application in a located evaluation tree: what the document
 * renderers need from any producer, the interpreter's trace or a compiled
 * artifact. Locations are absolute strings; records are indexes into the
 * owning {@link RenderInput}'s flat arrays.
 *
 * Producers keep three invariants: a child's `evaluationPath` equals or
 * extends its parent's; a unit indexed at a node has the node's
 * `evaluationPath` (a boolean `false` schema) or extends it by exactly one
 * escaped segment, the keyword; `keywords` lists the node's non-structural
 * keyword evaluations in evaluation order.
 */
export interface RenderNode {
  /** Escaped JSON Pointer of the evaluation path; `""` at the root. */
  readonly evaluationPath: string;
  /** Canonical schema location of the applied subschema: `baseUri#pointer`. */
  readonly schemaLocation: string;
  /** JSON Pointer of the input position this application evaluated. */
  readonly inputLocation: string;
  readonly valid: boolean;
  readonly keywords: readonly KeywordTrace[];
  /** Indexes into {@link RenderInput.errors} of the errors raised here. */
  readonly errors: readonly number[];
  /** Indexes into {@link RenderInput.droppedErrors}. */
  readonly droppedErrors: readonly number[];
  /** Indexes into {@link RenderInput.annotations}. */
  readonly annotations: readonly number[];
  /** Indexes into {@link RenderInput.droppedAnnotations}. */
  readonly droppedAnnotations: readonly number[];
  /** Nested applications, in evaluation order. */
  readonly children: readonly RenderNode[];
}

/**
 * The flat surface plus its located tree: the input of every document
 * renderer. `droppedErrors` and `droppedAnnotations` are empty unless the
 * producer retained irrelevant records (verbose demand); relevant-level
 * renderings never read them.
 */
export interface RenderInput {
  /** relevant errors, encounter order (`Result.errors`) */
  readonly errors: readonly ErrorUnit[];
  /** errors of rejecting sub-evaluations under an accepting keyword */
  readonly droppedErrors: readonly ErrorUnit[];
  /** relevant annotations, already selected (`Result.annotations`) */
  readonly annotations: readonly AnnotationUnit[];
  /** irrelevant annotations, already selected */
  readonly droppedAnnotations: readonly AnnotationUnit[];
  readonly root: RenderNode;
}

/** The index list of a node without records, shared rather than allocated. */
export const NO_INDEXES: readonly number[] = [];

// A keyword's own path segment, `/`-prefixed and RFC 6901 escaped, memoized
// per name: keyword names come from the schema, a small set that every unit
// and every keyword node of the draft-03 tree repeats. The bound keeps a
// pathological schema from growing the cache without limit.
const suffixes = new Map<string, KeywordSuffix>();
const SUFFIX_CACHE_LIMIT = 1024;

/**
 * A keyword's own segment in both location forms: `plain` is the
 * `/`-prefixed RFC 6901 segment an `evaluationPath` (plain text) appends,
 * `fragment` the same segment percent-encoded for a `schemaLocation` (a
 * URI). Encoding the segment on its own equals encoding the joined pointer,
 * since percent-encoding works byte by byte.
 */
export interface KeywordSuffix {
  readonly plain: string;
  readonly fragment: string;
}

/** Both location forms of a keyword's own segment, memoized per name. */
export function keywordSuffix(name: string): KeywordSuffix {
  let suffix = suffixes.get(name);
  if (suffix === undefined) {
    if (suffixes.size >= SUFFIX_CACHE_LIMIT) suffixes.clear();
    const plain = "/" + escapeSegment(name);
    suffix = { plain, fragment: pointerFragment(plain) };
    suffixes.set(name, suffix);
  }
  return suffix;
}

// A unit at a node carries the node's path plus at most one keyword segment
// (RenderNode's invariant); the keyword name is that segment, decoded, and a
// boolean-`false` schema's error, located at the node itself, keys as "".
const keywordOf = (unit: ErrorUnit, node: RenderNode): string => {
  const rest = unit.evaluationPath.slice(node.evaluationPath.length);
  return rest === "" ? "" : unescapeSegment(rest.slice(1));
};

// The evaluation-path segments of `child` below `parentPath`, decoded.
const segmentsBelow = (child: RenderNode, parentPath: string): string[] => {
  const rest = child.evaluationPath.slice(parentPath.length);
  return rest === "" ? [] : rest.slice(1).split("/").map(unescapeSegment);
};

// The first of those segments, the applying keyword, without building the
// list: the draft-03 walk asks this once per child application.
const firstSegmentBelow = (
  child: RenderNode,
  parentPath: string,
): string | null => {
  const path = child.evaluationPath;
  if (path.length === parentPath.length) return null;
  const end = path.indexOf("/", parentPath.length + 1);
  return unescapeSegment(
    path.slice(parentPath.length + 1, end === -1 ? undefined : end),
  );
};

// Documents project unit fields into fresh objects and never embed a unit:
// the flat units are decorated (`positions`) after every document is built,
// and their `errorParams` fields belong to the flat surface only. Most
// nodes carry no records, so an empty pick allocates nothing.
const NO_UNITS: readonly never[] = [];
const pick = <T>(
  indexes: readonly number[],
  units: readonly T[],
): readonly T[] =>
  indexes.length === 0 ? NO_UNITS : indexes.map((i) => units[i]!);

// Relevant records followed by dropped ones; a node's records are uniformly
// one or the other, so the concatenation is reached only by a custom
// keyword sharing its parent's node.
const withDropped = <T>(
  relevant: readonly T[],
  dropped: readonly T[],
): readonly T[] =>
  relevant.length === 0
    ? dropped
    : dropped.length === 0
      ? relevant
      : [...relevant, ...dropped];

/**
 * Output unit of the machines-oriented proposal (`list`, `hierarchical`):
 * errors and annotations keyed by keyword name, nested results under
 * `details`. At the verbose level `droppedErrors`/`droppedAnnotations` mark
 * irrelevant records (draft-03 §12.2): the proposal defines
 * `droppedAnnotations` for a failed unit's own annotations, and the verbose
 * level extends the marker to every irrelevant record. The markers classify
 * records, not units: a unit's `valid`, even along its path, does not say
 * whether it is relevant.
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
 * How a `list`/`hierarchical` renderer treats irrelevant records: "omit"
 * drops them and prunes the units left empty (the relevant level); "mark"
 * keeps every unit and renders them under `droppedErrors`/
 * `droppedAnnotations` (the verbose level).
 */
export type IrrelevantRendering = "omit" | "mark";

// A keyword may report several errors (required's missing names); a
// one-message-per-keyword field joins them.
const joinMessages = (errs: readonly ErrorUnit[]): string =>
  errs.length === 1 ? errs[0]!.error : errs.map((e) => e.error).join("; ");

// The by-keyword records are keyed by names the schema chooses, and the
// documents stay ordinary objects (consumers compare them as plain JSON),
// so the one name an ordinary object already answers to — "__proto__",
// an accessor on Object.prototype — has to be defined as an own property:
// assigned, a primitive would be discarded and an object would replace the
// record's prototype with schema-derived data.
function setKeyed<T>(record: Record<string, T>, key: string, value: T): void {
  if (key === "__proto__") {
    Object.defineProperty(record, key, {
      value,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  } else {
    record[key] = value;
  }
}

function errorsByKeyword(
  errs: readonly ErrorUnit[],
  node: RenderNode,
): Record<string, string> {
  const byKeyword: Record<string, string> = {};
  for (const e of errs) {
    const key = keywordOf(e, node);
    const prior = Object.hasOwn(byKeyword, key) ? byKeyword[key] : undefined;
    setKeyed(
      byKeyword,
      key,
      prior === undefined ? e.error : `${prior}; ${e.error}`,
    );
  }
  return byKeyword;
}

function annotationsByKeyword(
  anns: readonly AnnotationUnit[],
): Record<string, unknown> {
  const byKeyword: Record<string, unknown> = {};
  for (const a of anns) setKeyed(byKeyword, a.keyword, a.annotation);
  return byKeyword;
}

/**
 * HIERARCHICAL structure over the located tree. Units carry errors and
 * annotations keyed by keyword name. Irrelevant records render per
 * {@link IrrelevantRendering}; the root unit always remains.
 */
export function renderHierarchical(
  input: RenderInput,
  irrelevant: IrrelevantRendering,
): OutputUnit {
  const unitOf = (node: RenderNode): OutputUnit => ({
    valid: node.valid,
    evaluationPath: node.evaluationPath,
    schemaLocation: node.schemaLocation,
    instanceLocation: node.inputLocation,
  });

  const toUnit = (node: RenderNode): OutputUnit | undefined => {
    let details: OutputUnit[] | undefined;
    for (const child of node.children) {
      const rendered = toUnit(child);
      if (rendered === undefined) continue;
      if (details === undefined) details = [rendered];
      else details.push(rendered);
    }

    const unit = unitOf(node);

    const errs = pick(node.errors, input.errors);
    if (errs.length > 0) unit.errors = errorsByKeyword(errs, node);
    if (irrelevant === "mark") {
      const dropped = pick(node.droppedErrors, input.droppedErrors);
      if (dropped.length > 0)
        unit.droppedErrors = errorsByKeyword(dropped, node);
    }

    const anns = pick(node.annotations, input.annotations);
    if (anns.length > 0) unit.annotations = annotationsByKeyword(anns);
    if (irrelevant === "mark") {
      const dropped = pick(node.droppedAnnotations, input.droppedAnnotations);
      if (dropped.length > 0) {
        unit.droppedAnnotations = annotationsByKeyword(dropped);
      }
    }

    if (details !== undefined) unit.details = details;

    // Relevant level: a unit carrying nothing relevant is omitted. The
    // proposal includes every unit and makes such pruning opt-in; pruning
    // by default is this engine's relevant level (draft-03 §12.2, §13.4),
    // and "mark" is the unpruned structure.
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

  return toUnit(input.root) ?? unitOf(input.root);
}

/**
 * LIST structure over the located tree: the same per-application units as
 * HIERARCHICAL, flattened under a root unit that carries only `valid` and
 * `details`. At the relevant level only units that report an error or an
 * annotation appear (the proposal's SHOULD); the verbose level includes
 * every unit.
 */
export function renderList(
  input: RenderInput,
  irrelevant: IrrelevantRendering,
): ListOutputDocument {
  const nested = renderHierarchical(input, irrelevant);
  const details: OutputUnit[] = [];
  // Only a unit that reaches the list is copied without its `details`.
  const collect = (unit: OutputUnit): void => {
    if (
      irrelevant === "mark" ||
      unit.errors !== undefined ||
      unit.annotations !== undefined
    ) {
      const { details: _children, ...rest } = unit;
      details.push(rest);
    }
    unit.details?.forEach(collect);
  };
  collect(nested);
  return { valid: input.root.valid, details };
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

// `nested` is a fresh array the caller gives up: it is attached, not copied.
function attachNested(
  unit: DetailedOutputUnit,
  nested: DetailedOutputUnit[],
): void {
  if (nested.length === 0) return;
  // §13.3.5: nested results key on the node's own result.
  if (unit.valid) unit.annotations = nested;
  else unit.errors = nested;
}

const nestedOf = (unit: DetailedOutputUnit): DetailedOutputUnit[] =>
  unit.errors ?? unit.annotations ?? [];

/**
 * The draft-03 keyword-level tree (§13.4.3–13.4.4). Every schema application
 * becomes a node whose children are one node per keyword evaluation, in
 * evaluation order; each keyword node carries the keyword's own error or
 * annotation and the applications it performed. At the relevant level only
 * relevant records appear; the verbose level includes every record. A
 * record is relevant exactly when every node on its path from the root
 * shares the root's `valid` (§13.4.4), so no single node's `valid` marks it.
 */
function buildDraft03Tree(
  input: RenderInput,
  level: "relevant" | "verbose",
): DetailedOutputUnit {
  const build = (node: RenderNode): DetailedOutputUnit => {
    const {
      evaluationPath: keywordLocation,
      schemaLocation: absoluteKeywordLocation,
      inputLocation: instanceLocation,
    } = node;
    const unit: DetailedOutputUnit = {
      valid: node.valid,
      keywordLocation,
      absoluteKeywordLocation,
      instanceLocation,
    };
    const errs =
      level === "verbose"
        ? withDropped(
            pick(node.errors, input.errors),
            pick(node.droppedErrors, input.droppedErrors),
          )
        : pick(node.errors, input.errors);
    const anns =
      level === "verbose"
        ? withDropped(
            pick(node.annotations, input.annotations),
            pick(node.droppedAnnotations, input.droppedAnnotations),
          )
        : pick(node.annotations, input.annotations);
    // A boolean `false` schema's error belongs to the application itself.
    if (errs.length > 0) {
      const own = errs.filter((e) => e.evaluationPath === keywordLocation);
      if (own.length > 0) unit.error = joinMessages(own);
    }

    // The first evaluation-path segment of a child application below its
    // parent names the applying keyword. Most applications have none.
    let childrenOf: Map<string | null, RenderNode[]> | undefined;
    if (node.children.length > 0) {
      childrenOf = new Map();
      for (const child of node.children) {
        const key = firstSegmentBelow(child, keywordLocation);
        const list = childrenOf.get(key);
        if (list) list.push(child);
        else childrenOf.set(key, [child]);
      }
    }

    const nested: DetailedOutputUnit[] = [];
    for (const k of node.keywords) {
      const suffix = keywordSuffix(k.name);
      const kwLocation = keywordLocation + suffix.plain;
      const kwUnit: DetailedOutputUnit = {
        valid: k.valid,
        keywordLocation: kwLocation,
        // `keywordLocation` is a plain-text pointer and
        // `absoluteKeywordLocation` a URI: the same segment in two forms.
        absoluteKeywordLocation: absoluteKeywordLocation + suffix.fragment,
        instanceLocation,
      };
      if (errs.length > 0) {
        const kwErrs = errs.filter((e) => e.evaluationPath === kwLocation);
        if (kwErrs.length > 0) kwUnit.error = joinMessages(kwErrs);
      }
      if (anns.length > 0) {
        const kwAnn = anns.find((a) => a.keyword === k.name);
        if (kwAnn !== undefined) kwUnit.annotation = kwAnn.annotation;
      }
      const applied = childrenOf?.get(k.name);
      if (applied !== undefined) {
        childrenOf!.delete(k.name);
        attachNested(kwUnit, applied.map(build));
      }
      nested.push(kwUnit);
    }
    // Applications not attributable to a keyword entry (a custom keyword
    // applying with no segment of its own) stay under the application node,
    // in evaluation order — each child whose group no keyword entry
    // consumed, walked one by one rather than group by group, so the order
    // never depends on which child of a group came first (and a located
    // tree pruned of record-free applications renders identically).
    if (childrenOf !== undefined && childrenOf.size > 0) {
      for (const child of node.children) {
        if (childrenOf.has(firstSegmentBelow(child, keywordLocation))) {
          nested.push(build(child));
        }
      }
    }
    attachNested(unit, nested);
    return unit;
  };
  return build(input.root);
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
export function renderDetailed(input: RenderInput): DetailedOutputUnit {
  return condense(buildDraft03Tree(input, "relevant"), true)!;
}

/** Verbose output document (IETF draft-03 §13.4.4): the full keyword-level tree, irrelevant results included. */
export function renderVerbose(input: RenderInput): DetailedOutputUnit {
  return buildDraft03Tree(input, "verbose");
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

/**
 * Renders the located tree into the public trace. Error correlation is
 * positional: a node's `errors` indexes are its `errorIndexes`, and the
 * public tree carries decoded segments so consumers never touch pointer
 * escaping.
 */
export function renderTrace(root: RenderNode): TraceUnit {
  const toUnit = (node: RenderNode, parentPath: string): TraceUnit => ({
    segments: segmentsBelow(node, parentPath),
    schemaLocation: node.schemaLocation,
    inputLocation: node.inputLocation,
    valid: node.valid,
    errorIndexes: node.errors,
    children: node.children.map((c) => toUnit(c, node.evaluationPath)),
  });
  return toUnit(root, "");
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
 * Basic output document from the flat surface: `rootLocation` is the root
 * schema's canonical location, `errors` and `annotations` the relevant,
 * already selected units. Per the suite's output-tests basic fixtures,
 * `errors` is absent on success; `annotations` appears only when non-empty.
 */
export function renderBasic(
  valid: boolean,
  rootLocation: string,
  errors: readonly ErrorUnit[],
  annotations: readonly AnnotationUnit[],
): BasicOutputDocument {
  const doc: BasicOutputDocument = {
    valid,
    keywordLocation: "",
    absoluteKeywordLocation: rootLocation,
    instanceLocation: "",
  };
  if (valid) {
    if (annotations.length > 0) {
      doc.annotations = annotations.map((a): BasicAnnotationUnit => ({
        keywordLocation: a.evaluationPath,
        absoluteKeywordLocation: a.schemaLocation,
        instanceLocation: a.inputLocation,
        annotation: a.annotation,
      }));
    }
  } else {
    doc.errors = errors.map((e): BasicErrorUnit => ({
      keywordLocation: e.evaluationPath,
      absoluteKeywordLocation: e.schemaLocation,
      instanceLocation: e.inputLocation,
      error: e.error,
    }));
  }
  return doc;
}
