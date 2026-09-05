// Core vocabulary behaviors, plus shared behavior factories.

import { JsonValue } from "../json.js";
import { KeywordBehavior, StaticFacts } from "../dialect.js";

/** 2020-12 core vocabulary URI. */
export const VOCAB_CORE = "https://json-schema.org/draft/2020-12/vocab/core";

/** Static facts for a keyword whose value is itself a subschema (e.g. `if`, `not`). */
const SELF: StaticFacts = { subschemas: [[]] };
/** Static facts for a keyword whose value is a name-keyed map of subschemas. */
const mapPositions = (value: JsonValue): StaticFacts =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? { subschemas: Object.keys(value).map((k) => [k]) }
    : {};

/** Identifier/reserved keywords: no evaluation behavior, no annotation. */
export const structural = (id: string): KeywordBehavior => ({
  id,
  analyze: () => ({ produces: [] }),
  evaluate: () => true,
  lower: () => {
    /* inert in compiled code too */
  },
});

/**
 * A keyword whose subschemas exist (for identification) but whose
 * evaluation is driven by a sibling (`then`/`else` via `if`).
 */
export const inertSubschema = (id: string): KeywordBehavior => ({
  id,
  analyze: () => SELF,
  evaluate: () => true,
  lower: () => {
    /* the driving sibling owns the application */
  },
});

/** EXEMPLAR (annotation-only class): the keyword's value is its annotation. */
export const annotationOnly = (id: string): KeywordBehavior => ({
  id,
  evaluate: (_value, _cursor, ctx) => {
    ctx.annotate();
    return true;
  },
  lower: (_value, lctx) => {
    lctx.emit({ kind: "annotate" });
  },
});

/**
 * Placeholder for keywords owed by a later milestone: loud failure beats
 * silently treating a known assertion/applicator as an annotation.
 */
export const notImplemented = (
  id: string,
  milestone: string,
): KeywordBehavior => ({
  id,
  evaluate: () => {
    throw new Error(`keyword '${id}' is not implemented until ${milestone}`);
  },
});

const referenceFacts = (value: JsonValue): StaticFacts =>
  typeof value === "string"
    ? {
        references: [value],
        // The resolved target applies in place, unconditionally.
        applications: [
          {
            path: [],
            ref: value,
            mode: "inPlace",
            conditional: false,
            asserts: true,
          },
        ],
      }
    : {};

/**
 * EXEMPLAR (reference class): resolve against the lexical base, apply the
 * target at the same cursor. The engine owns the evaluation-path extension
 * and the frame, so a reference behavior is one line.
 */
export const $ref: KeywordBehavior = {
  id: `${VOCAB_CORE}#$ref`,
  analyze: referenceFacts,
  evaluate: (value, _cursor, ctx) =>
    ctx.applyResolved(ctx.resolveRef(value as string)),
  lower: (value, lctx) => {
    lctx.emit({
      kind: "apply",
      apply: {
        path: [],
        ref: value as string,
        cursor: { kind: "here" },
        fold: "allMustPass",
      },
    });
  },
};

/** `$dynamicRef` (D8): resolves with dynamic-scope rebinding. */
export const $dynamicRef: KeywordBehavior = {
  id: `${VOCAB_CORE}#$dynamicRef`,
  analyze: (value) => ({
    ...referenceFacts(value),
    dynamicScopeSensitive: true,
  }),
  evaluate: (value, _cursor, ctx) =>
    ctx.applyResolved(ctx.resolveDynamic(value as string)),
};

// 2019-09 core vocabulary: $recursiveRef/$recursiveAnchor are D8's degenerate
// case — resolution lives in the engine, anchor indexing in the registry's
// identifier extractor, so both behaviors are one-liners.

/** 2019-09 core vocabulary URI. */
export const VOCAB_CORE_2019 =
  "https://json-schema.org/draft/2019-09/vocab/core";

/** `$recursiveRef`, 2019-09's degenerate case of `$dynamicRef` (D8). */
export const $recursiveRef: KeywordBehavior = {
  id: `${VOCAB_CORE_2019}#$recursiveRef`,
  analyze: (value) => ({
    ...referenceFacts(value),
    dynamicScopeSensitive: true,
  }),
  evaluate: (value, _cursor, ctx) =>
    ctx.applyResolved(ctx.resolveRecursive(value as string)),
};

/** `$recursiveAnchor`: structural only, indexed by the registration walk. */
export const $recursiveAnchor: KeywordBehavior = structural(
  `${VOCAB_CORE_2019}#$recursiveAnchor`,
);

/** `$defs`: a map of named subschemas, reachable only by reference. */
export const $defs: KeywordBehavior = {
  id: `${VOCAB_CORE}#$defs`,
  analyze: mapPositions,
  evaluate: () => true,
  lower: () => {
    /* contents are reachable only by reference */
  },
};

/** The 2020-12 core vocabulary's keyword behaviors, by name. */
export const coreVocabulary: Record<string, KeywordBehavior> = {
  $ref,
  $dynamicRef,
  $defs,
  $id: structural(`${VOCAB_CORE}#$id`),
  $schema: structural(`${VOCAB_CORE}#$schema`),
  $anchor: structural(`${VOCAB_CORE}#$anchor`),
  // Dynamic-anchor indexing happens in the registration walk (D8).
  $dynamicAnchor: structural(`${VOCAB_CORE}#$dynamicAnchor`),
  $vocabulary: structural(`${VOCAB_CORE}#$vocabulary`),
  // $comment's value MUST NOT be collected as an annotation.
  $comment: structural(`${VOCAB_CORE}#$comment`),
};

export { mapPositions, SELF };
