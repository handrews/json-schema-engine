# @json-schema-engine/core

Interpreter core for JSON Schema: a registry, dialects, evaluation, annotations, and output rendering for draft 2020-12, draft 2019-09, draft-07, and draft-06. Install this package on its own for validation and annotation collection; add `@json-schema-engine/compiler`, `@json-schema-engine/formats`, or `@json-schema-engine/dialect-draft04` alongside it when you need compiled artifacts, format assertions, or draft-04 support.

## Install

```sh
npm install @json-schema-engine/core
```

## Example

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

const result = engine.evaluate(uri, { tags: [2] }, { output: "basic" });
assert.equal(result.valid, false);
assert.ok(result.errors && result.errors.length > 0);
assert.equal(engine.evaluate(uri, { id: 1, tags: ["a"] }).valid, true);
```

## Status

Version 0.0.1 is published for initial public feedback on both the functionality and the documentation. APIs may change before 1.0. [STATUS.md](https://github.com/handrews/json-schema-engine/blob/main/STATUS.md) is the authoritative statement of what is built and what is staged.

## Documentation

- [User guide](https://github.com/handrews/json-schema-engine/blob/main/docs/guide/index.md)
- [Validation](https://github.com/handrews/json-schema-engine/blob/main/docs/guide/validation.md)
- [Annotations](https://github.com/handrews/json-schema-engine/blob/main/docs/guide/annotations.md)
- [Conformance](https://github.com/handrews/json-schema-engine/blob/main/docs/conformance.md)
- [Repository](https://github.com/handrews/json-schema-engine)

## License

MIT
