// Mutation trio (M8.3): coerceTypes / useDefaults / removeAdditional as a
// compat-layer evaluate→mutate→re-evaluate fixpoint — the engine stays a
// pure validator. Each pass reads two engine outputs: the hierarchical
// verbose document (schema-application pairs drive defaults and property
// removal) and the flat error list with structured params (type failures
// drive coercion). Every behavior here is pinned by
// test/fixtures/ajv-mutation.json (AJV executed, never read — D15),
// including: mutations persist even when validation still fails; inserted
// defaults are copies, never shared references; tuple defaults extend the
// array; removeAdditional "all" acts only where property keywords exist;
// the top-level value can be replaced only through the holder (AJV cannot
// rebind its caller's variable either — the verdict reflects the coerced
// value, the caller's binding keeps the original).
//
// This file deliberately does NOT use core's walkSchema: mutation is not a
// schema walk. It follows the engine's own application records back to
// specific schema nodes and reads keyword VALUES there (a `default`, the
// patternProperties map, the literal additionalProperties value).

import { unescapeSegment } from "@jse/core";
import type { Engine, ErrorUnit, JsonValue, OutputUnit } from "@jse/core";
import { getAtPointer, joinPointer, segments } from "./pointer.js";

export interface MutationOptions {
  coerceTypes?: boolean | "array";
  useDefaults?: boolean | "empty";
  removeAdditional?: boolean | "all" | "failing";
}

export const anyMutation = (o: MutationOptions): boolean =>
  o.coerceTypes !== undefined ||
  o.useDefaults !== undefined ||
  o.removeAdditional !== undefined;

/** Mutable root holder: top-level replacement has no parent to write to. */
export interface RootHolder {
  value: JsonValue;
}

// AJV coerces to the same value at most a bounded number of cascade steps
// (wrap → item-coerce, parent default → child default); the cap only backstops
// a pathological oscillation.
const MAX_PASSES = 20;

const getAt = (root: RootHolder, pointer: string): JsonValue | undefined =>
  getAtPointer(root.value, pointer);

const parentPointer = (segs: readonly string[]): string =>
  joinPointer(segs.slice(0, -1));

const setAt = (root: RootHolder, pointer: string, value: JsonValue): void => {
  const segs = segments(pointer);
  if (segs.length === 0) {
    root.value = value;
    return;
  }
  const parent = getAt(root, parentPointer(segs));
  const key = segs[segs.length - 1]!;
  if (Array.isArray(parent)) parent[Number(key)] = value;
  else if (typeof parent === "object" && parent !== null)
    (parent as Record<string, JsonValue>)[key] = value;
};

const deleteAt = (root: RootHolder, pointer: string): void => {
  const segs = segments(pointer);
  if (segs.length === 0) return;
  const parent = getAt(root, parentPointer(segs));
  const key = segs[segs.length - 1]!;
  if (isPlainObject(parent)) {
    Reflect.deleteProperty(parent, key);
  }
};

const clone = (v: JsonValue): JsonValue =>
  v === null || typeof v !== "object"
    ? v
    : (JSON.parse(JSON.stringify(v)) as JsonValue);

const isPlainObject = (
  v: JsonValue | undefined,
): v is Record<string, JsonValue> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

// ---- coercion table (docs-verified; fixture-pinned) -------------------------

const coerceTo = (
  type: string,
  v: JsonValue,
  arrayMode: boolean,
): { value: JsonValue } | null => {
  switch (type) {
    case "number":
    case "integer": {
      let n: number | null = null;
      if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(+v)) n = +v;
      else if (typeof v === "boolean") n = v ? 1 : 0;
      else if (v === null) n = 0;
      if (n === null) return null;
      if (type === "integer" && !Number.isInteger(n)) return null;
      return { value: n };
    }
    case "string": {
      if (typeof v === "number") return { value: String(v) };
      if (typeof v === "boolean") return { value: v ? "true" : "false" };
      if (v === null) return { value: "" };
      return null;
    }
    case "boolean": {
      if (v === "true" || v === 1) return { value: true };
      if (v === "false" || v === 0) return { value: false };
      return null;
    }
    case "null": {
      if (v === "" || v === 0 || v === false) return { value: null };
      return null;
    }
    case "array": {
      if (!arrayMode || Array.isArray(v)) return null;
      return { value: [v] };
    }
    default:
      return null;
  }
};

const coerceValue = (
  expected: string | string[],
  v: JsonValue,
  arrayMode: boolean,
): { value: JsonValue } | null => {
  const types = Array.isArray(expected) ? expected : [expected];
  // Single-element arrays unwrap first under "array" mode, then the scalar
  // rules apply to the element.
  if (
    arrayMode &&
    Array.isArray(v) &&
    v.length === 1 &&
    !types.includes("array")
  ) {
    const inner = v[0]!;
    for (const t of types) {
      if (typeMatches(t, inner)) return { value: inner };
      const c = coerceTo(t, inner, arrayMode);
      if (c !== null) return c;
    }
    return null;
  }
  for (const t of types) {
    const c = coerceTo(t, v, arrayMode);
    if (c !== null) return c;
  }
  return null;
};

const typeMatches = (t: string, v: JsonValue): boolean => {
  switch (t) {
    case "null":
      return v === null;
    case "array":
      return Array.isArray(v);
    case "object":
      return isPlainObject(v);
    case "integer":
      return typeof v === "number" && Number.isInteger(v);
    default:
      return typeof v === t;
  }
};

// ---- the fixpoint ------------------------------------------------------------

/**
 * Applies the configured mutations until the instance stops changing.
 * `resolveSchema` returns the schema node at a `base#pointer` location
 * (the compat class owns the schema documents).
 */
export function runMutationFixpoint(
  engine: Engine,
  uri: string,
  root: RootHolder,
  options: MutationOptions,
  resolveSchema: (location: string) => JsonValue | undefined,
): void {
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    let changed = false;

    if (
      options.useDefaults !== undefined ||
      options.removeAdditional !== undefined
    ) {
      const doc = engine.evaluate(uri, root.value, {
        output: "hierarchical",
        verbose: true,
      }).outputDocument as OutputUnit;
      const units: OutputUnit[] = [];
      const walk = (u: OutputUnit): void => {
        units.push(u);
        for (const d of u.details ?? []) walk(d);
      };
      walk(doc);

      if (options.useDefaults !== undefined) {
        changed =
          applyDefaults(units, root, options.useDefaults, resolveSchema) ||
          changed;
      }
      if (options.removeAdditional !== undefined) {
        changed =
          applyRemoval(units, root, options.removeAdditional, resolveSchema) ||
          changed;
      }
    }

    if (options.coerceTypes !== undefined && options.coerceTypes !== false) {
      const result = engine.evaluate(uri, root.value, {
        output: "list",
        errorParams: true,
      });
      if (!result.valid) {
        changed =
          applyCoercions(
            result.errors ?? [],
            root,
            options.coerceTypes === "array",
          ) || changed;
      }
    }

    if (!changed) return;
  }
}

const applyDefaults = (
  units: readonly OutputUnit[],
  root: RootHolder,
  mode: boolean | "empty",
  resolveSchema: (location: string) => JsonValue | undefined,
): boolean => {
  let changed = false;
  const mark = (): void => {
    changed = true;
  };
  if (mode === false) return false;
  const fillable = (v: JsonValue | undefined): boolean =>
    v === undefined || (mode === "empty" && (v === null || v === ""));
  for (const unit of units) {
    const node = resolveSchema(unit.schemaLocation!);
    if (!isPlainObject(node)) continue;
    const instance = getAt(root, unit.instanceLocation);
    if (isPlainObject(node.properties) && isPlainObject(instance)) {
      for (const [name, sub] of Object.entries(node.properties)) {
        if (!isPlainObject(sub) || sub.default === undefined) continue;
        if (fillable(instance[name])) {
          instance[name] = clone(sub.default);
          mark();
        }
      }
    }
    // Tuple defaults EXTEND the array in position order (fixture-pinned);
    // a gap without a default stops the fill (no holes).
    const tuple = Array.isArray(node.items)
      ? node.items
      : Array.isArray(node.prefixItems)
        ? node.prefixItems
        : null;
    if (tuple !== null && Array.isArray(instance)) {
      for (let i = 0; i < tuple.length; i++) {
        const sub = tuple[i]!;
        if (i < instance.length) {
          if (
            isPlainObject(sub) &&
            sub.default !== undefined &&
            mode === "empty" &&
            (instance[i] === null || instance[i] === "")
          ) {
            instance[i] = clone(sub.default);
            mark();
          }
          continue;
        }
        if (
          i === instance.length &&
          isPlainObject(sub) &&
          sub.default !== undefined
        ) {
          instance.push(clone(sub.default));
          mark();
        } else {
          break;
        }
      }
    }
  }
  return changed;
};

const applyRemoval = (
  units: readonly OutputUnit[],
  root: RootHolder,
  mode: boolean | "all" | "failing",
  resolveSchema: (location: string) => JsonValue | undefined,
): boolean => {
  let changed = false;
  const mark = (): void => {
    changed = true;
  };
  if (mode === false) return false;
  const lastSegment = (loc: string): string => {
    const ptr = loc.slice(loc.indexOf("#") + 1);
    return unescapeSegment(ptr.slice(ptr.lastIndexOf("/") + 1));
  };

  if (mode === "all") {
    // Keep-set removal at every object where the applied schema object
    // carries property keywords (a bare {type:"object"} removes nothing —
    // fixture-pinned).
    for (const unit of units) {
      const node = resolveSchema(unit.schemaLocation!);
      if (!isPlainObject(node)) continue;
      const instance = getAt(root, unit.instanceLocation);
      if (!isPlainObject(instance)) continue;
      const props = isPlainObject(node.properties) ? node.properties : null;
      const patterns = isPlainObject(node.patternProperties)
        ? Object.keys(node.patternProperties)
        : null;
      if (
        props === null &&
        patterns === null &&
        node.additionalProperties === undefined
      ) {
        continue;
      }
      for (const key of Object.keys(instance)) {
        if (props !== null && key in props) continue;
        if (patterns?.some((p) => new RegExp(p, "u").test(key)) === true)
          continue;
        Reflect.deleteProperty(instance, key);
        mark();
      }
    }
    return changed;
  }

  // true / "failing": driven by the additionalProperties APPLICATION units
  // (each one's instanceLocation IS the offending property). true removes
  // only where the subschema is literally `false`.
  for (const unit of units) {
    if (unit.valid || unit.schemaLocation === undefined) continue;
    if (lastSegment(unit.schemaLocation) !== "additionalProperties") continue;
    if (mode === true && resolveSchema(unit.schemaLocation) !== false) continue;
    if (getAt(root, unit.instanceLocation) === undefined) continue;
    deleteAt(root, unit.instanceLocation);
    mark();
  }
  return changed;
};

const applyCoercions = (
  errors: readonly ErrorUnit[],
  root: RootHolder,
  arrayMode: boolean,
): boolean => {
  let changed = false;
  const done = new Set<string>();
  for (const unit of errors) {
    if (unit.keyword !== "type") continue;
    if (done.has(unit.instanceLocation)) continue;
    const expected = unit.params?.expected as string | string[] | undefined;
    if (expected === undefined) continue;
    const value = getAt(root, unit.instanceLocation);
    if (value === undefined) continue;
    const coerced = coerceValue(expected, value, arrayMode);
    if (coerced === null) continue;
    done.add(unit.instanceLocation);
    setAt(root, unit.instanceLocation, coerced.value);
    changed = true;
  }
  return changed;
};
