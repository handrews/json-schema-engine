# @json-schema-engine/formats

Format implementations for `@json-schema-engine/core`'s format-assertion vocabulary and `assertFormats` configuration — `date`, `date-time`, `time`, `duration`, `email`, `hostname`, `ipv4`, `ipv6`, `uri`, `uri-reference`, `uri-template`, `iri`, `iri-reference`, `json-pointer`, `relative-json-pointer`, `regex`, `uuid`, and their per-dialect tables. Add this package when a schema needs `format` to actually reject bad values rather than only annotate them. Needs `@json-schema-engine/core` installed alongside.

## Install

```sh
npm install @json-schema-engine/formats @json-schema-engine/core
```

## Example

```ts
import assert from "node:assert";
import { createEngine } from "@json-schema-engine/core";
import { FORMATS_2020_12 } from "@json-schema-engine/formats";

const engine = createEngine({
  formats: FORMATS_2020_12,
  assertFormats: true,
});
const uri = engine.registerSchema(
  { type: "string", format: "date" },
  "https://example.com/date",
);

assert.equal(engine.evaluate(uri, "2024-01-15").valid, true);
assert.equal(engine.evaluate(uri, "not-a-date").valid, false);
```

## Status

Version 0.0.1 is published for initial public feedback on both the functionality and the documentation. APIs may change before 1.0. [STATUS.md](https://github.com/handrews/json-schema-engine/blob/main/STATUS.md) is the authoritative statement of what is built and what is staged.

## Documentation

- [User guide](https://github.com/handrews/json-schema-engine/blob/main/docs/guide/index.md)
- [Validation](https://github.com/handrews/json-schema-engine/blob/main/docs/guide/validation.md)
- [Dialects](https://github.com/handrews/json-schema-engine/blob/main/docs/guide/dialects.md)
- [Conformance](https://github.com/handrews/json-schema-engine/blob/main/docs/conformance.md)
- [Repository](https://github.com/handrews/json-schema-engine)

## License

MIT
