// @jse/core public API (M1): sync evaluation over locally registered
// schemas; the 2020-12 dialect preloaded; custom vocabularies/dialects via
// the same registry the built-ins use. Async resource loaders arrive in M3.

import { JsonValue } from "./json.js";
import { DialectRegistry, DialectOptions, KeywordBehavior } from "./dialect.js";
import { SchemaRegistry } from "./registry.js";
import { runEvaluation } from "./engine.js";
import {
  AnnotationUnit, ErrorUnit, LocationVocabulary, RetentionPolicy,
  applyRetention, renderError,
} from "./output.js";
import { DIALECT_2020_12, registerStandardDialects } from "./keywords/vocab2020.js";

export type { JsonValue, JsonType } from "./json.js";
export type { Cursor } from "./cursor.js";
export { rootCursor, childCursor, instancePointer } from "./cursor.js";
export type { SchemaRef } from "./ref.js";
export type {
  KeywordBehavior, KeywordContext, StaticFacts, ProductionView, DialectOptions,
} from "./dialect.js";
export { DialectRegistry, UnknownDialectError } from "./dialect.js";
export { SchemaRegistry } from "./registry.js";
export type { DocumentLocation } from "./registry.js";
export { UnresolvableRefError } from "./uri.js";
export { InfiniteLoopError, UnknownKeywordError } from "./engine.js";
export type {
  AnnotationUnit, ErrorUnit, LocationVocabulary, RetentionPolicy,
} from "./output.js";
export { DIALECT_2020_12 } from "./keywords/vocab2020.js";

export interface EvaluateOptions {
  /** "flag" (default) or "list" (flat Basic-style units) */
  output?: "flag" | "list";
  /** location field names; default "modern" = evaluationPath/schemaLocation */
  locations?: LocationVocabulary;
  collectAnnotations?: boolean;
  retention?: RetentionPolicy;
}

export interface Result {
  valid: boolean;
  errors?: ErrorUnit[];
  annotations?: AnnotationUnit[];
}

export interface EngineOptions {
  /** dialect for documents without $schema; default 2020-12 */
  defaultDialect?: string;
}

export class Engine {
  readonly dialects = new DialectRegistry();
  private schemas: SchemaRegistry;

  constructor(options: EngineOptions = {}) {
    registerStandardDialects(this.dialects);
    this.schemas = new SchemaRegistry(
      this.dialects, options.defaultDialect ?? DIALECT_2020_12);
  }

  /** Register a schema document; returns its canonical base URI. */
  registerSchema(schema: JsonValue, retrievalUri: string, dialectUri?: string): string {
    return this.schemas.register(schema, retrievalUri, dialectUri);
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

  evaluate(schemaUri: string, instance: JsonValue, options: EvaluateOptions = {}): Result {
    const vocabulary = options.locations ?? "modern";
    const { valid, state } = runEvaluation(this.schemas, schemaUri, instance);

    const result: Result = { valid };
    if (!valid && (options.output ?? "flag") === "list") {
      result.errors = state.errors.map((e) => renderError(e, vocabulary));
    }
    if (valid && options.collectAnnotations) {
      result.annotations = applyRetention(state.rootProductions, options.retention, vocabulary);
    }
    return result;
  }
}

export const createEngine = (options?: EngineOptions): Engine => new Engine(options);
