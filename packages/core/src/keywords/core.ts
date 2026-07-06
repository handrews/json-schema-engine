// Core vocabulary behaviors, plus shared behavior factories.
//
// EXEMPLAR (reference class): `$ref` — resolve against the lexical base,
// apply the target at the same cursor. The engine owns the evaluation-path
// extension and the frame, so a reference behavior is one line.

import { JsonValue } from "../json.js";
import { KeywordBehavior, StaticFacts } from "../dialect.js";

export const VOCAB_CORE = "https://json-schema.org/draft/2020-12/vocab/core";

const SELF: StaticFacts = { subschemas: [[]] };
const mapPositions = (value: JsonValue): StaticFacts =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? { subschemas: Object.keys(value).map((k) => [k]) }
    : {};

/** Identifier/reserved keywords: no evaluation behavior, no annotation. */
export const structural = (id: string): KeywordBehavior =>
  ({ id, evaluate: () => true });

/** A keyword whose subschemas exist (for identification) but whose
 *  evaluation is driven by a sibling (then/else via if). */
export const inertSubschema = (id: string): KeywordBehavior =>
  ({ id, analyze: () => SELF, evaluate: () => true });

/** EXEMPLAR (annotation-only class): the keyword's value is its annotation. */
export const annotationOnly = (id: string): KeywordBehavior =>
  ({
    id,
    evaluate: (value, _cursor, ctx) => {
      ctx.produce(value);
      return true;
    },
  });

/** Placeholder for keywords owed by a later milestone: loud failure beats
 *  silently treating a known assertion/applicator as an annotation. */
export const notImplemented = (id: string, milestone: string): KeywordBehavior =>
  ({
    id,
    evaluate: () => {
      throw new Error(`keyword '${id}' is not implemented until ${milestone}`);
    },
  });

export const $ref: KeywordBehavior = {
  id: `${VOCAB_CORE}#$ref`,
  evaluate: (value, _cursor, ctx) => ctx.applyResolved(ctx.resolveRef(value as string)),
};

export const $defs: KeywordBehavior = {
  id: `${VOCAB_CORE}#$defs`,
  analyze: mapPositions,
  evaluate: () => true,
};

export const coreVocabulary: Record<string, KeywordBehavior> = {
  $ref,
  $defs,
  $id: structural(`${VOCAB_CORE}#$id`),
  $schema: structural(`${VOCAB_CORE}#$schema`),
  $anchor: structural(`${VOCAB_CORE}#$anchor`),
  $vocabulary: structural(`${VOCAB_CORE}#$vocabulary`),
  // $comment's value MUST NOT be collected as an annotation.
  $comment: structural(`${VOCAB_CORE}#$comment`),
  $dynamicRef: notImplemented(`${VOCAB_CORE}#$dynamicRef`, "M3"),
  $dynamicAnchor: notImplemented(`${VOCAB_CORE}#$dynamicAnchor`, "M3"),
};

export { mapPositions, SELF };
