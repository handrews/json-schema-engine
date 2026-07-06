// Compiler lowering IR (D1/D9, M6.1): the type vocabulary keyword behaviors
// use to describe their compiled form, and the LoweringContext service
// interface the compiler implements. Types only — core carries no compiler
// runtime. Keyword modules depend on this file, never on @jse/compiler, so
// keyword knowledge stays in exactly one module per keyword.
//
// Two properties are load-bearing for security and semantics:
//
// 1. No IR node carries raw JavaScript text. Schema-derived data enters only
//    as data nodes (constants, property keys, regex sources), which the
//    compiler's gated serializer escapes. Injection is unrepresentable
//    upstream of the serializer (D20/M6).
//
// 2. `combine` is EAGER: every part is evaluated, then the verdicts fold.
//    This is channel rule 6 (DESIGN.md §4) in the IR contract — branches
//    cannot short-circuit while a consumer or retained annotation could
//    observe them. The serializer may emit short-circuits only where the
//    compilation plan proves the region verdict-only.

import { JsonValue, JsonType } from "./json.js";

/** A value-producing IR expression. */
export type LowerExpr =
  /** the instance value under evaluation at the lowering site */
  | { readonly kind: "instance" }
  /** a hoisted JSON constant (emitted via the gated formatter's json()) */
  | { readonly kind: "const"; readonly value: JsonValue }
  /** object member access by schema-derived key (bracket notation, escaped) */
  | {
      readonly kind: "member";
      readonly target: LowerExpr;
      readonly key: string;
    }
  /** array element access */
  | {
      readonly kind: "item";
      readonly target: LowerExpr;
      readonly index: LowerExpr;
    }
  /** a loop binding introduced by forEachKey/forEachIndex */
  | { readonly kind: "binding"; readonly id: number }
  /** JSON type test, including the "integer" refinement */
  | {
      readonly kind: "typeIs";
      readonly target: LowerExpr;
      readonly types: readonly (JsonType | "integer")[];
    }
  /** Object.hasOwn(target, key) — the only permitted membership test */
  | {
      readonly kind: "hasOwn";
      readonly target: LowerExpr;
      readonly key: LowerExpr | string;
    }
  /** numeric/string comparison of two expressions */
  | {
      readonly kind: "cmp";
      readonly op: "<" | "<=" | ">" | ">=" | "===" | "!==";
      readonly left: LowerExpr;
      readonly right: LowerExpr;
    }
  /** call into the closed helper registry (never arbitrary code) */
  | {
      readonly kind: "helper";
      readonly helper: LowerHelper;
      readonly args: readonly LowerExpr[];
    }
  /** test a hoisted regex (compiled through the engine's RegexCache) */
  | {
      readonly kind: "regexTest";
      readonly source: string;
      readonly target: LowerExpr;
    }
  | { readonly kind: "not"; readonly expr: LowerExpr }
  | {
      readonly kind: "logic";
      readonly op: "and" | "or";
      readonly parts: readonly LowerExpr[];
    };

/**
 * The closed set of runtime helpers emitted code may call. All are imported
 * from the compiler's runtime module (re-exports of core functions) — never
 * re-emitted per artifact, so compiled and interpreted tiers share one
 * implementation of each semantic.
 */
export type LowerHelper =
  | "codePointLength"
  | "jsonEqual"
  | "canonicalKey"
  | "escapeSegment"
  | "keysOf" // Object.keys
  | "lengthOf" // .length of a string or array (UTF-16 units / element count)
  | "isMultipleOf";

/** A statement-level IR node. */
export type LowerStmt =
  | {
      readonly kind: "if";
      readonly cond: LowerExpr;
      readonly then: readonly LowerStmt[];
      readonly else?: readonly LowerStmt[];
    }
  /** iterate own enumerable keys (Object.keys) binding each name */
  | {
      readonly kind: "forEachKey";
      readonly target: LowerExpr;
      readonly binding: number;
      readonly body: readonly LowerStmt[];
    }
  /** iterate array indexes 0..length-1 (optionally from a constant start) */
  | {
      readonly kind: "forEachIndex";
      readonly target: LowerExpr;
      readonly binding: number;
      readonly start?: number;
      readonly body: readonly LowerStmt[];
    }
  /** report this keyword's assertion failure at the current cursor */
  | { readonly kind: "fail"; readonly message: LowerMessage }
  /** emit this keyword's production (channel rule 2) */
  | { readonly kind: "produce"; readonly value: LowerProduceValue }
  /**
   * Apply a subschema and fold its verdict into the keyword verdict per
   * `fold`. EAGER combine semantics (header note 2). `apply.cursor`
   * identifies the instance position; the compiler owns frames, locations,
   * and scope threading, exactly as the engine does for the interpreter.
   */
  | { readonly kind: "apply"; readonly apply: LowerApply };

/** How a keyword's lowered body applies one subschema. */
export interface LowerApply {
  /** subschema position relative to the keyword's schema object (matches StaticFacts.applications[].path, with loop bindings for dynamic segments) */
  readonly path: readonly (string | number | { binding: number })[];
  /**
   * For reference keywords: the reference value. The compiler resolves it
   * at plan time against the unit's lexical base; `path` is ignored.
   */
  readonly ref?: string;
  /** instance cursor for the application */
  readonly cursor: LowerCursor;
  /** how the application verdict folds into the keyword verdict */
  readonly fold:
    "allMustPass" | "anyMayPass" | "exactlyOne" | "negate" | "discard";
}

/** Instance cursor IR: the current node or a child of one. */
export type LowerCursor =
  | { readonly kind: "here" }
  | {
      readonly kind: "child";
      readonly of: LowerCursor;
      readonly segment: LowerExpr | string | number;
    };

/**
 * An error message: literal parts joined with expression parts, escaped by
 * the serializer. Mirrors the interpreter's message-builder output so the
 * differential gate can compare error text exactly.
 */
export type LowerMessage = readonly (string | LowerExpr)[];

/** A production value: a constant, or a runtime list collected by the body. */
export type LowerProduceValue =
  | { readonly kind: "const"; readonly value: JsonValue }
  | { readonly kind: "collectedNames" }
  | { readonly kind: "collectedIndexes" }
  | { readonly kind: "expr"; readonly expr: LowerExpr };

/**
 * Services available to one keyword's `lower()` (mirror of KeywordContext,
 * D3): the only path to subschema application, hoisting, and the channel.
 * Implemented by the compiler package; core defines the contract so keyword
 * modules never import the compiler.
 */
export interface LoweringContext {
  /** the instance expression at this lowering site */
  readonly instance: LowerExpr;
  /** the keyword's containing schema object (plan-time data) */
  readonly schema: Readonly<Record<string, JsonValue>>;
  /**
   * The static evaluated-coverage result for this schema object (D9a),
   * for `unevaluated*` lowerings: null when any contributor is dynamic —
   * the lowering must then fall back to runtime evaluated-set tracking.
   */
  staticCoverage(): {
    names: readonly string[];
    patterns: readonly string[];
    coversAllNames: boolean;
    prefixCount: number;
    coversAllIndexes: boolean;
  } | null;
  /** append statements to the keyword's lowered body */
  emit(...stmts: LowerStmt[]): void;
  /** allocate a loop binding id for forEachKey/forEachIndex */
  binding(): number;
}

/** Constructor shorthands for the common IR shapes. */
export const lowerIR = {
  instance: { kind: "instance" } as LowerExpr,
  constant: (value: JsonValue): LowerExpr => ({ kind: "const", value }),
  typeIs: (
    target: LowerExpr,
    ...types: readonly (JsonType | "integer")[]
  ): LowerExpr => ({ kind: "typeIs", target, types }),
  not: (expr: LowerExpr): LowerExpr => ({ kind: "not", expr }),
  and: (...parts: readonly LowerExpr[]): LowerExpr => ({
    kind: "logic",
    op: "and",
    parts,
  }),
  or: (...parts: readonly LowerExpr[]): LowerExpr => ({
    kind: "logic",
    op: "or",
    parts,
  }),
  regexTest: (source: string, target: LowerExpr): LowerExpr => ({
    kind: "regexTest",
    source,
    target,
  }),
  helper: (helper: LowerHelper, ...args: readonly LowerExpr[]): LowerExpr => ({
    kind: "helper",
    helper,
    args,
  }),
  cmp: (
    op: "<" | "<=" | ">" | ">=" | "===" | "!==",
    left: LowerExpr,
    right: LowerExpr,
  ): LowerExpr => ({ kind: "cmp", op, left, right }),
  fail: (...message: LowerMessage): LowerStmt => ({ kind: "fail", message }),
  when: (
    cond: LowerExpr,
    then: readonly LowerStmt[],
    elseStmts?: readonly LowerStmt[],
  ): LowerStmt => ({ kind: "if", cond, then, else: elseStmts }),
};
