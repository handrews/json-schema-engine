# Output formats

The `output` option selects the result shape: `flag` (default), `list`, or
`hierarchical`. All three report the same evaluation; they differ in how
much detail is rendered.

## Flag

`flag` reports only `valid`. No trace is built, so this is the cheapest
option and the default.

```ts
import assert from "node:assert";
import { createEngine } from "@jse/core";

const engine = createEngine();
const uri = engine.registerSchema(
  { type: "string" },
  "https://example.com/flag",
);

const result = engine.evaluate(uri, 1);
assert.deepEqual(result, { valid: false });
```

## List

`list` populates `Result.errors` with one flat unit per failure, and
`Result.outputDocument` with the same structured document the spec calls
LIST (modern locations) or Basic (under `locations: "2020-12"`).

```ts
import assert from "node:assert";
import { createEngine } from "@jse/core";

const engine = createEngine();
const uri = engine.registerSchema(
  { properties: { n: { type: "integer" } } },
  "https://example.com/list",
);

const result = engine.evaluate(uri, { n: "x" }, { output: "list" });
assert.equal(result.valid, false);
assert.equal(result.errors?.[0]?.instanceLocation, "/n");

// Result.outputDocument is a flat array of the same units — no `details`.
const units = result.outputDocument;
assert.ok(Array.isArray(units));
assert.ok(units.every((u) => !("details" in u)));
```

Under `locations: "2020-12"`, `outputDocument` is a `BasicOutputDocument`
instead: a single wrapper unit with flat `errors`/`annotations` arrays,
matching the older Basic structure.

```ts
import assert from "node:assert";
import { createEngine } from "@jse/core";

const engine = createEngine();
const uri = engine.registerSchema(
  { properties: { n: { type: "integer" } } },
  "https://example.com/basic",
);

const result = engine.evaluate(
  uri,
  { n: "x" },
  {
    output: "list",
    locations: "2020-12",
  },
);
const doc = result.outputDocument;
assert.equal(doc.valid, false);
assert.equal(doc.errors?.[0]?.keywordLocation, "/properties/n/type");
```

## Hierarchical

`hierarchical` builds a nested `OutputUnit` tree in `Result.outputDocument`,
following the evaluation's applicator structure. Units that contribute
nothing — valid, no annotations, no failing descendants — are pruned by
default; pass `verbose: true` to keep them.

```ts
import assert from "node:assert";
import { createEngine } from "@jse/core";

const engine = createEngine();
const uri = engine.registerSchema(
  {
    title: "root",
    properties: { name: { title: "the name", type: "string" } },
  },
  "https://example.com/tree",
);

const result = engine.evaluate(uri, { name: 3 }, { output: "hierarchical" });
const root = result.outputDocument;
assert.equal(root.valid, false);

const nameUnit = root.details?.find((d) => d.instanceLocation === "/name");
assert.equal(nameUnit?.evaluationPath, "/properties/name");
assert.ok(nameUnit?.errors?.type.includes("string"));
// The failed unit's annotations are dropped, not reported, per the spec.
assert.equal(nameUnit?.droppedAnnotations?.title, "the name");
```

Under `locations: "2020-12"`, the same tree shape is called Detailed
(pruned, the default) or Verbose (with `verbose: true`).

```ts
import assert from "node:assert";
import { createEngine } from "@jse/core";

const engine = createEngine();
const uri = engine.registerSchema(
  { properties: { n: { type: "integer" } } },
  "https://example.com/verbose",
);

const detailed = engine.evaluate(
  uri,
  { n: 1 },
  {
    output: "hierarchical",
    locations: "2020-12",
  },
);
const verbose = engine.evaluate(
  uri,
  { n: 1 },
  {
    output: "hierarchical",
    locations: "2020-12",
    verbose: true,
  },
);
assert.equal(detailed.outputDocument.details, undefined);
assert.equal(verbose.outputDocument.details?.length, 1);
assert.equal(verbose.outputDocument.details?.[0]?.valid, true);
```
