# External comparison harness

The scripts behind
[docs/comparisons/ata-validator-and-json-schema-library.md](../../docs/comparisons/ata-validator-and-json-schema-library.md).
They run [ata-validator](https://github.com/ata-core/ata-validator) and
[json-schema-library](https://github.com/sagold/json-schema-library)
(dev dependencies of the root package) alongside jse, ajv, and
`@hyperjump/json-schema`, so the comparison can be re-run as any of them
change. Nothing here is a gate; `bench/harness.ts` remains the enforced
performance report and `bench/results/results.json` its record.

| Script            | npm script            | What it does                                                                                                                                         |
| ----------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `conformance.ts`  | `compare:conformance` | Runs the vendored official suite (required, optional, and optional/format tiers, all five drafts) through each subject; writes one JSON per subject. |
| `bench.ts`        | `compare:bench`       | Times verdicts, materialized errors, `basic` output, and compile-plus-first on the `bench/harness.ts` corpora; writes `results/bench.json`.          |
| `output-tests.ts` | `compare:output`      | Runs the suite's `output-tests` (`basic`) through jse and ata-validator's `toOutput`.                                                                |
| `samples.ts`      | `compare:samples`     | Prints the worked example from the document: one schema through each library's error and annotation output.                                          |

`compare:conformance` takes an optional subject (`jse`, `ata`, `jsl`);
`compare:bench` honors `BENCH_BUDGET` (ms per task, default 250) like the
harness.

## Method

- **Same suite commit for every subject**: the `test-suite` submodule.
- **Spec configuration everywhere**: format assertion on only for the
  `optional/format` tier; defaults, coercion, and `removeAdditional` off.
  Both third-party libraries assert `format` and ata-validator applies
  `default` by default, so the scripts turn those off explicitly.
- **Oracle before timing** (`bench.ts`): a subject that returns a wrong
  verdict on any corpus instance is excluded for that corpus and the reason
  is recorded in the results JSON, as in `bench/harness.ts`. ajv is excluded
  from `oas-document` for this reason.
- **Lazy results are forced**: ata-validator's failure result builds
  `errors` on first access, so the `validate+errors` rows read
  `errors.length` inside the timed call.
- **Corpora are shared** with `bench/harness.ts` through
  `bench/corpora/index.ts`, so both benchmarks always measure the same
  inputs.

## Updating the document

1. `npm run compare:conformance`, `npm run compare:output`,
   `npm run compare:bench` (a few minutes at the default budget), and
   `npm run compare:samples`.
2. Commit the refreshed `results/*.json`.
3. Revise the tables and the version/environment lines in the document;
   the performance observations are written against specific ratios, so
   re-derive them from the new numbers rather than editing in place.
