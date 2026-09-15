# @json-schema-engine/dialect-draft04

JSON Schema draft-04 dialect for `@json-schema-engine/core`, assembled entirely through core's public dialect-authoring surface. draft-04's syntax differs from every later draft — `id` instead of `$id`, boolean `exclusiveMinimum`/`exclusiveMaximum` modifying sibling bounds, no `const`, `contains`, `propertyNames`, or `if`/`then`/`else` — so it ships separately rather than in core. Add this package when you need to validate draft-04 documents; they can coexist with every other draft in the same registry, including `$ref`s across the dialect boundary. Needs `@json-schema-engine/core` installed alongside.

## Install

```sh
npm install @json-schema-engine/dialect-draft04 @json-schema-engine/core
```

## Example

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

## Status

Version 0.0.1 is published for initial public feedback on both the functionality and the documentation. APIs may change before 1.0. [STATUS.md](https://github.com/handrews/json-schema-engine/blob/main/STATUS.md) is the authoritative statement of what is built and what is staged.

## Documentation

- [User guide](https://github.com/handrews/json-schema-engine/blob/main/docs/guide/index.md)
- [Dialects](https://github.com/handrews/json-schema-engine/blob/main/docs/guide/dialects.md)
- [Conformance](https://github.com/handrews/json-schema-engine/blob/main/docs/conformance.md)
- [Repository](https://github.com/handrews/json-schema-engine)

## License

MIT
