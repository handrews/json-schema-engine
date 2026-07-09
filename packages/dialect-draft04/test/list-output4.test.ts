// Compiled list output ≡ interpreter for the draft-04 suite directory
// (M6.6), mirroring @jse/compiler's list-output-legacy.test.ts pattern for
// the other legacy dialects. Now that draft-04's own minimum/maximum carry
// lower(), every unit in this package's vocabulary compiles, so this leg is
// the exactness referee for Task 1: message text, keyword, params, and
// field order all matter (the M8.1 exactness contract). Uses the suite's
// remotes loader (unlike suite4.test.ts's registerAndEvaluate helper) so
// refRemote.json's cases run instead of being caught and skipped.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createEngine, type JsonValue } from "@jse/core";
import { compileList } from "@jse/compiler";
import { suiteRemotesLoader } from "@jse/test-kit";
import { registerDraft04, DIALECT_DRAFT_04 } from "../src/index.js";

const SUITE_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "test-suite",
);
const SUITE_DIR = join(SUITE_ROOT, "tests", "draft4");
const REMOTES_DIR = join(SUITE_ROOT, "remotes");

interface SuiteGroup {
  description: string;
  schema: JsonValue;
  tests: { description: string; data: JsonValue }[];
}

const draft04Engine = () => {
  const engine = createEngine({
    defaultDialect: DIALECT_DRAFT_04,
    loaders: [suiteRemotesLoader(REMOTES_DIR)],
  });
  registerDraft04(engine);
  return engine;
};

const runSuite = async (errorParams: boolean): Promise<number> => {
  let cases = 0;
  for (const file of readdirSync(SUITE_DIR).filter((f) =>
    f.endsWith(".json"),
  )) {
    const groups = JSON.parse(
      readFileSync(join(SUITE_DIR, file), "utf8"),
    ) as SuiteGroup[];
    for (const [gi, group] of groups.entries()) {
      const engine = draft04Engine();
      const retrievalUri = `https://list-draft4.example/${file}/${String(gi)}`;
      let uri: string;
      try {
        uri = await engine.loadSchema(group.schema, retrievalUri);
      } catch {
        continue; // D19/registration-shape cases: suite4.test.ts's interpreter leg covers these
      }
      const artifact = compileList(engine, uri, { errorParams });
      for (const test of group.tests) {
        cases++;
        let interpreted: unknown, compiled: unknown;
        try {
          const r = engine.evaluate(uri, test.data, {
            output: "list",
            errorParams,
          });
          interpreted = { valid: r.valid, errors: r.errors ?? [] };
        } catch (err) {
          interpreted = (err as Error).constructor.name;
        }
        try {
          const r = artifact.evaluateList(test.data);
          compiled = { valid: r.valid, errors: r.valid ? [] : r.errors };
        } catch (err) {
          compiled = (err as Error).constructor.name;
        }
        expect(compiled, `${file}#${String(gi)} ${test.description}`).toEqual(
          interpreted,
        );
      }
    }
  }
  return cases;
};

describe("compiled list output ≡ interpreter (draft-04 suite, M6.6)", () => {
  it("agrees on every case, ordered", async () => {
    expect(await runSuite(false)).toBeGreaterThan(600);
  });

  it("agrees on every case with structured params (M8.1)", async () => {
    expect(await runSuite(true)).toBeGreaterThan(600);
  });
});
