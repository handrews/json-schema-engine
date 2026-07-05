// Prototype evaluation engine (ANALYSIS.md §7.1–§7.3 in miniature).
//
// Keywords communicate through a channel of typed productions scoped by
// evaluation frames: each schema application pushes a frame, productions merge
// into the parent frame only when the application succeeds. Spec annotation
// semantics (dropping on failure, in-place applicator visibility for the
// unevaluated* keywords) fall out of that one scoping rule. The annotation
// collector is just the surviving root-frame productions filtered by a
// retention policy; internal consumers (unevaluated*) read the channel
// directly and are unaffected by retention.

import {
  JsonValue, isObject, jsonTypeOf, jsonEqual, codePointLength, escapeSegment,
  schemaRegExp,
} from "./json.js";
import { Registry, SchemaRef } from "./registry.js";

export interface Production {
  keyword: string;
  evaluationPath: string;   // keywordLocation
  schemaLocation: string;   // absoluteKeywordLocation
  instanceLocation: string;
  value: unknown;
}

export interface OutputUnit {
  keywordLocation: string;
  absoluteKeywordLocation: string;
  instanceLocation: string;
  error: string;
}

export interface RetentionPolicy {
  keywords?: readonly string[];          // allow-list by keyword name
  keep?: (p: Production) => boolean;     // arbitrary predicate, ANDed
}

export interface EvalOptions {
  collectAnnotations?: boolean;
  retention?: RetentionPolicy;
}

export interface Result {
  valid: boolean;
  errors?: OutputUnit[];
  annotations?: Production[];
}

interface Frame { productions: Production[] }

class Ctx {
  frames: Frame[] = [{ productions: [] }];
  errors: OutputUnit[] = [];
  constructor(public registry: Registry) {}
  get frame(): Frame { return this.frames[this.frames.length - 1]!; }
}

// One keyword application's view of the engine.
class KwApi {
  constructor(
    private ctx: Ctx,
    public schemaRef: SchemaRef,
    public keyword: string,
    public instance: JsonValue,
    public instanceLocation: string,
    public evaluationPath: string,
  ) {}

  get value(): JsonValue {
    return (this.schemaRef.node as Record<string, JsonValue>)[this.keyword]!;
  }

  get siblings(): Record<string, JsonValue> {
    return this.schemaRef.node as Record<string, JsonValue>;
  }

  // Apply the subschema at schema-relative `segments` to `instance`.
  applyChild(
    segments: (string | number)[],
    instance: JsonValue,
    instanceSuffix = "",
  ): boolean {
    const child = this.ctx.registry.child(this.schemaRef, ...segments);
    const path = this.evaluationPath + "/" +
      segments.map((s) => escapeSegment(String(s))).join("/");
    return applySchema(this.ctx, child, instance,
      this.instanceLocation + instanceSuffix, path);
  }

  applyRef(target: SchemaRef, refKeyword: string): boolean {
    return applySchema(this.ctx, target, this.instance, this.instanceLocation,
      this.evaluationPath + "/" + refKeyword);
  }

  resolveRef(ref: string): SchemaRef {
    return this.ctx.registry.resolveRef(ref, this.schemaRef.baseUri);
  }

  produce(value: unknown): void {
    this.ctx.frame.productions.push({
      keyword: this.keyword,
      evaluationPath: this.evaluationPath + "/" + escapeSegment(this.keyword),
      schemaLocation: `${this.schemaRef.baseUri}#${this.schemaRef.pointer}/${escapeSegment(this.keyword)}`,
      instanceLocation: this.instanceLocation,
      value,
    });
  }

  // Productions visible to this schema application (own keywords + merged
  // successful in-place child applications) at this instance location.
  visibleProductions(keywords: readonly string[]): Production[] {
    return this.ctx.frame.productions.filter(
      (p) => p.instanceLocation === this.instanceLocation && keywords.includes(p.keyword),
    );
  }

  error(message: string): void {
    this.ctx.errors.push({
      keywordLocation: this.evaluationPath + "/" + escapeSegment(this.keyword),
      absoluteKeywordLocation:
        `${this.schemaRef.baseUri}#${this.schemaRef.pointer}/${escapeSegment(this.keyword)}`,
      instanceLocation: this.instanceLocation,
      error: message,
    });
  }
}

type KeywordImpl = (api: KwApi) => boolean;

// --- Assertion helpers -------------------------------------------------------

const typeMatches = (t: JsonValue, v: JsonValue): boolean => {
  if (t === "integer") return typeof v === "number" && Number.isInteger(v);
  return jsonTypeOf(v) === t;
};

// --- Keyword implementations -------------------------------------------------

const KEYWORDS: Record<string, KeywordImpl> = {
  $ref(api) {
    return api.applyRef(api.resolveRef(api.value as string), "$ref");
  },

  type(api) {
    const t = api.value;
    const ok = Array.isArray(t)
      ? t.some((x) => typeMatches(x!, api.instance))
      : typeMatches(t, api.instance);
    if (!ok) api.error(`expected type ${JSON.stringify(t)}`);
    return ok;
  },

  enum(api) {
    const ok = (api.value as JsonValue[]).some((x) => jsonEqual(x!, api.instance));
    if (!ok) api.error("not one of the allowed values");
    return ok;
  },

  const(api) {
    const ok = jsonEqual(api.value, api.instance);
    if (!ok) api.error("does not equal the required constant");
    return ok;
  },

  pattern(api) {
    if (typeof api.instance !== "string") return true;
    const ok = schemaRegExp(api.value as string).test(api.instance);
    if (!ok) api.error("does not match required pattern");
    return ok;
  },

  minLength(api) {
    if (typeof api.instance !== "string") return true;
    const ok = codePointLength(api.instance) >= (api.value as number);
    if (!ok) api.error("string is too short");
    return ok;
  },

  maxLength(api) {
    if (typeof api.instance !== "string") return true;
    const ok = codePointLength(api.instance) <= (api.value as number);
    if (!ok) api.error("string is too long");
    return ok;
  },

  minimum(api) {
    if (typeof api.instance !== "number") return true;
    const ok = api.instance >= (api.value as number);
    if (!ok) api.error(`must be >= ${api.value}`);
    return ok;
  },

  maximum(api) {
    if (typeof api.instance !== "number") return true;
    const ok = api.instance <= (api.value as number);
    if (!ok) api.error(`must be <= ${api.value}`);
    return ok;
  },

  exclusiveMinimum(api) {
    if (typeof api.instance !== "number") return true;
    const ok = api.instance > (api.value as number);
    if (!ok) api.error(`must be > ${api.value}`);
    return ok;
  },

  exclusiveMaximum(api) {
    if (typeof api.instance !== "number") return true;
    const ok = api.instance < (api.value as number);
    if (!ok) api.error(`must be < ${api.value}`);
    return ok;
  },

  minItems(api) {
    const ok = !Array.isArray(api.instance) || api.instance.length >= (api.value as number);
    if (!ok) api.error("too few items");
    return ok;
  },

  maxItems(api) {
    const ok = !Array.isArray(api.instance) || api.instance.length <= (api.value as number);
    if (!ok) api.error("too many items");
    return ok;
  },

  minProperties(api) {
    const ok = !isObject(api.instance)
      || Object.keys(api.instance).length >= (api.value as number);
    if (!ok) api.error("too few properties");
    return ok;
  },

  maxProperties(api) {
    const ok = !isObject(api.instance)
      || Object.keys(api.instance).length <= (api.value as number);
    if (!ok) api.error("too many properties");
    return ok;
  },

  required(api) {
    if (!isObject(api.instance)) return true;
    let ok = true;
    for (const name of api.value as string[]) {
      if (!Object.hasOwn(api.instance, name)) {
        api.error(`missing required property '${name}'`);
        ok = false;
      }
    }
    return ok;
  },

  // --- In-place applicators ---

  allOf(api) {
    let ok = true;
    (api.value as JsonValue[]).forEach((_, i) => {
      if (!api.applyChild(["allOf", i], api.instance)) ok = false;
    });
    return ok;
  },

  anyOf(api) {
    // All branches are evaluated (successful branches contribute annotations).
    let ok = false;
    (api.value as JsonValue[]).forEach((_, i) => {
      if (api.applyChild(["anyOf", i], api.instance)) ok = true;
    });
    if (!ok) api.error("no branch matched");
    return ok;
  },

  oneOf(api) {
    let count = 0;
    (api.value as JsonValue[]).forEach((_, i) => {
      if (api.applyChild(["oneOf", i], api.instance)) count++;
    });
    if (count !== 1) api.error(`matched ${count} branches, expected exactly 1`);
    return count === 1;
  },

  not(api) {
    const ok = !api.applyChild(["not"], api.instance);
    if (!ok) api.error("must not match the subschema");
    return ok;
  },

  if(api) {
    const condition = api.applyChild(["if"], api.instance);
    if (condition && Object.hasOwn(api.siblings, "then")) {
      return api.applyChild(["then"], api.instance);
    }
    if (!condition && Object.hasOwn(api.siblings, "else")) {
      return api.applyChild(["else"], api.instance);
    }
    return true;
  },

  dependentSchemas(api) {
    if (!isObject(api.instance)) return true;
    let ok = true;
    for (const name of Object.keys(api.value as Record<string, JsonValue>)) {
      if (Object.hasOwn(api.instance, name)
        && !api.applyChild(["dependentSchemas", name], api.instance)) {
        ok = false;
      }
    }
    return ok;
  },

  // --- Object child applicators ---

  properties(api) {
    if (!isObject(api.instance)) return true;
    let ok = true;
    const matched: string[] = [];
    for (const name of Object.keys(api.value as Record<string, JsonValue>)) {
      if (Object.hasOwn(api.instance, name)) {
        matched.push(name);
        if (!api.applyChild(["properties", name], api.instance[name]!,
          "/" + escapeSegment(name))) ok = false;
      }
    }
    api.produce(matched);
    return ok;
  },

  patternProperties(api) {
    if (!isObject(api.instance)) return true;
    let ok = true;
    const matched = new Set<string>();
    for (const pattern of Object.keys(api.value as Record<string, JsonValue>)) {
      const re = schemaRegExp(pattern);
      for (const name of Object.keys(api.instance)) {
        if (re.test(name)) {
          matched.add(name);
          if (!api.applyChild(["patternProperties", pattern], api.instance[name]!,
            "/" + escapeSegment(name))) ok = false;
        }
      }
    }
    api.produce([...matched]);
    return ok;
  },

  additionalProperties(api) {
    if (!isObject(api.instance)) return true;
    // Defined against sibling properties/patternProperties only — statically
    // derivable, an example of "same result, different mechanism" (§5).
    const propNames = isObject(api.siblings.properties)
      ? new Set(Object.keys(api.siblings.properties)) : new Set<string>();
    const patterns = isObject(api.siblings.patternProperties)
      ? Object.keys(api.siblings.patternProperties).map((p) => schemaRegExp(p)) : [];
    let ok = true;
    const matched: string[] = [];
    for (const name of Object.keys(api.instance)) {
      if (propNames.has(name) || patterns.some((re) => re.test(name))) continue;
      matched.push(name);
      if (!api.applyChild(["additionalProperties"], api.instance[name]!,
        "/" + escapeSegment(name))) ok = false;
    }
    api.produce(matched);
    return ok;
  },

  // --- Array child applicators ---

  prefixItems(api) {
    if (!Array.isArray(api.instance)) return true;
    const schemas = api.value as JsonValue[];
    const n = Math.min(schemas.length, api.instance.length);
    let ok = true;
    for (let i = 0; i < n; i++) {
      if (!api.applyChild(["prefixItems", i], api.instance[i]!, "/" + i)) ok = false;
    }
    if (n > 0) api.produce(n === api.instance.length ? true : n - 1);
    return ok;
  },

  items(api) {
    if (!Array.isArray(api.instance)) return true;
    // Applies past the sibling prefixItems (statically known).
    const start = Array.isArray(api.siblings.prefixItems)
      ? api.siblings.prefixItems.length : 0;
    let ok = true;
    let applied = false;
    for (let i = start; i < api.instance.length; i++) {
      applied = true;
      if (!api.applyChild(["items"], api.instance[i]!, "/" + i)) ok = false;
    }
    if (applied) api.produce(true);
    return ok;
  },

  contains(api) {
    if (!Array.isArray(api.instance)) return true;
    const matchedIdx: number[] = [];
    for (let i = 0; i < api.instance.length; i++) {
      if (api.applyChild(["contains"], api.instance[i]!, "/" + i)) matchedIdx.push(i);
    }
    if (matchedIdx.length === 0) {
      api.error("no items match the contains subschema");
      return false;
    }
    api.produce(matchedIdx.length === api.instance.length ? true : matchedIdx);
    return true;
  },

  // --- unevaluated* (channel consumers) ---

  unevaluatedProperties(api) {
    if (!isObject(api.instance)) return true;
    const seen = new Set<string>();
    for (const p of api.visibleProductions(
      ["properties", "patternProperties", "additionalProperties", "unevaluatedProperties"],
    )) {
      for (const name of p.value as string[]) seen.add(name);
    }
    let ok = true;
    const matched: string[] = [];
    for (const name of Object.keys(api.instance)) {
      if (seen.has(name)) continue;
      matched.push(name);
      if (!api.applyChild(["unevaluatedProperties"], api.instance[name]!,
        "/" + escapeSegment(name))) ok = false;
    }
    api.produce(matched);
    return ok;
  },

  unevaluatedItems(api) {
    if (!Array.isArray(api.instance)) return true;
    let coveredPrefix = 0; // count of covered leading indexes
    const coveredIdx = new Set<number>();
    for (const p of api.visibleProductions(
      ["prefixItems", "items", "contains", "unevaluatedItems"],
    )) {
      if (p.keyword === "contains") {
        if (p.value === true) coveredPrefix = api.instance.length;
        else for (const i of p.value as number[]) coveredIdx.add(i);
      } else if (p.value === true) {
        coveredPrefix = api.instance.length;
      } else if (p.keyword === "prefixItems") {
        coveredPrefix = Math.max(coveredPrefix, (p.value as number) + 1);
      }
    }
    let ok = true;
    let applied = false;
    for (let i = coveredPrefix; i < api.instance.length; i++) {
      if (coveredIdx.has(i)) continue;
      applied = true;
      if (!api.applyChild(["unevaluatedItems"], api.instance[i]!, "/" + i)) ok = false;
    }
    if (applied) api.produce(true);
    return ok;
  },
};

// Structural keywords: no evaluation behavior, never produce annotations
// ($comment's value MUST NOT be collected).
const STRUCTURAL = new Set([
  "$id", "$schema", "$anchor", "$defs", "$comment", "$vocabulary", "then", "else",
]);

// Evaluation order: unevaluated* must run after everything else in the same
// schema object; the rest of the order is convention.
const ORDER: string[] = Object.keys(KEYWORDS)
  .filter((k) => k !== "unevaluatedProperties" && k !== "unevaluatedItems")
  .concat(["unevaluatedProperties", "unevaluatedItems"]);

function applySchema(
  ctx: Ctx,
  schemaRef: SchemaRef,
  instance: JsonValue,
  instanceLocation: string,
  evaluationPath: string,
): boolean {
  const node = schemaRef.node;
  if (typeof node === "boolean") {
    if (!node) {
      ctx.errors.push({
        keywordLocation: evaluationPath,
        absoluteKeywordLocation: `${schemaRef.baseUri}#${schemaRef.pointer}`,
        instanceLocation,
        error: "schema is false",
      });
    }
    return node;
  }
  if (!isObject(node)) return true; // non-schema value; tolerate in prototype

  ctx.frames.push({ productions: [] });
  let valid = true;

  for (const keyword of ORDER) {
    if (!Object.hasOwn(node, keyword)) continue;
    const api = new KwApi(ctx, schemaRef, keyword, instance, instanceLocation, evaluationPath);
    if (!KEYWORDS[keyword]!(api)) valid = false;
  }
  for (const keyword of Object.keys(node)) {
    if (keyword in KEYWORDS || STRUCTURAL.has(keyword)) continue;
    // Annotation-only keywords (title, readOnly, default, format, ...) and
    // unknown keywords get identical treatment: value becomes the annotation.
    const api = new KwApi(ctx, schemaRef, keyword, instance, instanceLocation, evaluationPath);
    api.produce(node[keyword]);
  }

  const frame = ctx.frames.pop()!;
  if (valid) ctx.frame.productions.push(...frame.productions);
  return valid;
}

export function evaluate(
  registry: Registry,
  schemaUri: string,
  instance: JsonValue,
  options: EvalOptions = {},
): Result {
  const ctx = new Ctx(registry);
  const valid = applySchema(ctx, registry.rootRef(schemaUri), instance, "", "");

  const result: Result = { valid };
  if (!valid) result.errors = ctx.errors;
  if (valid && options.collectAnnotations) {
    let productions = ctx.frame.productions;
    const retention = options.retention;
    if (retention?.keywords) {
      productions = productions.filter((p) => retention.keywords!.includes(p.keyword));
    }
    if (retention?.keep) productions = productions.filter(retention.keep);
    result.annotations = productions;
  }
  return result;
}
