// ajv-keywords parity module (M8.4): a subset chosen for being pure
// data-shape assertions (no code-generation, no mutation) — typeof,
// instanceof, uniqueItemProperties, prohibited. Semantics and exact
// (empty-params, generic-message) error shape are pinned by executing
// ajv-keywords (D15 — its README documents the value grammar but not the
// error shape, which the oracle showed is uniformly `{}` params and
// `must pass "<name>" keyword validation`; see
// test/oracle/capture-companions.ts's `ajv-keywords-*` cases).
// transform/dynamicDefaults mutate data — delivered as mutation-fixpoint
// passes (mutate.ts) and activated on the instance here;
// select/selectCases/selectDefault need $data (excluded by design, see
// AjvCompatUnsupportedError for $data elsewhere) and still raise it.

import type { JsonValue } from "@json-schema-engine/core";
import type { Ajv, KeywordDefinition } from "./index.js";
import { AjvCompatUnsupportedError } from "./index.js";

/** `typeof`: JS `typeof` result must equal the value (or one of an array). */
function typeofResult(data: JsonValue): string {
  // JSON values are never actually `undefined`/`function`/`symbol` at
  // runtime, but the keyword's grammar allows asking for them (always a
  // vacuous mismatch for real instances — oracle: `{typeof: "undefined"}`
  // against `null` fails, matching plain JS `typeof null === "object"`).
  return typeof data;
}

const typeofKeyword: KeywordDefinition = {
  keyword: "typeof",
  validate: (schema, data) => {
    const wanted = Array.isArray(schema) ? schema : [schema];
    return wanted.includes(typeofResult(data));
  },
};

// `instanceof`: JS `instanceof` against JSON-decoded data. Every JSON value
// is Object/Array or a primitive — Date/RegExp/Function/Promise never
// occur in decoded JSON, so those names are always a mismatch for real
// data (kept for schema-grammar parity, matching what the real keyword
// would also report false for the same reason).
const instanceofKeyword: KeywordDefinition = {
  keyword: "instanceof",
  validate: (schema, data) => {
    const wanted = Array.isArray(schema) ? schema : [schema];
    const isArray = Array.isArray(data);
    const isObject = typeof data === "object" && data !== null;
    return wanted.some((name) => {
      if (name === "Array") return isArray;
      if (name === "Object") return isObject;
      return false;
    });
  },
};

/** `uniqueItemProperties`: no two items share the same values across ALL
 * listed properties (oracle: two items both LACKING a listed property —
 * both read as `undefined` — count as a duplicate). */
const uniqueItemPropertiesKeyword: KeywordDefinition = {
  keyword: "uniqueItemProperties",
  type: "array",
  validate: (schema, data) => {
    const props = schema as string[];
    const items = data as JsonValue[];
    const seen = new Set<string>();
    for (const item of items) {
      const isObj =
        typeof item === "object" && item !== null && !Array.isArray(item);
      const record = isObj ? (item as Record<string, JsonValue>) : {};
      const key = JSON.stringify(props.map((p) => record[p] ?? null));
      if (seen.has(key)) return false;
      seen.add(key);
    }
    return true;
  },
};

/** `prohibited`: none of the listed properties may be present. */
const prohibitedKeyword: KeywordDefinition = {
  keyword: "prohibited",
  type: "object",
  validate: (schema, data) => {
    const props = schema as string[];
    const record = data as Record<string, JsonValue>;
    return !props.some((p) => Object.hasOwn(record, p));
  },
};

const SUPPORTED: Readonly<Record<string, KeywordDefinition>> = {
  typeof: typeofKeyword,
  instanceof: instanceofKeyword,
  uniqueItemProperties: uniqueItemPropertiesKeyword,
  prohibited: prohibitedKeyword,
};

// transform/dynamicDefaults are delivered as mutation-fixpoint passes
// (mutate.ts), activated on the instance rather than registered as engine
// keywords — the core is a pure validator, so it cannot mutate mid-evaluate.
const MUTATING_NAMES = new Set(["transform", "dynamicDefaults"]);
const DATA_DEPENDENT_NAMES = new Set([
  "select",
  "selectCases",
  "selectDefault",
]);

/**
 * ajv-keywords parity: registers the supported subset (default: all four
 * pure keywords) and activates the mutating companions transform /
 * dynamicDefaults. `select*` ($data-sourced) and unknown names raise
 * AjvCompatUnsupportedError.
 */
export default function ajvKeywords(
  ajv: Ajv,
  names?: string | readonly string[],
): Ajv {
  const requested =
    names === undefined
      ? Object.keys(SUPPORTED)
      : typeof names === "string"
        ? [names]
        : [...names];
  for (const name of requested) {
    const def = SUPPORTED[name];
    if (def !== undefined) {
      ajv.addKeyword(def);
      continue;
    }
    if (MUTATING_NAMES.has(name)) {
      ajv.activateMutatingKeyword(name as "transform" | "dynamicDefaults");
      continue;
    }
    if (DATA_DEPENDENT_NAMES.has(name)) {
      throw new AjvCompatUnsupportedError(
        `ajv-keywords "${name}"`,
        "$data-sourced schema values are excluded by design",
      );
    }
    throw new AjvCompatUnsupportedError(
      `ajv-keywords "${name}"`,
      "not part of the supported subset (typeof, instanceof, uniqueItemProperties, prohibited)",
    );
  }
  return ajv;
}
