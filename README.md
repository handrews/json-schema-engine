# json-schema-engine

A JSON Schema implementation for JavaScript/TypeScript that is both
spec-complete and built for speed. It validates instances and fully
supports annotation collection and error output formats from both
the current IETF draft and other proposals under consideration.

Produced by Henry Andrews via Claude Code.

**`@json-schema-engine/core`, `@json-schema-engine/compiler`,
`@json-schema-engine/formats`, and `@json-schema-engine/dialect-draft04` are
[published on npm](https://www.npmjs.com/org/json-schema-engine).**

**Status: The `0.0.x` line is functionally complete but experimental.**

See [CHANGELOG.md](CHANGELOG.md) for the current release's contents.
[DESIGN.md](DESIGN.md) is the design contract and carries the milestone
status.

All features are expected to work, but have not been tested beyond
what the CI tests, including Bowtie, cover. Additional testing
and CI enhancements are in progress.

Aside from the functionality, during the `0.0.x` release line,
the exact shape of the function or method calls and any exceptions
they raise may change to improve developer experience. This release
line also has AI-written documentation. Promotion to `0.1.0` will
occur when the interface is believed to have solid developer UX and
the documentation has been human-audited.

Promotion to `1.0.0` will occur when real-world usage indicates
production-readiness.

A follow-on package will support migrating from `ajv`, including support
for most of the keywords in `ajv-keywords`.

The remaining text in this README is AI-written.

---

[STATUS.md](STATUS.md) is the authoritative statement of what is built,
what is deliberately staged for later, and which gates run where.

## Why

- **Complete:** 100% of the official test suite for draft 2020-12,
  2019-09, draft-07, and draft-06 — including `$dynamicRef`,
  `$vocabulary`, remote references, and annotation semantics. Verified
  with local [Bowtie](https://bowtie.report/) harness runs; the public
  bowtie.report listing is pending submission (see
  [STATUS.md](STATUS.md)). draft-04 is available as a separately
  packaged dialect ([@json-schema-engine/dialect-draft04](packages/dialect-draft04))
  with its own zero-skip suite leg, and coexists with every other draft
  in one registry.
- **Annotation-first:** annotations are a primary output, not an
  afterthought. Public collection is configurable per evaluation; when it is
  off, output-only annotation work is elided while values needed internally by
  consumers such as `unevaluatedProperties` still flow through the channel.
- **Full location data:** every error and annotation carries the evaluation
  path, schema location, and instance location, in either the current output
  spec's field names or the 2020-12 names.
- **Extensible:** custom keywords, vocabularies, and dialects use the same
  registry as the built-in drafts.
- **Two tiers, one semantics:** the interpreter is the reference
  implementation; the compiler tier emits specialized validators for
  static schemas and falls back to the interpreter for anything dynamic.
  Compiled flag-mode validation is at-or-faster than AJV on the gate
  corpus; list-mode (all-errors) output is slower than AJV by design — it
  never short-circuits and reproduces the interpreter's error units
  exactly.
- **Format assertions:** all standard formats implemented from their RFCs,
  including full IDNA2008 `idn-hostname`/`idn-email`
  ([@json-schema-engine/formats](packages/formats)).
- **AJV migration:** `@json-schema-engine/ajv-compat` emulates the AJV v8 surface for a
  documented subset, pinned against executed-AJV fixtures — see the
  [migration guide](docs/guide/ajv-migration.md) and
  [compatibility matrix](packages/ajv-compat/COMPAT.md).

## Install

```sh
npm install @json-schema-engine/core
```

Add the others as needed:

- `@json-schema-engine/compiler` — compiled validators and evaluators for
  hot paths; needs `core`.
- `@json-schema-engine/formats` — the `format` implementations, for
  format assertion; needs `core`.
- `@json-schema-engine/dialect-draft04` — draft-04 support alongside the
  built-in drafts; needs `core`.

## Validate

```ts
import assert from "node:assert";
import { createEngine } from "@json-schema-engine/core";

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
assert.equal(result.errors?.[0]?.inputLocation, "");
```

## Collect annotations

```ts
import assert from "node:assert";
import { createEngine } from "@json-schema-engine/core";

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
    output: "basic",
    annotations: { keywords: ["title", "deprecated"] },
  },
);

const titles = result.annotations?.filter((a) => a.keyword === "title");
assert.deepEqual(titles?.map((t) => t.inputLocation).sort(), ["", "/name"]);
```

## Documentation

- [User guide](docs/guide/index.md) — task-oriented, example-driven.
- [Conformance and evidence](docs/conformance.md) — how JSE implements the
  IETF draft-03 model, the fixtures and suite results behind that claim, and
  where it diverges.
- [Security and resource limits](docs/guide/security.md) — evaluating
  untrusted schemas and instances (ReDoS, recursion depth, uniqueness cost).
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
