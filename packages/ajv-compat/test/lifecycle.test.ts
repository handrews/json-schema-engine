// Engine/artifact lifecycle (M8.6b): scenario observations must equal the
// executed-AJV capture (fixtures/ajv-lifecycle.json), and anonymous
// compile() must never grow instance-lifetime state — the leak class a
// compile-in-a-loop service would hit.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Ajv2020 } from "../src/index.js";
import { SCENARIOS, type AjvLikeCtor } from "./oracle/lifecycle-scenarios.js";

const FIXTURE = JSON.parse(
  readFileSync(
    join(
      dirname(fileURLToPath(import.meta.url)),
      "fixtures",
      "ajv-lifecycle.json",
    ),
    "utf8",
  ),
) as Record<string, unknown>;

describe("lifecycle ≡ AJV oracle", () => {
  for (const [name, run] of Object.entries(SCENARIOS)) {
    it(name, () => {
      expect(run(Ajv2020 as unknown as AjvLikeCtor)).toEqual(FIXTURE[name]);
    });
  }
});

describe("anonymous compile() footprint", () => {
  it("compiling many distinct anonymous schemas grows no shared state", () => {
    const N = 1000;
    const ajv = new Ajv2020();
    // Mix in one keyed schema so the shared engine exists and is exercised.
    ajv.addSchema({ $id: "https://footprint.example/keyed", type: "string" });
    for (let i = 0; i < N; i++) {
      const fn = ajv.compile({
        type: "object",
        properties: { [`p${i}`]: { type: "integer" } },
      });
      expect(fn({ [`p${i}`]: 1 })).toBe(true);
    }
    // The shared engine never learns any anonymous registration.
    const shared = ajv.sharedEngine;
    expect(shared).not.toBeNull();
    for (let i = 0; i < 2 * N; i++) {
      expect(
        shared!.registry.document(`urn:ajv-compat:anonymous:${i}`),
      ).toBeUndefined();
    }
    // Keyed compilation still works against the shared engine.
    expect(ajv.getSchema("https://footprint.example/keyed")!("ok")).toBe(true);
  });
});
