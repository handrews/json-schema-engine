// Error message building, shared by both tiers (D13). A keyword describes
// each error once, as a {@link Description} built from lowering IR: its
// `lower()` emits that description and the compiler renders it into code;
// its `evaluate()` hands the same description to `KeywordContext.report`,
// and {@link realize} interprets it against the concrete instance when the
// record is rendered. One builder, so the two tiers cannot drift — which
// matters now that messages carry instance data rather than only schema
// constants.
//
// The formatting helpers are what messages call to show values. They are
// pure and bounded, and the compiled runtime binds the same functions under
// fixed names. Bounded matters: an error is often recorded and then dropped
// (a losing `anyOf` branch, an `if` condition), so previewing a ten-megabyte
// instance must cost the same as previewing a short one.

import {
  type JsonValue,
  canonicalKey,
  codePointLength,
  escapeSegment,
  firstDuplicatePair,
  hasDuplicateItems,
  isMultipleOf,
  isObject,
  jsonEqual,
  jsonTypeOf,
} from "./json.js";
import type { ErrorParams } from "./dialect.js";
import type {
  Description,
  LowerExpr,
  LowerHelper,
  LowerMessageHelper,
  LowerValueHelper,
} from "./lowering.js";

/** The longest a value is shown in a message, in code points, `…` included. Params carry the full value. */
export const PREVIEW_LIMIT = 64;

/** The most names {@link nameList} shows before summarizing the rest. */
export const NAME_LIMIT = 10;

const ELLIPSIS = "…";

// --- formatting helpers ------------------------------------------------------

/** Cuts `text` to {@link PREVIEW_LIMIT} code points, the last one `…`. */
function cut(text: string): string {
  if (text.length <= PREVIEW_LIMIT) return text;
  const points = Array.from(text);
  if (points.length <= PREVIEW_LIMIT) return text;
  return points.slice(0, PREVIEW_LIMIT - 1).join("") + ELLIPSIS;
}

/**
 * The first `count` code points of `s` (never splitting a surrogate pair),
 * or all of it. Bounded by `count`, not by the string.
 */
function codePoints(s: string, count: number): string {
  let end = 0;
  for (let n = 0; n < count && end < s.length; n++) {
    end += s.codePointAt(end)! > 0xffff ? 2 : 1;
  }
  return end >= s.length ? s : s.slice(0, end);
}

/**
 * `value` as compact JSON (`{"a": true, "b": [1, 2.5, null]}`), cut to
 * {@link PREVIEW_LIMIT} code points with `…`. JSON rather than `String()`,
 * which would show `[object Object]`. Containers are walked only as far as
 * the text is shown and a string is escaped only up to the budget, so the
 * cost does not grow with the instance.
 */
export function preview(value: JsonValue): string {
  let text = "";
  // Returns false once the budget is spent, so a walk can stop.
  const put = (piece: string): boolean => {
    text += piece;
    return text.length <= PREVIEW_LIMIT;
  };
  const walk = (v: JsonValue): boolean => {
    if (typeof v === "string") {
      // One code point past the budget is enough to know it was cut.
      return put(JSON.stringify(codePoints(v, PREVIEW_LIMIT + 1)));
    }
    if (v === null || typeof v !== "object") return put(JSON.stringify(v));
    if (Array.isArray(v)) {
      if (!put("[")) return false;
      for (let i = 0; i < v.length; i++) {
        if (i > 0 && !put(", ")) return false;
        if (!walk(v[i]!)) return false;
      }
      return put("]");
    }
    if (!put("{")) return false;
    let first = true;
    for (const key of Object.keys(v)) {
      if (!first && !put(", ")) return false;
      first = false;
      if (!put(JSON.stringify(codePoints(key, PREVIEW_LIMIT + 1)) + ": ")) {
        return false;
      }
      if (!walk(v[key]!)) return false;
    }
    return put("}");
  };
  walk(value);
  return cut(text);
}

/**
 * The type a reader would name: `integer` for a mathematical integer (`3`,
 * `3.0`), otherwise the JSON type. A boolean is never a number.
 */
export function apparentType(value: JsonValue): string {
  if (typeof value === "number" && Number.isInteger(value)) return "integer";
  return jsonTypeOf(value);
}

/**
 * A scalar with its apparent type, `3 (integer)`; a container by its type
 * alone, `array`, since its value can be arbitrarily large.
 */
export function typedPreview(value: JsonValue): string {
  if (Array.isArray(value) || isObject(value)) return apparentType(value);
  return `${preview(value)} (${apparentType(value)})`;
}

const sortedUnique = (indexes: readonly number[]): number[] =>
  [...new Set(indexes)].sort((a, b) => a - b);

/**
 * Consecutive runs as `[first, last]` pairs: `[1, 2, 3, 5]` gives
 * `[[1, 3], [5, 5]]`. The params form of {@link indexRanges}.
 */
export function ranges(indexes: readonly number[]): number[][] {
  const runs: number[][] = [];
  for (const index of sortedUnique(indexes)) {
    const last = runs[runs.length - 1];
    if (last !== undefined && index === last[1]! + 1) last[1] = index;
    else runs.push([index, index]);
  }
  return runs;
}

/**
 * Indexes with runs of three or more collapsed: `0, 1, 3-5`; `none` if
 * empty. A pair stays a pair, since `0-1` reads as a range of nothing.
 */
export function indexRanges(indexes: readonly number[]): string {
  const parts: string[] = [];
  for (const [a, b] of ranges(indexes) as [number, number][]) {
    if (b - a >= 2) parts.push(`${a}-${b}`);
    else for (let i = a; i <= b; i++) parts.push(String(i));
  }
  return parts.length === 0 ? "none" : parts.join(", ");
}

/**
 * Names as JSON strings, the first {@link NAME_LIMIT} of them, then a
 * count of the rest: `"a", "b" and 12 more`.
 */
export function nameList(names: readonly string[]): string {
  const shown = names.slice(0, NAME_LIMIT).map(preview).join(", ");
  const rest = names.length - NAME_LIMIT;
  return rest > 0 ? `${shown} and ${rest} more` : shown;
}

/** `property "b"` or `properties "b", "c"`: a {@link nameList} with its noun agreeing in number. */
export function labeledNames(
  names: readonly string[],
  singular: string,
  plural: string,
): string {
  return `${names.length === 1 ? singular : plural} ${nameList(names)}`;
}

/** `none`, `1 item (4)`, or `2 items (0, 3)`. */
export function countedIndexes(
  indexes: readonly number[],
  singular: string,
  plural: string,
): string {
  if (indexes.length === 0) return "none";
  const noun = indexes.length === 1 ? singular : plural;
  return `${indexes.length} ${noun} (${indexRanges(indexes)})`;
}

/** Groups of equal items: `[0, 2] are equal; [1, 4, 5] are equal`. */
export function indexGroups(groups: readonly (readonly number[])[]): string {
  return groups.map((g) => `[${g.join(", ")}] are equal`).join("; ");
}

/**
 * Every group of two or more equal items, as indexes, ordered by each
 * group's first index. One pass bucketed by {@link canonicalKey}; a bucket
 * is split by {@link jsonEqual}, since equal keys do not guarantee equal
 * values.
 */
export function duplicateGroups(items: readonly JsonValue[]): number[][] {
  const buckets = new Map<string, number[][]>();
  const found: number[][] = [];
  items.forEach((item, index) => {
    const key = canonicalKey(item);
    let groups = buckets.get(key);
    if (groups === undefined) {
      groups = [];
      buckets.set(key, groups);
    }
    const group = groups.find((g) => jsonEqual(items[g[0]!]!, item));
    if (group === undefined) groups.push([index]);
    else {
      if (group.length === 1) found.push(group);
      group.push(index);
    }
  });
  return found.sort((a, b) => a[0]! - b[0]!);
}

/** The string `names` an object instance lacks, in keyword order. */
export function missingNames(
  instance: JsonValue,
  names: readonly JsonValue[],
): string[] {
  if (!isObject(instance)) return [];
  return names.filter(
    (n): n is string => typeof n === "string" && !Object.hasOwn(instance, n),
  );
}

/**
 * For each property present whose array member in `spec` names properties
 * the instance lacks, those missing names. Non-array members (draft-07
 * `dependencies`' schemas) are not this helper's concern.
 */
export function missingDependencies(
  instance: JsonValue,
  spec: JsonValue,
): Record<string, string[]> {
  const found: Record<string, string[]> = {};
  if (!isObject(instance) || !isObject(spec)) return found;
  for (const [name, deps] of Object.entries(spec)) {
    if (!Object.hasOwn(instance, name) || !Array.isArray(deps)) continue;
    const missing = missingNames(instance, deps);
    if (missing.length > 0) found[name] = missing;
  }
  return found;
}

/** `"a" requires "b", "c"; "d" requires "e"`. */
export function dependencyList(
  missing: Readonly<Record<string, readonly string[]>>,
): string {
  return Object.entries(missing)
    .map(([name, deps]) => `${preview(name)} requires ${nameList(deps)}`)
    .join("; ");
}

// --- the helper tables ---------------------------------------------------------

// Every helper is called with the values its IR arguments evaluate to; the
// table's parameter type is the one every function signature accepts.
type HelperFn = (...args: never[]) => unknown;

/** The message-formatting helpers by IR name: what a message or its params may call, and what the compiled runtime binds. */
export const messageHelpers: Readonly<Record<LowerMessageHelper, HelperFn>> = {
  preview,
  apparentType,
  typedPreview,
  indexRanges,
  ranges,
  nameList,
  labeledNames,
  countedIndexes,
  indexGroups,
  duplicateGroups,
  missingNames,
  missingDependencies,
  dependencyList,
};

const valueHelpers: Readonly<Record<LowerValueHelper, HelperFn>> = {
  codePointLength,
  jsonEqual,
  canonicalKey,
  escapeSegment,
  keysOf: (v: object) => Object.keys(v),
  lengthOf: (v: { length: number }) => v.length,
  isMultipleOf,
  hasDuplicateItems,
  firstDuplicatePair,
};

/** Every helper a lowered expression may call, by IR name. */
export const helperTable: Readonly<Record<LowerHelper, HelperFn>> = {
  ...valueHelpers,
  ...messageHelpers,
};

// --- realize ---------------------------------------------------------------------

const typeIs = (value: unknown, types: readonly string[]): boolean =>
  types.some((t) =>
    t === "integer"
      ? typeof value === "number" && Number.isInteger(value)
      : jsonTypeOf(value as JsonValue) === t,
  );

function compare(op: string, left: unknown, right: unknown): boolean {
  switch (op) {
    case "<":
      return (left as number) < (right as number);
    case "<=":
      return (left as number) <= (right as number);
    case ">":
      return (left as number) > (right as number);
    case ">=":
      return (left as number) >= (right as number);
    case "===":
      return left === right;
    default:
      return left !== right;
  }
}

/**
 * Evaluates the IR subset a message or its params may use against
 * `instance`. An evaluate-side description carries runtime values as
 * `lowerIR.constant(...)`: a `binding`, `tally` or `tallyList` names
 * compiled-only data and throws.
 */
export function valueOf(e: LowerExpr, instance: JsonValue): unknown {
  switch (e.kind) {
    case "instance":
      return instance;
    case "const":
      return e.value;
    case "member":
      return (valueOf(e.target, instance) as Record<string, JsonValue>)[e.key];
    case "item":
      return (valueOf(e.target, instance) as JsonValue[])[
        valueOf(e.index, instance) as number
      ];
    case "typeIs":
      return typeIs(valueOf(e.target, instance), e.types);
    case "hasOwn": {
      const target = valueOf(e.target, instance);
      const key = typeof e.key === "string" ? e.key : valueOf(e.key, instance);
      return isObject(target) && Object.hasOwn(target, key as PropertyKey);
    }
    case "cmp":
      return compare(
        e.op,
        valueOf(e.left, instance),
        valueOf(e.right, instance),
      );
    case "not":
      return !valueOf(e.expr, instance);
    case "logic":
      return e.op === "and"
        ? e.parts.every((p) => Boolean(valueOf(p, instance)))
        : e.parts.some((p) => Boolean(valueOf(p, instance)));
    case "helper": {
      // The table is typed by what every helper accepts; here each one is
      // called with exactly the values its own IR arguments produce.
      const fn = helperTable[e.helper] as (...args: unknown[]) => unknown;
      return fn(...e.args.map((a) => valueOf(a, instance)));
    }
    default:
      throw new TypeError(
        `'${e.kind}' cannot be realized: an evaluate-side description carries runtime values as constants`,
      );
  }
}

/**
 * The message text and params a record reports for a description: literal
 * parts as written, expression parts through `String()`, exactly what the
 * compiled evaluator builds from the same description. Params are realized
 * only when `withParams` is set, since most renderings omit them.
 */
export function realize(
  description: Description,
  instance: JsonValue,
  withParams = true,
): { message: string; params: ErrorParams | undefined } {
  let message = "";
  for (const part of description.message) {
    message +=
      typeof part === "string" ? part : String(valueOf(part, instance));
  }
  if (!withParams || description.params === undefined) {
    return { message, params: undefined };
  }
  const params: Record<string, JsonValue> = {};
  for (const [key, part] of Object.entries(description.params)) {
    params[key] = valueOf(part, instance) as JsonValue;
  }
  return { message, params };
}
