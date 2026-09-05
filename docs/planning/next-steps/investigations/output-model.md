# Investigation: flexible output model

**Recommendation:** not decided. The control model is fixed by
[ADR 0003](../decisions/0003-output-levels-and-orthogonal-controls.md); the
record/renderer boundary that implements it is this investigation's output.

## Question

What format-independent evaluator information and extensible rendering boundary
best support validation, diagnostics, generic error processing, annotations,
transformations, default filling, interpreted evaluation, compilation, and
standalone emission?

Output specifications remain in motion. The architecture must allow new target
formats and field vocabularies without repeatedly changing evaluator semantics.

## Evidence baseline

Six format names, selected by name, each fixing structure and field
vocabulary:

- `flag`, `basic`, `detailed`, `verbose` from
  [IETF draft-03 §13](https://www.ietf.org/archive/id/draft-ietf-jsonschema-json-schema-03.html#section-13.2),
  with `keywordLocation`, `absoluteKeywordLocation`, `instanceLocation`,
  singular `error`/`annotation`, and nested `errors`/`annotations`;
- `list`, `hierarchical` from the
  [machines-oriented proposal](https://github.com/json-schema-org/json-schema-spec/blob/4f56a9900674b27804f0ec32e3b7fdfa4efad695/specs/output/jsonschema-validation-output-machines.md),
  with `evaluationPath`, `schemaLocation`, `instanceLocation`, `details`, and
  keyword-keyed errors/annotations;
- JSE's current native and compatibility outputs and its actual consumers.

`flag` is identical in both sources; the other names are unique across both.
Documentation states each name's source and that output formats are under
active debate in the IETF process; no "family" concept appears in the API.

IETF draft-03 did not change its output formats, but a later draft still might.
In particular, `instanceLocation` may become `inputLocation` in IETF draft-04.
The plan must not predict that outcome, but it must make such evolution cheap.

The machines-oriented proposal's examples show computed applicator
annotations, which JSE does not produce
([ADR 0002](../decisions/0002-drop-historical-computed-annotations.md)). Its
structural ideas stand on their own.

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

The interpreter maintains flat error records, frame-scoped annotation and
dependency records (separate stores; renderers accept annotation records
only), and an optional trace. `Engine.evaluate` projects these into flag,
list, or hierarchical results and modern or 2020-12 location names. Verbose
hierarchical output retains successful annotation-free applications, which
the mutation adapter currently consumes. Compiled evaluation directly
supports flag and list artifacts; hierarchical output is not a compiled
artifact surface.

This model needs the relevance step of the IETF draft-03 reconciliation
before it can be the canonical input to flexible renderers: it does not yet
model keyword-level relevance, and errors are never rolled back.

## Required guarantees

- Precise keyword/schema acceptance and parent relationships.
- Monotonic relevance transitions and format-specific inclusion of irrelevant
  evaluations.
- Exact-value annotation and structured-error identity, location, multiplicity,
  and ordering semantics.
- No exposure of dependency information as ordinary annotations.
- A clear relationship among convenience results, processing records, and
  formatted output documents.
- Equivalent semantics for finalized documents and any future streamed form,
  including relevance changes discovered after initial emission.
- Direct interpreter/compiler products versus derived representations.
- Plain cloneable data at public and worker boundaries.
- Stable artifact registry visibility through interpreted islands.
- Source decoration without hot-path cost.
- An explicit relevance marker on every irrelevant unit rendered at the
  verbose level.
- Format choice independent of level, annotation selection, and detail
  controls.

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

## Future streaming constraint

IETF draft-03 permits annotations to be presented as a stream of events. This
is not required for the first release, but the first output architecture must
leave a credible path to it.

Streaming is not just serialization of a finished list. A keyword's annotation
or error can be emitted while its evaluation is relevant and become irrelevant
after an ancestor keyword or schema result is known. Compare:

- buffering a unit until its relevance is final;
- emitting a provisional unit followed by an identity-addressed relevance
  transition;
- emitting evaluation lifecycle events from which a consumer derives units;
- hybrid strategies that finalize cheap cases immediately.

The investigation must identify stable unit/evaluation identity, ordering,
nesting, terminal acceptance/rejection, consumer cancellation, backpressure,
and error behavior. It must also say whether a stream carries canonical JSE
events, target-format units, or both. Reducing a completed stream must produce
the same configured result as non-streaming evaluation. Internal keyword-
dependency data must not accidentally become application output merely because
the evaluator exposes an event boundary.

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

For streaming, compare a synchronous callback sink, `Iterable`/generator, and
`AsyncIterable` without assuming they are interchangeable. JSE evaluation is
synchronous today: a callback preserves that boundary, a generator introduces
evaluation suspension, and true asynchronous backpressure could require a new
execution boundary. Event and transition types need discriminants and stable
typed identifiers so a consumer cannot accidentally apply a transition to the
wrong record class.

TypeScript is structurally typed, so `type EvaluationId = string` would not
prevent mixing that identifier with an unrelated string or unit identifier.
Compare opaque wrappers, `unique symbol` brands, and session-scoped generic
parameters while keeping the serialized event data plain and cloneable.

## Output levels and orthogonal controls

The controls below are independent
([ADR 0003](../decisions/0003-output-levels-and-orthogonal-controls.md)).
Option names are provisional; this investigation chooses final names and
records migration from the current ones.

| Control                 | Values                                                                                                                                                    | Layer                                                                                                        | Today                                             |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------- |
| Format name             | `flag`; `basic`, `detailed`, `verbose` (draft-03 §13); `list`, `hierarchical` (machines-oriented proposal)                                                | render                                                                                                       | `output` + `locations`                            |
| Level                   | minimal (`flag` only); relevant (`basic`, `detailed`, `list`, `hierarchical`); verbose (`verbose`; `list`/`hierarchical` under verbose demand; the trace) | evaluation demand (verbose forbids short-circuit) + render                                                   | `verbose` boolean on `hierarchical` only; `trace` |
| Annotation selection    | none; all; allow/deny by keyword and vocabulary; predicate                                                                                                | render semantics; may be pushed into evaluation as elision without touching dependency data (channel rule 5) | `collectAnnotations` + `retention`                |
| Error detail            | message; + keyword + structured params                                                                                                                    | render                                                                                                       | `errorParams`, `list` only                        |
| Keyword identity detail | name; + vocabulary URI                                                                                                                                    | render                                                                                                       | `vocabulary` on flat units only                   |
| Source positions        | not collected; collected, not rendered; rendered                                                                                                          | loader (collect) + render (include)                                                                          | `positions` decorate; loader `getRange` (D17)     |

Requirements:

- The level of a request, not its format name, drives evaluation demand.
  `flag` is minimal; `basic` and `detailed` are relevant by definition
  (§13.4.2–13.4.3); `verbose` is verbose by definition (§13.4.4); `list` and
  `hierarchical` exist at both the relevant and verbose levels. Which further
  combinations exist is an output of this investigation.
- Every combination of controls is supported in both tiers or rejected with a
  typed error. Today `errorParams` and `trace` are silently ignored outside
  `list` (`packages/core/src/index.ts:219-226`).
- The engine derives an _evaluation demand_ from the controls once, at plan or
  compile time: annotations needed (per selection), irrelevant records needed
  (verbose level), all errors needed (any level above minimal), dependency
  tracking needed (from the schema's consumers). The existing
  `RecordPredicate`/`shouldRecord` elision (`packages/core/src/engine.ts`,
  `output.ts`) is the seed of this mechanism.
- Verbose-level `list` and `hierarchical` output carries an explicit per-unit
  relevance marker; the machines proposal has none, and `droppedAnnotations`
  covers only discarded annotations. Draft-03 §13.4.4 recommends `valid` per
  node for the same purpose; the marker design must serve both.
- `vocabulary`, `params`, and `source` are available on every format above
  minimal. Today `vocabulary` is lost in the hierarchy's keyword-keyed maps
  (`packages/core/src/output.ts`).
- Position collection is a loader-level control (parse cost); position
  rendering is a separate render-level control.
- The third-party-format TypeScript extension story is post-release; the
  first release ships a closed, typed option set over a record→renderer
  boundary designed to open later without evaluator changes.

## Measurements and prototypes

- Time, allocation, and size for flag, all-errors, exact annotations,
  dependency tracking, relevance, and full verbose evaluation records.
- Cost of the verbose level (irrelevant records plus marker) versus the
  relevant level for `list` and `hierarchical`.
- Generated size/calling-convention cost for compiled candidates.
- Conversion cost among normalized records and every format name.
- A small externally defined format to test the extension boundary.
- A provisional-unit stream with a later relevance transition, reduced and
  compared with the equivalent finalized document; measure buffering and event
  overhead without making streaming a first-release gate.
- Consumer prototypes for error grouping, annotation-driven transformation,
  runtime-option policy, and absent-target defaults.
- TypeScript examples using built-in, registered, and dynamically selected
  formats.

## Compatibility and migration

Record changes to format names, field vocabularies, result overloads, artifact
APIs, caching, oaskit, and AJV compatibility. Name formats by their format
names, never as "2020-12" or "modern", and state each name's source. The
compiled `basic()` accessor and the draft-03 location fields that oaskit reads
are kept or migrated in coordination with oaskit.

## Exit criteria

- IETF draft-03 semantics are separated from every target format.
- Every format name maps to stable JSE concepts at each supported level.
- Level, annotation selection, error detail, keyword identity, and
  source-position controls are independent, and every combination is
  supported or rejected with a typed error.
- Adding a representative format does not change evaluator code or semantics.
- Direct/derived representations and tier responsibilities are identified.
- Measurements and credible TypeScript examples are available.
- Error/transformation/default investigations review the proposal.
- Future target-field renaming has a documented, bounded migration path.
- The selected foundation does not require retaining all output in memory and
  has a credible, parity-testable route to post-release streaming.
