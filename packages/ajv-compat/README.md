# @json-schema-engine/ajv-compat

Migration adapter emulating a documented subset of AJV v8's public API — `Ajv`, `Ajv2019`, `Ajv2020`, `compile`, `addFormat`, `addKeyword`, the data-modifying options, and their error objects — over `@json-schema-engine/core`. Emulated behavior is pinned against executed-AJV fixtures; the AJV-implementation-coupled surface (code-style keywords, `$data`, `$async`, JTD) fails loudly with a typed error rather than approximating. Add this package when migrating code off AJV that stays inside the emulated surface — see [COMPAT.md](https://github.com/handrews/json-schema-engine/blob/main/packages/ajv-compat/COMPAT.md) for the complete matrix of what is emulated, ignored, and refused.

This package is not yet published; it follows in a later release.

## Example

```ts
import assert from "node:assert";
import { Ajv2020 } from "@json-schema-engine/ajv-compat";

const ajv = new Ajv2020({ allErrors: true });
const validate = ajv.compile({
  type: "object",
  required: ["id"],
  properties: { id: { type: "integer" } },
});

assert.equal(validate({ id: "x" }), false);
const first = validate.errors![0]!;
assert.equal(first.keyword, "type");
assert.equal(first.instancePath, "/id");
assert.equal(ajv.errorsText(validate.errors), "data/id must be integer");
```

## Status

Not yet published: this package follows the `0.0.1` release of the other packages once it is adapted to the current record model ([ADR 0001](https://github.com/handrews/json-schema-engine/blob/main/docs/planning/next-steps/decisions/0001-first-release-scope.md)). Until then, consume it as an `npm pack` tarball from a repository checkout. APIs may change before 1.0. [STATUS.md](https://github.com/handrews/json-schema-engine/blob/main/STATUS.md) is the authoritative statement of what is built and what is staged.

## Documentation

- [User guide](https://github.com/handrews/json-schema-engine/blob/main/docs/guide/index.md)
- [Migrating from AJV](https://github.com/handrews/json-schema-engine/blob/main/docs/guide/ajv-migration.md)
- [COMPAT.md](https://github.com/handrews/json-schema-engine/blob/main/packages/ajv-compat/COMPAT.md)
- [Conformance](https://github.com/handrews/json-schema-engine/blob/main/docs/conformance.md)
- [Repository](https://github.com/handrews/json-schema-engine)

## License

MIT
