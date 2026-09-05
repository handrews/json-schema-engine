// Compiled-tier port of the consumer keywords' channel-reading semantics
// (COMPILED-CONSUMERS.md). The runtime coverage channel is a flat array of
// RAW DEPENDENCY DATA — the same values `ctx.produce` yields — merged with
// mark/truncate at application boundaries by the serializer (phase B). These
// helpers fold that channel exactly as the interpreter's `unevaluated*`
// evaluate() folds visible dependency records, dispatching on VALUE SHAPE
// (the shape is unambiguous, so one mixed names+indexes channel is sound):
//
// - `string[]`  evaluated property names (properties/patternProperties/
//               additionalProperties/unevaluatedProperties values); folds
//               into name coverage. Empty array is a no-op.
// - `true`      full index coverage (items / contains-all /
//               prefixItems-covered-whole-array / unevaluatedItems values).
// - `number` n  prefix coverage of indexes 0..n, i.e. coveredPrefix = n+1
//               (prefixItems' largest-applied-index value).
// - `number[]`  individual covered indexes (contains' matched list).
//
// Name folding ignores non-`string[]` entries; index folding ignores
// `string[]` entries; `[]` is a no-op for both.

import { DependencyRecord } from "./engine.js";
import { Cursor } from "./cursor.js";

/**
 * Folded name coverage: the set of evaluated property names. Ports
 * `unevaluatedProperties.evaluate`'s seen-set union — every `string[]` entry
 * contributes its names; other shapes are ignored.
 */
export function foldNameCoverage(channel: readonly unknown[]): Set<string> {
  const seen = new Set<string>();
  for (const entry of channel) {
    if (Array.isArray(entry)) {
      for (const el of entry) {
        if (typeof el === "string") seen.add(el);
      }
    }
  }
  return seen;
}

/**
 * Folded index coverage over an array of the given length. Ports
 * `unevaluatedItems.evaluate`'s coveredPrefix/coveredIdx computation: `true`
 * covers the whole array, a `number` extends the covered prefix to value+1
 * (max-folded), a `number[]` marks individual indexes.
 */
export function foldIndexCoverage(
  channel: readonly unknown[],
  length: number,
): { coveredPrefix: number; coveredIdx: Set<number> } {
  let coveredPrefix = 0;
  const coveredIdx = new Set<number>();
  for (const entry of channel) {
    if (entry === true) {
      coveredPrefix = length;
    } else if (typeof entry === "number") {
      coveredPrefix = Math.max(coveredPrefix, entry + 1);
    } else if (Array.isArray(entry)) {
      // number[] (contains' matched list); string[] contributes no indexes.
      for (const el of entry) {
        if (typeof el === "number") coveredIdx.add(el);
      }
    }
  }
  return { coveredPrefix, coveredIdx };
}

/**
 * Channel entries a fragment (interpreted island) contributes: the data of
 * consumed-producer dependency records at the island's root cursor.
 * `evaluateFragment` returns root-frame surviving records with cursor
 * identity intact; filtering to the fragment's root `cursor` keeps coverage
 * per-instance-location, and filtering to `consumedIds` keeps only
 * producer keywords a consumer would observe. Data passes through untouched.
 */
export function harvestCoverage(
  dependencies: readonly DependencyRecord[],
  cursor: Cursor,
  consumedIds: ReadonlySet<string>,
): unknown[] {
  const out: unknown[] = [];
  for (const d of dependencies) {
    if (d.cursor === cursor && consumedIds.has(d.behaviorId)) out.push(d.data);
  }
  return out;
}
