# Comparison: json-schema-engine, ata-validator, json-schema-library

A feature-completeness and performance comparison of `@json-schema-engine/*`
(JSE) against two other TypeScript/JavaScript JSON Schema implementations:

- [ata-validator](https://github.com/ata-core/ata-validator) — a
  validation-focused library with a code-generating compiler, an interpreter
  fallback, an ahead-of-time build step, TypeScript type inference, and an
  optional native (simdjson) accelerator.
- [json-schema-library](https://github.com/sagold/json-schema-library) (JSL)
  — a tooling-oriented library ("for developers building custom tools around
  JSON Schema") with an interpreted validator plus default-data generation,
  schema traversal, and schema reduction.

Everything here was measured or read directly from the projects' source on
2026-09-21 unless marked as a project's own claim. The scripts used are
described in [Reproduction](#reproduction); they are not committed.

| Subject                | Version | Notes                                             |
| ---------------------- | ------- | ------------------------------------------------- |
| json-schema-engine     | 0.0.3   | this repository at `ee46b16`, run from source     |
| ata-validator          | 1.27.1  | npm, with `@ata-validator/native-darwin-arm64`    |
| json-schema-library    | 11.6.2  | npm, with the `json-schema-library/formats` entry |
| ajv                    | 8.20.0  | reference point only                              |
| @hyperjump/json-schema | 1.17.8  | reference point only (hot path only)              |

Environment: Node v24.13.0, Apple M4 Pro, macOS (Darwin 25.6.0).
Official suite: the `test-suite` submodule at `92acb61` (2026-06-30), so all
three subjects saw the same cases.

## Summary

- **Verdict conformance.** All three pass 100% of the required draft 2020-12
  and draft-07 tests. JSE and JSL also pass 100% of required 2019-09,
  draft-06, and draft-04. ata-validator does not implement 2019-09,
  draft-06, or draft-04 as dialects: it applies 2020-12 semantics to them and
  fails 44, 39, and 40 required cases respectively. On the optional and
  format tests JSL is closest to complete, JSE is next, and ata-validator
  trails mainly on `idn-hostname`, punycode `hostname`, and ECMA-262 regex
  semantics.
- **Output.** JSE is the only one of the three that implements the standard
  output formats in full (`flag`, `basic`, `detailed`, `verbose`, `list`,
  `hierarchical`) with general annotation collection. ata-validator has an
  undocumented, CommonJS-only `toOutput()` that renders `flag` and `basic`
  with a fixed list of annotation keywords via a second, approximate schema
  walk. JSL has no standard output format, no location fields on errors, and
  collects only a `deprecated-warning` annotation.
- **Verdict throughput.** On static schemas, ata-validator's generated code
  is the fastest of everything measured: 1.3–1.5x faster than ajv and 2–4x
  faster than JSE's compiled tier. On the `$dynamicRef`-heavy OpenAPI 3.1 schema,
  ata-validator's interpreter is about 4x faster than JSE's compiled tier and
  50x faster than JSE's interpreter. JSE's compiled tier wins by 6x on the
  sparse-record corpus where property access goes megamorphic. JSL's
  interpreter is 13–30x slower than the compiled engines on small payloads
  but is the fastest subject on that same sparse-record corpus.
- **JSE's interpreter is slow** relative to both competitors' interpreters:
  about 7x slower than JSL on small payloads and 10x slower on 2000-record
  arrays. This is the largest performance gap found.
- **Error and spec-output throughput.** With errors actually materialized,
  JSE's compiled list artifact is 1.3x slower than ata-validator on
  `api-payload`, 5x faster on `migration`, and 16x faster on the sparse
  records corpus. For `basic` output with annotations, JSE's compiled
  evaluator is about 8x faster than ata-validator's `toOutput` on small
  payloads and 9–37x faster on record arrays; only on the OpenAPI corpus is
  `toOutput` faster, because its annotation walk does not follow `$ref` and
  collects almost nothing there.
- **Compile latency.** JSL compiles lazily and is fastest to first verdict on
  small schemas (35–60 µs). ata-validator and JSE's interpreter are next
  (200–400 µs). JSE's compiled tier costs 0.4–7 ms to first verdict, and ajv
  2–30 ms.
- **Beyond validation**, the projects are not substitutes: ata-validator's
  distinguishing features are AOT standalone modules, TypeScript inference,
  Standard Schema, buffer/NDJSON validation, and LLM-oriented helpers; JSL's
  are `getData`, `getNode`, `reduceNode`, and schema traversal; JSE's are the
  output model, annotation selection, dependency data for custom keywords,
  source positions, loaders, and the ajv-compat layer.

## Conformance

### Method

Every group in `test-suite/tests/<draft>/` was compiled by each subject with
the draft's `$schema` injected when absent, remotes registered under
`http://localhost:1234/…`, format assertion off for `required` and
`optional`, and on for `optional/format`. Defaults and coercion were off
everywhere. A schema that failed to compile counts every test in its group as
an error. Only verdicts were compared.

Subject configuration:

- JSE: `createEngine({ defaultDialect, loaders, formats, assertFormats })`,
  `loadSchema`, then `evaluate(uri, data).valid`; draft-04 via
  `@json-schema-engine/dialect-draft04`.
- ata-validator: `new Validator(schema, { schemas, assertFormat, useDefaults: false })`.
- JSL: `compileSchema(schema, { remote, formatAssertion, throwOnInvalidSchema: true, throwOnInvalidRef: true })`
  after `addFormats([...])` from `json-schema-library/formats`; metaschemas
  and remotes registered on a shared remote node (mirrors JSL's own runner).

### Results (passed / run)

| Draft    | Category | JSE           | ata-validator | JSL           |
| -------- | -------- | ------------- | ------------- | ------------- |
| 2020-12  | required | **1299/1299** | **1299/1299** | **1299/1299** |
| 2020-12  | optional | 147/162       | 133/162       | 159/162       |
| 2020-12  | format   | 654/655       | 577/655       | 650/655       |
| 2019-09  | required | **1259/1259** | 1215/1259     | **1259/1259** |
| 2019-09  | optional | 143/158       | 131/158       | 157/158       |
| 2019-09  | format   | **647/647**   | 569/647       | 642/647       |
| draft-07 | required | **927/927**   | **927/927**   | **927/927**   |
| draft-07 | optional | 113/118       | 102/118       | 113/118       |
| draft-07 | format   | **579/579**   | 501/579       | 576/579       |
| draft-06 | required | **839/839**   | 800/839       | **839/839**   |
| draft-06 | optional | 105/106       | 94/106        | 105/106       |
| draft-06 | format   | **273/273**   | **273/273**   | 271/273       |
| draft-04 | required | **618/618**   | 578/618       | **618/618**   |
| draft-04 | optional | 98/100        | 86/100        | 98/100        |
| draft-04 | format   | **206/206**   | **206/206**   | 204/206       |

ata-validator does not claim 2019-09, draft-06, or draft-04 support; those
rows show what happens when a schema declaring one of those `$schema` values
is handed to it anyway (it is processed with 2020-12 keyword semantics and
does not reject the dialect).

### What fails, and why

**JSE (39 failures).** All in the optional tier:

- `optional/dependencies-compatibility.json` (2020-12 and 2019-09, 14 each):
  the pre-2019 `dependencies` keyword is not carried forward into the
  2019-09/2020-12 dialects. ata-validator fails the same 14 cases per
  draft; JSL passes them.
- `optional/float-overflow.json` (all drafts): `1e308` as a multiple of 0.5;
  all three fail this JavaScript-number case.
- draft-07 `optional/content.json` (4): `contentMediaType`/`contentEncoding`
  are annotations, not assertions. Same in both other libraries.
- draft-04 `optional/zeroTerminatedFloats.json` (1): `1.0` is an integer in
  JavaScript. Same in both other libraries.
- 2020-12 `optional/format/ecmascript-regex.json` (1): `\a` is accepted as a
  valid `regex` format value. JSL and ata-validator reject it.

**ata-validator (455 failures).**

- 2020-12/2019-09/draft-07 `optional/format`: `idn-hostname` (54 per draft,
  every negative case), punycode/A-label `hostname` (23 per draft), and one
  `idn-email` case. `idn-hostname` is documented as deliberately not
  implemented; `hostname` accepts any `xn--` label without decoding it.
- `optional/ecmascript-regex.json` (8 per draft) and
  `optional/non-bmp-regex.json` (3 per draft): the built-in ReDoS-safe regex
  engine does not implement `\cX`, Unicode `\s`, or surrogate-pair (`u`
  flag) semantics. The `format: regex` tests pass because those use a plain
  `RegExp`.
- `optional/cross-draft.json`: a `$ref` from 2020-12 into a draft-07 schema
  (or vice versa) is evaluated with the referring dialect.
- `optional/format-assertion.json` (2): a custom metaschema enabling the
  format-assertion vocabulary does not turn assertion on.
- 2019-09 required: `$recursiveRef`/`$recursiveAnchor` are silently ignored
  (11 failures; a recursive schema **fails open**, verified directly:
  `{$recursiveAnchor: true, properties: {f: {$recursiveRef: "#"}}, additionalProperties: false}`
  accepts `{f: {bad: 1}}`), array-form `items`, `additionalItems`, 2019-09
  `unevaluatedItems` semantics, `$ref` sibling `$id`, and metaschema `$ref`s.
- draft-06/draft-04 required: `dependencies`, array-form `items`,
  `additionalItems`, `$ref` overriding siblings, `id`/base-URI changes.

**JSL (29 failures).**

- `optional/format-assertion.json` (2 on 2020-12): the `"meta-schema"` mode
  of `formatAssertion` exists but does not honor the vocabulary flag here.
  Note that passing `formatAssertion: "meta-schema"` for the _required_ tier
  made JSL assert `format` under the standard 2020-12 metaschema, failing 19
  "format is only an annotation by default" cases, so the results above use
  `formatAssertion: false` there.
- `optional/format`: `date` and `ipv4` accept the empty string, `duration`
  accepts `P1Y1D`-style gaps, `idn-hostname` accepts one Bidi case,
  draft-06/04 `hostname` rejects consecutive hyphens.
- `float-overflow`, draft-07 `content`, draft-04 `zeroTerminatedFloats`: as
  for JSE.

### Official output tests

`test-suite/output-tests/{draft2020-12,draft2019-09}/content` currently
contains four `basic`-format cases per draft. JSE and ata-validator's
`toOutput` both pass all eight (each produced document validates against the
case's output schema). JSL has nothing to run them against.

### Conformance claims versus what the repositories contain

- **ata-validator** states "100% of the official suite … with nothing
  excluded" (1301/1301 for 2020-12). Its `tests/run_suite.js` reads the
  dialect directory non-recursively, so the whole `optional/` subtree,
  including `optional/format/`, never runs; the explicit skip lists are empty
  but the directory is the exclusion. `docs/STABILITY.md` in the same tree
  gives 1285/1290 and `docs/migration-from-ajv.md` gives 98.5%. The
  committed Bowtie harness constructs validators with only `{ schemas }`,
  leaving `assertFormat` and `useDefaults` at their non-spec defaults; with
  those defaults, required `format.json` and `default.json` cases fail
  (verified: `{format: "email"}` rejects `"2962"`, and `{properties: {r: {default: "u"}}}`
  returns `data: {r: "u"}` for `{}`).
- **JSL** states it "passes all tests" and links CI. Its five spec runners
  skip `float-overflow` (all drafts), `zeroTerminatedFloats` (draft-04), and
  `optional/content` (draft-07), and every CI spec script ends in `; exit 0`,
  so a failing spec run cannot fail the build; the README badges come from a
  gist, not from the repository. The measured numbers above are consistent
  with the badges' spirit: required tiers are clean.
- **JSE** claims 100% of the official suite for 2020-12, 2019-09, draft-07,
  draft-06 with zero skips, and a separate zero-skip draft-04 leg. The
  required-tier results above confirm that; the optional gaps are listed
  under "What fails" and are not mentioned in `STATUS.md`.

## Feature comparison

### Dialects and vocabularies

| Capability                     | JSE                                                                              | ata-validator                                                                                                        | JSL                                                                                                                          |
| ------------------------------ | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 2020-12                        | yes                                                                              | yes (primary)                                                                                                        | yes                                                                                                                          |
| 2019-09                        | yes                                                                              | no (`$recursiveRef` ignored, fails open)                                                                             | yes                                                                                                                          |
| draft-07                       | yes                                                                              | yes, as a rewrite pass into 2020-12 shape                                                                            | yes                                                                                                                          |
| draft-06 / draft-04            | yes / yes (separate package)                                                     | no / no (only boolean `exclusiveMinimum` is normalized)                                                              | yes / yes                                                                                                                    |
| JSON Schema "v1" (2026 draft)  | no                                                                               | yes: `propertyDependencies`, `$dynamicRef` without bookending                                                        | no                                                                                                                           |
| Dialect selection              | `$schema`, else `defaultDialect`; per-resource                                   | `$schema` only, root only; no option                                                                                 | regex match on `$schema`, or `draft` option (option wins); root only                                                         |
| `$vocabulary`                  | assembles dialects from vocabulary URIs; unknown required vocabulary is an error | strips keywords of omitted standard vocabularies; unknown required vocabulary is **accepted** (documented deviation) | only with a `remote` node: derives the allowed keyword set by generating default data from the metaschema; otherwise ignored |
| Custom dialects / vocabularies | `registerDialect`, vocabulary-scoped keyword registration                        | custom metaschema via `schemas`; no vocabulary API; custom keywords are not vocabulary-scoped                        | `extendDraft`/`addKeywords` build a new draft object; no vocabulary concept                                                  |
| Notable deviation              | —                                                                                | `propertyDependencies` is applied even without `$schema` (verified)                                                  | `$ref` merges `title`/`description`/`default` from the referrer onto the target (`settings.PROPERTIES_TO_MERGE`)             |

### References and loading

| Capability                     | JSE                                                                        | ata-validator                                                                                                                           | JSL                                                                          |
| ------------------------------ | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `$id`/`$anchor`                | yes                                                                        | yes (interpreter)                                                                                                                       | yes                                                                          |
| `$dynamicRef`/`$dynamicAnchor` | yes, compiled via interpreter trampoline                                   | yes, interpreter only                                                                                                                   | yes                                                                          |
| `$recursiveRef`                | yes                                                                        | no                                                                                                                                      | yes                                                                          |
| Remote/cross-document          | yes; sync `registerSchema` or async `loadSchema` through pluggable loaders | pre-registered only (`schemas` option / `addSchema` before first validate); no loader hook; `compat.loadSchema` is typed but never read | pre-registered only (`remotes`, `remote`, `addRemoteSchema`); no loader hook |
| Unresolvable ref               | error at load or first follow                                              | runtime error `ATA5001`, does not throw                                                                                                 | runtime `ref-error`, or throw with `throwOnInvalidRef`                       |

### Output and errors

| Capability               | JSE                                                                                                                                                     | ata-validator                                                                                                                                                     | JSL                                                                                                      |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Standard formats         | `flag`, `basic`, `detailed`, `verbose` (IETF draft-03) and `list`, `hierarchical` (machines-oriented proposal), relevant and verbose levels, both tiers | `flag`, `basic` via `toOutput()`; `detailed`/`verbose`/`list` throw. `toOutput` is CommonJS-only, absent from `index.d.ts` and the stability list                 | none                                                                                                     |
| Per-error locations      | `evaluationPath`, `schemaLocation` (absolute), `inputLocation`                                                                                          | `path`/`instancePath` and lexical `schemaPath`; no evaluation path; `absoluteKeywordLocation` only if the root has `$id`                                          | `data.pointer` into the instance only; no schema location on errors                                      |
| Error identity           | keyword + vocabulary, message, optional structured params                                                                                               | stable `ATA####` code, `expected`/`received`, `docUrl`, suggestions, optional source frames; `errorMessage` overrides                                             | kebab-case `code`, templated message, `data.schema` and `data.value` embedded; `errorMessages` overrides |
| Annotations              | any keyword, per-evaluation allow/deny/predicate selection; exact values                                                                                | only inside `toOutput`, only on success, fixed keyword list, second schema walk that skips `$ref`, `patternProperties`, `additionalProperties`, `contains`, `not` | only `deprecated-warning`                                                                                |
| `unevaluated*` mechanism | dependency data from the evaluation                                                                                                                     | internal evaluated-set tracking                                                                                                                                   | structural re-validation (`isPropertyEvaluated`), with a `@todo` to use annotations                      |
| Lazy results             | no                                                                                                                                                      | failure results build `errors` on first access; `errors` is non-enumerable, so `{...result}` drops it (verified)                                                  | no                                                                                                       |

A concrete example. For the schema

```json
{
  "$id": "https://example.com/order",
  "type": "object",
  "properties": {
    "id": { "type": "string" },
    "qty": { "type": "integer", "minimum": 1 }
  },
  "required": ["id"],
  "anyOf": [
    { "properties": { "kind": { "const": "a" } }, "required": ["kind"] },
    {
      "properties": { "note": { "type": "string", "deprecated": true } },
      "required": ["note"]
    }
  ],
  "unevaluatedProperties": false
}
```

and the instance `{"qty": 0, "kind": "b", "extra": true}`:

- JSE `list` reports eight units including both `anyOf` branch failures with
  their own locations and one `unevaluatedProperties` unit per offending
  property; `hierarchical` nests the branch failures under `/anyOf/0` and
  `/anyOf/1`.
- ata-validator's `validate()` reports five errors: `minimum`, `required`,
  one `anyOf` error carrying the closest branch's errors in `branchErrors`,
  and two `unevaluatedProperties` errors with `path: ""` and the property
  name in `params`. Its `toOutput` `basic` document repeats the two
  `unevaluatedProperties` units with `instanceLocation: ""` rather than
  `/kind` and `/extra`, and omits the branch errors.
- JSL reports five errors with instance pointers `#`, `#/qty`, `#`, `#/kind`,
  `#/extra` and the full schema object copied into each `data.schema`.

The three disagree on whether `/qty` is unevaluated once its `minimum` fails
(JSE says yes, per the dropped-annotation rule; the others say no). The
suite does not test that.

For the valid instance `{"id": "x", "qty": 2, "note": "hi"}`, JSE and
ata-validator both produce the three expected annotations (`title` twice,
`deprecated`). **JSL returns `valid: false`.** Its applicators test success
with `errors.length === 0` on a list that also holds annotations, so a
`deprecated: true` subschema inside `anyOf` or `oneOf` counts as failing.
Verified minimal case: `{"anyOf": [{"deprecated": true}]}` rejects every
instance. `not` and `properties` are unaffected.

### `format`

| Capability                  | JSE                                                                                    | ata-validator                                                                                                     | JSL                                                                                                                                               |
| --------------------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Default behavior            | annotation (spec default); `assertFormats: true` opts in                               | **asserted by default**; `assertFormat: false` deletes `format` from the schema, so it is then not even annotated | **asserted by default**; `formatAssertion: false` removes the keyword                                                                             |
| Implemented formats         | all standard formats from their RFCs, per-dialect tables, full IDNA2008 `idn-hostname` | 18 hand-written scanners; no `idn-hostname`; `hostname` skips A-label decoding; `iri` is approximate              | 10 in core (plus non-standard `url`); 10 more including `idn-*` via `json-schema-library/formats`, which inlines `@hyperjump/json-schema-formats` |
| Format-assertion vocabulary | honored                                                                                | not honored                                                                                                       | partially (`"meta-schema"` mode)                                                                                                                  |
| Custom formats              | table entry                                                                            | `formats` option                                                                                                  | `extendDraft({ formats })`                                                                                                                        |
| Suite (2020-12 format)      | 654/655                                                                                | 577/655                                                                                                           | 650/655                                                                                                                                           |

### Custom keywords

| Capability                 | JSE                                                 | ata-validator                                               | JSL                                                               |
| -------------------------- | --------------------------------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------- |
| Definition forms           | assertion, annotation, dependency producer/consumer | `validate`, `compile`, `macro`; redefining built-ins throws | `parse`/`validate`/`resolve`/`reduce` lifecycle on a draft object |
| Can emit annotations       | yes                                                 | no                                                          | yes (`createAnnotation`)                                          |
| Vocabulary-scoped          | yes                                                 | no                                                          | no                                                                |
| Can feed `unevaluated*`    | yes (dependency data)                               | only indirectly via `macro`                                 | no (applicator list is hard-coded)                                |
| Effect on performance tier | compiled when it lowers, else trampolined           | forces the interpreter; disables compile cache and AOT      | n/a (interpreted)                                                 |

### Beyond validation

| Feature                                | JSE                                                                  | ata-validator                                                                                                             | JSL                                                                                                                                 |
| -------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| ajv migration                          | `@json-schema-engine/ajv-compat` with an executed-ajv fixture matrix | `ata-validator/compat` (`compile`, `addSchema`, `addFormat`, `addKeyword`, `errorsText`); `loadSchema` unimplemented      | none                                                                                                                                |
| TypeScript type inference from schemas | no                                                                   | yes (`Infer<S>`, `defineSchema`, `t` builder)                                                                             | no (`JsonSchema` is `Record<string, any>`)                                                                                          |
| Standard Schema V1                     | no                                                                   | yes                                                                                                                       | no                                                                                                                                  |
| Ahead-of-time standalone modules       | CSP-safe standalone emission (flag only)                             | `ata build` CLI: dependency-free ESM/CJS modules with types; declines `$dynamicRef`, custom keywords, some `unevaluated*` | no                                                                                                                                  |
| Defaults / coercion / removeAdditional | via ajv-compat only                                                  | `useDefaults` (**on by default**), `coerceTypes`, `removeAdditional`                                                      | `getData` generates default data separately; `removeInvalidData` option                                                             |
| Source positions                       | schema and instance positions on errors and annotations              | schema frames (`source` option) and byte frames from `validateJSON`; pretty/compact/JSON renderers                        | no                                                                                                                                  |
| Text/buffer validation                 | no                                                                   | `validateJSON`, `isValid(Buffer)`, NDJSON, parallel batches (native addon; ~10 keyword shapes routed back to JS)          | no                                                                                                                                  |
| LLM helpers                            | no                                                                   | `describeSchema`, `toRetryMessage`                                                                                        | no                                                                                                                                  |
| Schema tooling                         | metaschema validation, dialect assembly                              | `strictSchema` authoring checks with spelling suggestions                                                                 | `getData`, `getNode`, `getChildSelection`, `reduceNode`, `toDataNodes`, `toSchemaNodes`, `schemaErrors`, `oneOfProperty` heuristics |
| CLI                                    | no                                                                   | `ata validate`, `ata build`, `ata compile`                                                                                | no                                                                                                                                  |
| Native C++ library                     | no                                                                   | yes (`ata::compile`/`ata::validate`)                                                                                      | no                                                                                                                                  |

### Runtime and packaging

| Property             | JSE                                                                | ata-validator                                                                                                                                                 | JSL                                                                                                  |
| -------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Engines              | interpreter; compiler (`new Function`) with interpreter trampoline | tier-0 interpreter, JS codegen (`new Function`), closure compiler, interpreter, native buffer walker, JSON text scanner                                       | closure-tree interpreter only                                                                        |
| CSP / no-eval        | interpreter, or standalone emission                                | automatic fallback to closure/interpreter; `engine: "interpreter"` option                                                                                     | never uses `new Function`                                                                            |
| Runtime dependencies | none                                                               | none (7 optional native packages, optional `yaml` peer)                                                                                                       | 6 (`@sagold/json-pointer`, `fast-copy`, `fast-deep-equal`, `uri-js`, `valid-url`, hyperjump formats) |
| Node                 | ≥ 22                                                               | ≥ 20                                                                                                                                                          | unspecified; CI on 24                                                                                |
| Module formats       | ESM                                                                | CJS implementation with ESM wrappers; the ESM wrapper omits `compile`, `toOutput`, `describeSchema`, `toRetryMessage`, `toTypeScript`, `parseJSON` (verified) | ESM, CJS, IIFE                                                                                       |

Bundle size, each package bundled with esbuild (`--bundle --minify
--format=esm`), then gzip -9:

| Bundle                                     | Minified | Gzipped |
| ------------------------------------------ | -------: | ------: |
| JSE `core`                                 |  84.6 KB | 19.3 KB |
| JSE `core` + `compiler`                    | 127.7 KB | 32.9 KB |
| JSE `formats` (adds to the above)          |  13.8 KB |  5.3 KB |
| JSL main entry                             | 122.2 KB | 32.3 KB |
| JSL `formats` entry (published `dist`)     | 175.0 KB |       — |
| ata-validator browser entry                | 325.1 KB | 87.0 KB |
| ata-validator Node entry (native excluded) | 364.6 KB | 99.6 KB |
| ajv 2020 (reference)                       | 133.2 KB | 40.0 KB |

ata-validator's own numbers for the runtime bundle vary across its documents
(27, 64.9, 66.9, 74.1, and 87.0 KB gzipped); its AOT output for a given
schema is a few KB.

### Security and resource limits

| Concern           | JSE                                                                                          | ata-validator                                                                                                                                                                          | JSL                                                                      |
| ----------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| ReDoS             | `rejectUnsafeRegex` star-height screen; pluggable regex engine                               | own Pike-VM regex engine (no backtracking) for `pattern`; falls back to native `RegExp` for backreferences, lookaround, Unicode property escapes; `SECURITY.md` overstates this as RE2 | none: `new RegExp` and unbounded `.test`                                 |
| Recursion depth   | `maxDepth` on registration and evaluation, typed error                                       | identity cycle guard for schema cycles; no instance-depth limit                                                                                                                        | `recursionLimit` for `getData` only; none for `validate`                 |
| `uniqueItems`     | near-linear bucketing                                                                        | nested loop for small arrays, canonical-JSON set for large ones; no cap                                                                                                                | O(n²) `fast-deep-equal` without early exit, reports every duplicate pair |
| Cyclic instances  | bounded by `maxDepth`                                                                        | a value already under evaluation is treated as valid                                                                                                                                   | not handled                                                              |
| Untrusted schemas | interpreter tier avoids codegen; escaping of schema-derived values in emitted code is fuzzed | `engine: "interpreter"`; compile cache keyed on schema content                                                                                                                         | designed for trusted schemas; no security section                        |

## Performance

### Method

The corpora are this repository's `bench/corpora` plus the two generated
record corpora from `bench/harness.ts`, reproduced verbatim:

- `oas-document`: the official OpenAPI 3.1 schema (2020-12, `$dynamicRef`
  throughout) against a hand-written OpenAPI document; one valid, one invalid
  instance.
- `api-payload`: a 2020-12 order-payload schema against 32 generated
  payloads, a quarter invalid in three ways.
- `migration`: a draft-07 user schema; one valid, one invalid instance.
- `records-uniform`: 150 typed properties under `items`, 2000 records that
  all carry the same 8 fields; valid plus a tail-invalid variant.
- `records-sparse`: the same schema, records carrying 8 core fields plus 0–3
  optional fields in varying order (megamorphic property access).

Rules, following `bench/harness.ts`: format assertion off in every subject,
defaults and coercion off, every subject must reproduce every expected
verdict before it is timed (ajv is excluded from `oas-document` because it
rejects the valid document), instances round-robin, tinybench with 300 ms
per task, 5-sample floor, 2 warmup iterations. "valid" and "invalid" rows
run only that partition. Numbers are mean microseconds per call from one
run; treat differences under about 20% as noise.

Two methodology notes specific to the newcomers:

- ata-validator's failure result builds `errors` lazily. Rows labeled
  `validate` therefore measure the verdict only; rows labeled
  `validate+errors` read `errors.length` so the error construction is inside
  the timing. Rows labeled `[interpreter]` or `[codegen]` report which engine
  ata-validator selected for that schema.
- JSL's `compileSchema` is lazy (`$ref`s resolve on first use), which is why
  its compile+first numbers are low.

### Verdict only, valid instances (µs per call)

| Corpus          | JSE compiled | JSE interpreter |      ata-validator |    ajv |   JSL | hyperjump |
| --------------- | -----------: | --------------: | -----------------: | -----: | ----: | --------: |
| oas-document    |         45.9 |             551 | 11.4 (interpreter) |      — | 1 633 |       333 |
| api-payload     |         0.31 |            33.8 |     0.17 (codegen) |   0.24 |  4.93 |      12.0 |
| migration       |         0.15 |            14.1 |     0.06 (codegen) |   0.09 |  1.91 |         — |
| records-uniform |         36.1 |          24 075 |      8.6 (codegen) |   11.4 | 2 258 |     4 747 |
| records-sparse  |        3 509 |          33 487 |   22 238 (codegen) | 22 651 | 2 968 |     6 581 |

The `records-*` rows validate 2000 records per call. ata-validator's
`isValidObject` and `abortEarly` variants were within noise of `validate`.
JSE's numbers match the repository's own `bench/results/results.json` from
2026-09-07 within a few percent.

### Errors materialized, invalid instances (µs per call)

| Corpus          | JSE compiled list | JSE interpreter list | ata `validate+errors` | ajv `allErrors` |   JSL |
| --------------- | ----------------: | -------------------: | --------------------: | --------------: | ----: |
| oas-document    |              54.9 |                  636 |                  16.6 |               — | 1 793 |
| api-payload     |              0.87 |                 36.0 |                  1.13 |            0.30 |  5.78 |
| migration       |              0.08 |                  7.3 |                  0.44 |            0.07 |  2.07 |
| records-uniform |               152 |               32 976 |                  27.2 |            11.6 | 2 303 |
| records-sparse  |             4 094 |               36 728 |                67 994 |          22 540 | 2 993 |

The error units are not equivalent: ajv reports one small object per
failure, JSE reports every relevant unit with three locations, ata-validator
enriches each error with `expected`/`received`, a documentation URL and
suggestions, and JSL copies the schema object into every error.

### Standard `basic` output with annotations (µs per call)

| Corpus          | JSE compiled, valid | JSE interpreter, valid | ata `toOutput`, valid | JSE compiled, invalid | ata `toOutput`, invalid |
| --------------- | ------------------: | ---------------------: | --------------------: | --------------------: | ----------------------: |
| oas-document    |                56.5 |                    555 |                  14.4 |                  56.4 |                    16.8 |
| api-payload     |                0.70 |                   34.6 |                  5.96 |                  0.96 |                    1.17 |
| migration       |                0.32 |                   14.7 |                  2.55 |                  0.14 |                    0.54 |
| records-uniform |                 227 |                 27 256 |                 8 512 |                   205 |                    28.6 |
| records-sparse  |               3 937 |                 30 254 |                33 674 |                 4 120 |                  69 762 |

ata-validator's `toOutput` walks the schema a second time and constructs a
fresh `Validator` for each `anyOf`/`oneOf`/`if` branch it visits, which is
where its cost on the record corpora comes from; on `oas-document` the walk
is cheap because it does not follow `$ref`, so it also collects almost
nothing there.

### Compile plus first validation (µs per call)

| Corpus          | JSE compiled | JSE interpreter | ata-validator |    ajv |   JSL |
| --------------- | -----------: | --------------: | ------------: | -----: | ----: |
| oas-document    |        4 894 |           1 045 |         4 273 |      — | 2 614 |
| api-payload     |          563 |             260 |           394 |  3 564 |    57 |
| migration       |          394 |             227 |           240 |  1 906 |    35 |
| records-uniform |        3 394 |          24 768 |         1 495 |  6 940 | 2 838 |
| records-sparse  |        7 340 |          28 053 |        23 737 | 31 155 | 3 280 |

A fresh engine/validator per iteration; a unique `$comment` is injected each
time so ata-validator's content-keyed compile cache cannot hit. The `records`
rows include one 2000-record validation.

### Observations

- **ata-validator's generated code is the fastest verdict engine measured**
  on static schemas: 1.3–1.5x faster than ajv and 2–4x faster than JSE's
  compiled tier on `api-payload`, `migration`, and `records-uniform`. Its
  interpreter (closure compiler) handles `$dynamicRef` and beats JSE's
  compiled tier on `oas-document` by 4x, because JSE's compiled artifact
  trampolines the dynamic islands to JSE's interpreter.
- **JSE's compiled tier wins where property access is polymorphic.** On
  `records-sparse` it is 6x faster than ata-validator and ajv, both of which
  fall to about 22 ms per 2000 records (the `key in obj` probe discussed in
  `bench/corpora/README.md`). JSL, which iterates instance keys rather than
  schema properties, is fastest there.
- **JSE's interpreter is the outlier.** It is 6–7x slower than JSL's
  interpreter on small payloads, 10x slower on `records-uniform`, and 50x
  slower than ata-validator's interpreter on `oas-document`. Since the
  compiled tier falls back to it for dynamic islands and for anything it
  cannot lower, this gap also bounds the compiled tier on schemas like OAS.
- **With errors materialized the picture changes.** ata-validator is 1.3x
  faster than JSE's compiled list on `api-payload`, JSE is 5x faster on
  `migration`; on `records-sparse`, ata-validator's rich-error construction
  costs three times its verdict, and JSE's list artifact is 16x faster than
  it.
- **For standard output JSE's compiled evaluator is the fastest by a wide
  margin**, and it is the only engine producing the full unit set. ata's
  `toOutput` is about 8x slower on small payloads and 9–37x slower on record
  arrays, and faster only on `oas-document` for the reason given above.
- **Compile latency** favors JSL (lazy) and ata-validator; JSE's compiled
  tier costs 1.2–2.3x more than ata-validator to first verdict on four
  corpora and 3x less on `records-sparse`, and its interpreter's
  first-validation cost on record arrays is dominated by the evaluation
  itself.

## Documentation accuracy notes

Findings from reading the other two repositories that a JSE reader
comparing feature lists should know about (each verified against the code
or by running it as noted):

ata-validator:

- The suite runner excludes `optional/` by construction; three in-tree
  documents give three different pass rates (see Conformance).
- `toOutput` is not typed, not in the ESM wrapper, and not in the stability
  list; the README's ESM import example for `describeSchema` and
  `toRetryMessage` cannot work because the ESM wrapper does not export them
  (verified by importing).
- `$recursiveRef`/`$recursiveAnchor` are not implemented and are not in the
  README's known-limitations list; recursive 2019-09 schemas fail open.
- `SECURITY.md` says catastrophic backtracking is impossible (RE2); the JS
  engine falls back to native `RegExp` for several constructs.
- `useDefaults` and `assertFormat` default to `true` (documented), so a
  spec-conformant configuration needs both turned off.
- `propertyDependencies` (a v1 keyword) is applied under 2020-12 as well.

json-schema-library:

- `deprecated: true` inside `anyOf`/`oneOf` makes the branch fail
  (see Output and errors). This affects real schemas.
- `format` is asserted by default, opposite to the spec default for
  2019-09 and 2020-12.
- Errors carry no schema location; `evaluationPath` and `schemaLocation`
  exist on `SchemaNode` objects but are not propagated to errors.
- `contentEncoding`/`contentMediaType` are neither validated nor recognized,
  so they produce `unknown-keyword-warning` schema annotations, as do
  `$vocabulary`, `$dynamicRef`, `examples`, `readOnly`, and the library's
  own `errorMessages` extension keyword.
- `addRemoteSchema` overwrites the calling node's `schemaErrors` and
  `schemaAnnotations` with the remote's.
- The README documents a `withSchemaAnnotations` option that was removed in
  11.4.0, an `addKeyword` export that is actually `extendDraft`/`addKeywords`,
  and a draft-precedence example that is the reverse of the code.

json-schema-engine (found while running the same suite):

- The `dependencies` keyword is not offered in the 2019-09/2020-12 dialects
  (`optional/dependencies-compatibility.json`), and `format: "regex"` accepts
  `\a`. Neither is mentioned in `STATUS.md` or `docs/conformance.md`.

## Where JSE stands, and what the others do better

JSE is the most complete implementation of the three by the spec's own
measure: every dialect, every output format, general annotation collection,
dependency data for `unevaluated*` and custom keywords, format-assertion
vocabulary support, loaders, and documented resource limits. Neither
competitor tries to cover that surface, and neither has a correct
annotation model (JSL's is a re-validation heuristic and has the
`deprecated` bug; ata-validator's is a bolt-on walk).

The others are ahead in these areas:

- **Raw verdict speed on static schemas** (ata-validator, 2–4x over JSE
  compiled), and **interpreter speed** (both; ata-validator's closure
  compiler and JSL's closure tree are 6–50x faster than JSE's interpreter).
  The interpreter gap is the one that matters for JSE, because the compiled
  tier delegates dynamic islands to it.
- **Compile latency** (JSL's lazy compile; ata-validator's cache and cheap
  construction).
- **Developer surface**: ata-validator's TypeScript inference, Standard
  Schema, AOT modules with emitted types, CLI, source-mapped diagnostics with
  stable error codes, and LLM prompt/retry helpers; JSL's default-data
  generation, schema navigation, and reduction for editor tooling.
- **Bundle size** is a wash between JSE and JSL (about 19–33 KB gzipped);
  ata-validator's runtime bundle is 2.5–5x larger, but its AOT output is
  smaller than any of them.

## Reproduction

The harness lives outside the repository (scratchpad, not committed):

- `conformance.ts <jse|ata|jsl>`: walks `test-suite/tests/<draft>/`,
  `optional/`, and `optional/format/`, builds one validator per group as
  configured under Method, and writes `results/conformance-<subject>.json`
  with every failing case.
- `bench.ts`: a port of `bench/harness.ts` with the same corpora,
  generators, oracle rule, and tinybench settings, plus ata-validator and JSL
  subjects; writes `results/bench.json`.
- `output-tests.ts`: the official `output-tests` `basic` cases through JSE
  and ata-validator's `toOutput`, checked with JSE.
- `output-samples.ts`: the worked example under Output and errors.

Both third-party packages were installed from npm under Node 24 into a
scratch workspace with `@json-schema-engine/*` symlinked to
`packages/*` and run with `tsx --conditions=jse-source`, so JSE executed
from source at `ee46b16`.
