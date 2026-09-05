# High-level project stage map

The near-term objective is a public JSE release that demonstrates the viability
of the IETF draft-03 annotation, dependency, and relevance model. Correctness,
explainability, and extensible output come before deep compiler optimization or
AJV-specific expansion.

## Stage 0: semantic baseline

- Reconcile every built-in keyword with IETF draft-03.
- Separate exact-value annotations, errors, static dependencies, and runtime
  dependencies.
- Model relevance and irreversible transition to irrelevance at keyword and
  schema-evaluation boundaries.
- Establish preferred JSE concepts using **input** during evaluation while
  mapping target-format terminology explicitly.
- Build focused conformance fixtures before changing public formats.

**Gate:** the interpreter can serve as a clear reference model for annotation,
error, dependency, relevance, and short-circuit behavior.

## Stage 1: flexible output and generic processing foundations

- Define a format-independent semantic input to output rendering.
- Support adding target formats without changing evaluator semantics.
- Treat the IETF Flag/Basic/Detailed/Verbose family and machines-oriented
  Flag/List/Hierarchical family as peer design inputs.
- Prototype generic relevance-aware error processing and exact-value annotation
  processing.
- Use transform, content processing, and default filling as design probes; do
  not require their full product APIs yet.
- Decide whether historical computed annotations have a sufficiently clean,
  output-only compatibility path.

**Gate:** selected formats can be produced from the same semantics, generic
processors do not depend on one format's field names, and extension of the
format set has a viable TypeScript story.

## Stage 2: cross-tier correctness and API hardening

- Bring the compiler and interpreted islands to semantic parity with the
  reference interpreter.
- Establish standalone implications for the selected initial formats.
- Resolve artifact registry-snapshot correctness.
- Stabilize the minimal public API, extension-author contract, terminology,
  migration guidance, and conformance/benchmark evidence.
- Perform only the compiler optimization needed to prove acceptable baseline
  behavior and architectural feasibility.

**Gate:** tier choice and compilation boundaries cannot change observable
semantics, and the initial release surface is documented and testable.

## Stage 3: first public release

- Decide the initial package set. In particular, either fix release-blocking
  `ajv-compat` defects or omit that package from the first release.
- Run conformance, differential, fuzz, security/resource-bound, documentation,
  package-consumer, and benchmark gates.
- Complete naming/versioning/package metadata and owner-controlled publication.
- Publish evidence explaining how JSE implements IETF draft-03 rather than
  presenting performance alone.

**Gate:** the shipped packages are solid within their documented scope. Future
format evolution can be accommodated without breaking evaluator semantics.

## Stage 4: generic application facilities and integrations

- Complete schema-driven input transformation and default-filling designs.
- Complete generic error grouping and oaskit adoption.
- Add native OAS dialects and annotation consumers without exposing the larger
  private product strategy.
- Harden or expand AJV compatibility after the generic boundaries are stable.

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
