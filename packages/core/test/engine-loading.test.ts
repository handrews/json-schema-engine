// Engine loading paths (ADR 0005): `validateSchemas` runs before the walk
// on every path, including documents a loader fetches, so a rejected
// document is never registered; and a fetch that throws leaves the rest of
// the load queue for the next drain rather than dropping it.

import { describe, it, expect } from "vitest";
import {
  createEngine,
  InvalidSchemaError,
  SchemaValidationError,
  UnknownDialectError,
  type JsonValue,
  type SchemaLoader,
} from "@json-schema-engine/core";

const CORE = "https://json-schema.org/draft/2020-12/vocab/core";
const VALIDATION = "https://json-schema.org/draft/2020-12/vocab/validation";

const ROOT = "https://loading.example/root";
const B = "https://loading.example/b";
const C = "https://loading.example/c";
const D = "https://loading.example/d";

// A root whose walk queues B before C.
const rootReferencing = (): JsonValue => ({
  properties: { a: { $ref: B }, b: { $ref: C } },
});

const serving =
  (docs: Record<string, JsonValue | (() => never)>): SchemaLoader =>
  (uri) => {
    const doc = docs[uri];
    if (doc === undefined) return undefined;
    if (typeof doc === "function") doc();
    return { value: doc as JsonValue };
  };

describe("validateSchemas runs before registration", () => {
  it("registerSchema rejects and registers nothing", () => {
    const engine = createEngine({ validateSchemas: true });
    expect(() => engine.registerSchema({ type: 123 }, ROOT)).toThrow(
      SchemaValidationError,
    );
    expect(engine.registry.has(ROOT)).toBe(false);
  });

  it("loadSchema rejects and registers nothing", async () => {
    const engine = createEngine({ validateSchemas: true });
    await expect(engine.loadSchema({ type: 123 }, ROOT)).rejects.toThrow(
      SchemaValidationError,
    );
    expect(engine.registry.has(ROOT)).toBe(false);
  });

  it("load rejects and registers nothing", async () => {
    const engine = createEngine({
      validateSchemas: true,
      loaders: [serving({ [ROOT]: { type: 123 } })],
    });
    await expect(engine.load(ROOT)).rejects.toThrow(SchemaValidationError);
    expect(engine.registry.has(ROOT)).toBe(false);
  });

  it("checks documents a loader fetches, keeping what registered and the rest of the queue", async () => {
    const engine = createEngine({
      validateSchemas: true,
      loaders: [
        serving({ [B]: { type: 123 }, [C]: { type: "string" }, [D]: {} }),
      ],
    });
    await expect(engine.loadSchema(rootReferencing(), ROOT)).rejects.toThrow(
      SchemaValidationError,
    );
    const reg = engine.registry;
    expect(reg.has(ROOT)).toBe(true);
    expect(reg.has(B)).toBe(false);
    expect(reg.has(C)).toBe(false);
    await engine.load(D);
    expect(reg.has(C)).toBe(true);
    expect(reg.has(B)).toBe(false);
    expect(reg.takeUnresolved()).toEqual([]);
  });

  it("loads a metaschema's own closure before validating against it", async () => {
    const META = "https://loading.example/meta";
    const PART = "https://loading.example/meta-part";
    const engine = createEngine({
      validateSchemas: true,
      loaders: [
        serving({
          [META]: {
            $id: META,
            $vocabulary: { [CORE]: true, [VALIDATION]: true },
            $ref: PART,
          },
          [PART]: {
            $id: PART,
            properties: { maxLength: { type: "integer" } },
          },
        }),
      ],
    });
    await expect(
      engine.loadSchema({ $schema: META, maxLength: "long" }, ROOT),
    ).rejects.toThrow(SchemaValidationError);
    expect(engine.registry.has(ROOT)).toBe(false);
    await expect(
      engine.loadSchema({ $schema: META, maxLength: 3 }, ROOT),
    ).resolves.toBe(ROOT);
  });

  it("reports an unknown dialect as such, not as a validation failure", () => {
    const engine = createEngine({ validateSchemas: true });
    expect(() =>
      engine.registerSchema(
        { $schema: "https://loading.example/no-such-dialect" },
        ROOT,
      ),
    ).toThrow(UnknownDialectError);
  });
});

describe("the load queue survives a failed fetch", () => {
  const scenarios: [string, JsonValue | (() => never), new () => Error][] = [
    [
      "a loader that throws",
      () => {
        throw new Error("boom");
      },
      Error,
    ],
    [
      "a document that fails registration",
      { properties: { p: 5 } },
      InvalidSchemaError,
    ],
  ];
  for (const [label, b, error] of scenarios) {
    it(`after ${label}`, async () => {
      const engine = createEngine({
        loaders: [serving({ [B]: b, [C]: { type: "string" }, [D]: {} })],
      });
      await expect(engine.loadSchema(rootReferencing(), ROOT)).rejects.toThrow(
        error,
      );
      const reg = engine.registry;
      expect(reg.has(ROOT)).toBe(true);
      expect(reg.has(B)).toBe(false);
      // C was never attempted: it is still queued, and the next drain
      // takes it. B is not queued again.
      expect(reg.has(C)).toBe(false);
      await engine.load(D);
      expect(reg.has(C)).toBe(true);
      expect(reg.has(B)).toBe(false);
      expect(reg.takeUnresolved()).toEqual([]);
    });
  }
});
