// Compiled list output ≡ interpreter for the draft-07, draft-06, and
// 2019-09 suite directories (M6.6, the last one the stretch item): extends
// the draft2020-12 differential in list-output.test.ts to the legacy
// dialects whose dialect-specific keywords (vocab7.ts, vocab2019.ts's
// items/additionalItems/then/else/unevaluatedItems/unevaluatedProperties)
// just gained lower(). Same discipline: full deep-equal per case, ordered —
// message text, keyword, params, and field order all matter (the M8.1
// exactness contract). Uses the suite's remotes loader (unlike
// list-output.test.ts's synchronous registerSchema) so refRemote.json's
// cases run instead of being caught and skipped — all three dirs have it.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createEngine,
  DIALECT_2019_09,
  DIALECT_DRAFT_06,
  DIALECT_DRAFT_07,
  type JsonValue,
} from "@json-schema-engine/core";
import { compileList } from "@json-schema-engine/compiler";
import { suiteRemotesLoader } from "@json-schema-engine/test-kit";

const SUITE_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "test-suite",
);
const REMOTES_DIR = join(SUITE_ROOT, "remotes");

interface SuiteGroup {
  description: string;
  schema: JsonValue;
  tests: { description: string; data: JsonValue }[];
}

const runDialectSuite = async (
  suiteDir: string,
  defaultDialect: string,
  errorParams: boolean,
): Promise<number> => {
  let cases = 0;
  for (const file of readdirSync(suiteDir).filter((f) => f.endsWith(".json"))) {
    const groups = JSON.parse(
      readFileSync(join(suiteDir, file), "utf8"),
    ) as SuiteGroup[];
    for (const [gi, group] of groups.entries()) {
      const engine = createEngine({
        defaultDialect,
        loaders: [suiteRemotesLoader(REMOTES_DIR)],
      });
      const retrievalUri = `https://list-legacy.example/${file}/${String(gi)}`;
      let uri: string;
      try {
        uri = await engine.loadSchema(group.schema, retrievalUri);
      } catch {
        continue; // D19/registration-shape cases: the interpreter suite leg covers these
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

describe("compiled list output ≡ interpreter (draft-07 suite, M6.6)", () => {
  const dir = join(SUITE_ROOT, "tests", "draft7");

  it("agrees on every case, ordered", async () => {
    expect(await runDialectSuite(dir, DIALECT_DRAFT_07, false)).toBeGreaterThan(
      900,
    );
  });

  it("agrees on every case with structured params (M8.1)", async () => {
    expect(await runDialectSuite(dir, DIALECT_DRAFT_07, true)).toBeGreaterThan(
      900,
    );
  });
});

describe("compiled list output ≡ interpreter (draft-06 suite, M6.6)", () => {
  const dir = join(SUITE_ROOT, "tests", "draft6");

  it("agrees on every case, ordered", async () => {
    expect(await runDialectSuite(dir, DIALECT_DRAFT_06, false)).toBeGreaterThan(
      800,
    );
  });

  it("agrees on every case with structured params (M8.1)", async () => {
    expect(await runDialectSuite(dir, DIALECT_DRAFT_06, true)).toBeGreaterThan(
      800,
    );
  });
});

describe("compiled list output ≡ interpreter (2019-09 suite, M6.6 stretch)", () => {
  const dir = join(SUITE_ROOT, "tests", "draft2019-09");

  it("agrees on every case, ordered", async () => {
    expect(await runDialectSuite(dir, DIALECT_2019_09, false)).toBeGreaterThan(
      1200,
    );
  });

  it("agrees on every case with structured params (M8.1)", async () => {
    expect(await runDialectSuite(dir, DIALECT_2019_09, true)).toBeGreaterThan(
      1200,
    );
  });
});
