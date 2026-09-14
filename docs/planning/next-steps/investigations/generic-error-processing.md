# Investigation: generic error processing

**Recommendation:** not decided.

**Release relationship:** off the release path
([ADR 0001](../decisions/0001-first-release-scope.md)). The only pre-release
obligation is that the reconciled record model carry the information listed
in the
[processing-boundary table](../use-case-matrix.md#information-required-at-processing-boundaries).

## Question and layering

Which reusable transformations and grouping primitives should sit above core
without adopting AJV's vocabulary? Keep separate: evaluator guarantees,
normative relevance and target-format rendering, generic processing, and
AJV/application-specific paths, parameters, messages, and presentation.

## Current behavior

JSE errors can carry keyword identity and JSON-shaped parameters. The AJV
adapter uses trace/application context to filter and translate them. The downstream project
groups Basic/list output by `instanceLocation` and uses `NOISE_KEYWORDS` plus
path inference. Its worker-safe diagnostics attach source ranges through
pointer-to-CST correlation, which is distinct from evaluation locations.

IETF draft-03 makes error relevance part of evaluator/output semantics. A
rejecting sub-evaluation beneath an accepting applicator is irrelevant and its
error is omitted from non-verbose output. Generic grouping must not rediscover
that rule through AJV-like keyword heuristics.

## Use cases and invariants

- Group applicator and leaf failures without parsing messages.
- Retain enough branch context for `anyOf`, `oneOf`, `if`, and `contains`.
- Either consume relevance-filtered records or receive an explicit, normative
  relevance model; never infer it from target-format field names.
- Permit verbose diagnostic consumers to distinguish relevant from irrelevant
  errors without making irrelevant errors actionable by default.
- Transform compiled output into older 2020-12 forms where efficient.
- Preserve deterministic order and canonical resource identity.
- Permit application-specific problem vocabularies and presentation.
- Compose source correlation after semantic grouping.

## TypeScript questions

`ErrorParams` is extension-friendly JSON but does not narrow by keyword.
Compare an open record, a discriminated built-in family, and extensible
keyword-to-parameter registration. Public data must remain cloneable and custom
vocabularies must not require brittle declaration merging.

## Prototypes and measurements

Compare stateless transforms, a trace-derived grouping tree, a configurable
problem collector, and keyword-aware helpers above a neutral core. Prototype
the downstream project and AJV as separate consumers against `basic`/`list` and
`detailed`/`hierarchical` output.
Measure successful flag-to-diagnostic escalation, relevance processing,
combiner-heavy grouping, carried context, and source correlation.

## Exit criteria

- Generic and compatibility responsibilities are named separately.
- Normative relevance filtering occurs before application-specific grouping.
- A downstream-project prototype removes path/keyword heuristics.
- AJV consumes rather than defines the generic layer.
- Custom vocabulary errors have a clear extension story.
- Output-model feedback is recorded.
