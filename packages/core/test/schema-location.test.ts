// A schema location is a URI (D8): the JSON Pointer rides in the fragment,
// percent-encoded exactly where RFC 3986's `fragment` production requires
// and nowhere else, so an ordinary pointer reads unchanged and a member name
// holding a space, a `%`, or a non-ASCII character still yields a value
// that can be pasted into a `$ref` or handed back to `Engine.locate`.
// `evaluationPath` and `inputLocation` stay plain-text pointers.

import { describe, it, expect } from "vitest";
import {
  createEngine,
  pointerFragment,
  pointerFromFragment,
  schemaLocation,
  type JsonValue,
} from "@json-schema-engine/core";
import { compileEvaluator, compileList } from "@json-schema-engine/compiler";

describe("pointerFragment", () => {
  it("leaves everything the fragment production allows literal", () => {
    const plain = "/properties/a-b.c_d~0e~1f/items/0/$ref/x:y@z!$&'()*+,;=?";
    expect(pointerFragment(plain)).toBe(plain);
    expect(pointerFragment("")).toBe("");
  });

  it("encodes what the production forbids, as UTF-8 bytes", () => {
    expect(pointerFragment("/properties/100%")).toBe("/properties/100%25");
    expect(pointerFragment("/properties/a b")).toBe("/properties/a%20b");
    expect(pointerFragment('/properties/"<>\\^`{|}#')).toBe(
      "/properties/%22%3C%3E%5C%5E%60%7B%7C%7D%23",
    );
    expect(pointerFragment("/properties/名前")).toBe(
      "/properties/%E5%90%8D%E5%89%8D",
    );
    expect(pointerFragment("/properties/\u0001")).toBe("/properties/%01");
    expect(pointerFragment("/properties/\u{1F600}")).toBe(
      "/properties/%F0%9F%98%80",
    );
  });

  it("round-trips through pointerFromFragment", () => {
    for (const pointer of [
      "/properties/100%",
      "/properties/a b/items/~0~1",
      "/properties/名前",
      "/a%2Fb",
      "/%",
    ]) {
      expect(pointerFromFragment(pointerFragment(pointer))).toBe(pointer);
    }
  });

  it("builds the canonical location", () => {
    expect(schemaLocation("https://x.example/s", "/properties/100%")).toBe(
      "https://x.example/s#/properties/100%25",
    );
    expect(schemaLocation("https://x.example/s", "")).toBe(
      "https://x.example/s#",
    );
  });
});

describe("schemaLocation in output", () => {
  const schema: JsonValue = {
    properties: {
      "100%": { type: "string", title: "percent" },
      "a b": { $ref: "#/$defs/n%C3%A4me" },
    },
    $defs: { näme: { type: "integer" } },
  };
  const BASE = "https://loc.example/schema";
  const instance = { "100%": 1, "a b": "x" };

  it("is encoded in every format while the paths stay plain", () => {
    const engine = createEngine();
    const uri = engine.registerSchema(schema, BASE);
    const result = engine.evaluate(uri, instance, {
      output: "list",
      errorParams: true,
    });
    expect(
      result.errors?.map((e) => [e.evaluationPath, e.schemaLocation]),
    ).toEqual([
      ["/properties/100%/type", `${BASE}#/properties/100%25/type`],
      ["/properties/a b/$ref/type", `${BASE}#/$defs/n%C3%A4me/type`],
    ]);
    const document = result.outputDocument as {
      details: { evaluationPath: string; schemaLocation: string }[];
    };
    expect(document.details.map((d) => d.schemaLocation)).toEqual([
      `${BASE}#/properties/100%25`,
      `${BASE}#/$defs/n%C3%A4me`,
    ]);
    const verbose = engine.evaluate(
      uri,
      { "100%": "s", "a b": 1 },
      {
        output: "verbose",
        annotations: true,
      },
    ).outputDocument as {
      annotations?: {
        absoluteKeywordLocation: string;
        keywordLocation: string;
      }[];
      errors?: { absoluteKeywordLocation: string }[];
    };
    const first = (verbose.errors ?? verbose.annotations)![0]!;
    expect(first.absoluteKeywordLocation).toBe(`${BASE}#/properties`);
  });

  it("round-trips through Engine.locate", () => {
    const engine = createEngine();
    const uri = engine.registerSchema(schema, BASE);
    const location = engine.evaluate(uri, instance, { output: "list" })
      .errors![0]!.schemaLocation;
    // `locate` resolves an encoded location; without positions it reports
    // nothing rather than throwing on the percent-escape.
    expect(() => engine.locate(location)).not.toThrow();
    expect(engine.registry.resolveRef(location, BASE).pointer).toBe(
      "/properties/100%/type",
    );
  });

  it("matches between the compiled tiers and the interpreter", () => {
    const engine = createEngine();
    const uri = engine.registerSchema(schema, BASE);
    expect(compileList(engine, uri).basic(instance)).toEqual(
      engine.evaluate(uri, instance, { output: "basic" }).outputDocument,
    );
    for (const output of ["list", "detailed", "hierarchical"] as const) {
      expect(
        compileEvaluator(engine, uri).evaluate(instance, { output }),
      ).toEqual(engine.evaluate(uri, instance, { output }));
    }
    const annotated = compileEvaluator(engine, uri, { annotations: true });
    const valid = { "100%": "s", "a b": 1 };
    expect(annotated.evaluate(valid, { output: "basic" })).toEqual(
      engine.evaluate(uri, valid, { output: "basic", annotations: true }),
    );
  });
});
