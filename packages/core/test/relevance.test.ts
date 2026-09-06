// IETF draft-03 §12.2 relevance: a keyword that accepts makes its rejecting
// sub-evaluations irrelevant; a schema object that rejects makes its
// accepting sub-evaluations irrelevant. Non-verbose output omits irrelevant
// errors, annotations, and the units that end up empty (§13.4); modern
// verbose output marks them (`droppedErrors`/`droppedAnnotations`); the
// 2020-12 Verbose document is unchanged. Appendix D: dependency data comes
// only from an accepting producer.

import { describe, it, expect } from "vitest";
import {
  createEngine,
  type EvaluateOptions,
  type JsonValue,
  type OutputUnit,
  type Result,
} from "@jse/core";

function engineFor(schema: JsonValue, name: string) {
  const engine = createEngine();
  const slug = name.replace(/[^A-Za-z0-9]+/g, "-");
  const uri = engine.registerSchema(
    schema,
    `https://relevance.example/${slug}`,
  );
  return { engine, uri };
}

function run(
  schema: JsonValue,
  name: string,
  instance: JsonValue,
  options: EvaluateOptions,
): Result {
  const { engine, uri } = engineFor(schema, name);
  return engine.evaluate(uri, instance, options);
}

const LIST: EvaluateOptions = { output: "list" };
const BASIC: EvaluateOptions = { output: "list", locations: "2020-12" };
const HIER: EvaluateOptions = { output: "hierarchical" };
const VERBOSE: EvaluateOptions = { output: "hierarchical", verbose: true };
const DETAILED: EvaluateOptions = {
  output: "hierarchical",
  locations: "2020-12",
};
const VERBOSE_2020: EvaluateOptions = {
  output: "hierarchical",
  locations: "2020-12",
  verbose: true,
};

const errorTuples = (r: Result) =>
  (r.errors ?? []).map((e) => [e.evaluationPath, e.instanceLocation]);

function flatten(unit: OutputUnit): OutputUnit[] {
  const out: OutputUnit[] = [];
  const walk = (u: OutputUnit): void => {
    out.push(u);
    u.details?.forEach(walk);
  };
  walk(unit);
  return out;
}

const unitAt = (units: OutputUnit[], path: string): OutputUnit | undefined =>
  units.find((u) => (u.evaluationPath ?? u.keywordLocation) === path);

describe("errors under an accepting keyword are irrelevant", () => {
  const cases: {
    name: string;
    schema: JsonValue;
    instance: JsonValue;
    valid: boolean;
    /** relevant errors as [evaluationPath, instanceLocation], in order */
    errors: [string, string][];
    /** units carrying droppedErrors in modern verbose output: path -> keyword keys */
    dropped: Record<string, string[]>;
  }[] = [
    {
      name: "anyOf with one passing branch",
      schema: { anyOf: [{ type: "string" }, { type: "number" }] },
      instance: 5,
      valid: true,
      errors: [],
      dropped: { "/anyOf/0": ["type"] },
    },
    {
      name: "accepting anyOf inside a rejecting root",
      schema: { anyOf: [{ type: "string" }, { type: "number" }], minimum: 10 },
      instance: 5,
      valid: false,
      errors: [["/minimum", ""]],
      dropped: { "/anyOf/0": ["type"] },
    },
    {
      name: "oneOf with exactly one passing branch",
      schema: { oneOf: [{ type: "string" }, { type: "number" }, { const: 1 }] },
      instance: 5,
      valid: true,
      errors: [],
      dropped: { "/oneOf/0": ["type"], "/oneOf/2": ["const"] },
    },
    {
      name: "oneOf rejecting with two passing branches keeps the third's errors",
      schema: {
        oneOf: [{ type: "number" }, { minimum: 0 }, { type: "string" }],
      },
      instance: 5,
      valid: false,
      errors: [
        ["/oneOf/2/type", ""],
        ["/oneOf", ""],
      ],
      dropped: {},
    },
    {
      name: "not whose subschema rejects",
      schema: { not: { type: "string" } },
      instance: 5,
      valid: true,
      errors: [],
      dropped: { "/not": ["type"] },
    },
    {
      name: "not whose subschema accepts",
      schema: { not: { type: "number" } },
      instance: 5,
      valid: false,
      errors: [["/not", ""]],
      dropped: {},
    },
    {
      name: "if rejects, else accepts",
      schema: {
        if: { type: "string" },
        then: { minLength: 3 },
        else: { minimum: 3 },
      },
      instance: 5,
      valid: true,
      errors: [],
      dropped: { "/if": ["type"] },
    },
    {
      name: "if rejects, else rejects",
      schema: {
        if: { type: "string" },
        then: { minLength: 3 },
        else: { minimum: 3 },
      },
      instance: 1,
      valid: false,
      errors: [["/else/minimum", ""]],
      dropped: { "/if": ["type"] },
    },
    {
      name: "if accepts, then rejects",
      schema: {
        if: { type: "string" },
        then: { minLength: 3 },
        else: { minimum: 3 },
      },
      instance: "ab",
      valid: false,
      errors: [["/then/minLength", ""]],
      dropped: {},
    },
    {
      name: "contains accepting drops the non-matching items' errors",
      schema: { contains: { type: "string" } },
      instance: [1, "a", 2],
      valid: true,
      errors: [],
      dropped: { "/contains": ["type"] },
    },
    {
      name: "contains rejecting keeps the items' errors",
      schema: { contains: { type: "string" } },
      instance: [1, 2],
      valid: false,
      errors: [
        ["/contains/type", "/0"],
        ["/contains/type", "/1"],
        ["/contains", ""],
      ],
      dropped: {},
    },
    {
      name: "$ref into a rejecting branch",
      schema: {
        $defs: { s: { type: "string" } },
        anyOf: [{ $ref: "#/$defs/s" }, { type: "number" }],
      },
      instance: 5,
      valid: true,
      errors: [],
      dropped: { "/anyOf/0/$ref": ["type"] },
    },
    {
      name: "boolean false branch",
      schema: { anyOf: [false, true] },
      instance: 5,
      valid: true,
      errors: [],
      dropped: { "/anyOf/0": [""] },
    },
  ];

  for (const c of cases) {
    describe(c.name, () => {
      it("keeps only relevant errors in Result.errors and Basic", () => {
        const list = run(c.schema, c.name, c.instance, LIST);
        expect(list.valid).toBe(c.valid);
        expect(errorTuples(list)).toEqual(c.errors);
        const basic = run(c.schema, c.name, c.instance, BASIC);
        const basicErrors = (
          basic.outputDocument as { errors?: { keywordLocation: string }[] }
        ).errors;
        expect((basicErrors ?? []).map((e) => e.keywordLocation)).toEqual(
          c.errors.map(([path]) => path),
        );
      });

      it("prunes irrelevant units from non-verbose list, hierarchical, and Detailed", () => {
        const list = run(c.schema, c.name, c.instance, LIST)
          .outputDocument as OutputUnit[];
        const hier = flatten(
          run(c.schema, c.name, c.instance, HIER).outputDocument as OutputUnit,
        );
        const detailed = flatten(
          run(c.schema, c.name, c.instance, DETAILED)
            .outputDocument as OutputUnit,
        );
        for (const units of [list, hier, detailed]) {
          for (const path of Object.keys(c.dropped)) {
            expect(unitAt(units, path)).toBeUndefined();
          }
          for (const u of units) {
            expect(u.droppedErrors).toBeUndefined();
            expect(u.droppedAnnotations).toBeUndefined();
          }
          const relevantPaths = c.errors.map(([path]) =>
            path.slice(0, path.lastIndexOf("/")),
          );
          for (const path of relevantPaths) {
            const unit = unitAt(units, path);
            expect(unit, `unit at ${path}`).toBeDefined();
            expect(unit!.errors).toBeDefined();
          }
        }
      });

      it("marks irrelevant errors in modern verbose output", () => {
        const verboseList: EvaluateOptions = { ...VERBOSE, output: "list" };
        for (const options of [VERBOSE, verboseList]) {
          const doc = run(c.schema, c.name, c.instance, options).outputDocument;
          const units = Array.isArray(doc) ? doc : flatten(doc as OutputUnit);
          for (const [path, keys] of Object.entries(c.dropped)) {
            const unit = unitAt(units, path);
            expect(unit, `verbose unit at ${path}`).toBeDefined();
            expect(unit!.valid).toBe(false);
            expect(Object.keys(unit!.droppedErrors ?? {})).toEqual(keys);
            expect(unit!.errors).toBeUndefined();
          }
        }
      });

      it("leaves the 2020-12 Verbose document with every error under errors", () => {
        const units = flatten(
          run(c.schema, c.name, c.instance, VERBOSE_2020)
            .outputDocument as OutputUnit,
        );
        for (const [path, keys] of Object.entries(c.dropped)) {
          const unit = unitAt(units, path);
          expect(unit, `Verbose unit at ${path}`).toBeDefined();
          expect(Object.keys(unit!.errors ?? {})).toEqual(keys);
          expect(unit!.droppedErrors).toBeUndefined();
        }
      });
    });
  }
});

describe("if, then, and else are separate keyword evaluations", () => {
  it("then or else without if accepts", () => {
    expect(run({ then: { type: "string" } }, "then-alone", 5, LIST).valid).toBe(
      true,
    );
    expect(run({ else: { type: "string" } }, "else-alone", 5, LIST).valid).toBe(
      true,
    );
  });

  it("then and else read only the adjacent if, never a merged sub-application's", () => {
    // The allOf branch's `if` outcome merges into the parent frame (rule 3),
    // but `then` depends on a sibling `if` only (§12.3 same-scope dependency).
    const nested: JsonValue = {
      allOf: [{ if: { type: "string" } }],
      then: { minLength: 5 },
    };
    expect(run(nested, "then-nested-if", "ab", LIST).valid).toBe(true);
    const sibling: JsonValue = {
      allOf: [{ if: { type: "string" }, then: { minLength: 5 } }],
    };
    expect(run(sibling, "then-sibling-if", "ab", LIST).valid).toBe(false);
  });

  it("if without then/else accepts and keeps the condition's annotations when it accepts", () => {
    const schema: JsonValue = { if: { type: "string", title: "str" } };
    const yes = run(schema, "if-alone-yes", "x", {
      ...LIST,
      collectAnnotations: true,
    });
    expect(yes.valid).toBe(true);
    expect(
      yes.annotations!.map((a) => [a.evaluationPath, a.annotation]),
    ).toEqual([["/if/title", "str"]]);
    const no = run(schema, "if-alone-no", 5, {
      ...LIST,
      collectAnnotations: true,
    });
    expect(no.valid).toBe(true);
    expect(no.annotations).toEqual([]);
  });

  const coverage: JsonValue = {
    if: { required: ["a"], properties: { a: true } },
    then: { properties: { b: true } },
    else: { properties: { c: true } },
    unevaluatedProperties: false,
  };
  const island: JsonValue = {
    $defs: {
      cond: {
        $dynamicAnchor: "cond",
        required: ["a"],
        properties: { a: true },
      },
    },
    if: { $dynamicRef: "#cond" },
    then: { properties: { b: true } },
    else: { properties: { c: true } },
    unevaluatedProperties: false,
  };
  const verdicts: [JsonValue, boolean][] = [
    [{ a: 1, b: 2 }, true],
    [{ c: 3 }, true],
    [{ a: 1, c: 3 }, false],
    [{ b: 2 }, false],
  ];
  for (const [schema, name] of [
    [coverage, "if-coverage"],
    [island, "if-island"],
  ] as const) {
    it(`${name}: the condition's coverage merges only when it accepts`, () => {
      for (const [instance, valid] of verdicts) {
        expect(
          run(schema, name, instance, {}).valid,
          JSON.stringify(instance),
        ).toBe(valid);
        expect(run(schema, name, instance, LIST).valid).toBe(valid);
      }
    });
  }
});

describe("annotations under a rejecting ancestor are irrelevant", () => {
  const schema: JsonValue = {
    properties: { item: { title: "T" }, count: { type: "integer" } },
  };
  const instance: JsonValue = { item: 1, count: "x" };

  it("are absent from Result.annotations and non-verbose documents", () => {
    const list = run(schema, "reverse", instance, {
      ...LIST,
      collectAnnotations: true,
    });
    expect(list.valid).toBe(false);
    expect(list.annotations).toBeUndefined();
    const units = list.outputDocument as OutputUnit[];
    expect(unitAt(units, "/properties/item")).toBeUndefined();
    expect(unitAt(units, "/properties/count")!.errors).toEqual({
      type: expect.any(String) as string,
    });
    for (const u of units) expect(u.droppedAnnotations).toBeUndefined();
    const detailed = flatten(
      run(schema, "reverse", instance, DETAILED).outputDocument as OutputUnit,
    );
    expect(unitAt(detailed, "/properties/item")).toBeUndefined();
  });

  it("appear as droppedAnnotations at the valid unit in modern verbose output", () => {
    const units = flatten(
      run(schema, "reverse", instance, VERBOSE).outputDocument as OutputUnit,
    );
    const item = unitAt(units, "/properties/item")!;
    expect(item.valid).toBe(true);
    expect(item.annotations).toBeUndefined();
    expect(item.droppedAnnotations).toEqual({ title: "T" });
  });

  it("stay under annotations in the 2020-12 Verbose document", () => {
    const units = flatten(
      run(schema, "reverse", instance, VERBOSE_2020)
        .outputDocument as OutputUnit,
    );
    const item = unitAt(units, "/properties/item")!;
    expect(item.annotations).toEqual({ title: "T" });
    expect(item.droppedAnnotations).toBeUndefined();
  });

  it("an accepted branch's annotations under a rejecting object are dropped", () => {
    const s: JsonValue = { anyOf: [{ title: "t" }], type: "string" };
    const units = flatten(
      run(s, "branch-ann", 5, VERBOSE).outputDocument as OutputUnit,
    );
    const branch = unitAt(units, "/anyOf/0")!;
    expect(branch.valid).toBe(true);
    expect(branch.droppedAnnotations).toEqual({ title: "t" });
    const list = run(s, "branch-ann", 5, LIST).outputDocument as OutputUnit[];
    expect(unitAt(list, "/anyOf/0")).toBeUndefined();
  });
});

describe("the trace stays complete", () => {
  it("lists a rejecting branch with no error indexes", () => {
    const r = run(
      { anyOf: [{ type: "string" }, { type: "number" }], minimum: 10 },
      "trace",
      5,
      { output: "list", trace: true },
    );
    expect(r.valid).toBe(false);
    expect(r.errors!.map((e) => e.evaluationPath)).toEqual(["/minimum"]);
    const trace = r.trace!;
    const branch = trace.children.find((c) => c.segments[1] === "0")!;
    expect(branch.valid).toBe(false);
    expect(branch.errorIndexes).toEqual([]);
    expect(trace.errorIndexes).toEqual([0]);
  });
});

describe("dependency data comes only from an accepting producer (Appendix D)", () => {
  it("table 3 row 3: a rejecting properties leaves every name unevaluated", () => {
    const r = run(
      {
        properties: { X: { type: "number" }, Y: { type: "number" } },
        unevaluatedProperties: false,
      },
      "table3",
      { X: "hello", Y: "world" },
      LIST,
    );
    expect(r.valid).toBe(false);
    expect(errorTuples(r)).toEqual([
      ["/properties/X/type", "/X"],
      ["/properties/Y/type", "/Y"],
      ["/unevaluatedProperties", "/X"],
      ["/unevaluatedProperties", "/Y"],
    ]);
  });

  it("table 5 row 4 (erratum): a rejecting prefixItems leaves every index unevaluated", () => {
    const r = run(
      {
        $ref: "#/$defs/log",
        unevaluatedItems: false,
        $defs: {
          log: {
            prefixItems: [
              { type: "string" },
              { type: "string" },
              { type: "string" },
            ],
          },
        },
      },
      "table5",
      ["2026-06-24T10:00:00Z", 42],
      LIST,
    );
    expect(r.valid).toBe(false);
    expect(errorTuples(r)).toEqual([
      ["/$ref/prefixItems/1/type", "/1"],
      ["/unevaluatedItems", "/0"],
      ["/unevaluatedItems", "/1"],
    ]);
  });

  it("an accepting contains reports only the matched positions", () => {
    const r = run(
      { contains: { type: "string" }, unevaluatedItems: false },
      "contains-subset",
      [1, "a"],
      LIST,
    );
    expect(r.valid).toBe(false);
    expect(errorTuples(r)).toEqual([["/unevaluatedItems", "/0"]]);
  });
});

describe("verdicts do not depend on output mode or annotation settings", () => {
  const fixtures: [string, JsonValue, JsonValue][] = [
    [
      "anyOf",
      { anyOf: [{ type: "string" }, { type: "number" }], minimum: 10 },
      5,
    ],
    [
      "if",
      { if: { type: "string" }, then: { minLength: 3 }, else: { minimum: 3 } },
      1,
    ],
    [
      "contains",
      { contains: { type: "string" }, unevaluatedItems: false },
      [1, "a"],
    ],
    [
      "unevaluated",
      { properties: { X: { type: "number" } }, unevaluatedProperties: false },
      { X: "hello" },
    ],
  ];
  const modes: EvaluateOptions[] = [
    {},
    LIST,
    BASIC,
    HIER,
    VERBOSE,
    DETAILED,
    VERBOSE_2020,
    { ...LIST, collectAnnotations: true },
    { ...LIST, collectAnnotations: true, retention: { keywords: [] } },
    { collectAnnotations: true, retention: { keywords: ["title"] } },
  ];
  for (const [name, schema, instance] of fixtures) {
    it(name, () => {
      const verdicts = new Set(
        modes.map((m) => run(schema, `invariance-${name}`, instance, m).valid),
      );
      expect(verdicts.size).toBe(1);
    });
  }
});
