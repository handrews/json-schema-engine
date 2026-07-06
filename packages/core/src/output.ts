// Output rendering (DESIGN.md D6): one internal result, projected into
// either location-field vocabulary. Default is the current output spec's
// `evaluationPath`/`schemaLocation`; the 2020-12 names
// (`keywordLocation`/`absoluteKeywordLocation`) are the compatibility option.
// M1 ships flag + flat list (Basic-style) structures; hierarchical/verbose
// structures are M5.

import { escapeSegment } from "./json.js";
import { instancePointer } from "./cursor.js";
import {
  ErrorRecord, PathNode, Production, materializePath,
} from "./engine.js";

export type LocationVocabulary = "modern" | "2020-12";

export interface ErrorUnit {
  instanceLocation: string;
  error: string;
  // modern
  evaluationPath?: string;
  schemaLocation?: string;
  // 2020-12
  keywordLocation?: string;
  absoluteKeywordLocation?: string;
}

export interface AnnotationUnit extends Omit<ErrorUnit, "error"> {
  keyword: string;
  vocabulary?: string;
  annotation: unknown;
}

export interface RetentionPolicy {
  /** allow-list of keyword names; an empty array retains nothing */
  keywords?: readonly string[];
  /** allow-list of vocabulary URIs (OR-ed with `keywords`) */
  vocabularies?: readonly string[];
  /** arbitrary predicate over the rendered unit, AND-ed after the lists */
  keep?: (unit: AnnotationUnit) => boolean;
}

function locations(
  pathNode: PathNode | null,
  keywordName: string | null,
  schemaRef: { baseUri: string; pointer: string },
  vocabulary: LocationVocabulary,
): Pick<ErrorUnit, "evaluationPath" | "schemaLocation" | "keywordLocation" | "absoluteKeywordLocation"> {
  const keywordSuffix = keywordName === null ? "" : "/" + escapeSegment(keywordName);
  const evaluationPath = materializePath(pathNode) + keywordSuffix;
  const schemaLocation = `${schemaRef.baseUri}#${schemaRef.pointer}${keywordSuffix}`;
  return vocabulary === "modern"
    ? { evaluationPath, schemaLocation }
    : { keywordLocation: evaluationPath, absoluteKeywordLocation: schemaLocation };
}

export function renderError(record: ErrorRecord, vocabulary: LocationVocabulary): ErrorUnit {
  return {
    ...locations(record.pathNode, record.keywordName, record.schemaRef, vocabulary),
    instanceLocation: instancePointer(record.cursor),
    error: record.message,
  };
}

export function renderAnnotation(
  production: Production,
  vocabulary: LocationVocabulary,
): AnnotationUnit {
  return {
    keyword: production.keywordName,
    ...(production.vocabularyUri === null ? {} : { vocabulary: production.vocabularyUri }),
    ...locations(production.pathNode, production.keywordName, production.schemaRef, vocabulary),
    instanceLocation: instancePointer(production.cursor),
    annotation: production.value,
  };
}

export function applyRetention(
  productions: readonly Production[],
  retention: RetentionPolicy | undefined,
  vocabulary: LocationVocabulary,
): AnnotationUnit[] {
  let selected = productions;
  if (retention?.keywords !== undefined || retention?.vocabularies !== undefined) {
    const names = new Set(retention.keywords ?? []);
    const vocabs = new Set(retention.vocabularies ?? []);
    selected = selected.filter(
      (p) => names.has(p.keywordName)
        || (p.vocabularyUri !== null && vocabs.has(p.vocabularyUri)),
    );
  }
  let units = selected.map((p) => renderAnnotation(p, vocabulary));
  if (retention?.keep) units = units.filter(retention.keep);
  return units;
}
