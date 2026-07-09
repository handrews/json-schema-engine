// Mutation trio ≡ AJV oracle: each captured case runs through the compat
// class with the same options; verdict, post-validation data, and error
// objects must match test/fixtures/ajv-mutation.json (AJV executed by
// capture-mutation.ts, never read — D15).

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { JsonValue } from "@jse/core";
import {
  Ajv,
  Ajv2020,
  MutationNonConvergenceError,
  type Options,
} from "../src/index.js";
import { isPlainData } from "../src/mutate.js";

interface FixtureCase {
  dialect: "draft-07" | "2020-12";
  options: Record<string, unknown>;
  schema: JsonValue;
  data: JsonValue;
  valid: boolean;
  dataAfter: JsonValue;
  errors: Record<string, unknown>[] | null;
  secondInsertSeesMutation?: boolean;
  compileError?: string;
}

const FIXTURE = JSON.parse(
  readFileSync(
    join(
      dirname(fileURLToPath(import.meta.url)),
      "fixtures",
      "ajv-mutation.json",
    ),
    "utf8",
  ),
) as Record<string, FixtureCase>;

// The identity case's dataAfter was intentionally polluted by the capture
// probe; it gets its own test below.
const SPECIAL = new Set(["defaults-object-value-identity"]);

// Documented divergences (COMPAT.md "Known divergences"): the fixture pins
// AJV's value, this map pins OURS, so movement on either side is loud.
// Coercion in combiners has no backtracking in AJV and cascades across
// branches (true -> 1 -> "1"); the fixpoint settles on the first failing
// branch's coercion, which is schema-valid.
const DIVERGENT_DATA_AFTER: Record<string, JsonValue> = {
  "coerce-competing-anyof-number-first": { v: 1 },
};

describe("mutation trio ≡ AJV oracle", () => {
  for (const [name, c] of Object.entries(FIXTURE)) {
    if (SPECIAL.has(name) || c.compileError !== undefined) continue;
    it(name, () => {
      const ajv =
        c.dialect === "draft-07"
          ? new Ajv({ ...(c.options as Options), logger: false })
          : new Ajv2020({ ...(c.options as Options), logger: false });
      const validate = ajv.compile(c.schema);
      const working = JSON.parse(JSON.stringify(c.data)) as JsonValue;
      const valid = validate(working);
      expect(valid, "verdict").toBe(c.valid);
      // Top-level scalars cannot be mutated in place (no parent) — AJV's
      // caller sees the original there too; the fixture captured exactly
      // that, so the comparison holds for both shapes.
      expect(working, "post-validation data").toEqual(
        DIVERGENT_DATA_AFTER[name] ?? c.dataAfter,
      );
      expect(validate.errors).toEqual(c.valid ? null : c.errors);
    });
  }

  it("inserted defaults are copies, not shared references", () => {
    const c = FIXTURE["defaults-object-value-identity"]!;
    const ajv = new Ajv2020({ ...(c.options as Options), logger: false });
    const validate = ajv.compile(c.schema);
    const first: Record<string, JsonValue> = {};
    const second: Record<string, JsonValue> = {};
    expect(validate(first)).toBe(true);
    expect(validate(second)).toBe(true);
    (first.o as { seed: JsonValue[] }).seed.push("polluted");
    expect((second.o as { seed: JsonValue[] }).seed).toEqual([]);
  });

  it("mutations do not run when the trio is off", () => {
    const ajv = new Ajv2020();
    const validate = ajv.compile({
      type: "object",
      properties: { n: { type: "number" }, d: { default: 1 } },
    });
    const data = { n: "1" } as JsonValue;
    expect(validate(data)).toBe(false);
    expect(data).toEqual({ n: "1" });
  });
});

describe("mutation hardening (M8.6c)", () => {
  it("oscillating coercions throw MutationNonConvergenceError", () => {
    // allOf branches that coerce the same value to different types rewrite
    // each other forever; AJV's inline no-backtrack pass happens to settle
    // (COMPAT.md), the fixpoint refuses to pick an arbitrary state.
    const ajv = new Ajv2020({ coerceTypes: true, logger: false });
    const fn = ajv.compile({
      type: "object",
      allOf: [
        { properties: { a: { type: "string" } } },
        { properties: { a: { type: "number" } } },
      ],
    });
    expect(() => fn({ a: 1 })).toThrow(MutationNonConvergenceError);
  });

  it("non-plain data on a mutating validator: interpreter verdict, no mutation", () => {
    const ajv = new Ajv2020({ coerceTypes: true, useDefaults: true });
    const fn = ajv.compile({
      type: "object",
      properties: { n: { type: "number" }, d: { default: 7 } },
    });
    class Payload {
      n = "1";
    }
    const inst = new Payload();
    expect(fn(inst as unknown as JsonValue)).toBe(false);
    expect(inst.n).toBe("1");
    expect((inst as unknown as Record<string, JsonValue>).d).toBeUndefined();
    expect(fn.errors![0]!.keyword).toBe("type");
    // The plain twin coerces and gets its default.
    const plain: Record<string, JsonValue> = { n: "1" };
    expect(fn(plain)).toBe(true);
    expect(plain).toEqual({ n: 1, d: 7 });
  });

  it("isPlainData accepts JSON shapes and rejects everything else", () => {
    expect(isPlainData({ a: [1, "x", null, { b: true }] })).toBe(true);
    expect(isPlainData(Object.create(null) as JsonValue)).toBe(true);
    // fastify's query objects: an empty carrier prototype over null adds
    // no behavior and must stay mutable (the fastify PoC depends on it).
    const query = Object.create(Object.create(null) as object) as Record<
      string,
      JsonValue
    >;
    query.page = "3";
    expect(isPlainData(query)).toBe(true);
    expect(isPlainData(new Date() as unknown as JsonValue)).toBe(false);
    expect(isPlainData(new Map() as unknown as JsonValue)).toBe(false);
    expect(isPlainData({ a: { b: new Date() } } as unknown as JsonValue)).toBe(
      false,
    );
  });
});
