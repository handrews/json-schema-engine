// Official JSON-Schema-Test-Suite harness (draft2020-12 subset).
//
// Gate: every non-skipped case passes. Skips are mechanical and reported:
//  - the schema (in schema positions only) uses a keyword with assertion
//    semantics the prototype doesn't implement, or
//  - the schema references a resource the suite doesn't inline (remote refs).

import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

import { JsonValue, isObject } from "./json.js";
import { Registry, UnresolvableRefError } from "./registry.js";
import { evaluate } from "./engine.js";

const SUITE = join(dirname(fileURLToPath(import.meta.url)), "..",
  "test-suite", "tests", "draft2020-12");

const FILES = [
  "type", "enum", "const", "pattern", "required",
  "minLength", "maxLength", "minimum", "maximum",
  "exclusiveMinimum", "exclusiveMaximum", "minItems", "maxItems",
  "minProperties", "maxProperties",
  "properties", "patternProperties", "additionalProperties",
  "prefixItems", "items", "contains",
  "allOf", "anyOf", "oneOf", "not", "if-then-else", "dependentSchemas",
  "ref", "defs", "boolean_schema",
  "unevaluatedProperties", "unevaluatedItems",
];

// 2020-12 keywords with assertion/applicator semantics not implemented in the
// prototype. Anything else unknown is (correctly) treated as an annotation.
const UNSUPPORTED = new Set([
  "$dynamicRef", "$dynamicAnchor", "$recursiveRef", "$recursiveAnchor",
  "multipleOf", "uniqueItems", "minContains", "maxContains",
  "dependentRequired", "propertyNames",
]);

const SINGLE = new Set([
  "additionalProperties", "contains", "items", "not", "if", "then", "else",
  "propertyNames", "unevaluatedItems", "unevaluatedProperties",
]);
const ARRAY = new Set(["allOf", "anyOf", "oneOf", "prefixItems"]);
const MAP = new Set(["$defs", "definitions", "properties", "patternProperties", "dependentSchemas"]);

// Find unsupported keywords, looking only in schema positions.
function unsupportedIn(schema: JsonValue, found = new Set<string>()): Set<string> {
  if (!isObject(schema)) return found;
  for (const [k, v] of Object.entries(schema)) {
    if (UNSUPPORTED.has(k)) found.add(k);
    if (SINGLE.has(k)) unsupportedIn(v!, found);
    else if (ARRAY.has(k) && Array.isArray(v)) v.forEach((s) => unsupportedIn(s!, found));
    else if (MAP.has(k) && isObject(v)) Object.values(v).forEach((s) => unsupportedIn(s!, found));
  }
  return found;
}

interface SuiteCase { description: string; data: JsonValue; valid: boolean }
interface SuiteGroup { description: string; schema: JsonValue; tests: SuiteCase[] }

const skips: string[] = [];
let run = 0;

for (const file of FILES) {
  const groups = JSON.parse(readFileSync(join(SUITE, `${file}.json`), "utf8")) as SuiteGroup[];

  describe(file, () => {
    for (const group of groups) {
      const unsupported = unsupportedIn(group.schema);
      if (unsupported.size > 0) {
        skips.push(`${file}: ${group.description} [uses ${[...unsupported].join(", ")}]`);
        it.skip(`${group.description} [uses ${[...unsupported].join(", ")}]`, () => {});
        continue;
      }

      describe(group.description, () => {
        for (const test of group.tests) {
          it(test.description, () => {
            const registry = new Registry();
            const uri = registry.register(group.schema, "https://suite.example/schema");
            let result;
            try {
              result = evaluate(registry, uri, test.data);
            } catch (e) {
              if (e instanceof UnresolvableRefError) {
                skips.push(`${file}: ${group.description} / ${test.description} [${e.message}]`);
                return; // remote/unregistered resource: out of prototype scope
              }
              throw e;
            }
            run++;
            expect(result.valid, `expected valid=${test.valid}`).toBe(test.valid);
          });
        }
      });
    }
  });
}

describe("suite summary", () => {
  it("reports coverage", () => {
    console.log(`\nsuite cases run: ${run}, group/case skips: ${skips.length}`);
    for (const s of skips) console.log(`  SKIP ${s}`);
    expect(run).toBeGreaterThan(300);
  });
});
