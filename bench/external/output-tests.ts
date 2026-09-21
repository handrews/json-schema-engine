// Official output-tests (test-suite/output-tests, `basic` format) through
// jse and ata-validator's `toOutput`. json-schema-library has no standard
// output format to run them against. The pass condition is the one the
// suite defines: the produced document validates against the case's output
// schema (checked here with jse).
//
// Run: npm run compare:output

import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createEngine,
  DIALECT_2019_09,
  type JsonValue,
} from "@json-schema-engine/core";
import { Validator as AtaValidator } from "ata-validator";

const cjsRequire = createRequire(import.meta.url);
const { toOutput: ataToOutput } = cjsRequire("ata-validator") as {
  toOutput: (
    validator: AtaValidator,
    data: unknown,
    options: { format: "flag" | "basic" },
  ) => JsonValue;
};

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..", "test-suite", "output-tests");

interface OutputCase {
  description: string;
  data: JsonValue;
  output?: { basic?: Record<string, JsonValue> };
}
interface OutputGroup {
  description: string;
  schema: Record<string, JsonValue>;
  tests: OutputCase[];
}
interface Tally {
  pass: number;
  fail: number;
  error: number;
  skip: number;
}

let anyFailure = false;

for (const draft of ["draft2020-12", "draft2019-09"] as const) {
  const outputSchema = JSON.parse(
    readFileSync(join(ROOT, draft, "output-schema.json"), "utf8"),
  ) as Record<string, JsonValue> & { $id: string };
  const dir = join(ROOT, draft, "content");
  const tally: Record<"jse" | "ata", Tally> = {
    jse: { pass: 0, fail: 0, error: 0, skip: 0 },
    ata: { pass: 0, fail: 0, error: 0, skip: 0 },
  };
  const failures: string[] = [];

  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    const groups = JSON.parse(
      readFileSync(join(dir, file), "utf8"),
    ) as OutputGroup[];
    for (const group of groups) {
      for (const test of group.tests) {
        const expected = test.output?.basic;
        const where = `${draft}/${file} :: ${group.description} :: ${test.description}`;
        const check = (document: JsonValue): boolean => {
          const verifier = createEngine();
          verifier.registerSchema(outputSchema, outputSchema.$id);
          const id =
            typeof expected!.$id === "string"
              ? expected!.$id
              : `https://output-case.example/${draft}/${file}/${group.description}`;
          const u = verifier.registerSchema(expected!, id);
          return verifier.evaluate(u, document).valid;
        };
        for (const subject of ["jse", "ata"] as const) {
          if (expected === undefined) {
            tally[subject].skip++;
            continue;
          }
          try {
            let document: JsonValue;
            if (subject === "jse") {
              const engine = createEngine(
                draft === "draft2019-09"
                  ? { defaultDialect: DIALECT_2019_09 }
                  : {},
              );
              const id =
                typeof group.schema.$id === "string"
                  ? group.schema.$id
                  : `https://case.example/${draft}/${file}/${group.description}`;
              const u = engine.registerSchema(group.schema, id);
              document = engine.evaluate(u, test.data, {
                output: "basic",
                annotations: true,
              }).outputDocument as unknown as JsonValue;
            } else {
              const v = new AtaValidator(group.schema, {
                assertFormat: false,
                useDefaults: false,
              });
              document = ataToOutput(v, test.data, { format: "basic" });
            }
            if (check(document)) tally[subject].pass++;
            else {
              tally[subject].fail++;
              failures.push(
                `${subject}: ${where}\n   produced ${JSON.stringify(document).slice(0, 300)}`,
              );
            }
          } catch (e) {
            tally[subject].error++;
            failures.push(
              `${subject}: ${where} threw ${(e as Error).message.slice(0, 120)}`,
            );
          }
        }
      }
    }
  }
  console.log(draft);
  console.table(tally);
  for (const f of failures) console.log(f);
  if (failures.length > 0) anyFailure = true;
}

if (anyFailure) process.exitCode = 1;
