// CSP proof for standalone emission (M6.5 done-signal): emit self-contained
// modules for every fully-static draft2020-12 suite group plus an injection
// corpus, then execute them in a child `node
// --disallow-code-generation-from-strings` process (plain JS runner — no
// tsx, no vitest) and compare every verdict against the interpreter's.
// Schemas with interpreted units are counted and skipped: under CSP those
// run on the interpreter tier by design (D10; standalone.ts header).

import {
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { createEngine, type JsonValue } from "@json-schema-engine/core";
import {
  emitStandalone,
  StandaloneUnsupportedError,
} from "@json-schema-engine/compiler";

const SUITE_DIR = join(
  import.meta.dirname,
  "..",
  "test-suite",
  "tests",
  "draft2020-12",
);
const OUT = join(tmpdir(), `jse-csp-${String(process.pid)}`);
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

interface SuiteGroup {
  description: string;
  schema: JsonValue;
  tests: { description: string; data: JsonValue; valid: boolean }[];
}
interface ManifestEntry {
  module: string;
  label: string;
  cases: { data: JsonValue; expected: boolean }[];
}

const manifest: ManifestEntry[] = [];
let emitted = 0;
let islanded = 0;
let unregisterable = 0;
let moduleIndex = 0;

function tryEmit(
  label: string,
  schema: JsonValue,
  instances: JsonValue[],
): void {
  const engine = createEngine();
  let uri: string;
  try {
    uri = engine.registerSchema(
      schema,
      `https://csp.example/${String(moduleIndex)}`,
    );
  } catch {
    unregisterable++;
    return;
  }
  let source: string;
  try {
    source = emitStandalone(engine, uri);
  } catch (err) {
    if (err instanceof StandaloneUnsupportedError) {
      islanded++;
      return;
    }
    throw err;
  }
  const file = `artifact-${String(moduleIndex)}.mjs`;
  writeFileSync(join(OUT, file), source);
  manifest.push({
    module: file,
    label,
    // Expected verdicts come from the interpreter — the parity oracle.
    cases: instances.map((data) => ({
      data,
      expected: engine.evaluate(uri, data).valid,
    })),
  });
  emitted++;
  moduleIndex++;
}

// 1. Every locally-registerable suite group.
for (const file of readdirSync(SUITE_DIR).filter((f) => f.endsWith(".json"))) {
  const groups = JSON.parse(
    readFileSync(join(SUITE_DIR, file), "utf8"),
  ) as SuiteGroup[];
  for (const group of groups) {
    tryEmit(
      `${file}: ${group.description}`,
      group.schema,
      group.tests.map((t) => t.data),
    );
  }
}

// 2. Injection corpus: hostile schema-derived strings through the emitter.
const HOSTILE = [
  'quote" + globalThis.polluted = 1 + "',
  "backtick` + `${globalThis.x}`",
  "${injected}",
  "*/ dead(); /*",
  "__proto__",
  "constructor",
  "back\\slash",
  "new\nline",
  "line sep line",
];
for (const name of HOSTILE) {
  tryEmit(
    `injection: property ${JSON.stringify(name)}`,
    { properties: { [name]: { type: "string" } }, required: [name] },
    [{ [name]: "ok" }, { [name]: 5 }, {}, "not an object"],
  );
}
tryEmit("injection: hostile pattern", { pattern: "['\"`]" }, [
  "a'b",
  "clean",
  5,
]);

writeFileSync(join(OUT, "manifest.json"), JSON.stringify(manifest));
writeFileSync(
  join(OUT, "runner.mjs"),
  `// Plain-JS CSP runner: verdict parity for every emitted artifact.
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(join(here, "manifest.json"), "utf8"));
let cases = 0, failures = 0;
for (const entry of manifest) {
  const { default: validate } = await import(join(here, entry.module));
  for (const c of entry.cases) {
    cases++;
    const got = validate(c.data);
    if (got !== c.expected) {
      failures++;
      console.error("MISMATCH", entry.label, JSON.stringify(c.data), "expected", c.expected, "got", got);
    }
  }
}
console.log(\`csp-run: modules=\${manifest.length} cases=\${cases} failures=\${failures}\`);
if (failures > 0) process.exit(1);
`,
);

console.log(
  `emitted=${String(emitted)} islanded(skipped, interpreter tier under CSP)=${String(islanded)} unregisterable=${String(unregisterable)}`,
);

const run = spawnSync(
  process.execPath,
  ["--disallow-code-generation-from-strings", join(OUT, "runner.mjs")],
  { encoding: "utf8" },
);
process.stdout.write(run.stdout);
process.stderr.write(run.stderr);
rmSync(OUT, { recursive: true, force: true });
if (run.status !== 0) {
  console.error("CSP CHECK FAILED");
  process.exit(1);
}
console.log("CSP CHECK PASS (node --disallow-code-generation-from-strings)");
