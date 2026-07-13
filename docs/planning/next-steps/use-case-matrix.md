# Cross-cutting use-case matrix

`Required` means the investigation must support or explicitly reject the use
case. `Evidence` means it supplies fixtures or constraints.

| Consumer or use case | Output | Generic errors | Annotation / transformation | Defaults |
|---|---|---|---|---|
| Cheapest boolean validation | Required | — | — | — |
| Complete machine-readable failures | Required | Required | — | — |
| Human error presentation | Evidence | Required | — | — |
| Applicator/branch grouping | Required | Required | — | — |
| AJV errors and `ajv-errors` | Evidence | Required | — | — |
| oaskit `SchemaViolation` grouping | Required | Required | — | — |
| SARIF/LSP source locations | Required | Required | — | — |
| Annotation collection for tooling | Required | — | Required | Evidence |
| OAS annotation viewer | Required | — | Required | — |
| `unevaluated*` channel consumers | Evidence | — | Required | — |
| Extension-keyword `transform` | Required | — | Required | — |
| Multi-pass `contentSchema` | Required | Evidence | Required | — |
| Runtime-option `coerceTypes` | Required | Evidence | Required, separate policy class | — |
| Runtime-option `removeAdditional` | Required | — | Required, separate policy class | — |
| Static and dynamic defaults | Required | Evidence | Evidence | Required |
| Parent creation then nested defaults | Required | — | Evidence | Required |
| Conflict/non-convergence diagnostics | Evidence | Required | Required | Required |
| Compiled/interpreted parity | Required | Evidence | Required | Required |
| Standalone artifacts | Required | Evidence | Evidence | Evidence |
| Full application-history diagnostics | Required | Evidence | Required | Evidence |
| oaskit Overlay preprocessing | — | Evidence | Evidence only | — |

## Information required at processing boundaries

| Information or invariant | Errors | Transformation | Defaults |
|---|---|---|---|
| Application validity | Required | Required | Required |
| Existing instance location | Required | Required | Required |
| Proposed absent instance location | — | Sometimes | Required |
| Canonical schema/resource location | Required | Required | Required |
| Evaluation/applicator path | Required | Required | Evidence |
| Keyword and vocabulary identity | Required | Required | Required |
| Structured failure parameters | Required | Evidence | Evidence |
| Annotation value and multiplicity | — | Required | Evidence |
| Successful annotation-free applications | — | Current compat dependency | Current compat dependency |
| Branch/frame success and rollback | Required | Required | Required |
| Stable resource snapshot | Required | Required | Required |
| Deterministic encounter/order data | Required | Required | Required |
| Source position | Required | Evidence | Evidence |

Successful annotation-free applications are needed by the current compat
traversal of verbose output. They are not yet a requirement on the future
native model; a focused application-record or plan API may be better.

## Concrete consumers and fixtures

### JSE native

- `packages/core/test/output.test.ts`: location vocabularies and output shapes.
- `packages/core/test/error-params.test.ts`: structured keyword failure data.
- `packages/core/test/channels.test.ts`: visibility, rollback, retention, and
  metadata including `default`.
- `packages/compiler/test/list-annotations.test.ts`: annotation parity/order.
- `packages/compiler/test/compiled-tracking.test.ts`: nested consumers,
  interpreted islands, and coverage export.

### AJV compatibility

- `packages/ajv-compat/test/errors.test.ts` and oracle fixtures: mapping,
  paths, parameters, and ordering constraints.
- `mutation.test.ts` and `mutation-property.test.ts`: runtime-option policies,
  defaults, passes, idempotence, and non-convergence.
- `mutation-keywords.test.ts` and `ajv-keywords-mutation.json`: extension-keyword
  `transform`, operation order, combiner interleaving, and divergences.
- `fastify-poc.test.ts`: a concrete runtime-option consumer.

### Oaskit

- `packages/core/src/validation/validateOad.ts`: Basic/list consumption,
  grouping heuristics, and planned flag-to-list escalation.
- `packages/core/test/validation/validateOad.test.ts`: mixed dialects, formats,
  failures, and unresolved references.
- `packages/core/src/diagnostics/runner.ts`: pointer-indexed diagnostics and
  source-range attachment.
- `packages/ir/test/validator.ts`: validity, instance location, and human text.

## Missing fixtures

- Native grouping independent of AJV vocabulary.
- Native transformation proposal ordering and conflicts.
- Extension-keyword transformation and runtime-option policy on one instance.
- Multi-pass `contentSchema` decoding and validation.
- Defaults for absent nested objects and arrays and across successful branches.
- Immutable-result versus in-place transformation ergonomics.
- Exact interpreter/compiler/standalone parity for chosen facilities.

