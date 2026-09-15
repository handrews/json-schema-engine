// JSON Schema draft-04 dialect (DESIGN.md M10, D11, D18), assembled entirely
// through @json-schema-engine/core's public surface — this package is the reference for
// third-party dialect authoring. Keywords draft-04 shares with draft-07 are
// harvested as behavior objects from the engine's registered draft-07
// dialect: behaviors are stateless shared values (draft-06 already reuses
// draft-07's objects the same way), harvesting `format` picks up the
// engine's formats/assertFormats configuration, and compiler lowerings
// added to the shared behaviors (M6.6) will apply here without changes.
// Only the keywords whose draft-04 semantics genuinely differ are defined
// below.

import {
  Engine,
  IdentifierExtractor,
  KeywordBehavior,
  DIALECT_DRAFT_07,
  lowerIR,
  LoweringContext,
} from "@json-schema-engine/core";
import { METASCHEMAS_DRAFT_04 } from "./metaschema4.js";

/** draft-04 dialect URI. */
export const DIALECT_DRAFT_04 = "http://json-schema.org/draft-04/schema";

/**
 * draft-04 vocabulary identity (registry-internal; draft-04 predates
 * `$vocabulary`, so this URI is never a spec-meaningful vocabulary document).
 */
export const VOCAB_DRAFT_04 = "urn:jse:vocab:draft-04";

const id04 = (name: string): string => `${VOCAB_DRAFT_04}#${name}`;

/**
 * Identifier syntax for the draft-04 dialect: the keyword is `id` (no `$`);
 * a schema object containing `$ref` has no identifiers at all, and a
 * plain-fragment `id` is an anchor rather than a base change — the same
 * legacy rules as draft-07/06's `$id` (see core's identifiersLegacy).
 */
export const identifiersDraft04: IdentifierExtractor = (node) => {
  if (Object.hasOwn(node, "$ref")) return {};
  const id = node.id;
  if (typeof id !== "string") return {};
  if (id.startsWith("#")) {
    return id.length > 1 ? { anchors: [id.slice(1)] } : {};
  }
  return { baseId: id };
};

/**
 * Identifier/reserved keywords: no evaluation behavior, no annotation, and
 * an empty lower() — the planner's capability check requires the function
 * to exist, and an inert keyword's compiled contribution is legitimately
 * nothing.
 */
const structural = (name: string): KeywordBehavior => ({
  id: id04(name),
  analyze: () => ({ produces: [] }),
  evaluate: () => true,
  lower: () => undefined,
});

// draft-04's exclusiveMinimum/exclusiveMaximum are boolean modifiers on
// sibling minimum/maximum, not standalone assertions — so minimum/maximum
// read the sibling through ctx.schema (the same sibling-read pattern as
// 2020-12's contains with minContains) and the booleans themselves assert
// nothing. Params stay { limit } per the shared bounds-keyword shape (D13);
// exclusivity is recoverable from the schema itself.
// lower(): the exclusive/inclusive choice is plan-time data (the sibling
// boolean lives on lctx.schema, same sibling-read pattern as core's
// additionalItems reading lctx.schema.items) — so the comparison operator
// and message are picked once at lowering time rather than branching at
// runtime. Guard/compare/fail shape mirrors core's guardedCompare exemplar
// for 2020-12 minimum/maximum (validation.ts).
const minimum: KeywordBehavior = {
  id: id04("minimum"),
  evaluate: (value, cursor, ctx) => {
    const instance = cursor.value;
    if (typeof instance !== "number") return true;
    const limit = value as number;
    if (ctx.schema.exclusiveMinimum === true) {
      if (instance > limit) return true;
      ctx.error(`must be > ${limit}`, { limit });
      return false;
    }
    if (instance >= limit) return true;
    ctx.error(`must be >= ${limit}`, { limit });
    return false;
  },
  lower: (value, lctx: LoweringContext) => {
    const exclusive = lctx.schema.exclusiveMinimum === true;
    const op = exclusive ? ">" : ">=";
    const message = exclusive
      ? `must be > ${value as number}`
      : `must be >= ${value as number}`;
    lctx.emit(
      lowerIR.when(
        lowerIR.and(
          lowerIR.typeIs(lctx.instance, "number"),
          lowerIR.not(lowerIR.cmp(op, lctx.instance, lowerIR.constant(value))),
        ),
        [lowerIR.failWith({ limit: lowerIR.constant(value) }, message)],
      ),
    );
  },
};

const maximum: KeywordBehavior = {
  id: id04("maximum"),
  evaluate: (value, cursor, ctx) => {
    const instance = cursor.value;
    if (typeof instance !== "number") return true;
    const limit = value as number;
    if (ctx.schema.exclusiveMaximum === true) {
      if (instance < limit) return true;
      ctx.error(`must be < ${limit}`, { limit });
      return false;
    }
    if (instance <= limit) return true;
    ctx.error(`must be <= ${limit}`, { limit });
    return false;
  },
  lower: (value, lctx: LoweringContext) => {
    const exclusive = lctx.schema.exclusiveMaximum === true;
    const op = exclusive ? "<" : "<=";
    const message = exclusive
      ? `must be < ${value as number}`
      : `must be <= ${value as number}`;
    lctx.emit(
      lowerIR.when(
        lowerIR.and(
          lowerIR.typeIs(lctx.instance, "number"),
          lowerIR.not(lowerIR.cmp(op, lctx.instance, lowerIR.constant(value))),
        ),
        [lowerIR.failWith({ limit: lowerIR.constant(value) }, message)],
      ),
    );
  },
};

// Keywords draft-04 shares with draft-07, harvested from the engine's
// draft-07 dialect. Absent by omission: $id, $comment, if/then/else,
// propertyNames, contains, const, readOnly/writeOnly/examples, and the
// content keywords — none exist in draft-04, and the numeric 2020-12
// exclusiveMinimum/exclusiveMaximum are replaced by the boolean forms above.
// `type` is shared deliberately: draft-04's stricter integer (1.0 is not an
// integer) is unrepresentable after JSON.parse — the suite itself makes it
// optional (zeroTerminatedFloats.json) for exactly this reason.
const HARVESTED = [
  "$ref",
  "$schema",
  "definitions",
  "title",
  "description",
  "default",
  "format",
  "allOf",
  "anyOf",
  "oneOf",
  "not",
  "dependencies",
  "properties",
  "patternProperties",
  "additionalProperties",
  "items",
  "additionalItems",
  "type",
  "enum",
  "required",
  "pattern",
  "multipleOf",
  "maxLength",
  "minLength",
  "maxItems",
  "minItems",
  "uniqueItems",
  "maxProperties",
  "minProperties",
] as const;

function draft04Vocabulary(engine: Engine): Record<string, KeywordBehavior> {
  const draft07 = engine.dialects.getDialect(DIALECT_DRAFT_07);
  const vocabulary: Record<string, KeywordBehavior> = {};
  for (const name of HARVESTED) {
    const entry = draft07.keywords.get(name);
    if (!entry) {
      throw new Error(
        `draft-07 dialect is missing '${name}' — cannot assemble draft-04`,
      );
    }
    vocabulary[name] = entry.behavior;
  }
  vocabulary.id = structural("id");
  vocabulary.minimum = minimum;
  vocabulary.maximum = maximum;
  vocabulary.exclusiveMinimum = structural("exclusiveMinimum");
  vocabulary.exclusiveMaximum = structural("exclusiveMaximum");
  return vocabulary;
}

/**
 * Registers the draft-04 vocabulary, dialect, and metaschema on an engine.
 * Safe to call more than once per engine. Documents declaring
 * `$schema: "http://json-schema.org/draft-04/schema#"` (or registered with
 * that dialect URI) evaluate with draft-04 semantics afterwards, alongside
 * every natively supported draft in the same registry.
 */
export function registerDraft04(engine: Engine): void {
  if (engine.dialects.hasDialect(DIALECT_DRAFT_04)) return;
  engine.registerVocabulary(VOCAB_DRAFT_04, draft04Vocabulary(engine));
  engine.registerDialect(DIALECT_DRAFT_04, [VOCAB_DRAFT_04], {
    identifiers: identifiersDraft04,
    refIgnoresSiblings: true,
  });
  for (const [uri, doc] of METASCHEMAS_DRAFT_04) {
    engine.registerSchema(doc, uri);
  }
}
