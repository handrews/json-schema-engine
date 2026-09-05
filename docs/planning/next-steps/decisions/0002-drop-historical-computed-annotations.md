# 0002: Drop historical computed applicator annotations

**Status:** accepted 2026-09-05 (owner decision).

## Context

Draft 2020-12 and 2019-09 described applicator keywords (`properties`,
`patternProperties`, `additionalProperties`, `prefixItems`, `items`,
`contains`, `unevaluatedProperties`, `unevaluatedItems`) as producing computed
annotations such as the set of matched property names. IETF draft-03 Appendix
D classifies that information as keyword dependency data, and §12.9 requires
an annotation's value to be the keyword's value. JSE currently emits the
computed values as annotations. Backlog item S5 asked whether to keep them
through an output-only adapter.

## Decision

Historical computed annotations are not supported. Applicator keywords produce
dependency information only. There is no output-only adapter, no
configuration switch, and no verbose-level reproduction.

## Alternatives

- An output-only adapter synthesizing the historical values from dependency
  facts. Rejected: it duplicates dependency semantics in a renderer, needs
  explicit configuration because draft-03 has no new meta-schema, and has no
  identified consumer.
- Keep the current productions under a different label. Rejected: conflicts
  with §12.9 and with the annotation/dependency separation (S1).

## Evidence

- Draft-03 §12.9 and Appendix D (tables 6 and 7).
- The official test suite and Bowtie check validation results only; neither
  checks annotation output.
- oaskit census (2026-09-05): no oaskit code reads annotations of any kind.
- `packages/core/test/goldens/list.json` shows the current computed
  `properties` annotation; the goldens are regenerated in Phase 1.

## Consequences

- S5 is removed from the backlog and the "if supported" hedges are removed
  from the planning documents.
- `packages/core/src/keywords/applicator.ts` and `unevaluated.ts` become
  dependency-only producers in Phase 1.
- The machines-oriented proposal's examples that show computed annotations
  are structural evidence only.

## Compatibility

Any consumer of the current computed annotations outside this repository must
read dependency-derived data through a future API (E6 or a schema-walk
facility), not through annotation output.

## Follow-up

None.
