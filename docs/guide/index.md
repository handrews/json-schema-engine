# User guide

Task-oriented documentation for the engine. Every `ts` code block on these
pages is executed by CI; examples are guaranteed to work as shown.

## Topics

- [Validation](validation.md) — register schemas, evaluate instances, read
  error output.
- [Annotations](annotations.md) — collect annotations, control selection
  with allow and deny lists.
- [Output formats](output-formats.md) — `flag`, `basic`, `detailed`,
  `verbose` (IETF draft-03) and `list`, `hierarchical` (machines-oriented
  proposal); output levels and controls.
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
- [Compiling schemas](compiled.md) — `@jse/compiler`: compiled validators,
  error and annotation artifacts, every output format, the registry-snapshot
  rule, standalone modules under CSP.
- [Migrating from AJV](ajv-migration.md) — the `@jse/ajv-compat`
  migration adapter: what is emulated, what fails loudly, documented
  divergences.

## TBD (planned, not yet stable)

- Installation — the package is not yet published; the npm name is TBD
  (see [STATUS.md](../../STATUS.md)).
