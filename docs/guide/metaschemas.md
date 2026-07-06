# Metaschemas

A metaschema is a schema for schemas: its `$vocabulary` keyword lists the
vocabularies a dialect assembles from. The engine loads a metaschema like
any other resource and builds the dialect it describes on demand.

## Assemble a dialect from `$vocabulary`

A schema's `$schema` can point at a metaschema the engine has never seen.
As long as a loader supplies that metaschema and every vocabulary it
requires is registered, the engine assembles the dialect the first time
it's needed.

```ts
import assert from "node:assert";
import { createEngine } from "@jse/core";

const META = "https://example.com/meta/validation-only";
const CORE = "https://json-schema.org/draft/2020-12/vocab/core";
const VALIDATION = "https://json-schema.org/draft/2020-12/vocab/validation";

const engine = createEngine({
  loaders: [
    (uri) =>
      uri === META
        ? {
            value: {
              $id: META,
              $vocabulary: { [CORE]: true, [VALIDATION]: true },
            },
          }
        : undefined,
  ],
});

const uri = await engine.loadSchema(
  { $schema: META, type: "integer" },
  "https://example.com/uses-meta",
);
assert.equal(engine.evaluate(uri, 1).valid, true);
assert.equal(engine.evaluate(uri, "x").valid, false);
```

## Unknown required vocabularies

A `$vocabulary` entry marked `true` is required. If the engine has no
vocabulary registered under that URI, assembling the dialect throws
`UnknownVocabularyError`. Entries marked `false` are optional and are
skipped when unknown.

```ts
import assert from "node:assert";
import { createEngine, UnknownVocabularyError } from "@jse/core";

const META = "https://example.com/meta/needs-unknown";
const CORE = "https://json-schema.org/draft/2020-12/vocab/core";

const engine = createEngine({
  loaders: [
    (uri) =>
      uri === META
        ? {
            value: {
              $id: META,
              $vocabulary: {
                [CORE]: true,
                "https://example.com/vocab/nope": true,
              },
            },
          }
        : undefined,
  ],
});

await assert.rejects(
  engine.loadSchema(
    { $schema: META },
    "https://example.com/needs-unknown-schema",
  ),
  UnknownVocabularyError,
);
```

## Validate schemas against their metaschema

`validateSchemas: true` checks every registered or loaded schema against
its dialect's metaschema, throwing `SchemaValidationError` on failure. The
standard metaschemas for the four built-in dialects are bundled, so this
works with no loader for documents using them.

```ts
import assert from "node:assert";
import { createEngine, SchemaValidationError } from "@jse/core";

const engine = createEngine({ validateSchemas: true });

assert.throws(() => {
  engine.registerSchema({ type: 123 }, "https://example.com/bad-type");
}, SchemaValidationError);

assert.equal(
  engine.registerSchema({ type: "string" }, "https://example.com/ok"),
  "https://example.com/ok",
);
```

## Validate against a custom metaschema

The same check applies to a custom `$schema`, as long as its metaschema
is available — through a loader or already registered.

```ts
import assert from "node:assert";
import { createEngine, SchemaValidationError, JsonValue } from "@jse/core";

const META = "https://example.com/meta/checked";
const CORE = "https://json-schema.org/draft/2020-12/vocab/core";
const VALIDATION = "https://json-schema.org/draft/2020-12/vocab/validation";

const metaschema: JsonValue = {
  $id: META,
  $vocabulary: { [CORE]: true, [VALIDATION]: true },
  type: ["object", "boolean"],
  properties: { maxLength: { type: "integer" } },
};

const engine = createEngine({
  validateSchemas: true,
  loaders: [(uri) => (uri === META ? { value: metaschema } : undefined)],
});

await assert.rejects(
  engine.loadSchema(
    { $schema: META, maxLength: "long" },
    "https://example.com/checked-bad",
  ),
  SchemaValidationError,
);
await assert.equal(
  await engine.loadSchema(
    { $schema: META, maxLength: 3 },
    "https://example.com/checked-good",
  ),
  "https://example.com/checked-good",
);
```
