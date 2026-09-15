// The tier-neutral renderer contract (output.ts): a `RenderInput` hand-built
// here, with no interpreter run, must render through every document
// renderer to the same committed goldens the interpreter produces
// (goldens.test.ts) — the invariants documented on `RenderNode`/`RenderInput`
// are exactly what any future producer (a compiled artifact, say) has to
// honor, and this file is the executable check of that.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  renderHierarchical,
  renderList,
  renderDetailed,
  renderVerbose,
  renderTrace,
  renderBasic,
  type RenderInput,
  type RenderNode,
  type ErrorUnit,
  type AnnotationUnit,
  type TraceUnit,
} from "@json-schema-engine/core";

const GOLDENS_DIR = join(dirname(fileURLToPath(import.meta.url)), "goldens");

function golden(name: string): unknown {
  return JSON.parse(readFileSync(join(GOLDENS_DIR, `${name}.json`), "utf8"));
}

// Same schema/instance pair as goldens.test.ts: root with $defs/named,
// title/type/properties; properties.item $refs the def, properties.count is
// an integer. The invalid instance rejects on count; the valid one doesn't.
const ROOT_LOCATION = "https://golden.example/schema#";
const DEF_LOCATION = "https://golden.example/schema#/$defs/named";

// Same two annotation units as goldens.test.ts, in encounter order: the
// $ref target's title, then the root's title.
const TITLES: AnnotationUnit[] = [
  {
    keyword: "title",
    vocabulary: "https://json-schema.org/draft/2020-12/vocab/meta-data",
    evaluationPath: "/properties/item/$ref/title",
    schemaLocation: `${DEF_LOCATION}/title`,
    inputLocation: "/item",
    annotation: "a named thing",
  },
  {
    keyword: "title",
    vocabulary: "https://json-schema.org/draft/2020-12/vocab/meta-data",
    evaluationPath: "/title",
    schemaLocation: `${ROOT_LOCATION}/title`,
    inputLocation: "",
    annotation: "root",
  },
];

const COUNT_ERROR: ErrorUnit = {
  evaluationPath: "/properties/count/type",
  schemaLocation: `${ROOT_LOCATION}/properties/count/type`,
  inputLocation: "/count",
  error: 'expected type "integer"',
};

// Leaf application: `$defs/named`'s `properties.name`. Identical in both
// instances — "widget" is a string either way — so one node is shared.
const nameNode: RenderNode = {
  evaluationPath: "/properties/item/$ref/properties/name",
  schemaLocation: `${DEF_LOCATION}/properties/name`,
  inputLocation: "/item/name",
  valid: true,
  keywords: [{ name: "type", valid: true }],
  errors: [],
  droppedErrors: [],
  annotations: [],
  droppedAnnotations: [],
  children: [],
};

// The $ref target application (`$defs/named` itself). Its keyword evaluation
// order — properties, type, required, title — comes from the verbose golden,
// not from the schema's own key order (title, type, required, properties):
// the interpreter's per-vocabulary evaluation order, not authoring order, is
// what a producer must replicate.
function refTargetNode(titleIndex: number, dropped: boolean): RenderNode {
  return {
    evaluationPath: "/properties/item/$ref",
    schemaLocation: DEF_LOCATION,
    inputLocation: "/item",
    valid: true,
    keywords: [
      { name: "properties", valid: true },
      { name: "type", valid: true },
      { name: "required", valid: true },
      { name: "title", valid: true },
    ],
    errors: [],
    droppedErrors: [],
    annotations: dropped ? [] : [titleIndex],
    droppedAnnotations: dropped ? [titleIndex] : [],
    children: [nameNode],
  };
}

// `properties.item`'s own application: one keyword, `$ref`, applying the def.
function itemNode(ref: RenderNode): RenderNode {
  return {
    evaluationPath: "/properties/item",
    schemaLocation: `${ROOT_LOCATION}/properties/item`,
    inputLocation: "/item",
    valid: true,
    keywords: [{ name: "$ref", valid: true }],
    errors: [],
    droppedErrors: [],
    annotations: [],
    droppedAnnotations: [],
    children: [ref],
  };
}

// `properties.count`'s application: one keyword, `type`, which is where the
// instance's only possible failure lives.
function countNode(valid: boolean): RenderNode {
  return {
    evaluationPath: "/properties/count",
    schemaLocation: `${ROOT_LOCATION}/properties/count`,
    inputLocation: "/count",
    valid,
    keywords: [{ name: "type", valid }],
    errors: valid ? [] : [0],
    droppedErrors: [],
    annotations: [],
    droppedAnnotations: [],
    children: [],
  };
}

// Root application. Keyword order — properties, type, title — is likewise
// the verbose golden's order, not the schema's authoring order.
function rootNode(
  valid: boolean,
  ref: RenderNode,
  count: RenderNode,
): RenderNode {
  return {
    evaluationPath: "",
    schemaLocation: ROOT_LOCATION,
    inputLocation: "",
    valid,
    keywords: [
      { name: "properties", valid },
      { name: "type", valid: true },
      { name: "title", valid: true },
    ],
    errors: [],
    droppedErrors: [],
    annotations: valid ? [1] : [],
    droppedAnnotations: valid ? [] : [1],
    children: [itemNode(ref), count],
  };
}

// The invalid instance rejects on `count`, which makes every title
// annotation irrelevant (draft-03 §12.2) — both land in `droppedAnnotations`.
const invalidInput: RenderInput = {
  errors: [COUNT_ERROR],
  droppedErrors: [],
  annotations: [],
  droppedAnnotations: TITLES,
  root: rootNode(false, refTargetNode(0, true), countNode(false)),
};

// The valid instance: no errors, both titles relevant.
const validInput: RenderInput = {
  errors: [],
  droppedErrors: [],
  annotations: TITLES,
  droppedAnnotations: [],
  root: rootNode(true, refTargetNode(0, false), countNode(true)),
};

describe("render-input contract, invalid instance", () => {
  it("renderHierarchical marks dropped records at the verbose level", () => {
    expect(renderHierarchical(invalidInput, "mark")).toEqual(
      golden("hierarchical-verbose.invalid"),
    );
  });

  it("renderHierarchical omits dropped records at the relevant level", () => {
    expect(renderHierarchical(invalidInput, "omit")).toEqual(
      golden("hierarchical.invalid"),
    );
  });

  it("renderList marks dropped records at the verbose level", () => {
    expect(renderList(invalidInput, "mark")).toEqual(
      golden("list-verbose.invalid"),
    );
  });

  it("renderList omits dropped records at the relevant level", () => {
    expect(renderList(invalidInput, "omit")).toEqual(golden("list.invalid"));
  });

  it("renderVerbose renders the full keyword-level tree", () => {
    expect(renderVerbose(invalidInput)).toEqual(golden("verbose.invalid"));
  });

  it("renderDetailed condenses to the relevant keyword-level tree", () => {
    expect(renderDetailed(invalidInput)).toEqual(golden("detailed.invalid"));
  });

  it("renderBasic reports the flat error list", () => {
    expect(renderBasic(false, ROOT_LOCATION, invalidInput.errors, [])).toEqual(
      golden("basic.invalid"),
    );
  });

  it("renderTrace mirrors the located tree with decoded segments", () => {
    const expected: TraceUnit = {
      segments: [],
      schemaLocation: ROOT_LOCATION,
      inputLocation: "",
      valid: false,
      errorIndexes: [],
      children: [
        {
          segments: ["properties", "item"],
          schemaLocation: `${ROOT_LOCATION}/properties/item`,
          inputLocation: "/item",
          valid: true,
          errorIndexes: [],
          children: [
            {
              segments: ["$ref"],
              schemaLocation: DEF_LOCATION,
              inputLocation: "/item",
              valid: true,
              errorIndexes: [],
              children: [
                {
                  segments: ["properties", "name"],
                  schemaLocation: `${DEF_LOCATION}/properties/name`,
                  inputLocation: "/item/name",
                  valid: true,
                  errorIndexes: [],
                  children: [],
                },
              ],
            },
          ],
        },
        {
          segments: ["properties", "count"],
          schemaLocation: `${ROOT_LOCATION}/properties/count`,
          inputLocation: "/count",
          valid: false,
          errorIndexes: [0],
          children: [],
        },
      ],
    };
    expect(renderTrace(invalidInput.root)).toEqual(expected);
  });
});

describe("render-input contract, valid instance", () => {
  it("renderHierarchical marks the relevant records at the verbose level", () => {
    expect(renderHierarchical(validInput, "mark")).toEqual(
      golden("hierarchical-verbose.valid"),
    );
  });

  it("renderHierarchical at the relevant level", () => {
    expect(renderHierarchical(validInput, "omit")).toEqual(
      golden("hierarchical.valid"),
    );
  });

  it("renderList at the verbose level", () => {
    expect(renderList(validInput, "mark")).toEqual(
      golden("list-verbose.valid"),
    );
  });

  it("renderList at the relevant level", () => {
    expect(renderList(validInput, "omit")).toEqual(golden("list.valid"));
  });

  it("renderVerbose renders the full keyword-level tree", () => {
    expect(renderVerbose(validInput)).toEqual(golden("verbose.valid"));
  });

  it("renderDetailed condenses to the relevant keyword-level tree", () => {
    expect(renderDetailed(validInput)).toEqual(golden("detailed.valid"));
  });

  it("renderBasic reports the flat annotation list", () => {
    expect(
      renderBasic(true, ROOT_LOCATION, [], validInput.annotations),
    ).toEqual(golden("basic.valid"));
  });
});

// A boolean-`false` schema has no keyword of its own: its error's
// evaluationPath equals its node's evaluationPath exactly (RenderNode's
// invariant collapses to zero added segments, not one). That must key as the
// empty-string keyword in hierarchical/list, and as the node's own `error`
// in detailed/verbose rather than a synthetic keyword child.
describe("boolean-false schema application", () => {
  const FALSE_SCHEMA_LOCATION = "https://false.example/schema#/properties/x";

  const falseSchemaError: ErrorUnit = {
    evaluationPath: "/properties/x",
    schemaLocation: FALSE_SCHEMA_LOCATION,
    inputLocation: "/x",
    error: "schema is false",
  };

  const child: RenderNode = {
    evaluationPath: "/properties/x",
    schemaLocation: FALSE_SCHEMA_LOCATION,
    inputLocation: "/x",
    valid: false,
    keywords: [],
    errors: [0],
    droppedErrors: [],
    annotations: [],
    droppedAnnotations: [],
    children: [],
  };

  const root: RenderNode = {
    evaluationPath: "",
    schemaLocation: "https://false.example/schema#",
    inputLocation: "",
    valid: false,
    keywords: [{ name: "properties", valid: false }],
    errors: [],
    droppedErrors: [],
    annotations: [],
    droppedAnnotations: [],
    children: [child],
  };

  const input: RenderInput = {
    errors: [falseSchemaError],
    droppedErrors: [],
    annotations: [],
    droppedAnnotations: [],
    root,
  };

  it("keys the error by the empty string in renderHierarchical", () => {
    const doc = renderHierarchical(input, "omit");
    expect(doc.details![0]!.errors).toEqual({ "": "schema is false" });
  });

  it("attaches the error to the node itself in renderVerbose", () => {
    const doc = renderVerbose(input);
    const propertiesKeyword = doc.errors![0]!;
    const childUnit = propertiesKeyword.errors![0]!;
    expect(childUnit.error).toBe("schema is false");
    expect(childUnit.errors).toBeUndefined();
    expect(childUnit.annotations).toBeUndefined();
  });
});
