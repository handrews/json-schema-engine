// OpenAPI 3.1 PoC (M8.5, DESIGN M8 gate): request/response payloads
// validated against a 3.1 document's component schemas through Ajv2020 —
// the wedge constituency (OAS 3.1 = real 2020-12 schemas with $refs into
// the document and OpenAPI's discriminator).

import { describe, it, expect } from "vitest";
import type { JsonValue } from "@json-schema-engine/core";
import { Ajv2020 } from "../src/index.js";

const OAS_URL = "https://api.example/openapi.json";

/** A small but real-shaped OpenAPI 3.1 document (vendored inline). */
const OPENAPI_DOC: JsonValue = {
  openapi: "3.1.0",
  info: { title: "Pet API", version: "1.0.0" },
  paths: {
    "/pets": {
      post: {
        requestBody: {
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/NewPet" },
            },
          },
        },
        responses: {
          "200": {
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Pet" },
              },
            },
          },
        },
      },
    },
  },
  components: {
    schemas: {
      NewPet: {
        type: "object",
        required: ["name"],
        properties: {
          name: { type: "string", minLength: 1 },
          tag: { type: "string" },
        },
        additionalProperties: false,
      },
      Pet: {
        type: "object",
        required: ["kind"],
        discriminator: { propertyName: "kind" },
        oneOf: [
          { $ref: "#/components/schemas/Cat" },
          { $ref: "#/components/schemas/Dog" },
        ],
      },
      Cat: {
        type: "object",
        properties: {
          kind: { const: "cat" },
          lives: { type: "integer", minimum: 0, maximum: 9 },
        },
      },
      Dog: {
        type: "object",
        properties: {
          kind: { const: "dog" },
          pack: { type: "boolean" },
        },
      },
    },
  },
};

const buildAjv = (): Ajv2020 => {
  // Real OAS documents carry non-schema keys everywhere; strict-mode
  // hygiene is for hand-written schemas, not for pointers into a document.
  const ajv = new Ajv2020({
    discriminator: true,
    strictSchema: false,
    logger: false,
  });
  ajv.addSchema(OPENAPI_DOC, OAS_URL);
  return ajv;
};

describe("OpenAPI 3.1 PoC", () => {
  it("validates request bodies against the document's schema", () => {
    const ajv = buildAjv();
    const validate = ajv.compile({
      $ref: `${OAS_URL}#/components/schemas/NewPet`,
    });
    expect(validate({ name: "Rex", tag: "good" })).toBe(true);
    expect(validate({ tag: "no-name" })).toBe(false);
    expect(validate.errors![0]!.keyword).toBe("required");
    expect(validate.errors![0]!.params).toEqual({ missingProperty: "name" });
    expect(validate({ name: "Rex", extra: 1 })).toBe(false);
    expect(validate.errors![0]!.keyword).toBe("additionalProperties");
  });

  it("validates discriminated response payloads", () => {
    const ajv = buildAjv();
    const validate = ajv.compile({
      $ref: `${OAS_URL}#/components/schemas/Pet`,
    });
    expect(validate({ kind: "cat", lives: 9 })).toBe(true);
    expect(validate({ kind: "dog", pack: false })).toBe(true);
    expect(validate({ kind: "cat", lives: 10 })).toBe(false);
    expect(validate.errors![0]!.keyword).toBe("maximum");
    expect(validate({ kind: "ferret" })).toBe(false);
    expect(validate.errors![0]!.keyword).toBe("discriminator");
  });

  it("coerces and defaults under a gateway-style configuration", () => {
    const ajv = new Ajv2020({
      coerceTypes: true,
      useDefaults: true,
      strictSchema: false,
      logger: false,
    });
    ajv.addSchema(OPENAPI_DOC, OAS_URL);
    const validate = ajv.compile({
      type: "object",
      properties: {
        limit: { type: "integer", default: 20 },
        verbose: { type: "boolean" },
      },
    });
    const query = { verbose: "true" } as JsonValue;
    expect(validate(query)).toBe(true);
    expect(query).toEqual({ verbose: true, limit: 20 });
  });
});
