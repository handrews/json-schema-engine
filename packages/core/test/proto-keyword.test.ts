// A keyword named "__proto__" is an ordinary schema key (JSON.parse and a
// computed property both create it as an own property), and the documents
// key errors and annotations by keyword name on ordinary objects. Plain
// assignment of that name reaches Object.prototype's accessor instead of
// creating a property: a primitive value vanishes, an object value
// replaces the record's prototype with schema-derived data. Both renderers
// must define it as an own property, and the record's prototype must stay
// Object.prototype.

import { describe, it, expect } from "vitest";
import {
  createEngine,
  renderHierarchical,
  renderList,
  type AnnotationUnit,
  type ErrorUnit,
  type OutputUnit,
  type RenderInput,
  type RenderNode,
} from "@json-schema-engine/core";

const PROTO = "__proto__";
const ROOT = "https://proto.example/schema#";

function node(overrides: Partial<RenderNode>): RenderNode {
  return {
    evaluationPath: "",
    schemaLocation: ROOT,
    inputLocation: "",
    valid: true,
    keywords: [],
    errors: [],
    droppedErrors: [],
    annotations: [],
    droppedAnnotations: [],
    children: [],
    ...overrides,
  };
}

function ownKeys(record: object | undefined): string[] {
  return record === undefined ? [] : Object.keys(record);
}

describe("a keyword named __proto__ survives the by-keyword records", () => {
  it("an annotation renders as an own property with its value", () => {
    const anns: AnnotationUnit[] = [
      {
        keyword: PROTO,
        evaluationPath: "/__proto__",
        schemaLocation: `${ROOT}/__proto__`,
        inputLocation: "",
        annotation: "marker",
      },
      {
        keyword: "title",
        vocabulary: "https://json-schema.org/draft/2020-12/vocab/meta-data",
        evaluationPath: "/title",
        schemaLocation: `${ROOT}/title`,
        inputLocation: "",
        annotation: "root",
      },
    ];
    const input: RenderInput = {
      errors: [],
      droppedErrors: [],
      annotations: anns,
      droppedAnnotations: [],
      root: node({
        keywords: [
          { name: "title", valid: true },
          { name: PROTO, valid: true },
        ],
        annotations: [0, 1],
      }),
    };
    const doc = renderHierarchical(input, "omit");
    expect(ownKeys(doc.annotations)).toEqual([PROTO, "title"]);
    expect(Object.hasOwn(doc.annotations!, PROTO)).toBe(true);
    expect(doc.annotations![PROTO]).toBe("marker");
    expect(Object.getPrototypeOf(doc.annotations)).toBe(Object.prototype);
    expect(JSON.parse(JSON.stringify(doc.annotations))).toEqual({
      [PROTO]: "marker",
      title: "root",
    });
  });

  it("an object-valued annotation does not become the record's prototype", () => {
    const input: RenderInput = {
      errors: [],
      droppedErrors: [],
      annotations: [
        {
          keyword: PROTO,
          evaluationPath: "/__proto__",
          schemaLocation: `${ROOT}/__proto__`,
          inputLocation: "",
          annotation: { polluted: true },
        },
      ],
      droppedAnnotations: [],
      root: node({
        keywords: [{ name: PROTO, valid: true }],
        annotations: [0],
      }),
    };
    const doc = renderHierarchical(input, "omit");
    expect(Object.getPrototypeOf(doc.annotations)).toBe(Object.prototype);
    expect("polluted" in doc.annotations!).toBe(false);
    expect(doc.annotations![PROTO]).toEqual({ polluted: true });
  });

  it("errors keyed __proto__ render and join like any other keyword's", () => {
    const errs: ErrorUnit[] = [
      {
        evaluationPath: "/__proto__",
        schemaLocation: `${ROOT}/__proto__`,
        inputLocation: "",
        error: "first",
      },
      {
        evaluationPath: "/__proto__",
        schemaLocation: `${ROOT}/__proto__`,
        inputLocation: "",
        error: "second",
      },
    ];
    const input: RenderInput = {
      errors: errs,
      droppedErrors: [],
      annotations: [],
      droppedAnnotations: [],
      root: node({
        valid: false,
        keywords: [{ name: PROTO, valid: false }],
        errors: [0, 1],
      }),
    };
    const doc = renderHierarchical(input, "omit");
    expect(ownKeys(doc.errors)).toEqual([PROTO]);
    expect(doc.errors![PROTO]).toBe("first; second");
    expect(Object.getPrototypeOf(doc.errors)).toBe(Object.prototype);
    const list = renderList(input, "omit");
    expect(list.details[0]!.errors![PROTO]).toBe("first; second");
  });

  it("an unknown keyword named __proto__ reaches the interpreter's documents", () => {
    const engine = createEngine();
    const uri = engine.registerSchema(
      {
        type: "object",
        [PROTO]: "root-marker",
        properties: { child: { [PROTO]: { polluted: true } } },
      },
      "https://proto.example/interpreter",
    );
    const result = engine.evaluate(
      uri,
      { child: {} },
      { output: "hierarchical", annotations: true },
    );
    expect(result.valid).toBe(true);
    const root = result.outputDocument;
    expect(root.annotations![PROTO]).toBe("root-marker");
    const child = root.details!.find(
      (u: OutputUnit) => u.evaluationPath === "/properties/child",
    );
    expect(child!.annotations![PROTO]).toEqual({ polluted: true });
    expect("polluted" in child!.annotations!).toBe(false);
    expect(Object.getPrototypeOf(child!.annotations)).toBe(Object.prototype);
  });
});
