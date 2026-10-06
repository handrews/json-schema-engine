# Changelog

Notable changes to the `@json-schema-engine/*` packages. Every package
carries the same version. The `0.0.x` line is experimental: APIs and the
errors they raise may change between releases.

## [Unreleased]

## [0.0.6] - 2026-10-06

Informative errors
([ADR 0007](docs/planning/next-steps/decisions/0007-informative-errors.md)).

### Changed

- **Breaking:** `required` reports one error per keyword, with
  `params.missing` listing every absent name, in place of one error per
  name with `missingProperty`. The message reads `missing required property
"a"` or `missing required properties "a", "c"`.
- **Breaking:** `dependentRequired` and the array members of draft-07
  `dependencies` report one error, with `params.missing` a record from each
  present property to its absent requirements, in place of one error per
  missing name with `{property, missingProperty}`.
- **Breaking:** `uniqueItems` reports `params.duplicates`, the groups of
  equal items as lists of indexes, in place of the first duplicate pair
  `[i, j]`.
- **Breaking:** `type` reports `params.expected` as an array always (it was
  the schema's own value, a string or an array), with `actual` (`integer`
  for a mathematical integer) and `value` added. `enum`, `const`,
  `multipleOf`, the numeric bounds, `minLength`/`maxLength`, `pattern`, and
  asserting `format` add `value`; the string and size bounds add `length`
  or `count`; `contains` adds `matched`, the indexes of the matching items.
- **Breaking:** an applicator no longer applies a `false` subschema.
  `additionalProperties`, `unevaluatedProperties`, `properties`,
  `patternProperties`, `propertyNames`, `dependentSchemas`, `dependencies`,
  `items`, `additionalItems`, `unevaluatedItems`, `prefixItems`, and
  `allOf` report one error at their own location, with their own `keyword`
  and params naming the rejected keys, names, or index ranges, in place of
  one `schema is false` unit per child. No trace node exists for the child.
  `contains: false` reports only the `contains` error. A root `false`, a
  `$ref` to `false`, `then`/`else: false`, and `anyOf`/`oneOf` branches
  still report `schema is false`.
- **Breaking:** `ErrorRecord.message` is empty when the record carries a
  `describe` thunk; the realized text is what a unit's `error` holds.
- Every built-in message names what was wrong with what: `expected string,
got 3 (integer)`, `must be >= 5, got 3`, `must be one of [1, 2, 3], got
4`, `matched 2 branches (0, 2), expected exactly 1 of 3`. A value shows as
  compact JSON cut at 64 code points; a list of names shows at most 10
  then `and N more`; a list of indexes collapses runs of three or more.
  Both tiers produce the same text and params. Params carry the full value.
- ajv-compat output is unchanged. The adapter fans the engine's summaries
  back out into AJV's per-property and per-index errors, and
  `propertyNames: false` no longer needs the evaluation trace.

### Added

- `KeywordContext.report(describe)`, beside `error(message, params)`: a
  keyword whose message carries instance data returns a `Description` built
  from lowering IR, which the record realizes against the instance only if
  the error is rendered, so a verdict-only evaluation or a dropped error
  costs nothing.
- `Description`, `realize`, `preview`, `PREVIEW_LIMIT`, `messageHelpers`,
  and `helperTable`, exported from `@json-schema-engine/core`; and the
  optional `ErrorRecord.describe`.
- `LowerHelper` is now `LowerValueHelper | LowerMessageHelper`, the latter
  the 13 message-formatting helpers (`preview`, `apparentType`,
  `typedPreview`, `indexRanges`, `ranges`, `nameList`, `labeledNames`,
  `countedIndexes`, `indexGroups`, `duplicateGroups`, `missingNames`,
  `missingDependencies`, `dependencyList`).
- Lowering IR statements `rejectScope` and `reject`, with
  `lowerIR.rejectScope`, `lowerIR.reject`, and `lowerIR.failDescribed`.

### Fixed

- ajv-compat now matches AJV on `uniqueItems.json#0` and
  `propertyNames.json#3`, two cases that were suite mismatches.
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
