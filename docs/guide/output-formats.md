# Output formats

The `output` option selects a format by name. Every name renders the same
evaluation; they differ in structure, field vocabulary, and how much of the
evaluation they show.

| Name           | Source                                                                                                                                                                                       | Level                                  | Structure                                              |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- | ------------------------------------------------------ |
| `flag`         | [IETF draft-03 §13.4.1](https://www.ietf.org/archive/id/draft-ietf-jsonschema-json-schema-03.html#section-13.4.1) and the machines-oriented proposal (identical)                             | minimal                                | `{ valid }`                                            |
| `basic`        | [IETF draft-03 §13.4.2](https://www.ietf.org/archive/id/draft-ietf-jsonschema-json-schema-03.html#section-13.4.2)                                                                            | relevant                               | flat `errors` or `annotations` array of units          |
| `detailed`     | [IETF draft-03 §13.4.3](https://www.ietf.org/archive/id/draft-ietf-jsonschema-json-schema-03.html#section-13.4.3)                                                                            | relevant                               | condensed keyword-level tree                           |
| `verbose`      | [IETF draft-03 §13.4.4](https://www.ietf.org/archive/id/draft-ietf-jsonschema-json-schema-03.html#section-13.4.4)                                                                            | verbose                                | full keyword-level tree                                |
| `list`         | [machines-oriented output proposal](https://github.com/json-schema-org/json-schema-spec/blob/4f56a9900674b27804f0ec32e3b7fdfa4efad695/specs/output/jsonschema-validation-output-machines.md) | relevant; verbose with `verbose: true` | root `{ valid, details }` holding flat units           |
| `hierarchical` | [machines-oriented output proposal](https://github.com/json-schema-org/json-schema-spec/blob/4f56a9900674b27804f0ec32e3b7fdfa4efad695/specs/output/jsonschema-validation-output-machines.md) | relevant; verbose with `verbose: true` | units nested under `details` along the evaluation path |

"IETF draft-03" is `draft-ietf-jsonschema-json-schema-03`, not the 2010
JSON Schema draft-03. Output formats are under active discussion in the IETF
process and may change before the final RFC; JSE follows the two sources
above and names each format as its source does.

## Levels

- **Minimal** (`flag`): `valid` only. The default, and the cheapest.
- **Relevant** (`basic`, `detailed`, `list`, `hierarchical`): every relevant
  error and, when selected, every relevant annotation. An error from a
  subschema that rejected under a keyword that accepted anyway (the losing
  branch of a passing `anyOf`) and an annotation under a rejecting ancestor
  are irrelevant (IETF draft-03 §12.2); they are omitted and units left with
  nothing to report are pruned (§13.4).
- **Verbose** (`verbose`; `list` and `hierarchical` with `verbose: true`):
  irrelevant results are included and marked. The `verbose` document marks
  them with `valid` on every node; `list` and `hierarchical` keep every unit
  and render irrelevant records under `droppedErrors` and
  `droppedAnnotations`; `Result.droppedErrors` and
  `Result.droppedAnnotations` carry the same records as flat units.

Every option combination is either supported or rejected with
`OutputOptionsError` before evaluation: any record-bearing option on `flag`;
`verbose: true` on `basic` or `detailed`, which are relevant-level by
definition; `verbose: false` on `verbose`; an unknown format name.

```ts
import assert from "node:assert";
import { createEngine, OutputOptionsError } from "@jse/core";

const engine = createEngine();
const uri = engine.registerSchema({ type: "string" }, "https://example.com/r");

assert.throws(
  () => engine.evaluate(uri, 1, { errorParams: true }),
  OutputOptionsError,
);
assert.throws(
  () => engine.evaluate(uri, 1, { output: "basic", verbose: true }),
  OutputOptionsError,
);
```

## The flat surface

Every format above minimal populates `Result.errors` on failure and
`Result.annotations` on success (when annotations are selected). These units
use the engine's own field names: `evaluationPath`, `schemaLocation`,
`inputLocation`, and `error` or `keyword`/`vocabulary`/`annotation`. The
controls `errorParams`, `positions`, and `trace` apply to this surface on any
non-flag format; `outputDocument` always has exactly its source's structure.
Compiled artifacts (`@jse/compiler`) render `flag`, this flat surface, and
the `basic` document; the other documents are rendered by the interpreter.

| Concept          | Flat surface            | IETF draft-03 documents           | Machines-oriented documents         |
| ---------------- | ----------------------- | --------------------------------- | ----------------------------------- |
| evaluation path  | `evaluationPath`        | `keywordLocation`                 | `evaluationPath`                    |
| schema location  | `schemaLocation`        | `absoluteKeywordLocation`         | `schemaLocation`                    |
| input location   | `inputLocation`         | `instanceLocation`                | `instanceLocation`                  |
| keyword identity | `keyword`, `vocabulary` | last segment of `keywordLocation` | keys of `errors`/`annotations` maps |

IETF draft-03 calls the value being validated the "input" in its evaluation
sections and the "instance" in its output section; the engine's concept is
the input location, and each document keeps the field name its source
specifies.

## Flag

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

## Basic

A root unit with a flat `errors` array on failure or `annotations` array on
success. `basic` builds no evaluation trace, so it is the cheapest way to
read errors or collect annotations.

```ts
import assert from "node:assert";
import { createEngine } from "@jse/core";

const engine = createEngine();
const uri = engine.registerSchema(
  { title: "T", properties: { n: { type: "integer" } } },
  "https://example.com/basic",
);

const bad = engine.evaluate(uri, { n: "x" }, { output: "basic" });
assert.equal(bad.valid, false);
assert.equal(bad.errors?.[0]?.inputLocation, "/n");
assert.equal(
  bad.outputDocument.errors?.[0]?.keywordLocation,
  "/properties/n/type",
);

const ok = engine.evaluate(
  uri,
  { n: 1 },
  { output: "basic", annotations: true },
);
assert.deepEqual(ok.outputDocument.annotations, [
  {
    keywordLocation: "/title",
    absoluteKeywordLocation: "https://example.com/basic#/title",
    instanceLocation: "",
    annotation: "T",
  },
]);
```

## Detailed

The condensed tree of §13.4.3: every keyword evaluation and schema
application is a node, nodes with no results are removed, and a node with a
single child is replaced by that child. Nested results sit under `errors`
(failed node) or `annotations` (successful node); leaves carry `error` or
`annotation`. This is the draft's own example.

```ts
import assert from "node:assert";
import { createEngine } from "@jse/core";

const engine = createEngine();
const uri = engine.registerSchema(
  {
    $id: "https://example.com/polygon",
    $defs: {
      point: {
        type: "object",
        properties: { x: { type: "number" }, y: { type: "number" } },
        additionalProperties: false,
        required: ["x", "y"],
      },
    },
    type: "array",
    items: { $ref: "#/$defs/point" },
    minItems: 3,
  },
  "https://example.com/polygon",
);

const result = engine.evaluate(
  uri,
  [
    { x: 2.5, y: 1.3 },
    { x: 1, z: 6.7 },
  ],
  { output: "detailed" },
);
const root = result.outputDocument;
// `/items` and the second item's application collapse into the `$ref` node.
assert.deepEqual(
  root.errors?.map((n) => n.keywordLocation),
  ["/items/$ref", "/minItems"],
);
const point = root.errors![0]!;
assert.equal(
  point.absoluteKeywordLocation,
  "https://example.com/polygon#/$defs/point",
);
assert.equal(point.instanceLocation, "/1");
assert.deepEqual(
  point.errors?.map((n) => [n.keywordLocation, n.instanceLocation]),
  [
    ["/items/$ref/additionalProperties", "/1/z"],
    ["/items/$ref/required", "/1"],
  ],
);
```

## Verbose

The full keyword-level tree of §13.4.4: one node per keyword evaluation,
accepting or not, with irrelevant results included. `valid` on every node
tells relevant results apart.

```ts
import assert from "node:assert";
import { createEngine } from "@jse/core";

const engine = createEngine();
const uri = engine.registerSchema(
  {
    $id: "https://example.com/polygon",
    type: "object",
    properties: { validProp: true },
    additionalProperties: false,
  },
  "https://example.com/polygon",
);

const result = engine.evaluate(
  uri,
  { validProp: 5, disallowedProp: "value" },
  { output: "verbose" },
);
assert.deepEqual(
  result.outputDocument.errors?.map((n) => [n.keywordLocation, n.valid]),
  [
    ["/properties", true],
    ["/additionalProperties", false],
    ["/type", true],
  ],
);
const disallowed = result.outputDocument.errors![1]!.errors![0]!;
assert.equal(disallowed.instanceLocation, "/disallowedProp");
assert.equal(typeof disallowed.error, "string");
```

Every keyword evaluation is a node, and every schema application is a
node. For most applicators the two are distinguishable by
`keywordLocation` alone: the `properties` keyword node is `/properties`,
and the application it performs is `/properties/item`. A by-reference
applicator (`$ref`, `$dynamicRef`, `$recursiveRef`) adds no segment of its
own, so it produces two nodes with the same `keywordLocation` that differ
in `absoluteKeywordLocation`: the keyword node, whose absolute location
ends in the keyword, and beneath it the application of the referenced
schema, whose absolute location is that schema's canonical location
(§13.3.2). In `detailed`, condensation removes the keyword node whenever it
has no result of its own, which is why the draft's own example shows a
single `/items/$ref` node carrying the target's location. How by-reference
applicators appear in both structures is being re-examined for future
drafts.

```json
{
  "valid": true,
  "keywordLocation": "/properties/item/$ref",
  "absoluteKeywordLocation": "https://example.com/schema#/properties/item/$ref",
  "instanceLocation": "/item",
  "annotations": [
    {
      "valid": true,
      "keywordLocation": "/properties/item/$ref",
      "absoluteKeywordLocation": "https://example.com/schema#/$defs/named",
      "instanceLocation": "/item",
      "annotations": []
    }
  ]
}
```

## List

A root unit with `valid` and `details`, the flat list of units that report
an error or annotation. Errors and annotations are keyed by keyword name.

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
assert.equal(result.errors?.[0]?.inputLocation, "/n");
assert.deepEqual(Object.keys(result.outputDocument), ["valid", "details"]);
assert.equal(result.outputDocument.details.length, 1);
assert.equal(result.outputDocument.details[0]?.evaluationPath, "/properties/n");
assert.ok(result.outputDocument.details[0]?.errors?.type);
```

### Structured error params

The `errorParams` option adds `keyword`, `vocabulary`, and `params` to each
flat error unit: the failing keyword's identity and a plain-JSON object of
structured failure data, so tooling consumes the failure mechanically
instead of parsing the message string. `keyword` and `vocabulary` are absent
when a boolean `false` schema failed. Documents never carry these fields;
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
assert.equal(
  result.errors?.[0]?.vocabulary,
  "https://json-schema.org/draft/2020-12/vocab/validation",
);
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

## Hierarchical

A tree of units nested under `details`, following the evaluation path. At
the relevant level only reporting units and their ancestors appear; with
`verbose: true` every unit appears and irrelevant records are marked.

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
  { output: "hierarchical", verbose: true, annotations: true },
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
assert.equal(verbose.droppedAnnotations?.length, 2);
```

## Migration from the pre-release options

| Before                                                            | Now                                                              |
| ----------------------------------------------------------------- | ---------------------------------------------------------------- |
| `{ output: "list", locations: "2020-12" }`                        | `{ output: "basic" }`                                            |
| `{ output: "hierarchical", locations: "2020-12" }`                | `{ output: "detailed" }` (§13.4.3 structure)                     |
| `{ output: "hierarchical", locations: "2020-12", verbose: true }` | `{ output: "verbose" }` (§13.4.4 structure)                      |
| `{ collectAnnotations: true }`                                    | `{ output: "basic", annotations: true }`                         |
| `{ collectAnnotations: true, retention: R }`                      | `{ output: "basic", annotations: R }`                            |
| `RetentionPolicy`                                                 | `AnnotationSelection`                                            |
| `list` document as a bare array                                   | `{ valid, details }`; units without results are excluded         |
| `instanceLocation` on `Result.errors`/`annotations`/`trace`       | `inputLocation`; documents keep `instanceLocation`               |
| `Result.errors` with 2020-12 names under `locations: "2020-12"`   | always native names; `outputDocument.errors` has the Basic names |
| `errorParams`/`trace`/`positions` ignored outside `list`          | honored on every non-flag format; rejected on `flag`             |
| `compileList(uri, { collectAnnotations, retention })`             | `compileList(uri, { annotations })`                              |
