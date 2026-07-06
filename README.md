# json-schema-engine

A JSON Schema implementation for JavaScript/TypeScript that is both
spec-complete and built for speed. It validates instances **and** collects
annotations, with full location information in every output unit — the
combination existing implementations do not offer.

**Status: pre-release.** The package is not yet published; the npm name is
TBD. APIs may change before 1.0.

## Why

- **Complete:** 100% of the official test suite via
  [Bowtie](https://bowtie.report/) for draft 2020-12, 2019-09, draft-07, and
  draft-06 — including `$dynamicRef`, `$vocabulary`, remote references, and
  annotation semantics.
- **Annotation-first:** annotations are a primary output, not an
  afterthought. Collection is configurable per evaluation and costs nothing
  when off.
- **Full location data:** every error and annotation carries the evaluation
  path, schema location, and instance location, in either the current output
  spec's field names or the 2020-12 names.
- **Extensible:** custom keywords, vocabularies, and dialects use the same
  registry as the built-in drafts.
- A compiler tier targeting benchmark-leading performance is in development
  ([DESIGN.md](DESIGN.md) M6). The current interpreter is the reference
  implementation.

## Validate

```ts
import assert from "node:assert";
import { createEngine } from "@jse/core";

const engine = createEngine();
const uri = engine.registerSchema(
  {
    type: "object",
    properties: { name: { type: "string" } },
    required: ["name"],
  },
  "https://example.com/person",
);

assert.equal(engine.evaluate(uri, { name: "Ada" }).valid, true);

// List output includes one unit per error, with locations.
const result = engine.evaluate(uri, {}, { output: "list" });
assert.equal(result.valid, false);
assert.equal(result.errors?.[0]?.evaluationPath, "/required");
assert.equal(result.errors?.[0]?.instanceLocation, "");
```

## Collect annotations

```ts
import assert from "node:assert";
import { createEngine } from "@jse/core";

const engine = createEngine();
const uri = engine.registerSchema(
  {
    title: "Person",
    type: "object",
    properties: { name: { title: "Full name", deprecated: true } },
  },
  "https://example.com/annotated",
);

const result = engine.evaluate(
  uri,
  { name: "Ada" },
  {
    collectAnnotations: true,
    retention: { keywords: ["title", "deprecated"] },
  },
);

const titles = result.annotations?.filter((a) => a.keyword === "title");
assert.deepEqual(titles?.map((t) => t.instanceLocation).sort(), ["", "/name"]);
```

## Documentation

- [User guide](docs/guide/index.md) — task-oriented, example-driven.
- API reference — generated from source: `npm run docs:api`, output in
  `docs/reference/`.
- [CONTRIBUTING.md](CONTRIBUTING.md) — build, test, and contribution
  workflow.
- [ANALYSIS.md](ANALYSIS.md), [DESIGN.md](DESIGN.md) — background: why this
  engine exists and how it is built.

## IP policy

The implementation is written from the JSON Schema specifications and the
official test suite only. Competing implementations are executed as
benchmark subjects and correctness oracles; their source is never used as an
implementation reference. See [DESIGN.md](DESIGN.md) D15.
