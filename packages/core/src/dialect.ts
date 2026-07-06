// Dialect/vocabulary registry and the keyword behavior interface (DESIGN.md
// D2, §3): keywords are identified by URI, a vocabulary is a named map of
// keyword behaviors, a dialect is an ordered set of vocabularies. Built-in
// drafts and user extensions use the same mechanism — nothing here is
// privileged.

import { JsonValue } from "./json.js";
import { Cursor } from "./cursor.js";
import { SchemaRef } from "./ref.js";
import { CompiledRegex } from "./regex.js";
import { LoweringContext } from "./lowering.js";

/**
 * Static contribution of one keyword to the evaluated-property-name set of
 * its schema object (D9a). A coverage is a *predicate description*, not
 * necessarily a finite set: `patterns` still lowers (hoisted regexes in the
 * sweep test); only `dynamic` forces runtime evaluated-set tracking.
 */
export type NameCoverage =
  | { kind: "names"; names: readonly string[] }
  | { kind: "patterns"; patterns: readonly string[] }
  | { kind: "all" }
  | { kind: "dynamic" };

/** Static contribution to the evaluated-index coverage of an array (D9a). */
export type IndexCoverage =
  | { kind: "prefix"; count: number }
  | { kind: "allFrom"; start: number }
  | { kind: "all" }
  | { kind: "dynamic" };

/**
 * How a keyword applies one subschema — the compilation planner's edge
 * facts, richer than `subschemas` (which only says where children live and
 * keeps driving the registration walk).
 */
export interface SubschemaApplication {
  /** position relative to the keyword's value; [] is the value itself. A leading "../name" is expressed via `sibling` instead. */
  path: readonly (string | number)[];
  /** set when the applied subschema is a sibling keyword's value (if → then/else) */
  sibling?: string;
  mode:
    | "inPlace" // same cursor (allOf/anyOf/oneOf/not/if/$ref)
    | "childByKey" // fixed property name (properties entries)
    | "childByIndex" // fixed array index (prefixItems entries)
    | "childSweep" // runtime-determined children (items, *Properties sweeps)
    | "propertyName"; // applied to the property NAME as instance
  /** application depends on runtime branching (anyOf/oneOf alternatives, if-guarded), not merely instance shape */
  conditional: boolean;
  /** the subschema's verdict feeds this keyword's verdict (false for if's condition role and contains' per-item probes) */
  asserts: boolean;
}

/**
 * Static facts about one keyword occurrence, derived from its value alone.
 * This is the compiler tier's entire window into keyword semantics (D1), and
 * it also drives the registry's schema-position walk.
 */
export interface StaticFacts {
  /** paths to child schemas, relative to the keyword's value */
  subschemas?: readonly (readonly (string | number)[])[];
  /**
   * reference URIs this keyword's value points at (relative to the lexical
   * base); drives transitive resource loading (D7)
   */
  references?: readonly string[];
  /** behavior ids of productions this keyword can emit */
  produces?: readonly string[];
  /** behavior ids of productions this keyword reads from the channel */
  consumes?: readonly string[];
  /**
   * regular-expression values this keyword compiles (e.g. `pattern`, the
   * property-name patterns of `patternProperties`); screened by
   * `rejectUnsafeRegex` at registration (see regex.ts)
   */
  regexes?: readonly string[];
  /** participates in dynamic scope resolution ($dynamicRef and friends) */
  dynamicScopeSensitive?: boolean;
  /** static evaluated-name contribution (D9a; see {@link NameCoverage}) */
  evaluatesNames?: NameCoverage;
  /** static evaluated-index contribution (D9a; see {@link IndexCoverage}) */
  evaluatesIndexes?: IndexCoverage;
  /**
   * how this keyword applies its subschemas — planner edge facts
   * ({@link SubschemaApplication}); `subschemas` remains the registration
   * walk's position list
   */
  applications?: readonly SubschemaApplication[];
}

/**
 * Context for {@link KeywordBehavior.analyze}: the keyword's containing
 * schema object, for sibling-dependent facts (`items` starts after
 * `prefixItems`; `if` declares applications for sibling `then`/`else`) —
 * the same sibling reads `evaluate()` performs through `ctx.schema`.
 */
export interface AnalyzeContext {
  readonly schema: Readonly<Record<string, JsonValue>>;
}

/** Minimal view of a channel production, for consumer keywords. */
export interface ProductionView {
  behaviorId: string;
  value: unknown;
}

/**
 * The engine services available to one keyword application. This is the only
 * path to subschema application, the channel, and error reporting — the
 * engine owns path/scope/frame bookkeeping in exactly one place (DESIGN.md
 * §3), which is what makes locations compile-time constants for the M6
 * compiler.
 */
export interface KeywordContext {
  /** the current schema object (this keyword's siblings included) */
  readonly schema: Record<string, JsonValue>;
  readonly cursor: Cursor;
  /** apply the subschema at `segments` (relative to the current schema object) */
  apply(segments: readonly (string | number)[], cursor: Cursor): boolean;
  /** resolve a reference against the current lexical base */
  resolveRef(ref: string): SchemaRef;
  /** resolve a `$dynamicRef`-class reference, with dynamic-scope rebinding (D8; see engine.ts resolveDynamic) */
  resolveDynamic(ref: string): SchemaRef;
  /** resolve a 2019-09 `$recursiveRef`, D8's degenerate case (see engine.ts resolveRecursive) */
  resolveRecursive(ref: string): SchemaRef;
  /** apply a resolved reference target at the current cursor */
  applyResolved(target: SchemaRef): boolean;
  /** compile a `pattern`/`patternProperties` regex through the engine's regex engine and cache (see regex.ts) */
  compileRegex(pattern: string): CompiledRegex;
  /** emit a production for this keyword at the current cursor */
  produce(value: unknown): void;
  /** productions visible at the current cursor from the listed behaviors */
  visible(behaviorIds: readonly string[]): readonly ProductionView[];
  /** report an assertion failure for this keyword */
  error(message: string): void;
}

/** A keyword's static analysis and evaluation semantics. */
export interface KeywordBehavior {
  /** keyword URI — the stable identity, independent of its name in a dialect */
  readonly id: string;
  /**
   * Evaluation phase within a schema object: phase 1 keywords (unevaluated*)
   * run after all phase 0 keywords have merged their productions.
   */
  readonly phase?: 0 | 1;
  /**
   * Static facts; also drives the registration walk's descent. The context
   * (sibling access) is supplied by every caller; implementations that need
   * no sibling facts ignore it.
   */
  analyze?(value: JsonValue, context?: AnalyzeContext): StaticFacts;
  evaluate(value: JsonValue, cursor: Cursor, ctx: KeywordContext): boolean;
  /**
   * Optional compiler lowering (D1/D9): describe this keyword's compiled
   * form as IR through the {@link LoweringContext} — never JavaScript text.
   * Absent ⇒ schema objects containing this keyword become interpreted
   * units (the trampoline fallback). Keep `lower` beside `evaluate` and
   * share their error-message builders: the differential gate compares
   * error text.
   */
  lower?(value: JsonValue, lctx: LoweringContext): void;
}

/** A keyword's binding within one dialect: its name there, behavior, and owning vocabulary. */
export interface DialectKeyword {
  name: string;
  behavior: KeywordBehavior;
  vocabularyUri: string;
}

/**
 * Identifiers found in one schema object, per the dialect's identifier
 * syntax (D18; see {@link IdentifierExtractor}).
 */
export interface IdentifierFacts {
  /** value that changes the lexical base (and starts a schema resource) */
  baseId?: string;
  /** plain-name anchors minted at this schema object */
  anchors?: readonly string[];
  /** anchor participating in $dynamicRef rebinding (D8) */
  dynamicAnchor?: string;
  /** 2019-09 $recursiveAnchor; effective at a resource root */
  recursiveAnchor?: boolean;
}

/**
 * Extracts identifier facts from a schema object. Identifier syntax varies
 * by draft (D18): 2020-12 has `$id`/`$anchor`/`$dynamicAnchor`; 2019-09
 * replaces the dynamic pair with boolean `$recursiveAnchor`; draft-07/06
 * mint anchors from plain-fragment `$id` and have no anchor keywords at all.
 * The extractor is dialect data consumed by the registry's walk and pointer
 * navigation — keyword behaviors stay syntax-free.
 */
export type IdentifierExtractor = (
  node: Record<string, JsonValue>,
) => IdentifierFacts;

/** Identifier syntax for the 2020-12 dialect: `$id`/`$anchor`/`$dynamicAnchor`. */
export const identifiers2020: IdentifierExtractor = (node) => ({
  ...(typeof node.$id === "string" ? { baseId: node.$id } : {}),
  ...(typeof node.$anchor === "string" ? { anchors: [node.$anchor] } : {}),
  ...(typeof node.$dynamicAnchor === "string"
    ? { dynamicAnchor: node.$dynamicAnchor }
    : {}),
});

/** Identifier syntax for the 2019-09 dialect: `$id`/`$anchor`/boolean `$recursiveAnchor`. */
export const identifiers2019: IdentifierExtractor = (node) => ({
  ...(typeof node.$id === "string" ? { baseId: node.$id } : {}),
  ...(typeof node.$anchor === "string" ? { anchors: [node.$anchor] } : {}),
  ...(node.$recursiveAnchor === true ? { recursiveAnchor: true } : {}),
});

/**
 * Identifier syntax for legacy draft-07/06 dialects: a schema object
 * containing `$ref` has no identifiers at all (the suite's "`$ref` prevents
 * a sibling `$id` from changing the base uri"), and a plain-fragment `$id`
 * is an anchor rather than a base change.
 */
export const identifiersLegacy: IdentifierExtractor = (node) => {
  if (Object.hasOwn(node, "$ref")) return {};
  const id = node.$id;
  if (typeof id !== "string") return {};
  if (id.startsWith("#")) {
    return id.length > 1 ? { anchors: [id.slice(1)] } : {};
  }
  return { baseId: id };
};

/** An ordered set of vocabularies with identifier and `$ref` semantics (D18). */
export interface Dialect {
  uri: string;
  /** name -\> entry */
  keywords: ReadonlyMap<string, DialectKeyword>;
  /** evaluation order: phase 0 entries then phase 1 entries */
  ordered: readonly DialectKeyword[];
  /** the vocabularies this dialect was assembled from, in order */
  vocabularyUris: readonly string[];
  allowUnknownKeywords: boolean;
  identifiers: IdentifierExtractor;
  /** draft-07/06: siblings of $ref are treated as if absent */
  refIgnoresSiblings: boolean;
}

/** Options for {@link DialectRegistry.registerDialect}. */
export interface DialectOptions {
  /** unknown keywords are collected as annotations (spec SHOULD); default true */
  allowUnknownKeywords?: boolean;
  /** identifier syntax for this dialect (D18); default 2020-12 */
  identifiers?: IdentifierExtractor;
  /** draft-07/06 $ref semantics: siblings are ignored, not evaluated */
  refIgnoresSiblings?: boolean;
}

/** Thrown when a dialect or vocabulary URI has no registered entry. */
export class UnknownDialectError extends Error {}
/** Thrown when a `$vocabulary` URI is required but not registered. */
export class UnknownVocabularyError extends Error {}

/** Registry of vocabularies and the dialects assembled from them. */
export class DialectRegistry {
  private vocabularies = new Map<
    string,
    Readonly<Record<string, KeywordBehavior>>
  >();
  private dialects = new Map<string, Dialect>();

  /** Registers a vocabulary's keyword behaviors under its URI. */
  registerVocabulary(
    uri: string,
    keywords: Readonly<Record<string, KeywordBehavior>>,
  ): void {
    this.vocabularies.set(uri, keywords);
  }

  /**
   * Assembles a dialect from already-registered vocabularies.
   * @throws UnknownDialectError if a listed vocabulary is not registered.
   */
  registerDialect(
    uri: string,
    vocabularyUris: readonly string[],
    options: DialectOptions = {},
  ): void {
    const keywords = new Map<string, DialectKeyword>();
    for (const vocabularyUri of vocabularyUris) {
      const vocab = this.vocabularies.get(vocabularyUri);
      if (!vocab) {
        throw new UnknownDialectError(
          `dialect '${uri}' requires unregistered vocabulary '${vocabularyUri}'`,
        );
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
      vocabularyUris: [...vocabularyUris],
      allowUnknownKeywords: options.allowUnknownKeywords ?? true,
      identifiers: options.identifiers ?? identifiers2020,
      refIgnoresSiblings: options.refIgnoresSiblings ?? false,
    });
  }

  /**
   * Looks up a registered dialect by URI.
   * @throws UnknownDialectError if the URI has no registered dialect.
   */
  getDialect(uri: string): Dialect {
    const dialect = this.dialects.get(uri);
    if (!dialect) throw new UnknownDialectError(`unknown dialect '${uri}'`);
    return dialect;
  }

  /** True if a dialect is registered under this URI. */
  hasDialect(uri: string): boolean {
    return this.dialects.has(uri);
  }

  /** True if a vocabulary is registered under this URI. */
  hasVocabulary(uri: string): boolean {
    return this.vocabularies.has(uri);
  }
}

/** Behavior id for productions from keywords the dialect doesn't know. */
export const unknownKeywordId = (name: string): string =>
  `urn:jse:keyword:unknown#${name}`;
