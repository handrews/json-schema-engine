# AJV v8 compatibility matrix

What `@json-schema-engine/ajv-compat` emulates, ignores, and refuses, and where its
behavior deviates from AJV. Every "verified" claim below is pinned by an
executed-AJV fixture (`test/oracle/capture*.ts` →
`test/fixtures/ajv-*.json`; AJV is run, never read — DESIGN.md D15) or by
AJV's public documentation. Sources are marked **docs** (ajv.js.org /
companion READMEs) or **oracle** (observed by execution, where the docs
are silent).

## Classes

`Ajv` (draft-07, AJV's default), `Ajv2019`, `Ajv2020`. No JTD classes
(different schema language).

## Constructor options

### Mapped onto the engine

| Option                | Notes                                                                                                                                                                                                           |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `allErrors`           | Default `false` = exactly one reported error (**docs**: "return after the first error"). Synthesized companion errors stay with their primary (**oracle**: propertyNames pairs survive first-error truncation). |
| `verbose`             | Adds `schema`, `parentSchema`, `data` to errors.                                                                                                                                                                |
| `messages`            | `false` omits `message`.                                                                                                                                                                                        |
| `validateFormats`     | Default `true`; formats assert when a format table is present.                                                                                                                                                  |
| `validateSchema`      | Metaschema validation on registration.                                                                                                                                                                          |
| `schemas`, `meta`     | Registered through the config ledger.                                                                                                                                                                           |
| `formats`, `keywords` | Routed through `addFormat`/`addKeyword`.                                                                                                                                                                        |
| `loadSchema`          | Powers `compileAsync` via an engine loader adapter.                                                                                                                                                             |
| `logger`              | `log`/`warn`/`error` trio or `false`.                                                                                                                                                                           |
| `code.regExp`         | Maps to the engine's pluggable regex engine.                                                                                                                                                                    |

### Implemented in the adapter

| Option                                          | Verified semantics                                                                                                                                                                                                                                                                                                                                            |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `coerceTypes` (`true`/`"array"`)                | Docs coercion table exactly: string→number only for valid numbers; `"true"`/`"false"`→boolean; `""`→null; number→string; 0/1→boolean; false/0/`""`→null; `"array"` wraps scalars and unwraps single-element arrays. **Oracle**: mutations persist when validation still fails; a coerced TOP-LEVEL scalar changes the verdict but never the caller's binding. |
| `useDefaults` (`true`/`"empty"`)                | Inserts `properties` defaults for missing keys (`"empty"` also for `null`/`""`). **Oracle**: inserted values are copies, never shared references; tuple defaults EXTEND the array in position order; defaults cascade (a parent's default then receives its children's defaults).                                                                             |
| `removeAdditional` (`true`/`"all"`/`"failing"`) | **Oracle**: `true` removes only under literal `additionalProperties: false`; `"failing"` removes per-property failures against an `additionalProperties` schema; `"all"` removes unmatched keys only where the schema object carries property keywords (a bare `{type:"object"}` removes nothing).                                                            |
| `discriminator`                                 | **Oracle**: AJV _replaces_ `oneOf` dispatch entirely — only the tag-matched branch evaluates, even under `allErrors`; `mapping` is rejected by AJV's runtime despite its docs. Both behaviors reproduced.                                                                                                                                                     |
| `strictSchema` (subset)                         | Unknown keywords and unknown formats reject at compile time; `"log"` warns; `false` allows. Other strict-family checks (`strictTypes`/`strictTuples` warnings) are not reproduced.                                                                                                                                                                            |
| `multipleOfPrecision`                           | Accepted with a logged warning; `multipleOf` uses exact decimal-scaled comparison. Divergence when the option mattered.                                                                                                                                                                                                                                       |

### Accepted and ignored (codegen/perf hints)

`inlineRefs`, `loopRequired`, `loopEnum`, `code.{es5,esm,lines,optimize,
process}`, `addUsedSchema` (partially honored for `$id` retention),
`ownProperties` (see plain-data caveat in the migration guide),
`unicodeRegExp` (patterns compile per spec with `u`), `uriResolver`.

### Refused (typed `AjvCompatUnsupportedError`)

| Surface                                                                             | Reason                                                                |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `$data: true` (option or per-keyword)                                               | Instance-controlled keyword values are excluded by design.            |
| `code`-style keywords (`KeywordCxt`)                                                | AJV-codegen-coupled by definition; port to `validate`/`compile`.      |
| `$async` schemas, async keywords, async formats                                     | Evaluation is synchronous.                                            |
| `macro` keywords                                                                    | Not yet emulated; use `validate`/`compile`.                           |
| `removeKeyword` of built-ins                                                        | Dialects assemble from whole vocabularies.                            |
| JTD options (`timestamp`, `parseDate`, `allowDate`, `specialNumbers`, `int32range`) | JTD is out of scope.                                                  |
| `code.source` standalone                                                            | Not mapped; use `@json-schema-engine/compiler`'s standalone emission. |

## Methods

`compile`, `compileAsync`, `validate(schemaOrRef, data)`, `addSchema`
(array/object/`$id`/key forms), `addMetaSchema`, `getSchema`,
`removeSchema` (key, `$id`, RegExp, schema object, or all),
`validateSchema`, `addFormat` (string→RegExp, RegExp, function, object
forms; object `compare` powers the formatMinimum/Maximum keywords),
`addKeyword` (string and definition-object forms), `getKeyword`,
`removeKeyword` (custom keywords only), `addVocabulary`, `errorsText`
(`separator`, `dataVar`). `ValidateFunction` exposes `errors` (null when
valid) and `schema`.

`addKeyword` definition fields accepted: `keyword` (string|string[]),
`type` (data-type scoping incl. `integer`), `schemaType`, `validate`
(custom errors via assignment to `validate.errors`), `compile`, `error`
(`{message}`), `errors`, `valid`. Accepted-and-inert: `metaSchema`,
`passContext`, `before`, `post`, `implements`, `modifying` (refused —
built-in mutation is delivered via `coerceTypes`/`useDefaults`/
`removeAdditional` and ajv-keywords `transform`/`dynamicDefaults`, but
mutation from arbitrary custom keywords remains out of scope).

### Lifecycle semantics (**oracle**: `ajv-lifecycle.json`)

Pinned against executed AJV by scenario capture
(`test/oracle/capture-lifecycle.ts`); the compat class matches on all of
them:

- `compile()` resolves references eagerly and throws on a missing one
  (the thrown class is a plain `Error`, not AJV's `MissingRefError`).
- A compiled `ValidateFunction` is a compile-time snapshot: schemas
  added or removed later never change what an existing fn resolves.
- The object cache is keyed on schema identity and survives
  `addSchema`/`removeSchema`: `compile(sameObject)` returns the cached
  fn even after registry changes; equal-but-distinct objects recompile.
- `removeSchema` makes `getSchema` return undefined and permits
  re-adding under the same key; previously compiled fns keep working.
- `addSchema` throws on a key or `$id` that already exists (remove
  first to replace).
- `compile({$id})` auto-registers under the `$id` unless
  `addUsedSchema: false`.

Anonymous schemas (no `$id`, no key) compile against a private engine:
`compile()`-in-a-loop does not grow instance-lifetime state, and the
compiled fn's memory is reclaimed when the caller drops the fn and the
schema object.

## Error objects

`keyword`, `instancePath`, `schemaPath`, `params`, `message`
(+`propertyName` on propertyNames inner errors — **oracle**; +`schema`/
`parentSchema`/`data` under `verbose`).

- `schemaPath`: same resource as the compiled root → `#/pointer`;
  cross-resource → `resolvedUri + pointer` with NO `#` (**oracle**).
- Boolean `false` schemas → keyword `"false schema"`, schemaPath suffix
  `/false schema`, message `boolean schema is false` (**oracle**).
- Message text reproduces AJV's defaults per keyword from a template
  table (**oracle** — not documented by AJV); custom-keyword messages
  pass through unchanged.

Params per keyword — **docs** rows: limits→`{limit}` (+`comparison` for
numeric bounds), `required`→`{missingProperty}`, `additionalProperties`→
`{additionalProperty}`, `dependencies`/`dependentRequired`→`{property,
missingProperty, deps, depsCount}`, `format`→`{format}`, `multipleOf`,
`pattern`, `propertyNames`→`{propertyName}`. **Oracle** rows (AJV docs
silent): `type`→`{type}` (value or array), `enum`→`{allowedValues}`,
`const`→`{allowedValue}`, `uniqueItems`→`{i, j}` (i = later index),
`contains`→`{minContains[, maxContains]}`, `oneOf`→`{passingSchemas:
[first, second] | null}`, `anyOf`/`not`→`{}`, `if`→`{failingKeyword}`
(synthesized), `unevaluatedProperties`→`{unevaluatedProperty}`,
`unevaluatedItems`/`items`/`additionalItems`→`{limit}` (coalesced),
`discriminator`→`{error, tag, tagValue}`.

AJV reports nothing from subtrees that passed (a satisfied `anyOf`'s
failing branches, `not`/`contains` probes, the `if` condition) — the
adapter filters the engine's complete error record to match (**oracle**:
`anyOf-pass-sibling-fail`).

## Companions

- `addFormats(ajv, opts?)`: all 26 ajv-formats names (**oracle**:
  enumerated by execution); shared names use `@json-schema-engine/formats`' RFC-grade
  implementations (differentially probed against ajv-formats "full"
  mode); `mode: "fast"` accepted, mapped to the same implementations;
  `keywords: true` adds formatMinimum/Maximum/Exclusive\* with
  instant-based time comparison (**oracle**: offsets compare by instant,
  not lexicographically).
- `ajvErrors(ajv, opts?)`: the errorMessage matching model from executed
  fixtures; requires `allErrors: true`; `keepErrors` flags kept originals
  `emUsed`; `singleError` joins with `";"` (**oracle** — the README says
  `"; "`). Known divergence: a string/`_` message under a looped `items`
  applicator does not reach nested property errors in AJV (codegen
  artifact) and is not reproduced.
- `ajvKeywords(ajv, names?)`: `typeof`, `instanceof`,
  `uniqueItemProperties`, `prohibited` (pure keywords), plus the mutating
  `transform` and `dynamicDefaults`, delivered as mutation-fixpoint passes
  (not engine keywords) and activated on the instance. `transform` ops:
  `trim`/`trimStart`/`trimEnd`/`trimLeft`/`trimRight`/`toLowerCase`/
  `toUpperCase`/`toEnumCase` (applied left-to-right; skipped inside combiner
  branches and at the root, see Known divergences). `dynamicDefaults`
  generators: `timestamp`, `datetime`, `date`, `time`, `random`, `randomint`,
  `seq` (no `uuid`); the registry is exported as `DYNAMIC_DEFAULTS`.
  `dynamicDefaults` fills only under `useDefaults`, after plain `default`
  (which wins a collision). Compile-time throws match AJV: `toEnumCase`
  without a sibling `enum` or with case-colliding `enum` values, and unknown
  generator names. `select*` (`$data`) is still refused with a pointer.

### Mutation execution model

The adapter keeps the JSE engine pure and implements mutation as an
evaluate→mutate→re-evaluate fixpoint. Defaults, removal, and `transform`
consume the interpreter's **verbose hierarchical** output: unlike ordinary
hierarchical output (which contains the same contributing information as the
flat list, arranged as a tree), verbose output also retains successful,
annotation-free schema applications. Those schema-location/instance-location
pairs identify where mutation keywords apply. Type coercion instead consumes
structured type failures from the compiled list artifact. After mutation
stabilizes, the compiled flag artifact determines the final verdict.

## Known divergences

- Custom-keyword `compile` callbacks currently run from evaluation and rebuild
  their returned validator for every instance, rather than running once during
  `ajv.compile(schema)`. This changes call count, exception timing, setup cost,
  and stateful-validator behavior; the correction and lifecycle oracle are
  recorded in DESIGN.md's deferred register.
- `discriminator`'s eager checker currently walks arbitrary JSON values as
  schemas, so a data property named `discriminator` under `const`, `default`,
  or `examples` can make `compile()` throw. It also resolves external `oneOf`
  branch references against the current root rather than the registered target.
  Both are open correctness defects. Enabling the option additionally replaces
  `oneOf` dialect-wide with an unlowered behavior, so unrelated `oneOf` schemas
  become interpreted islands.
- `ajv-errors` likewise discovers `errorMessage` through a raw root-document
  recursion: instance-valued occurrences can incorrectly rewrite errors, while
  occurrences in registered resources reached through `$ref` are missed. Both
  registry/dialect-aware discovery fixes are recorded in DESIGN.md.
- `strictNumbers` (validation-time NaN/Infinity rejection) is not
  enforced; JSON-parsed data cannot contain them.
- Dependency data comes only from an accepting producer (IETF draft-03
  Appendix D): when `properties`, `items`, or another producer rejects, a
  same-object `unevaluatedProperties`/`unevaluatedItems` applies to those
  locations too and reports errors AJV does not (its evaluated-set tracking
  counts rejected evaluations). Pinned in the golden set:
  `unevaluatedProperties.json#33`, "Unevaluated on 2nd/3rd level is invalid"
  (a `properties` rejecting through a cyclic `$ref`).
- `contains: false` with `minContains: 0`: AJV reports the boolean-`false`
  probe error although `contains` accepts. Core makes that error irrelevant
  (draft-03 §12.2) and omits it from `Result.errors`, so the adapter cannot
  reproduce the quirk; the follow-up release can re-derive it from the
  verbose `droppedErrors` field.
- Error list ORDER and branch error sets under `allErrors` can differ in
  combiner-heavy schemas (evaluation-strategy artifacts). The official
  draft2020-12 suite differential pins the exact divergent cases as a
  golden set; verdicts match the suite on 100% of registerable cases,
  including ~30 where AJV itself disagrees with the suite
  ($dynamicRef/unevaluated\* corners — the adapter follows the spec).
- Coercion inside `anyOf`/`oneOf` may settle on a different schema-valid
  value than AJV's no-backtrack cascade (**oracle**:
  `coerce-competing-anyof-number-first` — AJV turns `true` into `"1"`
  through two branch coercions; the adapter's fixpoint stops at the
  first branch's `1`; the divergent value is pinned in
  `mutation.test.ts`). Defaults and removal inside combiner branches ARE
  matched: defaults never apply inside `anyOf`/`oneOf` branches, and
  removal skips a failing branch once a sibling passed (**oracle**:
  the combiner×mutation cases in `ajv-mutation.json`).
- Mutations that keep rewriting each other's results (e.g. `allOf`
  branches coercing the same value to different types) throw
  `MutationNonConvergenceError` instead of stopping on an arbitrary
  intermediate state. A compat-layer extension: AJV mutates inline
  during evaluation and can silently settle on order-dependent values
  there.
- `transform` (ajv-keywords) never fires inside an `anyOf`/`oneOf` branch or
  at the instance root. AJV mutates inline during evaluation, so a branch's
  transform runs (and can leak its result to sibling branches); the compat
  layer's evaluate→mutate→re-evaluate fixpoint over a single un-mutated
  hierarchy cannot reproduce that short-circuit-order/cross-branch
  interleaving. Non-combiner transforms match AJV exactly. `dynamicDefaults`
  in combiner branches is EXACT (AJV's own compositeRule guard skips them
  too). **Oracle**: the `transform-anyOf-*`/`transform-oneOf-*`/
  `transform-interleaving-*` cases in `ajv-keywords-mutation.json`; the
  interleaving cases are verdict divergences (jse rejects what AJV accepts)
  and are pinned in `mutation-keywords.test.ts`.
- A non-idempotent `transform` op composite diverges: `["toEnumCase","trim"]`
  where trimming enables a later enum match. AJV applies the array once inline
  (`" ph "` → `"ph"`, which fails the `enum`); jse's fixpoint re-applies until
  stable (`"ph"` → `"pH"`, which passes). Matching AJV would need a single-shot
  pass that re-mutates on every re-validation, breaking the idempotence the
  property leg relies on. **Oracle**:
  `transform-op-order-toEnumCase-trim-sensitive-toEnumCase-first`.
- On a MUTATING validator (any of the trio enabled), non-plain data —
  class instances, `Map`, `Date`, anything without a plain
  object/array shape — is never mutated: the instance validates through
  the interpreter unchanged, so the verdict cannot silently diverge
  from an in-place mutation gone wrong.
- `prohibited` reports a single error where ajv-keywords also surfaces a
  companion `not` error (it composes from `not`+`anyRequired`
  internally).
- Compiled fast paths assume plain JSON data; see the
  [migration guide](../../docs/guide/ajv-migration.md) for the
  class-instance caveat.
