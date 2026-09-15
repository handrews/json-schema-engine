# 0001: First release scope and ordering

**Status:** accepted 2026-09-05 (owner decision).

## Context

The 2026-09-05 planning scaffold placed five investigations (output model,
generic errors, annotation and transformation, defaults, output revisit) ahead
of implementation and the first public release. JSE is to be published before
the downstream project. IETF draft-03 §12.9 states that implementations are not expected to
make use of annotations on behalf of applications, so application facilities
(transformation, default filling, generic error grouping) are not required for
a conforming release.

## Decision

- The release path is: semantic reconciliation (S1–S3, fixtures first) →
  output levels and controls (E2, E9, S4) → cross-tier parity plus E1 →
  release gate. See the [roadmap](../roadmap.md).
- Shipped packages: `@json-schema-engine/core`, `@json-schema-engine/compiler`, `@json-schema-engine/formats`, and
  `@json-schema-engine/dialect-draft04`. The `@jse` scope is a placeholder until the owner's
  naming decision, which precedes the release documentation pass.
- `@json-schema-engine/ajv-compat` ships in a follow-up release. It stays in the repository
  with its tests running and `private: true`; after the first release it is
  adapted to the annotation/dependency record model and A1–A6 are fixed.
- E1 (registry visibility across compiled code and interpreted islands) is
  release-blocking: a user-visible correctness defect in a shipped package
  that contradicts the compiler's documented contract.
- Default output is `flag`. Any richer output requires an explicit format
  name; no richer format is the default.
- The generic-error, transformation, and default-filling investigations leave
  the critical path. Their pre-release obligation is limited to the
  information in the use-case matrix's
  [processing-boundary table](../use-case-matrix.md#information-required-at-processing-boundaries).

## Alternatives

- Keep the investigation-first ordering. Rejected: the release would depend
  on facilities the specification does not require.
- Fix `ajv-compat` before the first release. Rejected: it consumes the verbose
  application records that S1/S2 change, has open correctness defects (A1,
  A2, A5), and is not needed for usability.
- Ship without draft-04. Rejected: the package is complete, zero-skip in both
  tiers, Bowtie-pinned, and is the dialect-authoring exemplar.
- Defer E1 with documentation. Rejected: the fix is bounded (freeze the
  registry view per artifact) and the defect contradicts a documented
  contract.

## Evidence

- Draft-03 §12.9: annotations are provided to applications; implementations
  are not expected to use them on the application's behalf.
- downstream census (2026-09-05): the only runtime path is
  `compileList(...).basic()`, reading `valid`, `errors[]`,
  `instanceLocation`, and the keyword-location fields. The downstream project does not use
  `ajv-compat`.
- `packages/ajv-compat/COMPAT.md` and the 2026-07-12 audit: open defects in
  custom-keyword `compile` timing and discriminator/`ajv-errors` discovery.
- `DESIGN.md` deferred register: the E1 defect and its regression contract.

## Consequences

- The three facility investigations proceed in parallel as design probes and
  pull no implementation onto the release path.
- `STATUS.md` names the shipped slice; `COMPAT.md` gains a follow-up-release
  note in Phase 4.
- The downstream project keeps consuming vendored tarballs through the release; the release
  gate includes a downstream smoke against the candidate build (P3).

## Compatibility

- Output option names and shapes change in Phase 2; migration notes are a
  release deliverable.
- `ajv-compat` consumers keep using tarballs until its follow-up release.

## Follow-up

- `ajv-compat` follow-up release: adapt to the record model, fix A1–A6,
  publish.
- Owner naming and versioning decision before Phase 4 step 2.
