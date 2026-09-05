# Cross-cutting use-case matrix

`Required` means the investigation must support or explicitly reject the use
case. `Evidence` means it supplies fixtures or constraints.

| Consumer or use case                    | Output   | Generic errors | Annotation / transformation     | Defaults |
| --------------------------------------- | -------- | -------------- | ------------------------------- | -------- |
| IETF draft-03 exact annotations         | Required | —              | Required                        | Evidence |
| Runtime keyword dependencies            | Required | Evidence       | Evidence                        | —        |
| Relevance-aware terse output            | Required | Required       | Required                        | Required |
| Irrelevant verbose diagnostics          | Required | Evidence       | Evidence                        | Evidence |
| Verbose level for `list`/`hierarchical` | Required | Evidence       | Evidence                        | Evidence |
| Annotation selection (allow/deny)       | Required | —              | Required                        | Evidence |
| Keyword vocabulary identity in output   | Required | Evidence       | Required                        | —        |
| Source positions: collect vs render     | Required | Required       | Evidence                        | —        |
| Extensible target output formats        | Required | Evidence       | Evidence                        | Evidence |
| Incremental/streaming output consumer   | Required | Evidence       | Evidence                        | Evidence |
| Cheapest boolean validation             | Required | —              | —                               | —        |
| Complete machine-readable failures      | Required | Required       | —                               | —        |
| Human error presentation                | Evidence | Required       | —                               | —        |
| Applicator/branch grouping              | Required | Required       | —                               | —        |
| AJV errors and `ajv-errors`             | Evidence | Required       | —                               | —        |
| oaskit `SchemaViolation` grouping       | Required | Required       | —                               | —        |
| SARIF/LSP source locations              | Required | Required       | —                               | —        |
| Annotation collection for tooling       | Required | —              | Required                        | Evidence |
| OAS annotation viewer                   | Required | —              | Required                        | —        |
| `unevaluated*` channel consumers        | Evidence | —              | Required                        | —        |
| Extension-keyword `transform`           | Required | —              | Required                        | —        |
| Multi-pass `contentSchema`              | Required | Evidence       | Required                        | —        |
| Runtime-option `coerceTypes`            | Required | Evidence       | Required, separate policy class | —        |
| Runtime-option `removeAdditional`       | Required | —              | Required, separate policy class | —        |
| Static and dynamic defaults             | Required | Evidence       | Evidence                        | Required |
| Parent creation then nested defaults    | Required | —              | Evidence                        | Required |
| Conflict/non-convergence diagnostics    | Evidence | Required       | Required                        | Required |
| Compiled/interpreted parity             | Required | Evidence       | Required                        | Required |
| Standalone artifacts                    | Required | Evidence       | Evidence                        | Evidence |
| Full application-history diagnostics    | Required | Evidence       | Required                        | Evidence |
| oaskit Overlay preprocessing            | —        | Evidence       | Evidence only                   | —        |

## Information required at processing boundaries

| Information or invariant                  | Errors   | Transformation            | Defaults                  |
| ----------------------------------------- | -------- | ------------------------- | ------------------------- |
| Application validity                      | Required | Required                  | Required                  |
| Existing input location                   | Required | Required                  | Required                  |
| Proposed absent input location            | —        | Sometimes                 | Required                  |
| Canonical schema/resource location        | Required | Required                  | Required                  |
| Evaluation/applicator path                | Required | Required                  | Evidence                  |
| Keyword and vocabulary identity           | Required | Required                  | Required                  |
| Record kind: error/annotation/dependency  | Required | Required                  | Required                  |
| Exact annotation keyword value            | —        | Required                  | Required                  |
| Static and runtime dependency data        | Evidence | Required                  | Evidence                  |
| Structured failure parameters             | Required | Evidence                  | Evidence                  |
| Annotation value and multiplicity         | —        | Required                  | Evidence                  |
| Successful annotation-free applications   | —        | Current compat dependency | Current compat dependency |
| Keyword/schema results and ancestry       | Required | Required                  | Required                  |
| Relevance/irrelevance and transition      | Required | Required                  | Required                  |
| Relevance marker in verbose-level output  | Required | Evidence                  | Evidence                  |
| Stable evaluation/unit lifecycle identity | Required | Evidence                  | Evidence                  |
| Stable resource snapshot                  | Required | Required                  | Required                  |
| Deterministic encounter/order data        | Required | Required                  | Required                  |
| Source position                           | Required | Evidence                  | Evidence                  |

Successful annotation-free applications are needed by the current compat
traversal of verbose output. They are not yet a requirement on the future
native model; a focused application-record or plan API may be better.

The output column covers the six format names (`flag`, `basic`, `detailed`,
`verbose` from IETF draft-03 §13; `list`, `hierarchical` from the
machines-oriented proposal) at their supported levels
([ADR 0003](decisions/0003-output-levels-and-orthogonal-controls.md)).
Structural choices are evaluated independently of annotation semantics. The
machines-oriented proposal's examples show computed applicator annotations,
which JSE does not produce
([ADR 0002](decisions/0002-drop-historical-computed-annotations.md)).

## Concrete consumers and fixtures

### JSE native

- `packages/core/src/keywords/applicator.ts` and `unevaluated.ts`: current
  computed productions that must be reclassified as dependency information.
- `packages/core/test/output.test.ts`: location vocabularies and output shapes.
- `packages/core/test/error-params.test.ts`: structured keyword failure data.
- `packages/core/test/channels.test.ts`: visibility, rollback, retention, and
  metadata including `default`.
- `packages/compiler/test/list-annotations.test.ts`: annotation parity/order.
- `packages/compiler/test/compiled-tracking.test.ts`: nested consumers,
  interpreted islands, and coverage export.

### Specifications and design probes

- [IETF draft-03 §12.2](https://www.ietf.org/archive/id/draft-ietf-jsonschema-json-schema-03.html#section-12.2):
  relevance and irrelevance for annotations, errors, and dependency use.
- [IETF draft-03 Appendix D](https://www.ietf.org/archive/id/draft-ietf-jsonschema-json-schema-03.html#appendix-D):
  static and runtime keyword dependencies.
- [Machines-oriented output proposal](https://github.com/json-schema-org/json-schema-spec/blob/4f56a9900674b27804f0ec32e3b7fdfa4efad695/specs/output/jsonschema-validation-output-machines.md):
  list/hierarchical structures and field vocabulary.
- [Transform gist](https://gist.github.com/handrews/f28fb370a1b1bfc5c2e3d763e797d0c4/c164535edb99ec332ed06e0983ca33d61c460d7f):
  exact annotation instructions, full-trace reasoning, and schema/input
  re-evaluation alternatives.

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
- `packages/ir/test/validator.ts`: validity, `instanceLocation`, and human text.

## Missing fixtures

- Directly failing dependency producers adjacent to `unevaluated*` consumers.
- Relevance transitions at keyword and schema boundaries across every
  applicator class.
- An accepting sub-evaluation under a rejecting schema object: absent from
  relevant-level output, present and marked at the verbose level (the current
  goldens case).
- The same semantics rendered into every supported format at each level, with
  the relevance marker at the verbose level.
- A third-party format proving extension without evaluator changes.
- A streamed unit that later becomes irrelevant, with explicit transition and
  the same final reduction as document output.
- Native grouping independent of AJV vocabulary.
- Native transformation proposal ordering and conflicts.
- Extension-keyword transformation and runtime-option policy on one input.
- Multi-pass `contentSchema` decoding and validation.
- Defaults for absent nested objects and arrays and across successful branches.
- Immutable-result versus in-place transformation ergonomics.
- Exact interpreter/compiler/standalone parity for chosen facilities.
