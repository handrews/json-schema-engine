// Coverage-channel folds (COMPILED-CONSUMERS.md phase A): the compiled tier's
// port of the consumer keywords' channel-reading semantics. Shape-dispatched
// folds over a flat mixed names+indexes channel, plus island harvest. The
// differential case pins a fold against what the interpreter's consumer
// actually skips on the same instance.

import { describe, it, expect } from "vitest";
import {
  createEngine,
  evaluateFragment,
  foldNameCoverage,
  foldIndexCoverage,
  harvestCoverage,
  rootCursor,
  type DependencyRecord,
} from "@json-schema-engine/core";

describe("foldNameCoverage", () => {
  const cases: { name: string; channel: unknown[]; expected: string[] }[] = [
    { name: "single string[]", channel: [["a", "b"]], expected: ["a", "b"] },
    {
      name: "unions multiple string[] entries",
      channel: [["a"], ["b", "c"], ["a"]],
      expected: ["a", "b", "c"],
    },
    { name: "empty array is a no-op", channel: [[]], expected: [] },
    {
      name: "ignores true / number / number[] entries",
      channel: [true, 3, [0, 1], ["keep"]],
      expected: ["keep"],
    },
    {
      name: "mixed names+indexes channel keeps only names",
      channel: [["a"], 2, ["b"], true, [4, 5]],
      expected: ["a", "b"],
    },
  ];
  for (const c of cases) {
    it(c.name, () => {
      expect([...foldNameCoverage(c.channel)].sort()).toEqual(
        [...c.expected].sort(),
      );
    });
  }
});

describe("foldIndexCoverage", () => {
  const cases: {
    name: string;
    channel: unknown[];
    length: number;
    prefix: number;
    idx: number[];
  }[] = [
    {
      name: "true covers the whole array (prefix = length)",
      channel: [true],
      length: 5,
      prefix: 5,
      idx: [],
    },
    {
      name: "number n covers prefix n+1",
      channel: [2],
      length: 5,
      prefix: 3,
      idx: [],
    },
    {
      name: "number entries max-fold",
      channel: [1, 4, 2],
      length: 6,
      prefix: 5,
      idx: [],
    },
    {
      name: "number[] marks individual indexes",
      channel: [[0, 3]],
      length: 5,
      prefix: 0,
      idx: [0, 3],
    },
    {
      name: "string[] and [] are no-ops",
      channel: [["a", "b"], []],
      length: 4,
      prefix: 0,
      idx: [],
    },
    {
      name: "mixed channel: prefix from number/true, idx from number[]",
      channel: [1, [4], ["ignored"], 2],
      length: 6,
      prefix: 3,
      idx: [4],
    },
    {
      name: "true wins the prefix even alongside a smaller number",
      channel: [2, true],
      length: 7,
      prefix: 7,
      idx: [],
    },
  ];
  for (const c of cases) {
    it(c.name, () => {
      const { coveredPrefix, coveredIdx } = foldIndexCoverage(
        c.channel,
        c.length,
      );
      expect(coveredPrefix).toBe(c.prefix);
      expect([...coveredIdx].sort((a, b) => a - b)).toEqual(c.idx);
    });
  }
});

describe("harvestCoverage", () => {
  // A minimal DependencyRecord with only the fields harvest reads.
  const prod = (
    behaviorId: string,
    cursor: DependencyRecord["cursor"],
    data: unknown,
  ): DependencyRecord =>
    ({ kind: "dependency", behaviorId, cursor, data }) as DependencyRecord;

  it("filters by cursor identity AND consumedIds, passing data untouched", () => {
    const here = rootCursor({ a: 1 });
    const elsewhere = rootCursor({ a: 1 });
    const consumed = new Set(["prop", "pattern"]);
    const namesValue = ["a", "b"];
    const dependencies = [
      prod("prop", here, namesValue), // kept
      prod("pattern", here, ["x"]), // kept
      prod("prop", elsewhere, ["z"]), // wrong cursor
      prod("other", here, ["q"]), // not consumed
      prod("prop", here, true), // kept, data passed through
    ];
    const out = harvestCoverage(dependencies, here, consumed);
    expect(out).toEqual([["a", "b"], ["x"], true]);
    // Values are the same references, not copies.
    expect(out[0]).toBe(namesValue);
  });

  it("returns [] when nothing matches", () => {
    const here = rootCursor([]);
    expect(harvestCoverage([], here, new Set(["prop"]))).toEqual([]);
  });
});

describe("differential: fold equals the interpreter consumer's skip set", () => {
  it("name coverage harvested from producers matches what unevaluatedProperties skips", () => {
    const engine = createEngine();
    // Producer-only fragment: properties + patternProperties, no consumer.
    const producerUri = engine.registerSchema(
      {
        $defs: {
          producers: {
            properties: { a: true, b: true },
            patternProperties: { "^x": true },
          },
        },
      },
      "https://cov.example/producers",
    );
    // Full schema adding the consumer as a false subschema: every UNcovered
    // property fails, so its error locations reveal the interpreter's actual
    // skip (covered) set independently of the fold under test.
    const consumerUri = engine.registerSchema(
      {
        properties: { a: true, b: true },
        patternProperties: { "^x": true },
        unevaluatedProperties: false,
      },
      "https://cov.example/consumer",
    );

    const instance = { a: 1, b: 2, xy: 3, c: 4, d: 5 };

    // 1. Harvest producer records at the fragment root and fold them.
    const target = engine.registry.resolveRef(
      `${producerUri}#/$defs/producers`,
      producerUri,
    );
    const cursor = rootCursor(instance);
    const { dependencies } = evaluateFragment(engine.registry, target, cursor);
    const folded = foldNameCoverage(
      harvestCoverage(dependencies, cursor, engine.registry.consumedIds()),
    );

    // 2. Independent interpreter observation: the names the consumer applied
    //    to (i.e. did NOT skip) are exactly those with an error under `false`.
    const result = engine.evaluate(consumerUri, instance, { output: "list" });
    expect(result.valid).toBe(false);
    const appliedTo = new Set(
      result.errors!.map((e) => e.inputLocation.slice(1)),
    );
    const skipped = new Set(
      Object.keys(instance).filter((k) => !appliedTo.has(k)),
    );

    // 3. Pin the hand-derived expectation, then assert both agree with it.
    const expected = new Set(["a", "b", "xy"]);
    expect(skipped).toEqual(expected);
    expect(folded).toEqual(expected);
  });
});
