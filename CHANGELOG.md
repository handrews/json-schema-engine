# Changelog

Notable changes to the `@json-schema-engine/*` packages. Every package
carries the same version. The `0.0.x` line is experimental: APIs and the
errors they raise may change between releases.

## [Unreleased]

### Fixed

- The output guide now says how `list` and `hierarchical` relate to the
  machines-oriented proposal that defines them. The proposal has no
  concept of relevance, includes every unit in `hierarchical`, and makes
  pruning opt-in; the engine's default relevant level omits irrelevant
  records and prunes the units left empty, and `verbose: true` gives the
  unpruned structure. This is unchanged behavior, now documented as a
  deliberate departure.
- Corrected the claim that `valid` on each node of the `verbose` document
  tells relevant results from irrelevant ones. A result is relevant only
  when every node from the root down to it shares the root's `valid`; a
  `valid: true` node under a rejected `oneOf` branch is irrelevant. At the
  verbose level of `list` and `hierarchical`, `droppedErrors` and
  `droppedAnnotations` mark each irrelevant record, but units are not
  marked, and a unit's `valid` does not say whether it is relevant.

## [0.0.5] - 2026-09-24

Registry integrity and per-resource dialects
([ADR 0005](docs/planning/next-steps/decisions/0005-registry-integrity.md),
[ADR 0006](docs/planning/next-steps/decisions/0006-per-resource-dialects.md)).

### Changed

- **Breaking:** registration is all-or-nothing. A registration that throws
  leaves the registry exactly as it was; the half-indexed, still-evaluable
  document is gone.
- **Breaking:** duplicate identifiers are errors. Two schema objects
  claiming one resource URI throw `DuplicateResourceError`; two objects in
  one resource claiming one anchor name (plain, dynamic, or legacy
  plain-fragment `$id`) throw `DuplicateAnchorError`; an empty,
  fragment-only, or fragment-carrying `$id` throws `InvalidIdentifierError`.
  A different document under a registered URI throws; replacement is
  `unregisterSchema` then `registerSchema`. An equal copy is not a
  duplicate.
- **Breaking:** `validateSchemas` runs before a document becomes visible,
  on every path including loader-fetched documents, and checks each schema
  resource against its own dialect's metaschema. A failing document is
  never registered, and `SchemaValidationError` names the failing resource.
- **Breaking:** `$schema` governs the schema resource it roots. An embedded
  `$id` resource declaring its own `$schema` is walked, indexed, and
  evaluated under that dialect; one without `$schema` inherits. A
  `$schema` where no resource starts is ignored.
- **Breaking:** under draft-07, draft-06, and draft-04, siblings of `$ref`
  are no longer walked at registration: no identifier, reference, or
  pattern inside them is indexed, queued, or screened.
- A failed fetch during `loadSchema`/`load` keeps the rest of the load
  queue; the failed reference is not requeued.

### Added

- `Engine.unregisterSchema`; `SchemaRegistry.unregister`, `identify`,
  `dialectUriOf`, `nextUnresolved`; `DuplicateResourceError`,
  `DuplicateAnchorError`, `InvalidIdentifierError`, `RootIdentity`,
  `isStackOverflow`; `UnknownDialectError.dialectUri`.
- `loadSchema` and `load` assemble a dialect that an embedded resource
  declares, fetching its metaschema through the loaders; self-describing
  custom metaschemas load where they used to throw "metaschema cycle".

### Known issues

Recorded in the [backlog](docs/planning/next-steps/backlog-inventory.md):
`schemaLocation` emits raw JSON Pointers rather than URI fragments (D8);
`locate` with an anchor fragment returns the anchor as a pointer (D13);
output assembly has no stack-overflow backstop (D14); pointer navigation
rebases at `$id` values in data positions (D15); an equal re-registration
drops the document's other retrieval aliases (D16).

## [0.0.4] - 2026-09-21

Static `$dynamicRef` and `$recursiveRef` resolution in the compiled tier
(ADR 0004); unicode regex fix.

## [0.0.3] - 2026-09-20

README publication links.

## [0.0.2] - 2026-09-20

Publishing from CI.

## [0.0.1] - 2026-09-15

Initial public release for feedback on functionality and documentation.
