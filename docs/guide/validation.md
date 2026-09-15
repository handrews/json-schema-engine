# Validation

> Installation: TBD — the package is not yet published. Within this
> repository, import from `@json-schema-engine/core`.

## Validate an instance

Register a schema under a retrieval URI, then evaluate instances against it.
Evaluation is synchronous.

```ts
import assert from "node:assert";
import { createEngine } from "@json-schema-engine/core";

const engine = createEngine();
const uri = engine.registerSchema(
  {
    type: "object",
    properties: {
      id: { type: "integer" },
      tags: { type: "array", items: { type: "string" } },
    },
    required: ["id"],
  },
  "https://example.com/item",
);

assert.equal(engine.evaluate(uri, { id: 1, tags: ["a"] }).valid, true);
assert.equal(engine.evaluate(uri, { tags: ["a"] }).valid, false);
assert.equal(engine.evaluate(uri, { id: 1, tags: [2] }).valid, false);
```

The default output is `flag`: only `valid`, no error details, and the least
evaluation work.

## Read error details

Request `output: "list"` for one unit per error. Each unit carries three
locations: `evaluationPath` (the dynamic path through the schema, including
`$ref` traversals), `schemaLocation` (the canonical URI of the failing
keyword), and `inputLocation` (a JSON Pointer into the input).

```ts
import assert from "node:assert";
import { createEngine } from "@json-schema-engine/core";

const engine = createEngine();
const uri = engine.registerSchema(
  {
    $defs: { name: { type: "string", minLength: 1 } },
    properties: { name: { $ref: "#/$defs/name" } },
  },
  "https://example.com/named",
);

const result = engine.evaluate(uri, { name: "" }, { output: "list" });
assert.equal(result.valid, false);

const unit = result.errors?.[0];
assert.equal(unit?.evaluationPath, "/properties/name/$ref/minLength");
assert.equal(
  unit?.schemaLocation,
  "https://example.com/named#/$defs/name/minLength",
);
assert.equal(unit?.inputLocation, "/name");
```

## The Basic output document

`output: "basic"` also renders `Result.outputDocument` as the Basic document
(IETF draft-03 §13.4.2), whose units use the draft's `keywordLocation` /
`absoluteKeywordLocation` / `instanceLocation` field names. The flat units
keep `evaluationPath` / `schemaLocation` / `inputLocation`.

```ts
import assert from "node:assert";
import { createEngine } from "@json-schema-engine/core";

const engine = createEngine();
const uri = engine.registerSchema(
  { type: "number" },
  "https://example.com/num",
);

const result = engine.evaluate(uri, "x", { output: "basic" });
assert.equal(result.outputDocument?.errors?.[0]?.keywordLocation, "/type");
assert.equal(result.errors?.[0]?.evaluationPath, "/type");
```

## Validate against an older draft

Schemas declare their dialect with `$schema`. Without one, the engine's
`defaultDialect` applies (2020-12 unless configured). See
[Dialects](dialects.md).

```ts
import assert from "node:assert";
import { createEngine } from "@json-schema-engine/core";

const engine = createEngine();
const uri = engine.registerSchema(
  {
    $schema: "http://json-schema.org/draft-07/schema#",
    items: [{ type: "string" }, { type: "integer" }],
  },
  "https://example.com/tuple",
);

// draft-07 array-form `items` validates positionally.
assert.equal(engine.evaluate(uri, ["a", 1]).valid, true);
assert.equal(engine.evaluate(uri, [1, "a"]).valid, false);
```

## Schema registration errors

`registerSchema` throws `UnknownDialectError` for an unregistered `$schema`
value, and `InvalidSchemaError` when a schema position holds a value that
is not a schema (not an object or boolean) — see
[Dialects](dialects.md) for an example. Evaluation throws
`UnresolvableRefError` when a followed reference has no registered target,
and `InfiniteLoopError` on true reference cycles. Loading referenced
documents asynchronously is covered in
[Loaders and remote references](loaders.md).
