# Roadmap

**Status:** release-first, revised 2026-09-05. Phases 0–4 lead to the first
public release ([ADR 0001](decisions/0001-first-release-scope.md)); the
post-release stream follows. The [stage map](project-stage-map.md) gives the
same shape at a higher level; the [backlog](backlog-inventory.md) defines the
item IDs.

## Phase 0: decisions

Record [ADR 0001](decisions/0001-first-release-scope.md),
[ADR 0002](decisions/0002-drop-historical-computed-annotations.md), and
[ADR 0003](decisions/0003-output-levels-and-orthogonal-controls.md); align
every planning document, `STATUS.md`, and the `DESIGN.md` semantic-target
notice with them.

Gate: no planning document contradicts a recorded decision.

## Phase 1: semantic reconciliation, interpreter first (S1–S3)

1. Conformance fixtures before code, covering both irrelevance directions:
   - a rejecting sub-evaluation under an accepting applicator (`anyOf`,
     `oneOf`, `if` with `then`/`else`, `contains` non-matches, `not`);
   - an accepting sub-evaluation under a rejecting schema object (the current
     goldens case);
   - `unevaluated*` next to directly failing producers, and across references;
   - unrecognized, recognized-but-unsupported (§12.5), and
     required-vocabulary-failure keywords;
   - short-circuit with annotations off/on × dependency consumers
     absent/present × verbose demand off/on.
2. Split `Production` into an annotation record and a dependency record with
   separate `KeywordContext` entry points, typed so a dependency record cannot
   reach a renderer. `packages/core/src/keywords/applicator.ts` and
   `unevaluated.ts` become dependency-only producers. Unknown and
   recognized-but-unsupported keywords annotate with the exact keyword value.
3. Relevance: scope errors and annotations to keyword evaluations; apply the
   §12.2 transitions at keyword and schema-object boundaries; keep irrelevant
   records only under verbose demand, marked. Whether relevance is stored
   explicitly or derived from the trace is the spike's decision; both
   candidates are recorded in the
   [reconciliation investigation](investigations/ietf-draft-03-reconciliation.md).
4. Short-circuit reconciliation through derived evaluation demand.
5. Interpreter-only spike on a branch, with the compiler differential scoped
   on that branch only (`main` stays green), plus a written compiler
   blast-radius estimate (inputs listed under S1 in the backlog).

Gate: the new fixtures and every official-suite leg pass in the interpreter
with zero-skip counts unchanged; no dependency data appears in any annotation
output; goldens are regenerated and the header of
`packages/core/test/goldens.test.ts` explains the draft-03 relevance outcome;
the Phase 3 estimate exists. Compiler parity is Phase 3's gate, not this one.

## Phase 2: output levels and controls (E2, E9, S4)

Implement the control model from the
[output-model investigation](investigations/output-model.md) over the
reconciled records: every format name at its supported levels from one record
set; typed rejection of unsupported control combinations; draft-03 terminology
mapping (input vs instance; target field names are target vocabulary); format
provenance in the documentation; migration notes for `output`, `locations`,
`verbose`, `retention`, and `collectAnnotations`.

Gate: one fixture renders the same evaluation into every format at each
supported level; goldens exist per format × level; adding a renderer required
no evaluator change.

## Phase 3: cross-tier parity and E1

Compiled flag and list artifacts over the new records; relevance in compiled
list mode; interpreted islands; registry-view freeze (E1). Plan-census pins
are updated deliberately. Differential, fuzz, and Bowtie pins are green.
Standalone emission stays flag-only (E3 is post-release).

Gate: tier choice and compilation boundaries cannot change annotation, error,
dependency, relevance, or rendered output; the E1 regression passes.

## Phase 4: release gate (P1–P4), in this order

1. Owner naming and version policy.
2. Documentation: README, guide, `STATUS.md`, `COMPILED-*.md`, and a
   follow-up-release note in `COMPAT.md`; each format's source and the IETF
   output-format debate are stated.
3. P2 viability evidence: conformance fixtures, architecture explanation, tier
   parity, resource bounds, benchmark context.
4. Migration notes.
5. oaskit smoke: refresh the vendored tarballs from the candidate build and
   run oaskit's validation tests unchanged (P3).
6. `npm run verify`, `npm run pack:check`, fuzz and differential budgets.
7. Owner-controlled publication and Bowtie submission.

Gate: every shipped package is solid within its documented scope.

## Post-release stream

In rough order; each package states compatibility, tests, benchmarks,
completion criteria, and rollback/migration before implementation:

1. `@jse/ajv-compat` follow-up release: adapt to the record model, fix A1–A6,
   publish.
2. Generic errors R1–R3.
3. D1 and D3 (explicit dialect overrides, authoring guide), then the OAS
   dialect D5 and annotation adoption T4.
4. Transformation T1–T3 and default filling F1.
5. Streaming E11.
6. Compiler-tier guide E10.
7. Optimization E4–E6 and E8; standalone list output E3.
8. Documentation split Q1; fuzz corpora Q2; tooling Q3; D2, D4, D6, D7, and
   Q4 as demand appears.

The generic-error, transformation, and default-filling investigations continue
in parallel as design probes. They feed Phase 2 only through the
[processing-boundary table](use-case-matrix.md#information-required-at-processing-boundaries).

## Independent work

The IDNA review, fuzz expansion, and documentation restructuring need not
block Phases 1–3 unless they share files or invalidate measurements.
