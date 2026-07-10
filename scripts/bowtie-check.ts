// Bowtie conformance gate (M9a): builds the harness image locally, smokes
// it, then runs the official suite for every supported dialect through
// Bowtie's own runner and pins EXACT per-dialect test counts with zero
// failures/errors/skips — the exactRun discipline applied to the Bowtie
// path, which exercises the engine through the IO-protocol harness rather
// than the in-repo suite runners. A submodule bump is a deliberate pin
// update. Local + CI only: the image stays localhost/jse-bowtie and no
// results leave the machine (public bowtie.report listing is the
// owner-gated M9b submission).
//
// Requirements: a container tool (podman preferred, docker accepted) and
// the bowtie CLI. macOS installs commonly live off the default PATH
// (/opt/podman/bin, ~/Library/Python/*/bin) — both are searched.

import { execFileSync, execSync } from "node:child_process";
import { globSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const IMAGE = "localhost/jse-bowtie";

// Expected: every test in the dialect's suite directory runs and matches.
const PINS: Record<string, number> = {
  "draft2020-12": 1299,
  "draft2019-09": 1259,
  draft7: 927,
  draft6: 839,
  draft4: 618,
};

const EXTRA_PATH_DIRS = [
  "/opt/podman/bin",
  ...globSync(join(homedir(), "Library", "Python", "*", "bin")),
];
const PATH = [process.env.PATH ?? "", ...EXTRA_PATH_DIRS].join(":");
const env = { ...process.env, PATH };

const which = (cmd: string): string | undefined => {
  try {
    return execSync(`command -v ${cmd}`, { env, encoding: "utf8" }).trim();
  } catch {
    return undefined;
  }
};

const containerTool = which("podman") ?? which("docker");
const bowtie = which("bowtie");
if (!containerTool || !bowtie) {
  console.error(
    `bowtie-check needs a container tool and the bowtie CLI ` +
      `(container: ${containerTool ?? "MISSING"}, bowtie: ${bowtie ?? "MISSING"})`,
  );
  process.exit(1);
}

const run = (cmd: string, args: string[]): string =>
  execFileSync(cmd, args, {
    cwd: ROOT,
    env,
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 512,
  });

console.log(`building ${IMAGE} with ${containerTool}...`);
run(containerTool, [
  "build",
  "-q",
  "-t",
  IMAGE,
  "-f",
  "bowtie/Containerfile",
  ".",
]);

console.log("bowtie smoke...");
const smoke = JSON.parse(
  run(bowtie, ["smoke", "-i", `image:${IMAGE}`, "--format", "json"]),
) as { success: boolean };
if (!smoke.success) {
  console.error("bowtie smoke FAILED");
  process.exit(1);
}

interface ResultLine {
  expected?: (boolean | null)[];
  results?: ({ valid?: boolean } & Record<string, unknown>)[];
  did_fail_fast?: boolean;
}

const scratch = mkdtempSync(join(tmpdir(), "jse-bowtie-"));
let failed = false;
for (const [dialect, pin] of Object.entries(PINS)) {
  const report = run(bowtie, [
    "suite",
    "-i",
    `image:${IMAGE}`,
    join(ROOT, "test-suite", "tests", dialect),
  ]);

  // Bowtie's own verdict: zero failed/errored/skipped for the harness.
  const reportPath = join(scratch, `${dialect}.jsonl`);
  writeFileSync(reportPath, report);
  const summary = JSON.parse(
    run(bowtie, [
      "summary",
      "--show",
      "failures",
      "--format",
      "json",
      reportPath,
    ]),
  ) as [string, { failed: number; errored: number; skipped: number }][];
  const counts = summary[0]?.[1] ?? { failed: -1, errored: -1, skipped: -1 };

  // Exact-count pin from the report itself: every per-case results line
  // must carry a verdict per test and match its expectation.
  let tests = 0;
  let mismatches = 0;
  for (const line of report.split("\n")) {
    if (!line) continue;
    const entry = JSON.parse(line) as ResultLine;
    if (entry.did_fail_fast) {
      console.error(`${dialect}: report says did_fail_fast`);
      failed = true;
    }
    if (!entry.results || !entry.expected) continue;
    tests += entry.results.length;
    entry.results.forEach((r, i) => {
      if (r.valid !== entry.expected![i]) mismatches++;
    });
  }

  const ok =
    counts.failed === 0 &&
    counts.errored === 0 &&
    counts.skipped === 0 &&
    mismatches === 0 &&
    tests === pin;
  console.log(
    `${dialect}: tests=${String(tests)} (pin ${String(pin)}) ` +
      `failed=${String(counts.failed)} errored=${String(counts.errored)} ` +
      `skipped=${String(counts.skipped)} mismatches=${String(mismatches)} ` +
      (ok ? "OK" : "FAIL"),
  );
  if (!ok) failed = true;
}
rmSync(scratch, { recursive: true, force: true });

if (failed) {
  console.error("BOWTIE CHECK FAIL");
  process.exit(1);
}
console.log("BOWTIE CHECK PASS (all dialects exact, zero failures)");
