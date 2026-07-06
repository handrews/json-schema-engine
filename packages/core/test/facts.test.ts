// StaticFacts v2 (M6.1/D9a): coverage, application-edge, and production
// facts on the exemplar keywords, including the sibling-context cases that
// motivated AnalyzeContext. These are the compiler tier's licensing inputs;
// a regression here silently degrades lowering, so the shapes are pinned.

import { describe, it, expect } from "vitest";
import {
  properties,
  patternProperties,
  additionalProperties,
  prefixItems,
  items,
  contains,
  ifKeyword,
  anyOf,
  allOf,
  dependentSchemas,
} from "../src/keywords/applicator.js";
import {
  unevaluatedProperties,
  unevaluatedItems,
} from "../src/keywords/unevaluated.js";
import { $ref, annotationOnly, structural } from "../src/keywords/core.js";
import type { JsonValue } from "../src/json.js";

const facts = (
  behavior: { analyze?: (v: JsonValue, c?: { schema: never }) => unknown },
  value: JsonValue,
  schema?: Record<string, JsonValue>,
) =>
  behavior.analyze!(
    value,
    (schema ? { schema } : undefined) as { schema: never } | undefined,
  );

describe("StaticFacts v2 exemplars (M6.1)", () => {
  it("properties: names coverage, childByKey applications, produces", () => {
    expect(facts(properties, { a: true, b: true })).toEqual({
      subschemas: [["a"], ["b"]],
      produces: [properties.id],
      evaluatesNames: { kind: "names", names: ["a", "b"] },
      applications: [
        { path: ["a"], mode: "childByKey", conditional: false, asserts: true },
        { path: ["b"], mode: "childByKey", conditional: false, asserts: true },
      ],
    });
  });

  it("patternProperties: patterns coverage plus regex declarations", () => {
    const f = facts(patternProperties, { "^x": true }) as {
      regexes: string[];
      evaluatesNames: unknown;
    };
    expect(f.regexes).toEqual(["^x"]);
    expect(f.evaluatesNames).toEqual({ kind: "patterns", patterns: ["^x"] });
  });

  it("additionalProperties: covers all names (sibling trio completion)", () => {
    const f = facts(additionalProperties, true) as {
      evaluatesNames: unknown;
      applications: unknown;
    };
    expect(f.evaluatesNames).toEqual({ kind: "all" });
    expect(f.applications).toEqual([
      { path: [], mode: "childSweep", conditional: false, asserts: true },
    ]);
  });

  it("items reads sibling prefixItems for its coverage start", () => {
    const withPrefix = facts(items, true, {
      prefixItems: [true, true, true],
      items: true,
    }) as { evaluatesIndexes: unknown };
    expect(withPrefix.evaluatesIndexes).toEqual({ kind: "allFrom", start: 3 });

    const alone = facts(items, true, { items: true }) as {
      evaluatesIndexes: unknown;
    };
    expect(alone.evaluatesIndexes).toEqual({ kind: "allFrom", start: 0 });
  });

  it("prefixItems: prefix coverage with its static count", () => {
    const f = facts(prefixItems, [true, true]) as {
      evaluatesIndexes: unknown;
    };
    expect(f.evaluatesIndexes).toEqual({ kind: "prefix", count: 2 });
  });

  it("contains: dynamic index coverage, non-asserting per-item probes", () => {
    const f = facts(contains, true) as {
      evaluatesIndexes: unknown;
      applications: { asserts: boolean }[];
    };
    expect(f.evaluatesIndexes).toEqual({ kind: "dynamic" });
    expect(f.applications[0]?.asserts).toBe(false);
  });

  it("if declares sibling then/else applications only when present", () => {
    const bare = facts(ifKeyword, true, { if: true }) as {
      applications: { sibling?: string }[];
    };
    expect(bare.applications).toHaveLength(1);
    expect(bare.applications[0]?.sibling).toBeUndefined();

    const full = facts(ifKeyword, true, {
      if: true,
      then: true,
      else: true,
    }) as { applications: { sibling?: string; conditional: boolean }[] };
    expect(full.applications.map((a) => a.sibling)).toEqual([
      undefined,
      "then",
      "else",
    ]);
    expect(full.applications[1]?.conditional).toBe(true);
  });

  it("anyOf alternatives are conditional; allOf conjuncts are not", () => {
    const any = facts(anyOf, [true, true]) as {
      applications: { conditional: boolean }[];
    };
    expect(any.applications.every((a) => a.conditional)).toBe(true);
    const all = facts(allOf, [true, true]) as {
      applications: { conditional: boolean }[];
    };
    expect(all.applications.every((a) => !a.conditional)).toBe(true);
  });

  it("dependentSchemas applications are presence-conditional", () => {
    const f = facts(dependentSchemas, { trigger: true }) as {
      applications: { path: unknown; conditional: boolean }[];
    };
    expect(f.applications).toEqual([
      { path: ["trigger"], mode: "inPlace", conditional: true, asserts: true },
    ]);
  });

  it("$ref declares an unconditional in-place application", () => {
    const f = facts($ref, "#/$defs/x") as {
      applications: unknown;
      references: unknown;
    };
    expect(f.references).toEqual(["#/$defs/x"]);
    expect(f.applications).toEqual([
      { path: [], mode: "inPlace", conditional: false, asserts: true },
    ]);
  });

  it("unevaluated* declare produces, full coverage, and keep consumes", () => {
    const up = facts(unevaluatedProperties, true) as {
      produces: string[];
      consumes: string[];
      evaluatesNames: unknown;
    };
    expect(up.produces).toEqual([unevaluatedProperties.id]);
    expect(up.consumes).toContain(properties.id);
    expect(up.evaluatesNames).toEqual({ kind: "all" });

    const ui = facts(unevaluatedItems, true) as { evaluatesIndexes: unknown };
    expect(ui.evaluatesIndexes).toEqual({ kind: "all" });
  });

  it("factories: structural produces nothing, annotationOnly its own id", () => {
    const s = facts(structural("urn:test#s"), "x") as { produces: string[] };
    expect(s.produces).toEqual([]);
    const a = facts(annotationOnly("urn:test#a"), "x") as {
      produces: string[];
    };
    expect(a.produces).toEqual(["urn:test#a"]);
  });
});
