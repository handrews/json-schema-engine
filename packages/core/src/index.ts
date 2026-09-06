// @jse/core public API: sync evaluation over registered schemas (D7); the
// 2020-12 dialect preloaded; custom vocabularies/dialects via the same
// registry the built-ins use. Resource I/O is the one async boundary:
// load/loadSchema pull in referenced resources through caller-supplied
// loaders and assemble dialects from metaschema $vocabulary declarations.

import { JsonValue, isObject } from "./json.js";
import { resolveUri, splitFragment, UnresolvableRefError } from "./uri.js";
import {
  DialectRegistry,
  DialectOptions,
  KeywordBehavior,
  UnknownDialectError,
  UnknownVocabularyError,
} from "./dialect.js";
import { DEFAULT_MAX_DEPTH, SchemaRegistry } from "./registry.js";
import { runEvaluation } from "./engine.js";
import {
  RegexCache,
  RegexEngine,
  UnsafeRegexError,
  detectUnsafeRegex,
} from "./regex.js";
import {
  LoadedDocument,
  SchemaLoader,
  SourceLocation,
  SourceRange,
} from "./loader.js";
import {
  AnnotationSelection,
  AnnotationUnit,
  BasicOutputDocument,
  DetailedOutputUnit,
  ErrorUnit,
  EvaluationRecords,
  ListOutputDocument,
  OutputUnit,
  makeRecordPredicate,
  renderAnnotations,
  renderBasic,
  renderDetailed,
  renderHierarchical,
  renderList,
  renderTrace,
  renderVerbose,
  TraceUnit,
} from "./output.js";
import { renderError } from "./records.js";
import {
  DIALECT_2020_12,
  registerStandardDialects,
} from "./keywords/vocab2020.js";
import {
  VOCAB_FORMAT_ASSERTION,
  assertingFormat,
  type FormatTable,
} from "./keywords/format.js";
import { METASCHEMAS_2020_12 } from "./keywords/metaschemas2020.js";
import { METASCHEMAS_2019_09 } from "./keywords/metaschemas2019.js";
import { METASCHEMAS_DRAFT_07 } from "./keywords/metaschemas7.js";
import { METASCHEMAS_DRAFT_06 } from "./keywords/metaschemas6.js";
import { VOCAB_CORE_2019 } from "./keywords/core.js";
import { identifiers2019, identifiers2020 } from "./dialect.js";

export type { JsonValue, JsonType } from "./json.js";
export type { Cursor } from "./cursor.js";
export { rootCursor, childCursor, instancePointer } from "./cursor.js";
export type { SchemaRef } from "./ref.js";
export type {
  Dialect,
  DialectKeyword,
  KeywordBehavior,
  KeywordContext,
  StaticFacts,
  DependencyView,
  DialectOptions,
  IdentifierFacts,
  IdentifierExtractor,
} from "./dialect.js";
export {
  DialectRegistry,
  ReadOnlyRegistryError,
  UnknownDialectError,
  UnknownVocabularyError,
  identifiers2020,
  identifiers2019,
  identifiersLegacy,
} from "./dialect.js";
export {
  DEFAULT_MAX_DEPTH,
  InvalidSchemaError,
  MaxDepthExceededError,
  SchemaRegistry,
} from "./registry.js";
export type { DocumentLocation } from "./registry.js";
export { UnsafeRegexError, detectUnsafeRegex } from "./regex.js";
export type { RegexEngine, CompiledRegex } from "./regex.js";
export { UnresolvableRefError } from "./uri.js";
export {
  InfiniteLoopError,
  KeywordContractError,
  UndeclaredConsumptionError,
  UndeclaredProductionError,
  UnknownKeywordError,
  evaluateFragment,
  materializePath,
  runEvaluation,
} from "./engine.js";
export type {
  AnnotationRecord,
  DependencyRecord,
  ErrorRecord,
  EvalState,
  Frame,
  FragmentOptions,
  KeywordTrace,
  PathNode,
  RecordPredicate,
  TraceNode,
} from "./engine.js";
export {
  canonicalKey,
  codePointLength,
  escapeSegment,
  firstDuplicatePair,
  hasDuplicateItems,
  jsonEqual,
  unescapeSegment,
} from "./json.js";
export { isMultipleOf } from "./keywords/validation.js";
export { walkSchema } from "./walk.js";
export type { SchemaWalkVisit } from "./walk.js";
export type {
  AnalyzeContext,
  ErrorParams,
  IndexCoverage,
  NameCoverage,
  SubschemaApplication,
} from "./dialect.js";
export { lowerIR } from "./lowering.js";
export { makeRecordPredicate } from "./output.js";
export { renderAnnotation, renderError } from "./records.js";
export type {
  LowerApply,
  LowerCursor,
  LowerExpr,
  LowerHelper,
  LowerMessage,
  LowerParams,
  LowerProduceValue,
  LowerStmt,
  LoweringContext,
} from "./lowering.js";
export {
  foldNameCoverage,
  foldIndexCoverage,
  harvestCoverage,
} from "./coverage.js";
export { RegexCache, defaultRegexEngine } from "./regex.js";
export type {
  AnnotationSelection,
  AnnotationUnit,
  BasicAnnotationUnit,
  BasicErrorUnit,
  BasicOutputDocument,
  DetailedOutputUnit,
  ErrorUnit,
  EvaluationRecords,
  IrrelevantRendering,
  ListOutputDocument,
  OutputUnit,
  TraceUnit,
} from "./output.js";
export type {
  LoadedDocument,
  SchemaLoader,
  SourceLocation,
  SourcePosition,
  SourceRange,
  SourceSpan,
} from "./loader.js";
export { DIALECT_2020_12 } from "./keywords/vocab2020.js";
export {
  UnknownFormatError,
  VOCAB_FORMAT_ASSERTION,
  assertingFormat,
} from "./keywords/format.js";
export type { FormatDefinition, FormatTable } from "./keywords/format.js";
export { DIALECT_2019_09 } from "./keywords/vocab2019.js";
export { DIALECT_DRAFT_07, DIALECT_DRAFT_06 } from "./keywords/vocab7.js";

/** Thrown by {@link EngineOptions.validateSchemas} when a registered schema fails its metaschema. */
export class SchemaValidationError extends Error {
  constructor(
    message: string,
    readonly errors: readonly ErrorUnit[],
  ) {
    super(message);
  }
}

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

/** Thrown by {@link Engine.evaluate} for an unsupported combination of output options (ADR 0003: no silent no-ops). */
export class OutputOptionsError extends Error {}

/** Options for {@link Engine.evaluate}. */
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

/** The result of {@link Engine.evaluate}. */
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
 * A widened `EvaluateOptions` yields the plain `Result`.
 */
export type ResultFor<O extends EvaluateOptions> = Result &
  ([O["output"]] extends [infer F extends keyof OutputDocuments]
    ? { outputDocument: OutputDocuments[F] }
    : unknown) &
  ([O["trace"]] extends [true] ? { trace: TraceUnit } : unknown);

interface OutputDemand {
  format: OutputFormat;
  /** the verbose level: irrelevant records are rendered, marked */
  verbose: boolean;
  /** the trace is built: every format but flag and basic, or `trace: true` */
  tracing: boolean;
  annotations: boolean | AnnotationSelection;
}

// Every combination of controls is supported or rejected here, before any
// evaluation (ADR 0003).
function resolveOutput(options: EvaluateOptions): OutputDemand {
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

/** Options for {@link Engine}'s constructor. */
export interface EngineOptions {
  /** dialect for documents without $schema; default 2020-12 */
  defaultDialect?: string;
  /** resource loaders, tried in order (D7) */
  loaders?: readonly SchemaLoader[];
  /**
   * Validate each load/register target against its metaschema when that
   * metaschema is registered as a schema resource. The standard metaschemas
   * for the built-in dialects are bundled; for custom dialects, an
   * unavailable metaschema means "cannot check", not failure — supply a
   * loader for it to get the check.
   */
  validateSchemas?: boolean;
  /**
   * Compile `pattern`/`patternProperties` through this engine instead of the
   * native `RegExp`. Supply a linear-time engine (e.g. RE2) to evaluate
   * untrusted schemas without exposure to catastrophic backtracking (ReDoS).
   * See docs/guide/security.md.
   */
  regexEngine?: RegexEngine;
  /**
   * Reject a schema at registration when a `pattern`/`patternProperties`
   * regex looks exponential-time ({@link detectUnsafeRegex}), throwing
   * {@link UnsafeRegexError}. A conservative static screen, off by default;
   * a linear-time `regexEngine` remains the only hard guarantee.
   */
  rejectUnsafeRegex?: boolean;
  /**
   * Maximum schema-nesting (registration) and schema-application
   * (evaluation) depth before {@link MaxDepthExceededError}. Bounds otherwise
   * unbounded recursion on adversarial input; default
   * {@link DEFAULT_MAX_DEPTH}.
   */
  maxDepth?: number;
  /**
   * Format implementations (M7; \@jse/formats supplies standard tables).
   * Enables the format-assertion vocabulary: a `$vocabulary` dialect
   * declaring it gets an asserting `format` that REFUSES unsupported
   * formats at registration ({@link UnknownFormatError}).
   */
  formats?: FormatTable;
  /**
   * Assert recognized formats in the standard dialects (all drafts) —
   * the spec's opt-in assertion configuration. Best effort: formats the
   * table lacks fall back to annotation-only. Requires `formats`.
   */
  assertFormats?: boolean;
}

/**
 * \@jse/core public API: synchronous evaluation over registered schemas,
 * with the 2020-12 dialect preloaded and async resource loading for
 * `$ref` closures and `$vocabulary`-assembled dialects.
 */
export class Engine {
  readonly dialects = new DialectRegistry();
  private schemas: SchemaRegistry;
  private defaultDialect: string;
  private loaders: SchemaLoader[];
  private validateSchemas: boolean;
  private regexCache: RegexCache;
  private maxDepth: number;
  private formatTable: FormatTable | undefined;
  // Dialect URIs whose assembly is in progress, to fail metaschema cycles.
  private assembling = new Set<string>();

  constructor(options: EngineOptions = {}) {
    if (options.assertFormats && !options.formats) {
      throw new TypeError("assertFormats requires a formats table");
    }
    registerStandardDialects(
      this.dialects,
      options.assertFormats
        ? {
            format: (id) => assertingFormat(id, options.formats!, false),
          }
        : {},
    );
    // The format-assertion vocabulary exists whenever a table is supplied;
    // without one, a dialect requiring it fails with UnknownVocabularyError,
    // which is the correct "cannot honor the assertion promise" answer.
    this.formatTable = options.formats;
    if (options.formats) {
      const table = options.formats;
      this.dialects.registerVocabulary(VOCAB_FORMAT_ASSERTION, {
        format: assertingFormat(
          `${VOCAB_FORMAT_ASSERTION}#format`,
          table,
          true,
        ),
      });
    }
    this.defaultDialect = splitFragment(
      options.defaultDialect ?? DIALECT_2020_12,
    ).resource;
    this.regexCache = new RegexCache(options.regexEngine);
    this.maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
    this.schemas = new SchemaRegistry(
      this.dialects,
      this.defaultDialect,
      this.maxDepth,
    );
    this.loaders = [...(options.loaders ?? [])];
    this.validateSchemas = options.validateSchemas ?? false;
    // Standard metaschemas are registered as ordinary schema resources so
    // that $refs to them resolve without loaders and validateSchemas can
    // check standard-dialect documents. Registered directly (not through
    // registerSchema) so the policy never self-validates them here.
    for (const [uri, doc] of METASCHEMAS_2020_12) {
      this.schemas.register(doc, uri);
    }
    for (const [uri, doc] of METASCHEMAS_2019_09) {
      this.schemas.register(doc, uri);
    }
    for (const [uri, doc] of METASCHEMAS_DRAFT_07) {
      this.schemas.register(doc, uri);
    }
    for (const [uri, doc] of METASCHEMAS_DRAFT_06) {
      this.schemas.register(doc, uri);
    }
    // Installed after the trusted metaschemas register, so the screen applies
    // only to caller schemas (D20).
    if (options.rejectUnsafeRegex) {
      this.schemas.onRegex = (pattern, location) => {
        const verdict = detectUnsafeRegex(pattern);
        if (!verdict.safe) {
          throw new UnsafeRegexError(
            `unsafe regex at '${location}': ${verdict.reason}`,
          );
        }
      };
    }
  }

  /** Registers an additional resource loader, tried after existing ones (D7). */
  addLoader(loader: SchemaLoader): void {
    this.loaders.push(loader);
  }

  /**
   * The engine's schema registry — the compiler tier's read surface (M6):
   * resolved refs, per-resource dialects, identifier indexes. Mutations go
   * through the Engine methods, not the registry; `snapshot()` yields the
   * read-only view a compiled artifact binds to.
   */
  get registry(): SchemaRegistry {
    return this.schemas;
  }

  /** The engine's compiled-pattern cache, shared with compiled artifacts (M6). */
  get patternCache(): RegexCache {
    return this.regexCache;
  }

  /**
   * The format table backing this engine's asserting `format`, or undefined
   * when none was configured — the compiler tier's read surface for
   * format-assertion lowering (M7). The asserting `format` behaviors close
   * over this same table, so a compiled `formatTest` and the interpreter agree.
   */
  get formats(): FormatTable | undefined {
    return this.formatTable;
  }

  /**
   * Register a local schema document synchronously; returns its canonical
   * base URI. References to unregistered resources are not loaded — use
   * loadSchema for that.
   */
  registerSchema(
    schema: JsonValue,
    retrievalUri: string,
    dialectUri?: string,
    getRange?: (pointer: string) => SourceRange | undefined,
  ): string {
    const baseUri = this.schemas.register(
      schema,
      retrievalUri,
      dialectUri,
      getRange,
    );
    this.maybeValidate(baseUri);
    return baseUri;
  }

  /**
   * Register a schema document and load everything it transitively
   * references through the configured loaders. Loader misses for referenced
   * resources are not errors here; evaluation reports them if the reference
   * is actually followed.
   */
  async loadSchema(
    schema: JsonValue,
    retrievalUri: string,
    dialectUri?: string,
    getRange?: (pointer: string) => SourceRange | undefined,
  ): Promise<string> {
    await this.ensureDialectFor(schema, retrievalUri, dialectUri);
    const baseUri = this.schemas.register(
      schema,
      retrievalUri,
      dialectUri,
      getRange,
    );
    await this.loadPending();
    this.maybeValidate(baseUri);
    return baseUri;
  }

  /** Fetch a resource by URI through the loaders and register its closure. */
  async load(uri: string): Promise<string> {
    const resource = splitFragment(uri).resource;
    const baseUri = await this.loadResource(resource);
    if (baseUri === undefined) {
      throw new UnresolvableRefError(`no loader provided '${resource}'`);
    }
    await this.loadPending();
    this.maybeValidate(baseUri);
    return baseUri;
  }

  /** Registers a vocabulary's keyword behaviors under its URI. */
  registerVocabulary(
    uri: string,
    keywords: Readonly<Record<string, KeywordBehavior>>,
  ): void {
    this.dialects.registerVocabulary(uri, keywords);
  }

  /**
   * Assembles a dialect from already-registered vocabularies.
   * @throws UnknownDialectError if a listed vocabulary is not registered.
   */
  registerDialect(
    uri: string,
    vocabularyUris: readonly string[],
    options?: DialectOptions,
  ): void {
    this.dialects.registerDialect(uri, vocabularyUris, options);
  }

  /**
   * Where a schema resource lives within its registered document: the
   * containing document plus the resource root's document-rooted pointer
   * (D17 bridge; see loader.ts), for source-position lookup.
   */
  documentLocation(resourceUri: string) {
    return this.schemas.documentLocation(resourceUri);
  }

  /**
   * Translates a canonical schema location (`resourceUri#/pointer`) to its
   * document, document-rooted pointer, and — when the document's loader
   * reported positions — source range (D17 bridge; see loader.ts).
   */
  locate(schemaLocation: string): SourceLocation | undefined {
    const { resource, fragment } = splitFragment(schemaLocation);
    const loc = this.schemas.documentLocation(resource);
    if (loc === undefined) return undefined;
    const pointer = loc.pointer + (fragment ?? "");
    const range = this.schemas.range(loc.documentUri, pointer);
    return range === undefined
      ? { documentUri: loc.documentUri, pointer }
      : { documentUri: loc.documentUri, pointer, range };
  }

  /**
   * Evaluates an instance against a registered schema. Literal options
   * narrow the result ({@link ResultFor}); an unsupported combination of
   * options throws {@link OutputOptionsError} before evaluating.
   */
  evaluate<O extends EvaluateOptions>(
    schemaUri: string,
    instance: JsonValue,
    options?: O,
  ): ResultFor<O>;
  evaluate(
    schemaUri: string,
    instance: JsonValue,
    options: EvaluateOptions = {},
  ): Result {
    const demand = resolveOutput(options);
    const { valid, state } = runEvaluation(
      this.schemas,
      schemaUri,
      instance,
      demand.tracing,
      makeRecordPredicate(demand.annotations),
      this.regexCache,
      this.maxDepth,
    );

    const result: Result = { valid };
    if (demand.format === "flag") return result;

    const params = options.errorParams ?? false;
    if (!valid) {
      result.errors = state.errors.map((e) => renderError(e, params));
    }
    if (valid && demand.annotations !== false) {
      result.annotations = renderAnnotations(
        state.rootAnnotations,
        demand.annotations,
      );
    }
    // The relevant annotations are a valid run's root survivors; an invalid
    // run has none (draft-03 §12.2).
    const relevant = new Set(valid ? state.rootAnnotations : []);
    if (demand.verbose) {
      result.droppedErrors = (state.droppedErrors ?? []).map((e) =>
        renderError(e, params),
      );
      if (demand.annotations !== false) {
        result.droppedAnnotations = renderAnnotations(
          (state.allAnnotations ?? []).filter((a) => !relevant.has(a)),
          demand.annotations,
        );
      }
    }
    if (options.trace) {
      // Correlation is positional against result.errors, which only exists
      // on failure — a valid run's trace carries no error indexes.
      result.trace = renderTrace(state.traceRoot!, valid ? [] : state.errors);
    }

    const records = (): EvaluationRecords => ({
      errors: state.errors,
      droppedErrors: state.droppedErrors ?? [],
      annotations: state.allAnnotations ?? [],
      relevant,
    });
    const structured = {
      irrelevant: demand.verbose ? ("mark" as const) : ("omit" as const),
      annotations: demand.annotations,
    };
    switch (demand.format) {
      case "basic":
        result.outputDocument = renderBasic(
          valid,
          this.schemas.rootRef(schemaUri),
          state.errors,
          state.rootAnnotations,
          demand.annotations,
        );
        break;
      case "list":
        result.outputDocument = renderList(
          state.traceRoot!,
          records(),
          structured,
        );
        break;
      case "hierarchical":
        result.outputDocument = renderHierarchical(
          state.traceRoot!,
          records(),
          structured,
        );
        break;
      case "detailed":
        result.outputDocument = renderDetailed(
          state.traceRoot!,
          records(),
          demand.annotations,
        );
        break;
      case "verbose":
        result.outputDocument = renderVerbose(
          state.traceRoot!,
          records(),
          demand.annotations,
        );
        break;
    }
    if (options.positions) {
      this.decorate(result.errors);
      this.decorate(result.annotations);
      this.decorate(result.droppedErrors);
      this.decorate(result.droppedAnnotations);
    }
    return result;
  }

  private decorate(
    units: readonly ErrorUnit[] | readonly AnnotationUnit[] | undefined,
  ): void {
    for (const unit of units ?? []) {
      const source = this.locate(unit.schemaLocation);
      if (source !== undefined) unit.source = source;
    }
  }

  private async fetch(resource: string): Promise<LoadedDocument | undefined> {
    for (const loader of this.loaders) {
      const doc = await loader(resource);
      if (doc !== undefined) return doc;
    }
    return undefined;
  }

  /** Fetch + register one resource; undefined when no loader handles it. */
  private async loadResource(resource: string): Promise<string | undefined> {
    if (this.schemas.has(resource)) return resource;
    const doc = await this.fetch(resource);
    if (doc === undefined) return undefined;
    await this.ensureDialectFor(doc.value, resource);
    return this.schemas.register(doc.value, resource, undefined, doc.getRange);
  }

  // Drain reference targets collected by registration walks until closure.
  // Each round may register documents whose own walks add new targets.
  private async loadPending(): Promise<void> {
    for (;;) {
      const missing = this.schemas.takeUnresolved();
      if (missing.length === 0) return;
      for (const resource of missing) {
        await this.loadResource(resource);
      }
    }
  }

  // Make the document's dialect exist before registration: known dialects
  // pass through; otherwise the $schema target is loaded as a metaschema and
  // a dialect is assembled from its $vocabulary (spec §8.1).
  private async ensureDialectFor(
    schema: JsonValue,
    retrievalUri: string,
    dialectUri?: string,
  ): Promise<void> {
    let effective = splitFragment(dialectUri ?? this.defaultDialect).resource;
    if (isObject(schema) && typeof schema.$schema === "string") {
      effective = splitFragment(
        resolveUri(schema.$schema, retrievalUri),
      ).resource;
    }
    if (this.dialects.hasDialect(effective)) return;
    if (this.assembling.has(effective)) {
      throw new UnknownDialectError(`metaschema cycle at '${effective}'`);
    }
    this.assembling.add(effective);
    try {
      const metaBase = await this.loadResource(effective);
      const meta =
        metaBase === undefined ? undefined : this.schemas.document(metaBase);
      if (meta === undefined) {
        throw new UnknownDialectError(
          `dialect '${effective}' is not registered and no loader provides its metaschema`,
        );
      }
      this.assembleDialect(effective, meta);
    } finally {
      this.assembling.delete(effective);
    }
  }

  private assembleDialect(uri: string, meta: JsonValue): void {
    const declared = isObject(meta) ? meta.$vocabulary : undefined;
    if (!isObject(declared)) {
      // The spec leaves $vocabulary-less metaschemas open; the least-surprise
      // reading is the default dialect's vocabulary set and syntax options.
      const base = this.dialects.getDialect(this.defaultDialect);
      this.dialects.registerDialect(uri, base.vocabularyUris, {
        allowUnknownKeywords: base.allowUnknownKeywords,
        identifiers: base.identifiers,
        refIgnoresSiblings: base.refIgnoresSiblings,
      });
      return;
    }
    const uris: string[] = [];
    for (const [vocabUri, required] of Object.entries(declared)) {
      if (this.dialects.hasVocabulary(vocabUri)) {
        uris.push(vocabUri);
      } else if (required === true) {
        throw new UnknownVocabularyError(
          `dialect '${uri}' requires unknown vocabulary '${vocabUri}'`,
        );
      }
      // Unknown optional vocabularies are skipped; their keywords fall to
      // unknown-keyword annotation handling (spec MUST for false).
    }
    // Identifier syntax travels with the core vocabulary (D18): a dialect
    // assembled around the 2019-09 core gets 2019-09 identifier handling.
    this.dialects.registerDialect(uri, uris, {
      identifiers: uris.includes(VOCAB_CORE_2019)
        ? identifiers2019
        : identifiers2020,
    });
  }

  private maybeValidate(baseUri: string): void {
    if (!this.validateSchemas) return;
    const dialectUri = this.schemas.dialectUriFor(baseUri);
    if (!this.schemas.has(dialectUri)) return; // metaschema document unavailable
    const doc = this.schemas.document(baseUri)!;
    const result = this.evaluate(dialectUri, doc, { output: "list" });
    if (!result.valid) {
      throw new SchemaValidationError(
        `schema '${baseUri}' fails its metaschema '${dialectUri}'`,
        result.errors ?? [],
      );
    }
  }
}

/** Creates a new {@link Engine}. */
export const createEngine = (options?: EngineOptions): Engine =>
  new Engine(options);
