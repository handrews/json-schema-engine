// Mutation idempotence properties (M8.6c), on the seeded fuzz harness
// (test-kit Prng/instancePool — no fast-check, D15): for every suite-seeded
// schema × mutation-option combo × perturbed instance, one validate() call
// must reach a fixpoint — validating the already-mutated data again changes
// nothing and returns the same verdict — or throw the typed
// MutationNonConvergenceError deterministically. Everything replays from
// (SEED, file, group, instance) printed on failure.
//
// MUTATION_PROPERTY_BUDGET=<instances per group> scales the local run
// (default 2; CI runs the default deterministically).

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { jsonEqual, type JsonValue } from "@jse/core";
import { Prng, deriveSeed, instancePool } from "@jse/test-kit";
import {
  Ajv2020,
  MutationNonConvergenceError,
  type Options,
  type ValidateFunction,
} from "../src/index.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const SUITE_DIR = join(
  HERE,
  "..",
  "..",
  "..",
  "test-suite",
  "tests",
  "draft2020-12",
);

interface SuiteCase {
  description: string;
  data: JsonValue;
}
interface SuiteGroup {
  description: string;
  schema: JsonValue;
  tests: SuiteCase[];
}

const SEED = 0x9e3779b9;
const PER_GROUP = Number(process.env.MUTATION_PROPERTY_BUDGET ?? "2");

// Cycled per group so every combo hits a spread of schema shapes while the
// whole matrix stays deterministic under one seed.
const COMBOS: Options[] = [
  { coerceTypes: true },
  // fastify's default config
  { coerceTypes: "array", useDefaults: true, removeAdditional: true },
  { useDefaults: "empty", removeAdditional: "all" },
  { coerceTypes: true, useDefaults: true, removeAdditional: "failing" },
];

const clone = (v: JsonValue): JsonValue =>
  v === null || typeof v !== "object"
    ? v
    : (JSON.parse(JSON.stringify(v)) as JsonValue);

type Outcome =
  | { kind: "verdict"; valid: boolean; data: JsonValue }
  | { kind: "non-convergence" };

const runOnce = (fn: ValidateFunction, input: JsonValue): Outcome => {
  const holder = clone(input);
  try {
    return { kind: "verdict", valid: fn(holder), data: holder };
  } catch (err) {
    if (err instanceof MutationNonConvergenceError) {
      return { kind: "non-convergence" };
    }
    throw err;
  }
};

const files = readdirSync(SUITE_DIR)
  .filter((f) => f.endsWith(".json"))
  .sort();

let compiledGroups = 0;
let uncompilableGroups = 0;
let sequences = 0;
let nonConvergent = 0;

describe("mutation idempotence over the suite corpus", () => {
  files.forEach((file, fileIdx) => {
    it(file, () => {
      const groups = JSON.parse(
        readFileSync(join(SUITE_DIR, file), "utf8"),
      ) as SuiteGroup[];
      groups.forEach((group, groupIdx) => {
        const combo = COMBOS[(fileIdx + groupIdx) % COMBOS.length]!;
        const ajv = new Ajv2020({
          ...combo,
          strictSchema: false,
          validateSchema: false,
          logger: false,
          addUsedSchema: false,
        });
        let fn: ValidateFunction;
        try {
          fn = ajv.compile(group.schema);
        } catch {
          // Unregisterable here (e.g. remote $refs) — counted, floor below.
          uncompilableGroups++;
          return;
        }
        compiledGroups++;
        const prng = new Prng(deriveSeed(SEED, fileIdx, groupIdx));
        const pool = instancePool(
          prng,
          group.tests.map((t) => t.data),
          PER_GROUP,
        );
        pool.forEach((instance, instanceIdx) => {
          sequences++;
          const at = `${file} #${String(groupIdx)} "${group.description}" instance ${String(instanceIdx)} combo ${JSON.stringify(combo)} seed ${String(SEED)}`;
          const first = runOnce(fn, instance);
          if (first.kind === "non-convergence") {
            nonConvergent++;
            const again = runOnce(fn, instance);
            expect(again.kind, `deterministic non-convergence at ${at}`).toBe(
              "non-convergence",
            );
            return;
          }
          const second = runOnce(fn, first.data);
          expect(second.kind, `second run must not diverge at ${at}`).toBe(
            "verdict",
          );
          if (second.kind !== "verdict") return;
          expect(second.valid, `verdict stability at ${at}`).toBe(first.valid);
          expect(
            jsonEqual(second.data, first.data),
            `data idempotence at ${at}`,
          ).toBe(true);
        });
      });
    });
  });

  it("coverage floors", () => {
    // The corpus must stay meaningfully large; a loader or compile
    // regression that silently drops groups fails here, not silently.
    expect(compiledGroups).toBeGreaterThan(250);
    expect(sequences).toBeGreaterThanOrEqual(compiledGroups * PER_GROUP);
    expect(uncompilableGroups).toBeLessThan(120);
    // Non-convergence must stay exceptional or the idempotence property
    // above is vacuous.
    expect(nonConvergent).toBeLessThan(sequences * 0.02);
  });
});
