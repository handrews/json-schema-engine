# Investigation: flexible output model

**Recommendation:** not decided.

## Question

What format-independent evaluator information and extensible rendering boundary
best support validation, diagnostics, generic error processing, annotations,
transformations, default filling, interpreted evaluation, compilation, and
standalone emission?

Output specifications remain in motion. The architecture must allow new target
formats and field vocabularies without repeatedly changing evaluator semantics.

## Evidence baseline

Treat these as equally relevant target-format inputs:

- IETF draft-03's
  [Flag, Basic, Detailed, and Verbose formats](https://www.ietf.org/archive/id/draft-ietf-jsonschema-json-schema-03.html#section-13.2),
  with `keywordLocation`, `absoluteKeywordLocation`, and `instanceLocation`;
- the machines-oriented
  [Flag, List, and Hierarchical proposal](https://github.com/json-schema-org/json-schema-spec/blob/4f56a9900674b27804f0ec32e3b7fdfa4efad695/specs/output/jsonschema-validation-output-machines.md),
  with `evaluationPath`, `schemaLocation`, `instanceLocation`, `details`,
  keyword-keyed errors/annotations, and dropped annotations;
- JSE's current native and compatibility outputs and its actual consumers.

IETF draft-03 did not change its output formats, but a later draft still might.
In particular, `instanceLocation` may become `inputLocation` in IETF draft-04.
The plan must not predict that outcome, but it must make such evolution cheap.

The machines-oriented proposal predates IETF draft-03 and illustrates computed
applicator annotations. Its structural output ideas are independent of those
historical annotation semantics. A format target must not silently select an
annotation/dependency model.

## Preferred JSE concepts versus target fields

JSE should reason in stable semantic concepts:

- acceptance result;
- evaluation path;
- schema location;
- input location;
- keyword identity;
- errors and exact-value annotations;
- dependency information that is not output;
- relevance or irrelevance;
- parent/child evaluation relationships.

Target formats map those concepts to their own fields and structures. Names
such as `keywordLocation`, `keywordRelativeLocation`, `schemaLocation`,
`absoluteKeywordLocation`, `instanceLocation`, and `inputLocation` are target
vocabulary, not the fundamental internal terminology.

## Current behavior

The interpreter maintains flat error records, frame-scoped productions, and an
optional trace. `Engine.evaluate` projects these into flag, list, or
hierarchical results and modern or 2020-12 location names. Verbose hierarchical
output retains successful annotation-free applications, which the mutation
adapter currently consumes. Compiled evaluation directly supports flag and
list artifacts; hierarchical output is not a compiled artifact surface.

This model needs IETF draft-03 reconciliation before it can be the canonical
input to flexible renderers. In particular, it conflates annotations and
dependency information and does not fully model keyword-level relevance.

## Required guarantees

- Precise keyword/schema acceptance and parent relationships.
- Monotonic relevance transitions and format-specific inclusion of irrelevant
  evaluations.
- Exact-value annotation and structured-error identity, location, multiplicity,
  and ordering semantics.
- No exposure of dependency information as ordinary annotations.
- A clear relationship among convenience results, processing records, and
  formatted output documents.
- Direct interpreter/compiler products versus derived representations.
- Plain cloneable data at public and worker boundaries.
- Stable artifact registry visibility through interpreted islands.
- Source decoration without hot-path cost.
- Structural output choice independent of optional historical computed-
  annotation compatibility.

## Extensibility questions

- Does a format consume a canonical evaluation graph, event stream, normalized
  records, or a combination?
- Which information is always recorded and which can a format request at plan
  or evaluation time?
- How does a new format declare its need for errors, annotations, irrelevant
  evaluations, full ancestry, dependency-derived compatibility data, or source
  positions?
- Can cheap formats compile directly while other formats are derived without
  creating semantic forks?
- Where do format validation, capability errors, and configuration warnings
  live?
- How do generic processors avoid depending on target field names?

These are session questions, not an instruction to implement a format registry
or any other specific mechanism now.

## TypeScript implications

The current `"flag" | "list" | "hierarchical"` option union and literal-value
overloads form a closed set. They provide useful narrowing, while a broad
dynamic option falls back to a permissive `Result` shape. Flexible formats
need an extension story that does not force one of these failures:

- every third-party format returns `unknown`;
- core owns an ever-growing global union;
- declaration merging becomes mandatory;
- runtime registration lies about the output type;
- artifact caches erase which data a format requires.

Compare generic format keys/descriptors, separately typed renderer calls,
registered capability tokens, and less coupled result APIs. Preserve bundler-
safe dynamic imports and do not expose compiler IR merely to retain typing.

## Historical compatibility dimension

If 2020-12/2019-09 computed annotations are supported, they are synthesized by
an output-only compatibility facility from evaluation/dependency facts. They
must never become canonical IETF draft-03 annotations or feed depending
keywords. Because no new meta-schema distinguishes IETF draft-03, this behavior
requires explicit runtime/output configuration.

The investigation must test structural and semantic choices independently:

- IETF structure with IETF draft-03 annotations;
- machines-oriented structure with IETF draft-03 annotations;
- any selected historical structure with optional computed annotations;
- verbose historical dropped annotations, if that scope is accepted.

## Measurements and prototypes

- Time, allocation, and size for flag, all-errors, exact annotations,
  dependency tracking, relevance, and full verbose evaluation records.
- Generated size/calling-convention cost for compiled candidates.
- Conversion cost among normalized records and both format families.
- A small externally defined format to test the extension boundary.
- Consumer prototypes for error grouping, annotation-driven transformation,
  runtime-option policy, and absent-target defaults.
- TypeScript examples using built-in, registered, and dynamically selected
  formats.
- Incremental cost of historical computed annotations in terse and verbose
  outputs.

## Compatibility and migration

Record changes to format names, field vocabularies, result overloads, artifact
APIs, caching, oaskit, and AJV compatibility. Avoid labeling the IETF family as
merely "2020-12" or the machines-oriented proposal as simply "modern."

## Exit criteria

- IETF draft-03 semantics are separated from every target format.
- Both format families map to stable JSE concepts.
- Adding a representative format does not change evaluator code or semantics.
- Direct/derived representations and tier responsibilities are identified.
- Measurements and credible TypeScript examples are available.
- Error/transformation/default investigations review the proposal.
- Historical computed annotations are either isolated as optional output
  compatibility or dropped.
- Future target-field renaming has a documented, bounded migration path.
