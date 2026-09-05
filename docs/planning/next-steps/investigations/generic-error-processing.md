# Investigation: generic error processing

**Recommendation:** not decided.

## Question and layering

Which reusable transformations and grouping primitives should sit above core
without adopting AJV's vocabulary? Keep separate: evaluator guarantees,
generic processing, and AJV/application-specific paths, parameters, messages,
and presentation.

## Current behavior

JSE errors can carry keyword identity and JSON-shaped parameters. The AJV
adapter uses trace/application context to filter and translate them. Oaskit
groups Basic/list output by instance pointer and uses `NOISE_KEYWORDS` plus
path inference. Its worker-safe diagnostics attach source ranges through
pointer-to-CST correlation, which is distinct from evaluation locations.

## Use cases and invariants

- Group applicator and leaf failures without parsing messages.
- Retain enough branch context for `anyOf`, `oneOf`, `if`, and `contains`.
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
oaskit and AJV as separate consumers. Measure successful flag-to-list
escalation, combiner-heavy grouping, carried context, and source correlation.

## Exit criteria

- Generic and compatibility responsibilities are named separately.
- An oaskit prototype removes path/keyword heuristics.
- AJV consumes rather than defines the generic layer.
- Custom vocabulary errors have a clear extension story.
- Output-model feedback is recorded.
