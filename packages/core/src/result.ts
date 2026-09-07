// Result assembly (ADR 0003): the option checks that admit or reject a
// combination of controls before any evaluation, and the assembly of a
// Result from the flat surface and the located tree. Both tiers use it —
// the interpreter after rendering its records, a compiled evaluator after
// recording its tree — so presence rules and key order have one owner.

import {
  type AnnotationSelection,
  type AnnotationUnit,
  type BasicOutputDocument,
  type DetailedOutputUnit,
  type ErrorUnit,
  type IrrelevantRendering,
  type ListOutputDocument,
  type OutputUnit,
  type RenderInput,
  type RenderNode,
  type TraceUnit,
  renderBasic,
  renderDetailed,
  renderHierarchical,
  renderList,
  renderTrace,
  renderVerbose,
} from "./output.js";

/**
 * Output format names (ADR 0003), each fixing a document structure and field
 * vocabulary: `flag`, `basic`, `detailed`, `verbose` from IETF draft-03 §13;
 * `list`, `hierarchical` from the machines-oriented output proposal.
 */
export type OutputFormat =
  "flag" | "basic" | "detailed" | "verbose" | "list" | "hierarchical";

const OUTPUT_FORMATS: ReadonlySet<string> = new Set<OutputFormat>([
  "flag",
  "basic",
  "detailed",
  "verbose",
  "list",
  "hierarchical",
]);

/** Thrown by `evaluate` for an unsupported combination of output options (ADR 0003: no silent no-ops). */
export class OutputOptionsError extends Error {}

/** Options for `Engine.evaluate`. */
export interface EvaluateOptions {
  /**
   * Output format, by name; default `"flag"` (the minimal level: `valid`
   * only). Every other name populates the flat `Result.errors`/
   * `Result.annotations` surface and renders `Result.outputDocument` in the
   * format's own structure ({@link OutputDocuments}).
   */
  output?: OutputFormat;
  /**
   * Request the verbose level for `list` or `hierarchical`: every unit is
   * kept and irrelevant records (draft-03 §12.2) render marked, as
   * `droppedErrors`/`droppedAnnotations` in the document and as
   * `Result.droppedErrors`/`Result.droppedAnnotations`. `basic` and
   * `detailed` are relevant-level by definition and reject it; `verbose` is
   * the verbose level by definition.
   */
  verbose?: boolean;
  /**
   * Which annotations reach output: `false` (default) none, `true` all, or
   * an {@link AnnotationSelection}. Independent of format and level; never
   * affects dependency data or validation.
   */
  annotations?: boolean | AnnotationSelection;
  /** Include `keyword`, `vocabulary`, and structured `params` on each flat error unit (D13). */
  errorParams?: boolean;
  /** Decorate flat units with schema-side source positions when available (D17). */
  positions?: boolean;
  /** Render the evaluation trace into `Result.trace`. */
  trace?: boolean;
}

/** The document type each non-minimal {@link OutputFormat} renders. */
export interface OutputDocuments {
  basic: BasicOutputDocument;
  detailed: DetailedOutputUnit;
  verbose: DetailedOutputUnit;
  list: ListOutputDocument;
  hierarchical: OutputUnit;
}

/** The result of an evaluation. */
export interface Result {
  valid: boolean;
  /** relevant errors, native field names; present on an invalid result of any non-flag format */
  errors?: ErrorUnit[];
  /** relevant annotations per the selection; present on a valid result when annotations are selected */
  annotations?: AnnotationUnit[];
  /** irrelevant errors (draft-03 §12.2); present at the verbose level */
  droppedErrors?: ErrorUnit[];
  /** irrelevant annotations per the selection; present at the verbose level when annotations are selected */
  droppedAnnotations?: AnnotationUnit[];
  /** the output document, in the requested format's structure ({@link OutputDocuments}) */
  outputDocument?: OutputDocuments[keyof OutputDocuments];
  /** the evaluation trace, present with `trace: true`; `errorIndexes` reference `errors` on this result */
  trace?: TraceUnit;
}

/**
 * {@link Result} narrowed by literal options: `outputDocument` takes the
 * requested format's document type and `trace` is present when requested.
 * A widened {@link EvaluateOptions} yields the plain `Result`.
 */
export type ResultFor<O extends EvaluateOptions> = Result &
  ([O["output"]] extends [infer F extends keyof OutputDocuments]
    ? { outputDocument: OutputDocuments[F] }
    : unknown) &
  ([O["trace"]] extends [true] ? { trace: TraceUnit } : unknown);

/** What an evaluation must produce for a resolved set of output options. */
export interface OutputDemand {
  format: OutputFormat;
  /** the verbose level: irrelevant records are rendered, marked */
  verbose: boolean;
  /** the located tree is built: every format but flag and basic, or `trace: true` */
  tracing: boolean;
  annotations: boolean | AnnotationSelection;
}

/**
 * Every combination of controls is supported or rejected here, before any
 * evaluation (ADR 0003).
 */
export function resolveOutputDemand(options: EvaluateOptions): OutputDemand {
  const format = options.output ?? "flag";
  if (!OUTPUT_FORMATS.has(format)) {
    throw new OutputOptionsError(`unknown output format '${format}'`);
  }
  const annotations = options.annotations ?? false;
  if (format === "flag") {
    const requested: [string, boolean][] = [
      ["verbose", options.verbose === true],
      ["annotations", annotations !== false],
      ["errorParams", options.errorParams === true],
      ["positions", options.positions === true],
      ["trace", options.trace === true],
    ];
    for (const [name, on] of requested) {
      if (on) {
        throw new OutputOptionsError(
          `'${name}' has no effect with output "flag", which carries no ` +
            `records (the minimal level); choose "basic" or another format`,
        );
      }
    }
  }
  if (
    options.verbose === true &&
    (format === "basic" || format === "detailed")
  ) {
    throw new OutputOptionsError(
      `'verbose' does not apply to output "${format}", a relevant-level ` +
        `format by definition (IETF draft-03 §13.4); use "verbose", or ` +
        `"list"/"hierarchical" with verbose: true`,
    );
  }
  if (options.verbose === false && format === "verbose") {
    throw new OutputOptionsError(
      `output "verbose" is the verbose level by definition; ` +
        `'verbose: false' contradicts it`,
    );
  }
  return {
    format,
    verbose: format === "verbose" || options.verbose === true,
    tracing:
      format !== "flag" && (format !== "basic" || options.trace === true),
    annotations,
  };
}

/**
 * The flat surface as one evaluation produced it. The arrays are placed on
 * the {@link Result} as they are; `annotations` is empty on an invalid run
 * or when none are selected, and the dropped pair is empty unless
 * irrelevant records were retained (verbose demand).
 */
export interface ResultUnits {
  errors: ErrorUnit[];
  droppedErrors: ErrorUnit[];
  annotations: AnnotationUnit[];
  droppedAnnotations: AnnotationUnit[];
}

/**
 * Assembles a {@link Result} from the flat surface and, when the demand
 * built one, the located tree. `root` is required whenever
 * `demand.tracing`; `rootLocation` is the root schema's canonical location
 * (the `basic` document's own).
 */
export function assembleResult(
  demand: OutputDemand,
  valid: boolean,
  units: ResultUnits,
  root: RenderNode | null,
  rootLocation: string,
  trace: boolean,
): Result {
  const result: Result = { valid };
  if (demand.format === "flag") return result;
  if (!valid) result.errors = units.errors;
  if (valid && demand.annotations !== false) {
    result.annotations = units.annotations;
  }
  if (demand.verbose) {
    result.droppedErrors = units.droppedErrors;
    if (demand.annotations !== false) {
      result.droppedAnnotations = units.droppedAnnotations;
    }
  }
  const input: RenderInput | null = demand.tracing
    ? {
        errors: units.errors,
        droppedErrors: units.droppedErrors,
        annotations: units.annotations,
        droppedAnnotations: units.droppedAnnotations,
        root: root!,
      }
    : null;
  if (trace) result.trace = renderTrace(input!.root);

  const irrelevant: IrrelevantRendering = demand.verbose ? "mark" : "omit";
  switch (demand.format) {
    case "basic":
      result.outputDocument = renderBasic(
        valid,
        rootLocation,
        units.errors,
        units.annotations,
      );
      break;
    case "list":
      result.outputDocument = renderList(input!, irrelevant);
      break;
    case "hierarchical":
      result.outputDocument = renderHierarchical(input!, irrelevant);
      break;
    case "detailed":
      result.outputDocument = renderDetailed(input!);
      break;
    case "verbose":
      result.outputDocument = renderVerbose(input!);
      break;
  }
  return result;
}
