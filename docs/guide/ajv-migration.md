# Migrating from AJV

`@json-schema-engine/ajv-compat` is a migration adapter for a documented subset of AJV
v8's public API — the complete matrix of what is emulated, ignored, and
refused is [COMPAT.md](../../packages/ajv-compat/COMPAT.md). Code that
stays inside the emulated surface migrates by changing an import; code
that touches the refused surface fails loudly with a typed error rather
than behaving differently. Emulated behavior is pinned against
executed-AJV fixtures: verdicts, error objects (`keyword`,
`instancePath`, `schemaPath`, `params`, `message`), `errorsText`, data
mutation, and companion packages.

```ts
import { Ajv2020 } from "@json-schema-engine/ajv-compat";

const ajv = new Ajv2020({ allErrors: true });
const validate = ajv.compile({
  type: "object",
  required: ["id"],
  properties: { id: { type: "integer" } },
});

if (!validate({ id: "x" })) {
  const first = validate.errors![0]!;
  if (first.keyword !== "type" || first.instancePath !== "/id") {
    throw new Error("unexpected mapping");
  }
  if (ajv.errorsText(validate.errors) !== "data/id must be integer") {
    throw new Error("unexpected message");
  }
}
```

Class per draft, like AJV: `Ajv` (draft-07), `Ajv2019`, `Ajv2020`.

## Emulated surface

- `compile`, `compileAsync` (via `loadSchema`), `validate`, `addSchema`,
  `addMetaSchema`, `getSchema`, `removeSchema` (key, `$id`, RegExp,
  object), `validateSchema`, `errorsText`.
- `addFormat` (string, RegExp, function, and object forms) and
  `addKeyword` with the `validate` and `compile` definitions, including
  `type` scoping and custom errors assigned to `validate.errors`.
- `allErrors`, `verbose`, `messages`, `validateFormats`, `logger`, and
  the strict-mode subset: unknown keywords and unknown formats reject at
  compile time (`strictSchema: "log"` warns, `false` allows).
- The data-modifying options — `coerceTypes` (including `"array"`),
  `useDefaults` (including `"empty"`), `removeAdditional` (`true`,
  `"all"`, `"failing"`) — run as a compat-layer pass over the engine's
  outputs. Fastify's default configuration works unchanged:

```ts
import { Ajv } from "@json-schema-engine/ajv-compat";

const ajv = new Ajv({
  coerceTypes: "array",
  useDefaults: true,
  removeAdditional: true,
  allErrors: false,
  strictSchema: false,
  logger: false,
});
const validate = ajv.compile({
  type: "object",
  additionalProperties: false,
  properties: {
    page: { type: "integer", default: 1 },
    tags: { type: "array", items: { type: "string" } },
  },
});

const query = { page: "3", tags: "a", junk: true };
if (!validate(query)) throw new Error("should coerce");
if (JSON.stringify(query) !== '{"page":3,"tags":["a"]}') {
  throw new Error("unexpected mutation");
}
```

- Companions: `addFormats` (ajv-formats parity over the engine's
  RFC-grade implementations), `discriminator: true`, `ajvErrors`
  (`errorMessage`), and the non-mutating `ajvKeywords` subset (`typeof`,
  `instanceof`, `uniqueItemProperties`, `prohibited`).

```ts
import { Ajv2020, addFormats } from "@json-schema-engine/ajv-compat";

const ajv = new Ajv2020();
addFormats(ajv);
const validate = ajv.compile({ type: "string", format: "date-time" });
if (!validate("2026-07-07T12:00:00Z") || validate("nope")) {
  throw new Error("format assertion expected");
}
```

## Not emulated (fails loudly)

`AjvCompatUnsupportedError` is thrown instead of approximating:

- **`code`-style custom keywords** (`KeywordCxt`, the codegen DSL): these
  are AJV-implementation-coupled by definition. Port to the `validate` or
  `compile` definition; the logic is usually a direct transcription.
- **`$data` references**: excluded by design — keyword values sourced
  from the instance make schema values instance-controlled.
- **`$async` schemas, async keywords, async formats**: evaluation is
  synchronous.
- **`macro` keywords**: use `validate`/`compile` instead.
- **`removeKeyword` of built-ins**: dialects assemble from whole
  vocabularies.
- ajv-keywords' `transform`/`dynamicDefaults` (data-modifying) and
  `select*` (`$data`).

`code.source` (standalone module emission) is not mapped; use
`@json-schema-engine/compiler`'s own standalone emission instead.

## Documented divergences

- **Plain JSON data only on the compiled fast path.** Validators assume
  JSON-shaped instances (own enumerable properties, no prototype
  chain). Class instances with inherited enumerable properties can
  validate differently than under AJV, whose default iteration uses
  `Object.keys`. This is also why the `ownProperties` option is
  accepted-and-ignored. Validate parsed JSON (HTTP bodies, files) and
  this never matters; do not feed live class instances through compat
  validators. On a **mutating** configuration the adapter guards this
  for you: non-plain data (class instances, `Map`, `Date`, ...) is
  never mutated and validates through the interpreter unchanged.
- **`MutationNonConvergenceError`** (catchable, exported): thrown when
  the mutation loop's passes keep rewriting each other's results —
  e.g. `allOf` branches coercing the same value to different types.
  AJV silently settles on an evaluation-order-dependent value there;
  the adapter refuses to pick one. Rework the schema so only one
  subschema drives the coercion of any given value.
- **`strictNumbers`**: AJV rejects `NaN`/`Infinity` at validation time by
  default. JSON-parsed data cannot contain them, so HTTP paths are
  unaffected; hand-built JS objects diverge.
- **`multipleOfPrecision`** is ignored (with a logged warning):
  `multipleOf` uses exact decimal-scaled comparison, so schemas that
  relied on the tolerance may reject values AJV accepted.
- **Mutating configurations cost interpreter passes.** `coerceTypes`/
  `useDefaults`/`removeAdditional` run an evaluate–mutate–re-evaluate
  loop (several interpreter evaluations per call) instead of AJV's
  in-codegen mutation. Request validation is fine; measure before using
  a mutating configuration in a hot loop, or validate with a
  non-mutating configuration and coerce upstream.
- **Error list order and branch error sets** under `allErrors` can differ
  inside `anyOf`/`oneOf`/`$ref`-heavy schemas (evaluation-strategy
  artifacts). The official-suite differential ratchets the divergence
  count; per-keyword shapes are fixture-pinned.
- **Coercion inside `oneOf`**: AJV documents its own no-backtrack quirk
  and recommends `anyOf`; the compat fixpoint may settle on a different
  (schema-valid) coercion in those shapes.
- **AJV's non-compliant corners** (`$dynamicRef`, parts of
  `unevaluated*`): the compat layer follows the specification and the
  official test suite, not the bug.
- **Performance posture**: `allErrors: false` without mutating options
  runs the compiled fail-fast artifact. Error objects come from the
  compiled list artifact; failures involving combinator or conditional
  context (`anyOf`/`oneOf`/`not`/`contains`/`if`/`then`/`else`/
  `propertyNames`) re-run once on the interpreter for its evaluation
  trace. The mutating options take interpreter passes; they trade
  throughput for drop-in behavior.
