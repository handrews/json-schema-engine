# Investigation: annotation processing and input transformation

**Recommendation:** not decided.

**Release relationship:** off the release path
([ADR 0001](../decisions/0001-first-release-scope.md)). The only pre-release
obligation is that the reconciled record model carry the information listed
in the
[processing-boundary table](../use-case-matrix.md#information-required-at-processing-boundaries).

## Question

How should JSE expose generic annotation processing and schema-driven input
transformation, and which infrastructure can safely be shared with global
runtime-option policies?

IETF draft-03 exact-value annotations are the required base. Computed
evaluated-location information is keyword dependency data, not annotation data.

## Required distinction

- **Schema-driven extension-keyword transformations**, such as
  `ajv-keywords`' `transform`, may use exact-value annotations as application
  instructions or use a distinct specialized transformation behavior.
- **Global runtime-option policies**, such as `coerceTypes` and
  `removeAdditional`, apply because the caller enabled a policy. They are not
  annotation keywords and will not be converted into annotation keywords.

The two classes may share addressing, ordering, conflict diagnostics, fixpoint
execution, or compiled support. Shared machinery does not imply one semantic
representation.

Computed transformation proposals are not IETF draft-03 annotations. If JSE
supports them, their types, lifecycle, and output must remain distinct from the
exact-value annotation stream and from keyword dependency information.

## Transform gist assessment

The
[transform gist](https://gist.github.com/handrews/f28fb370a1b1bfc5c2e3d763e797d0c4/c164535edb99ec332ed06e0983ca33d61c460d7f)
predates IETF draft-03 and is evidence and a design probe, not a proposal to
adopt its illustrative output format.

The central separation fits the current direction well:

- `transform: [trim]` is a simple annotation whose output value is exactly the
  keyword value;
- the application above JSE reads the annotation at its input location and
  creates a transformed JSON value;
- ordinary JSON Schema assertions remain pure and order-independent;
- a `transformedMaxLength` value can likewise be an exact annotation that
  instructs application-level processing rather than changing JSON Schema's
  acceptance result during the original evaluation;
- vocabulary declaration provides an interoperable way to identify the
  extension.

The more complex example exposes gaps the investigation must retain:

- A full trace describes evaluation of the original input. A transformation
  can change the outcome of other branches, conditions, annotations, or
  dependency information, so propagating a hypothetical post-transform failure
  through the old trace is not generally sound.
- Re-evaluating the transformed input, possibly against a derived schema, is
  more general but has different cost, schema-identity, output, and diagnostic
  consequences.
- Trace-based reuse is viable only where the application can prove which
  results remain valid or where JSE exposes a sound dependency-replay model.
- Relevant annotations normally come from an accepted original evaluation.
  Transforming rejected inputs would require a deliberate verbose/schema-walk
  policy and must not accidentally apply irrelevant branch annotations.
- Multiple relevant `transform` annotations can target one input location,
  especially through `allOf`, `anyOf`, and references. Neither their encounter
  order nor the ordering of distinct schema occurrences is yet a generic
  composition policy.
- Transformation creates a new JSON value and possibly a separate application-
  level result; it does not retroactively change the original JSON Schema
  evaluation result.

The gist's alternative of modifying the input and translating application-
level constraint annotations into an ordinary schema for re-evaluation should
remain one prototype. It is not assumed to be the only or preferred approach.

## Current behavior

Core productions currently carry behavior, keyword, vocabulary, schema, input,
and value identity. They conflate exact annotations with computed dependency
information. Frames merge productions on schema success and discard them on
failure, which approximates but does not fully implement IETF draft-03 keyword-
level relevance. Annotation retention must not hide dependency information from
keyword consumers.

AJV compatibility keeps the evaluator pure and runs evaluate/mutate/re-evaluate
passes. Defaults, removal, and `transform` traverse verbose application
records; coercion consumes structured type failures. This is evidence, not the
presumed generic interface. AJV mutation may persist from paths that fail while
IETF draft-03 annotations from irrelevant paths are normally absent from non-
verbose output, so transaction semantics cannot be inherited without an
explicit distinction.

## Investigation topics

- Existing and proposed input locations.
- Order within/across keywords and vocabularies and between the two policy classes.
- Composition, conflicts, unsuccessful operations, and diagnostics.
- Single-shot versus repeatable operations and fixpoint termination.
- Immutable result versus in-place operation; root replacement.
- Plain JSON data versus objects with behavior.
- References, conditionals, combiners, and interpreter/compiler/standalone parity.
- Whether a transformation facility operates only after an accepted base
  evaluation or has an explicit policy for rejected inputs and irrelevant data.
- Whether post-transform checks are reported as transformation diagnostics, a
  separate application verdict, a re-evaluation result, or some combination.
- Multi-pass `contentSchema`: transform/decode annotated content and validate
  the result while respecting that all `content*` annotations carry their exact
  keyword values and embedded results remain separate from the enclosing result.

## Alternatives and prototypes

Compare exact-value annotation consumption, distinct transformation proposals,
schema/application plans, re-evaluation, schema translation, and separate
policy engines over shared scheduling. Prototype:

- simple annotation-driven `transform`;
- the gist's post-transform constraint through full-trace reasoning and through
  re-evaluation;
- conflicting/multiple relevant transforms;
- an irrelevant transform in a failed branch;
- runtime-option coercion and `removeAdditional`;
- multi-pass `contentSchema`.

Show exactly what is shared and what remains separate.

Measure retained application-data cost, pass/convergence behavior, compiled
size/runtime cost, and islands caused by nested tracked consumers.

## Exit criteria

- Extension-keyword and runtime-option classes remain explicit.
- Exact-value annotation instructions, dependency information, computed
  transformation proposals, and runtime policies are not conflated.
- Ordering, conflict, repetition, and diagnostics have candidate contracts.
- The limits of original-trace reuse and the conditions requiring re-evaluation
  are demonstrated.
- `contentSchema` has a coherent example.
- Tier parity and output-model feedback are recorded.
