// Mutation passes: the coerceTypes / useDefaults / removeAdditional trio
// plus ajv-keywords' transform / dynamicDefaults, all run as a compat-layer
// evaluate→mutate→re-evaluate fixpoint — the engine stays a
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
import type { CompiledListArtifact } from "@jse/compiler";
import { getAtPointer, joinPointer, segments } from "./pointer.js";

export interface MutationOptions {
  coerceTypes?: boolean | "array";
  useDefaults?: boolean | "empty";
  removeAdditional?: boolean | "all" | "failing";
  // ajv-keywords companions (activated via ajvKeywords, not options): both
  // are mutation passes here, never engine keywords — the core stays a pure
  // validator and the compat vocabulary has no before:enum primitive to run
  // them mid-evaluate. See applyTransform / applyDynamicDefaults.
  transform?: boolean;
  dynamicDefaults?: boolean;
}

export const anyMutation = (o: MutationOptions): boolean =>
  o.coerceTypes !== undefined ||
  o.useDefaults !== undefined ||
  o.removeAdditional !== undefined ||
  o.transform === true ||
  o.dynamicDefaults === true;

/**
 * ajv-keywords `dynamicDefaults` generator shape: the outer function takes
 * the schema's `args` and returns a per-fill thunk (matching the real
 * package). Exported so callers can register additional generators (the
 * unknown-name compile check consults this table, so user additions are
 * honored).
 */
export type DynamicDefaultFunc = (
  args?: Record<string, unknown>,
) => () => JsonValue;

// `seq` counters are module-global and keyed by name — the same contract as
// ajv-keywords' own DEFAULTS.seq (one shared counter per name across every
// validator in the process). jse's table is independent of the real
// package's; only its post-increment-from-0 behavior is matched.
const SEQ_COUNTERS = new Map<string, number>();

/** Built-in generators (no `uuid` — deliberately out of scope). */
export const DYNAMIC_DEFAULTS: Record<string, DynamicDefaultFunc> = {
  timestamp: () => () => Date.now(),
  datetime: () => () => new Date().toISOString(),
  date: () => () => new Date().toISOString().slice(0, 10),
  time: () => () => new Date().toISOString().slice(11),
  random: () => () => Math.random(),
  randomint: (args) => {
    const max =
      args !== undefined && typeof args.max === "number" ? args.max : 2;
    return () => Math.floor(Math.random() * max);
  },
  seq: (args) => {
    const name =
      args !== undefined && typeof args.name === "string" ? args.name : "";
    return () => {
      const current = SEQ_COUNTERS.get(name) ?? 0;
      SEQ_COUNTERS.set(name, current + 1);
      return current;
    };
  },
};

/** Mutable root holder: top-level replacement has no parent to write to. */
export interface RootHolder {
  value: JsonValue;
}

// AJV coerces to the same value at most a bounded number of cascade steps
// (wrap → item-coerce, parent default → child default); the cap only backstops
// a pathological oscillation.
const MAX_PASSES = 20;

/**
 * Thrown when the mutation fixpoint is still changing the instance at
 * MAX_PASSES — competing mutations (e.g. branches coercing the same value
 * to different types) that would otherwise stop silently on an arbitrary
 * intermediate state. A compat-layer extension: AJV mutates inline during
 * evaluation and has no fixpoint, so there is no oracle shape to match.
 */
export class MutationNonConvergenceError extends Error {
  constructor(passes: number) {
    super(
      `ajv-compat: mutation fixpoint did not converge after ${String(passes)} ` +
        "passes — the schema's mutations (coerceTypes/useDefaults/" +
        "removeAdditional) keep rewriting each other's results",
    );
    this.name = "MutationNonConvergenceError";
  }
}

/**
 * A prototype chain that adds no behavior: Object.prototype, null, or
 * empty carrier prototypes above one of those — fastify's query objects
 * use a constructor whose prototype is a bare null-proto object, which
 * is data-only and safe to mutate. Anything with own prototype members
 * (class methods, Date, Map, ...) is not plain.
 */
const plainProto = (proto: unknown): boolean => {
  if (proto === null || proto === Object.prototype) return true;
  return (
    Object.getOwnPropertyNames(proto).length === 0 &&
    Object.getOwnPropertySymbols(proto).length === 0 &&
    plainProto(Object.getPrototypeOf(proto))
  );
};

/**
 * True for JSON-shaped data only: null/string/number/boolean, arrays of
 * plain values, and objects whose prototype chain adds no behavior.
 * Class instances, Maps, Dates etc. fail — mutation navigation and
 * cloning assume plain data.
 */
export const isPlainData = (v: JsonValue): boolean => {
  if (v === null || typeof v !== "object") return true;
  if (Array.isArray(v)) return v.every(isPlainData);
  if (!plainProto(Object.getPrototypeOf(v))) return false;
  return Object.values(v).every(isPlainData);
};

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
 * (the compat class owns the schema documents). `getListArtifact` yields
 * the shared compiled list validator; the coercion pass runs on plain data
 * only (the caller routes non-plain instances wholly to the interpreter
 * before reaching here), so the artifact's plain-data contract holds.
 */
export function runMutationFixpoint(
  engine: Engine,
  uri: string,
  root: RootHolder,
  options: MutationOptions,
  resolveSchema: (location: string) => JsonValue | undefined,
  getListArtifact: () => CompiledListArtifact,
): void {
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    let changed = false;

    if (
      options.useDefaults !== undefined ||
      options.removeAdditional !== undefined ||
      options.transform === true
    ) {
      const doc = engine.evaluate(uri, root.value, {
        output: "hierarchical",
        verbose: true,
      }).outputDocument;
      // Two combiner scopes, pinned by ajv-mutation.json (M8.6c cases):
      // - defaults NEVER apply inside anyOf/oneOf branches, passing or not
      //   (AJV ignores them there — its strict mode even refuses them);
      // - removal applies inside a FAILING branch only when no sibling
      //   branch passed (AJV short-circuits past the failing branch once
      //   one passes; with none passing, every branch's removal fired).
      const units: OutputUnit[] = [];
      const inCombiner = new Set<OutputUnit>();
      const muted = new Set<OutputUnit>();
      const walk = (u: OutputUnit, inC: boolean, isMuted: boolean): void => {
        units.push(u);
        if (inC) inCombiner.add(u);
        if (isMuted) muted.add(u);
        const kids = u.details ?? [];
        const edgeOf = (d: OutputUnit): string | undefined =>
          segments(d.evaluationPath.slice(u.evaluationPath.length))[0];
        const anyBranchValid = new Map<string, boolean>();
        for (const d of kids) {
          const e = edgeOf(d);
          if (e === "anyOf" || e === "oneOf") {
            anyBranchValid.set(e, (anyBranchValid.get(e) ?? false) || d.valid);
          }
        }
        for (const d of kids) {
          const e = edgeOf(d);
          const isBranch = e === "anyOf" || e === "oneOf";
          walk(
            d,
            inC || isBranch,
            isMuted || (isBranch && !d.valid && anyBranchValid.get(e) === true),
          );
        }
      };
      walk(doc, false, false);

      const nonCombiner = units.filter((u) => !inCombiner.has(u));
      if (options.useDefaults !== undefined) {
        changed =
          applyDefaults(
            nonCombiner,
            root,
            options.useDefaults,
            resolveSchema,
          ) || changed;
        // dynamicDefaults fills AFTER plain defaults so a colliding `default`
        // wins the property (fixture: default-collision-default-wins), and
        // only when useDefaults is enabled (its real gate). The combiner
        // exclusion is EXACT here: AJV's own compositeRule guard skips
        // dynamicDefaults inside anyOf/oneOf branches too.
        if (options.dynamicDefaults === true && options.useDefaults !== false) {
          changed =
            applyDynamicDefaults(
              nonCombiner,
              root,
              resolveSchema,
              options.useDefaults === "empty",
            ) || changed;
        }
      }
      // transform reuses defaults' non-combiner unit set. Inside a combiner
      // branch it does NOT fire — a documented divergence: AJV's
      // transform-in-combiner semantics depend on inline short-circuit order
      // and cross-branch mutation interleaving, which this evaluate→mutate→
      // re-evaluate fixpoint over one un-mutated hierarchy cannot reproduce.
      if (options.transform === true) {
        changed = applyTransform(nonCombiner, root, resolveSchema) || changed;
      }
      if (options.removeAdditional !== undefined) {
        changed =
          applyRemoval(
            units.filter((u) => !muted.has(u)),
            root,
            options.removeAdditional,
            resolveSchema,
          ) || changed;
      }
    }

    if (options.coerceTypes !== undefined && options.coerceTypes !== false) {
      // Compiled list tier: `errors` is always present (empty on valid).
      const { valid, errors } = getListArtifact().evaluateList(root.value);
      if (!valid) {
        changed =
          applyCoercions(errors, root, options.coerceTypes === "array") ||
          changed;
      }
    }

    if (!changed) return;
  }
  throw new MutationNonConvergenceError(MAX_PASSES);
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
    const node = resolveSchema(unit.schemaLocation);
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

// ---- transform ----------------------------------------------------------

// String ops that touch only whitespace or case; all idempotent when
// re-applied, which keeps the fixpoint converging. trimLeft/trimRight are
// the historical aliases for trimStart/trimEnd.
const TRANSFORM_OPS: Record<string, (s: string) => string> = {
  trim: (s) => s.trim(),
  trimStart: (s) => s.trimStart(),
  trimEnd: (s) => s.trimEnd(),
  trimLeft: (s) => s.trimStart(),
  trimRight: (s) => s.trimEnd(),
  toLowerCase: (s) => s.toLowerCase(),
  toUpperCase: (s) => s.toUpperCase(),
};

// toEnumCase canonicalizes to the sibling enum member matching case-
// insensitively; a value matching none is left untouched. The colliding /
// missing-enum error cases are caught at compile time, so a well-formed
// schema always has a unique lowercased→member mapping here.
const toEnumCase = (
  value: string,
  enumValues: JsonValue | undefined,
): string => {
  if (!Array.isArray(enumValues)) return value;
  const lower = value.toLowerCase();
  for (const member of enumValues) {
    if (typeof member === "string" && member.toLowerCase() === lower) {
      return member;
    }
  }
  return value;
};

const applyTransform = (
  units: readonly OutputUnit[],
  root: RootHolder,
  resolveSchema: (location: string) => JsonValue | undefined,
): boolean => {
  let changed = false;
  for (const unit of units) {
    // Root guard (AJV's `parentData !== undefined`): a top-level value has
    // no holder to write back through, so transform never touches it.
    if (unit.instanceLocation === "") continue;
    const node = resolveSchema(unit.schemaLocation);
    if (!isPlainObject(node) || !Array.isArray(node.transform)) continue;
    const current = getAt(root, unit.instanceLocation);
    if (typeof current !== "string") continue;
    let next = current;
    for (const op of node.transform) {
      if (op === "toEnumCase") next = toEnumCase(next, node.enum);
      else if (typeof op === "string" && Object.hasOwn(TRANSFORM_OPS, op)) {
        next = TRANSFORM_OPS[op]!(next);
      }
    }
    if (next !== current) {
      setAt(root, unit.instanceLocation, next);
      changed = true;
    }
  }
  return changed;
};

// ---- dynamicDefaults ------------------------------------------------------

const resolveGenerator = (spec: JsonValue): (() => JsonValue) | null => {
  const name = typeof spec === "string" ? spec : undefined;
  const objName =
    name === undefined && isPlainObject(spec) && typeof spec.func === "string"
      ? spec.func
      : name;
  if (objName === undefined || !Object.hasOwn(DYNAMIC_DEFAULTS, objName)) {
    return null;
  }
  const factory = DYNAMIC_DEFAULTS[objName]!;
  const args =
    isPlainObject(spec) && isPlainObject(spec.args) ? spec.args : undefined;
  return factory(args);
};

const applyDynamicDefaults = (
  units: readonly OutputUnit[],
  root: RootHolder,
  resolveSchema: (location: string) => JsonValue | undefined,
  empty: boolean,
): boolean => {
  let changed = false;
  // Same fillable gate as applyDefaults: absent, plus null/"" under "empty"
  // mode. Checked FRESH against the live instance so a plain `default`
  // filled earlier this pass suppresses the generator.
  const fillable = (v: JsonValue | undefined): boolean =>
    v === undefined || (empty && (v === null || v === ""));
  for (const unit of units) {
    const node = resolveSchema(unit.schemaLocation);
    if (!isPlainObject(node) || !isPlainObject(node.dynamicDefaults)) continue;
    const instance = getAt(root, unit.instanceLocation);
    if (!isPlainObject(instance)) continue;
    for (const [prop, spec] of Object.entries(node.dynamicDefaults)) {
      if (!fillable(instance[prop])) continue;
      const generator = resolveGenerator(spec);
      if (generator === null) continue;
      instance[prop] = generator();
      changed = true;
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
      const node = resolveSchema(unit.schemaLocation);
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
    if (unit.valid) continue;
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
    if (done.has(unit.inputLocation)) continue;
    const expected = unit.params?.expected as string | string[] | undefined;
    if (expected === undefined) continue;
    const value = getAt(root, unit.inputLocation);
    if (value === undefined) continue;
    const coerced = coerceValue(expected, value, arrayMode);
    if (coerced === null) continue;
    done.add(unit.inputLocation);
    setAt(root, unit.inputLocation, coerced.value);
    changed = true;
  }
  return changed;
};
