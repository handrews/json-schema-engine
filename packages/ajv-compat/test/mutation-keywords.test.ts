// ajv-keywords transform/dynamicDefaults ≡ AJV oracle: every case in
// fixtures/ajv-keywords-mutation.json (ajv@8 + ajv-keywords@5.1.0 executed
// by capture-ajv-keywords-mutation.ts, never read — D15) runs through the
// compat class. Exact-dataAfter cases assert data + verdict + errors;
// non-deterministic generators assert `dataAfterShape` membership;
// compileError cases assert the eager throw; combiner cases are consumed as
// KNOWN DIVERGENCES (see DIVERGENT below) — the fixture holds AJV's real
// value, this test holds jse's documented non-mutating-in-combiner value, so
// movement on either side is loud.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { JsonValue } from "@jse/core";
import { Ajv2020, type Options } from "../src/index.js";
import ajvKeywords from "../src/ajv-keywords.js";

interface NumberShape {
  kind: "number";
  integer?: boolean;
  min?: number;
  max?: number;
  exclusiveMax?: boolean;
  oneOf?: number[];
}
interface StringShape {
  kind: "string";
  pattern: string;
}
type Shape = NumberShape | StringShape;

interface FixtureCase {
  keywords: string | string[];
  options: Record<string, unknown>;
  schema?: JsonValue;
  data?: JsonValue;
  valid?: boolean;
  dataAfter?: JsonValue;
  errors?: Record<string, unknown>[] | null;
  compileError?: string;
  dataAfterShape?: Record<string, Shape>;
  values?: { input: JsonValue; output: JsonValue; valid: boolean }[];
  firstCall?: { data: JsonValue; valid: boolean; dataAfter: JsonValue };
  secondCall?: { data: JsonValue; valid: boolean; dataAfter: JsonValue };
  generatorNotInvokedProbe?: {
    schema: JsonValue;
    data: JsonValue;
    valid: boolean;
    dataAfter: JsonValue;
  };
  propertiesDeclaredFirst?: {
    schema: JsonValue;
    data: JsonValue;
    valid: boolean;
    dataAfter: JsonValue;
  };
  dynamicDefaultsDeclaredFirst?: {
    schema: JsonValue;
    data: JsonValue;
    valid: boolean;
    dataAfter: JsonValue;
  };
  seqNeverInvokedProbe?: {
    schema: JsonValue;
    data: JsonValue;
    dataAfter: JsonValue;
  };
}

const FIXTURE = JSON.parse(
  readFileSync(
    join(
      dirname(fileURLToPath(import.meta.url)),
      "fixtures",
      "ajv-keywords-mutation.json",
    ),
    "utf8",
  ),
) as Record<string, FixtureCase>;

// KNOWN DIVERGENCES (COMPAT.md): the fixture holds AJV's real value; this map
// holds jse's documented one (`dataAfter` omitted ⇒ jse leaves the input
// `data` unchanged), so movement on either side is loud.
//
// Combiner cases: transform never fires inside an anyOf/oneOf branch, so the
// branch-scoped `v` is left un-transformed. For the anyOf/oneOf cases the
// verdict is unaffected (branch selection keys off `kind`/type, which
// transform never touches), so jse agrees with AJV's verdict but leaves the
// data unchanged. The two interleaving cases are VERDICT divergences too:
// AJV's first branch uppercases `v` in place and its sibling branch then
// matches the mutated value; jse's fixpoint sees only the original lowercase
// `v`, both branches fail their `pattern`, and the anyOf is rejected — jse
// rejects what AJV accepts.
//
// Non-combiner ordering case: the composite toEnumCase∘trim is NOT idempotent
// (trim strips whitespace that then lets toEnumCase match the enum), so jse's
// evaluate→mutate→re-evaluate fixpoint applies it twice and converges on "pH"
// (valid), where AJV applies it once inline and stops at "ph" (invalid).
// Matching AJV would require a single-shot pass that re-mutates on every
// re-validation, breaking the idempotence property leg; jse's fixpoint
// convergence is what keeps that leg sound.
const DIVERGENT: Record<string, { valid: boolean; dataAfter?: JsonValue }> = {
  "transform-anyOf-branch0-passes-allErrors-false": { valid: true },
  "transform-anyOf-branch0-passes-allErrors-true": { valid: true },
  "transform-anyOf-branch0-fails-branch1-passes": { valid: true },
  "transform-anyOf-both-branches-fail": { valid: false },
  "transform-oneOf-branch0-passes-kind-before-v": { valid: true },
  "transform-oneOf-branch0-passes-v-before-kind": { valid: true },
  "transform-oneOf-branch0-fails-branch1-passes": { valid: true },
  "transform-oneOf-both-branches-fail": { valid: false },
  "transform-interleaving-failed-branch-mutation-enables-later-branch": {
    valid: false,
  },
  "transform-interleaving-allErrors-true": { valid: false },
  "transform-op-order-toEnumCase-trim-sensitive-toEnumCase-first": {
    valid: true,
    dataAfter: { v: "pH" },
  },
};

const makeAjv = (
  keywords: string | string[],
  options: Record<string, unknown>,
): Ajv2020 => {
  const ajv = new Ajv2020({ ...(options as Options), logger: false });
  const names = Array.isArray(keywords) ? keywords : [keywords];
  for (const name of names) ajvKeywords(ajv, name);
  return ajv;
};

const clone = (v: JsonValue): JsonValue =>
  JSON.parse(JSON.stringify(v)) as JsonValue;

const checkShape = (label: string, value: JsonValue, shape: Shape): void => {
  if (shape.kind === "number") {
    expect(typeof value, `${label} typeof`).toBe("number");
    const n = value as number;
    if (shape.integer)
      expect(Number.isInteger(n), `${label} integer`).toBe(true);
    if (shape.oneOf) expect(shape.oneOf, `${label} oneOf`).toContain(n);
    if (shape.min !== undefined)
      expect(n, `${label} min`).toBeGreaterThanOrEqual(shape.min);
    if (shape.max !== undefined) {
      if (shape.exclusiveMax) expect(n, `${label} max`).toBeLessThan(shape.max);
      else expect(n, `${label} max`).toBeLessThanOrEqual(shape.max);
    }
  } else {
    expect(typeof value, `${label} typeof`).toBe("string");
    expect(
      new RegExp(shape.pattern).test(value as string),
      `${label} pattern`,
    ).toBe(true);
  }
};

// A single "compile then validate a deep copy" run.
const runCase = (
  c: FixtureCase,
  schema: JsonValue,
  data: JsonValue,
): { valid: boolean; data: JsonValue; errors: unknown } => {
  const ajv = makeAjv(c.keywords, c.options);
  const fn = ajv.compile(schema);
  const working = clone(data);
  const valid = fn(working);
  return { valid, data: working, errors: fn.errors };
};

describe("ajv-keywords transform/dynamicDefaults ≡ AJV oracle", () => {
  for (const [name, c] of Object.entries(FIXTURE)) {
    it(name, () => {
      // Compile-time throws (AJV throws before any data is seen).
      if (c.compileError !== undefined) {
        const ajv = makeAjv(c.keywords, c.options);
        let thrown: Error | undefined;
        try {
          ajv.compile(c.schema!);
        } catch (err) {
          thrown = err as Error;
        }
        expect(thrown, "expected a compile-time throw").toBeDefined();
        expect(`Error: ${thrown!.message}`).toBe(c.compileError);
        return;
      }

      // toEnumCase multi-input probe (mirrors the format probes).
      if (c.values !== undefined) {
        const ajv = makeAjv(c.keywords, c.options);
        const fn = ajv.compile(c.schema!);
        for (const { input, output, valid } of c.values) {
          const working = { v: clone(input) } as JsonValue;
          expect(fn(working), JSON.stringify(input)).toBe(valid);
          expect((working as Record<string, JsonValue>).v).toEqual(output);
        }
        return;
      }

      // seq counter: jse's own module-global counter, first two ticks are
      // 0 then 1 (the fixture's name is used nowhere else in this process).
      if (c.firstCall !== undefined) {
        const ajv = makeAjv(c.keywords, c.options);
        const fn = ajv.compile(c.schema!);
        const one = clone(c.firstCall.data);
        expect(fn(one)).toBe(c.firstCall.valid);
        expect(one).toEqual(c.firstCall.dataAfter);
        const two = clone(c.secondCall!.data);
        expect(fn(two)).toBe(c.secondCall!.valid);
        expect(two).toEqual(c.secondCall!.dataAfter);
        return;
      }

      // absent-only: a present property is untouched AND the generator is
      // never ticked (the fresh probe on the same name reads 0).
      if (c.generatorNotInvokedProbe !== undefined) {
        const main = runCase(c, c.schema!, c.data!);
        expect(main.valid).toBe(c.valid);
        expect(main.data).toEqual(c.dataAfter);
        const p = c.generatorNotInvokedProbe;
        const probe = runCase(c, p.schema, p.data);
        expect(probe.valid).toBe(p.valid);
        expect(probe.data).toEqual(p.dataAfter);
        return;
      }

      // default vs dynamicDefault collision: plain `default` wins in both
      // key orders, and the seq generator is never ticked (proved by the
      // fresh probe on the same name reading 0). Run in fixture order so the
      // probe's read of an un-ticked counter holds.
      if (c.propertiesDeclaredFirst !== undefined) {
        const a = runCase(
          c,
          c.propertiesDeclaredFirst.schema,
          c.propertiesDeclaredFirst.data,
        );
        expect(a.valid).toBe(c.propertiesDeclaredFirst.valid);
        expect(a.data).toEqual(c.propertiesDeclaredFirst.dataAfter);
        const b = runCase(
          c,
          c.dynamicDefaultsDeclaredFirst!.schema,
          c.dynamicDefaultsDeclaredFirst!.data,
        );
        expect(b.valid).toBe(c.dynamicDefaultsDeclaredFirst!.valid);
        expect(b.data).toEqual(c.dynamicDefaultsDeclaredFirst!.dataAfter);
        const probe = runCase(
          c,
          c.seqNeverInvokedProbe!.schema,
          c.seqNeverInvokedProbe!.data,
        );
        expect(probe.data).toEqual(c.seqNeverInvokedProbe!.dataAfter);
        return;
      }

      // Non-deterministic generators: assert per-property shape membership.
      if (c.dataAfterShape !== undefined) {
        const result = runCase(c, c.schema!, c.data!);
        expect(result.valid).toBe(c.valid);
        const out = result.data as Record<string, JsonValue>;
        for (const [prop, shape] of Object.entries(c.dataAfterShape)) {
          checkShape(prop, out[prop]!, shape);
        }
        return;
      }

      // Known divergences: assert jse's DOCUMENTED behavior.
      if (name in DIVERGENT) {
        const d = DIVERGENT[name]!;
        const result = runCase(c, c.schema!, c.data!);
        expect(result.valid, "jse documented verdict").toBe(d.valid);
        expect(result.data, "jse documented data").toEqual(
          d.dataAfter ?? c.data,
        );
        return;
      }

      // Exact case: verdict + post-validation data + error objects.
      const result = runCase(c, c.schema!, c.data!);
      expect(result.valid, "verdict").toBe(c.valid);
      expect(result.data, "post-validation data").toEqual(c.dataAfter);
      expect(result.errors).toEqual(c.valid ? null : c.errors);
    });
  }
});
