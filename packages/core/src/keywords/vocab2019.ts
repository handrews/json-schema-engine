// 2019-09 dialect (DESIGN.md M4-A): assembled from its own vocabulary URIs,
// reusing 2020-12 behavior objects wherever spec semantics are identical
// (validation is byte-for-byte the same set; most applicators too) and
// registering new behaviors only where 2019-09 diverges — no `$dynamicRef`/
// `$dynamicAnchor` (2019-09 has `$recursiveRef`/`$recursiveAnchor` instead),
// tuple-form `items` folds what 2020-12 splits into `prefixItems`+`items`,
// and `additionalItems` (retired in 2020-12) fills the gap that leaves.

import { isObject } from "../json.js";
import {
  DialectRegistry,
  KeywordBehavior,
  StaticFacts,
  identifiers2019,
} from "../dialect.js";
import { childCursor } from "../cursor.js";
import {
  coreVocabulary,
  VOCAB_CORE_2019,
  $recursiveRef,
  $recursiveAnchor,
  annotationOnly,
  SELF,
} from "./core.js";
import {
  allOf,
  anyOf,
  oneOf,
  not,
  ifKeyword,
  dependentSchemas,
  properties,
  patternProperties,
  propertyNames,
  additionalProperties,
  contains,
} from "./applicator.js";
import { validationVocabulary } from "./validation.js";

export const VOCAB_CORE_2019_09 = VOCAB_CORE_2019;
export const VOCAB_APPLICATOR_2019 =
  "https://json-schema.org/draft/2019-09/vocab/applicator";
export const VOCAB_VALIDATION_2019 =
  "https://json-schema.org/draft/2019-09/vocab/validation";
export const VOCAB_META_DATA_2019 =
  "https://json-schema.org/draft/2019-09/vocab/meta-data";
export const VOCAB_FORMAT_2019 =
  "https://json-schema.org/draft/2019-09/vocab/format";
export const VOCAB_CONTENT_2019 =
  "https://json-schema.org/draft/2019-09/vocab/content";

export const DIALECT_2019_09 = "https://json-schema.org/draft/2019-09/schema";

const id = (name: string): string => `${VOCAB_APPLICATOR_2019}#${name}`;

// 2019-09 core: same keyword set as 2020-12's core minus $dynamicRef/
// $dynamicAnchor, plus $recursiveRef/$recursiveAnchor. $id/$schema/$anchor/
// $vocabulary/$comment/$defs behaviors are draft-agnostic (structural or
// value-is-the-position), so they're shared as-is — the milestone contract
// allows a shared behavior's id to stay a 2020-12 URI.
const core2019Vocabulary: Record<string, KeywordBehavior> = {
  $ref: coreVocabulary.$ref!,
  $defs: coreVocabulary.$defs!,
  $id: coreVocabulary.$id!,
  $schema: coreVocabulary.$schema!,
  $anchor: coreVocabulary.$anchor!,
  $vocabulary: coreVocabulary.$vocabulary!,
  $comment: coreVocabulary.$comment!,
  $recursiveRef,
  $recursiveAnchor,
};

// items (2019-09 form): a schema value applies to every element (produces
// `true`, matching 2020-12 items' post-prefixItems annotation shape); an
// array value (tuple) applies element-wise to the first N and produces the
// largest index reached, or `true` when it covers the whole array — this is
// the pre-2020-12 keyword that prefixItems/items later split in two, so its
// annotation shape mirrors 2020-12 prefixItems'.
export const items2019: KeywordBehavior = {
  id: id("items"),
  analyze: (value): StaticFacts =>
    Array.isArray(value) ? { subschemas: value.map((_, i) => [i]) } : SELF,
  evaluate: (value, cursor, ctx) => {
    if (!Array.isArray(cursor.value)) return true;
    if (Array.isArray(value)) {
      const n = Math.min(value.length, cursor.value.length);
      let ok = true;
      for (let i = 0; i < n; i++) {
        if (!ctx.apply(["items", i], childCursor(cursor, i, cursor.value[i]!)))
          ok = false;
      }
      if (n > 0) ctx.produce(n === cursor.value.length ? true : n - 1);
      return ok;
    }
    let ok = true;
    let applied = false;
    for (let i = 0; i < cursor.value.length; i++) {
      applied = true;
      if (!ctx.apply(["items"], childCursor(cursor, i, cursor.value[i]!)))
        ok = false;
    }
    if (applied) ctx.produce(true);
    return ok;
  },
};

// additionalItems: applies only when the sibling `items` is present *and* an
// array (tuple form) — a schema-form `items` already covers every element, so
// additionalItems "does nothing" against it (suite: "when items is schema,
// additionalItems does nothing"). Sibling-read, same pattern as if/then/else
// and contains' minContains/maxContains siblings.
export const additionalItems: KeywordBehavior = {
  id: id("additionalItems"),
  analyze: (): StaticFacts => SELF,
  evaluate: (_value, cursor, ctx) => {
    if (!Array.isArray(cursor.value)) return true;
    const siblingItems = ctx.schema.items;
    if (!Array.isArray(siblingItems)) return true;
    let ok = true;
    let applied = false;
    for (let i = siblingItems.length; i < cursor.value.length; i++) {
      applied = true;
      if (
        !ctx.apply(
          ["additionalItems"],
          childCursor(cursor, i, cursor.value[i]!),
        )
      )
        ok = false;
    }
    // Boolean annotation (applied to any element or not) — additionalItems
    // has no index-range shape of its own; unevaluatedItems only needs "did
    // this cover the rest" from this producer.
    if (applied) ctx.produce(true);
    return ok;
  },
};

const applicator2019Vocabulary: Record<string, KeywordBehavior> = {
  allOf,
  anyOf,
  oneOf,
  not,
  if: ifKeyword,
  then: {
    id: id("then"),
    analyze: (): StaticFacts => SELF,
    evaluate: () => true,
  },
  else: {
    id: id("else"),
    analyze: (): StaticFacts => SELF,
    evaluate: () => true,
  },
  dependentSchemas,
  properties,
  patternProperties,
  propertyNames,
  additionalProperties,
  items: items2019,
  additionalItems,
  contains,
};

// unevaluatedItems/unevaluatedProperties (2019-09): same consumer pattern as
// unevaluated.ts, wired to this dialect's producer ids — items2019 folds
// prefixItems+items into one id, and additionalItems is a genuinely new
// producer 2020-12 doesn't have. Spec-wise these two live in the applicator
// vocabulary (2019-09 has no separate unevaluated vocabulary yet).
const unevaluatedItems2019: KeywordBehavior = {
  id: `${VOCAB_APPLICATOR_2019}#unevaluatedItems`,
  phase: 1,
  analyze: (): StaticFacts => ({
    subschemas: SELF.subschemas,
    consumes: [
      items2019.id,
      additionalItems.id,
      contains.id,
      `${VOCAB_APPLICATOR_2019}#unevaluatedItems`,
    ],
  }),
  evaluate: (_value, cursor, ctx) => {
    if (!Array.isArray(cursor.value)) return true;
    const length = cursor.value.length;
    let coveredPrefix = 0;
    const coveredIdx = new Set<number>();
    for (const p of ctx.visible([
      items2019.id,
      additionalItems.id,
      contains.id,
      unevaluatedItems2019.id,
    ])) {
      if (p.behaviorId === contains.id) {
        if (p.value === true) coveredPrefix = length;
        else for (const i of p.value as number[]) coveredIdx.add(i);
      } else if (p.value === true) {
        coveredPrefix = length;
      } else if (p.behaviorId === items2019.id) {
        coveredPrefix = Math.max(coveredPrefix, (p.value as number) + 1);
      }
    }
    let ok = true;
    let applied = false;
    for (let i = coveredPrefix; i < length; i++) {
      if (coveredIdx.has(i)) continue;
      applied = true;
      if (
        !ctx.apply(
          ["unevaluatedItems"],
          childCursor(cursor, i, cursor.value[i]!),
        )
      )
        ok = false;
    }
    if (applied) ctx.produce(true);
    return ok;
  },
};

const unevaluatedProperties2019: KeywordBehavior = {
  id: `${VOCAB_APPLICATOR_2019}#unevaluatedProperties`,
  phase: 1,
  analyze: (): StaticFacts => ({
    subschemas: SELF.subschemas,
    consumes: [
      properties.id,
      patternProperties.id,
      additionalProperties.id,
      `${VOCAB_APPLICATOR_2019}#unevaluatedProperties`,
    ],
  }),
  evaluate: (_value, cursor, ctx) => {
    if (!isObject(cursor.value)) return true;
    const seen = new Set<string>();
    for (const p of ctx.visible([
      properties.id,
      patternProperties.id,
      additionalProperties.id,
      unevaluatedProperties2019.id,
    ])) {
      for (const name of p.value as string[]) seen.add(name);
    }
    let ok = true;
    const matched: string[] = [];
    for (const name of Object.keys(cursor.value)) {
      if (seen.has(name)) continue;
      matched.push(name);
      if (
        !ctx.apply(
          ["unevaluatedProperties"],
          childCursor(cursor, name, cursor.value[name]!),
        )
      )
        ok = false;
    }
    ctx.produce(matched);
    return ok;
  },
};

Object.assign(applicator2019Vocabulary, {
  unevaluatedItems: unevaluatedItems2019,
  unevaluatedProperties: unevaluatedProperties2019,
});

const metaDataVocabulary2019 = Object.fromEntries(
  [
    "title",
    "description",
    "default",
    "deprecated",
    "readOnly",
    "writeOnly",
    "examples",
  ].map((name) => [name, annotationOnly(`${VOCAB_META_DATA_2019}#${name}`)]),
);

const formatVocabulary2019 = {
  format: annotationOnly(`${VOCAB_FORMAT_2019}#format`),
};

const contentVocabulary2019 = Object.fromEntries(
  ["contentMediaType", "contentEncoding", "contentSchema"].map((name) => [
    name,
    annotationOnly(`${VOCAB_CONTENT_2019}#${name}`),
  ]),
);

export function registerDialect2019(registry: DialectRegistry): void {
  registry.registerVocabulary(VOCAB_CORE_2019_09, core2019Vocabulary);
  registry.registerVocabulary(VOCAB_APPLICATOR_2019, applicator2019Vocabulary);
  registry.registerVocabulary(VOCAB_VALIDATION_2019, validationVocabulary);
  registry.registerVocabulary(VOCAB_META_DATA_2019, metaDataVocabulary2019);
  registry.registerVocabulary(VOCAB_FORMAT_2019, formatVocabulary2019);
  registry.registerVocabulary(VOCAB_CONTENT_2019, contentVocabulary2019);

  registry.registerDialect(
    DIALECT_2019_09,
    [
      VOCAB_CORE_2019_09,
      VOCAB_APPLICATOR_2019,
      VOCAB_VALIDATION_2019,
      VOCAB_META_DATA_2019,
      VOCAB_FORMAT_2019,
      VOCAB_CONTENT_2019,
    ],
    { identifiers: identifiers2019 },
  );
}
