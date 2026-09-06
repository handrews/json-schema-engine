// Public trace surface (M8.6): the TraceUnit tree must mirror the
// evaluation — including passing subtrees — with positional error
// correlation against Result.errors, so adapters never parse location
// strings to reconstruct application context.

import { describe, it, expect } from "vitest";
import { createEngine, JsonValue, TraceUnit } from "@jse/core";

function run(schema: JsonValue, instance: JsonValue) {
  const engine = createEngine();
  const uri = engine.registerSchema(schema, "https://trace.example/schema");
  return engine.evaluate(uri, instance, {
    output: "list",
    errorParams: true,
    trace: true,
  });
}

function findBySegments(
  node: TraceUnit,
  segments: readonly string[],
): TraceUnit | undefined {
  if (
    node.segments.length === segments.length &&
    node.segments.every((s, i) => s === segments[i])
  ) {
    return node;
  }
  for (const child of node.children) {
    const hit = findBySegments(child, segments);
    if (hit) return hit;
  }
  return undefined;
}

describe("trace option", () => {
  it("is absent without trace: true and present on valid results", () => {
    const engine = createEngine();
    const uri = engine.registerSchema(
      { type: "string" },
      "https://trace.example/plain",
    );
    expect(engine.evaluate(uri, "ok", { output: "list" }).trace).toBe(
      undefined,
    );
    const traced = engine.evaluate(uri, "ok", {
      output: "list",
      trace: true,
    });
    expect(traced.valid).toBe(true);
    expect(traced.trace.valid).toBe(true);
    expect(traced.trace.segments).toEqual([]);
    expect(traced.trace.errorIndexes).toEqual([]);
  });

  it("records anyOf branches with per-branch validity and error indexes", () => {
    const r = run({ anyOf: [{ type: "string" }, { minimum: 10 }] }, 5);
    expect(r.valid).toBe(false);
    const trace = r.trace;
    expect(trace.valid).toBe(false);
    const b0 = findBySegments(trace, ["anyOf", "0"])!;
    const b1 = findBySegments(trace, ["anyOf", "1"])!;
    expect(b0.valid).toBe(false);
    expect(b1.valid).toBe(false);
    expect(b0.schemaLocation).toBe("https://trace.example/schema#/anyOf/0");
    // every branch error index resolves to a unit at that branch's location
    for (const [node, kw] of [
      [b0, "type"],
      [b1, "minimum"],
    ] as const) {
      expect(node.errorIndexes.length).toBe(1);
      const unit = r.errors![node.errorIndexes[0]!]!;
      expect(unit.keyword).toBe(kw);
      expect(unit.schemaLocation).toBe(`${node.schemaLocation}/${kw}`);
    }
    // the combiner's own error sits at the parent application
    expect(trace.errorIndexes.map((i) => r.errors![i]!.keyword)).toContain(
      "anyOf",
    );
  });

  it("keeps segments dynamic across $ref while schemaLocation is canonical", () => {
    const r = run(
      {
        properties: { a: { $ref: "#/$defs/x" } },
        $defs: { x: { type: "string" } },
      },
      { a: 1 },
    );
    const viaRef = findBySegments(r.trace, ["$ref"])!;
    expect(viaRef.schemaLocation).toBe("https://trace.example/schema#/$defs/x");
    expect(viaRef.inputLocation).toBe("/a");
    expect(viaRef.valid).toBe(false);
    const unit = r.errors![viaRef.errorIndexes[0]!]!;
    expect(unit.evaluationPath).toBe("/properties/a/$ref/type");
    expect(unit.schemaLocation).toBe(
      "https://trace.example/schema#/$defs/x/type",
    );
  });

  it("records propertyNames applications at the object's location", () => {
    const r = run({ propertyNames: { pattern: "^a" } }, { b: 1 });
    const app = findBySegments(r.trace, ["propertyNames"])!;
    expect(app.valid).toBe(false);
    expect(app.inputLocation).toBe("/b");
    expect(r.errors![app.errorIndexes[0]!]!.keyword).toBe("pattern");
  });

  it("attaches boolean-false schema errors to the application node", () => {
    const r = run({ properties: { a: false } }, { a: 1 });
    const app = findBySegments(r.trace, ["properties", "a"])!;
    expect(app.valid).toBe(false);
    expect(app.errorIndexes.length).toBe(1);
    const unit = r.errors![app.errorIndexes[0]!]!;
    expect(unit.keyword).toBe(undefined);
    expect(unit.inputLocation).toBe("/a");
  });

  it("decodes escaped path segments", () => {
    const r = run(
      { properties: { "a/b~c": { type: "string" } } },
      { "a/b~c": 1 },
    );
    const app = findBySegments(r.trace, ["properties", "a/b~c"])!;
    expect(app.valid).toBe(false);
    // the string surface stays escaped; only the trace decodes
    expect(r.errors![app.errorIndexes[0]!]!.evaluationPath).toBe(
      "/properties/a~1b~0c/type",
    );
  });

  it("includes applications from passing subtrees", () => {
    const r = run(
      {
        properties: {
          good: { type: "integer" },
          bad: { type: "string" },
        },
      },
      { good: 1, bad: 2 },
    );
    const good = findBySegments(r.trace, ["properties", "good"])!;
    expect(good.valid).toBe(true);
    expect(good.errorIndexes).toEqual([]);
  });
});
