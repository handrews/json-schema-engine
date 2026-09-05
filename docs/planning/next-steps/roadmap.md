# Investigation and implementation roadmap

**Status:** initial sequencing. Implementation packages remain provisional
until their decision gates pass.

## Phase 0: reconcile and measure

1. Keep the census current and assign owners.
2. Reconcile consumer documentation with delivered compiler capabilities.
3. Resolve or separately schedule artifact registry-snapshot correctness.
4. Capture baseline time, allocation, result size, generated size, and island
   frequency on existing corpora.

Gate: no open item is unclassified, snapshot semantics are specified, and
measurements are reproducible.

## Phase 1: initial output investigation

Specify candidate guarantees, direct/derived shapes, TypeScript surfaces, and
tier responsibilities. Do not finalize the model.

Gate: at least two credible alternatives have estimates and consumer
prototypes; migration effects are explicit.

## Phase 2: generic errors

Prototype native grouping with oaskit and AJV translation as separate
consumers. Feed required parameters/context back to output work.

Gate: oaskit's heuristics can be removed without putting AJV concepts in the
generic API.

## Phase 3: annotations and transformation

Prototype annotation processing, extension-keyword transformation,
runtime-option policy execution, and `contentSchema`. Keep extension keywords
and global options semantically distinct even where machinery is shared.

Gate: order, rollback/persistence, conflicts, passes, and tier parity are
demonstrated; output feedback is recorded.

## Phase 4: defaults

Prototype existing-location annotation consumption and absent-target
proposals/traversal. Test creation, references, applicators, conflicts, passes,
and ordering with both transformation classes.

Gate: supported fixtures are explained and unsupported AJV behavior is
explicitly compatibility-only.

## Phase 5: revisit output

Re-evaluate Phase 1 with findings from errors, transformations, and defaults.
Record an ADR only now.

Gate: guarantees, names, TypeScript types, direct/derived outputs, costs, and
migration are reviewed together.

## Phase 6: implementation planning

Potential packages, subject to decisions:

1. core evaluator/output primitives and migration;
2. compiler/runtime/standalone parity;
3. generic errors and oaskit adoption;
4. annotation/transformation modules with separate runtime-option policy;
5. default filling;
6. AJV adapter migration and correctness fixes;
7. OAS dialect and annotation adoption;
8. measurement-justified compiler optimizations;
9. authoring/compiler guides and design/ADR history split.

Each package must state compatibility, tests, benchmarks, completion criteria,
and rollback/migration before implementation.

## Independent work

The IDNA review, fuzz expansion, documentation restructuring, and tooling
convergence need not block these investigations unless they share files or
invalidate measurements.
