# 0007: Informative errors: one description per keyword, both tiers

**Status:** accepted 2026-10-06 (the error wording and params catalog, the
single `Description` that both tiers realize, and the rule that an
applicator reports a `false` subschema once instead of applying it).

## Context

An error said which rule failed and little about what was wrong with
what: a type failure did not show the instance, `schema is false` appeared
once per rejected child, and a `required` failure was one unit per missing
name. Tooling that wanted the offending value or the full set of missing
names had to rebuild them from the instance and the schema.

Each tier also spelled every message itself. The interpreter built message
strings in `ctx.error`; the compiler's lowerings emitted their own. The
differential gate compared the text, so a wording change was two edits that
had to agree, and the tiers had drifted.

The interpreter built its strings eagerly. A verdict-only evaluation and a
branch dropped by a passing `anyOf` paid to render text that was never
shown, and a message that quotes the instance costs in proportion to the
instance.

An applicator holding a `false` subschema applied it like any other, so a
`properties` rejecting three names produced three `schema is false` units,
each with a trace node, none naming the keyword that forbade the property.

## Decision

- **A message names what was wrong with what.** `type` reports `expected
string, got 3 (integer)`; `enum` and `const` show the allowed values and
  the instance; bounds show the limit and the value; a string length shows
  the string and its length. `params` carry the same facts in full: `value`
  on a value-level failure, `actual` on `type`, `count` or `length` where a
  measure failed. `type.expected` is always an array.
- **Values are shown compactly in text and in full in params.** A value
  renders as compact JSON cut at 64 code points with `…`; a list of names
  shows at most 10 then `and N more`; a list of indexes collapses runs of
  three or more. `params` never truncate.
- **Each keyword reports once.** `required` reports one error with
  `missing: string[]`; `dependentRequired` and the draft-07 array form of
  `dependencies` report one error with `missing` as a record from each
  present property to its absent requirements; `uniqueItems` reports
  `duplicates`, the groups of equal items by index; `contains` reports
  `count`, `matched`, and the bounds that were set.
- **An applicator names what a `false` subschema rejected.**
  `additionalProperties`, `unevaluatedProperties`, `properties`,
  `patternProperties`, `propertyNames`, `dependentSchemas`, `dependencies`,
  `items`, `additionalItems`, `unevaluatedItems`, `prefixItems`, and `allOf`
  do not apply a `false` subschema. They report one error at their own
  location, with their own `keyword`, and the params name the keys, names,
  or index ranges rejected (`properties`, `patterns`, `start`, `failed`).
  `contains: false` reports only the `contains` error. A root `false`, a
  `$ref` to `false`, `then`/`else: false`, and `anyOf`/`oneOf` branches
  that are `false` still apply the schema and report `schema is false` with
  no keyword and params `{}`; there the failing unit is the schema itself.
- **One description per keyword, realized by both tiers.** A keyword
  builds a `Description` (`{ message, params }`, in lowering IR, in
  `core/messages.ts`): the message is a list of strings and expressions, the
  params are expressions, and runtime values are `lowerIR.constant(...)`
  or `lowerIR.instance`. The compiler's `lower` emits that description as a
  `fail`; the interpreter hands it to the new `KeywordContext.report` and
  the record keeps the thunk. The text and params are realized against the
  instance only when an error is rendered, so a verdict-only evaluation and
  a dropped error cost nothing, and the two tiers cannot word an error
  differently because there is one wording.
- **Message formatting is a closed helper set.** `LowerHelper` splits into
  `LowerValueHelper` (conditions and measures) and `LowerMessageHelper`
  (13 formatting helpers: `preview`, `apparentType`, `typedPreview`,
  `indexRanges`, `ranges`, `nameList`, `labeledNames`, `countedIndexes`,
  `indexGroups`, `duplicateGroups`, `missingNames`, `missingDependencies`,
  `dependencyList`). A message helper never gates a condition, so a flag
  artifact binds none and a standalone preamble carries none. The IR gains
  `rejectScope` and `reject` statements to collect a rejected set and
  report it once.
- **The list stays minimal.** A required-family keyword reports once per
  keyword however many names are missing, and an applicator summarizes
  rather than repeating a unit per child.

## Alternatives

- **Keeping one message spelled per tier.** Rejected: the tiers drifted,
  and each wording change had to be made twice and kept in agreement by the
  differential gate after the fact.
- **Eager message building in the interpreter.** Rejected: flag mode and
  dropped errors paid for text never shown, and a message that quotes the
  instance makes that cost grow with the instance. Deferring through the
  `describe` thunk keeps the interpreter's unrendered path free.
- **Keeping per-child `schema is false` units.** Rejected: the useful fact
  is the applicator's (which keyword forbade which names), and the child
  units repeated one non-fact per name while crowding the trace.
- **Keeping one unit per missing name for `required`.** Rejected: the
  names are one fact about one keyword; a list in `missing` carries them
  without multiplying units and traces. An adapter that needs one error per
  name fans the list out (ajv-compat does).
- **Putting the full value in the message.** Rejected: an instance
  property can be arbitrarily large, and a message is for people. The full
  value stays in `params`.

## Evidence

- The list differentials and the `FUZZ_LIST` referee compare both tiers'
  error text and params; both pass, so the single description is realized
  identically by the interpreter and by compiled artifacts.
- The codegen goldens are re-pinned: emitted source differs only where a
  lowering now emits a description or a rejection.
- The ajv-compat oracle fixtures are unchanged: AJV-shaped output is
  byte-identical, with the adapter fanning each summary back out to AJV's
  per-name and per-index errors. Two suite mismatches against AJV disappear
  (`uniqueItems.json#0`, `propertyNames.json#3`).
- `packages/core/test/error-params.test.ts` pins the catalog.

## Consequences

- DESIGN.md D13 is amended in place; the output-formats guide documents the
  catalog, and the custom-keywords guide documents `ctx.report`.
- A custom keyword whose message quotes the instance uses `ctx.report`
  with the same helpers the built-ins use, and gets the deferred rendering
  and both-tier wording; `ctx.error` stays for constant messages.
- `ErrorRecord.message` is empty when `describe` is set; the realized text
  is what a unit's `error` carries.
- A new keyword's message is written once, in IR, and its compiled form
  follows from it.

## Compatibility

- **Behavior change (breaking, params):** `required` reports one unit with
  `missing: string[]` in place of one unit per name with `missingProperty`.
  `dependentRequired` and `dependencies` report `missing` as a record in
  place of `{property, missingProperty}` per name. `uniqueItems` reports
  `duplicates` groups in place of one `[i, j]` pair. `type.expected` is
  always an array. `type`, `enum`, `const`, and the bounds carry `value`
  (and `actual`, `length`, `count`).
- **Behavior change (breaking, units):** a `false` subschema an applicator
  holds is reported once by the applicator, and no trace node exists for
  the child.
- **Behavior change (messages):** every built-in message is reworded. Text
  is not a stable interface; params are.
- **New:** `KeywordContext.report`, `Description`, `realize`, `preview`,
  `PREVIEW_LIMIT`, `messageHelpers`, `helperTable`, `LowerValueHelper`,
  `LowerMessageHelper`, `lowerIR.rejectScope`, `lowerIR.reject`,
  `lowerIR.failDescribed`, and the optional `ErrorRecord.describe`.
- ajv-compat output is unchanged.

## Follow-up work

- D14: whether strict mode should flag a `false` subschema in an
  applicator position, now that the applicator names what it rejects.
- Message localization, if ever wanted, builds on the description: the
  message list is already separate from its values.
