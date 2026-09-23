# Dialects

A dialect is a set of keyword behaviors bound to a `$schema` URI. Four
dialects ship built in: draft 2020-12, draft 2019-09, draft-07, and
draft-06, exported as `DIALECT_2020_12`, `DIALECT_2019_09`,
`DIALECT_DRAFT_07`, and `DIALECT_DRAFT_06`. draft-04 is available as a
separate package — see [draft-04](#draft-04-separate-package) below.

## Select a dialect

A schema resource's own `$schema` keyword picks its dialect — the document
root, and any embedded `$id` resource that declares one. An embedded
resource without `$schema` inherits the dialect of the resource containing
it; a document without one gets the engine's `defaultDialect` — 2020-12
unless configured otherwise. A `$schema` anywhere other than a resource
root is ignored rather than refused.

```ts
import assert from "node:assert";
import { createEngine, DIALECT_DRAFT_07 } from "@json-schema-engine/core";

const engine = createEngine({ defaultDialect: DIALECT_DRAFT_07 });
const uri = engine.registerSchema(
  { items: [{ type: "boolean" }] },
  "https://example.com/no-schema-keyword",
);

// No $schema on the document: draft-07 rules apply, including array-form items.
assert.equal(engine.evaluate(uri, [true]).valid, true);
assert.equal(engine.evaluate(uri, [3]).valid, false);
```

## Mixed-dialect documents

One document can hold resources of several dialects: each embedded `$id`
resource is walked, indexed, validated, and evaluated under its own
`$schema`, and `$ref` works across the boundary in both directions. The
enclosing dialect's identifier syntax decides where a resource starts; the
resource's own dialect governs everything inside it.

```ts
import assert from "node:assert";
import { createEngine, DIALECT_DRAFT_07 } from "@json-schema-engine/core";

const engine = createEngine();
const uri = engine.registerSchema(
  {
    $id: "https://example.com/mixed",
    properties: { legacy: { $ref: "https://example.com/legacy" } },
    $defs: {
      legacy: {
        $id: "https://example.com/legacy",
        $schema: DIALECT_DRAFT_07,
        // Array-form items: valid draft-07, not a 2020-12 schema.
        items: [{ type: "string" }, { type: "number" }],
      },
    },
  },
  "https://example.com/mixed",
);

assert.equal(
  engine.registry.dialectUriFor("https://example.com/legacy"),
  DIALECT_DRAFT_07,
);
assert.equal(engine.evaluate(uri, { legacy: ["a", 1] }).valid, true);
assert.equal(engine.evaluate(uri, { legacy: [1, "a"] }).valid, false);
```

Under draft-07 and draft-06, a schema object with `$ref` has its siblings
ignored — at registration as at evaluation. In the bundling shape
`{"$ref": "#/definitions/Root", "definitions": {...}}` this means
`definitions` is never walked: a pointer reference into it still resolves,
but an `$id` or plain-fragment anchor inside it is not indexed, a remote
reference inside it is not loaded by `loadSchema`, and its patterns are not
screened. Put such definitions beside an `allOf` wrapper instead of beside
the `$ref`.

## Fragment-free URIs

`$schema` and `defaultDialect` values are compared with their fragment
stripped, so the canonical empty-fragment form (`.../schema#`) resolves to
the same dialect as the bare URI.

```ts
import assert from "node:assert";
import { createEngine } from "@json-schema-engine/core";

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
schema. An **array** value for `items` is not a valid 2020-12 schema, so
registration rejects the document with `InvalidSchemaError` — a non-schema
value in a schema position always fails loud rather than being silently
ignored.

```ts
import assert from "node:assert";
import {
  createEngine,
  DIALECT_2020_12,
  DIALECT_DRAFT_07,
  InvalidSchemaError,
} from "@json-schema-engine/core";

const shape = { items: [{ type: "string" }, { type: "integer" }] };

const legacy = createEngine({ defaultDialect: DIALECT_DRAFT_07 });
const legacyUri = legacy.registerSchema(
  shape,
  "https://example.com/legacy-tuple",
);
assert.equal(legacy.evaluate(legacyUri, ["a", 1]).valid, true);
assert.equal(legacy.evaluate(legacyUri, [1, "a"]).valid, false);

// The same document under 2020-12: the array is a non-schema in a schema
// position (tuples belong to prefixItems), so registration throws.
const modern = createEngine({ defaultDialect: DIALECT_2020_12 });
assert.throws(
  () => modern.registerSchema(shape, "https://example.com/modern-items"),
  InvalidSchemaError,
);
```

The structural check covers schema positions only. Invalid keyword
**values** — a string where `minLength` requires an integer — are the
metaschema's job; opt in with `validateSchemas` (see
[Metaschemas](metaschemas.md)):

```ts
import assert from "node:assert";
import { createEngine, SchemaValidationError } from "@json-schema-engine/core";

// Accepted structurally; behavior of the bad value is undefined.
createEngine().registerSchema(
  { minLength: "3" },
  "https://example.com/bad-value",
);

// Rejected against the bundled 2020-12 metaschema.
const strict = createEngine({ validateSchemas: true });
assert.throws(
  () =>
    strict.registerSchema({ minLength: "3" }, "https://example.com/checked"),
  SchemaValidationError,
);
```

## Unknown dialects

`registerSchema` throws `UnknownDialectError` for a `$schema` value — at
the document root or at an embedded resource — that names a dialect the
engine has neither built in nor assembled; the error's `dialectUri` names
it. `loadSchema` and `load` instead fetch that dialect's metaschema through
the loaders, assemble the dialect from its `$vocabulary`, and register
again, so they throw only when no loader provides it. See
[Metaschemas](metaschemas.md) for assembling dialects from `$vocabulary`.

```ts
import assert from "node:assert";
import { createEngine, UnknownDialectError } from "@json-schema-engine/core";

const engine = createEngine();

assert.throws(() => {
  engine.registerSchema(
    { $schema: "https://example.com/no-such-dialect" },
    "https://example.com/bad-dialect",
  );
}, UnknownDialectError);
```

## draft-04 (separate package)

draft-04's syntax differs from every later draft — `id` instead of `$id`,
boolean `exclusiveMinimum`/`exclusiveMaximum` modifying sibling bounds,
and no `const`, `contains`, `propertyNames`, or `if`/`then`/`else` — so it
ships as `@json-schema-engine/dialect-draft04` rather than in core. One registration call
adds the dialect, its keyword behaviors, and the vendored draft-04
metaschema to an engine; draft-04 documents then coexist with every other
draft in the same registry, including `$ref`s across the dialect boundary
in both directions.

```ts
import assert from "node:assert";
import { createEngine } from "@json-schema-engine/core";
import { registerDraft04 } from "@json-schema-engine/dialect-draft04";

const engine = createEngine();
registerDraft04(engine);

const uri = engine.registerSchema(
  {
    $schema: "http://json-schema.org/draft-04/schema#",
    minimum: 5,
    exclusiveMinimum: true, // draft-04: a boolean modifying `minimum`
  },
  "https://example.com/draft-04",
);

assert.equal(engine.evaluate(uri, 5).valid, false);
assert.equal(engine.evaluate(uri, 6).valid, true);
```

The package is also the reference for authoring a dialect outside core:
keywords draft-04 shares with draft-07 are reused as behavior objects read
from the engine's draft-07 dialect (`engine.dialects.getDialect(...)`),
only the genuinely different keywords are implemented fresh, and the
assembly uses the same `registerVocabulary`/`registerDialect` calls
available to any caller — with `DialectOptions.identifiers` supplying the
`id`-based identifier syntax. To add your own keywords or dialects, start
with [Custom keywords](custom-keywords.md).
