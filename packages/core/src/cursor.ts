// Instance cursor: a parent-linked position in the instance document.
//
// Cursor identity carries semantic weight: in-place applicators ($ref, allOf,
// if, ...) apply subschemas to the *same* cursor object, while child
// applicators (properties, items, ...) create child cursors. The channel's
// visibility query (engine.ts) filters productions by cursor identity, which
// is exactly "annotations that apply to the instance location being
// validated" — no string comparison on the hot path. JSON Pointer strings are
// materialized lazily, only when output units escape.

import { JsonValue, escapeSegment } from "./json.js";

export interface Cursor {
  readonly value: JsonValue;
  readonly parent: Cursor | null;
  readonly segment: string | number | null;
  /** lazily cached JSON Pointer; use instancePointer() */
  ptr?: string;
}

export const rootCursor = (value: JsonValue): Cursor =>
  ({ value, parent: null, segment: null });

export const childCursor = (parent: Cursor, segment: string | number, value: JsonValue): Cursor =>
  ({ value, parent, segment });

export function instancePointer(cursor: Cursor): string {
  if (cursor.ptr !== undefined) return cursor.ptr;
  if (cursor.parent === null) return (cursor.ptr = "");
  return (cursor.ptr =
    instancePointer(cursor.parent) + "/" + escapeSegment(String(cursor.segment)));
}
