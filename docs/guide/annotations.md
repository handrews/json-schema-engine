# Annotations

Annotations are keyword values a schema attaches to instance locations —
`title`, `deprecated`, `readOnly`, `format`, unknown extension keywords, and
others. An annotation's value is always the keyword's own value. Applicator
keywords such as `properties` never appear as annotations: what they
communicate to `unevaluatedProperties` is dependency data, internal to
evaluation and unaffected by any annotation setting. The engine returns
annotations per evaluation when asked; collection is off by default, so
annotation work can be elided.

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
specific keywords or vocabularies.

```ts
import assert from "node:assert";
import { createEngine } from "@jse/core";

const engine = createEngine();
const uri = engine.registerSchema(
  { title: "T", description: "D", "x-internal": true },
  "https://example.com/deny",
);

const result = engine.evaluate(uri, 1, {
  collectAnnotations: true,
  retention: { excludeKeywords: ["description"] },
});
assert.deepEqual(
  result.annotations?.map((a) => a.keyword),
  ["title", "x-internal"],
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

Keywords that read other keywords' dependency data (`unevaluatedProperties`,
`unevaluatedItems`) see it regardless of any retention policy: dependency
data is not annotation output. Retention controls only what the caller
receives. See [Custom keywords and vocabularies](custom-keywords.md) for the
underlying mechanism.

```ts
import assert from "node:assert";
import { createEngine } from "@jse/core";

const engine = createEngine();
const uri = engine.registerSchema(
  { properties: { a: true }, unevaluatedProperties: false },
  "https://example.com/unevaluated",
);

const options = { collectAnnotations: true, retention: { keywords: [] } };
assert.equal(engine.evaluate(uri, { a: 1 }, options).valid, true);
assert.equal(engine.evaluate(uri, { a: 1, b: 2 }, options).valid, false);
```
