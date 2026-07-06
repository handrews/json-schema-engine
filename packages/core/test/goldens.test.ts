// Golden fixtures (M5): one representative schema/instance pair exercising
// $ref, properties, annotations, and a failing branch, rendered through all
// five output documents. Fixtures are the regression contract — reviewed by
// hand against the spec text (see DESIGN.md M5 row) before being committed:
// notably, `/item` validates and retains its `title`/`properties`
// annotations even though the root ultimately fails (its own `count`
// branch), while the root's own annotations are dropped (§4 rule 3: a
// frame's productions merge to the parent only on success, and the root
// application itself is the failing one here).

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createEngine, JsonValue } from "@jse/core";

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

const instance: JsonValue = { item: { name: "widget" }, count: "nope" };

function engineFor() {
  const engine = createEngine();
  const uri = engine.registerSchema(schema, "https://golden.example/schema");
  return { engine, uri };
}

describe("golden output documents (M5)", () => {
  it("modern HIERARCHICAL matches the golden", () => {
    const { engine, uri } = engineFor();
    const r = engine.evaluate(uri, instance, { output: "hierarchical" });
    expect(r.outputDocument).toEqual(golden("hierarchical"));
  });

  it("modern LIST matches the golden", () => {
    const { engine, uri } = engineFor();
    const r = engine.evaluate(uri, instance, { output: "list" });
    expect(r.outputDocument).toEqual(golden("list"));
  });

  it("Basic (2020-12) matches the golden", () => {
    const { engine, uri } = engineFor();
    const r = engine.evaluate(uri, instance, { output: "list", locations: "2020-12" });
    expect(r.outputDocument).toEqual(golden("basic"));
  });

  it("Detailed (2020-12) matches the golden", () => {
    const { engine, uri } = engineFor();
    const r = engine.evaluate(uri, instance, { output: "hierarchical", locations: "2020-12" });
    expect(r.outputDocument).toEqual(golden("detailed"));
  });

  it("Verbose (2020-12) matches the golden", () => {
    const { engine, uri } = engineFor();
    const r = engine.evaluate(uri, instance,
      { output: "hierarchical", locations: "2020-12", verbose: true });
    expect(r.outputDocument).toEqual(golden("verbose"));
  });
});
