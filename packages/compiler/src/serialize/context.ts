// The per-unit emission state every serializer module reads and writes:
// plan lookups, the keyword being emitted, the channel accumulators, and
// the D9 knobs. Behavior lives in the sibling modules as functions over it.

import {
  type RecordPredicate,
  type AnnotationSelection,
  type SchemaRegistry,
} from "@json-schema-engine/core";
import { type CodeChunk } from "../emit.js";
import type { CompilationPlan, PlannedUnit } from "../plan.js";

/** Thrown for an IR shape the serializer cannot emit (a planner/lowering bug). */
export class SerializeError extends Error {}

/**
 * Annotation-mode options threaded through serialization. Its presence (with
 * `output === "list"`) turns on annotation collection; the selection's
 * allow/deny lists are applied statically at annotate sites (the compiled
 * analogue of annotation elision — the same {@link makeRecordPredicate}
 * decision the interpreter's renderer makes). The `keep` predicate runs at
 * runtime in the artifact wrapper, never here.
 */
export interface AnnotateOptions {
  selection?: boolean | AnnotationSelection;
}

/**
 * Emission mode: "runtime" artifacts close over the Runtime object R
 * (instantiated via new Function); "standalone" artifacts are self-contained
 * ES modules whose preamble (standalone.ts) defines the same h_-named
 * helpers, so the body serialization is identical.
 */
export type EmitMode = "runtime" | "standalone";

/**
 * Optimization switches (M6.5). `conservative` artifacts disable inlining
 * and the plain-data fast paths — the fuzzer runs both configurations so an
 * optimization can never change a verdict unnoticed.
 */
export interface EmitFlags {
  inline: boolean;
  plainData: boolean;
}

/**
 * Output tier of the artifact (D10/M7-adjacent): "flag" = verdict-only,
 * fail-fast, zero allocation on the hot path; "list" = full error
 * collection with interpreter-exact units — no fail-fast, no
 * short-circuit, every branch runs (DESIGN §7 licensing), and error-unit
 * objects materialize only on failure paths (D9e).
 */
export type EmitOutput = "flag" | "list";
export const DEFAULT_FLAGS: EmitFlags = { inline: true, plainData: true };

/** How a plan is serialized; every field has the flag-mode default. */
export interface SerializeOptions {
  mode?: EmitMode;
  flags?: EmitFlags;
  output?: EmitOutput;
  /** structured `keyword`/`vocabulary`/`params` on error units (D13) */
  listParams?: boolean;
  /** annotation collection (a list-mode variant) */
  annotate?: AnnotateOptions;
  /**
   * Trace emission (a list-mode variant): every application records its
   * node in a located tree — locations, keyword verdicts, and the records
   * it raised — so the artifact renders every output format.
   */
  trace?: boolean;
}

/** Per-unit serialization state: bindings, keyword context, apply targets. */
export interface Counters {
  binding: number;
  tally: number;
  temp: number;
}

/**
 * The accumulator(s) a keyword's produce recipe reads: names build a deduped
 * `Set`, indexes a max tracker / applied flag / matched list. Set by
 * `beginKeyword` (keywords.ts) for a consumed producer in region emission,
 * and driven by the application call sites within the keyword's own
 * statements.
 */
export interface KeywordAnn {
  produceKind:
    "collectedNames" | "largestOrTrue" | "appliedTrue" | "matchedOrAllTrue";
  names?: CodeChunk;
  max?: CodeChunk;
  applied?: CodeChunk;
  matched?: CodeChunk;
}

export class UnitContext {
  currentKeyword = "";
  currentVocab: string | null = null;
  // State for the keyword currently being emitted: whether its annotate is
  // retained (static lists), whether its produce feeds the runtime coverage
  // channel (consumed producer), and the accumulators the produce reads. The
  // two flags are independent — retention must never affect coverage.
  annKwKept = false;
  covKwKept = false;
  annKw: KeywordAnn | null = null;
  // List-mode channel producers gate their push on the keyword's OWN verdict
  // (Appendix D: dependency data only from an accepting keyword); the unit's
  // `ok` cannot serve, since list mode continues past a failed sibling.
  kwOk: CodeChunk | null = null;
  // Object-guard CSE: one `const gN = (typeof x === "object" && …)` per
  // unit value, prepended by the body builder when used. Inlined `here`-
  // cursor children share the parent's guard (same value, same variable).
  objGuardVar: CodeChunk | null = null;
  objGuardUsed = false;
  /** set when this unit's body (incl. inlines) emits any unit/frag call */
  calledUnit = false;
  // Region emission (phase B): the current keyword's behavior id (for the
  // consumed-producer channel-push gate) and the JS variable + half bound by
  // each coverageFold, read by a following coverageCovers.
  currentBehaviorId = "";
  coverageFolds = new Map<
    number,
    { readonly var: CodeChunk; readonly half: "names" | "indexes" }
  >();

  /** Unit keys this context (transitively) inlined — their functions are omitted. */
  readonly inlinedKeys = new Set<string>();
  /**
   * Trace emission: the verdict variable of each present keyword,
   * pre-declared for the unit because `if` settles `then`/`else`'s verdicts
   * before those keywords' own (empty) statements run.
   */
  readonly kwVerdicts = new Map<string, CodeChunk>();

  constructor(
    readonly unit: PlannedUnit,
    readonly plan: CompilationPlan,
    readonly registry: SchemaRegistry,
    readonly fnIndex: Map<string, number>,
    readonly tableIndex: Map<string, number>,
    /** JS variable holding this unit's instance value (V, or an inline temp) */
    readonly valueVar: CodeChunk,
    /** shared per-function counters so inlined bodies never collide */
    readonly counters: Counters,
    /** unit keys on the current inline chain (self-inline guard) */
    readonly inlineStack: ReadonlySet<string>,
    /** parent context sharing the same instance value (here-cursor inline) */
    readonly guardParent: UnitContext | null = null,
    readonly flags: EmitFlags = DEFAULT_FLAGS,
    readonly output: EmitOutput = "flag",
    readonly listParams = false,
    readonly annMode = false,
    readonly annKeep: RecordPredicate | null = null,
    /** region emission: thread the runtime coverage channel `ev` (phase B) */
    readonly regionMode = false,
    /** behavior ids a consumer observes (region channel-push gate, rule 5) */
    readonly coverageIds: ReadonlySet<string> = new Set(),
    /** trace emission: record the application tree (SerializeOptions.trace) */
    readonly trace = false,
  ) {}
}
