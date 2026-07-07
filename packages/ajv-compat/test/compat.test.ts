// The Ajv compat class end-to-end: every oracle fixture case run through
// the class API must reproduce AJV's verdict and error objects; plus pins
// for the surface semantics (schema management, keywords, formats,
// strict subset, loud failures).

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { JsonValue } from "@jse/core";
import {
  Ajv,
  Ajv2020,
  AjvCompatUnsupportedError,
  type Options,
} from "../src/index.js";
import addFormats from "../src/formats.js";

interface FixtureCase {
  dialect: "draft-07" | "2020-12";
  options: Record<string, unknown>;
  schema: JsonValue;
  data: JsonValue;
  valid: boolean;
  errors: Record<string, unknown>[] | null;
  errorsText: string | null;
  compileError?: string;
}

const FIXTURE = JSON.parse(
  readFileSync(
    join(
      dirname(fileURLToPath(import.meta.url)),
      "fixtures",
      "ajv-oracle.json",
    ),
    "utf8",
  ),
) as Record<string, FixtureCase>;

const SKIP = new Set<string>([]);

describe("Ajv class ≡ AJV oracle (end-to-end)", () => {
  for (const [name, c] of Object.entries(FIXTURE)) {
    if (SKIP.has(name) || c.compileError !== undefined) continue;
    it(name, () => {
      const opts: Options = {
        ...(c.options as Options),
        // The oracle ran with AJV's own strict logging; silence ours.
        logger: false,
      };
      const ajv = c.dialect === "2020-12" ? new Ajv2020(opts) : new Ajv(opts);
      // The oracle's `format`/`format-comparison` cases were captured with
      // ajv-formats registered (test/oracle/capture.ts); the fixture's own
      // `options` doesn't carry that (it's a constructor option, not one) —
      // only these two names need the parity module wired in here.
      if (name === "format" || name === "format-comparison") {
        addFormats(ajv, { keywords: true });
      }
      const validate = ajv.compile(c.schema);
      expect(validate(c.data), "verdict").toBe(c.valid);
      expect(validate.errors).toEqual(c.valid ? null : c.errors);
      if (!c.valid) {
        expect(ajv.errorsText(validate.errors)).toBe(c.errorsText);
      }
    });
  }
});

describe("surface semantics", () => {
  it("validate() by ref + ajv.errors", () => {
    const ajv = new Ajv2020();
    ajv.addSchema({ type: "integer" }, "int");
    expect(ajv.validate("int", 3)).toBe(true);
    expect(ajv.errors).toBeNull();
    expect(ajv.validate("int", "x")).toBe(false);
    expect(ajv.errors![0]!.keyword).toBe("type");
  });

  it("getSchema / removeSchema / addSchema by $id", () => {
    const ajv = new Ajv2020();
    ajv.addSchema({ $id: "https://c.example/s", type: "string" });
    const fn = ajv.getSchema("https://c.example/s");
    expect(fn).toBeDefined();
    expect(fn!("ok")).toBe(true);
    ajv.removeSchema(/c\.example/);
    expect(ajv.getSchema("https://c.example/s")).toBeUndefined();
  });

  it("cross-schema $ref through addSchema", () => {
    const ajv = new Ajv2020();
    ajv.addSchema({ $id: "https://c.example/pos", type: "number", minimum: 0 });
    const fn = ajv.compile({ $ref: "https://c.example/pos" });
    expect(fn(1)).toBe(true);
    expect(fn(-1)).toBe(false);
    expect(fn.errors![0]!.schemaPath).toBe("https://c.example/pos/minimum");
  });

  it("addKeyword validate form with custom errors", () => {
    const ajv = new Ajv2020();
    const even = (schema: JsonValue, data: JsonValue): boolean => {
      if (schema !== true) return true;
      const ok = typeof data === "number" && data % 2 === 0;
      if (!ok) {
        (even as { errors?: unknown[] }).errors = [
          { message: "must be even", params: { parity: "odd" } },
        ];
      }
      return ok;
    };
    ajv.addKeyword({ keyword: "even", type: "number", validate: even });
    const fn = ajv.compile({ even: true });
    expect(fn(2)).toBe(true);
    expect(fn("not-a-number")).toBe(true); // type-scoped
    expect(fn(3)).toBe(false);
    expect(fn.errors![0]!.message).toBe("must be even");
    expect(fn.errors![0]!.params).toEqual({ parity: "odd" });
    expect(fn.errors![0]!.keyword).toBe("even");
  });

  it("addKeyword compile form + getKeyword/removeKeyword", () => {
    const ajv = new Ajv2020();
    ajv.addKeyword({
      keyword: "constEq",
      compile: (schema) => (data) => data === schema,
    });
    expect(ajv.getKeyword("constEq")).not.toBe(false);
    const fn = ajv.compile({ constEq: 5 });
    expect(fn(5)).toBe(true);
    expect(fn(6)).toBe(false);
    ajv.removeKeyword("constEq");
    expect(ajv.getKeyword("constEq")).toBe(false);
  });

  it("addFormat forms: string, RegExp, function", () => {
    const ajv = new Ajv2020();
    ajv.addFormat("digits", "^\\d+$");
    ajv.addFormat("caps", /^[A-Z]+$/);
    ajv.addFormat("short", (v) => v.length <= 3);
    const fn = ajv.compile({
      type: "object",
      properties: {
        a: { type: "string", format: "digits" },
        b: { type: "string", format: "caps" },
        c: { type: "string", format: "short" },
      },
    });
    expect(fn({ a: "123", b: "ABC", c: "ok" })).toBe(true);
    expect(fn({ a: "x" })).toBe(false);
    expect(fn.errors![0]!.params).toEqual({ format: "digits" });
  });

  it("validateFormats: false skips format assertion", () => {
    const ajv = new Ajv2020({ validateFormats: false, logger: false });
    ajv.addFormat("digits", "^\\d+$");
    const fn = ajv.compile({ type: "string", format: "digits" });
    expect(fn("nope")).toBe(true);
  });

  it("strictSchema: unknown keyword throws, 'log' warns, false allows", () => {
    expect(() => new Ajv2020().compile({ nope: 1 })).toThrow(/unknown keyword/);
    const warnings: unknown[] = [];
    const logging = new Ajv2020({
      strictSchema: "log",
      logger: {
        log: () => undefined,
        warn: (...a) => void warnings.push(a),
        error: () => undefined,
      },
    });
    logging.compile({ nope: 1 });
    expect(warnings.length).toBeGreaterThan(0);
    const lax = new Ajv2020({ strictSchema: false });
    expect(lax.compile({ nope: 1 })({})).toBe(true);
  });

  it("strictSchema: unknown format throws at compile", () => {
    expect(() =>
      new Ajv2020().compile({ type: "string", format: "nope" }),
    ).toThrow(/unknown format/);
  });

  it("loud failures: $data, code keywords, async, macro, mutation trio", () => {
    expect(() => new Ajv2020({ $data: true })).toThrow(
      AjvCompatUnsupportedError,
    );
    expect(() => new Ajv2020({ coerceTypes: true })).toThrow(
      AjvCompatUnsupportedError,
    );
    const ajv = new Ajv2020();
    expect(() => ajv.addKeyword({ keyword: "k", code: {} })).toThrow(
      AjvCompatUnsupportedError,
    );
    expect(() =>
      ajv.addKeyword({ keyword: "k", validate: () => true, async: true }),
    ).toThrow(AjvCompatUnsupportedError);
    expect(() => ajv.addKeyword({ keyword: "k", macro: () => true })).toThrow(
      AjvCompatUnsupportedError,
    );
    expect(() =>
      ajv.addFormat("f", { validate: () => true, async: true }),
    ).toThrow(AjvCompatUnsupportedError);
  });

  it("compileAsync loads remote refs through options.loadSchema", async () => {
    const remote: Record<string, JsonValue> = {
      "https://c.example/async-pos": { type: "number", minimum: 0 },
    };
    const ajv = new Ajv2020({
      loadSchema: (uri) => {
        const doc = remote[uri];
        return doc !== undefined
          ? Promise.resolve(doc)
          : Promise.reject(new Error("404"));
      },
    });
    const fn = await ajv.compileAsync({
      $ref: "https://c.example/async-pos",
    });
    expect(fn(2)).toBe(true);
    expect(fn(-2)).toBe(false);
  });

  it("errorsText formatting", () => {
    const ajv = new Ajv2020();
    const fn = ajv.compile({ type: "string" });
    fn(1);
    expect(ajv.errorsText(fn.errors)).toBe("data must be string");
    expect(
      ajv.errorsText(fn.errors, { dataVar: "body", separator: "; " }),
    ).toBe("body must be string");
    expect(ajv.errorsText(null)).toBe("No errors");
  });

  it("draft-07 default class validates draft-07 schemas", () => {
    const ajv = new Ajv();
    const fn = ajv.compile({ type: "array", items: [{ type: "string" }] });
    expect(fn(["ok"])).toBe(true);
    expect(fn([1])).toBe(false);
  });
});
