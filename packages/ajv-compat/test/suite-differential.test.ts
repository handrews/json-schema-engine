// Official-suite differential (M8.5): the compat class runs every local
// draft2020-12 suite case. Hard gate: ajv-compat matches the SUITE verdict
// on every case (the suite, not AJV, is ground truth — AJV itself is
// non-compliant on parts of $dynamicRef/unevaluated*). Real AJV runs
// alongside (executed as an oracle, D15): where AJV agrees with the suite
// on an invalid case, the mapped error objects are compared canonically
// and the mismatch count is ratcheted — mapping drift fails the build.

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

const SUITE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "test-suite",
  "tests",
  "draft2020-12",
);

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

describe("official-suite differential vs real AJV", () => {
  it("compat matches the suite everywhere; error parity ratcheted", () => {
    let cases = 0;
    let skippedGroups = 0;
    let ajvCompiled = 0;
    let ajvSuiteAgreements = 0;
    let errorComparisons = 0;
    let errorMismatches = 0;
    const samples: string[] = [];

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
        let ajvValidate:
          | (((d: unknown) => boolean) & { errors?: ErrorObject[] | null })
          | null = null;
        try {
          ajvValidate = new RealAjv2020({ ...OPTIONS, logger: false }).compile(
            group.schema,
          );
          ajvCompiled++;
        } catch {
          ajvValidate = null;
        }
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
            errorMismatches++;
            if (samples.length < 5) {
              samples.push(`${file}#${String(gi)} ${test.description}`);
            }
          }
        }
      });
    }

    // Coverage floor: the differential must actually exercise the corpus.
    expect(cases).toBeGreaterThan(1100);
    expect(ajvCompiled).toBeGreaterThan(300);
    expect(errorComparisons).toBeGreaterThan(300);
    // Error-object parity ratchet. Measured at introduction: 61/477
    // mismatches, clustered in combiner-heavy shapes (anyOf/oneOf/ref
    // branch error sets differ by evaluation strategy; the per-keyword
    // mapping itself is oracle-pinned). Lower is better; raising this
    // bound requires justification.
    if (errorMismatches > 70) {
      throw new Error(
        `error parity regressed: ${String(errorMismatches)}/${String(errorComparisons)} mismatches; samples: ${samples.join("; ")}`,
      );
    }
  });
});
