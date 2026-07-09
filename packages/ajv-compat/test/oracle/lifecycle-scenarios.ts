// Lifecycle scenarios (M8.6b), defined ONCE and driven against both real
// AJV (capture-lifecycle.ts, D15: executed, never read) and the compat
// class (lifecycle.test.ts). Observations are plain JSON booleans/counts —
// never error text, which is implementation prose, and never functions.

export interface AjvLike {
  compile(schema: unknown): ((data: unknown) => boolean) & {
    errors?: unknown[] | null;
  };
  addSchema(schema: unknown, key?: string): unknown;
  removeSchema(ref?: unknown): unknown;
  getSchema(ref: string): unknown;
}

export type AjvLikeCtor = new (options?: Record<string, unknown>) => AjvLike;

type Observation = Record<string, unknown>;

/** Runs one step, recording `threw` instead of propagating. */
const step = (obs: Observation[], label: string, fn: () => Observation) => {
  try {
    obs.push({ step: label, threw: false, ...fn() });
  } catch {
    obs.push({ step: label, threw: true });
  }
};

const B_URI = "https://lifecycle.example/B";

export const SCENARIOS: Record<
  string,
  (AjvCtor: AjvLikeCtor) => Observation[]
> = {
  // Does a compiled fn (and a re-compile of the same object) see schemas
  // added AFTER its compile?
  "late-ref-visibility": (AjvCtor) => {
    const obs: Observation[] = [];
    const ajv = new AjvCtor({ logger: false });
    const root = { $ref: B_URI };
    let v1: ReturnType<AjvLike["compile"]> | undefined;
    step(obs, "compile-with-B-missing", () => {
      v1 = ajv.compile(root);
      return { compiled: true };
    });
    step(obs, "addSchema-B", () => {
      ajv.addSchema({ $id: B_URI, type: "integer" });
      return {};
    });
    step(obs, "old-fn-after-add", () => ({
      valid: v1 === undefined ? null : v1(3),
    }));
    let v2: ReturnType<AjvLike["compile"]> | undefined;
    step(obs, "recompile-same-object", () => {
      v2 = ajv.compile(root);
      return { sameFn: v2 === v1 };
    });
    step(obs, "new-fn-validates", () => ({
      valid: v2 === undefined ? null : v2(3),
      invalid: v2 === undefined ? null : v2("x"),
    }));
    return obs;
  },

  // Does removal break previously compiled fns, and what do lookups say?
  "remove-schema-semantics": (AjvCtor) => {
    const obs: Observation[] = [];
    const ajv = new AjvCtor({ logger: false });
    ajv.addSchema({ type: "string" }, "k");
    const f = ajv.getSchema("k") as
      (ReturnType<AjvLike["compile"]> & object) | undefined;
    step(obs, "getSchema-before-remove", () => ({ defined: f !== undefined }));
    step(obs, "removeSchema-k", () => {
      ajv.removeSchema("k");
      return {};
    });
    step(obs, "getSchema-after-remove", () => ({
      defined: ajv.getSchema("k") !== undefined,
    }));
    step(obs, "old-fn-still-works", () => ({
      valid: f === undefined ? null : (f as (d: unknown) => boolean)("ok"),
      invalid: f === undefined ? null : (f as (d: unknown) => boolean)(42),
    }));
    step(obs, "re-add-same-key", () => {
      ajv.addSchema({ type: "integer" }, "k");
      return { defined: ajv.getSchema("k") !== undefined };
    });
    step(obs, "duplicate-add-throws", () => {
      ajv.addSchema({ type: "boolean" }, "k");
      return {};
    });
    return obs;
  },

  // Object-identity cache across an invalidating addSchema.
  "object-cache-across-invalidation": (AjvCtor) => {
    const obs: Observation[] = [];
    const ajv = new AjvCtor({ logger: false });
    const obj = { type: "object" };
    const v1 = ajv.compile(obj);
    step(obs, "addSchema-unrelated", () => {
      ajv.addSchema({ $id: "https://lifecycle.example/unrelated" });
      return {};
    });
    step(obs, "compile-same-object", () => ({
      sameFn: ajv.compile(obj) === v1,
    }));
    return obs;
  },

  // $id auto-registration on compile (addUsedSchema default vs false).
  "id-registration": (AjvCtor) => {
    const obs: Observation[] = [];
    const ajv = new AjvCtor({ logger: false });
    const withId = { $id: "https://lifecycle.example/X", type: "string" };
    const fn = ajv.compile(withId);
    step(obs, "getSchema-by-id", () => ({
      sameFn: ajv.getSchema("https://lifecycle.example/X") === fn,
    }));
    const ajv2 = new AjvCtor({ logger: false, addUsedSchema: false });
    const withId2 = { $id: "https://lifecycle.example/Y", type: "string" };
    ajv2.compile(withId2);
    step(obs, "getSchema-addUsedSchema-false", () => ({
      defined: ajv2.getSchema("https://lifecycle.example/Y") !== undefined,
    }));
    return obs;
  },

  // Anonymous compile caching: same object vs equal-but-distinct objects.
  "anonymous-identity": (AjvCtor) => {
    const obs: Observation[] = [];
    const ajv = new AjvCtor({ logger: false });
    const anon = { type: "number" };
    const v1 = ajv.compile(anon);
    step(obs, "same-object", () => ({ sameFn: ajv.compile(anon) === v1 }));
    step(obs, "equal-distinct-object", () => ({
      sameFn: ajv.compile({ type: "number" }) === v1,
    }));
    return obs;
  },

  // A compiled ref-user pinned to the resolution state at compile time?
  "removed-then-replaced-ref": (AjvCtor) => {
    const obs: Observation[] = [];
    const ajv = new AjvCtor({ logger: false });
    ajv.addSchema({ $id: B_URI, type: "integer" });
    const v = ajv.compile({ $ref: B_URI });
    step(obs, "before", () => ({ valid: v(3), invalid: v("x") }));
    step(obs, "removeSchema-B", () => {
      ajv.removeSchema(B_URI);
      return {};
    });
    step(obs, "old-fn-after-remove", () => ({ valid: v(3) }));
    step(obs, "re-add-different-B", () => {
      ajv.addSchema({ $id: B_URI, type: "string" });
      return {};
    });
    // integer accepted = still the OLD resolution; string accepted = new
    step(obs, "old-fn-after-replace", () => ({
      acceptsInteger: v(3),
      acceptsString: v("x"),
    }));
    step(obs, "fresh-compile-after-replace", () => {
      const v2 = ajv.compile({ $ref: B_URI });
      return { acceptsInteger: v2(3), acceptsString: v2("x") };
    });
    return obs;
  },
};
