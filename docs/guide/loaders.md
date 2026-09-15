# Loaders and remote references

A loader fetches a schema document by URI. `registerSchema` only accepts
schemas you already have in hand; `loadSchema` and `load` use loaders to
pull in the documents a schema references.

## Register a loader

Pass `loaders` to `createEngine`, or add one later with `addLoader`. A
loader returns `undefined` for a URI it does not handle; the engine tries
the next one.

```ts
import assert from "node:assert";
import { createEngine, JsonValue } from "@json-schema-engine/core";

const documents = new Map<string, JsonValue>([
  ["https://example.com/name", { type: "string", minLength: 1 }],
]);

const engine = createEngine({
  loaders: [
    (uri) => (documents.has(uri) ? { value: documents.get(uri)! } : undefined),
  ],
});

const uri = await engine.loadSchema(
  { properties: { name: { $ref: "https://example.com/name" } } },
  "https://example.com/person",
);

assert.equal(engine.evaluate(uri, { name: "" }).valid, false);
assert.equal(engine.evaluate(uri, { name: "Ada" }).valid, true);
```

## Transitive loading

`loadSchema` follows every reference the registered document contains,
recursively, through the configured loaders — a chain of `$ref`s across
several documents resolves in one call.

```ts
import assert from "node:assert";
import { createEngine, JsonValue } from "@json-schema-engine/core";

const documents = new Map<string, JsonValue>([
  ["https://example.com/b", { $ref: "https://example.com/c" }],
  ["https://example.com/c", { type: "integer" }],
]);

const engine = createEngine({
  loaders: [
    (uri) => (documents.has(uri) ? { value: documents.get(uri)! } : undefined),
  ],
});

const uri = await engine.loadSchema(
  { $ref: "https://example.com/b" },
  "https://example.com/a",
);

assert.equal(engine.evaluate(uri, 1).valid, true);
assert.equal(engine.evaluate(uri, "x").valid, false);
```

## Fetch a resource directly

`load` fetches and registers a resource by URI without a local schema of
your own — useful for metaschemas or standalone shared definitions.

```ts
import assert from "node:assert";
import { createEngine } from "@json-schema-engine/core";

const engine = createEngine({
  loaders: [
    (uri) =>
      uri === "https://example.com/positive"
        ? { value: { type: "integer", exclusiveMinimum: 0 } }
        : undefined,
  ],
});

const uri = await engine.load("https://example.com/positive");
assert.equal(engine.evaluate(uri, 5).valid, true);
assert.equal(engine.evaluate(uri, -1).valid, false);
```

## Misses are not fatal until followed

`registerSchema` never loads anything, so an unregistered reference target
is fine as long as evaluation never follows it. Following an unresolved
reference raises `UnresolvableRefError` at evaluation time, not at
registration time.

```ts
import assert from "node:assert";
import { createEngine, UnresolvableRefError } from "@json-schema-engine/core";

const engine = createEngine();
const uri = engine.registerSchema(
  {
    properties: {
      a: { type: "string" },
      b: { $ref: "https://example.com/never-registered" },
    },
  },
  "https://example.com/partial",
);

// `b` is never touched, so its dangling $ref never matters.
assert.equal(engine.evaluate(uri, { a: "x" }).valid, true);

// Following it raises the error.
assert.throws(() => engine.evaluate(uri, { b: 1 }), UnresolvableRefError);
```
