# Investigation: default filling

**Recommendation:** not decided.

## Question

What facility above core should fill defaults at locations that may not yet
exist, while keeping generic policy separate from AJV compatibility?

## Current behavior

`default` is already an ordinary annotation producer when its schema location
is evaluated successfully and remains relevant. Its annotation value is
exactly the keyword value, which already fits IETF draft-03. That stream can
describe defaults for existing input locations, but a missing property or
array element does not evaluate its child schema and therefore cannot produce a
child annotation.

AJV compatibility instead uses verbose application records plus schema lookup.
It clones values, handles property and tuple/prefix defaults, may extend arrays,
and repeats passes so a parent default can expose a child target. Dynamic
defaults run after ordinary defaults under the relevant option.

## Investigation topics

- Existing `default` annotations versus schema traversal or absent-target proposals.
- Missing-only, empty-value, and overwrite policies.
- Object/array creation, tuple/prefix behavior, and no-hole guarantees.
- Copying, identity, references, applicators, conditionals, and conflicts.
- Dialect-specific schema positions and ignored siblings.
- Ordering relative to schema-driven transformations and runtime-option policies.
- Whether filling is permitted only after an accepted base evaluation and how
  relevance affects defaults found through applicator branches.
- Re-evaluation, pass bounds, convergence, partial failure, and diagnostics.
- Immutable result versus in-place filling and compiled/standalone support.

## Alternatives and prototypes

Compare a schema traversal, application-record processor, compiled default
plan, and hybrid exact-annotation/absent-target design. Any proposal for a
missing location is facility-specific data, not an annotation. Prototype nested object
creation, array extension, a reference, a conditional, conflicting successful
applicators, and ordering with both transformation policy classes.

Measure additional evaluation data, pass/allocation cost, plan size versus
post-processing, and cloning/immutable-result cost.

## Exit criteria

- Existing-location exact annotations and absent-location filling are distinguished.
- Creation, order, conflict, pass, and failure policies have alternatives.
- Generic and AJV behavior are separately described.
- Tier parity requirements are testable.
- Output/transformation feedback is recorded.
