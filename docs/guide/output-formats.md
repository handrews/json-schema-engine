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

### Structured error params

The `errorParams` option adds two fields to each `Result.errors` unit:
`keyword` (the failing keyword; absent when a boolean `false` schema
failed) and `params`, a plain-JSON object of structured failure data —
so tooling consumes the failure mechanically instead of parsing the
message string. The spec output shapes never carry these fields, which
is why they are opt-in; the flat list is the only surface that does.
`compileList` accepts the same option and produces identical units.

```ts
import assert from "node:assert";
import { createEngine } from "@jse/core";

const engine = createEngine();
const uri = engine.registerSchema(
  { required: ["a", "b"], enum: [1] },
  "https://example.com/params",
);

const result = engine.evaluate(
  uri,
  { a: 1 },
  { output: "list", errorParams: true },
);
const byKeyword = new Map(result.errors?.map((e) => [e.keyword, e.params]));
assert.deepEqual(byKeyword.get("required"), { missingProperty: "b" });
assert.deepEqual(byKeyword.get("enum"), { allowedValues: [1] });
```

The vocabulary, per keyword: `type` → `{expected}` (the schema value);
`enum` → `{allowedValues}`; `const` → `{allowedValue}`; the string/
array/object bounds and numeric limits → `{limit}`; `multipleOf` →
`{multipleOf}`; `pattern` → `{pattern}`; `required` → one unit per
missing property, each `{missingProperty}`; `dependentRequired` (and
legacy `dependencies`) → `{property, missingProperty}`; `uniqueItems` →
`{duplicates: [i, j]}` (first duplicate pair); `contains` → `{count,
minContains[, maxContains]}`; `oneOf` → `{passing: [indexes]}`; `format`
under assertion → `{format}`; `anyOf`/`not` → `{}`. Custom keywords pass
whatever their `ctx.error(message, params)` call supplies. The full pin
suite is `packages/core/test/error-params.test.ts`.

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
following the evaluation's applicator structure. By default only relevant
records appear (IETF draft-03 §12.2): an error from a rejecting subschema
under a keyword that accepted anyway, such as the losing branch of a
passing `anyOf`, and an annotation under a rejecting ancestor are omitted,
and units left with nothing to report are pruned. Pass `verbose: true` to
keep every unit and see the irrelevant records under `droppedErrors` and
`droppedAnnotations`.

```ts
import assert from "node:assert";
import { createEngine } from "@jse/core";

const engine = createEngine();
const uri = engine.registerSchema(
  {
    title: "root",
    properties: { name: { title: "the name", type: "string" } },
    anyOf: [{ required: ["name"] }, { required: ["id"] }],
  },
  "https://example.com/tree",
);

const terse = engine.evaluate(uri, { name: 3 }, { output: "hierarchical" });
assert.equal(terse.valid, false);
const nameUnit = terse.outputDocument.details?.find(
  (d) => d.instanceLocation === "/name",
);
assert.equal(nameUnit?.evaluationPath, "/properties/name");
assert.ok(nameUnit?.errors?.type.includes("string"));
// The passing anyOf makes its losing branch irrelevant: no unit for it.
assert.equal(
  terse.outputDocument.details?.some((d) => d.evaluationPath === "/anyOf/1"),
  false,
);

const verbose = engine.evaluate(
  uri,
  { name: 3 },
  { output: "hierarchical", verbose: true },
);
const branch = verbose.outputDocument.details?.find(
  (d) => d.evaluationPath === "/anyOf/1",
);
assert.equal(branch?.valid, false);
assert.ok(branch?.droppedErrors?.required);
const verboseName = verbose.outputDocument.details?.find(
  (d) => d.instanceLocation === "/name",
);
// The failed unit's own annotation is irrelevant too.
assert.equal(verboseName?.droppedAnnotations?.title, "the name");
```

Under `locations: "2020-12"`, the same tree shape is called Detailed
(relevant records only, the default) or Verbose (with `verbose: true`); the
Verbose document keeps every unit with its errors under `errors` and its
annotations placed by the unit's own validity.

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
