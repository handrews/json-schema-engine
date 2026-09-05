# High-level project stage map

The near-term objective is a public JSE release that demonstrates the IETF
draft-03 annotation, dependency, and relevance model. Correctness,
explainability, and extensible output come before deep compiler optimization
or AJV-specific expansion. Stages 0–3 are the release path
([ADR 0001](decisions/0001-first-release-scope.md)); the [roadmap](roadmap.md)
gives the phase order within them.

## Stage 0: semantic baseline

- Reconcile every built-in keyword with IETF draft-03.
- Separate exact-value annotations, errors, static dependencies, and runtime
  dependencies.
- Model relevance and irreversible transition to irrelevance at keyword and
  schema-evaluation boundaries.
- Establish preferred JSE concepts using **input** during evaluation while
  mapping target-format terminology explicitly.
- Build focused conformance fixtures before changing public formats.

**Gate:** the interpreter is a clear reference model for annotation, error,
dependency, relevance, and short-circuit behavior.

## Stage 1: output levels and controls

- Define a format-independent semantic record set as the input to rendering.
- Render every format name (`flag`, `basic`, `detailed`, `verbose`, `list`,
  `hierarchical`) at its supported levels from that record set; document each
  name's source.
- Make level, annotation selection, error detail, keyword identity detail, and
  source positions independent controls; reject unsupported combinations with
  typed errors.
- Confirm that the record/renderer boundary can later support streamed units
  and monotonic relevance-transition events without requiring streaming in the
  first release.

**Gate:** the same evaluation renders into every supported format and level;
generic processors do not depend on one format's field names; adding a format
needs no evaluator change.

## Stage 2: cross-tier correctness and API hardening

- Bring the compiler and interpreted islands to semantic parity with the
  reference interpreter.
- Fix artifact registry visibility (E1).
- Stabilize the minimal public API, extension-author contract, terminology,
  migration guidance, and conformance/benchmark evidence.
- Perform only the compiler optimization needed to prove acceptable baseline
  behavior.

**Gate:** tier choice and compilation boundaries cannot change observable
semantics, and the release surface is documented and testable.

## Stage 3: first public release

- Ship `@jse/core`, `@jse/compiler`, `@jse/formats`, and
  `@jse/dialect-draft04` under the owner's chosen names.
- Run conformance, differential, fuzz, security/resource-bound,
  documentation, package-consumer, oaskit-smoke, and benchmark gates.
- Publish evidence explaining how JSE implements IETF draft-03 rather than
  presenting performance alone.

**Gate:** the shipped packages are solid within their documented scope.

## Stage 4: application facilities and integrations

- Release `@jse/ajv-compat` after adapting it to the record model and fixing
  its open defects.
- Complete generic error grouping and oaskit adoption.
- Complete schema-driven input transformation and default-filling designs.
- Add native OAS dialects and annotation consumers without exposing the larger
  private product strategy.
- Add streaming output when its lifecycle, cancellation/backpressure, and
  tier-parity contract is ready.

Prototypes from Stages 1–2 may pull a small amount of this work earlier when
needed to validate a foundational mechanism.

## Stage 5: deeper optimization

- Measure and, where justified, implement nested tracked consumers, island
  re-entry, membership thresholds, additional standalone output modes, and
  serializer restructuring.
- Re-run semantic differential gates for every optimization.
- Avoid letting benchmark wins redefine output, dependency, or relevance
  semantics.

Optimization experiments may happen earlier to reject an infeasible design,
but production optimization follows the semantic and release foundations.
