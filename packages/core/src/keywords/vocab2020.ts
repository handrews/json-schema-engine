// Assembly of the 2020-12 dialect from its vocabularies (DESIGN.md D2).

import { KeywordBehavior, DialectRegistry } from "../dialect.js";
import { coreVocabulary, VOCAB_CORE, annotationOnly } from "./core.js";
import { applicatorVocabulary, VOCAB_APPLICATOR } from "./applicator.js";
import { validationVocabulary, VOCAB_VALIDATION } from "./validation.js";
import { unevaluatedVocabulary, VOCAB_UNEVALUATED } from "./unevaluated.js";
import { registerDialect2019 } from "./vocab2019.js";
import { registerDialect07, registerDialect06 } from "./vocab7.js";

/** 2020-12 meta-data vocabulary URI. */
export const VOCAB_META_DATA =
  "https://json-schema.org/draft/2020-12/vocab/meta-data";
/** 2020-12 format-annotation vocabulary URI. */
export const VOCAB_FORMAT_ANNOTATION =
  "https://json-schema.org/draft/2020-12/vocab/format-annotation";
/** 2020-12 content vocabulary URI. */
export const VOCAB_CONTENT =
  "https://json-schema.org/draft/2020-12/vocab/content";

/** 2020-12 dialect URI. */
export const DIALECT_2020_12 = "https://json-schema.org/draft/2020-12/schema";

const metaDataVocabulary = Object.fromEntries(
  [
    "title",
    "description",
    "default",
    "deprecated",
    "readOnly",
    "writeOnly",
    "examples",
  ].map((name) => [name, annotationOnly(`${VOCAB_META_DATA}#${name}`)]),
);

/**
 * Options for {@link registerStandardDialects} (M7): `format` replaces the
 * default annotation-only `format` behavior in every standard dialect —
 * the `assertFormats` best-effort configuration.
 */
export interface StandardDialectOptions {
  format?: (id: string) => KeywordBehavior;
}

// content* keywords are never assertions.
const contentVocabulary = Object.fromEntries(
  ["contentMediaType", "contentEncoding", "contentSchema"].map((name) => [
    name,
    annotationOnly(`${VOCAB_CONTENT}#${name}`),
  ]),
);

/** Registers the 2020-12, 2019-09, draft-07, and draft-06 vocabularies and dialects. */
export function registerStandardDialects(
  registry: DialectRegistry,
  options: StandardDialectOptions = {},
): void {
  const format = options.format ?? annotationOnly;
  registry.registerVocabulary(VOCAB_CORE, coreVocabulary);
  registry.registerVocabulary(VOCAB_APPLICATOR, applicatorVocabulary);
  registry.registerVocabulary(VOCAB_VALIDATION, validationVocabulary);
  registry.registerVocabulary(VOCAB_UNEVALUATED, unevaluatedVocabulary);
  registry.registerVocabulary(VOCAB_META_DATA, metaDataVocabulary);
  registry.registerVocabulary(VOCAB_FORMAT_ANNOTATION, {
    format: format(`${VOCAB_FORMAT_ANNOTATION}#format`),
  });
  registry.registerVocabulary(VOCAB_CONTENT, contentVocabulary);

  registry.registerDialect(DIALECT_2020_12, [
    VOCAB_CORE,
    VOCAB_APPLICATOR,
    VOCAB_VALIDATION,
    VOCAB_UNEVALUATED,
    VOCAB_META_DATA,
    VOCAB_FORMAT_ANNOTATION,
    VOCAB_CONTENT,
  ]);

  registerDialect2019(registry, format);
  registerDialect07(registry, format);
  registerDialect06(registry, format);
}
