// Golden documents (ADR 0003): one schema/instance pair, invalid and valid,
// rendered into every format name at each supported level. Fixtures are the
// regression contract — reviewed by hand against the spec text before being
// committed: `basic`, `detailed`, `verbose` per IETF draft-03 §13.4 (nested
// `errors`/`annotations` arrays, condensation, one node per keyword);
// `list`, `hierarchical` per the machines-oriented proposal (keyword-keyed
// maps, `details`), at the relevant level and, with `verbose: true`, the
// verbose level. Applicator keywords never annotate (ADR 0002). The invalid
// instance rejects on `count`, which makes `/item`'s acceptance and every
// `title` annotation irrelevant (draft-03 §12.2): relevant-level documents
// omit them and prune the units left empty (§13.4); `verbose` shows them as
// `valid: true` nodes under the rejecting root, and the verbose level of
// `list`/`hierarchical` marks them as `droppedAnnotations`.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createEngine,
  EvaluateOptions,
  JsonValue,
} from "@json-schema-engine/core";

const GOLDENS_DIR = join(dirname(fileURLToPath(import.meta.url)), "goldens");

function golden(name: string): unknown {
  return JSON.parse(readFileSync(join(GOLDENS_DIR, `${name}.json`), "utf8"));
}

const schema: JsonValue = {
  $id: "https://golden.example/schema",
  $defs: {
    named: {
      title: "a named thing",
      type: "object",
      required: ["name"],
      properties: { name: { type: "string" } },
    },
  },
  title: "root",
  type: "object",
  properties: {
    item: { $ref: "#/$defs/named" },
    count: { type: "integer" },
  },
};

const instances: [string, JsonValue, boolean][] = [
  ["invalid", { item: { name: "widget" }, count: "nope" }, false],
  ["valid", { item: { name: "widget" }, count: 3 }, true],
];

const renderings: [string, EvaluateOptions][] = [
  ["basic", { output: "basic", annotations: true }],
  ["detailed", { output: "detailed", annotations: true }],
  ["verbose", { output: "verbose", annotations: true }],
  ["list", { output: "list", annotations: true }],
  ["list-verbose", { output: "list", verbose: true, annotations: true }],
  ["hierarchical", { output: "hierarchical", annotations: true }],
  [
    "hierarchical-verbose",
    { output: "hierarchical", verbose: true, annotations: true },
  ],
];

function engineFor() {
  const engine = createEngine();
  const uri = engine.registerSchema(schema, "https://golden.example/schema");
  return { engine, uri };
}

const TITLES = [
  {
    keyword: "title",
    vocabulary: "https://json-schema.org/draft/2020-12/vocab/meta-data",
    evaluationPath: "/properties/item/$ref/title",
    schemaLocation: "https://golden.example/schema#/$defs/named/title",
    inputLocation: "/item",
    annotation: "a named thing",
  },
  {
    keyword: "title",
    vocabulary: "https://json-schema.org/draft/2020-12/vocab/meta-data",
    evaluationPath: "/title",
    schemaLocation: "https://golden.example/schema#/title",
    inputLocation: "",
    annotation: "root",
  },
];

const COUNT_ERROR = {
  evaluationPath: "/properties/count/type",
  schemaLocation: "https://golden.example/schema#/properties/count/type",
  inputLocation: "/count",
  error: 'expected type "integer"',
};

for (const [name, options] of renderings) {
  describe(`${name} golden`, () => {
    for (const [which, instance, valid] of instances) {
      it(`matches for the ${which} instance`, () => {
        const { engine, uri } = engineFor();
        const r = engine.evaluate(uri, instance, options);
        expect(r.valid).toBe(valid);
        expect(r.outputDocument).toEqual(golden(`${name}.${which}`));
        // The flat surface is the same on every format.
        const verboseLevel = name === "verbose" || options.verbose === true;
        expect(r.errors).toEqual(valid ? undefined : [COUNT_ERROR]);
        expect(r.annotations).toEqual(valid ? TITLES : undefined);
        expect(r.droppedErrors).toEqual(verboseLevel ? [] : undefined);
        expect(r.droppedAnnotations).toEqual(
          verboseLevel ? (valid ? [] : TITLES) : undefined,
        );
      });
    }
  });
}
