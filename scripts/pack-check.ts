// Publication-artifact gate: proves the packages are installable and usable
// exactly as npm would deliver them, without ever contacting a registry.
// Builds dist, packs each publishable package to a tarball, installs the
// tarballs into a throwaway consumer with `npm install --offline` (a registry
// fetch attempt fails the run — the packages must be self-sufficient), then
// exercises every package through the installed dist at runtime AND resolves
// the full d.ts graph with tsc against a typed consumer.
//
// The consumer lives in the OS tmpdir deliberately: resolution must succeed
// from the consumer's own node_modules with no help from the workspace.

import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGES = [
  "core",
  "compiler",
  "formats",
  "ajv-compat",
  "dialect-draft04",
];

const run = (cmd: string, args: string[], cwd: string): string =>
  execFileSync(cmd, args, { cwd, encoding: "utf8" });

const consumerDir = mkdtempSync(join(tmpdir(), "jse-pack-check-"));
const tarballDir = join(consumerDir, "tarballs");
mkdirSync(tarballDir);
console.log(`pack-check consumer: ${consumerDir}`);

run("npm", ["run", "build"], ROOT);
// What a registry consumer receives: npm includes a package directory's
// LICENSE and README whatever `files` says, but only from that directory,
// so a missing copy would ship a bare tarball without any other gate
// noticing.
const REQUIRED_FILES = [
  "LICENSE",
  "README.md",
  "package.json",
  "dist/index.js",
];
for (const pkg of PACKAGES) {
  const report = JSON.parse(
    run(
      "npm",
      [
        "pack",
        "--json",
        "--pack-destination",
        tarballDir,
        "-w",
        `packages/${pkg}`,
      ],
      ROOT,
    ),
  ) as { files: { path: string }[] }[];
  const paths = new Set(report.flatMap((r) => r.files.map((f) => f.path)));
  const missing = REQUIRED_FILES.filter((f) => !paths.has(f));
  if (missing.length > 0) {
    throw new Error(`packages/${pkg} tarball lacks: ${missing.join(", ")}`);
  }
}
const tarballs = readdirSync(tarballDir).filter((f) => f.endsWith(".tgz"));
if (tarballs.length !== PACKAGES.length) {
  throw new Error(
    `expected ${String(PACKAGES.length)} tarballs, got: ${tarballs.join(", ")}`,
  );
}

const dependencies = Object.fromEntries(
  tarballs.map((t) => {
    // npm pack names scoped tarballs <scope>-<pkg>-<version>.tgz
    const name = `@json-schema-engine/${t.replace(/^json-schema-engine-/, "").replace(/-\d+\.\d+\.\d+\.tgz$/, "")}`;
    return [name, `file:tarballs/${t}`];
  }),
);
writeFileSync(
  join(consumerDir, "package.json"),
  JSON.stringify(
    {
      name: "jse-pack-check-consumer",
      private: true,
      type: "module",
      dependencies,
    },
    null,
    2,
  ),
);

run(
  "npm",
  ["install", "--offline", "--no-audit", "--no-fund", "--loglevel=error"],
  consumerDir,
);
console.log("offline install OK");

const SMOKE_JS = `
import { createEngine, DIALECT_DRAFT_07 } from "@json-schema-engine/core";
import { compileValidator, compileList } from "@json-schema-engine/compiler";
import { FORMATS_2020_12 } from "@json-schema-engine/formats";
import { Ajv2020 } from "@json-schema-engine/ajv-compat";
import { registerDraft04, DIALECT_DRAFT_04 } from "@json-schema-engine/dialect-draft04";

const assert = (cond, label) => {
  if (!cond) throw new Error("smoke failed: " + label);
};

// core: evaluate through a 2020-12 schema with an asserted format
const engine = createEngine({ formats: FORMATS_2020_12, assertFormats: true });
const uri = await engine.loadSchema(
  { type: "string", format: "uuid" },
  "https://pack.check/core",
);
assert(engine.evaluate(uri, "123e4567-e89b-12d3-a456-426614174000").valid, "core valid");
assert(!engine.evaluate(uri, "not-a-uuid").valid, "core format assert");

// compiler: flag artifact + list artifact agree with the interpreter
const flag = compileValidator(engine, uri);
const list = compileList(engine, uri);
assert(flag.validate("123e4567-e89b-12d3-a456-426614174000"), "compiled flag");
assert(list.evaluateList(42).errors.length > 0, "compiled list errors");

// dialect-draft04: registered dialect evaluates draft-04 keywords
const engine4 = createEngine({ defaultDialect: DIALECT_DRAFT_04 });
registerDraft04(engine4);
const uri4 = await engine4.loadSchema(
  { minimum: 3, exclusiveMinimum: true },
  "https://pack.check/draft04",
);
assert(!engine4.evaluate(uri4, 3).valid, "draft-04 exclusiveMinimum");
assert(engine4.evaluate(uri4, 4).valid, "draft-04 minimum");

// ajv-compat: end-to-end AJV-shaped API
const ajv = new Ajv2020({ allErrors: true });
const validate = ajv.compile({ type: "integer", minimum: 2 });
assert(validate(3), "ajv-compat valid");
assert(!validate(1) && validate.errors.length === 1, "ajv-compat errors");

// draft-07 dialect constant exists end-to-end (core exports legacy dialects)
assert(typeof DIALECT_DRAFT_07 === "string", "draft-07 constant");

console.log("runtime smoke OK");
`;
writeFileSync(join(consumerDir, "smoke.mjs"), SMOKE_JS);
console.log(run("node", ["smoke.mjs"], consumerDir).trim());

// Typed consumer: same surface, resolved through the published d.ts graph.
const SMOKE_TS = `
import { createEngine, type Result, type TraceUnit } from "@json-schema-engine/core";
import { compileValidator, type CompiledArtifact } from "@json-schema-engine/compiler";
import { FORMATS_2020_12 } from "@json-schema-engine/formats";
import { Ajv2020, type ErrorObject } from "@json-schema-engine/ajv-compat";
import { registerDraft04 } from "@json-schema-engine/dialect-draft04";

export async function typedSmoke(): Promise<Result> {
  const engine = createEngine({ formats: FORMATS_2020_12 });
  registerDraft04(engine);
  const uri = await engine.loadSchema({ type: "string" }, "https://pack.check/t");
  const artifact: CompiledArtifact = compileValidator(engine, uri);
  void artifact.validate("x");
  const ajv = new Ajv2020();
  const errors: ErrorObject[] | null = ajv.compile({})?.errors ?? null;
  void errors;
  const result = engine.evaluate(uri, "x", { output: "list", trace: true });
  const trace: TraceUnit | undefined = result.trace;
  void trace;
  return result;
}
`;
writeFileSync(join(consumerDir, "smoke.ts"), SMOKE_TS);
writeFileSync(
  join(consumerDir, "tsconfig.json"),
  JSON.stringify(
    {
      compilerOptions: {
        module: "NodeNext",
        moduleResolution: "NodeNext",
        strict: true,
        noEmit: true,
        skipLibCheck: true,
      },
      files: ["smoke.ts"],
    },
    null,
    2,
  ),
);
run(join(ROOT, "node_modules", ".bin", "tsc"), ["-p", "."], consumerDir);
console.log("typed consumer tsc OK");

rmSync(consumerDir, { recursive: true, force: true });
console.log("PACK CHECK PASS");
