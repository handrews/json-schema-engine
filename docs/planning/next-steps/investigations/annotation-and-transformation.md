# Investigation: annotation processing and instance transformation

**Recommendation:** not decided.

## Question

How should JSE expose generic annotation processing and schema-driven instance
transformation, and which infrastructure can safely be shared with global
runtime-option policies?

## Required distinction

- **Schema-driven extension-keyword transformations**, such as
  `ajv-keywords`' `transform`, may be expressible as annotations or explicit
  proposals produced at evaluated schema locations.
- **Global runtime-option policies**, such as `coerceTypes` and
  `removeAdditional`, apply because the caller enabled a policy. They are not
  annotation keywords and will not be converted into annotation keywords.

The two classes may share addressing, ordering, conflict diagnostics, fixpoint
execution, or compiled support. Shared machinery does not imply one semantic
representation.

## Current behavior

Core productions carry behavior, keyword, vocabulary, schema, instance, and
value identity. Frames merge productions on success and discard them on
failure. Retention never hides them from keyword consumers.

AJV compatibility keeps the evaluator pure and runs evaluate/mutate/re-evaluate
passes. Defaults, removal, and `transform` traverse verbose application
records; coercion consumes structured type failures. This is evidence, not the
presumed generic interface. AJV mutation may persist from paths that fail while
ordinary annotations roll back, so transaction semantics cannot be inherited
without an explicit distinction.

## Investigation topics

- Existing and proposed instance locations.
- Order within/across keywords and vocabularies and between the two policy classes.
- Composition, conflicts, unsuccessful operations, and diagnostics.
- Single-shot versus repeatable operations and fixpoint termination.
- Immutable result versus in-place operation; root replacement.
- Plain JSON data versus objects with behavior.
- References, conditionals, combiners, and interpreter/compiler/standalone parity.
- Multi-pass `contentSchema`: transform/decode annotated content and validate
  the result while respecting that all `content*` keywords are annotations.

## Alternatives and prototypes

Compare ordinary annotation consumption, typed transformation proposals,
schema/application plans, and separate policy engines over shared scheduling.
Prototype extension `transform`, coercion, `removeAdditional`, and
`contentSchema`; show exactly what is shared and what remains separate.

Measure retained application-data cost, pass/convergence behavior, compiled
size/runtime cost, and islands caused by nested tracked consumers.

## Exit criteria

- Extension-keyword and runtime-option classes remain explicit.
- Annotation-based and other operations are catalogued.
- Ordering, conflict, repetition, and diagnostics have candidate contracts.
- `contentSchema` has a coherent example.
- Tier parity and output-model feedback are recorded.

