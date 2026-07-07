// Mutation trio ≡ AJV oracle: each captured case runs through the compat
// class with the same options; verdict, post-validation data, and error
// objects must match test/fixtures/ajv-mutation.json (AJV executed by
// capture-mutation.ts, never read — D15).

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { JsonValue } from "@jse/core";
import { Ajv, Ajv2020, type Options } from "../src/index.js";

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
      expect(working, "post-validation data").toEqual(c.dataAfter);
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
