# @json-schema-engine/compiler

Compiler tier for JSON Schema: turns a schema registered with `@json-schema-engine/core` into a specialized validator, resolving `$dynamicRef` at compile time wherever every path agrees on the target and trampolining to the interpreter only for what it cannot emit statically. Add this package once interpreted evaluation shows up in a profile — a compiled artifact is exactly as correct as `Engine.evaluate` and never less complete, so switching tiers is a performance decision, not a semantic one. Needs `@json-schema-engine/core` installed alongside.

## Install

```sh
npm install @json-schema-engine/compiler @json-schema-engine/core
```

## Example

```ts
import assert from "node:assert";
import { createEngine } from "@json-schema-engine/core";
import { compileValidator, compileList } from "@json-schema-engine/compiler";

const engine = createEngine();
const uri = engine.registerSchema(
  { properties: { name: { type: "string", minLength: 1 } } },
  "https://example.com/named",
);

const flag = compileValidator(engine, uri);
assert.equal(flag.validate({ name: "" }), false);
assert.equal(flag.validate({ name: "ok" }), true);

const list = compileList(engine, uri);
const result = list.evaluateList({ name: "" });
assert.equal(result.valid, false);
assert.equal(result.errors[0]?.inputLocation, "/name");
```

## Status

Version 0.0.1 is published for initial public feedback on both the functionality and the documentation. APIs may change before 1.0. [STATUS.md](https://github.com/handrews/json-schema-engine/blob/main/STATUS.md) is the authoritative statement of what is built and what is staged.

## Documentation

- [User guide](https://github.com/handrews/json-schema-engine/blob/main/docs/guide/index.md)
- [Compiling schemas](https://github.com/handrews/json-schema-engine/blob/main/docs/guide/compiled.md)
- [Conformance](https://github.com/handrews/json-schema-engine/blob/main/docs/conformance.md)
- [Repository](https://github.com/handrews/json-schema-engine)

## License

MIT
