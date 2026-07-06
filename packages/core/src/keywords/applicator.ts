// Applicator vocabulary.
//
// EXEMPLARS: `anyOf` (in-place applicator class — subschemas applied at the
// same cursor; see engine.ts for channel merge/discard semantics) and
// `properties` (child applicator class — child cursors, produces its
// evaluated-name annotation).

import { JsonValue, isObject, schemaRegExp } from "../json.js";
import { KeywordBehavior, StaticFacts } from "../dialect.js";
import { childCursor } from "../cursor.js";
import { SELF, mapPositions } from "./core.js";

/** 2020-12 applicator vocabulary URI. */
export const VOCAB_APPLICATOR =
  "https://json-schema.org/draft/2020-12/vocab/applicator";

const id = (name: string): string => `${VOCAB_APPLICATOR}#${name}`;

const arrayPositions = (value: JsonValue): StaticFacts =>
  Array.isArray(value) ? { subschemas: value.map((_, i) => [i]) } : {};
const selfPosition = (): StaticFacts => SELF;

/** `allOf`: every subschema must match, at the same cursor. */
export const allOf: KeywordBehavior = {
  id: id("allOf"),
  analyze: arrayPositions,
  evaluate: (value, cursor, ctx) => {
    let ok = true;
    (value as JsonValue[]).forEach((_, i) => {
      if (!ctx.apply(["allOf", i], cursor)) ok = false;
    });
    return ok;
  },
};

/** EXEMPLAR (in-place applicator class): every branch runs, even after a match (DESIGN.md §4 rule 6; see engine.ts). */
export const anyOf: KeywordBehavior = {
  id: id("anyOf"),
  analyze: arrayPositions,
  evaluate: (value, cursor, ctx) => {
    let ok = false;
    (value as JsonValue[]).forEach((_, i) => {
      if (ctx.apply(["anyOf", i], cursor)) ok = true;
    });
    // Mutated inside the forEach closure above; the checker doesn't track that
    // reassignment for a read after the callback returns.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (!ok) ctx.error("no branch matched");
    return ok;
  },
};

/** `oneOf`: exactly one subschema must match, at the same cursor. */
export const oneOf: KeywordBehavior = {
  id: id("oneOf"),
  analyze: arrayPositions,
  evaluate: (value, cursor, ctx) => {
    let count = 0;
    (value as JsonValue[]).forEach((_, i) => {
      if (ctx.apply(["oneOf", i], cursor)) count++;
    });
    if (count !== 1) ctx.error(`matched ${count} branches, expected exactly 1`);
    return count === 1;
  },
};

/** `not`: the subschema must not match. */
export const not: KeywordBehavior = {
  id: id("not"),
  analyze: selfPosition,
  evaluate: (_value, cursor, ctx) => {
    if (!ctx.apply(["not"], cursor)) return true;
    ctx.error("must not match the subschema");
    return false;
  },
};

/**
 * `if`: drives `then`/`else`, which are inert on their own — their own
 * behaviors exist only so the registration walk identifies `$id`/`$anchor`
 * inside them.
 */
export const ifKeyword: KeywordBehavior = {
  id: id("if"),
  analyze: selfPosition,
  evaluate: (_value, cursor, ctx) => {
    const condition = ctx.apply(["if"], cursor);
    if (condition && Object.hasOwn(ctx.schema, "then"))
      return ctx.apply(["then"], cursor);
    if (!condition && Object.hasOwn(ctx.schema, "else"))
      return ctx.apply(["else"], cursor);
    return true;
  },
};

/** `dependentSchemas`: applies a named subschema when the property is present. */
export const dependentSchemas: KeywordBehavior = {
  id: id("dependentSchemas"),
  analyze: mapPositions,
  evaluate: (value, cursor, ctx) => {
    if (!isObject(cursor.value)) return true;
    let ok = true;
    for (const name of Object.keys(value as Record<string, JsonValue>)) {
      if (
        Object.hasOwn(cursor.value, name) &&
        !ctx.apply(["dependentSchemas", name], cursor)
      ) {
        ok = false;
      }
    }
    return ok;
  },
};

/** EXEMPLAR (child applicator class): child cursors, produces the matched property names. */
export const properties: KeywordBehavior = {
  id: id("properties"),
  analyze: mapPositions,
  evaluate: (value, cursor, ctx) => {
    if (!isObject(cursor.value)) return true;
    let ok = true;
    const matched: string[] = [];
    for (const name of Object.keys(value as Record<string, JsonValue>)) {
      if (Object.hasOwn(cursor.value, name)) {
        matched.push(name);
        if (
          !ctx.apply(
            ["properties", name],
            childCursor(cursor, name, cursor.value[name]!),
          )
        )
          ok = false;
      }
    }
    ctx.produce(matched);
    return ok;
  },
};

/** `patternProperties`: applies to properties whose name matches a pattern; produces the matched names. */
export const patternProperties: KeywordBehavior = {
  id: id("patternProperties"),
  analyze: mapPositions,
  evaluate: (value, cursor, ctx) => {
    if (!isObject(cursor.value)) return true;
    let ok = true;
    const matched = new Set<string>();
    for (const pattern of Object.keys(value as Record<string, JsonValue>)) {
      const re = schemaRegExp(pattern);
      for (const name of Object.keys(cursor.value)) {
        if (re.test(name)) {
          matched.add(name);
          if (
            !ctx.apply(
              ["patternProperties", pattern],
              childCursor(cursor, name, cursor.value[name]!),
            )
          )
            ok = false;
        }
      }
    }
    ctx.produce([...matched]);
    return ok;
  },
};

/**
 * `additionalProperties`: applies to properties not matched by sibling
 * `properties`/`patternProperties` — statically derivable from the schema
 * object, no channel involvement (contrast `unevaluatedProperties`).
 */
export const additionalProperties: KeywordBehavior = {
  id: id("additionalProperties"),
  analyze: selfPosition,
  evaluate: (_value, cursor, ctx) => {
    if (!isObject(cursor.value)) return true;
    const names = isObject(ctx.schema.properties)
      ? new Set(Object.keys(ctx.schema.properties))
      : new Set<string>();
    const patterns = isObject(ctx.schema.patternProperties)
      ? Object.keys(ctx.schema.patternProperties).map((p) => schemaRegExp(p))
      : [];
    let ok = true;
    const matched: string[] = [];
    for (const name of Object.keys(cursor.value)) {
      if (names.has(name) || patterns.some((re) => re.test(name))) continue;
      matched.push(name);
      if (
        !ctx.apply(
          ["additionalProperties"],
          childCursor(cursor, name, cursor.value[name]!),
        )
      )
        ok = false;
    }
    ctx.produce(matched);
    return ok;
  },
};

/** `prefixItems`: applies each subschema to the array item at its index; produces the largest applied index. */
export const prefixItems: KeywordBehavior = {
  id: id("prefixItems"),
  analyze: arrayPositions,
  evaluate: (value, cursor, ctx) => {
    if (!Array.isArray(cursor.value)) return true;
    const schemas = value as JsonValue[];
    const n = Math.min(schemas.length, cursor.value.length);
    let ok = true;
    for (let i = 0; i < n; i++) {
      if (
        !ctx.apply(["prefixItems", i], childCursor(cursor, i, cursor.value[i]!))
      )
        ok = false;
    }
    // Annotation: largest applied index, or true when it covered the array.
    if (n > 0) ctx.produce(n === cursor.value.length ? true : n - 1);
    return ok;
  },
};

/** `items`: applies to array items past sibling `prefixItems`; produces `true` when it applied to any item. */
export const items: KeywordBehavior = {
  id: id("items"),
  analyze: selfPosition,
  evaluate: (_value, cursor, ctx) => {
    if (!Array.isArray(cursor.value)) return true;
    // Applies past the sibling prefixItems (statically known per spec).
    const start = Array.isArray(ctx.schema.prefixItems)
      ? ctx.schema.prefixItems.length
      : 0;
    let ok = true;
    let applied = false;
    for (let i = start; i < cursor.value.length; i++) {
      applied = true;
      if (!ctx.apply(["items"], childCursor(cursor, i, cursor.value[i]!)))
        ok = false;
    }
    if (applied) ctx.produce(true);
    return ok;
  },
};

/**
 * `contains`: at least one array item must match (range configurable by
 * sibling `minContains`/`maxContains`); produces matched indexes.
 */
export const contains: KeywordBehavior = {
  id: id("contains"),
  analyze: selfPosition,
  evaluate: (_value, cursor, ctx) => {
    if (!Array.isArray(cursor.value)) return true;
    const matched: number[] = [];
    for (let i = 0; i < cursor.value.length; i++) {
      if (ctx.apply(["contains"], childCursor(cursor, i, cursor.value[i]!)))
        matched.push(i);
    }
    // minContains/maxContains are inert siblings (validation.ts) that turn
    // the count into a range assertion instead of contains' own >=1 default;
    // minContains: 0 with zero matches is valid (suite: "minContains = 0").
    const min =
      typeof ctx.schema.minContains === "number" ? ctx.schema.minContains : 1;
    const max =
      typeof ctx.schema.maxContains === "number"
        ? ctx.schema.maxContains
        : Infinity;
    if (matched.length < min || matched.length > max) {
      ctx.error(
        `${matched.length} item(s) match the contains subschema, expected ${min}-${max}`,
      );
      return false;
    }
    // Annotation: matched indexes, or true when every item matched.
    if (matched.length > 0)
      ctx.produce(matched.length === cursor.value.length ? true : matched);
    return true;
  },
};

/**
 * `propertyNames`: applies the subschema to each property name (as a string
 * instance), not to the object itself.
 */
export const propertyNames: KeywordBehavior = {
  id: id("propertyNames"),
  analyze: selfPosition,
  evaluate: (_value, cursor, ctx) => {
    if (!isObject(cursor.value)) return true;
    let ok = true;
    for (const name of Object.keys(cursor.value)) {
      if (!ctx.apply(["propertyNames"], childCursor(cursor, name, name)))
        ok = false;
    }
    return ok;
  },
};

/** The 2020-12 applicator vocabulary's keyword behaviors, by name. */
export const applicatorVocabulary: Record<string, KeywordBehavior> = {
  allOf,
  anyOf,
  oneOf,
  not,
  if: ifKeyword,
  then: { id: id("then"), analyze: selfPosition, evaluate: () => true },
  else: { id: id("else"), analyze: selfPosition, evaluate: () => true },
  dependentSchemas,
  properties,
  patternProperties,
  additionalProperties,
  prefixItems,
  items,
  contains,
  propertyNames,
};
