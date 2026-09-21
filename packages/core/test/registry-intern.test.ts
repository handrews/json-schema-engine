// SchemaRef interning: within one registry generation, every lookup that
// lands on a location returns the same object, so caches can key on ref
// identity. A registration evicts the affected resource's refs; a snapshot
// keeps the objects it was taken with; two schema objects claiming one
// location fall back to uncached refs.

import { describe, it, expect } from "vitest";
import { createEngine } from "@json-schema-engine/core";

describe("SchemaRef interning", () => {
  it("returns one object per location across rootRef, resolveRef, child, and anchors", () => {
    const engine = createEngine();
    const uri = engine.registerSchema(
      { $defs: { x: { $anchor: "ax", $dynamicAnchor: "dx", type: "string" } } },
      "https://intern.example/a",
    );
    const reg = engine.registry;
    const root = reg.rootRef(uri);
    expect(reg.rootRef(uri)).toBe(root);
    expect(reg.resolveRef("#", uri)).toBe(root);
    expect(reg.resolveRef(uri, uri)).toBe(root);
    expect(root.key).toBe(`${uri}#`);

    const x = reg.resolveRef("#/$defs/x", uri);
    expect(reg.child(root, ["$defs", "x"])).toBe(x);
    expect(reg.child(reg.child(root, ["$defs"]), ["x"])).toBe(x);
    expect(reg.resolveRef("#ax", uri)).toBe(x);
    expect(reg.resolveRef("#dx", uri)).toBe(x);
    expect(reg.dynamicAnchor(uri, "dx")).toBe(x);
    expect(x.key).toBe(`${uri}#/$defs/x`);
  });

  it("interns an $id-rebased child as the nested resource's root", () => {
    const engine = createEngine();
    const uri = engine.registerSchema(
      {
        $defs: { n: { $id: "https://intern.example/nested", type: "string" } },
      },
      "https://intern.example/b",
    );
    const reg = engine.registry;
    const viaChild = reg.child(reg.rootRef(uri), ["$defs", "n"]);
    expect(viaChild.baseUri).toBe("https://intern.example/nested");
    expect(viaChild.pointer).toBe("");
    expect(reg.rootRef("https://intern.example/nested")).toBe(viaChild);
    expect(reg.resolveRef("#/$defs/n", uri)).toBe(viaChild);
  });

  it("keeps a raw retrieval URI and its declared $id on one object", () => {
    const engine = createEngine();
    const uri = engine.registerSchema(
      { $id: "https://intern.example/declared" },
      "https://intern.example/retrieval",
    );
    expect(uri).toBe("https://intern.example/declared");
    const reg = engine.registry;
    expect(reg.rootRef("https://intern.example/retrieval")).toBe(
      reg.rootRef(uri),
    );
  });

  it("mints new objects on re-registration while a snapshot keeps the old", () => {
    const engine = createEngine();
    const r = engine.registerSchema(
      { $defs: { x: { type: "string" } } },
      "https://intern.example/c",
    );
    const reg = engine.registry;
    const oldRoot = reg.rootRef(r);
    const oldX = reg.resolveRef("#/$defs/x", r);
    const view = reg.snapshot();
    expect(view.rootRef(r)).toBe(oldRoot);
    engine.registerSchema(
      { $defs: { x: { type: "integer" } } },
      "https://intern.example/c",
    );
    const newRoot = reg.rootRef(r);
    expect(newRoot).not.toBe(oldRoot);
    expect(newRoot.node).toEqual({ $defs: { x: { type: "integer" } } });
    expect(reg.resolveRef("#/$defs/x", r)).not.toBe(oldX);
    expect(reg.resolveRef("#/$defs/x", r).node).toEqual({ type: "integer" });
    expect(view.rootRef(r)).toBe(oldRoot);
    expect(view.resolveRef("#/$defs/x", r)).toBe(oldX);
    expect(view.child(oldRoot, ["$defs", "x"])).toBe(oldX);
  });

  it("does not re-intern under a stale ref: navigation from it yields uncached refs with its nodes", () => {
    const engine = createEngine();
    const r = engine.registerSchema(
      { $defs: { x: { type: "string" } } },
      "https://intern.example/d",
    );
    const reg = engine.registry;
    const stale = reg.rootRef(r);
    engine.registerSchema(
      { $defs: { x: { type: "integer" } } },
      "https://intern.example/d",
    );
    const fromStale = reg.child(stale, ["$defs", "x"]);
    expect(fromStale.node).toEqual({ type: "string" });
    const current = reg.resolveRef("#/$defs/x", r);
    expect(current.node).toEqual({ type: "integer" });
    expect(reg.child(stale, ["$defs", "x"])).not.toBe(current);
    expect(reg.resolveRef("#/$defs/x", r)).toBe(current);
  });

  it("gives duplicate $id declarations distinct refs with the right nodes", () => {
    const engine = createEngine();
    const dup = "https://intern.example/dup";
    const a = engine.registerSchema(
      { $defs: { one: { $id: dup, type: "string" } } },
      "https://intern.example/e1",
    );
    const b = engine.registerSchema(
      { $defs: { two: { $id: dup, type: "integer" } } },
      "https://intern.example/e2",
    );
    const reg = engine.registry;
    const viaA = reg.child(reg.rootRef(a), ["$defs", "one"]);
    const viaB = reg.child(reg.rootRef(b), ["$defs", "two"]);
    expect(viaA.node).toEqual({ $id: dup, type: "string" });
    expect(viaB.node).toEqual({ $id: dup, type: "integer" });
    expect(viaA).not.toBe(viaB);
    // The registered document wins for direct lookups, as before.
    expect(reg.rootRef(dup).node).toEqual({ $id: dup, type: "integer" });
    expect(reg.rootRef(dup)).toBe(viaB);
  });

  it("does not intern a position past the document", () => {
    const engine = createEngine();
    const uri = engine.registerSchema(
      { properties: { a: true } },
      "https://intern.example/f",
    );
    const reg = engine.registry;
    const root = reg.rootRef(uri);
    const missing = reg.child(root, ["properties", "b"]);
    expect(missing.node).toBeUndefined();
    expect(missing.key).toBeUndefined();
    expect(reg.child(root, ["properties", "b"])).not.toBe(missing);
    expect(reg.child(root, ["properties", "a"])).toBe(
      reg.child(root, ["properties", "a"]),
    );
  });
});
