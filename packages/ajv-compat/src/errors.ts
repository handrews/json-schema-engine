// Error adapter (M8.2, D13): engine list-output units with structured
// params → AJV v8 error objects. Every shape here is pinned by
// test/fixtures/ajv-oracle.json (AJV executed as an oracle, never read —
// D15); messages come from our own template table reproducing AJV's
// defaults, since downstream tests assert on message text.

import type { ErrorUnit, JsonValue, TraceUnit } from "@jse/core";

/** AJV v8's error object shape (public surface). */
export interface AjvErrorObject {
  keyword: string;
  instancePath: string;
  schemaPath: string;
  params: Record<string, unknown>;
  /** set on errors raised while validating a property NAME (propertyNames) */
  propertyName?: string;
  message?: string;
  // verbose mode
  schema?: unknown;
  parentSchema?: unknown;
  data?: unknown;
  /** ajv-errors (M8.4): set when kept alongside a replacing errorMessage error */
  emUsed?: boolean;
}

export interface MapOptions {
  /** the compiled root resource's base URI (same-resource → "#/..." paths) */
  rootBaseUri: string;
  /** schema node at a `base#pointer` location; undefined when unresolvable */
  resolveSchema(location: string): JsonValue | undefined;
  allErrors: boolean;
  verbose: boolean;
  messages: boolean;
  /**
   * Evaluation trace for the SAME evaluation the units came from (the
   * caller escalates to the interpreter when {@link needsTrace} says the
   * mapping needs application context).
   */
  trace?: TraceUnit;
}

/**
 * Keywords whose failures need application context to map faithfully:
 * passing-subtree filtering (not/contains/if, anyOf/oneOf), synthesized
 * companions (propertyNames, then/else → if). The scan is deliberately
 * conservative — a property literally named one of these also matches,
 * which costs an interpreter re-run, never correctness.
 */
const TRACE_TRIGGERS = new Set([
  "anyOf",
  "oneOf",
  "not",
  "contains",
  "if",
  "then",
  "else",
  "propertyNames",
]);

/** True when mapping `units` needs the evaluation trace for context. */
export const needsTrace = (units: readonly ErrorUnit[]): boolean =>
  units.some((u) =>
    segments(u.evaluationPath!).some((s) => TRACE_TRIGGERS.has(s)),
  );

const last = (pointer: string): string =>
  decodeSegment(pointer.slice(pointer.lastIndexOf("/") + 1));
const parent = (pointer: string): string =>
  pointer.slice(0, pointer.lastIndexOf("/"));
const decodeSegment = (s: string): string =>
  s.replace(/~1/g, "/").replace(/~0/g, "~");

/**
 * Keywords that take subschemas at NAMED positions: a path segment right
 * after one of these is a name, never a keyword (disambiguates a property
 * literally called "anyOf" from the applicator).
 */
const NAME_POSITION = new Set([
  "properties",
  "patternProperties",
  "dependentSchemas",
  "dependencies",
  "$defs",
  "definitions",
]);

/** Path segments of an evaluationPath/schema pointer (decoded). */
const segments = (path: string): string[] =>
  path === "" ? [] : path.slice(1).split("/").map(decodeSegment);

/**
 * Positions in `segs` that are KEYWORD occurrences of `keyword` (not names
 * under properties/$defs/…). For anyOf/oneOf a branch index must follow —
 * their subschemas only live at integer positions.
 */
const keywordPositions = (segs: string[], keyword: string): number[] => {
  const out: number[] = [];
  for (let i = 0; i < segs.length; i++) {
    if (segs[i] !== keyword) continue;
    if (i > 0 && NAME_POSITION.has(segs[i - 1]!)) continue;
    if (
      (keyword === "anyOf" || keyword === "oneOf") &&
      !/^\d+$/.test(segs[i + 1] ?? "")
    ) {
      continue;
    }
    out.push(i);
  }
  return out;
};

const joinPath = (segs: readonly string[]): string =>
  segs.length === 0
    ? ""
    : "/" +
      segs.map((s) => s.replace(/~/g, "~0").replace(/\//g, "~1")).join("/");

/** `base#pointer` → AJV schemaPath ("#/..." same-resource, no "#" cross). */
const renderSchemaPath = (location: string, rootBaseUri: string): string => {
  const hash = location.indexOf("#");
  const base = location.slice(0, hash);
  const pointer = location.slice(hash + 1);
  return base === rootBaseUri ? "#" + pointer : base + pointer;
};

type Params = Record<string, unknown>;

/**
 * AJV's default message per keyword, rendered from the mapped params;
 * undefined for untemplated (custom) keywords, whose units carry the
 * user-supplied message through unchanged.
 */
const message = (keyword: string, params: Params): string | undefined => {
  const p = params;
  switch (keyword) {
    case "type": {
      const t = p.type as string | string[];
      return `must be ${Array.isArray(t) ? t.join(",") : t}`;
    }
    case "enum":
      return "must be equal to one of the allowed values";
    case "const":
      return "must be equal to constant";
    case "required":
      return `must have required property '${String(p.missingProperty)}'`;
    case "additionalProperties":
      return "must NOT have additional properties";
    case "unevaluatedProperties":
      return "must NOT have unevaluated properties";
    case "minLength":
      return `must NOT have fewer than ${String(p.limit)} characters`;
    case "maxLength":
      return `must NOT have more than ${String(p.limit)} characters`;
    case "minItems":
      return `must NOT have fewer than ${String(p.limit)} items`;
    case "maxItems":
    case "unevaluatedItems":
    case "additionalItems":
    case "items":
      return `must NOT have more than ${String(p.limit)} items`;
    case "minProperties":
      return `must NOT have fewer than ${String(p.limit)} properties`;
    case "maxProperties":
      return `must NOT have more than ${String(p.limit)} properties`;
    case "minimum":
    case "maximum":
    case "exclusiveMinimum":
    case "exclusiveMaximum":
      return `must be ${String(p.comparison)} ${String(p.limit)}`;
    case "multipleOf":
      return `must be multiple of ${String(p.multipleOf)}`;
    case "pattern":
      return `must match pattern "${String(p.pattern)}"`;
    case "uniqueItems":
      return `must NOT have duplicate items (items ## ${String(p.j)} and ${String(p.i)} are identical)`;
    case "contains": {
      const min = p.minContains as number;
      const max = p.maxContains as number | undefined;
      return max === undefined
        ? `must contain at least ${String(min)} valid item(s)`
        : `must contain at least ${String(min)} and no more than ${String(max)} valid item(s)`;
    }
    case "oneOf":
      return "must match exactly one schema in oneOf";
    case "anyOf":
      return "must match a schema in anyOf";
    case "not":
      return "must NOT be valid";
    case "if":
      return `must match "${String(p.failingKeyword)}" schema`;
    case "propertyNames":
      return "property name must be valid";
    case "dependentRequired":
    case "dependencies": {
      const plural = (p.depsCount as number) > 1 ? "properties" : "property";
      return `must have ${plural} ${String(p.deps)} when property ${String(p.property)} is present`;
    }
    case "format":
      return `must match format "${String(p.format)}"`;
    case "false schema":
      return "boolean schema is false";
    case "discriminator":
      return p.error === "tag"
        ? `tag "${String(p.tag)}" must be string`
        : `value of tag "${String(p.tag)}" must be in oneOf`;
    default:
      return undefined;
  }
};

const COMPARISON: Record<string, string> = {
  minimum: ">=",
  maximum: "<=",
  exclusiveMinimum: ">",
  exclusiveMaximum: "<",
};

/**
 * AJV reports nothing from subtrees that PASSED (a satisfied anyOf's
 * failing branches, a passing `not`'s inner matches, contains probes, the
 * `if` condition), while the engine's list output keeps every record
 * (errors are never rolled back). Drop what AJV would not show:
 * - under not/contains/if: always (their inner failures are not failures
 *   of the instance);
 * - under an anyOf/oneOf branch: only when that combiner emitted no error
 *   of its own (it passed).
 */
const survivesFiltering = (
  unit: ErrorUnit,
  combinerFailed: (prefixPath: string, instanceLocation: string) => boolean,
): boolean => {
  const segs = segments(unit.evaluationPath!);
  for (const kw of ["not", "contains", "if"]) {
    for (const i of keywordPositions(segs, kw)) {
      if (i < segs.length - 1) return false; // strictly inside the subtree
    }
  }
  for (const kw of ["anyOf", "oneOf"]) {
    for (const i of keywordPositions(segs, kw)) {
      if (i >= segs.length - 1) continue; // the combiner's own error
      const prefix = joinPath(segs.slice(0, i + 1));
      if (!combinerFailed(prefix, unit.instanceLocation)) return false;
    }
  }
  return true;
};

/** Maps engine list-output units (errorParams on) to AJV error objects. */
export function mapErrors(
  units: readonly ErrorUnit[],
  instance: JsonValue,
  options: MapOptions,
): AjvErrorObject[] {
  // Combiner-failure index for the passing-subtree filter.
  const combinerErrors = new Set<string>();
  for (const u of units) {
    if (u.keyword === "anyOf" || u.keyword === "oneOf") {
      combinerErrors.add(`${u.evaluationPath!} ${u.instanceLocation}`);
    }
  }
  const combinerFailed = (prefix: string, ip: string): boolean => {
    for (const key of combinerErrors) {
      const [path, cip] = key.split(" ") as [string, string];
      if (path === prefix && ip.startsWith(cip)) return true;
    }
    return false;
  };

  const out: AjvErrorObject[] = [];
  // items/additionalItems/unevaluatedItems false-schema units coalesce to
  // one {limit} error per (schema position, array) — AJV's shape.
  const coalesced = new Set<string>();

  for (const unit of units) {
    // Discriminator's routed-oneOf marker (M8.4, discriminator.ts): seeds
    // combinerErrors above like any oneOf failure, but AJV never shows it —
    // the routed branch's own errors are the whole output.
    if (unit.params?.discriminatorRouted === true) continue;
    if (!survivesFiltering(unit, combinerFailed)) continue;
    const mapped = mapUnit(unit, units, coalesced, options);
    for (const e of mapped) {
      if (options.messages)
        e.message = message(e.keyword, e.params) ?? unit.error;
      if (options.verbose) {
        const value = options.resolveSchema(unit.schemaLocation!);
        const parentLoc = unit.schemaLocation!.slice(
          0,
          unit.schemaLocation!.lastIndexOf("/"),
        );
        e.schema = value;
        e.parentSchema = options.resolveSchema(parentLoc);
        e.data = resolveInstance(instance, e.instancePath);
      }
      out.push(e);
    }
    // AJV's "return after the first error" keeps synthesized companions
    // (propertyNames' container, if's failingKeyword) — a mapUnit group is
    // atomic under truncation.
    if (!options.allErrors && out.length > 0) return out;
  }
  return out;
}

const resolveInstance = (instance: JsonValue, pointer: string): JsonValue => {
  let node: JsonValue = instance;
  for (const seg of segments(pointer)) {
    if (Array.isArray(node)) node = node[Number(seg)] as JsonValue;
    else if (typeof node === "object" && node !== null)
      node = (node as Record<string, JsonValue>)[seg] as JsonValue;
  }
  return node;
};

/** One engine unit → zero or more AJV errors (synthesis may append). */
function mapUnit(
  unit: ErrorUnit,
  all: readonly ErrorUnit[],
  coalesced: Set<string>,
  options: MapOptions,
): AjvErrorObject[] {
  const sp = (loc: string): string =>
    renderSchemaPath(loc, options.rootBaseUri);
  const evalSegs = segments(unit.evaluationPath!);

  // Boolean-false schema units (no keyword): the schema POSITION decides
  // which AJV error shape applies.
  if (unit.keyword === undefined) {
    const tail = evalSegs[evalSegs.length - 1];
    if (tail === "additionalProperties" || tail === "unevaluatedProperties") {
      const param =
        tail === "additionalProperties"
          ? "additionalProperty"
          : "unevaluatedProperty";
      return [
        {
          keyword: tail,
          instancePath: parent(unit.instanceLocation),
          schemaPath: sp(unit.schemaLocation!),
          params: { [param]: last(unit.instanceLocation) },
        },
      ];
    }
    if (
      tail === "items" ||
      tail === "additionalItems" ||
      tail === "unevaluatedItems"
    ) {
      const arrayPath = parent(unit.instanceLocation);
      const key = `${unit.evaluationPath!} ${arrayPath}`;
      if (coalesced.has(key)) return [];
      coalesced.add(key);
      let limit = Number(last(unit.instanceLocation));
      for (const other of all) {
        if (
          other.keyword === undefined &&
          other.evaluationPath === unit.evaluationPath &&
          parent(other.instanceLocation) === arrayPath
        ) {
          limit = Math.min(limit, Number(last(other.instanceLocation)));
        }
      }
      return [
        {
          keyword: tail,
          instancePath: arrayPath,
          schemaPath: sp(unit.schemaLocation!),
          params: { limit },
        },
      ];
    }
    return [
      {
        keyword: "false schema",
        instancePath: unit.instanceLocation,
        schemaPath: sp(unit.schemaLocation!) + "/false schema",
        params: {},
      },
    ];
  }

  const params = (unit.params ?? {}) as Record<string, JsonValue>;
  const base: AjvErrorObject = {
    keyword: unit.keyword,
    instancePath: unit.instanceLocation,
    schemaPath: sp(unit.schemaLocation!),
    params: {},
  };

  switch (unit.keyword) {
    case "type":
      base.params = { type: params.expected };
      break;
    case "enum":
      base.params = { allowedValues: params.allowedValues };
      break;
    case "const":
      base.params = { allowedValue: params.allowedValue };
      break;
    case "minLength":
    case "maxLength":
    case "minItems":
    case "maxItems":
    case "minProperties":
    case "maxProperties":
      base.params = { limit: params.limit };
      break;
    case "minimum":
    case "maximum":
    case "exclusiveMinimum":
    case "exclusiveMaximum":
      base.params = {
        comparison: COMPARISON[unit.keyword],
        limit: params.limit,
      };
      break;
    case "multipleOf":
      base.params = { multipleOf: params.multipleOf };
      break;
    case "pattern":
      base.params = { pattern: params.pattern };
      break;
    case "required":
      base.params = { missingProperty: params.missingProperty };
      break;
    case "uniqueItems": {
      const [j, i] = params.duplicates as [number, number];
      base.params = { i, j };
      break;
    }
    case "contains": {
      base.params =
        params.maxContains === undefined
          ? { minContains: params.minContains }
          : {
              minContains: params.minContains,
              maxContains: params.maxContains,
            };
      break;
    }
    case "oneOf": {
      const passing = params.passing as number[];
      base.params = {
        passingSchemas: passing.length === 0 ? null : passing.slice(0, 2),
      };
      break;
    }
    case "anyOf":
    case "not":
      base.params = {};
      break;
    case "format":
      base.params = { format: params.format };
      break;
    case "dependentRequired":
    case "dependencies": {
      // depsCount/deps derive from the keyword's own schema value — the
      // adapter owns the schema, so no engine-side duplication (D13).
      const kwLoc = unit.schemaLocation!.slice(
        0,
        unit.schemaLocation!.lastIndexOf("/"),
      );
      const map = options.resolveSchema(`${kwLoc}/${unit.keyword}`) as
        Record<string, JsonValue> | undefined;
      const deps = (map?.[params.property as string] ?? []) as string[];
      base.params = {
        property: params.property,
        missingProperty: params.missingProperty,
        depsCount: deps.length,
        deps: deps.join(", "),
      };
      break;
    }
    default:
      base.params = { ...params };
      break;
  }

  // propertyNames: AJV reports the inner failure at the OBJECT's data path
  // and appends a container error naming the offending property.
  const pnPositions = keywordPositions(evalSegs, "propertyNames");
  if (pnPositions.length > 0 && pnPositions[0]! < evalSegs.length - 1) {
    const name = last(unit.instanceLocation);
    base.instancePath = parent(unit.instanceLocation);
    base.propertyName = name;
    const spSegs = segments(
      unit.schemaLocation!.slice(unit.schemaLocation!.indexOf("#") + 1),
    );
    const pnIdx = keywordPositions(spSegs, "propertyNames")[0]!;
    const pnLocation =
      unit.schemaLocation!.slice(0, unit.schemaLocation!.indexOf("#") + 1) +
      joinPath(spSegs.slice(0, pnIdx + 1));
    return [
      base,
      {
        keyword: "propertyNames",
        instancePath: base.instancePath,
        schemaPath: sp(pnLocation),
        params: { propertyName: name },
      },
    ];
  }

  // then/else branch failures: AJV appends a synthesized `if` error.
  for (const branch of ["then", "else"] as const) {
    const positions = keywordPositions(evalSegs, branch);
    const idx = positions.find((i) => {
      const prefixLoc = unitSchemaPrefix(unit, i);
      return (
        prefixLoc !== undefined &&
        options.resolveSchema(parentPointerLocation(prefixLoc) + "/if") !==
          undefined
      );
    });
    if (idx !== undefined && idx < evalSegs.length - 1) {
      const prefixLoc = unitSchemaPrefix(unit, idx)!;
      const ifLocation = parentPointerLocation(prefixLoc) + "/if";
      const ipSegs = segments(unit.instanceLocation);
      const keep = Math.max(0, ipSegs.length - instanceDescents(evalSegs, idx));
      return [
        base,
        {
          keyword: "if",
          instancePath: joinPath(ipSegs.slice(0, keep)),
          schemaPath: sp(ifLocation),
          params: { failingKeyword: branch },
        },
      ];
    }
  }

  return [base];
}

/**
 * schemaLocation prefix covering the first `i + 1` evaluation-path
 * segments — valid only while the evaluation path and the schema pointer
 * tail coincide (no $ref crossing below the branch keyword), which holds
 * for the then/else shapes this feeds; returns undefined otherwise.
 */
const unitSchemaPrefix = (unit: ErrorUnit, i: number): string | undefined => {
  const evalSegs = segments(unit.evaluationPath!);
  const hash = unit.schemaLocation!.indexOf("#");
  const ptrSegs = segments(unit.schemaLocation!.slice(hash + 1));
  const tailLen = evalSegs.length - (i + 1);
  if (tailLen > ptrSegs.length) return undefined;
  const prefixPtr = ptrSegs.slice(0, ptrSegs.length - tailLen);
  if (prefixPtr[prefixPtr.length - 1] !== evalSegs[i]) return undefined;
  return unit.schemaLocation!.slice(0, hash + 1) + joinPath(prefixPtr);
};

const parentPointerLocation = (location: string): string => {
  const hash = location.indexOf("#");
  const ptr = location.slice(hash + 1);
  return location.slice(0, hash + 1) + parent(ptr);
};

/**
 * Instance descents made by evaluation-path segments below `branchIdx`:
 * a name after properties/patternProperties consumes one data segment
 * (the synthesized if-error sits at the cursor where `if` itself ran).
 */
const instanceDescents = (evalSegs: string[], branchIdx: number): number => {
  let n = 0;
  for (let i = branchIdx + 2; i < evalSegs.length; i++) {
    const prev = evalSegs[i - 1]!;
    if (prev === "properties" || prev === "patternProperties") n++;
  }
  return n;
};
