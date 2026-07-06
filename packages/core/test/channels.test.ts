// Channel semantics gates, ported from the F2 prototype (expectations are
// the F2-validated semantics; only the API surface and the default location
// field names — evaluationPath/schemaLocation per D6 — changed).

import { describe, it, expect } from "vitest";
import {
  createEngine, EvaluateOptions, JsonValue, Result,
} from "@jse/core";

function run(schema: JsonValue, instance: JsonValue, options?: EvaluateOptions): Result {
  const engine = createEngine();
  const uri = engine.registerSchema(schema, "https://channels.example/schema");
  return engine.evaluate(uri, instance,
    { collectAnnotations: true, output: "list", ...options });
}

const annotationTuples = (r: Result) =>
  (r.annotations ?? []).map((a) => [a.evaluationPath, a.instanceLocation, a.annotation]);

const profileSchema: JsonValue = {
  title: "User profile",
  type: "object",
  required: ["id"],
  properties: {
    id: { type: "string", title: "Identifier", readOnly: true },
    displayName: { type: "string", title: "Display name", default: "" },
  },
  $comment: "must never be collected",
};

describe("annotation collection", () => {
  it("collects annotations with evaluation paths on success", () => {
    const r = run(profileSchema, { id: "u1", displayName: "Ada" });
    expect(r.valid).toBe(true);
    expect(annotationTuples(r)).toContainEqual(["/properties/id/readOnly", "/id", true]);
    expect(annotationTuples(r)).toContainEqual(["/properties/id/title", "/id", "Identifier"]);
    expect(annotationTuples(r)).toContainEqual(["/title", "", "User profile"]);
    // properties itself annotates the matched names
    expect(annotationTuples(r)).toContainEqual(["/properties", "", ["id", "displayName"]]);
  });

  it("produces no annotations when the schema fails", () => {
    const r = run(profileSchema, { displayName: "Ada" });
    expect(r.valid).toBe(false);
    expect(r.annotations).toBeUndefined();
  });

  it("never collects $comment", () => {
    const r = run(profileSchema, { id: "u1" });
    expect((r.annotations ?? []).some((a) => a.keyword === "$comment")).toBe(false);
  });

  it("treats unknown keywords as annotations", () => {
    const r = run({ "x-vendor-hint": { cache: true } }, 42);
    expect(annotationTuples(r)).toContainEqual(["/x-vendor-hint", "", { cache: true }]);
  });

  it("drops annotations from failed branches but keeps successful ones", () => {
    const schema: JsonValue = {
      anyOf: [
        { pattern: "^a", title: "starts with a" },
        { pattern: "^b", title: "starts with b" },
      ],
    };
    const r = run(schema, "abc");
    expect(r.valid).toBe(true);
    const titles = (r.annotations ?? []).filter((a) => a.keyword === "title");
    expect(titles.map((a) => a.annotation)).toEqual(["starts with a"]);
    expect(titles[0]!.evaluationPath).toBe("/anyOf/0/title");
    expect(titles[0]!.schemaLocation)
      .toBe("https://channels.example/schema#/anyOf/0/title");
  });

  it("annotations from a failed branch do not mark properties evaluated", () => {
    const schema: JsonValue = {
      anyOf: [
        { properties: { x: { type: "string" } }, required: ["x"] },
        { properties: { y: { type: "number" } }, required: ["missing"] },
      ],
      unevaluatedProperties: false,
    };
    // branch 2 fails, so its properties annotation for y is dropped: y is
    // unevaluated and the schema must reject the instance.
    expect(run(schema, { x: "s", y: 1 }).valid).toBe(false);
    expect(run(schema, { x: "s" }).valid).toBe(true);
  });
});

describe("retention policy (DESIGN.md D5)", () => {
  const instance: JsonValue = { id: "u1", displayName: "Ada" };

  it("filters by keyword allow-list without changing validation", () => {
    const all = run(profileSchema, instance);
    const only = run(profileSchema, instance, { retention: { keywords: ["readOnly"] } });
    expect(only.valid).toBe(all.valid);
    expect(only.annotations!.length).toBe(1);
    expect(only.annotations![0]!.keyword).toBe("readOnly");
    expect(all.annotations!.length).toBeGreaterThan(only.annotations!.length);
  });

  it("filters by vocabulary URI", () => {
    const r = run(profileSchema, instance, {
      retention: { vocabularies: ["https://json-schema.org/draft/2020-12/vocab/meta-data"] },
    });
    expect(r.annotations!.length).toBeGreaterThan(0);
    expect(r.annotations!.every(
      (a) => ["title", "readOnly", "default"].includes(a.keyword))).toBe(true);
  });

  it("filters by arbitrary predicate (evaluation-path prefix)", () => {
    const r = run(profileSchema, instance, {
      retention: { keep: (u) => u.evaluationPath!.startsWith("/properties/id/") },
    });
    expect(r.annotations!.every((a) => a.instanceLocation === "/id")).toBe(true);
    expect(r.annotations!.length).toBeGreaterThan(0);
  });

  it("retention does not starve internal consumers (unevaluatedProperties)", () => {
    const schema: JsonValue = {
      allOf: [{ properties: { x: true } }],
      unevaluatedProperties: false,
    };
    // Retain nothing: the channel still feeds unevaluatedProperties, which
    // must still see x as evaluated. This is the "transient" retention story.
    const r = run(schema, { x: 1 }, { retention: { keywords: [] } });
    expect(r.valid).toBe(true);
    expect(r.annotations).toEqual([]);
    expect(run(schema, { x: 1, y: 2 }, { retention: { keywords: [] } }).valid).toBe(false);
  });
});
