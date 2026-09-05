# Investigation and implementation roadmap

**Status:** revised for IETF draft-03 and a near-term public release.
Implementation packages remain provisional until their decision gates pass.
See the [high-level project stage map](project-stage-map.md) for the release and
post-release shape; this document gives the investigation order within it.

## Phase 0: IETF draft-03 reconciliation

1. Classify every current production as an exact-value annotation, static or
   runtime dependency, error, or neither.
2. Specify keyword- and schema-evaluation relevance transitions.
3. Add direct-sibling, applicator, reference, conditional, and `unevaluated*`
   conformance fixtures.
4. Reconcile short-circuit and retention logic with separate annotation, error,
   dependency, and verbose-output demand.
5. Establish IETF draft-03 terminology and target-format mappings.

Gate: the interpreter is a readable reference implementation of IETF draft-03
semantics and no dependency information is exposed as an annotation.

## Phase 1: initial flexible-output investigation

Specify candidate format-independent evaluator records, renderer capabilities,
direct/derived shapes, TypeScript extension surfaces, and tier responsibilities.
Treat IETF Flag/Basic/Detailed/Verbose and machines-oriented
Flag/List/Hierarchical as peers. Keep target structure/fields independent of
the optional historical computed-annotation switch. Do not finalize the model.

Gate: at least two credible evaluator/renderer boundaries have estimates; a
representative external format and both standardization inputs can be mapped;
migration effects are explicit.

## Phase 2: generic errors

Prototype relevance-aware native grouping with oaskit and AJV translation as
separate consumers. Feed required parameters/context back to output work.

Gate: oaskit's heuristics can be removed without putting AJV concepts in the
generic API.

## Phase 3: annotations and transformation

Prototype exact-annotation processing, the transform gist's simple and
post-transform cases, runtime-option policy execution, and `contentSchema`.
Compare full-trace reasoning with re-evaluation and schema translation. Keep
annotation instructions, computed transformation proposals, dependency
information, and global options semantically distinct even where machinery is
shared.

Gate: order, relevance, persistence, conflicts, passes, and the limits of trace
reuse are demonstrated; output feedback is recorded. Full transformation
product APIs need not ship in the first release.

## Phase 4: defaults

Prototype existing-location exact-annotation consumption and absent-target
proposals/traversal. Test creation, references, applicators, conflicts, passes,
and ordering with both transformation classes.

Gate: supported fixtures are explained and unsupported AJV behavior is
explicitly compatibility-only.

## Phase 5: revisit output and historical compatibility

Re-evaluate Phase 1 with findings from errors, transformations, and defaults.
Prototype optional 2020-12/2019-09 computed annotations strictly as output
compatibility, including any verbose/dropped scope. Drop that feature if it
contaminates IETF draft-03 annotation or dependency semantics. Record an ADR
only now.

Gate: guarantees, JSE concepts, target fields, TypeScript extension types,
direct/derived outputs, compatibility dimensions, costs, and migration are
reviewed together.

## Phase 6: minimal cross-tier implementation and hardening

Implement the semantic and output foundation in the interpreter and compiler,
including interpreted islands and selected standalone output. Resolve artifact
registry snapshots and stabilize only the public slice required for release.
Run optimization prototypes only where needed to reject an infeasible design.

Gate: tier choice and compilation boundaries cannot affect annotation, error,
dependency, relevance, or selected output semantics.

## Phase 7: public release gate

1. Decide initial packages and APIs.
2. If `ajv-compat` ships, fix its release-blocking correctness defects first;
   otherwise omit it explicitly.
3. Complete conformance, differential, fuzz, resource/security, documentation,
   package-consumer, formatting, and benchmark gates.
4. Publish an evidence-based explanation of IETF draft-03 viability.
5. Complete owner-controlled naming, versioning, registry, and outreach work.

Gate: every shipped package is solid within a documented scope, and future
output target evolution does not require evaluator semantic changes.

## Phase 8: post-foundation facilities and optimization

Potential work packages, subject to the earlier decisions:

1. complete generic errors and oaskit adoption;
2. complete annotation-driven transformation and separate runtime-option policy;
3. complete default filling;
4. native OAS dialect and annotation adoption;
5. AJV adapter hardening and extension work;
6. measurement-justified nested consumers, island re-entry, membership
   thresholds, serializer restructuring, and broader standalone output;
7. authoring/compiler guides and design/ADR history split.

Each package must state compatibility, tests, benchmarks, completion criteria,
and rollback/migration before implementation.

## Independent work

The IDNA review, broad fuzz expansion, documentation restructuring, and tooling
convergence need not block the semantic investigations unless they share files
or invalidate measurements. Release-critical subsets join the Phase 7 gate.
