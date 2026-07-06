// Executes every ```ts code block in README.md and docs/guide/*.md
// (CONTRIBUTING.md "Documentation conventions" states the contract): each
// block is a self-contained module that must import successfully and run
// without throwing. Blocks are written to the gitignored .snippets/
// directory so vitest's transformer compiles them like project code.

import {
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, beforeAll, expect } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..", "..");
const SNIPPET_DIR = join(HERE, ".snippets");
const GUIDE_DIR = join(ROOT, "docs", "guide");

interface Snippet {
  id: string;
  source: string;
  code: string;
}

function extractSnippets(markdownPath: string, label: string): Snippet[] {
  const text = readFileSync(markdownPath, "utf8");
  const fence = /```ts\n([\s\S]*?)```/g;
  const snippets: Snippet[] = [];
  let match;
  let n = 0;
  while ((match = fence.exec(text)) !== null) {
    n += 1;
    snippets.push({
      id: `${label}-${n}`,
      source: markdownPath,
      code: match[1]!,
    });
  }
  return snippets;
}

const sources = [
  { path: join(ROOT, "README.md"), label: "README" },
  ...readdirSync(GUIDE_DIR)
    .filter((f) => f.endsWith(".md"))
    .map((f) => ({
      path: join(GUIDE_DIR, f),
      label: `guide-${f.slice(0, -".md".length)}`,
    })),
];

const snippets = sources.flatMap((s) => extractSnippets(s.path, s.label));

describe("documentation snippets", () => {
  beforeAll(() => {
    rmSync(SNIPPET_DIR, { recursive: true, force: true });
    mkdirSync(SNIPPET_DIR, { recursive: true });
  });

  it("extraction finds the expected volume", () => {
    // A collapse to near-zero means the fence regex or file layout broke,
    // which would otherwise pass silently as "no snippets, no failures".
    expect(snippets.length).toBeGreaterThanOrEqual(5);
  });

  for (const snippet of snippets) {
    it(`${snippet.id} runs`, async () => {
      const file = join(SNIPPET_DIR, `${snippet.id}.ts`);
      writeFileSync(file, snippet.code);
      await import(/* @vite-ignore */ file);
    });
  }
});
