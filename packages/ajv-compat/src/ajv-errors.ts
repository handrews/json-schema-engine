// ajv-errors parity module (M8.4): custom `errorMessage` templating,
// post-processed over the already-mapped AJV error list (index.ts calls
// this through the errorPostProcessor hook after mapErrors). Every rule
// below beyond the README's basic per-keyword/properties/items examples
// was pinned by executing ajv-errors (D15 — see
// test/oracle/capture-companions.ts's `ajv-errors-*` cases):
//  - requires `allErrors: true` (ajv-errors itself throws otherwise).
//  - a plain string `errorMessage` behaves exactly like the object form's
//    `_` catch-all: it (and `_`) replace every error still unclaimed
//    whose schemaPath descends from this schema object's own path, AT ANY
//    DEPTH — reaching straight through allOf and nested properties/items
//    (oracle: `allOf`-nested and two-levels-deep `properties` errors are
//    both swept up by a root-level string/`_` form).
//  - a NAMED keyword key (e.g. `errorMessage: {required: "..."}`) only
//    matches a DIRECT sibling keyword at the SAME schema object — it does
//    NOT reach through allOf or nested properties (oracle:
//    `errorMessage: {required: "..."}` at the root left an allOf-nested
//    `required` error untouched, while the string/`_` form at the same
//    position swept the identical error up).
//  - `properties`/`items` map entries match by INSTANCE path instead:
//    `properties.foo` claims every remaining error whose instancePath is
//    at or under this schema's own instancePath + "/foo" (`items` matches
//    by array index the same way), regardless of schema nesting depth —
//    this is how the "properties/items reach through allOf" README
//    example works. `items`' map form requires an array of strings
//    (positional by index); ajv-errors' own metaschema rejects an object
//    or single-string form there (oracle: both throw at compile).
//  - nested `errorMessage` nodes are resolved DEPTH-FIRST (deepest
//    schemaPath first): once an error is claimed by an inner node it's
//    removed from the pool, so an outer string/`_` form never re-wraps it
//    (oracle: `outer-covers-inner-replaced` leaves the inner-claimed error
//    alone even though its instancePath/schemaPath both fall under the
//    outer node).
//  - one exception the depth-first/reach-through-descendant model above
//    does not replicate: a schema object applied through `items` (the
//    array "for every element" applicator, as opposed to a single fixed
//    position like `properties`/`prefixItems`/`patternProperties`/
//    `contains`) does NOT let a string/`_`-form errorMessage at that same
//    node reach into ITS OWN nested `properties` errors (oracle:
//    `items-with-nested-props-errormessage` — the same schema shape
//    nested under `prefixItems`/`patternProperties`/`contains` instead DID
//    reach through). This is an artifact of which AJV keywords compile to
//    an unrolled/inlined error-gathering block versus a real loop — an
//    AJV-codegen distinction (D15 excludes reading it), not a documented
//    rule, so it is not modeled; `items`-nested errorMessage matching here
//    always reaches through like the other applicators.
//  - `singleError` merges multiple messages generated for the SAME node
//    into one, joined by `";"` when `true` (not `"; "` — the README says
//    "; " but execution shows no space) or the given separator string; the
//    merge order follows the `errorMessage` OBJECT's own key declaration
//    order, not the schema's keyword order (oracle: swapping only the
//    errorMessage object's key order reorders the merged message even
//    when the schema's own keyword order is unchanged).
//  - `${/json/pointer}` and relative-pointer (`${0#}` — the property-name
//    form) templates interpolate JSON.stringify'd values.

import type { JsonValue } from "@jse/core";
import type { AjvErrorObject } from "./errors.js";
import type { Ajv } from "./index.js";

/** `errorMessage`'s value: a plain message, or per-keyword/property maps. */
type ErrorMessageValue =
  | string
  | {
      readonly _?: string;
      readonly properties?: Readonly<Record<string, string>>;
      readonly items?: readonly string[];
      readonly required?: string | Readonly<Record<string, string>>;
      readonly dependencies?: string | Readonly<Record<string, string>>;
      readonly [keyword: string]: unknown;
    };

export interface AjvErrorsOptions {
  keepErrors?: boolean;
  singleError?: boolean | string;
}

const isRecord = (v: JsonValue): v is Record<string, JsonValue> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Applicator keywords whose child position also descends one instance
 * segment — `properties`/`prefixItems` at a statically-known name/index,
 * `patternProperties`/`items`/`contains` at a name/index only known per
 * matched error (their occurrence count is still exactly one consumed
 * segment either way, which is all the grouping key below needs). */
const INSTANCE_DESCENDING = new Set([
  "properties",
  "patternProperties",
  "additionalProperties",
  "unevaluatedProperties",
  "prefixItems",
  "items",
  "contains",
  "additionalItems",
  "unevaluatedItems",
]);

interface ErrorMessageNode {
  path: string;
  value: ErrorMessageValue;
  /** instance-path segments this node's own position commits to (see
   * INSTANCE_DESCENDING) — the grouping key truncates each candidate
   * error's instancePath to this many segments (oracle: a root-level
   * errorMessage merges errors at "" and "/foo" into ONE group; items'
   * repeated occurrences instead group per-element because each is a
   * separate consumed segment away from the array itself). */
  instanceDepth: number;
}

/** Every schemaPath-owning node with `errorMessage`, deepest first. */
function collectErrorMessageNodes(
  schema: JsonValue,
  path: string,
): ErrorMessageNode[] {
  const out: ErrorMessageNode[] = [];
  const visit = (node: JsonValue, nodePath: string, depth: number): void => {
    if (!isRecord(node)) return;
    if (node.errorMessage !== undefined) {
      out.push({
        path: nodePath,
        value: node.errorMessage as ErrorMessageValue,
        instanceDepth: depth,
      });
    }
    for (const [key, value] of Object.entries(node)) {
      if (key === "errorMessage") continue;
      const childPath = `${nodePath}/${escapeSegment(key)}`;
      const childDepth = INSTANCE_DESCENDING.has(key) ? depth + 1 : depth;
      if (Array.isArray(value)) {
        value.forEach((item, i) => {
          visit(item, `${childPath}/${String(i)}`, childDepth);
        });
      } else {
        visit(value, childPath, childDepth);
      }
    }
  };
  visit(schema, path, 0);
  // Deepest (longest) schemaPath first, so an inner node's replacement
  // removes its errors from the pool before an ancestor's turn.
  return out.sort((a, b) => b.path.length - a.path.length);
}

/** Truncates an instancePath ("/a/b/c") to its first `depth` segments. */
function truncateInstancePath(instancePath: string, depth: number): string {
  if (instancePath === "" || depth === 0) return "";
  const segs = instancePath.slice(1).split("/");
  return segs.length <= depth
    ? instancePath
    : `/${segs.slice(0, depth).join("/")}`;
}

const escapeSegment = (s: string): string =>
  s.replace(/~/g, "~0").replace(/\//g, "~1");

/** Renders `${/pointer}`/`${N#}` templates against the validated instance. */
function renderTemplate(
  template: string,
  instance: JsonValue,
  instancePath: string,
): string {
  return template.replace(/\$\{([^}]*)\}/g, (_match, expr: string) => {
    const value = resolvePointerExpr(expr, instance, instancePath);
    return value === undefined ? "" : JSON.stringify(value);
  });
}

/** A relative-JSON-pointer-ish `${N#}` (property name) or `${/a/b}` (absolute-from-root). */
function resolvePointerExpr(
  expr: string,
  instance: JsonValue,
  instancePath: string,
): JsonValue | undefined {
  const relMatch = /^(\d+)#$/.exec(expr);
  if (relMatch !== null) {
    const up = Number(relMatch[1]);
    const segs = instancePath === "" ? [] : instancePath.slice(1).split("/");
    const idx = segs.length - up;
    return idx > 0 ? decodeSegment(segs[idx - 1]!) : undefined;
  }
  return walkPointer(instance, expr);
}

const decodeSegment = (s: string): string =>
  s.replace(/~1/g, "/").replace(/~0/g, "~");

function walkPointer(doc: JsonValue, pointer: string): JsonValue | undefined {
  let node: JsonValue | undefined = doc;
  if (pointer === "") return node;
  for (const raw of pointer.slice(1).split("/")) {
    const seg = decodeSegment(raw);
    if (Array.isArray(node)) node = node[Number(seg)];
    else if (typeof node === "object" && node !== null)
      node = (node as Record<string, JsonValue>)[seg];
    else return undefined;
  }
  return node;
}

/** Strict-prefix test: `child` is `parent` itself or nested under it. */
const underPath = (child: string, parent: string): boolean =>
  child === parent || child.startsWith(`${parent}/`);

const depthOf = (schemaPath: string): number =>
  schemaPath === "" ? 0 : schemaPath.split("/").length - 1;

/**
 * The errorMessage post-processing pass (index.ts's errorPostProcessor
 * hook calls this with the mapped AJV errors + the root schema).
 */
export function applyErrorMessages(
  errors: AjvErrorObject[],
  instance: JsonValue,
  schema: JsonValue,
  rootSchemaPath: string,
  options: AjvErrorsOptions,
): AjvErrorObject[] {
  const nodes = collectErrorMessageNodes(schema, rootSchemaPath);
  if (nodes.length === 0) return errors;

  let pool = errors;
  const produced: AjvErrorObject[] = [];

  for (const { path: nodePath, value, instanceDepth } of nodes) {
    const remaining: AjvErrorObject[] = [];
    // Errors this node's schema position could plausibly own (its own
    // subtree) vs. everything else (never touched by this node).
    const inSubtree: AjvErrorObject[] = [];
    for (const e of pool) {
      if (underPath(e.schemaPath, nodePath)) inSubtree.push(e);
      else remaining.push(e);
    }
    if (inSubtree.length === 0) {
      pool = remaining;
      continue;
    }

    const claimed = new Set<AjvErrorObject>();
    const groups = new Map<
      string,
      { error: AjvErrorObject; message: string }[]
    >();
    // The string/per-keyword/`_` forms group by this NODE's own instance
    // occurrence (truncating each error's actual instancePath to the
    // node's static depth) — a root-level errorMessage merges a "" error
    // and a "/foo" error into ONE group, while a repeated `items` node's
    // per-element occurrences (each one segment deeper) stay separate.
    const addToGroup = (
      groupInstancePath: string,
      error: AjvErrorObject,
      message: string,
    ): void => {
      claimed.add(error);
      const list = groups.get(groupInstancePath) ?? [];
      // Templates render against the matched error's OWN instancePath
      // (its "current position"), not the group's — they can differ when
      // a node-level form (string/_/per-keyword) merges errors from
      // several instance positions into one occurrence group.
      list.push({
        error,
        message: renderTemplate(message, instance, error.instancePath),
      });
      groups.set(groupInstancePath, list);
    };
    const ownGroupPath = (e: AjvErrorObject): string =>
      truncateInstancePath(e.instancePath, instanceDepth);

    if (typeof value === "string") {
      for (const e of inSubtree) addToGroup(ownGroupPath(e), e, value);
    } else {
      // Named-keyword keys: direct sibling only (schemaPath === nodePath +
      // "/" + keyword, or a nested path under it for that SAME keyword —
      // e.g. required's own params live one level down, but the keyword
      // itself never crosses into a different applicator).
      for (const [key, msg] of Object.entries(value)) {
        if (key === "_" || key === "properties" || key === "items") continue;
        const directPath = `${nodePath}/${escapeSegment(key)}`;
        for (const e of inSubtree) {
          if (claimed.has(e)) continue;
          if (!underPath(e.schemaPath, directPath)) continue;
          if (typeof msg === "string") {
            addToGroup(ownGroupPath(e), e, msg);
          } else if (isRecord(msg as JsonValue)) {
            // required/dependencies per-property form: keyed by
            // missingProperty/property (oracle: errorMessage.required.foo).
            const perProp = msg as Record<string, string>;
            const propName =
              (e.params.missingProperty as string | undefined) ??
              (e.params.property as string | undefined);
            if (propName !== undefined && perProp[propName] !== undefined) {
              addToGroup(ownGroupPath(e), e, perProp[propName]);
            }
          }
        }
      }
      // properties/items maps: match by INSTANCE path one segment past
      // this node's own occurrence, not by schema nesting (reaches
      // through allOf etc. — oracle: properties-map-through-allOf).
      const childDepth = instanceDepth + 1;
      const propsMap = value.properties;
      if (propsMap !== undefined) {
        for (const [propName, msg] of Object.entries(propsMap)) {
          for (const e of inSubtree) {
            if (claimed.has(e)) continue;
            const segs =
              e.instancePath === "" ? [] : e.instancePath.slice(1).split("/");
            if (segs[instanceDepth] !== propName) continue;
            addToGroup(
              truncateInstancePath(e.instancePath, childDepth),
              e,
              msg,
            );
          }
        }
      }
      const itemsList = value.items;
      if (itemsList !== undefined) {
        itemsList.forEach((msg, index) => {
          for (const e of inSubtree) {
            if (claimed.has(e)) continue;
            const segs =
              e.instancePath === "" ? [] : e.instancePath.slice(1).split("/");
            if (segs[instanceDepth] !== String(index)) continue;
            addToGroup(
              truncateInstancePath(e.instancePath, childDepth),
              e,
              msg,
            );
          }
        });
      }
      // The `_` catch-all: same reach as the string form (any remaining
      // unclaimed error in this node's subtree), applied last.
      if (value._ !== undefined) {
        for (const e of inSubtree) {
          if (!claimed.has(e)) addToGroup(ownGroupPath(e), e, value._);
        }
      }
    }

    const schemaPath = `${nodePath}/errorMessage`;
    for (const [instancePath, unordered] of groups) {
      // AJV's own error list interleaves same-level and nested-descendant
      // failures in an order this adapter's engine doesn't reproduce (an
      // AJV codegen detail, D15) — but shallower schemaPaths consistently
      // precede deeper ones (oracle: a same-level additionalProperties
      // error precedes a nested properties/foo/type error even though our
      // engine's own evaluation order is the reverse). A stable sort by
      // schemaPath depth reconciles the two without depending on AJV's
      // internal evaluation order.
      const entries = [...unordered].sort(
        (a, b) => depthOf(a.error.schemaPath) - depthOf(b.error.schemaPath),
      );
      // README: "matched errors...will still be available in
      // params.errors...if included in the error generated...it will have
      // emUsed: true" — every original a group draws from is flagged,
      // whether or not keepErrors also keeps it standalone in the pool.
      const flag = (en: (typeof entries)[number]) => ({
        ...en.error,
        emUsed: true,
      });
      if (options.singleError !== undefined && options.singleError !== false) {
        const sep =
          typeof options.singleError === "string" ? options.singleError : ";";
        produced.push({
          keyword: "errorMessage",
          instancePath,
          schemaPath,
          params: { errors: entries.map(flag) },
          message: entries.map((en) => en.message).join(sep),
        });
        continue;
      }
      // Without singleError, entries with the SAME rendered message merge
      // into one output error (oracle: the string/`_` form's multiple
      // matched originals collapse to a single error since they all share
      // that one template); entries with genuinely different per-keyword
      // messages stay separate (oracle: minLength/pattern each get their
      // own errorMessage error at the same instancePath).
      const byMessage = new Map<string, typeof entries>();
      for (const en of entries) {
        const list = byMessage.get(en.message) ?? [];
        list.push(en);
        byMessage.set(en.message, list);
      }
      for (const [msg, sameMessage] of byMessage) {
        produced.push({
          keyword: "errorMessage",
          instancePath,
          schemaPath,
          params: { errors: sameMessage.map(flag) },
          message: msg,
        });
      }
    }

    // Claimed originals leave the pool (unless keepErrors keeps them
    // standalone too — flagged emUsed there as well, README: "if an error
    // was matched...it will have property emUsed: true"); whatever this
    // node didn't claim stays available for an ancestor errorMessage node
    // to match against, untouched.
    const survivingInSubtree =
      options.keepErrors === true
        ? inSubtree.map((e) => (claimed.has(e) ? { ...e, emUsed: true } : e))
        : inSubtree.filter((e) => !claimed.has(e));
    pool = [...remaining, ...survivingInSubtree];
  }

  return [...pool, ...produced];
}

/**
 * ajv-errors parity: registers `errorMessage` as a known (no-op for strict
 * mode) keyword and wires the post-processing pass into the class's
 * mapped-error pipeline (index.ts's errorPostProcessor hook).
 */
export default function ajvErrors(ajv: Ajv, opts: AjvErrorsOptions = {}): Ajv {
  if (ajv.opts.allErrors !== true) {
    throw new Error("ajv-errors: Ajv option allErrors must be true");
  }
  ajv.setErrorPostProcessor((errors, instance, schema, rootSchemaPath) =>
    applyErrorMessages(errors, instance, schema, rootSchemaPath, opts),
  );
  return ajv;
}
