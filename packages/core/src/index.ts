// @jse/core public API: sync evaluation over registered schemas (D7); the
// 2020-12 dialect preloaded; custom vocabularies/dialects via the same
// registry the built-ins use. Resource I/O is the one async boundary:
// load/loadSchema pull in referenced resources through caller-supplied
// loaders and assemble dialects from metaschema $vocabulary declarations.

import { JsonValue, isObject } from "./json.js";
import { resolveUri, splitFragment, UnresolvableRefError } from "./uri.js";
import {
  DialectRegistry, DialectOptions, KeywordBehavior,
  UnknownDialectError, UnknownVocabularyError,
} from "./dialect.js";
import { SchemaRegistry } from "./registry.js";
import { runEvaluation } from "./engine.js";
import { LoadedDocument, SchemaLoader, SourceLocation, SourceRange } from "./loader.js";
import {
  AnnotationUnit, ErrorUnit, LocationVocabulary, OutputUnit, RetentionPolicy,
  applyRetention, renderError, renderHierarchical,
} from "./output.js";
import { DIALECT_2020_12, registerStandardDialects } from "./keywords/vocab2020.js";
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
  KeywordBehavior, KeywordContext, StaticFacts, ProductionView, DialectOptions,
  IdentifierFacts, IdentifierExtractor,
} from "./dialect.js";
export {
  DialectRegistry, UnknownDialectError, UnknownVocabularyError,
  identifiers2020, identifiers2019, identifiersLegacy,
} from "./dialect.js";
export { SchemaRegistry } from "./registry.js";
export type { DocumentLocation } from "./registry.js";
export { UnresolvableRefError } from "./uri.js";
export { InfiniteLoopError, UnknownKeywordError } from "./engine.js";
export type {
  AnnotationUnit, ErrorUnit, LocationVocabulary, OutputUnit, RetentionPolicy,
} from "./output.js";
export type {
  LoadedDocument, SchemaLoader, SourceLocation, SourcePosition, SourceRange,
  SourceSpan,
} from "./loader.js";
export { DIALECT_2020_12 } from "./keywords/vocab2020.js";
export { DIALECT_2019_09 } from "./keywords/vocab2019.js";
export { DIALECT_DRAFT_07, DIALECT_DRAFT_06 } from "./keywords/vocab7.js";

export class SchemaValidationError extends Error {
  constructor(message: string, readonly errors: readonly ErrorUnit[]) {
    super(message);
  }
}

export interface EvaluateOptions {
  /**
   * Output structure (D6): "flag" (default), "list" (flat Basic-style
   * units in Result.errors/annotations), or "hierarchical" (nested output
   * document in Result.outputDocument, evaluation-trace shaped).
   */
  output?: "flag" | "list" | "hierarchical";
  /** location field names; default "modern" = evaluationPath/schemaLocation */
  locations?: LocationVocabulary;
  /**
   * Hierarchical only: keep valid, annotation-free units instead of pruning
   * them (the old Verbose format is verbose + locations "2020-12").
   */
  verbose?: boolean;
  collectAnnotations?: boolean;
  retention?: RetentionPolicy;
  /** decorate units with schema-side source positions when available (D17) */
  positions?: boolean;
}

export interface Result {
  valid: boolean;
  errors?: ErrorUnit[];
  annotations?: AnnotationUnit[];
  /** spec-shaped structured output document (hierarchical) */
  outputDocument?: OutputUnit;
}

export interface EngineOptions {
  /** dialect for documents without $schema; default 2020-12 */
  defaultDialect?: string;
  /** resource loaders, tried in order (D7) */
  loaders?: readonly SchemaLoader[];
  /**
   * Validate each load/register target against its metaschema when that
   * metaschema is registered as a schema resource. Standard metaschemas are
   * not bundled, so an unavailable metaschema means "cannot check", not
   * failure — supply a loader for it to get the check.
   */
  validateSchemas?: boolean;
}

export class Engine {
  readonly dialects = new DialectRegistry();
  private schemas: SchemaRegistry;
  private defaultDialect: string;
  private loaders: SchemaLoader[];
  private validateSchemas: boolean;
  // Dialect URIs whose assembly is in progress, to fail metaschema cycles.
  private assembling = new Set<string>();

  constructor(options: EngineOptions = {}) {
    registerStandardDialects(this.dialects);
    this.defaultDialect =
      splitFragment(options.defaultDialect ?? DIALECT_2020_12).resource;
    this.schemas = new SchemaRegistry(this.dialects, this.defaultDialect);
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
  }

  addLoader(loader: SchemaLoader): void {
    this.loaders.push(loader);
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
    const baseUri = this.schemas.register(schema, retrievalUri, dialectUri, getRange);
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
    const baseUri = this.schemas.register(schema, retrievalUri, dialectUri, getRange);
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

  registerVocabulary(uri: string, keywords: Readonly<Record<string, KeywordBehavior>>): void {
    this.dialects.registerVocabulary(uri, keywords);
  }

  registerDialect(uri: string, vocabularyUris: readonly string[], options?: DialectOptions): void {
    this.dialects.registerDialect(uri, vocabularyUris, options);
  }

  /**
   * Where a schema resource lives within its registered document (D17):
   * translate a canonical resource URI to the containing document plus the
   * resource root's document-rooted pointer, for source-position lookup.
   */
  documentLocation(resourceUri: string) {
    return this.schemas.documentLocation(resourceUri);
  }

  /**
   * Translate a canonical schema location (`resourceUri#/pointer`) to its
   * document, document-rooted pointer, and — when the document's loader
   * reported positions — source range (D17).
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

  evaluate(schemaUri: string, instance: JsonValue, options: EvaluateOptions = {}): Result {
    const vocabulary = options.locations ?? "modern";
    const structured = options.output === "hierarchical";
    const { valid, state } =
      runEvaluation(this.schemas, schemaUri, instance, structured);

    const result: Result = { valid };
    if (!valid && (options.output ?? "flag") === "list") {
      result.errors = state.errors.map((e) => renderError(e, vocabulary));
    }
    if (valid && options.collectAnnotations) {
      result.annotations = applyRetention(state.rootProductions, options.retention, vocabulary);
    }
    if (structured) {
      result.outputDocument = renderHierarchical(
        state.traceRoot!, state.errors, state.allProductions ?? [],
        { vocabulary, verbose: options.verbose, retention: options.retention });
    }
    if (options.positions) {
      this.decorate(result.errors);
      this.decorate(result.annotations);
    }
    return result;
  }

  private decorate(units: readonly ErrorUnit[] | readonly AnnotationUnit[] | undefined): void {
    for (const unit of units ?? []) {
      const canonical = unit.schemaLocation ?? unit.absoluteKeywordLocation;
      if (canonical === undefined) continue;
      const source = this.locate(canonical);
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
      effective = splitFragment(resolveUri(schema.$schema, retrievalUri)).resource;
    }
    if (this.dialects.hasDialect(effective)) return;
    if (this.assembling.has(effective)) {
      throw new UnknownDialectError(`metaschema cycle at '${effective}'`);
    }
    this.assembling.add(effective);
    try {
      const metaBase = await this.loadResource(effective);
      const meta = metaBase === undefined ? undefined : this.schemas.document(metaBase);
      if (meta === undefined) {
        throw new UnknownDialectError(
          `dialect '${effective}' is not registered and no loader provides its metaschema`);
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
          `dialect '${uri}' requires unknown vocabulary '${vocabUri}'`);
      }
      // Unknown optional vocabularies are skipped; their keywords fall to
      // unknown-keyword annotation handling (spec MUST for false).
    }
    // Identifier syntax travels with the core vocabulary (D18): a dialect
    // assembled around the 2019-09 core gets 2019-09 identifier handling.
    this.dialects.registerDialect(uri, uris, {
      identifiers: uris.includes(VOCAB_CORE_2019) ? identifiers2019 : identifiers2020,
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
        result.errors ?? []);
    }
  }
}

export const createEngine = (options?: EngineOptions): Engine => new Engine(options);
