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

| File                      | Source                                                                          | License    |
| ------------------------- | ------------------------------------------------------------------------------- | ---------- |
| `oas-3.1-schema.json`     | Official OpenAPI 3.1 JSON Schema, `spec.openapis.org/oas/3.1/schema/2025-09-15` | Apache-2.0 |
| `openapi-document.json`   | Hand-authored OpenAPI 3.1 description (this repo)                               | MIT (repo) |
| `api-payload-schema.json` | Hand-authored API-payload schema (this repo)                                    | MIT (repo) |
| `migration-schema.json`   | Hand-authored draft-07 schema (this repo)                                       | MIT (repo) |

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

## What each corpus measures

- **oas-document** — the OAS 3.1 meta-schema (draft 2020-12, `$dynamicRef`,
  ~135 `$ref`s) validating a real OpenAPI description. The large-schema,
  reference-heavy, dynamic case: this is where the interpreter tier earns
  its keep and where compilation has the most to prove.
- **api-payload** — a moderate object schema over generated request
  payloads (valid and invalid mixes). The hot-path throughput case.
- **migration** — a draft-07 schema run natively and through
  `@jse/ajv-compat`, measuring the migration story's cost against real AJV.
