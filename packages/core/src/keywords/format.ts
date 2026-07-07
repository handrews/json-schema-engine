// The `format` keyword's asserting behavior (M7). Annotation-only `format`
// is the annotationOnly factory in each dialect module; this file supplies
// the assertion side: the format-table contract, the format-assertion
// vocabulary, and the best-effort configuration switch.
//
// Two assertion mechanisms with deliberately different unknown-format
// behavior:
//  - format-assertion VOCABULARY: promises assertion, so a format the
//    table cannot assert is refused at registration (UnknownFormatError).
//  - format-annotation + the `assertFormats` configuration: best effort —
//    recognized formats assert, unrecognized formats fall back to
//    annotation-only.

import { JsonValue, JsonType, jsonTypeOf } from "../json.js";
import { KeywordBehavior } from "../dialect.js";

/** 2020-12 format-assertion vocabulary URI. */
export const VOCAB_FORMAT_ASSERTION =
  "https://json-schema.org/draft/2020-12/vocab/format-assertion";

/**
 * One format's definition. `types` scopes the assertion: instances of
 * other types are vacuously valid (every standard JSON Schema format is
 * string-scoped, but the shape admits non-string formats — the
 * OpenAPI-registered int32/int64/double family applies to numbers).
 */
export interface FormatDefinition {
  /** instance types the format constrains; default ["string"] */
  readonly types?: readonly (JsonType | "integer")[];
  /** true when the (type-scoped) instance conforms */
  test(value: JsonValue): boolean;
}

/** Format name → definition. */
export type FormatTable = Readonly<Record<string, FormatDefinition>>;

/**
 * A schema uses a format the engine cannot assert while the
 * format-assertion vocabulary is in effect. Thrown at registration:
 * that vocabulary promises assertion, so unsupported formats are refused,
 * never silently annotated.
 */
export class UnknownFormatError extends Error {}

const appliesTo = (
  types: readonly (JsonType | "integer")[],
  value: JsonValue,
): boolean =>
  types.some((t) =>
    t === "integer"
      ? typeof value === "number" && Number.isInteger(value)
      : jsonTypeOf(value) === t,
  );

/**
 * Builds an asserting `format` behavior over a table. `refuseUnknown`
 * selects the vocabulary posture (refuse at registration) versus the
 * best-effort configuration posture (annotate unknowns).
 */
export function assertingFormat(
  id: string,
  table: FormatTable,
  refuseUnknown: boolean,
): KeywordBehavior {
  return {
    id,
    analyze: (value) => {
      if (
        refuseUnknown &&
        typeof value === "string" &&
        !Object.hasOwn(table, value)
      ) {
        throw new UnknownFormatError(
          `format '${value}' is not supported; the format-assertion ` +
            "vocabulary requires refusing formats it cannot assert",
        );
      }
      return { produces: [id] };
    },
    evaluate: (value, cursor, ctx) => {
      // The annotation is produced regardless of assertion outcome
      // (format's annotation value is the format name).
      ctx.produce(value);
      if (typeof value !== "string") return true; // metaschema's concern
      const definition = Object.hasOwn(table, value) ? table[value] : undefined;
      if (definition === undefined) return true; // best-effort fallback
      if (!appliesTo(definition.types ?? ["string"], cursor.value)) {
        return true;
      }
      if (definition.test(cursor.value)) return true;
      ctx.error(`must match format '${value}'`, { format: value });
      return false;
    },
  };
}
