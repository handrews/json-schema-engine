# Investigation: native output model

**Recommendation:** not decided.

## Question

What evaluator data and public result shapes best support validation,
diagnostics, generic error processing, annotations, transformations, default
filling, interpreted evaluation, compilation, and standalone emission?
Compatibility with pre-publication proposals is not a goal by itself, though
migration from the current unpublished API needs an explicit plan.

## Current behavior

The interpreter maintains flat error records, frame-scoped productions, and an
optional trace. `Engine.evaluate` projects these into flag, list, or
hierarchical results and modern or 2020-12 location names. Verbose hierarchical
output retains successful annotation-free applications, which the mutation
adapter currently consumes. Compiled evaluation directly supports flag and
list artifacts; hierarchical output is not a compiled artifact surface.

TypeScript literal-option overloads narrow `outputDocument`; dynamic options
fall back to a broad structural result. This is not a fully discriminated
result union. Redesign affects inference, artifact/cache types, and bundling as
well as runtime shapes.

## Required guarantees

- Validity, location, ordering, and annotation rollback semantics.
- Relationship among convenience errors/annotations and output documents.
- Whether application history is output, diagnostic trace, or processing input.
- Direct interpreter/compiler products versus derived forms.
- Plain cloneable worker-safe public data.
- Stable artifact registry visibility through interpreted islands.
- Source decoration without hot-path cost.

## Alternatives to compare

- Refine and rename flag/list/hierarchical.
- A canonical event/application record stream with derived formats.
- Small validation results plus separate trace/processing artifacts.
- Additional direct compiled representations.
- Canonical errors/annotations plus optional application records.

## Measurements and prototypes

- Time, allocation, and size for flag, all-errors, annotations, trace, and
  verbose records on existing corpora.
- Generated size/calling-convention cost for compiled candidates.
- Conversion cost from compiled records to 2020-12 formats.
- Consumer prototypes for grouping, extension transformation, runtime-option
  policy, and absent-target defaults.
- TypeScript examples using literal and dynamically constructed options.

## Exit criteria

- Matrix needs map to explicit guarantees.
- Direct/derived forms and tier responsibilities are identified.
- Measurements and TypeScript examples are available.
- Error/transformation/default investigations review the proposal.
- Compatibility and migration consequences are explicit.

