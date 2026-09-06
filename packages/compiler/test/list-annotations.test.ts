// Compiled annotation collection (COMPILED-ANNOTATIONS.md stage 2): the
// artifact's annotation surface is interpreter-exact. Each case compiles a
// schema and compares evaluateList(x).annotations (and the Basic document's
// annotation side) against Engine.evaluate(..., { output: "list",
// annotations }) — same units, same ORDER, same presence/absence of the
// annotations key. Order and presence are the whole contract (channel rule 3
// falls out of mark/truncate), so equality is strict and deep.

import { describe, it, expect } from "vitest";
import {
  createEngine,
  type AnnotationSelection,
  type JsonValue,
} from "@jse/core";
import { compileList } from "@jse/compiler";

let counter = 0;
const freshUri = (): string => `https://ann.example/s${String(counter++)}`;

/** Compile + interpret one instance; assert valid + annotations key match exactly. */
function expectMatch(
  schema: JsonValue,
  instance: JsonValue,
  selection?: AnnotationSelection,
): { valid: boolean; annotations?: readonly unknown[] } {
  const engine = createEngine();
  const uri = engine.registerSchema(schema, freshUri());
  const annotations = selection ?? true;
  const artifact = compileList(engine, uri, { annotations });
  const compiled = artifact.evaluateList(instance);
  const interpreted = engine.evaluate(uri, instance, {
    output: "list",
    annotations,
  });

  expect(compiled.valid).toBe(interpreted.valid);
  // Presence/absence of the annotations key is part of the contract.
  expect("annotations" in compiled).toBe(interpreted.annotations !== undefined);
  expect(compiled.annotations).toStrictEqual(interpreted.annotations);
  return compiled;
}

describe("compiled annotations vs interpreter", () => {
  it("collects title/const annotations at nested positions", () => {
    const schema = {
      title: "root",
      properties: {
        a: { title: "a-title", const: 7 },
        b: { properties: { c: { title: "c-title" } } },
      },
    };
    const r = expectMatch(schema, { a: 7, b: { c: 1 } });
    expect(r.valid).toBe(true);
    // Sanity: the nested title actually shows up (not a vacuous empty match).
    expect(
      (r.annotations ?? []).some(
        (u) => (u as { keyword: string }).keyword === "title",
      ),
    ).toBe(true);
  });

  it("collects property-name arrays (properties/patternProperties/additionalProperties)", () => {
    const schema = {
      properties: { a: true },
      patternProperties: { "^x": true },
      additionalProperties: true,
    };
    expectMatch(schema, { a: 1, xy: 2, other: 3 });
    // A name matching a pattern and a fixed property both land in the right
    // buckets, deduped keep-first.
    expectMatch(
      { patternProperties: { "^a": true, a$: true } },
      { a: 1, ab: 2, ba: 3 },
    );
  });

  it("renders prefixItems/items/contains index annotations", () => {
    expectMatch(
      {
        prefixItems: [{ title: "t0" }, { title: "t1" }],
        items: { title: "rest" },
      },
      [1, 2, 3, 4],
    );
    // prefixItems covering the whole array renders `true`.
    expectMatch({ prefixItems: [true, true] }, [1, 2]);
    // contains: matched-index list, and `true` when every item matches.
    expectMatch({ contains: { type: "number" } }, [1, "x", 2]);
    expectMatch({ contains: { type: "number" } }, [1, 2, 3]);
    expectMatch({ contains: { type: "number" }, minContains: 2 }, ["a", 1, 2]);
  });

  it("drops a failing anyOf branch's annotations, keeps the passing branch's (order-exact)", () => {
    const schema = {
      anyOf: [
        { title: "branch-A", type: "string" },
        { title: "branch-B", type: "number" },
      ],
    };
    // Only branch-B passes; branch-A's title must not appear.
    const r = expectMatch(schema, 42);
    const keywords = (r.annotations ?? []).map(
      (u) => (u as { annotation: unknown }).annotation,
    );
    expect(keywords).toContain("branch-B");
    expect(keywords).not.toContain("branch-A");
  });

  it("handles if/then annotation merge", () => {
    const schema = {
      if: { type: "number", title: "cond" },
      then: { title: "then-branch", minimum: 0 },
      else: { title: "else-branch" },
    };
    expectMatch(schema, 5); // if passes -> then
    expectMatch(schema, "x"); // if fails -> else
  });

  it("harvests annotations from an interpreted $dynamicRef island", () => {
    const schema = {
      $id: "https://ann.example/dyn",
      $defs: {
        node: { $dynamicAnchor: "node", title: "node-title" },
      },
      title: "outer",
      properties: {
        child: { $dynamicRef: "#node" },
      },
    };
    const engine = createEngine();
    const uri = engine.registerSchema(schema, "https://ann.example/dyn-root");
    const artifact = compileList(engine, uri, { annotations: true });
    // The island must actually be interpreted (a trampoline target exists).
    expect(artifact.plan.targets.length).toBeGreaterThan(0);
    const instance = { child: {} };
    const compiled = artifact.evaluateList(instance);
    const interpreted = engine.evaluate(uri, instance, {
      output: "list",
      annotations: true,
    });
    expect(compiled.valid).toBe(interpreted.valid);
    expect(compiled.annotations).toStrictEqual(interpreted.annotations);
    // The harvested island title is re-rooted under /child.
    expect(
      (compiled.annotations ?? []).some(
        (u) =>
          (u as { annotation: unknown }).annotation === "node-title" &&
          (u as { inputLocation: string }).inputLocation === "/child",
      ),
    ).toBe(true);
  });

  it("collects unknown keywords as annotations", () => {
    const schema = { "x-foo": { any: "value" }, title: "t" };
    const r = expectMatch(schema, {});
    expect(
      (r.annotations ?? []).some(
        (u) => (u as { keyword: string }).keyword === "x-foo",
      ),
    ).toBe(true);
  });

  it("applies retention allow-lists and keep predicates", () => {
    const schema = {
      title: "root",
      properties: { a: { title: "a" } },
      description: "desc",
    };
    // Allow-list: only `title` survives the static lists.
    expectMatch(schema, { a: 1 }, { keywords: ["title"] });
    // keep predicate: drop everything whose keyword is `title`.
    expectMatch(schema, { a: 1 }, { keep: (u) => u.keyword !== "title" });
    // Both together.
    expectMatch(
      schema,
      { a: 1 },
      {
        keywords: ["title", "description"],
        keep: (u) => u.keyword !== "description",
      },
    );
  });

  it("puts annotations on the Basic document only when valid and non-empty", () => {
    const engine = createEngine();
    const schema = { title: "root", properties: { a: { title: "a" } } };
    const uri = engine.registerSchema(schema, freshUri());
    const artifact = compileList(engine, uri, { annotations: true });

    const cValid = artifact.basic({ a: 1 });
    const iValid = engine.evaluate(
      uri,
      { a: 1 },
      {
        output: "basic",
        annotations: true,
      },
    ).outputDocument;
    expect(cValid).toStrictEqual(iValid);
    expect(cValid.annotations).toBeDefined();
  });

  it("omits annotations on invalid instances", () => {
    const schema = { title: "t", type: "string" };
    const r = expectMatch(schema, 42);
    expect(r.valid).toBe(false);
    expect("annotations" in r).toBe(false);
  });

  it("returns a present-but-empty annotations array on valid with no producers", () => {
    // `type` produces nothing; a valid instance yields an empty annotations array.
    const r = expectMatch({ type: "number" }, 3);
    expect(r.valid).toBe(true);
    expect(r.annotations).toStrictEqual([]);
  });
});
