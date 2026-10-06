// Error message building (D13): the formatting helpers, and the guarantee
// that `realize` — the interpreter's side — produces exactly what the
// compiled evaluator builds from the same description.

import { describe, it, expect } from "vitest";
import {
  createEngine,
  lowerIR,
  type Description,
  type JsonValue,
  type KeywordBehavior,
  PREVIEW_LIMIT,
  preview,
  realize,
} from "@json-schema-engine/core";
import { compileEvaluator } from "@json-schema-engine/compiler";
import {
  apparentType,
  countedIndexes,
  dependencyList,
  duplicateGroups,
  indexGroups,
  indexRanges,
  labeledNames,
  missingDependencies,
  missingNames,
  nameList,
  ranges,
  typedPreview,
} from "../src/messages.js";

describe("the formatting helpers", () => {
  it("preview is compact JSON", () => {
    expect(preview({ a: true, b: [1, 2.5, null] })).toBe(
      '{"a": true, "b": [1, 2.5, null]}',
    );
    expect(preview("é\n")).toBe('"é\\n"');
    expect(preview(-0)).toBe("0");
    expect(preview(1e21)).toBe("1e+21");
  });

  it("preview cuts at the limit", () => {
    const text = preview("x".repeat(1000));
    expect(Array.from(text)).toHaveLength(PREVIEW_LIMIT);
    expect(text.endsWith("…")).toBe(true);
    expect(text.startsWith('"xxx')).toBe(true);
    const exact = "y".repeat(PREVIEW_LIMIT - 2); // with its quotes, exactly the limit
    expect(preview(exact)).toBe(`"${exact}"`);
    // Code points, not UTF-16 units: an astral character is one.
    const clefs = "𝄞".repeat(PREVIEW_LIMIT);
    expect(Array.from(preview(clefs))).toHaveLength(PREVIEW_LIMIT);
  });

  it("preview is bounded on huge containers", () => {
    // Walked only as far as it is shown: a million items cost no more.
    const huge: JsonValue = Array.from({ length: 1_000_000 }, (_, i) => i);
    expect(Array.from(preview(huge))).toHaveLength(PREVIEW_LIMIT);
    const wide: JsonValue = Object.fromEntries(
      Array.from({ length: 100_000 }, (_, i) => [`k${i}`, i]),
    );
    expect(Array.from(preview(wide))).toHaveLength(PREVIEW_LIMIT);
  });

  it("apparentType and typedPreview", () => {
    expect(apparentType(3)).toBe("integer");
    expect(apparentType(3.0)).toBe("integer");
    expect(apparentType(3.5)).toBe("number");
    expect(apparentType(true)).toBe("boolean");
    expect(apparentType(null)).toBe("null");
    expect(apparentType([])).toBe("array");
    expect(typedPreview(3)).toBe("3 (integer)");
    expect(typedPreview(2.5)).toBe("2.5 (number)");
    expect(typedPreview("a")).toBe('"a" (string)');
    expect(typedPreview(true)).toBe("true (boolean)");
    expect(typedPreview(null)).toBe("null (null)");
    expect(typedPreview([1])).toBe("array");
    expect(typedPreview({ a: 1 })).toBe("object");
  });

  it("indexRanges and ranges", () => {
    expect(indexRanges([5, 1, 2, 3, 7, 8, 9])).toBe("1-3, 5, 7-9");
    expect(indexRanges([4])).toBe("4");
    expect(indexRanges([0, 1, 3, 4, 5])).toBe("0, 1, 3-5");
    expect(indexRanges([])).toBe("none");
    expect(ranges([1, 2, 3, 5])).toEqual([
      [1, 3],
      [5, 5],
    ]);
    expect(countedIndexes([], "item", "items")).toBe("none");
    expect(countedIndexes([4], "item", "items")).toBe("1 item (4)");
    expect(countedIndexes([0, 3], "item", "items")).toBe("2 items (0, 3)");
  });

  it("nameList caps the names", () => {
    expect(nameList(["a", "b"])).toBe('"a", "b"');
    const names = Array.from({ length: 13 }, (_, i) => `p${i}`);
    expect(nameList(names).endsWith('"p9" and 3 more')).toBe(true);
    expect(labeledNames(["b"], "property", "properties")).toBe('property "b"');
    expect(labeledNames(["b", "c"], "property", "properties")).toBe(
      'properties "b", "c"',
    );
  });

  it("duplicateGroups finds every group", () => {
    expect(
      duplicateGroups([1, "a", 1.0, { x: [1] }, "a", 2, { x: [1] }, 1]),
    ).toEqual([
      [0, 2, 7],
      [1, 4],
      [3, 6],
    ]);
    expect(duplicateGroups([true, 1, false, 0])).toEqual([]);
    expect(
      indexGroups([
        [0, 2, 5],
        [1, 3],
      ]),
    ).toBe("[0, 2, 5] are equal; [1, 3] are equal");
  });

  it("missing names and dependencies", () => {
    expect(missingNames({ b: 1 }, ["a", "b", "c", 7])).toEqual(["a", "c"]);
    expect(missingNames(3, ["a"])).toEqual([]);
    expect(
      missingDependencies(
        { a: 1, d: 1 },
        { a: ["b", "c"], d: ["e"], z: ["q"] },
      ),
    ).toEqual({ a: ["b", "c"], d: ["e"] });
    expect(dependencyList({ a: ["b", "c"], d: ["e"] })).toBe(
      '"a" requires "b", "c"; "d" requires "e"',
    );
  });
});

// --- realize matches the compiled evaluator ---------------------------------

const EXPLAIN_VOCAB = "urn:test:vocab:explain";
const BASE_VOCABS = [
  "https://json-schema.org/draft/2020-12/vocab/core",
  "https://json-schema.org/draft/2020-12/vocab/applicator",
];

const DESCRIPTION: Description = {
  message: [
    "got ",
    lowerIR.helper("preview", lowerIR.instance),
    " (",
    lowerIR.helper("apparentType", lowerIR.instance),
    ")",
  ],
  params: {
    value: lowerIR.instance,
    kind: lowerIR.helper("apparentType", lowerIR.instance),
    limit: lowerIR.constant(2.5),
  },
};

const explain: KeywordBehavior = {
  id: EXPLAIN_VOCAB + "#explain",
  evaluate: (_value, _cursor, ctx) => {
    ctx.report(() => DESCRIPTION);
    return false;
  },
  lower: (_value, lctx) => {
    lctx.emit(lowerIR.failDescribed(DESCRIPTION));
  },
};

function explainingEngine() {
  const engine = createEngine();
  engine.registerVocabulary(EXPLAIN_VOCAB, { explain });
  const dialect = "urn:test:dialect:explain";
  engine.registerDialect(dialect, [...BASE_VOCABS, EXPLAIN_VOCAB]);
  return { engine, dialect };
}

describe("realize", () => {
  it("evaluates a description against the instance", () => {
    expect(realize(DESCRIPTION, [1, 2])).toEqual({
      message: "got [1, 2] (array)",
      params: { value: [1, 2], kind: "array", limit: 2.5 },
    });
    expect(realize(DESCRIPTION, "x", false)).toEqual({
      message: 'got "x" (string)',
      params: undefined,
    });
  });

  it("refuses compiled-only data", () => {
    expect(() => realize({ message: [{ kind: "binding", id: 0 }] }, 1)).toThrow(
      /constants/,
    );
    expect(() => realize({ message: [{ kind: "tally" }] }, 1)).toThrow(
      /constants/,
    );
  });

  it("matches the compiled evaluator for every JSON shape", () => {
    const { engine, dialect } = explainingEngine();
    const uri = engine.registerSchema(
      { explain: true },
      "urn:test:explain",
      dialect,
    );
    const compiled = compileEvaluator(engine, uri, { errorParams: true });
    const instances: JsonValue[] = [
      null,
      true,
      0,
      -0,
      3,
      2.5,
      1e21,
      "",
      'a"b\\c\n',
      "x".repeat(200),
      [],
      [1, [2, [3]]],
      {},
      { a: 1, b: { c: [null] } },
      Array.from({ length: 1000 }, (_, i) => ({ i })),
    ];
    for (const instance of instances) {
      const interpreted = engine.evaluate(uri, instance, {
        output: "list",
        errorParams: true,
      });
      expect(compiled.evaluate(instance, { output: "list" })).toEqual(
        interpreted,
      );
      expect(interpreted.errors![0]!.error.startsWith("got ")).toBe(true);
    }
  });

  it("realizes a reported description only when it is rendered", () => {
    let calls = 0;
    const lazy: KeywordBehavior = {
      id: EXPLAIN_VOCAB + "#lazy",
      evaluate: (_value, _cursor, ctx) => {
        ctx.report(() => {
          calls++;
          return DESCRIPTION;
        });
        return false;
      },
    };
    const engine = createEngine();
    engine.registerVocabulary(EXPLAIN_VOCAB, { lazy });
    const dialect = "urn:test:dialect:lazy";
    engine.registerDialect(dialect, [...BASE_VOCABS, EXPLAIN_VOCAB]);
    const uri = engine.registerSchema(
      { anyOf: [{ lazy: true }, {}] },
      "urn:test:lazy",
      dialect,
    );
    // A dropped error (the losing branch) and a verdict-only evaluation
    // never render, so the description is never built.
    expect(engine.evaluate(uri, [1, 2]).valid).toBe(true);
    expect(engine.evaluate(uri, [1, 2], { output: "list" }).valid).toBe(true);
    const lone = engine.registerSchema(
      { lazy: true },
      "urn:test:lazy-lone",
      dialect,
    );
    expect(engine.evaluate(lone, [1, 2]).valid).toBe(false);
    expect(calls).toBe(0);
    const result = engine.evaluate(lone, [1, 2], { output: "list" });
    expect(calls).toBe(1);
    expect(result.errors![0]!.error).toBe("got [1, 2] (array)");
  });
});
