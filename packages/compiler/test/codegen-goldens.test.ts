// Codegen goldens: the emitted source text for representative schemas in
// each compile mode, pinned byte-for-byte. These pin the TEXT the serializer
// emits, not behavior (the differentials, fuzz legs, and plan census pin
// that), so a refactor of the serializer can prove it changed nothing and a
// deliberate codegen change re-pins them the way plan-census pins are
// updated. The fixture schemas: the three bench spike schemas, a
// static-coverage consumer, a runtime-tracked consumer (anyOf contributors),
// a $dynamicRef island (an unstable site, ADR 0004), and a $dynamicRef
// resolved statically. The `trace` mode is the evaluator's emission: list
// mode plus the recorded application tree. UPDATE_GOLDENS=1 rewrites every
// golden from the current emitter instead of asserting; review the diff.

import { describe, it, expect } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createEngine,
  type Engine,
  type JsonValue,
} from "@json-schema-engine/core";
import {
  compileEvaluator,
  compileList,
  compileValidator,
} from "@json-schema-engine/compiler";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "goldens", "codegen");

const CASES = [
  "user",
  "event",
  "profile",
  "static-consumer",
  "tracked-consumer",
  "island",
  "dynamic-static",
];

const UPDATE = process.env.UPDATE_GOLDENS === "1";

/** Compares against the golden, or rewrites it under UPDATE_GOLDENS=1. */
function expectGolden(actual: string, file: string): void {
  if (UPDATE) writeFileSync(file, actual);
  expect(actual).toBe(readFileSync(file, "utf8"));
}

const MODES: Record<string, (engine: Engine, uri: string) => string> = {
  flag: (engine, uri) => compileValidator(engine, uri).source,
  list: (engine, uri) => compileList(engine, uri, { errorParams: true }).source,
  "list-annotations": (engine, uri) =>
    compileList(engine, uri, { errorParams: true, annotations: true }).source,
  trace: (engine, uri) =>
    compileEvaluator(engine, uri, { errorParams: true, annotations: true })
      .source,
};

describe("codegen goldens", () => {
  for (const name of CASES) {
    const schema = JSON.parse(
      readFileSync(join(DIR, `${name}.schema.json`), "utf8"),
    ) as JsonValue;
    for (const [mode, run] of Object.entries(MODES)) {
      it(`${name} emits the pinned ${mode} source`, () => {
        const engine = createEngine();
        const uri = engine.registerSchema(
          schema,
          `https://codegen.example/${name}`,
        );
        expectGolden(run(engine, uri), join(DIR, `${name}.${mode}.js`));
      });
    }

    // The level is a runtime binding, not an emission mode: the cuts route
    // through helpers the artifact's level selects, so a verbose artifact
    // is the trace golden byte for byte.
    it(`${name}: a verbose artifact emits the pinned trace source`, () => {
      const engine = createEngine();
      const uri = engine.registerSchema(
        schema,
        `https://codegen.example/${name}`,
      );
      expect(
        compileEvaluator(engine, uri, {
          errorParams: true,
          annotations: true,
          verbose: true,
        }).source,
      ).toBe(readFileSync(join(DIR, `${name}.trace.js`), "utf8"));
    });
  }
});
