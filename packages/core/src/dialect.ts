// Dialect/vocabulary registry and the keyword behavior interface (DESIGN.md
// D2, §3): keywords are identified by URI, a vocabulary is a named map of
// keyword behaviors, a dialect is an ordered set of vocabularies. Built-in
// drafts and user extensions use the same mechanism — nothing here is
// privileged.

import { JsonValue } from "./json.js";
import { Cursor } from "./cursor.js";
import { SchemaRef } from "./ref.js";

// Static facts about one keyword occurrence, derived from its value alone.
// This is the compiler tier's entire window into keyword semantics (D1), and
// it also drives the registry's schema-position walk. M1 uses `subschemas`;
// the remaining fields are declared for M6.
export interface StaticFacts {
  /** paths to child schemas, relative to the keyword's value */
  subschemas?: readonly (readonly (string | number)[])[];
  /** behavior ids of productions this keyword can emit */
  produces?: readonly string[];
  /** behavior ids of productions this keyword reads from the channel */
  consumes?: readonly string[];
  /** participates in dynamic scope resolution ($dynamicRef and friends) */
  dynamicScopeSensitive?: boolean;
}

// Minimal view of a channel production, for consumer keywords.
export interface ProductionView {
  behaviorId: string;
  value: unknown;
}

// The engine services available to one keyword application. This is the only
// path to subschema application, the channel, and error reporting — the
// engine owns path/scope/frame bookkeeping in exactly one place (DESIGN.md
// §3), which is what makes locations compile-time constants for the M6
// compiler.
export interface KeywordContext {
  /** the current schema object (this keyword's siblings included) */
  readonly schema: Record<string, JsonValue>;
  readonly cursor: Cursor;
  /** apply the subschema at `segments` (relative to the current schema object) */
  apply(segments: readonly (string | number)[], cursor: Cursor): boolean;
  /** resolve a reference against the current lexical base */
  resolveRef(ref: string): SchemaRef;
  /** apply a resolved reference target at the current cursor */
  applyResolved(target: SchemaRef): boolean;
  /** emit a production for this keyword at the current cursor */
  produce(value: unknown): void;
  /** productions visible at the current cursor from the listed behaviors */
  visible(behaviorIds: readonly string[]): readonly ProductionView[];
  /** report an assertion failure for this keyword */
  error(message: string): void;
}

export interface KeywordBehavior {
  /** keyword URI — the stable identity, independent of its name in a dialect */
  readonly id: string;
  /**
   * Evaluation phase within a schema object: phase 1 keywords (unevaluated*)
   * run after all phase 0 keywords have merged their productions.
   */
  readonly phase?: 0 | 1;
  /** static facts; also drives the registration walk's descent */
  analyze?(value: JsonValue): StaticFacts;
  evaluate(value: JsonValue, cursor: Cursor, ctx: KeywordContext): boolean;
}

export interface DialectKeyword {
  name: string;
  behavior: KeywordBehavior;
  vocabularyUri: string;
}

export interface Dialect {
  uri: string;
  /** name -> entry */
  keywords: ReadonlyMap<string, DialectKeyword>;
  /** evaluation order: phase 0 entries then phase 1 entries */
  ordered: readonly DialectKeyword[];
  allowUnknownKeywords: boolean;
}

export interface DialectOptions {
  /** unknown keywords are collected as annotations (spec SHOULD); default true */
  allowUnknownKeywords?: boolean;
}

export class UnknownDialectError extends Error {}

export class DialectRegistry {
  private vocabularies = new Map<string, Readonly<Record<string, KeywordBehavior>>>();
  private dialects = new Map<string, Dialect>();

  registerVocabulary(uri: string, keywords: Readonly<Record<string, KeywordBehavior>>): void {
    this.vocabularies.set(uri, keywords);
  }

  registerDialect(uri: string, vocabularyUris: readonly string[], options: DialectOptions = {}): void {
    const keywords = new Map<string, DialectKeyword>();
    for (const vocabularyUri of vocabularyUris) {
      const vocab = this.vocabularies.get(vocabularyUri);
      if (!vocab) {
        throw new UnknownDialectError(
          `dialect '${uri}' requires unregistered vocabulary '${vocabularyUri}'`);
      }
      for (const [name, behavior] of Object.entries(vocab)) {
        keywords.set(name, { name, behavior, vocabularyUri });
      }
    }
    const entries = [...keywords.values()];
    const ordered = [
      ...entries.filter((k) => (k.behavior.phase ?? 0) === 0),
      ...entries.filter((k) => k.behavior.phase === 1),
    ];
    this.dialects.set(uri, {
      uri,
      keywords,
      ordered,
      allowUnknownKeywords: options.allowUnknownKeywords ?? true,
    });
  }

  getDialect(uri: string): Dialect {
    const dialect = this.dialects.get(uri);
    if (!dialect) throw new UnknownDialectError(`unknown dialect '${uri}'`);
    return dialect;
  }

  hasDialect(uri: string): boolean {
    return this.dialects.has(uri);
  }
}

// Identity for productions from keywords the dialect doesn't know; the value
// of an unknown keyword is collected as its annotation.
export const unknownKeywordId = (name: string): string =>
  `urn:jse:keyword:unknown#${name}`;
