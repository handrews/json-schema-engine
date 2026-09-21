// Compiled units that reach an island thread the dynamic scope (D8) down to
// the trampoline. A unit copies the scope only when its resource is not
// already on top — resolution takes the outermost hit, so an adjacent
// duplicate can never change it. Parity with the interpreter on a schema
// whose same-resource units nest several deep above an island, in both
// scope shapes (root declares the anchor; an extension rebinds it).

import { describe, it, expect } from "vitest";
import { createEngine, type JsonValue } from "@json-schema-engine/core";
import {
  buildPlan,
  compileList,
  compileValidator,
} from "@json-schema-engine/compiler";

// The suite's "multiple dynamic paths" shape: from ROOT (which declares no
// anchor) the site inside BASE is reached both directly and through EXT,
// whose outermost declarer differs, so it cannot resolve statically and
// islands — under three levels of same-resource nesting. From EXT the same
// site is stable (ADR 0004) and compiles as a static edge.
const ROOT = "https://scope.example/root";
const BASE = "https://scope.example/base";
const EXT = "https://scope.example/ext";

const baseSchema = {
  $id: BASE,
  $defs: { item: { $dynamicAnchor: "item", type: "number" } },
  properties: {
    a: {
      properties: {
        b: {
          properties: {
            c: { items: { $dynamicRef: "#item" } },
          },
        },
      },
    },
  },
};
const extSchema = {
  $id: EXT,
  $defs: { item: { $dynamicAnchor: "item", type: "string" } },
  $ref: BASE,
};
const rootSchema = {
  $id: ROOT,
  properties: {
    viaBase: { $ref: BASE },
    viaExt: { $ref: EXT },
    deep: { properties: { x: { $ref: `${BASE}#/properties/a` } } },
  },
};

const INSTANCES: JsonValue[] = [
  { viaBase: { a: { b: { c: [1, 2] } } } },
  { viaBase: { a: { b: { c: ["x"] } } } },
  { viaExt: { a: { b: { c: ["x", "y"] } } } },
  { viaExt: { a: { b: { c: [1] } } } },
  { deep: { x: { b: { c: [1] } } } },
  { deep: { x: { b: { c: ["x"] } } } },
  { viaBase: { a: { b: { c: [1] } } }, viaExt: { a: { b: { c: ["x"] } } } },
  { viaBase: { a: { b: { c: ["x"] } } }, viaExt: { a: { b: { c: [1] } } } },
  { a: { b: { c: [1, 2] } } },
  { a: { b: { c: ["x"] } } },
];

function engineWithAll() {
  const engine = createEngine();
  engine.registerSchema(baseSchema, BASE);
  engine.registerSchema(extSchema, EXT);
  engine.registerSchema(rootSchema, ROOT);
  return engine;
}

describe("compiled dynamic-scope threading", () => {
  it("islands the unstable site and guards every scope copy on the top entry", () => {
    const engine = engineWithAll();
    const plan = buildPlan(engine, ROOT);
    expect(plan.targets.some((t) => t.cause === "dynamic")).toBe(true);
    const source = compileValidator(engine, ROOT).source;
    const pushes = source.match(/^s = .*$/gm) ?? [];
    expect(pushes.length).toBeGreaterThan(0);
    for (const line of pushes) {
      expect(line).toMatch(
        /^s = s\[s\.length - 1\] === ("[^"]+") \? s : \[\.\.\.s, \1\];$/,
      );
    }
  });

  for (const root of [ROOT, EXT, BASE]) {
    it(`agrees with the interpreter from ${root}`, () => {
      const engine = engineWithAll();
      const flag = compileValidator(engine, root);
      const list = compileList(engine, root, { errorParams: true });
      for (const instance of INSTANCES) {
        const expected = engine.evaluate(root, instance, {
          output: "list",
          errorParams: true,
        });
        expect(flag.validate(instance), JSON.stringify(instance)).toBe(
          expected.valid,
        );
        const got = list.evaluateList(instance);
        expect(got.valid, JSON.stringify(instance)).toBe(expected.valid);
        expect(got.errors, JSON.stringify(instance)).toEqual(
          expected.errors ?? [],
        );
      }
    });
  }
});
