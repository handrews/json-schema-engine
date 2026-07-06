// Unevaluated vocabulary: the channel-consumer keyword class. Phase 1: runs
// after every other keyword in the same schema object has merged.

import { isObject } from "../json.js";
import { KeywordBehavior } from "../dialect.js";
import { childCursor } from "../cursor.js";
import { SELF } from "./core.js";
import {
  properties,
  patternProperties,
  additionalProperties,
  prefixItems,
  items,
  contains,
} from "./applicator.js";

/** 2020-12 unevaluated vocabulary URI. */
export const VOCAB_UNEVALUATED =
  "https://json-schema.org/draft/2020-12/vocab/unevaluated";

/**
 * EXEMPLAR (consumer class): reads visible productions (engine.ts
 * visibility rule), applies the subschema to properties nobody evaluated,
 * and produces like any other applicator.
 */
export const unevaluatedProperties: KeywordBehavior = {
  id: `${VOCAB_UNEVALUATED}#unevaluatedProperties`,
  phase: 1,
  analyze: () => ({
    subschemas: SELF.subschemas,
    consumes: [
      properties.id,
      patternProperties.id,
      additionalProperties.id,
      `${VOCAB_UNEVALUATED}#unevaluatedProperties`,
    ],
  }),
  evaluate: (_value, cursor, ctx) => {
    if (!isObject(cursor.value)) return true;
    const seen = new Set<string>();
    for (const p of ctx.visible([
      properties.id,
      patternProperties.id,
      additionalProperties.id,
      unevaluatedProperties.id,
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

/** Same consumer shape as {@link unevaluatedProperties}, over array indexes not covered by `prefixItems`/`items`/`contains`. */
export const unevaluatedItems: KeywordBehavior = {
  id: `${VOCAB_UNEVALUATED}#unevaluatedItems`,
  phase: 1,
  analyze: () => ({
    subschemas: SELF.subschemas,
    consumes: [
      prefixItems.id,
      items.id,
      contains.id,
      `${VOCAB_UNEVALUATED}#unevaluatedItems`,
    ],
  }),
  evaluate: (_value, cursor, ctx) => {
    if (!Array.isArray(cursor.value)) return true;
    const length = cursor.value.length;
    let coveredPrefix = 0;
    const coveredIdx = new Set<number>();
    for (const p of ctx.visible([
      prefixItems.id,
      items.id,
      contains.id,
      unevaluatedItems.id,
    ])) {
      if (p.behaviorId === contains.id) {
        if (p.value === true) coveredPrefix = length;
        else for (const i of p.value as number[]) coveredIdx.add(i);
      } else if (p.value === true) {
        coveredPrefix = length;
      } else if (p.behaviorId === prefixItems.id) {
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
      ) {
        ok = false;
      }
    }
    if (applied) ctx.produce(true);
    return ok;
  },
};

/** The 2020-12 unevaluated vocabulary's keyword behaviors, by name. */
export const unevaluatedVocabulary: Record<string, KeywordBehavior> = {
  unevaluatedProperties,
  unevaluatedItems,
};
