// Lifecycle oracle capture (M8.6b, D15): AJV is EXECUTED here — never
// read — to pin engine/artifact lifecycle semantics its docs leave out:
// does a cached ValidateFunction see schemas added after its compile, what
// does removeSchema break, when does the object cache return a stale fn.
// Output: test/fixtures/ajv-lifecycle.json, committed so lifecycle tests
// run without invoking AJV.
//
// Re-run after an AJV devDependency bump:
//   npx tsx packages/ajv-compat/test/oracle/capture-lifecycle.ts

import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020Import from "ajv/dist/2020.js";
import { SCENARIOS, type AjvLikeCtor } from "./lifecycle-scenarios.js";

const unwrap = <T>(m: T): T =>
  (m as { default?: T }).default !== undefined
    ? (m as { default: T }).default
    : m;
const Ajv2020 = unwrap(Ajv2020Import) as unknown as AjvLikeCtor;

const results: Record<string, unknown> = {};
for (const [name, run] of Object.entries(SCENARIOS)) {
  results[name] = run(Ajv2020);
}

const out = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "fixtures",
  "ajv-lifecycle.json",
);
writeFileSync(out, JSON.stringify(results, null, 2) + "\n");
console.log(
  `captured ${String(Object.keys(results).length)} scenarios -> ${out}`,
);
