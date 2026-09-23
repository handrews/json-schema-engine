// Registry snapshots (E1): a compiled artifact binds to a read-only view of
// both registries taken at compile time, so a compilation boundary cannot
// change reference resolution or dialect lookup. A view shares the source's
// indexes copy-on-write and is frozen at the moment it is taken.

import { describe, it, expect } from "vitest";
import {
  createEngine,
  DialectRegistry,
  ReadOnlyRegistryError,
  UnknownDialectError,
  UnresolvableRefError,
  type KeywordBehavior,
} from "@json-schema-engine/core";

const CORE = "https://json-schema.org/draft/2020-12/vocab/core";

describe("SchemaRegistry.snapshot", () => {
  it("is read-only", () => {
    const engine = createEngine();
    const view = engine.registry.snapshot();
    expect(() =>
      view.register({ type: "string" }, "https://snap.example/x"),
    ).toThrow(ReadOnlyRegistryError);
  });

  it("does not see registrations made after it", () => {
    const engine = createEngine();
    const a = engine.registerSchema(
      { $ref: "https://snap.example/b" },
      "https://snap.example/a",
    );
    const view = engine.registry.snapshot();
    engine.registerSchema({ type: "string" }, "https://snap.example/b");
    expect(engine.registry.has("https://snap.example/b")).toBe(true);
    expect(view.has("https://snap.example/b")).toBe(false);
    expect(() => view.rootRef("https://snap.example/b")).toThrow(
      UnresolvableRefError,
    );
    expect(() => view.resolveRef("https://snap.example/b", a)).toThrow(
      UnresolvableRefError,
    );
    expect(view.rootRef(a).pointer).toBe("");
    // A later view sees the new resource; the earlier one still does not.
    const later = engine.registry.snapshot();
    expect(later.has("https://snap.example/b")).toBe(true);
    expect(view.has("https://snap.example/b")).toBe(false);
  });

  it("keeps the replaced resource when the source unregisters and re-registers a URI", () => {
    const engine = createEngine();
    const r = engine.registerSchema(
      { type: "string", $anchor: "old" },
      "https://snap.example/r",
    );
    const view = engine.registry.snapshot();
    engine.unregisterSchema(r);
    expect(engine.registry.has(r)).toBe(false);
    expect(view.rootRef(r).node).toEqual({ type: "string", $anchor: "old" });
    engine.registerSchema(
      { type: "integer", $anchor: "new" },
      "https://snap.example/r",
    );
    expect(engine.registry.rootRef(r).node).toEqual({
      type: "integer",
      $anchor: "new",
    });
    expect(view.rootRef(r).node).toEqual({ type: "string", $anchor: "old" });
    expect(view.resolveRef(`${r}#old`, r).pointer).toBe("");
    expect(() => view.resolveRef(`${r}#new`, r)).toThrow(UnresolvableRefError);
    expect(engine.registry.resolveRef(`${r}#new`, r).pointer).toBe("");
    expect(() => engine.registry.resolveRef(`${r}#old`, r)).toThrow(
      UnresolvableRefError,
    );
  });

  it("keeps the dialect it was taken with when the source re-registers it", () => {
    const VOCAB = "urn:snap:vocab";
    const DIALECT = "urn:snap:dialect";
    const engine = createEngine();
    const even: KeywordBehavior = {
      id: `${VOCAB}#even`,
      evaluate: (_value, cursor) =>
        typeof cursor.value !== "number" || cursor.value % 2 === 0,
    };
    engine.registerVocabulary(VOCAB, { even });
    engine.registerDialect(DIALECT, [CORE, VOCAB]);
    const uri = engine.registerSchema(
      { even: true },
      "https://snap.example/d",
      DIALECT,
    );
    const view = engine.registry.snapshot();
    const odd: KeywordBehavior = {
      id: `${VOCAB}#even`,
      evaluate: (_value, cursor) =>
        typeof cursor.value !== "number" || cursor.value % 2 === 1,
    };
    engine.registerVocabulary(VOCAB, { even: odd });
    engine.registerDialect(DIALECT, [CORE, VOCAB]);
    expect(engine.registry.dialectFor(uri).keywords.get("even")!.behavior).toBe(
      odd,
    );
    expect(view.dialectFor(uri).keywords.get("even")!.behavior).toBe(even);
  });

  it("has its own empty pending set and never drains the source's", () => {
    const engine = createEngine();
    engine.registerSchema(
      { $ref: "https://snap.example/missing" },
      "https://snap.example/p",
    );
    const view = engine.registry.snapshot();
    expect(view.takeUnresolved()).toEqual([]);
    expect(engine.registry.takeUnresolved()).toEqual([
      "https://snap.example/missing",
    ]);
  });
});

describe("DialectRegistry.snapshot", () => {
  it("is read-only and frozen at the time it is taken", () => {
    const registry = new DialectRegistry();
    registry.registerVocabulary("urn:v", {});
    registry.registerDialect("urn:d", ["urn:v"]);
    const view = registry.snapshot();
    expect(() => {
      view.registerVocabulary("urn:w", {});
    }).toThrow(ReadOnlyRegistryError);
    expect(() => {
      view.registerDialect("urn:e", ["urn:v"]);
    }).toThrow(ReadOnlyRegistryError);
    registry.registerDialect("urn:e", ["urn:v"]);
    expect(registry.hasDialect("urn:e")).toBe(true);
    expect(view.hasDialect("urn:e")).toBe(false);
    expect(() => view.getDialect("urn:e")).toThrow(UnknownDialectError);
    expect(view.getDialect("urn:d")).toBe(registry.getDialect("urn:d"));
  });
});
