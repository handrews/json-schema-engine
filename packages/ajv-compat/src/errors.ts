// Error adapter (M8.2, D13): engine list-output units with structured
// params → AJV v8 error objects. Every shape here is pinned by
// test/fixtures/ajv-oracle.json (AJV executed as an oracle, never read —
// D15); messages come from our own template table reproducing AJV's
// defaults, since downstream tests assert on message text.

import { unescapeSegment } from "@json-schema-engine/core";
import type { ErrorUnit, JsonValue, TraceUnit } from "@json-schema-engine/core";
import { getAtPointer, segments } from "./pointer.js";

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
  units.some((u) => {
    const segs = segments(u.evaluationPath);
    if (segs.some((s) => TRACE_TRIGGERS.has(s))) return true;
    // Boolean-false units need the tail position classified; when the
    // root-anchored walk can't (unknown keyword in the path), only the
    // trace can decide. An empty path is the root schema itself — trivial.
    return (
      u.keyword === undefined &&
      segs.length > 0 &&
      classifyTail(segs) === undefined
    );
  });

const last = (pointer: string): string =>
  unescapeSegment(pointer.slice(pointer.lastIndexOf("/") + 1));
const parent = (pointer: string): string =>
  pointer.slice(0, pointer.lastIndexOf("/"));

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

/** Keywords whose subschemas live only at integer positions. */
const INDEX_POSITION = new Set(["allOf", "anyOf", "oneOf", "prefixItems"]);

/**
 * Keywords that apply their own value as a subschema. items/additionalItems
 * appear here for their single-schema application; their legacy tuple form
 * is recognized by the integer that follows (keywords are never integers,
 * so the lookahead is unambiguous).
 */
const SELF_POSITION = new Set([
  "additionalProperties",
  "unevaluatedProperties",
  "unevaluatedItems",
  "propertyNames",
  "not",
  "contains",
  "if",
  "then",
  "else",
  "items",
  "additionalItems",
  "contentSchema",
  "$ref",
  "$dynamicRef",
  "$recursiveRef",
]);

/**
 * Root-anchored classification of an evaluation path's final position: the
 * keyword that applied the final subschema, and whether the final segment
 * is that keyword itself (vs a name or index beneath it). Left-to-right
 * from the root there is no ambiguity — a name can only follow a
 * NAME_POSITION keyword — where tail-anchored sniffing misreads shapes
 * like /properties/properties/anyOf. Returns undefined when an unknown
 * keyword makes the walk lose its place (callers escalate to the trace).
 */
const classifyTail = (
  segs: readonly string[],
): { keyword: string; tailIsKeyword: boolean } | undefined => {
  let result: { keyword: string; tailIsKeyword: boolean } | undefined;
  let i = 0;
  while (i < segs.length) {
    const kw = segs[i]!;
    let consumed = 1;
    if (NAME_POSITION.has(kw)) {
      if (i + 1 < segs.length) consumed = 2;
    } else if (INDEX_POSITION.has(kw)) {
      if (i + 1 < segs.length && /^\d+$/.test(segs[i + 1]!)) consumed = 2;
    } else if (SELF_POSITION.has(kw)) {
      if (
        (kw === "items" || kw === "additionalItems") &&
        i + 1 < segs.length &&
        /^\d+$/.test(segs[i + 1]!)
      ) {
        consumed = 2;
      }
    } else {
      return undefined;
    }
    i += consumed;
    result = { keyword: kw, tailIsKeyword: consumed === 1 };
  }
  return result;
};

/** Per-evaluation join of error units to their trace applications. */
interface TraceIndex {
  /** unit index → the application that raised it */
  nodeOf: (TraceUnit | undefined)[];
  parentOf: Map<TraceUnit, TraceUnit | undefined>;
}

const buildTraceIndex = (root: TraceUnit, unitCount: number): TraceIndex => {
  const nodeOf = new Array<TraceUnit | undefined>(unitCount);
  const parentOf = new Map<TraceUnit, TraceUnit | undefined>();
  const visit = (node: TraceUnit, parent: TraceUnit | undefined): void => {
    parentOf.set(node, parent);
    for (const i of node.errorIndexes) nodeOf[i] = node;
    for (const child of node.children) visit(child, node);
  };
  visit(root, undefined);
  return { nodeOf, parentOf };
};

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
 * (errors are never rolled back). Drop what AJV would not show, walking
 * the error's application ancestry:
 * - under not/if: always (their inner failures are not failures of the
 *   instance);
 * - under contains: except a boolean-false failure AT the probe itself —
 *   AJV reports those ("#/contains/false schema"), pinned by the suite
 *   differential (contains.json boolean-schema groups);
 * - under an anyOf/oneOf branch: only when that combiner passed. "Failed"
 *   is either the combiner's own error at the parent application, or zero
 *   valid sibling branches — which relies on the interpreter applying
 *   EVERY branch (applicator.ts anyOf/oneOf never short-circuit; a routed
 *   discriminator applies exactly one). If a combiner ever gains
 *   short-circuiting, this disjunct must be rethought.
 */
const makeSurvives = (
  units: readonly ErrorUnit[],
  { nodeOf, parentOf }: TraceIndex,
): ((index: number) => boolean) => {
  return (index) => {
    const keywordless = units[index]!.keyword === undefined;
    let atErrorNode = true;
    for (let node = nodeOf[index]; node; node = parentOf.get(node)) {
      const parent = parentOf.get(node);
      if (!parent) break;
      const edge = node.segments[0];
      if (edge === "not" || edge === "if") return false;
      if (edge === "contains" && !(atErrorNode && keywordless)) return false;
      if (edge === "anyOf" || edge === "oneOf") {
        const failed =
          parent.errorIndexes.some((j) => units[j]!.keyword === edge) ||
          parent.children.every((c) => c.segments[0] !== edge || !c.valid);
        if (!failed) return false;
      }
      atErrorNode = false;
    }
    return true;
  };
};

/**
 * Maps engine list-output units (errorParams on) to AJV error objects.
 * `options.trace` is required whenever {@link needsTrace} holds for the
 * units — the fast path only ever sees units whose mapping is
 * position-trivial without application context.
 */
export function mapErrors(
  units: readonly ErrorUnit[],
  instance: JsonValue,
  options: MapOptions,
): AjvErrorObject[] {
  if (options.trace === undefined && needsTrace(units)) {
    throw new Error(
      "ajv-compat internal: mapErrors needs the evaluation trace for these " +
        "units but none was supplied — the caller must escalate per needsTrace",
    );
  }
  const traceIndex =
    options.trace === undefined
      ? undefined
      : buildTraceIndex(options.trace, units.length);
  const survives =
    traceIndex === undefined ? undefined : makeSurvives(units, traceIndex);

  const out: AjvErrorObject[] = [];
  // items/additionalItems/unevaluatedItems false-schema units coalesce to
  // one {limit} error per (schema position, array) — AJV's shape.
  const coalesced = new Set<string>();

  for (let index = 0; index < units.length; index++) {
    const unit = units[index]!;
    if (survives !== undefined && !survives(index)) continue;
    const mapped = mapUnit(unit, index, units, coalesced, options, traceIndex);
    for (const e of mapped) {
      if (options.messages)
        e.message = message(e.keyword, e.params) ?? unit.error;
      if (options.verbose) {
        const value = options.resolveSchema(unit.schemaLocation);
        const parentLoc = unit.schemaLocation.slice(
          0,
          unit.schemaLocation.lastIndexOf("/"),
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

const resolveInstance = (instance: JsonValue, pointer: string): JsonValue =>
  getAtPointer(instance, pointer) as JsonValue;

/** One engine unit → zero or more AJV errors (synthesis may append). */
function mapUnit(
  unit: ErrorUnit,
  index: number,
  all: readonly ErrorUnit[],
  coalesced: Set<string>,
  options: MapOptions,
  traceIndex: TraceIndex | undefined,
): AjvErrorObject[] {
  const sp = (loc: string): string =>
    renderSchemaPath(loc, options.rootBaseUri);
  const evalSegs = segments(unit.evaluationPath);
  const node = traceIndex?.nodeOf[index];

  // Boolean-false schema units (no keyword): the schema POSITION decides
  // which AJV error shape applies — specifically the applying edge, and
  // only when the failing position is the keyword's own value (a property
  // literally named "items" descends via properties instead).
  if (unit.keyword === undefined) {
    let edge: string | undefined;
    if (traceIndex !== undefined) {
      edge = node?.segments.length === 1 ? node.segments[0] : undefined;
    } else if (evalSegs.length > 0) {
      // needsTrace guarantees the classifier cannot lose its place here.
      const c = classifyTail(evalSegs)!;
      edge = c.tailIsKeyword ? c.keyword : undefined;
    }
    if (edge === "additionalProperties" || edge === "unevaluatedProperties") {
      const param =
        edge === "additionalProperties"
          ? "additionalProperty"
          : "unevaluatedProperty";
      return [
        {
          keyword: edge,
          instancePath: parent(unit.inputLocation),
          schemaPath: sp(unit.schemaLocation),
          params: { [param]: last(unit.inputLocation) },
        },
      ];
    }
    if (
      edge === "items" ||
      edge === "additionalItems" ||
      edge === "unevaluatedItems"
    ) {
      const arrayPath = parent(unit.inputLocation);
      const key = `${unit.evaluationPath}\u0000${arrayPath}`;
      if (coalesced.has(key)) return [];
      coalesced.add(key);
      let limit = Number(last(unit.inputLocation));
      for (const other of all) {
        if (
          other.keyword === undefined &&
          other.evaluationPath === unit.evaluationPath &&
          parent(other.inputLocation) === arrayPath
        ) {
          limit = Math.min(limit, Number(last(other.inputLocation)));
        }
      }
      return [
        {
          keyword: edge,
          instancePath: arrayPath,
          schemaPath: sp(unit.schemaLocation),
          params: { limit },
        },
      ];
    }
    return [
      {
        keyword: "false schema",
        instancePath: unit.inputLocation,
        schemaPath: sp(unit.schemaLocation) + "/false schema",
        params: {},
      },
    ];
  }

  const params = (unit.params ?? {}) as Record<string, JsonValue>;
  const base: AjvErrorObject = {
    keyword: unit.keyword,
    instancePath: unit.inputLocation,
    schemaPath: sp(unit.schemaLocation),
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
      const kwLoc = unit.schemaLocation.slice(
        0,
        unit.schemaLocation.lastIndexOf("/"),
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

  // Both syntheses need application context; their trigger keywords
  // guarantee the trace is present whenever they can apply.
  if (traceIndex !== undefined) {
    // propertyNames: AJV reports the inner failure at the OBJECT's data
    // path and appends a container error naming the offending property.
    for (let n = node; n !== undefined; n = traceIndex.parentOf.get(n)) {
      if (n.segments[0] !== "propertyNames") continue;
      const name = last(unit.inputLocation);
      const container = traceIndex.parentOf.get(n)!;
      base.instancePath = container.inputLocation;
      base.propertyName = name;
      return [
        base,
        {
          keyword: "propertyNames",
          instancePath: base.instancePath,
          schemaPath: sp(n.schemaLocation),
          params: { propertyName: name },
        },
      ];
    }

    // then/else branch failures: AJV appends a synthesized `if` error at
    // the application where `if` itself ran — the branch edge's parent,
    // which is exact across $ref crossings and every descent shape. The
    // OUTERMOST branch edge wins, matching the pinned single-companion
    // shape for nested conditionals.
    const chain: TraceUnit[] = [];
    for (let n = node; n !== undefined; n = traceIndex.parentOf.get(n)) {
      chain.push(n);
    }
    chain.reverse();
    for (const c of chain) {
      const edge = c.segments[0];
      if (edge !== "then" && edge !== "else") continue;
      const container = traceIndex.parentOf.get(c)!;
      const ifLocation = container.schemaLocation + "/if";
      if (options.resolveSchema(ifLocation) === undefined) continue;
      return [
        base,
        {
          keyword: "if",
          instancePath: container.inputLocation,
          schemaPath: sp(ifLocation),
          params: { failingKeyword: edge },
        },
      ];
    }
  }

  return [base];
}
