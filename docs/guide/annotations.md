# Annotations

Annotations are keyword values a schema attaches to instance locations —
`title`, `deprecated`, `readOnly`, unknown extension keywords, and others.
The engine returns them per evaluation when asked; public collection is off by
default, so output-only annotations can be elided. Annotation values needed by
consumer keywords such as `unevaluatedProperties` still flow internally
regardless of the public collection setting.

Annotations are reported only for valid results. On failure, a failed
subschema's annotations are dropped, per the specification.

## Collect everything

```ts
import assert from "node:assert";
import { createEngine } from "@jse/core";

const engine = createEngine();
const uri = engine.registerSchema(
  {
    title: "Config",
    properties: {
      retries: { title: "Retry count", deprecated: true },
    },
    "x-internal": true,
  },
  "https://example.com/config",
);

const result = engine.evaluate(
  uri,
  { retries: 3 },
  { collectAnnotations: true },
);
assert.equal(result.valid, true);

const byKeyword = new Map(
  result.annotations?.map((a) => [`${a.keyword}@${a.instanceLocation}`, a]),
);
assert.equal(byKeyword.get("title@")?.annotation, "Config");
assert.equal(byKeyword.get("title@/retries")?.annotation, "Retry count");
assert.equal(byKeyword.get("deprecated@/retries")?.annotation, true);
// Unknown keywords are collected as annotations too.
assert.equal(byKeyword.get("x-internal@")?.annotation, true);
```

Each annotation unit carries the same three locations as an error unit
(`evaluationPath`, `schemaLocation`, `instanceLocation`) plus the keyword
name, its vocabulary URI (when known), and the annotation value.

## Allow lists

`retention.keywords` and `retention.vocabularies` select what to keep. The
two lists are OR-ed.

```ts
import assert from "node:assert";
import { createEngine } from "@jse/core";

const engine = createEngine();
const uri = engine.registerSchema(
  { title: "T", description: "D", default: 0 },
  "https://example.com/allow",
);

const result = engine.evaluate(uri, 5, {
  collectAnnotations: true,
  retention: { keywords: ["title", "default"] },
});
assert.deepEqual(result.annotations?.map((a) => a.keyword).sort(), [
  "default",
  "title",
]);
```

## Deny lists

`retention.excludeKeywords` and `retention.excludeVocabularies` subtract
after the allow lists. Use a deny list alone to keep everything except
specific noise — for example, the applicator bookkeeping annotations.

```ts
import assert from "node:assert";
import { createEngine } from "@jse/core";

const engine = createEngine();
const uri = engine.registerSchema(
  { title: "T", properties: { a: { title: "A" } } },
  "https://example.com/deny",
);

const result = engine.evaluate(
  uri,
  { a: 1 },
  {
    collectAnnotations: true,
    retention: {
      excludeVocabularies: [
        "https://json-schema.org/draft/2020-12/vocab/applicator",
      ],
    },
  },
);
// Both titles remain; the applicator's `properties` annotation is denied.
assert.deepEqual(
  result.annotations?.map((a) => a.keyword),
  ["title", "title"],
);
```

## Predicate

`retention.keep` runs last, on the rendered unit.

```ts
import assert from "node:assert";
import { createEngine } from "@jse/core";

const engine = createEngine();
const uri = engine.registerSchema(
  { title: "root", properties: { a: { title: "leaf" } } },
  "https://example.com/keep",
);

const result = engine.evaluate(
  uri,
  { a: 1 },
  {
    collectAnnotations: true,
    retention: {
      keywords: ["title"],
      keep: (unit) => unit.instanceLocation === "",
    },
  },
);
assert.equal(result.annotations?.length, 1);
assert.equal(result.annotations?.[0]?.annotation, "root");
```

## Retention never affects validation

Keywords that read other keywords' annotations internally
(`unevaluatedProperties`, `unevaluatedItems`) see them regardless of any
retention policy. Retention controls only what the caller receives. See
[Custom keywords and vocabularies](custom-keywords.md) for the underlying
mechanism.

```ts
import assert from "node:assert";
import { createEngine } from "@jse/core";

const engine = createEngine();
const uri = engine.registerSchema(
  { properties: { a: true }, unevaluatedProperties: false },
  "https://example.com/unevaluated",
);

const options = { retention: { excludeKeywords: ["properties"] } };
assert.equal(engine.evaluate(uri, { a: 1 }, options).valid, true);
assert.equal(engine.evaluate(uri, { a: 1, b: 2 }, options).valid, false);
```
