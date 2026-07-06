// Instance cursor: a parent-linked position in the instance document.
//
// Cursor identity carries semantic weight: in-place applicators ($ref, allOf,
// if, ...) apply subschemas to the *same* cursor object, while child
// applicators (properties, items, ...) create child cursors. The channel's
// visibility query keys on this identity (engine.ts). JSON Pointer strings
// are materialized lazily, only when output units escape.

import { JsonValue, escapeSegment } from "./json.js";

/** A parent-linked position in the instance document. */
export interface Cursor {
  readonly value: JsonValue;
  readonly parent: Cursor | null;
  readonly segment: string | number | null;
  /** Lazily cached JSON Pointer; use {@link instancePointer}. */
  ptr?: string;
}

/** Creates a cursor at the instance document root. */
export const rootCursor = (value: JsonValue): Cursor => ({
  value,
  parent: null,
  segment: null,
});

/** Creates a cursor for a named or indexed child of `parent`. */
export const childCursor = (
  parent: Cursor,
  segment: string | number,
  value: JsonValue,
): Cursor => ({ value, parent, segment });

/** Computes the JSON Pointer for a cursor's instance location, caching the result. */
export function instancePointer(cursor: Cursor): string {
  if (cursor.ptr !== undefined) return cursor.ptr;
  if (cursor.parent === null) return (cursor.ptr = "");
  return (cursor.ptr =
    instancePointer(cursor.parent) +
    "/" +
    escapeSegment(String(cursor.segment)));
}
