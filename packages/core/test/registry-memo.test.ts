// Reference-resolution memos: resolveRef and dynamicReference answer repeat
// lookups from a per-(base, reference) memo that a registration, or a
// dialect registration, invalidates — on the live registry whether or not
// a snapshot exists, while a snapshot keeps the answers it was taken with.

import { describe, it, expect } from "vitest";
import {
  createEngine,
  identifiersLegacy,
  UnresolvableRefError,
} from "@json-schema-engine/core";

const CORE = "https://json-schema.org/draft/2020-12/vocab/core";

describe("resolveRef memo", () => {
  it("answers a repeat lookup with the same object", () => {
    const engine = createEngine();
    const uri = engine.registerSchema(
      { $defs: { x: { type: "string" } } },
      "https://memo.example/a",
    );
    const first = engine.registry.resolveRef("#/$defs/x", uri);
    expect(engine.registry.resolveRef("#/$defs/x", uri)).toBe(first);
    expect(first.pointer).toBe("/$defs/x");
  });

  it("re-throws a memoized miss as a fresh error with the same message", () => {
    const engine = createEngine();
    const uri = engine.registerSchema({}, "https://memo.example/b");
    const thrown: UnresolvableRefError[] = [];
    for (let i = 0; i < 2; i++) {
      try {
        engine.registry.resolveRef("#/nope", uri);
      } catch (err) {
        thrown.push(err as UnresolvableRefError);
      }
    }
    expect(thrown).toHaveLength(2);
    expect(thrown[0]).toBeInstanceOf(UnresolvableRefError);
    expect(thrown[1]).toBeInstanceOf(UnresolvableRefError);
    expect(thrown[0]).not.toBe(thrown[1]);
    expect(thrown[0]!.message).toBe(thrown[1]!.message);
  });

  it("forgets a miss once the missing resource is registered (no snapshot)", () => {
    const engine = createEngine();
    const a = engine.registerSchema(
      { $ref: "https://memo.example/missing" },
      "https://memo.example/c",
    );
    expect(() =>
      engine.registry.resolveRef("https://memo.example/missing", a),
    ).toThrow(UnresolvableRefError);
    engine.registerSchema({ type: "string" }, "https://memo.example/missing");
    expect(
      engine.registry.resolveRef("https://memo.example/missing", a).node,
    ).toEqual({ type: "string" });
  });

  it("keeps a snapshot's answers when the source registers afterwards", () => {
    const engine = createEngine();
    const a = engine.registerSchema(
      { $ref: "https://memo.example/late" },
      "https://memo.example/d",
    );
    const view = engine.registry.snapshot();
    expect(() => view.resolveRef("https://memo.example/late", a)).toThrow(
      UnresolvableRefError,
    );
    engine.registerSchema({ type: "string" }, "https://memo.example/late");
    expect(
      engine.registry.resolveRef("https://memo.example/late", a).node,
    ).toEqual({ type: "string" });
    expect(() => view.resolveRef("https://memo.example/late", a)).toThrow(
      UnresolvableRefError,
    );
  });

  it("re-resolves after a re-registration under the same URI", () => {
    const engine = createEngine();
    const r = engine.registerSchema(
      { $defs: { x: { type: "string" } } },
      "https://memo.example/e",
    );
    expect(engine.registry.resolveRef("#/$defs/x", r).node).toEqual({
      type: "string",
    });
    engine.registerSchema(
      { $defs: { x: { type: "integer" } } },
      "https://memo.example/e",
    );
    expect(engine.registry.resolveRef("#/$defs/x", r).node).toEqual({
      type: "integer",
    });
  });

  it("re-resolves pointers after the target's dialect is re-registered with another identifier syntax", () => {
    const DIALECT = "urn:memo:dialect";
    const engine = createEngine();
    engine.registerDialect(DIALECT, [CORE]);
    const r = engine.registerSchema(
      { $defs: { x: { $id: "https://memo.example/nested", type: "string" } } },
      "https://memo.example/f",
      DIALECT,
    );
    // 2020-12 identifiers: the nested $id rebases the target.
    expect(engine.registry.resolveRef("#/$defs/x", r).baseUri).toBe(
      "https://memo.example/nested",
    );
    // Legacy identifiers still honor $id; a dialect whose extractor sees
    // no identifiers at all leaves the pointer un-rebased.
    engine.registerDialect(DIALECT, [CORE], { identifiers: () => ({}) });
    expect(engine.registry.resolveRef("#/$defs/x", r).baseUri).toBe(r);
    expect(engine.registry.resolveRef("#/$defs/x", r).pointer).toBe("/$defs/x");
    engine.registerDialect(DIALECT, [CORE], { identifiers: identifiersLegacy });
    expect(engine.registry.resolveRef("#/$defs/x", r).baseUri).toBe(
      "https://memo.example/nested",
    );
  });

  it("does not memoize a malformed percent-escape as a miss", () => {
    const engine = createEngine();
    const uri = engine.registerSchema({}, "https://memo.example/g");
    expect(() => engine.registry.resolveRef("#/%zz", uri)).toThrow(URIError);
    expect(() => engine.registry.resolveRef("#/%zz", uri)).toThrow(URIError);
  });
});

describe("dynamicReference memo", () => {
  it("answers a repeat lookup with the same object", () => {
    const engine = createEngine();
    const uri = engine.registerSchema(
      { $defs: { x: { $dynamicAnchor: "x" } } },
      "https://memo.example/h",
    );
    const first = engine.registry.dynamicReference("#x", uri);
    expect(engine.registry.dynamicReference("#x", uri)).toBe(first);
    expect(first.anchor).toBe("x");
  });

  it("sees a $dynamicAnchor added by re-registration", () => {
    const engine = createEngine();
    const uri = engine.registerSchema(
      { $defs: { x: { $anchor: "x" } } },
      "https://memo.example/i",
    );
    expect(engine.registry.dynamicReference("#x", uri).anchor).toBeNull();
    engine.registerSchema(
      { $defs: { x: { $dynamicAnchor: "x" } } },
      "https://memo.example/i",
    );
    expect(engine.registry.dynamicReference("#x", uri).anchor).toBe("x");
  });

  it("propagates and memoizes an unresolvable lexical target", () => {
    const engine = createEngine();
    const uri = engine.registerSchema({}, "https://memo.example/j");
    expect(() => engine.registry.dynamicReference("#x", uri)).toThrow(
      UnresolvableRefError,
    );
    expect(() => engine.registry.dynamicReference("#x", uri)).toThrow(
      UnresolvableRefError,
    );
    engine.registerSchema(
      { $defs: { x: { $dynamicAnchor: "x" } } },
      "https://memo.example/j",
    );
    expect(engine.registry.dynamicReference("#x", uri).anchor).toBe("x");
  });
});
