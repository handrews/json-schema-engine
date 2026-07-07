// The error adapter vs the AJV oracle: our engine evaluates each captured
// case, mapErrors() translates the list units, and the result must equal
// AJV's own error objects byte-for-byte (fixtures captured by
// test/oracle/capture.ts — AJV executed, never read; D15).

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createEngine, DIALECT_DRAFT_07, type JsonValue } from "@jse/core";
import { FORMATS_2020_12 } from "@jse/formats";
import { mapErrors } from "../src/errors.js";

interface FixtureCase {
  dialect: "draft-07" | "2020-12";
  options: Record<string, unknown>;
  schema: JsonValue;
  data: JsonValue;
  valid: boolean;
  errors: Record<string, unknown>[] | null;
  errorsText: string | null;
  compileError?: string;
}

const FIXTURE = JSON.parse(
  readFileSync(
    join(
      dirname(fileURLToPath(import.meta.url)),
      "fixtures",
      "ajv-oracle.json",
    ),
    "utf8",
  ),
) as Record<string, FixtureCase>;

// Cases whose surface belongs to later sub-milestones or other tests.
const SKIP = new Set([
  "discriminator", // M8.4 companion keyword
  "format-comparison", // M8.4 ajv-formats comparison keywords
  "verbose-fields", // verbose enrichment pinned separately below
]);

const ROOT = "https://compat.example/root";

const walk = (doc: JsonValue, pointer: string): JsonValue | undefined => {
  let node: JsonValue | undefined = doc;
  if (pointer === "") return node;
  for (const raw of pointer.slice(1).split("/")) {
    const seg = raw.replace(/~1/g, "/").replace(/~0/g, "~");
    if (Array.isArray(node)) node = node[Number(seg)];
    else if (typeof node === "object" && node !== null)
      node = (node as Record<string, JsonValue>)[seg];
    else return undefined;
  }
  return node;
};

const runCase = (name: string, c: FixtureCase) => {
  const docs = new Map<string, JsonValue>([[ROOT, c.schema]]);
  const engine = createEngine({
    ...(name === "format" || name === "format-comparison"
      ? { formats: FORMATS_2020_12, assertFormats: true }
      : {}),
    ...(c.dialect === "draft-07" ? { defaultDialect: DIALECT_DRAFT_07 } : {}),
  });
  for (const extra of (c.options.schemas as JsonValue[] | undefined) ?? []) {
    const id = (extra as Record<string, JsonValue>).$id as string;
    engine.registerSchema(extra, id);
    docs.set(id, extra);
  }
  const uri = engine.registerSchema(c.schema, ROOT);
  const result = engine.evaluate(uri, c.data, {
    output: "list",
    errorParams: true,
  });
  expect(result.valid, `${name}: verdict`).toBe(c.valid);
  if (c.valid) return;
  const mapped = mapErrors(result.errors!, c.data, {
    rootBaseUri: ROOT,
    resolveSchema: (location) => {
      const hash = location.indexOf("#");
      const doc = docs.get(location.slice(0, hash));
      return doc === undefined
        ? undefined
        : walk(doc, location.slice(hash + 1));
    },
    allErrors: (c.options.allErrors as boolean | undefined) ?? false,
    verbose: false,
    messages: true,
  });
  expect(mapped, name).toEqual(c.errors);
};

describe("mapErrors ≡ AJV oracle", () => {
  for (const [name, c] of Object.entries(FIXTURE)) {
    if (SKIP.has(name) || c.compileError !== undefined) continue;
    it(name, () => {
      runCase(name, c);
    });
  }

  it("verbose adds schema/parentSchema/data", () => {
    const c = FIXTURE["verbose-fields"]!;
    const engine = createEngine();
    const uri = engine.registerSchema(c.schema, ROOT);
    const result = engine.evaluate(uri, c.data, {
      output: "list",
      errorParams: true,
    });
    const mapped = mapErrors(result.errors!, c.data, {
      rootBaseUri: ROOT,
      resolveSchema: (location) =>
        walk(c.schema, location.slice(location.indexOf("#") + 1)),
      allErrors: false,
      verbose: true,
      messages: true,
    });
    expect(mapped).toEqual(c.errors);
  });
});
