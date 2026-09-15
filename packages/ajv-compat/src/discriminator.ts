// AJV's `discriminator: true` option (M8.4): OpenAPI-style branch
// selection over `oneOf` by a tag property. Every compile-time requirement
// and the runtime error shape below is pinned by executing AJV — its docs
// describe the *intent* (route by `discriminator.propertyName`) but not
// these specifics, which the oracle exposed (D15; see
// test/oracle/capture-companions.ts's `discriminator-*` cases):
//  - `mapping` is accepted by AJV's own type but its discriminator
//    implementation rejects it outright ("mapping is not supported") —
//    despite the OpenAPI spec defining it, so this adapter matches AJV,
//    not the spec.
//  - compile-time: `propertyName` is required; the tag property must be
//    listed in a sibling `required`; a sibling `oneOf` is required; every
//    branch (after following a `$ref`) must have `properties/<tag>` with
//    `const` or `enum` of strings; tag values must be unique across
//    branches (enum entries count individually).
//  - runtime: AJV's discriminator does not run alongside plain `oneOf`
//    semantics — it REPLACES them. A matching tag dispatches to exactly
//    that one branch (oracle: a second, non-matching branch's own errors
//    never appear, even under allErrors — "exactly one of N" is never
//    evaluated). A non-string/absent tag is a `{error: "tag"}` failure; a
//    string tag with no matching branch is `{error: "mapping"}` — and
//    `oneOf` itself reports nothing in either case (the discriminator
//    keyword's own schemaPath carries the error instead).

import type {
  ErrorParams,
  JsonValue,
  KeywordBehavior,
  KeywordContext,
} from "@json-schema-engine/core";

const isRecord = (v: JsonValue | undefined): v is Record<string, JsonValue> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** One `oneOf` branch's tag values, after following a `$ref` if present. */
function resolveBranch(
  branch: JsonValue,
  resolveRef: (ref: string) => { node: JsonValue },
): Record<string, JsonValue> {
  if (isRecord(branch) && typeof branch.$ref === "string") {
    const target = resolveRef(branch.$ref).node;
    return isRecord(target) ? target : {};
  }
  return isRecord(branch) ? branch : {};
}

/** Tag value(s) a branch's `properties/<propertyName>` declares. */
function branchTagValues(
  properties: JsonValue | undefined,
  propertyName: string,
): string[] {
  if (!isRecord(properties)) {
    throw new Error(
      'discriminator: oneOf subschemas (or referenced schemas) must have "properties/' +
        propertyName +
        '"',
    );
  }
  const tagSchema = properties[propertyName];
  if (!isRecord(tagSchema)) {
    throw new Error(
      'discriminator: oneOf subschemas (or referenced schemas) must have "properties/' +
        propertyName +
        '"',
    );
  }
  if (typeof tagSchema.const === "string") return [tagSchema.const];
  if (Array.isArray(tagSchema.enum)) {
    const values = tagSchema.enum;
    if (values.every((v): v is string => typeof v === "string")) {
      return values;
    }
  }
  throw new Error(
    `discriminator: "${propertyName}" values must be unique strings`,
  );
}

/** Builds and validates the tag -\> branch-index map (compile-time checks). */
function buildTagMap(
  schema: Record<string, JsonValue>,
  resolveRef: (ref: string) => { node: JsonValue },
): ReadonlyMap<string, number> {
  const discriminator = schema.discriminator;
  if (
    !isRecord(discriminator) ||
    typeof discriminator.propertyName !== "string"
  ) {
    throw new Error("discriminator: requires propertyName");
  }
  const propertyName = discriminator.propertyName;
  if (discriminator.mapping !== undefined) {
    throw new Error("discriminator: mapping is not supported");
  }
  const required = schema.required;
  if (!Array.isArray(required) || !required.includes(propertyName)) {
    throw new Error(`discriminator: "${propertyName}" must be required`);
  }
  const oneOf = schema.oneOf;
  if (!Array.isArray(oneOf)) {
    throw new Error("discriminator: requires oneOf keyword");
  }
  const map = new Map<string, number>();
  oneOf.forEach((branch, index) => {
    const properties = resolveBranch(branch, resolveRef).properties;
    for (const tag of branchTagValues(properties, propertyName)) {
      if (map.has(tag)) {
        throw new Error(
          `discriminator: "${propertyName}" values must be unique strings`,
        );
      }
      map.set(tag, index);
    }
  });
  return map;
}

/**
 * Eager compile-time validation (AJV throws these from `ajv.compile()`,
 * before any data is validated) — called once per schema-tree walk from
 * the same place `strictSchemaCheck` runs (index.ts's `compileAt`).
 */
export function checkDiscriminators(
  schema: JsonValue,
  resolveRef: (ref: string) => { node: JsonValue },
): void {
  const visit = (node: JsonValue): void => {
    if (!isRecord(node)) return;
    if (node.discriminator !== undefined) buildTagMap(node, resolveRef);
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) {
        for (const item of value) visit(item);
      } else {
        visit(value);
      }
    }
  };
  visit(schema);
}

const DISCRIMINATOR_ID = "urn:ajv-compat:keywords#discriminator";
const ONE_OF_ID = "urn:ajv-compat:keywords#oneOf-discriminated";

/**
 * `discriminator` itself is inert during evaluation — its whole effect is
 * routing `oneOf` (below), and reporting the tag/mapping failure under its
 * OWN schemaPath (oracle: `schemaPath: "#/discriminator"`, not
 * "#/oneOf") is why this keyword still needs to exist and run.
 */
export const discriminatorBehavior: KeywordBehavior = {
  id: DISCRIMINATOR_ID,
  evaluate: (_value, cursor, ctx: KeywordContext): boolean => {
    const data = cursor.value;
    if (!isRecord(data)) return true; // `type` (if present) covers non-objects
    const schema = ctx.schema;
    const map = buildTagMap(schema, (ref) => ctx.resolveRef(ref));
    const discriminator = schema.discriminator as Record<string, JsonValue>;
    const propertyName = discriminator.propertyName as string;
    const tagValue = data[propertyName];
    if (typeof tagValue !== "string") {
      // tagValue is omitted when the property is absent (oracle:
      // "no-kind-property" has no tagValue key) but included when present
      // with the wrong type (oracle: "non-string-tag" has tagValue: 5).
      const params: ErrorParams = Object.hasOwn(data, propertyName)
        ? { error: "tag", tag: propertyName, tagValue: tagValue as JsonValue }
        : { error: "tag", tag: propertyName };
      ctx.error(`tag "${propertyName}" must be string`, params);
      return false;
    }
    if (!map.has(tagValue)) {
      const params: ErrorParams = {
        error: "mapping",
        tag: propertyName,
        tagValue,
      };
      ctx.error(`value of tag "${propertyName}" must be in oneOf`, params);
      return false;
    }
    return true;
  },
};

/**
 * `oneOf`, overridden for schemas with a `discriminator` sibling: dispatch
 * to exactly the tag-selected branch and return its verdict directly,
 * instead of oneOf's normal "apply every branch, require exactly one
 * match." Schemas without a `discriminator` sibling fall back to plain
 * oneOf semantics unchanged (this compat dialect only ever replaces
 * `oneOf` wholesale when the option is on, so both shapes must be handled
 * here — see index.ts's compatBehaviors).
 */
export const discriminatedOneOf: KeywordBehavior = {
  id: ONE_OF_ID,
  analyze: (value) =>
    Array.isArray(value)
      ? {
          subschemas: value.map((_, i) => [i]),
          applications: value.map((_, i) => ({
            path: [i],
            mode: "inPlace" as const,
            conditional: true,
            asserts: true,
          })),
        }
      : {},
  evaluate: (value, cursor, ctx: KeywordContext): boolean => {
    if (!Array.isArray(value) || !Object.hasOwn(ctx.schema, "discriminator")) {
      const branches = value as JsonValue[];
      const passing: number[] = [];
      branches.forEach((_, i) => {
        if (ctx.apply(["oneOf", i], cursor)) passing.push(i);
      });
      if (passing.length !== 1) {
        ctx.error(
          `matched ${String(passing.length)} branches, expected exactly 1`,
          { passing },
        );
      }
      return passing.length === 1;
    }
    // discriminator's own keyword (evaluated in dialect order) reports the
    // tag/mapping failure; if the tag doesn't resolve to a branch at all,
    // oneOf itself contributes nothing (oracle: no oneOf error appears
    // alongside a discriminator failure).
    const map = buildTagMap(ctx.schema, (ref) => ctx.resolveRef(ref));
    const discriminator = ctx.schema.discriminator as Record<string, JsonValue>;
    const propertyName = discriminator.propertyName as string;
    const data = cursor.value;
    const tagValue = isRecord(data) ? data[propertyName] : undefined;
    if (typeof tagValue !== "string" || !map.has(tagValue)) return true;
    // The routed branch's own errors are AJV's entire output here (oracle:
    // no visible oneOf error alongside them). No oneOf record is emitted:
    // the error filter sees the routed combiner as failed structurally —
    // its single applied branch is invalid in the trace.
    return ctx.apply(["oneOf", map.get(tagValue)!], cursor);
  },
};
