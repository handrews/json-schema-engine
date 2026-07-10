// Official-suite differential (M8.5): the compat class runs every local
// draft2020-12 suite case. Hard gate: ajv-compat matches the SUITE verdict
// on every case (the suite, not AJV, is ground truth — AJV itself is
// non-compliant on parts of $dynamicRef/unevaluated*). Real AJV runs
// alongside (executed as an oracle, D15): where AJV agrees with the suite
// on an invalid case, the mapped error objects are compared canonically
// and mismatches are pinned against a golden identity set — mapping drift
// (new mismatch appears, or an existing one silently disappears) fails
// the build visibly instead of just nudging a count.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020Import from "ajv/dist/2020.js";
import type { JsonValue } from "@jse/core";
import { Ajv2020, type ErrorObject } from "../src/index.js";

type RealAjvCtor = new (options?: Record<string, unknown>) => {
  compile(schema: unknown): ((data: unknown) => boolean) & {
    errors?: ErrorObject[] | null;
  };
};
const RealAjv2020 = ((Ajv2020Import as { default?: unknown }).default ??
  Ajv2020Import) as RealAjvCtor;

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
const GOLDEN_PATH = join(HERE, "fixtures", "suite-mismatch-golden.json");

interface SuiteGroup {
  description: string;
  schema: JsonValue;
  tests: { description: string; data: JsonValue; valid: boolean }[];
}

const OPTIONS = {
  strictSchema: false as const,
  validateFormats: false,
  allErrors: true,
};

const canonical = (errors: ErrorObject[] | null | undefined): string =>
  JSON.stringify(
    (errors ?? [])
      .map((e) => ({
        keyword: e.keyword,
        instancePath: e.instancePath,
        schemaPath: e.schemaPath,
        params: e.params,
        message: e.message,
      }))
      .sort((a, b) =>
        JSON.stringify(a) < JSON.stringify(b)
          ? -1
          : JSON.stringify(a) > JSON.stringify(b)
            ? 1
            : 0,
      ),
  );

// One test deliberately sweeps the full suite through two validator stacks;
// v8 coverage instrumentation on shared CI runners pushes it past vitest's
// 5s default. The explicit timeout is a hung-run ceiling, not a performance
// expectation — the bench gate owns performance.
const SWEEP_TIMEOUT_MS = 60_000;

describe("official-suite differential vs real AJV", () => {
  it(
    "compat matches the suite everywhere; error parity pinned to golden set",
    () => {
      let cases = 0;
      let skippedGroups = 0;
      let ajvCompiled = 0;
      let ajvSuiteAgreements = 0;
      let errorComparisons = 0;
      const mismatchIdentities: string[] = [];

      for (const file of readdirSync(SUITE_DIR).filter((f) =>
        f.endsWith(".json"),
      )) {
        const groups = JSON.parse(
          readFileSync(join(SUITE_DIR, file), "utf8"),
        ) as SuiteGroup[];
        groups.forEach((group, gi) => {
          let compatValidate: ((d: JsonValue) => boolean) & {
            errors: ErrorObject[] | null;
          };
          try {
            compatValidate = new Ajv2020({ ...OPTIONS, logger: false }).compile(
              group.schema,
            );
          } catch {
            skippedGroups++; // remote refs / registration errors: other legs cover
            return;
          }
          const ajvValidate:
            | (((d: unknown) => boolean) & {
                errors?: ErrorObject[] | null;
              })
            | null = (() => {
            try {
              const compiled = new RealAjv2020({
                ...OPTIONS,
                logger: false,
              }).compile(group.schema);
              ajvCompiled++;
              return compiled;
            } catch {
              return null;
            }
          })();
          for (const test of group.tests) {
            let ours: boolean;
            try {
              ours = compatValidate(test.data);
            } catch {
              skippedGroups++; // unresolvable ref reached at evaluation time
              return;
            }
            cases++;
            expect(ours, `${file}#${String(gi)} ${test.description}`).toBe(
              test.valid,
            );
            if (ajvValidate === null) continue;
            let theirs: boolean;
            try {
              theirs = ajvValidate(test.data);
            } catch {
              continue;
            }
            if (theirs !== test.valid) continue; // AJV non-compliance: ours wins
            ajvSuiteAgreements++;
            if (test.valid) continue;
            errorComparisons++;
            if (
              canonical(compatValidate.errors) !== canonical(ajvValidate.errors)
            ) {
              mismatchIdentities.push(
                `${file}#${String(gi)} ${test.description}`,
              );
            }
          }
        });
      }

      // Coverage floors/ceilings: the differential must actually exercise the
      // corpus, and silent growth in skipped groups would hide shrinking
      // coverage behind a green build.
      expect(cases).toBeGreaterThan(1100);
      expect(ajvCompiled).toBeGreaterThan(300);
      expect(errorComparisons).toBeGreaterThan(300);
      expect(skippedGroups).toBeLessThanOrEqual(30); // measured: 22
      expect(ajvSuiteAgreements).toBeGreaterThanOrEqual(1100); // measured: 1194

      // Error-object parity, pinned by identity rather than count. A count
      // ratchet lets one mismatch disappear while a different one appears
      // unnoticed; comparing the sorted identity set catches that swap. Any
      // divergence-class change — new mismatch or a previously-mismatching
      // case now matching — fails here. Regenerating this fixture requires
      // justification in the commit message.
      const golden = JSON.parse(readFileSync(GOLDEN_PATH, "utf8")) as string[];
      expect(mismatchIdentities.slice().sort()).toEqual(golden);
    },
    SWEEP_TIMEOUT_MS,
  );
});
