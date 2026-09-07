# Compiling schemas

> Installation: TBD — the package is not yet published. Within this
> repository, import from `@jse/compiler`.

`@jse/core` interprets a schema on every evaluation. `@jse/compiler` turns a
registered schema into specialized JavaScript once, so later evaluations skip
the interpretive walk. The compiled tier is not a second implementation: any
subschema the compiler cannot emit calls back into the interpreter, so an
artifact is exactly as correct as `Engine.evaluate` and never less complete.

Both tiers are refereed against each other by the official test suites in
every supported dialect and by a differential fuzzer, so tier choice is a
performance decision, not a semantic one.

## Compile a validator

`compileValidator` produces the verdict-only (`flag`) artifact — the fastest
thing the engine offers, and the right default when you only need a boolean.

```ts
import assert from "node:assert";
import { createEngine } from "@jse/core";
import { compileValidator } from "@jse/compiler";

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

const artifact = compileValidator(engine, uri);

assert.equal(artifact.validate({ id: 1, tags: ["a"] }), true);
assert.equal(artifact.validate({ tags: ["a"] }), false);
```

`validate` returns a boolean. Compilation is synchronous, and the artifact
carries the generated `source` and its `plan` for inspection.

## Collect errors

`compileList` is the flat-error artifact. `evaluateList` returns the same
error units, in the same order, as
`engine.evaluate(uri, x, { output: "list" })`; `basic()` renders the Basic
output document.

```ts
import assert from "node:assert";
import { createEngine } from "@jse/core";
import { compileList } from "@jse/compiler";

const engine = createEngine();
const uri = engine.registerSchema(
  { properties: { name: { type: "string", minLength: 1 } } },
  "https://example.com/named",
);

const artifact = compileList(engine, uri);
const result = artifact.evaluateList({ name: "" });

assert.equal(result.valid, false);
assert.equal(result.errors.length, 1);
assert.equal(result.errors[0]?.inputLocation, "/name");

// The same evaluation as the interpreter's list output.
assert.deepEqual(
  result.errors,
  engine.evaluate(uri, { name: "" }, { output: "list" }).errors,
);
```

List artifacts never short-circuit: every branch runs, so the error set is
complete. That is why `compileValidator` stays the faster choice when the
verdict is all you need.

`errorParams: true` adds `keyword`, `vocabulary`, and structured `params` to
each unit, matching the interpreter's `errorParams` option.

## Collect annotations

Pass `annotations` to `compileList` — `true`, or the same selection object
the interpreter takes (`keywords`/`vocabularies` allow lists,
`excludeKeywords`/`excludeVocabularies` deny lists, and a `keep` predicate).
The lists are specialized into the artifact at compile time; a `keep`
predicate runs at evaluation. Annotations are returned on valid instances
only, matching the interpreter's contract.

```ts
import assert from "node:assert";
import { createEngine } from "@jse/core";
import { compileList } from "@jse/compiler";

const engine = createEngine();
const uri = engine.registerSchema(
  {
    title: "Item",
    properties: { id: { type: "integer", default: 0 } },
  },
  "https://example.com/annotated",
);

const artifact = compileList(engine, uri, {
  annotations: { keywords: ["default"] },
});
const result = artifact.evaluateList({ id: 3 });

assert.equal(result.valid, true);
assert.deepEqual(
  result.annotations?.map((a) => a.keyword),
  ["default"],
);
```

## Every output format

`compileEvaluator` records each application's node as it validates and
renders any output format from that one tree, through the same renderers the
interpreter uses. Format and `trace` are chosen per evaluation.

```ts
import assert from "node:assert";
import { createEngine } from "@jse/core";
import { compileEvaluator } from "@jse/compiler";

const engine = createEngine();
const uri = engine.registerSchema(
  { properties: { name: { type: "string" } } },
  "https://example.com/shaped",
);

const evaluator = compileEvaluator(engine, uri);
const input = { name: 42 };

assert.equal(evaluator.evaluate(input).valid, false);

// Any format, from the same artifact.
for (const output of ["list", "hierarchical", "detailed", "basic"] as const) {
  assert.deepEqual(
    evaluator.evaluate(input, { output }),
    engine.evaluate(uri, input, { output }),
  );
}
```

Which controls are fixed at compile time and which are per-evaluation is a
real distinction:

| Control                   | Chosen at       |
| ------------------------- | --------------- |
| `output` (format name)    | each evaluation |
| `trace`                   | each evaluation |
| `verbose` (level)         | compile time    |
| `annotations` (selection) | compile time    |
| `errorParams`             | compile time    |

The verbose level needs irrelevant records retained, which the evaluator only
does when compiled for it. Ask an artifact for a level it was not compiled
for and it throws `OutputOptionsError` rather than silently degrading.

```ts
import assert from "node:assert";
import { createEngine, OutputOptionsError } from "@jse/core";
import { compileEvaluator } from "@jse/compiler";

const engine = createEngine();
const uri = engine.registerSchema(
  { anyOf: [{ type: "string" }, { type: "number" }] },
  "https://example.com/level",
);

const relevant = compileEvaluator(engine, uri);
assert.throws(
  () => relevant.evaluate("x", { output: "verbose" }),
  OutputOptionsError,
);

const verbose = compileEvaluator(engine, uri, { verbose: true });
assert.equal(verbose.evaluate("x", { output: "verbose" }).valid, true);
```

A retaining artifact serves the relevant level too, at the cost of a copy per
dropped record. The emitted source is identical either way.

## Artifacts are frozen at compile time

An artifact binds to a snapshot of the engine's schema and dialect registries
taken when it was compiled. Schemas registered, re-registered, or given a new
dialect afterwards are invisible to it, and a `$ref` unresolved at compile
time stays unresolved for that artifact. This holds for interpreted islands
inside the artifact too, so there is one rule across the whole thing.

```ts
import assert from "node:assert";
import { createEngine } from "@jse/core";
import { compileValidator } from "@jse/compiler";

const engine = createEngine();
engine.registerSchema({ type: "string" }, "https://example.com/target");
const uri = engine.registerSchema(
  { $ref: "https://example.com/target" },
  "https://example.com/holder",
);

const artifact = compileValidator(engine, uri);
assert.equal(artifact.validate("ok"), true);
assert.equal(artifact.validate(1), false);

// A later re-registration does not reach the existing artifact.
engine.registerSchema({ type: "integer" }, "https://example.com/target");
assert.equal(artifact.validate("ok"), true);

// A freshly compiled artifact sees the new registration.
assert.equal(compileValidator(engine, uri).validate("ok"), false);
```

Compile after registration is complete. If you need an artifact to pick up
new schemas, compile a new one.

## What compiled, and what fell back

`$dynamicRef`/`$recursiveRef` resolve against the dynamic scope of the
evaluation, which is not known at compile time, so those subschemas stay
interpreted islands. `explainCompilation` reports the split.

```ts
import assert from "node:assert";
import { createEngine } from "@jse/core";
import { buildPlan, explainCompilation } from "@jse/compiler";

const engine = createEngine();
const uri = engine.registerSchema(
  {
    $id: "https://example.com/plain",
    type: "object",
    properties: { a: { type: "string" }, b: { type: "integer" } },
  },
  "https://example.com/plain",
);

const explanation = explainCompilation(buildPlan(engine, uri));
assert.equal(explanation.interpretedUnits, 0);
assert.ok(explanation.staticUnits > 0);
```

Islands are a performance characteristic, not a correctness one: the artifact
still returns the interpreter's answer. Use `explainCompilation` when a
schema compiles more slowly than expected and you want to know why.

## Standalone modules (CSP)

`compileValidator` builds its function with `new Function`, which a
`script-src` policy without `unsafe-eval` forbids. `emitStandalone` instead
returns the source of a self-contained ES module whose default export is
`validate(instance): boolean` — write it to a file at build time and import
it at runtime, with no code generation on the client.

```ts
import assert from "node:assert";
import { createEngine } from "@jse/core";
import { emitStandalone, StandaloneUnsupportedError } from "@jse/compiler";

const engine = createEngine();
const uri = engine.registerSchema(
  { type: "object", required: ["id"] },
  "https://example.com/static",
);

const source = emitStandalone(engine, uri);
assert.ok(source.includes("export default"));

// Standalone emission covers fully static schemas only.
const dynamicUri = engine.registerSchema(
  {
    $id: "https://example.com/dynamic",
    $defs: { item: { $dynamicAnchor: "T", type: "string" } },
    items: { $dynamicRef: "#T" },
  },
  "https://example.com/dynamic",
);
assert.throws(
  () => emitStandalone(engine, dynamicUri),
  StandaloneUnsupportedError,
);
```

Standalone emission is flag-only and rejects schemas needing the interpreter
at runtime, rather than emitting something that would quietly disagree. Under
CSP, a schema with islands must use the interpreter.

## The plain-data instance contract

Compiled artifacts assume the input is plain JSON data — what `JSON.parse`
produces — with `Object.prototype` intact and no inherited enumerable
properties. Under that assumption they test property presence with `key in
obj` and enumerate with a bare `for…in`, which is where much of the speed
comes from.

The interpreter makes no such assumption. If you validate hand-built objects
with a mutated prototype, or objects carrying inherited enumerable
properties, use `Engine.evaluate` instead. Ordinary parsed JSON, object
literals, and structured-clone output are all within the contract.

## Choosing a tier

Compilation costs time up front and pays it back per evaluation, so the
question is how many instances one artifact will see.

- **Validate many instances against one schema** — compile. This is what the
  tier is for.
- **Validate one instance against a schema you just built** — interpret.
  `Engine.evaluate` does no setup work.
- **Verdict only** — `compileValidator`. It short-circuits on the first
  failure and allocates nothing on the hot path.
- **Errors or annotations** — `compileList`, or `compileEvaluator` when you
  want the structured documents.
- **Content Security Policy** — `emitStandalone` for static schemas, the
  interpreter otherwise.

The compiled tier's advantage is largest when instances share a shape and
smallest on schemas dominated by interpreted islands; if you are choosing on
performance grounds, measure your own schema and inputs.

## See also

- [Output formats](output-formats.md) — the format names, levels, and
  controls the compiled tier renders.
- [Annotations](annotations.md) — selection semantics, shared by both tiers.
- [Security and resource limits](security.md) — `maxDepth` and the bounds
  that apply to both tiers.
