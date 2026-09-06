# Benchmark corpora

Vendored, license-documented inputs for the bench harness
([`bench/harness.ts`](../harness.ts)). Nothing is fetched at run time — the
harness reads these files directly, so a benchmark run is reproducible
offline.

Per ANALYSIS.md §9, the draft-04-era public benchmarks
(json-schema-benchmark and relatives) are **history, not citations**: they
measure a different dialect and a different feature set. These corpora are
chosen to exercise the shapes the engine actually targets — a large
real-world meta-schema, an API-payload schema, and the AJV-migration path.

## Provenance and licensing

| File                          | Source                                                                                                         | License    |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------- | ---------- |
| `oas-3.1-schema.json`         | Official OpenAPI 3.1 JSON Schema, `spec.openapis.org/oas/3.1/schema/2025-09-15`                                | Apache-2.0 |
| `openapi-document.json`       | Hand-authored OpenAPI 3.1 description (this repo)                                                              | MIT (repo) |
| `api-payload-schema.json`     | Hand-authored API-payload schema (this repo)                                                                   | MIT (repo) |
| `migration-schema.json`       | Hand-authored draft-07 schema (this repo)                                                                      | MIT (repo) |
| _(generated)_ records-uniform | `recordsSchema()` in `bench/harness.ts`: 150 typed properties × 2000 eight-field records                       | MIT (repo) |
| _(generated)_ records-sparse  | `recordsSchema()` in `bench/harness.ts`: 150 typed properties × 2000 records with 8 core + 0–3 optional fields | MIT (repo) |

The OpenAPI Initiative publishes the 3.1 schema under Apache-2.0; the file
is vendored verbatim. All hand-authored inputs are original to this
repository and carry its MIT license. Payload instances are generated
deterministically inside the harness (seeded, no third-party data).

## Methodology notes discovered on real inputs

- **AJV is excluded from the `oas-document` corpus** (recorded in the
  results JSON): it rejects the valid document through its known
  draft 2020-12 non-compliance (`$dynamicRef` approximation +
  `unevaluatedProperties` interplay), and it refuses the official OAS
  schema entirely unless `strict: false` is set. jse and Hyperjump agree
  the document is valid. Timing a validator that returns the wrong
  verdict (and can short-circuit on it) would not be a comparison.
- **The payload schema deliberately avoids decimal `multipleOf`**: AJV's
  float-modulo check fails valid two-decimal amounts that jse's
  decimal-safe scaling accepts (a documented COMPAT.md divergence). The
  corpus measures throughput, not that divergence.
- **Record shapes decide the compiled tier's speed on wide schemas.** On
  `records-uniform` (one record shape) compiled flag mode validates 2000
  records in ~0.04 ms; on `records-sparse` (optional fields in varying
  order) the same artifact takes ~23 ms, level with AJV and the
  interpreter, because the plain-data presence probe
  (`obj[key] !== undefined`, one per schema property per record) goes
  megamorphic once record shapes differ. Conservative emission's
  `hasOwnProperty` probe measures ~2 ms on the same input (ad hoc; not a
  harness subject) and Hyperjump, which iterates instance keys, ~7 ms.
  Backlog E12.
- **tinybench's iteration floors are pinned** (5 samples, 2 warmup): the
  defaults (64 and 16) would run every records task for seconds regardless
  of `BENCH_BUDGET`, since one evaluation there costs 20–50 ms.
  Sub-millisecond tasks are governed by the time budget either way.

## What each corpus measures

- **oas-document** — the OAS 3.1 meta-schema (draft 2020-12, `$dynamicRef`,
  ~135 `$ref`s) validating a real OpenAPI description. The large-schema,
  reference-heavy, dynamic case: this is where the interpreter tier earns
  its keep and where compilation has the most to prove.
- **api-payload** — a moderate object schema over generated request
  payloads (valid and invalid mixes). The hot-path throughput case.
- **migration** — a draft-07 schema run natively and through
  `@jse/ajv-compat`, measuring the migration story's cost against real AJV.
- **records-uniform** — one schema applied many times over records that all
  share one shape (same fields, same order). Isolates per-application trace
  and annotation-unit allocation from property-access variance.
- **records-sparse** — the same schema over records whose shapes differ
  (0–3 optional fields each, in varying order). The polymorphic
  property-access case.
