// Assembly of the 2020-12 dialect from its vocabularies (DESIGN.md D2).

import { DialectRegistry } from "../dialect.js";
import { coreVocabulary, VOCAB_CORE, annotationOnly } from "./core.js";
import { applicatorVocabulary, VOCAB_APPLICATOR } from "./applicator.js";
import { validationVocabulary, VOCAB_VALIDATION } from "./validation.js";
import { unevaluatedVocabulary, VOCAB_UNEVALUATED } from "./unevaluated.js";
import { registerDialect2019 } from "./vocab2019.js";
import { registerDialect07, registerDialect06 } from "./vocab7.js";

export const VOCAB_META_DATA =
  "https://json-schema.org/draft/2020-12/vocab/meta-data";
export const VOCAB_FORMAT_ANNOTATION =
  "https://json-schema.org/draft/2020-12/vocab/format-annotation";
export const VOCAB_CONTENT =
  "https://json-schema.org/draft/2020-12/vocab/content";

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

// format is annotation-only under the Format-Annotation vocabulary; the
// Format-Assertion vocabulary is M7's.
const formatAnnotationVocabulary = {
  format: annotationOnly(`${VOCAB_FORMAT_ANNOTATION}#format`),
};

// content* keywords are never assertions.
const contentVocabulary = Object.fromEntries(
  ["contentMediaType", "contentEncoding", "contentSchema"].map((name) => [
    name,
    annotationOnly(`${VOCAB_CONTENT}#${name}`),
  ]),
);

export function registerStandardDialects(registry: DialectRegistry): void {
  registry.registerVocabulary(VOCAB_CORE, coreVocabulary);
  registry.registerVocabulary(VOCAB_APPLICATOR, applicatorVocabulary);
  registry.registerVocabulary(VOCAB_VALIDATION, validationVocabulary);
  registry.registerVocabulary(VOCAB_UNEVALUATED, unevaluatedVocabulary);
  registry.registerVocabulary(VOCAB_META_DATA, metaDataVocabulary);
  registry.registerVocabulary(
    VOCAB_FORMAT_ANNOTATION,
    formatAnnotationVocabulary,
  );
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

  registerDialect2019(registry);
  registerDialect07(registry);
  registerDialect06(registry);
}
