// Resource loading types (DESIGN.md D7/D17). Loading is the only async
// boundary: loaders feed Engine.load/loadSchema, which register documents
// and their transitive references; compile and evaluate stay sync.

import { JsonValue } from "./json.js";

/** 1-based line/column; offset is 0-based when present. */
export interface SourcePosition {
  line: number;
  column: number;
  offset?: number;
}

export interface SourceSpan {
  start: SourcePosition;
  end: SourcePosition;
}

// Key vs value spans (D17): diagnostics point at the key for missing/extra-
// property errors and at the value for type errors; SARIF/LSP-class
// consumers need both.
export interface SourceRange {
  /** span of the member key, when the value is an object member */
  key?: SourceSpan;
  value: SourceSpan;
}

export interface LoadedDocument {
  value: JsonValue;
  /**
   * Source range for a document-rooted JSON Pointer (D17). A function rather
   * than a materialized map so loaders can keep a parse AST and resolve
   * lazily; returning undefined for any pointer is always allowed.
   */
  getRange?: (documentRootPointer: string) => SourceRange | undefined;
}

/** Returns undefined when this loader does not handle the URI. */
export type SchemaLoader = (
  uri: string,
) => LoadedDocument | undefined | Promise<LoadedDocument | undefined>;

/** Where a canonical schema location physically lives (D17). */
export interface SourceLocation {
  documentUri: string;
  pointer: string;
  range?: SourceRange;
}
