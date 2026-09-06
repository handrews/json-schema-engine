// Joins two harness results files by task and prints after/before ratios
// (ops/s), plus the tasks present on one side only.
// Usage: npm run bench:compare -- before.json after.json

import { readFileSync } from "node:fs";

interface ResultsFile {
  results: { task: string; opsPerSec: number | null }[];
}

const [beforePath, afterPath] = process.argv.slice(2);
if (beforePath === undefined || afterPath === undefined) {
  console.error("Usage: npm run bench:compare -- before.json after.json");
  process.exit(2);
}

const readResults = (path: string): ResultsFile =>
  JSON.parse(readFileSync(path, "utf8")) as ResultsFile;

const before = readResults(beforePath);
const after = readResults(afterPath);

const beforeOps = new Map(before.results.map((r) => [r.task, r.opsPerSec]));
const afterOps = new Map(after.results.map((r) => [r.task, r.opsPerSec]));

const rows = after.results.map((r) => {
  const b = beforeOps.get(r.task);
  const ratio =
    b !== undefined && b !== null && r.opsPerSec !== null
      ? (r.opsPerSec / b).toFixed(2)
      : "—";
  return {
    task: r.task,
    before: b ?? "—",
    after: r.opsPerSec ?? "—",
    "after/before": ratio,
  };
});
console.table(rows);

const onlyInBefore = before.results
  .map((r) => r.task)
  .filter((task) => !afterOps.has(task));
const onlyInAfter = after.results
  .map((r) => r.task)
  .filter((task) => !beforeOps.has(task));

if (onlyInBefore.length > 0) {
  console.log("\nonly in before:");
  for (const task of onlyInBefore) console.log(`  ${task}`);
}
if (onlyInAfter.length > 0) {
  console.log("\nonly in after:");
  for (const task of onlyInAfter) console.log(`  ${task}`);
}
