// Fastify PoC (M8.5, DESIGN M8 gate): a fastify app validates real
// injected traffic through ajv-compat configured EXACTLY like fastify
// configures AJV by default (@fastify/ajv-compiler README):
// coerceTypes:'array', useDefaults, removeAdditional, allErrors:false.
// Query strings coerce to numbers/arrays, defaults land, undeclared body
// properties vanish, and invalid requests 400 with the mapped message.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import type { JsonValue } from "@jse/core";
import { Ajv, type ValidateFunction } from "../src/index.js";

const FASTIFY_DEFAULTS = {
  coerceTypes: "array" as const,
  useDefaults: true,
  removeAdditional: true,
  allErrors: false,
  logger: false as const,
  // fastify feeds draft-07-style route schemas; strict hygiene off matches
  // its defaults for user schemas.
  strictSchema: false as const,
};

describe("fastify PoC: compat validator under fastify's default config", () => {
  let app: FastifyInstance;
  let seenBody: JsonValue;
  let seenQuery: JsonValue;

  beforeAll(async () => {
    app = Fastify();
    const ajv = new Ajv(FASTIFY_DEFAULTS);
    app.setValidatorCompiler(({ schema }) => {
      const validate: ValidateFunction = ajv.compile(schema as JsonValue);
      return (data: unknown) =>
        validate(data as JsonValue)
          ? { value: data }
          : { error: new Error(ajv.errorsText(validate.errors)) };
    });
    app.post(
      "/items",
      {
        schema: {
          body: {
            type: "object",
            required: ["name"],
            additionalProperties: false,
            properties: {
              name: { type: "string" },
              count: { type: "integer", default: 1 },
              price: { type: "number" },
            },
          },
          querystring: {
            type: "object",
            properties: {
              page: { type: "integer", default: 1 },
              tags: { type: "array", items: { type: "string" } },
            },
          },
        },
      },
      (request, reply) => {
        seenBody = request.body as JsonValue;
        seenQuery = request.query as JsonValue;
        return reply.send({ ok: true });
      },
    );
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("coerces, defaults, and strips a valid request", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/items?page=3&tags=a",
      payload: { name: "widget", price: "9.5", junk: true },
    });
    expect(res.statusCode).toBe(200);
    // Body: price coerced from the JSON string, count defaulted, junk
    // removed (additionalProperties: false + removeAdditional).
    expect(seenBody).toEqual({ name: "widget", price: 9.5, count: 1 });
    // Query: HTTP gives strings; page coerces to integer, tags wraps into
    // an array (coerceTypes: "array"), both per fastify's default posture.
    expect(seenQuery).toEqual({ page: 3, tags: ["a"] });
  });

  it("rejects an uncoercible request with the mapped message", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/items",
      payload: { name: "widget", price: "not-a-number" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      message: expect.stringContaining("must be number") as string,
    });
  });

  it("rejects a missing required property", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/items",
      payload: { price: 2 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      message: expect.stringContaining(
        "must have required property 'name'",
      ) as string,
    });
  });
});
