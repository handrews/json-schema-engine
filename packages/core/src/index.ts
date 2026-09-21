// @json-schema-engine/core public API: sync evaluation over registered schemas (D7); the
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
  NonUnicodeRegexError,
  classifyRegex,
  detectUnsafeRegex,
} from "./regex.js";
import {
  LoadedDocument,
  SchemaLoader,
  SourceLocation,
  SourceRange,
} from "./loader.js";
import { AnnotationUnit, ErrorUnit, makeRecordPredicate } from "./output.js";
import {
  type EvaluateOptions,
  type Result,
  type ResultFor,
  assembleResult,
  resolveOutputDemand,
} from "./result.js";
import {
  type RecordSets,
  renderError,
  renderSelected,
  schemaLocationOf,
  toRenderNode,
} from "./records.js";
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
export {
  UnsafeRegexError,
  NonUnicodeRegexError,
  detectUnsafeRegex,
  classifyRegex,
} from "./regex.js";
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
export {
  makeRecordPredicate,
  renderBasic,
  renderDetailed,
  renderHierarchical,
  renderList,
  renderTrace,
  renderVerbose,
} from "./output.js";
export {
  renderAnnotation,
  renderError,
  traceToRenderNodes,
} from "./records.js";
export type { MutableRenderNode } from "./records.js";
export {
  OutputOptionsError,
  assembleResult,
  resolveOutputDemand,
} from "./result.js";
export type {
  EvaluateOptions,
  OutputDemand,
  OutputDocuments,
  OutputFormat,
  Result,
  ResultFor,
  ResultUnits,
} from "./result.js";
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
  IrrelevantRendering,
  ListOutputDocument,
  OutputUnit,
  RenderInput,
  RenderNode,
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
   * Reject a schema at registration when a `pattern`/`patternProperties`
   * regex is not valid under ECMA-262 unicode mode (the `u` flag), throwing
   * {@link NonUnicodeRegexError}. Off by default: such a pattern otherwise
   * compiles through the non-unicode grammar's Annex B extensions
   * ({@link classifyRegex} reports it as `"legacy"`), which is lenient
   * toward existing schemas but not what JSON Schema specifies and not
   * portable to other implementations. A pattern invalid under both
   * grammars is rejected as well.
   */
  strictUnicodeRegex?: boolean;
  /**
   * Maximum schema-nesting (registration) and schema-application
   * (evaluation) depth before {@link MaxDepthExceededError}. Bounds otherwise
   * unbounded recursion on adversarial input; default
   * {@link DEFAULT_MAX_DEPTH}.
   */
  maxDepth?: number;
  /**
   * Format implementations (M7; \@json-schema-engine/formats supplies standard tables).
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
 * \@json-schema-engine/core public API: synchronous evaluation over registered schemas,
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
    // Installed after the trusted metaschemas register, so the screens apply
    // only to caller schemas (D20).
    const screens: ((pattern: string, location: string) => void)[] = [];
    if (options.rejectUnsafeRegex) {
      screens.push((pattern, location) => {
        const verdict = detectUnsafeRegex(pattern);
        if (!verdict.safe) {
          throw new UnsafeRegexError(
            `unsafe regex at '${location}': ${verdict.reason}`,
          );
        }
      });
    }
    if (options.strictUnicodeRegex) {
      screens.push((pattern, location) => {
        const kind = classifyRegex(pattern);
        if (kind === "legacy") {
          throw new NonUnicodeRegexError(
            `regex at '${location}' is not valid in ECMA-262 unicode mode ` +
              `and would compile only through the legacy (Annex B) grammar`,
          );
        }
        if (kind === "invalid") {
          throw new NonUnicodeRegexError(
            `regex at '${location}' is not a valid ECMA-262 regular expression`,
          );
        }
      });
    }
    if (screens.length > 0) {
      this.schemas.onRegex = (pattern, location) => {
        for (const screen of screens) screen(pattern, location);
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
    const demand = resolveOutputDemand(options);
    const { valid, state } = runEvaluation(
      this.schemas,
      schemaUri,
      instance,
      demand.tracing,
      makeRecordPredicate(demand.annotations),
      this.regexCache,
      this.maxDepth,
    );
    if (demand.format === "flag") return { valid };

    // The flat surface first; its record arrays stay paired with the unit
    // arrays so the located tree can index the units.
    const params = options.errorParams ?? false;
    const records: RecordSets = {
      errors: state.errors,
      droppedErrors: [],
      annotations: [],
      droppedAnnotations: [],
    };
    const errors = state.errors.map((e) => renderError(e, params));
    let annotations: AnnotationUnit[] = [];
    if (valid && demand.annotations !== false) {
      const selected = renderSelected(
        state.rootAnnotations,
        demand.annotations,
      );
      records.annotations = selected.records;
      annotations = selected.units;
    }
    let droppedErrors: ErrorUnit[] = [];
    let droppedAnnotations: AnnotationUnit[] = [];
    if (demand.verbose) {
      records.droppedErrors = state.droppedErrors ?? [];
      droppedErrors = records.droppedErrors.map((e) => renderError(e, params));
      if (demand.annotations !== false) {
        // The relevant annotations are a valid run's root survivors; an
        // invalid run has none (draft-03 §12.2).
        const relevant = new Set(valid ? state.rootAnnotations : []);
        const selected = renderSelected(
          (state.allAnnotations ?? []).filter((a) => !relevant.has(a)),
          demand.annotations,
        );
        records.droppedAnnotations = selected.records;
        droppedAnnotations = selected.units;
      }
    }
    const root = demand.tracing
      ? toRenderNode(state.traceRoot!, records)
      : null;
    const result = assembleResult(
      demand,
      valid,
      { errors, droppedErrors, annotations, droppedAnnotations },
      root,
      schemaLocationOf(this.schemas.rootRef(schemaUri), null),
      options.trace === true,
    );
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
