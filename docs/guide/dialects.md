# Dialects

A dialect is a set of keyword behaviors bound to a `$schema` URI. Four
dialects ship built in: draft 2020-12, draft 2019-09, draft-07, and
draft-06, exported as `DIALECT_2020_12`, `DIALECT_2019_09`,
`DIALECT_DRAFT_07`, and `DIALECT_DRAFT_06`.

## Select a dialect

A schema's own `$schema` keyword picks its dialect. Without one, the
engine's `defaultDialect` applies — 2020-12 unless configured otherwise.

```ts
import assert from "node:assert";
import { createEngine, DIALECT_DRAFT_07 } from "@jse/core";

const engine = createEngine({ defaultDialect: DIALECT_DRAFT_07 });
const uri = engine.registerSchema(
  { items: [{ type: "boolean" }] },
  "https://example.com/no-schema-keyword",
);

// No $schema on the document: draft-07 rules apply, including array-form items.
assert.equal(engine.evaluate(uri, [true]).valid, true);
assert.equal(engine.evaluate(uri, [3]).valid, false);
```

## Fragment-free URIs

`$schema` and `defaultDialect` values are compared with their fragment
stripped, so the canonical empty-fragment form (`.../schema#`) resolves to
the same dialect as the bare URI.

```ts
import assert from "node:assert";
import { createEngine } from "@jse/core";

const engine = createEngine({
  defaultDialect: "http://json-schema.org/draft-07/schema#",
});
const uri = engine.registerSchema(
  { items: [{ type: "boolean" }] },
  "https://example.com/frag-dialect",
);

assert.equal(engine.evaluate(uri, [true]).valid, true);
assert.equal(engine.evaluate(uri, [3]).valid, false);
```

## The same keyword, different meaning

In draft-07, `items` accepts either a single schema (applied to every
element) or an array of subschemas (positional, tuple-style). In 2020-12,
tuple validation moved to `prefixItems` and `items` accepts only a single
schema — an **array** value for `items` is not valid 2020-12. The engine
treats such a value as having no effect; `validateSchemas: true` rejects
the document instead (see [Metaschemas](metaschemas.md)).

```ts
import assert from "node:assert";
import { createEngine, DIALECT_2020_12, DIALECT_DRAFT_07 } from "@jse/core";

const shape = { items: [{ type: "string" }, { type: "integer" }] };

const legacy = createEngine({ defaultDialect: DIALECT_DRAFT_07 });
const legacyUri = legacy.registerSchema(
  shape,
  "https://example.com/legacy-tuple",
);
assert.equal(legacy.evaluate(legacyUri, ["a", 1]).valid, true);
assert.equal(legacy.evaluate(legacyUri, [1, "a"]).valid, false);

const modern = createEngine({ defaultDialect: DIALECT_2020_12 });
const modernUri = modern.registerSchema(
  shape,
  "https://example.com/modern-items",
);
// The same document under 2020-12: `items` ignores its array value, so
// there is no tuple check at all — every array is valid.
assert.equal(modern.evaluate(modernUri, [1, "a"]).valid, true);
```

Catch the mistake at registration time with `validateSchemas`:

```ts
import assert from "node:assert";
import { createEngine, SchemaValidationError } from "@jse/core";

const strict = createEngine({ validateSchemas: true });
assert.throws(
  () =>
    strict.registerSchema(
      { items: [{ type: "string" }] },
      "https://example.com/invalid-2020-12",
    ),
  SchemaValidationError,
);
```

## Unknown dialects

`registerSchema` and `loadSchema` throw `UnknownDialectError` for a
`$schema` value that names a dialect the engine has neither built in nor
assembled from a loaded metaschema. See [Metaschemas](metaschemas.md) for
assembling dialects from `$vocabulary`.

```ts
import assert from "node:assert";
import { createEngine, UnknownDialectError } from "@jse/core";

const engine = createEngine();

assert.throws(() => {
  engine.registerSchema(
    { $schema: "https://example.com/no-such-dialect" },
    "https://example.com/bad-dialect",
  );
}, UnknownDialectError);
```
