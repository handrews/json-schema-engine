// Output rendering (ADR 0003): the flat surface with native field names on
// every non-flag format, and each format name's document in its source's
// structure — `basic`/`detailed`/`verbose` per IETF draft-03 §13.4 (checked
// against the draft's own examples), `list`/`hierarchical` per the
// machines-oriented output proposal.

import { describe, it, expect } from "vitest";
import { createEngine, JsonValue } from "@json-schema-engine/core";

const schema: JsonValue = {
  $defs: { base: { required: ["id"] } },
  allOf: [{ $ref: "#/$defs/base" }],
};

function engineFor(s: JsonValue, name = "schema") {
  const engine = createEngine();
  const uri = engine.registerSchema(s, `https://output.example/${name}`);
  return { engine, uri };
}

describe("flat surface", () => {
  it("renders native field names", () => {
    const { engine, uri } = engineFor(schema);
    const r = engine.evaluate(uri, {}, { output: "list" });
    expect(r.valid).toBe(false);
    expect(r.errors).toEqual([
      {
        evaluationPath: "/allOf/0/$ref/required",
        schemaLocation: "https://output.example/schema#/$defs/base/required",
        inputLocation: "",
        error: "missing required property 'id'",
      },
    ]);
  });

  it("is populated on every non-flag format", () => {
    const { engine, uri } = engineFor(schema);
    for (const output of [
      "basic",
      "detailed",
      "verbose",
      "list",
      "hierarchical",
    ] as const) {
      const r = engine.evaluate(uri, {}, { output });
      expect(r.errors!.map((e) => e.evaluationPath)).toEqual([
        "/allOf/0/$ref/required",
      ]);
    }
  });

  it("errorParams adds keyword identity and structured params", () => {
    const { engine, uri } = engineFor(schema);
    const r = engine.evaluate(uri, {}, { output: "basic", errorParams: true });
    expect(r.errors![0]).toMatchObject({
      keyword: "required",
      vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation",
      params: { missingProperty: "id" },
    });
  });

  it("renders annotations only when selected", () => {
    const { engine, uri } = engineFor({ title: "T", type: "object" });
    expect(engine.evaluate(uri, {}, { output: "basic" }).annotations).toBe(
      undefined,
    );
    const r = engine.evaluate(uri, {}, { output: "basic", annotations: true });
    expect(r.annotations).toEqual([
      {
        keyword: "title",
        vocabulary: "https://json-schema.org/draft/2020-12/vocab/meta-data",
        evaluationPath: "/title",
        schemaLocation: "https://output.example/schema#/title",
        inputLocation: "",
        annotation: "T",
      },
    ]);
  });

  it("exposes irrelevant records as dropped arrays at the verbose level", () => {
    const { engine, uri } = engineFor({
      anyOf: [
        { type: "string", title: "s" },
        { type: "number", title: "n" },
      ],
    });
    const relevant = engine.evaluate(uri, 5, {
      output: "list",
      annotations: true,
    });
    expect(relevant.droppedErrors).toBeUndefined();
    expect(relevant.droppedAnnotations).toBeUndefined();
    const verbose = engine.evaluate(uri, 5, {
      output: "list",
      verbose: true,
      annotations: true,
    });
    expect(verbose.annotations!.map((a) => a.evaluationPath)).toEqual([
      "/anyOf/1/title",
    ]);
    expect(verbose.droppedErrors!.map((e) => e.evaluationPath)).toEqual([
      "/anyOf/0/type",
    ]);
    expect(verbose.droppedAnnotations!.map((a) => a.evaluationPath)).toEqual([
      "/anyOf/0/title",
    ]);
  });

  it("flag output carries no error units", () => {
    const { engine, uri } = engineFor(schema);
    expect(engine.evaluate(uri, {})).toEqual({ valid: false });
  });

  it("reports a boolean false schema with schema-level locations", () => {
    const { engine, uri } = engineFor({ properties: { x: false } });
    const r = engine.evaluate(uri, { x: 1 }, { output: "list" });
    expect(r.errors).toContainEqual({
      evaluationPath: "/properties/x",
      schemaLocation: "https://output.example/schema#/properties/x",
      inputLocation: "/x",
      error: "schema is false",
    });
  });

  it("escapes JSON Pointer segments in input locations", () => {
    const { engine, uri } = engineFor({ additionalProperties: false });
    const r = engine.evaluate(uri, { "a/b~c": 1 }, { output: "list" });
    expect(r.errors![0]!.inputLocation).toBe("/a~1b~0c");
  });
});

describe("basic (IETF draft-03 §13.4.2)", () => {
  it("omits errors on success and lists flat error units on failure", () => {
    const { engine, uri } = engineFor(schema);
    const ok = engine.evaluate(uri, { id: 1 }, { output: "basic" });
    expect(ok.outputDocument).toEqual({
      valid: true,
      keywordLocation: "",
      absoluteKeywordLocation: "https://output.example/schema#",
      instanceLocation: "",
    });
    const bad = engine.evaluate(uri, {}, { output: "basic" });
    expect(bad.outputDocument).toEqual({
      valid: false,
      keywordLocation: "",
      absoluteKeywordLocation: "https://output.example/schema#",
      instanceLocation: "",
      errors: [
        {
          keywordLocation: "/allOf/0/$ref/required",
          absoluteKeywordLocation:
            "https://output.example/schema#/$defs/base/required",
          instanceLocation: "",
          error: "missing required property 'id'",
        },
      ],
    });
  });

  it("carries selected annotations in the document's own field vocabulary", () => {
    const { engine, uri } = engineFor({ title: "T", description: "D" });
    const none = engine.evaluate(uri, 1, { output: "basic" });
    expect(none.outputDocument.annotations).toBeUndefined();
    const some = engine.evaluate(uri, 1, {
      output: "basic",
      annotations: { keywords: ["title"] },
    });
    expect(some.outputDocument.annotations).toEqual([
      {
        keywordLocation: "/title",
        absoluteKeywordLocation: "https://output.example/schema#/title",
        instanceLocation: "",
        annotation: "T",
      },
    ]);
  });
});

describe("list (machines-oriented proposal)", () => {
  const s: JsonValue = {
    title: "root",
    properties: { name: { title: "the name", type: "string" } },
  };

  it("wraps reporting units under a root with valid and details only", () => {
    const { engine, uri } = engineFor(s);
    const r = engine.evaluate(uri, { name: 3 }, { output: "list" });
    expect(r.outputDocument).toEqual({
      valid: false,
      details: [
        {
          valid: false,
          evaluationPath: "/properties/name",
          schemaLocation: "https://output.example/schema#/properties/name",
          instanceLocation: "/name",
          errors: { type: expect.any(String) as string },
        },
      ],
    });
  });

  it("includes the root unit when it reports something", () => {
    const { engine, uri } = engineFor(s);
    const r = engine.evaluate(
      uri,
      { name: "x" },
      {
        output: "list",
        annotations: true,
      },
    );
    expect(r.outputDocument.details.map((u) => u.evaluationPath)).toEqual([
      "",
      "/properties/name",
    ]);
    expect(r.outputDocument.details[0]!.annotations).toEqual({
      title: "root",
    });
    expect(r.outputDocument.details[0]).not.toHaveProperty("details");
  });

  it("includes every unit at the verbose level, with markers", () => {
    const { engine, uri } = engineFor(s);
    const r = engine.evaluate(
      uri,
      { name: 3 },
      {
        output: "list",
        verbose: true,
        annotations: true,
      },
    );
    expect(r.outputDocument.details.map((u) => u.evaluationPath)).toEqual([
      "",
      "/properties/name",
    ]);
    expect(r.outputDocument.details[0]!.droppedAnnotations).toEqual({
      title: "root",
    });
    expect(r.outputDocument.details[1]!.droppedAnnotations).toEqual({
      title: "the name",
    });
  });
});

describe("hierarchical (machines-oriented proposal)", () => {
  const hSchema: JsonValue = {
    title: "root",
    type: "object",
    properties: {
      name: { title: "the name", type: "string" },
      size: { type: "integer" },
    },
  };

  function run(instance: JsonValue, verbose = false, annotations = true) {
    const { engine, uri } = engineFor(hSchema, "h");
    return engine.evaluate(uri, instance, {
      output: "hierarchical",
      verbose,
      annotations,
    });
  }

  it("nests failing branches", () => {
    const r = run({ name: 3 });
    expect(r.valid).toBe(false);
    const root = r.outputDocument;
    expect(root.valid).toBe(false);
    expect(root.evaluationPath).toBe("");
    expect(root.instanceLocation).toBe("");
    const nameUnit = root.details!.find((d) => d.instanceLocation === "/name")!;
    expect(nameUnit.valid).toBe(false);
    expect(nameUnit.evaluationPath).toBe("/properties/name");
    expect(nameUnit.schemaLocation).toBe(
      "https://output.example/h#/properties/name",
    );
    expect(nameUnit.errors!.type).toContain("string");
  });

  it("prunes contribution-free units, keeps selected annotations on valid ones", () => {
    const r = run({ name: "x" });
    expect(r.valid).toBe(true);
    const root = r.outputDocument;
    expect(root.annotations!.title).toBe("root");
    const nameUnit = root.details!.find((d) => d.instanceLocation === "/name")!;
    expect(nameUnit.annotations!.title).toBe("the name");
    // `size` is absent from the instance: its subschema is never applied.
    expect(root.details!.every((d) => d.instanceLocation !== "/size")).toBe(
      true,
    );
    // Annotations are a control: unselected, the valid tree is just the root.
    expect(run({ name: "x" }, false, false).outputDocument).toEqual({
      valid: true,
      evaluationPath: "",
      schemaLocation: "https://output.example/h#",
      instanceLocation: "",
    });
  });

  it("verbose keeps valid, annotation-free units", () => {
    const { engine, uri } = engineFor({
      properties: { n: { type: "integer" } },
    });
    const terse = engine.evaluate(uri, { n: 1 }, { output: "hierarchical" });
    const verbose = engine.evaluate(
      uri,
      { n: 1 },
      { output: "hierarchical", verbose: true },
    );
    expect(terse.outputDocument.details).toBeUndefined();
    expect(verbose.outputDocument.details!.length).toBe(1);
    expect(verbose.outputDocument.details![0]!.valid).toBe(true);
  });

  it("reports droppedAnnotations on failed units at the verbose level only", () => {
    const verbose = run({ name: 3 }, true);
    const nameUnit = verbose.outputDocument.details!.find(
      (d) => d.instanceLocation === "/name",
    )!;
    expect(nameUnit.droppedAnnotations!.title).toBe("the name");
    const terse = run({ name: 3 });
    const terseUnit = terse.outputDocument.details!.find(
      (d) => d.instanceLocation === "/name",
    )!;
    expect(terseUnit.droppedAnnotations).toBeUndefined();
  });
});

// The draft's own §13.4 example: the second point lacks "y", carries a
// disallowed "z", and the array is one item short.
const polygon: JsonValue = {
  $id: "https://example.com/polygon",
  $defs: {
    point: {
      type: "object",
      properties: { x: { type: "number" }, y: { type: "number" } },
      additionalProperties: false,
      required: ["x", "y"],
    },
  },
  type: "array",
  items: { $ref: "#/$defs/point" },
  minItems: 3,
};
const polygonInput: JsonValue = [
  { x: 2.5, y: 1.3 },
  { x: 1, z: 6.7 },
];

describe("detailed (IETF draft-03 §13.4.3)", () => {
  it("condenses the polygon example node-for-node", () => {
    const engine = createEngine();
    const uri = engine.registerSchema(polygon, "https://example.com/polygon");
    const r = engine.evaluate(uri, polygonInput, { output: "detailed" });
    // `/items` and its second application collapse into the `$ref` node,
    // which keeps two children; the first item's application, `type`, and
    // `properties` have no relevant results and are removed. JSE evaluates
    // applicator keywords before validation keywords, so
    // `additionalProperties` precedes `required`.
    expect(r.outputDocument).toEqual({
      valid: false,
      keywordLocation: "",
      absoluteKeywordLocation: "https://example.com/polygon#",
      instanceLocation: "",
      errors: [
        {
          valid: false,
          keywordLocation: "/items/$ref",
          absoluteKeywordLocation: "https://example.com/polygon#/$defs/point",
          instanceLocation: "/1",
          errors: [
            {
              valid: false,
              keywordLocation: "/items/$ref/additionalProperties",
              absoluteKeywordLocation:
                "https://example.com/polygon#/$defs/point/additionalProperties",
              instanceLocation: "/1/z",
              error: "schema is false",
            },
            {
              valid: false,
              keywordLocation: "/items/$ref/required",
              absoluteKeywordLocation:
                "https://example.com/polygon#/$defs/point/required",
              instanceLocation: "/1",
              error: "missing required property 'y'",
            },
          ],
        },
        {
          valid: false,
          keywordLocation: "/minItems",
          absoluteKeywordLocation: "https://example.com/polygon#/minItems",
          instanceLocation: "",
          error: expect.any(String) as string,
        },
      ],
    });
  });

  it("nests annotation leaves under successful nodes on a valid input", () => {
    const { engine, uri } = engineFor({
      title: "root",
      properties: { a: { title: "leaf", type: "integer" } },
    });
    const r = engine.evaluate(
      uri,
      { a: 1 },
      {
        output: "detailed",
        annotations: true,
      },
    );
    expect(r.outputDocument).toEqual({
      valid: true,
      keywordLocation: "",
      absoluteKeywordLocation: "https://output.example/schema#",
      instanceLocation: "",
      annotations: [
        // `properties` → its one application → its one annotation leaf.
        {
          valid: true,
          keywordLocation: "/properties/a/title",
          absoluteKeywordLocation:
            "https://output.example/schema#/properties/a/title",
          instanceLocation: "/a",
          annotation: "leaf",
        },
        {
          valid: true,
          keywordLocation: "/title",
          absoluteKeywordLocation: "https://output.example/schema#/title",
          instanceLocation: "",
          annotation: "root",
        },
      ],
    });
  });

  it("keeps a keyword node that has both a local error and nested results", () => {
    const { engine, uri } = engineFor({ contains: { type: "string" } });
    const r = engine.evaluate(uri, [1], { output: "detailed" });
    const contains = r.outputDocument.errors![0]!;
    expect(contains.keywordLocation).toBe("/contains");
    expect(contains.error).toEqual(expect.any(String));
    expect(contains.errors!.map((e) => e.keywordLocation)).toEqual([
      "/contains/type",
    ]);
  });
});

describe("verbose (IETF draft-03 §13.4.4)", () => {
  it("renders the draft's validProp example as a full keyword hierarchy", () => {
    const engine = createEngine();
    const uri = engine.registerSchema(
      {
        $id: "https://example.com/polygon",
        type: "object",
        properties: { validProp: true },
        additionalProperties: false,
      },
      "https://example.com/polygon",
    );
    const r = engine.evaluate(
      uri,
      { validProp: 5, disallowedProp: "value" },
      { output: "verbose" },
    );
    // `$id` is structural: no node. Applicators precede `type` here, and the
    // `validProp` application appears, which the draft's abbreviated example
    // omits.
    expect(r.outputDocument).toEqual({
      valid: false,
      keywordLocation: "",
      absoluteKeywordLocation: "https://example.com/polygon#",
      instanceLocation: "",
      errors: [
        {
          valid: true,
          keywordLocation: "/properties",
          absoluteKeywordLocation: "https://example.com/polygon#/properties",
          instanceLocation: "",
          annotations: [
            {
              valid: true,
              keywordLocation: "/properties/validProp",
              absoluteKeywordLocation:
                "https://example.com/polygon#/properties/validProp",
              instanceLocation: "/validProp",
            },
          ],
        },
        {
          valid: false,
          keywordLocation: "/additionalProperties",
          absoluteKeywordLocation:
            "https://example.com/polygon#/additionalProperties",
          instanceLocation: "",
          errors: [
            {
              valid: false,
              keywordLocation: "/additionalProperties",
              absoluteKeywordLocation:
                "https://example.com/polygon#/additionalProperties",
              instanceLocation: "/disallowedProp",
              error: "schema is false",
            },
          ],
        },
        {
          valid: true,
          keywordLocation: "/type",
          absoluteKeywordLocation: "https://example.com/polygon#/type",
          instanceLocation: "",
        },
      ],
    });
  });

  it("includes irrelevant results, marked only by valid", () => {
    const { engine, uri } = engineFor({
      anyOf: [{ type: "string" }, { type: "number" }],
    });
    const r = engine.evaluate(uri, 5, { output: "verbose" });
    const anyOf = r.outputDocument.annotations![0]!;
    expect(anyOf.valid).toBe(true);
    // A successful node nests its results under `annotations` (§13.3.5),
    // rejecting branches included.
    expect(anyOf.annotations!.map((b) => [b.keywordLocation, b.valid])).toEqual(
      [
        ["/anyOf/0", false],
        ["/anyOf/1", true],
      ],
    );
    expect(anyOf.annotations![0]!.errors![0]).toMatchObject({
      keywordLocation: "/anyOf/0/type",
      valid: false,
      error: expect.any(String) as string,
    });
  });

  it("renders unknown keywords as annotation nodes when selected", () => {
    const { engine, uri } = engineFor({ "x-note": 1, type: "integer" });
    const r = engine.evaluate(uri, 1, { output: "verbose", annotations: true });
    expect(
      r.outputDocument.annotations!.map((n) => [
        n.keywordLocation,
        n.annotation,
      ]),
    ).toEqual([
      ["/type", undefined],
      ["/x-note", 1],
    ]);
  });
});
