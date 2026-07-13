# JSE next-steps planning

**Status:** investigation scaffold. Recording a question here does not decide it.

## Charter

This area turns JSE's deferred work and four coupled investigations into a
dependency-ordered roadmap: native output formats, generic error
post-processing, annotation processing and instance transformation, and
default filling. It covers interpreted and compiled evaluation and uses
`@jse/ajv-compat` and oaskit as concrete consumers without allowing either
consumer's compatibility constraints to define generic JSE APIs.

## Scope

In scope are non-publication deferred items, JSE-facing oaskit requirements,
measurements and prototypes needed to choose designs, migration implications,
and definitions of done. Package publication, npm naming, version/private
changes, Bowtie submission, and registry listings are excluded.

The Hyperjump compatibility shim previously mentioned in `DESIGN.md` is no
longer planned. Oaskit has migrated, and remaining demand does not justify it.

## Vocabulary and boundaries

- **Evaluation output** is evaluator data with documented guarantees.
- **Generic processing** groups or transforms it without adopting a
  consumer-specific vocabulary.
- **Compatibility processing** reproduces an external API such as AJV's.
- **Transformation** is the native term for schema-driven instance changes;
  AJV-facing text may retain **mutation**.
- **Runtime-option policy** means global behavior such as `coerceTypes` or
  `removeAdditional`. It may share addressing, scheduling, or diagnostics with
  schema-driven transformations, but it is not an annotation keyword and will
  not be converted into one.
- **Default filling** is separate because a missing target cannot produce an
  ordinary annotation at that location.

## Established invariants

- Core remains an evaluation engine; generic policy modules may live above it.
- Compiled artifacts have one registry-snapshot rule across compiled code and
  interpreted islands.
- Interpreter and compiler agree behaviorally for supported generic facilities.
- Annotation retention never changes productions visible to keyword consumers.
- Failed applications discard ordinary productions, though diagnostics may
  expose dropped productions.
- Current list and verbose hierarchical outputs are not assumed equivalent.
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
- [Output model](investigations/output-model.md)
- [Generic error processing](investigations/generic-error-processing.md)
- [Annotation and transformation](investigations/annotation-and-transformation.md)
- [Default filling](investigations/default-filling.md)
- [Decision records](decisions/README.md)
- [Roadmap](roadmap.md)

