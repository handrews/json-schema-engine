# Source positions

A loader can report where in the original source text each part of a
schema came from. When it does, `positions: true` decorates error and
annotation units with a `source` field pointing back into that text.

## The loader capability

A `LoadedDocument` may include `getRange`, a function from a document-
rooted JSON Pointer to a `SourceRange` (a value span, plus a key span for
object members). `@json-schema-engine/test-kit`'s `parseJsonWithRanges` is a reference
implementation, useful in tests and as a model for a real one.

```ts
import assert from "node:assert";
import { createEngine } from "@json-schema-engine/core";
import { parseJsonWithRanges } from "@json-schema-engine/test-kit";

const text = `{
  "$id": "https://example.com/root",
  "required": ["x"]
}`;

const engine = createEngine({
  loaders: [
    (uri) =>
      uri === "https://example.com/root"
        ? parseJsonWithRanges(text)
        : undefined,
  ],
});

const uri = await engine.load("https://example.com/root");
const result = engine.evaluate(uri, {}, { output: "list", positions: true });

assert.equal(result.valid, false);
const unit = result.errors?.[0]!;
assert.equal(unit.source?.documentUri, "https://example.com/root");
assert.equal(unit.source?.pointer, "/required");
assert.ok(unit.source?.range?.key !== undefined);
```

## Locate a schema location directly

`engine.locate(schemaLocation)` runs the same lookup outside of an
evaluation result — useful for jumping from any canonical schema location
straight to source text.

```ts
import assert from "node:assert";
import { createEngine } from "@json-schema-engine/core";
import { parseJsonWithRanges } from "@json-schema-engine/test-kit";

const text = `{
  "$id": "https://example.com/leaf",
  "type": "integer"
}`;

const engine = createEngine({
  loaders: [
    (uri) =>
      uri === "https://example.com/leaf"
        ? parseJsonWithRanges(text)
        : undefined,
  ],
});

const uri = await engine.load("https://example.com/leaf");
const location = engine.locate(`${uri}#/type`);

assert.equal(location?.documentUri, "https://example.com/leaf");
assert.equal(location?.pointer, "/type");
assert.ok(location?.range !== undefined);
```

## Without a position-reporting loader

`registerSchema` and loaders without `getRange` report no positions.
`locate` still resolves the document and pointer; `range` is simply
absent.

```ts
import assert from "node:assert";
import { createEngine } from "@json-schema-engine/core";

const engine = createEngine();
const uri = engine.registerSchema(
  { $defs: { s: { type: "number" } } },
  "https://example.com/plain",
);

const location = engine.locate(`${uri}#/$defs/s`);
assert.deepEqual(location, {
  documentUri: "https://example.com/plain",
  pointer: "/$defs/s",
});
```
