# JSE next-steps planning

**Status:** release-first plan, revised 2026-09-05 against IETF draft-03.
Decisions live in [decisions](decisions/README.md); everything else records
questions, evidence, and order, not answers.

## Charter

This area turns JSE's deferred work into a dependency-ordered path to a first
public release, followed by four coupled investigations: flexible output,
generic error post-processing, annotation processing and input transformation,
and default filling. IETF draft-03's annotation, dependency-information, and
output-relevance model is the semantic foundation beneath all of them. The
plan covers interpreted and compiled evaluation and uses
`@json-schema-engine/ajv-compat` and the downstream project as concrete
consumers without allowing either consumer's compatibility
constraints to define generic JSE APIs.

## Scope

In scope are deferred items, JSE-facing downstream-project requirements, measurements and
prototypes needed to choose designs, migration implications, and definitions
of done. The first public release
([ADR 0001](decisions/0001-first-release-scope.md)) ships once the semantic
reconciliation, the output-control foundation, cross-tier parity, and the
release evidence are solid. Mechanical publishing and external submissions
remain owner-controlled actions.

The Hyperjump compatibility shim previously mentioned in `DESIGN.md` is not
planned. The downstream project has migrated, and remaining demand does not justify it.

## Vocabulary and boundaries

- **IETF draft-03** means
  [draft-ietf-jsonschema-json-schema-03](https://www.ietf.org/archive/id/draft-ietf-jsonschema-json-schema-03.html),
  not the unsupported historical JSON Schema draft-03.
- **Input** is the JSON value being evaluated. **Instance** means an input known
  to have been accepted by a schema. Standardized format fields may retain
  `instanceLocation`; JSE's underlying concept is the input location.
- **Evaluation output** is evaluator data with documented guarantees.
- **Generic processing** groups or transforms it without adopting a
  consumer-specific vocabulary.
- **Compatibility processing** reproduces an external API such as AJV's.
- **Annotation** is application-facing output from an annotation keyword. Its
  value is exactly that keyword's value under IETF draft-03.
- **Dependency information** is implementation communication among keywords.
  It is neither annotation output nor controlled by annotation selection.
- **Relevance** determines whether errors and annotations may appear in
  relevant-level output and whether dependency information may be consumed.
- **Relevance marker** is the explicit per-unit indication, in verbose-level
  output, that a rendered evaluation is irrelevant.
- **Format name** selects one output structure and field vocabulary: `flag`,
  `basic`, `detailed`, `verbose` (draft-03 §13) or `list`, `hierarchical`
  (machines-oriented proposal). Provenance is documentation, not an API
  concept.
- **Output level** is _minimal_ (`flag`), _relevant_ (non-verbose, non-flag),
  or _verbose_ (irrelevant evaluations included). The level, not the format
  name, determines evaluation demand.
- **Verbose demand** is any configuration that requires irrelevant evaluations
  to be recorded, including the diagnostic trace.
- **Evaluation demand** is what the engine derives from the configured
  controls before evaluating: which annotations, errors, irrelevant
  evaluations, and dependency data must be recorded.
- **Annotation selection** is allow/deny filtering of annotation output by
  keyword and vocabulary. It is independent of level and relevance.
- **Transformation** is the native term for schema-driven input changes;
  AJV-facing text may retain **mutation**.
- **Runtime-option policy** means global behavior such as `coerceTypes` or
  `removeAdditional`. It may share addressing, scheduling, or diagnostics with
  schema-driven transformations, but it is not an annotation keyword and will
  not be converted into one.
- **Default filling** is separate because a missing target cannot produce an
  ordinary annotation at that location.
- An **output format** is a projection of JSE semantic concepts such as
  evaluation path, schema location, input location, result, errors,
  annotations, relevance, and nesting. A format's field names are not JSE's
  fundamental terminology.

## Established invariants

- Core remains an evaluation engine; generic policy modules may live above it.
- IETF draft-03 behavior is the must-deliver current-dialect model.
- Annotations and dependency information are distinct. Applicators such as
  `properties` do not produce annotations
  ([ADR 0002](decisions/0002-drop-historical-computed-annotations.md)).
- Annotation values are exact keyword values, never computed values.
- Only relevant dependency information can be consumed. Relevant-level output
  omits irrelevant errors and annotations; verbose-level output includes them
  with a relevance marker.
- Relevance is evaluation semantics. Level, annotation selection, and detail
  inclusion are output controls and never change relevance or dependency
  information
  ([ADR 0003](decisions/0003-output-levels-and-orthogonal-controls.md)).
- Every combination of output controls is supported in both tiers or rejected
  with a typed error.
- Short-circuiting is permitted iff there is no annotation demand, no
  dependency impact, and no verbose demand (draft-03 §12).
- Formats are selected by name; both sources' names are supported and their
  provenance is documented.
- New output formats can be added without changing evaluator semantics.
- The output foundation must not preclude later incremental streaming. A
  streamed unit may be provisional until later keyword/schema results make it
  irrelevant, so streaming consumers need stable identity and relevance-
  transition semantics.
- Compiled artifacts have one registry-snapshot rule across compiled code and
  interpreted islands.
- Interpreter and compiler agree behaviorally for supported generic facilities.
- Relevance and irrelevance are modeled across keyword and schema evaluation,
  not only as success-frame merge and discard.
- AJV vocabulary, order, and presentation are compatibility requirements, not
  native defaults.

## Evidence and lifecycle

Claims cite current code, tests, fixtures, benchmarks, executed oracles, or
spec text. Each investigation proceeds through current-state census, use
cases, alternatives, measurements or prototypes, recommendation, review, and
only then implementation planning. Owner decisions made on spec text, probes,
or censuses are recorded as decision records. Later findings may reopen
output-model work.

## Documents

- [Decision records](decisions/README.md)
- [Roadmap](roadmap.md)
- [Project stage map](project-stage-map.md)
- [Backlog inventory](backlog-inventory.md)
- [Use-case matrix](use-case-matrix.md)
- [IETF draft-03 reconciliation](investigations/ietf-draft-03-reconciliation.md)
- [Output model](investigations/output-model.md)
- [Generic error processing](investigations/generic-error-processing.md)
- [Annotation and transformation](investigations/annotation-and-transformation.md)
- [Static resolution of `$dynamicRef` in compiled artifacts](investigations/dynamic-ref-static-resolution.md)
- [Default filling](investigations/default-filling.md)
