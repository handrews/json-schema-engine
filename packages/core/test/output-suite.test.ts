// Official output-tests conformance (test-suite/output-tests, DESIGN.md M5):
// for each case, evaluate `data` against the group `schema`, render the
// Basic output document (2020-12 field names), and validate that document
// against the case's own output schema using @jse/core itself — "the
// rendered document self-validates" is the pass condition. Only "basic" is
// populated in the vendored suite as of this writing (output-tests/README);
// list/detailed/verbose cases would be counted and reported as loud skips
// rather than silently passed, though none occur in the vendored files.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runOutputTests } from "@jse/test-kit";
import { createEngine, JsonValue, DIALECT_2019_09 } from "@jse/core";

const SUITE_ROOT = join(dirname(fileURLToPath(import.meta.url)),
  "..", "..", "..", "test-suite", "output-tests");

const FILES = ["escape", "general", "readOnly", "type"];

type Draft = "draft2020-12" | "draft2019-09";

// Both output-schema documents declare an absolute $id (checked against the
// vendored files), so they register directly, the same way index.ts bundles
// the standard metaschemas — no loader indirection needed.
function outputSchemaDoc(draft: Draft): { $id: string; [k: string]: JsonValue } {
  return JSON.parse(readFileSync(
    join(SUITE_ROOT, draft, "output-schema.json"), "utf8")) as { $id: string; [k: string]: JsonValue };
}

const DRAFTS: { draft: Draft; defaultDialect?: string }[] = [
  { draft: "draft2020-12" },
  { draft: "draft2019-09", defaultDialect: DIALECT_2019_09 },
];

for (const { draft, defaultDialect } of DRAFTS) {
  describe(`output-tests: ${draft} (basic)`, () => {
    it("renders and self-validates every case", async () => {
      let skippedLoud = 0;
      const summary = await runOutputTests({
        contentDir: join(SUITE_ROOT, draft, "content"),
        files: FILES,
        supportedFormats: ["basic"],
        onSkip: (info) => {
          skippedLoud++;
          console.warn(`SKIP [${draft}] ${info.file}: ${info.group} / `
            + `${info.description}: ${info.reason}`);
        },
        // Basic is the 2020-12-named flat document (contract's "classic
        // Basic document" for locations: "2020-12"); rendered via the
        // engine's public "list" + "2020-12" combination (index.ts wiring).
        renderDocument: (schema, retrievalUri, data) => {
          const engine = createEngine({ defaultDialect });
          const uri = engine.registerSchema(schema, retrievalUri);
          const result = engine.evaluate(uri, data,
            { output: "list", locations: "2020-12" });
          return result.outputDocument as unknown as JsonValue;
        },
        // A fresh engine per case: the case's own output-validating schema
        // carries a fixed $id from the fixture, so reusing an engine across
        // cases would collide on repeated registration.
        validateDocument: (outputSchema, outputSchemaUri, document) => {
          const validatorEngine = createEngine();
          const meta = outputSchemaDoc(draft);
          validatorEngine.registerSchema(meta, meta.$id);
          const schemaId = (outputSchema as { $id?: string }).$id ?? outputSchemaUri;
          const uri = validatorEngine.registerSchema(outputSchema, schemaId);
          return validatorEngine.evaluate(uri, document).valid;
        },
      });

      console.log(`\noutput-tests [${draft}]: run ${summary.totalRun}, `
        + `skipped ${summary.totalSkipped}`);
      for (const c of summary.cases) {
        if (c.status === "failed") {
          console.warn(`FAIL [${draft}] ${c.file}: ${c.group} / ${c.description}: ${c.detail}`);
        }
      }
      expect(skippedLoud).toBe(summary.totalSkipped);
      expect(summary.cases.filter((c) => c.status === "failed")).toEqual([]);
      expect(summary.totalRun).toBeGreaterThan(0);
    });
  });
}
