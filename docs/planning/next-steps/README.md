# JSE next-steps planning

**Status:** investigation scaffold, reconciled with IETF draft-03 on
2026-09-05. Recording a question here does not decide it.

## Charter

This area turns JSE's deferred work and four coupled investigations into a
dependency-ordered roadmap: flexible output formats, generic error
post-processing, annotation processing and input transformation, and default
filling. IETF draft-03's annotation, dependency-information, and output-
relevance model is the required semantic foundation beneath all four. The plan
covers interpreted and compiled evaluation and uses `@jse/ajv-compat` and
oaskit as concrete consumers without allowing either consumer's compatibility
constraints to define generic JSE APIs.

## Scope

In scope are deferred items, JSE-facing oaskit requirements, measurements and
prototypes needed to choose designs, migration implications, and definitions
of done. JSE is now intended for public release as soon as its semantic and
public API foundations are solid. Release scope, evidence, and readiness are
therefore part of this roadmap; mechanical publishing and external submissions
remain separate checklists and owner-controlled actions.

The Hyperjump compatibility shim previously mentioned in `DESIGN.md` is no
longer planned. Oaskit has migrated, and remaining demand does not justify it.

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
  It is neither annotation output nor controlled by annotation retention.
- **Relevance** determines whether errors and annotations may appear in a
  selected output and whether dependency information may be consumed.
- **Transformation** is the native term for schema-driven input changes;
  AJV-facing text may retain **mutation**.
- **Runtime-option policy** means global behavior such as `coerceTypes` or
  `removeAdditional`. It may share addressing, scheduling, or diagnostics with
  schema-driven transformations, but it is not an annotation keyword and will
  not be converted into one.
- **Default filling** is separate because a missing target cannot produce an
  ordinary annotation at that location.
- **Output format** is a configurable projection of JSE semantic concepts such
  as evaluation path, schema location, input location, result, errors,
  annotations, relevance, and nesting. A target format's field names are not
  JSE's fundamental terminology.

## Established invariants

- Core remains an evaluation engine; generic policy modules may live above it.
- IETF draft-03 behavior is the must-deliver current-dialect model.
- Annotations and dependency information are distinct. Applicators such as
  `properties` do not produce IETF draft-03 annotations.
- Annotation values are exact keyword values, never computed values.
- Only relevant dependency information can be consumed. Non-verbose output
  omits irrelevant errors and annotations; verbose formats may expose them.
- New output formats can be added without changing evaluator semantics.
- Historical computed annotations, if supported, are an output-only
  compatibility facility and never drive keyword dependencies.
- Compiled artifacts have one registry-snapshot rule across compiled code and
  interpreted islands.
- Interpreter and compiler agree behaviorally for supported generic facilities.
- Annotation retention never changes dependency information visible to keyword
  consumers.
- Relevance and irrelevance are modeled across keyword and schema evaluation,
  not only as success-frame merge and discard.
- The IETF and machines-oriented output families are peer target formats; their
  structures and field vocabularies are not assumed equivalent.
- AJV vocabulary, order, and presentation are compatibility requirements, not
  native defaults.

## Evidence and lifecycle

Claims should cite current code, tests, fixtures, benchmarks, or executed
oracles. Each investigation proceeds through current-state census, use cases,
alternatives, measurements or prototypes, recommendation, review, and only then
implementation planning. Later findings may reopen output-model work.

## Documents

- [Backlog inventory](backlog-inventory.md)
- [Use-case matrix](use-case-matrix.md)
- [IETF draft-03 reconciliation](investigations/ietf-draft-03-reconciliation.md)
- [Output model](investigations/output-model.md)
- [Generic error processing](investigations/generic-error-processing.md)
- [Annotation and transformation](investigations/annotation-and-transformation.md)
- [Default filling](investigations/default-filling.md)
- [Decision records](decisions/README.md)
- [Project stage map](project-stage-map.md)
- [Roadmap](roadmap.md)
