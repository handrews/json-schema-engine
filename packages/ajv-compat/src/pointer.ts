// One JSON Pointer codec for the whole adapter, over core's segment
// escaping — errors.ts, mutate.ts, and index.ts previously each carried
// their own.

import { escapeSegment, unescapeSegment, type JsonValue } from "@jse/core";

/** Decoded segments of a JSON Pointer (`""` → `[]`). */
export const segments = (pointer: string): string[] =>
  pointer === "" ? [] : pointer.slice(1).split("/").map(unescapeSegment);

/** Decoded segments back to a JSON Pointer (`[]` → `""`). */
export const joinPointer = (segs: readonly string[]): string =>
  segs.length === 0 ? "" : "/" + segs.map(escapeSegment).join("/");

/** Value at `pointer` under `doc`; undefined when the path does not exist. */
export const getAtPointer = (
  doc: JsonValue,
  pointer: string,
): JsonValue | undefined => {
  let node: JsonValue | undefined = doc;
  for (const seg of segments(pointer)) {
    if (Array.isArray(node)) node = node[Number(seg)];
    else if (typeof node === "object" && node !== null)
      node = (node as Record<string, JsonValue>)[seg];
    else return undefined;
  }
  return node;
};
