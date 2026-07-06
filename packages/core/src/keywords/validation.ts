// Validation vocabulary: pure assertions.
//
// EXEMPLAR (assertion class): `pattern` — inspect the instance, report one
// error on failure, return the verdict. Assertions never produce and never
// descend.

import {
  JsonValue, isObject, jsonTypeOf, jsonEqual, codePointLength, schemaRegExp,
} from "../json.js";
import { KeywordBehavior, KeywordContext } from "../dialect.js";
import { Cursor } from "../cursor.js";
import { notImplemented } from "./core.js";

export const VOCAB_VALIDATION = "https://json-schema.org/draft/2020-12/vocab/validation";

const id = (name: string): string => `${VOCAB_VALIDATION}#${name}`;

const assertion = (
  name: string,
  test: (value: JsonValue, instance: JsonValue) => boolean,
  message: (value: JsonValue) => string,
): KeywordBehavior => ({
  id: id(name),
  evaluate: (value: JsonValue, cursor: Cursor, ctx: KeywordContext) => {
    if (test(value, cursor.value)) return true;
    ctx.error(message(value));
    return false;
  },
});

const typeMatches = (t: JsonValue, v: JsonValue): boolean =>
  t === "integer"
    ? typeof v === "number" && Number.isInteger(v)
    : jsonTypeOf(v) === t;

export const pattern = assertion(
  "pattern",
  (value, instance) =>
    typeof instance !== "string" || schemaRegExp(value as string).test(instance),
  () => "does not match required pattern",
);

export const validationVocabulary: Record<string, KeywordBehavior> = {
  type: assertion(
    "type",
    (value, instance) => Array.isArray(value)
      ? value.some((t) => typeMatches(t!, instance))
      : typeMatches(value, instance),
    (value) => `expected type ${JSON.stringify(value)}`,
  ),
  enum: assertion(
    "enum",
    (value, instance) => (value as JsonValue[]).some((x) => jsonEqual(x!, instance)),
    () => "not one of the allowed values",
  ),
  const: assertion(
    "const",
    (value, instance) => jsonEqual(value, instance),
    () => "does not equal the required constant",
  ),
  pattern,
  minLength: assertion(
    "minLength",
    (value, instance) =>
      typeof instance !== "string" || codePointLength(instance) >= (value as number),
    (value) => `must be at least ${value} characters`,
  ),
  maxLength: assertion(
    "maxLength",
    (value, instance) =>
      typeof instance !== "string" || codePointLength(instance) <= (value as number),
    (value) => `must be at most ${value} characters`,
  ),
  minimum: assertion(
    "minimum",
    (value, instance) => typeof instance !== "number" || instance >= (value as number),
    (value) => `must be >= ${value}`,
  ),
  maximum: assertion(
    "maximum",
    (value, instance) => typeof instance !== "number" || instance <= (value as number),
    (value) => `must be <= ${value}`,
  ),
  exclusiveMinimum: assertion(
    "exclusiveMinimum",
    (value, instance) => typeof instance !== "number" || instance > (value as number),
    (value) => `must be > ${value}`,
  ),
  exclusiveMaximum: assertion(
    "exclusiveMaximum",
    (value, instance) => typeof instance !== "number" || instance < (value as number),
    (value) => `must be < ${value}`,
  ),
  minItems: assertion(
    "minItems",
    (value, instance) => !Array.isArray(instance) || instance.length >= (value as number),
    (value) => `must have at least ${value} items`,
  ),
  maxItems: assertion(
    "maxItems",
    (value, instance) => !Array.isArray(instance) || instance.length <= (value as number),
    (value) => `must have at most ${value} items`,
  ),
  minProperties: assertion(
    "minProperties",
    (value, instance) =>
      !isObject(instance) || Object.keys(instance).length >= (value as number),
    (value) => `must have at least ${value} properties`,
  ),
  maxProperties: assertion(
    "maxProperties",
    (value, instance) =>
      !isObject(instance) || Object.keys(instance).length <= (value as number),
    (value) => `must have at most ${value} properties`,
  ),
  required: {
    id: id("required"),
    evaluate: (value, cursor, ctx) => {
      if (!isObject(cursor.value)) return true;
      let ok = true;
      for (const name of value as string[]) {
        if (!Object.hasOwn(cursor.value, name)) {
          ctx.error(`missing required property '${name}'`);
          ok = false;
        }
      }
      return ok;
    },
  },
  // Owed by M2 (DESIGN.md §5): loud placeholders, never silent misvalidation.
  multipleOf: notImplemented(id("multipleOf"), "M2"),
  uniqueItems: notImplemented(id("uniqueItems"), "M2"),
  minContains: notImplemented(id("minContains"), "M2"),
  maxContains: notImplemented(id("maxContains"), "M2"),
  dependentRequired: notImplemented(id("dependentRequired"), "M2"),
};
