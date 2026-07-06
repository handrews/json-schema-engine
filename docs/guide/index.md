# User guide

Task-oriented documentation for the engine. Every `ts` code block on these
pages is executed by CI; examples are guaranteed to work as shown.

## Topics

- [Validation](validation.md) — register schemas, evaluate instances, read
  error output.
- [Annotations](annotations.md) — collect annotations, control retention
  with allow and deny lists.
- [Output formats](output-formats.md) — flag, list, and hierarchical
  structures; current and 2020-12 field names; Basic/Detailed/Verbose.
- [Dialects](dialects.md) — draft 2020-12, 2019-09, draft-07, draft-06;
  `$schema` and default-dialect selection.
- [Loaders and remote references](loaders.md) — resolve `$ref` across
  documents; write a custom loader.
- [Source positions](source-positions.md) — map errors back to line/column
  in schema source text.
- [Custom keywords and vocabularies](custom-keywords.md) — extend the engine
  with the same mechanism the built-in drafts use.
- [Metaschemas](metaschemas.md) — `$vocabulary`-defined dialects and
  schema-against-metaschema validation.
- [Security and resource limits](security.md) — evaluating untrusted schemas
  and instances: ReDoS, recursion depth, array-uniqueness cost.

## TBD (planned, not yet stable)

- Installation — the package is not yet published; the npm name is TBD.
- Compiler tier (performance) — DESIGN.md M6.
- Format assertions — DESIGN.md M7.
- Migration from AJV — DESIGN.md M8.
