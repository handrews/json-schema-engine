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
import { lowerIR } from "../lowering.js";

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
 *
 * Single-table contract: `lower()` resolves the format definition against
 * the closed-over `table` at compile time, so it is correct only when that
 * table is the compiling engine's `formats` — true by construction for the
 * Engine-constructed instances, the only production call sites (both the
 * `assertFormats` configuration and the format-assertion vocabulary close over
 * `options.formats`, which the compiler reads back through `engine.formats`).
 * A custom dialect that wires `assertingFormat` with a foreign table must drop
 * `lower` (accepting the interpreter fallback) rather than compile against a
 * table the artifact's runtime would not carry.
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
      // Report only formats the table can assert — the exact set lower()
      // emits a formatTest for (an unknown format under the best-effort
      // posture falls back to annotation-only and needs no table entry). This
      // keeps plan.formats == the artifact's used-format set, so the runtime's
      // missing-definition guard stays unreachable via public paths.
      return typeof value === "string" && Object.hasOwn(table, value)
        ? { produces: [id], formats: [value] }
        : { produces: [id] };
    },
    lower: (value, lctx) => {
      // Produce the annotation first, unconditionally — evaluate()'s
      // produce-before-assertion order (format's annotation value is the name).
      lctx.emit({ kind: "produce", value: { kind: "const", value } });
      if (typeof value !== "string") return; // metaschema's concern
      // Resolve against the closed-over table (the compiling engine's, per the
      // single-table contract above); the name is a schema constant. A
      // refuseUnknown instance never reaches here undefined — analyze() threw
      // at registration — so an undefined definition is the best-effort
      // posture's unrecognized format: fall back to annotation-only, emitting
      // nothing further (evaluate() parity).
      const definition = Object.hasOwn(table, value) ? table[value] : undefined;
      if (definition === undefined) return;
      const { and, not, typeIs, when, failWith, constant, formatTest } =
        lowerIR;
      lctx.emit(
        when(
          and(
            typeIs(lctx.instance, ...(definition.types ?? ["string"])),
            not(formatTest(value, lctx.instance)),
          ),
          [
            failWith(
              { format: constant(value) },
              "must match format '" + value + "'",
            ),
          ],
        ),
      );
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
