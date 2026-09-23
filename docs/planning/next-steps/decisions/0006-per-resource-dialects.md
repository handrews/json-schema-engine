# 0006: Per-resource dialects: `$schema` governs the resource it roots

**Status:** accepted 2026-09-23 (owner decisions on the probe recorded as
backlog item D11, on the Python engine's P14, and on three questions the
design raised: per-resource validation, `$ref` siblings at registration,
and self-describing metaschemas).

## Context

2020-12 core §8.1.1 says `$schema` governs the schema resource it roots. The
registration walk threaded the document root's dialect through every
embedded `$id` resource instead, so an embedded resource declaring its own
`$schema` was walked, indexed, and evaluated under the wrong one. Measured:
a valid draft-07 resource embedded in a 2020-12 document threw
`InvalidSchemaError` for array-form `items`; the mirror case accepted
`$id: "#foo"` as an anchor inside a 2020-12 resource under a draft-07
root; and a pointer crossing such a boundary used the wrong identifier
syntax. Everything downstream — evaluation, the compiler, the test-kit
oracle — already looked dialects up by the unit's own base URI, so the walk
was the only tier disagreeing, with them and with itself.

Two adjacent defects shared the fix. `validateSchemas` evaluated the whole
document against the root dialect's metaschema, and the 2020-12 metaschema
actively rejects a valid embedded draft-07 resource (array `items` under
`$dynamicRef: #meta`), so a mixed-dialect document could never validate.
And a custom metaschema naming itself as `$schema` — the shape every
standard metaschema has — tripped the assembly cycle guard, because
loading it asked for its own dialect before that dialect could exist.

Mixed-dialect documents are the prerequisite for backlog D5: OAS 3.0-era
schemas embedded in OpenAPI 3.1 documents, and Arazzo.

## Decision

- **The boundary is decided from the outside, the contents from the
  inside.** Whether an embedded object starts a resource is the enclosing
  dialect's identifier extractor's call (`baseId`); once it does, the
  resource's own `$schema`, resolved against the new base, picks the
  dialect that governs the anchors minted into it (re-read with the inner
  extractor, the parent's `baseId` kept), its keyword table,
  `refIgnoresSiblings`, and the recursion below. A resource without
  `$schema` inherits; a `$schema` naming the dialect already in force is a
  no-op (the 2019-09 suite's nested shape). `documentDialects` records the
  result per resource, which is what every downstream lookup already read.
- **A `$schema` where no resource starts is ignored, not refused.** The
  spec forbids the placement, but refusing it is strict-mode hygiene (D14),
  and `{"$schema": X, "not": {"$schema": X}}` is how Bowtie spells "allows
  nothing" for every dialect it tests.
- **An unknown embedded dialect is named, and the async paths assemble
  it.** `UnknownDialectError` carries `dialectUri`. Sync `registerSchema`
  can only refuse. `loadSchema` and the loader path catch the error,
  assemble that dialect from its metaschema, and retry the registration —
  safe because registration is all-or-nothing (ADR 0005) — at most once
  per distinct URI, so an assembly that returns without registering the
  URI it was asked for cannot spin.
- **Pointer navigation switches syntax at each boundary** through a
  lookup that falls back to the dialect in force for a base the walk never
  indexed (an `$id` inside an unknown keyword; a draft-07 `$ref` with an
  `$id` sibling), so nothing throws where nothing threw before. `child()`
  tags each memoized hop with the extractor of the parent position's own
  resource — the one that decides whether its children start a resource —
  which is finer than a dialect-generation counter and needs no separate
  invalidation.
- **`validateSchemas` runs per resource, inside registration.** `register`
  takes a check callback that runs for every staged resource after the walk
  and before the commit, with the roots of the resource's directly
  embedded sub-resources masked to `{}` (accepted in every schema position
  of every bundled metaschema; draft-04's types a schema as `"object"`, so
  `true` would not do). The engine's check evaluates each resource against
  its own dialect's metaschema; a resource whose metaschema is not
  registered is "cannot check", which also exempts a metaschema registered
  before its own dialect exists. A throw registers nothing.
- **Under `refIgnoresSiblings`, a `$ref`'s siblings contribute nothing at
  registration**, as they contribute nothing at evaluation (draft-07 §8.3):
  no identifier, subschema, reference, or pattern inside them is seen;
  pointer references into them still resolve. The cost, accepted with
  eyes open: in the bundling shape where a root `$ref` points into a
  sibling `definitions`, that `definitions` is not walked, so an `$id` or
  plain-fragment anchor inside it is not indexed, a remote reference inside
  it is not queued for `loadSchema`, and its patterns are not screened.
- **Self-describing metaschemas assemble before they register.** When a
  fetched metaschema's `$schema` is its own URI, the dialect is assembled
  from the document's `$vocabulary` first, so the document then registers
  under an existing dialect. An ordinary metaschema keeps the previous
  order — its own dialect first, then register, then assemble — so a
  registration failure leaves nothing assembled; only the self-describing
  shape can leave a dialect assembled with no metaschema document behind
  it, which is "cannot check" for documents under it. A two-metaschema
  cycle still throws "metaschema cycle", with nothing assembled.
- **Recorded limit:** identifier keywords do not cross dialects. A 2020-12
  parent cannot see a draft-04 `id` boundary, because the boundary comes
  from the parent's extractor; the reverse works through `id`. Same as the
  Python engine's P14.

## Alternatives

- **Refusing a misplaced `$schema`.** Correct per the spec, but strict-mode
  hygiene that D14 keeps opt-in, and it would reject Bowtie's smoke
  schemas.
- **Root-only validation, documented as a limit** (the Python engine's
  open item 7). Rejected: a mixed-dialect document that can never validate
  makes the feature incoherent, and the staged walk already holds every
  resource with its dialect, which dissolves the ordering problem that
  item cites.
- **Walking `$ref` siblings at registration** (the previous behavior), or
  an indexing-only middle ground (index and queue, but do not screen).
  Rejected by the owner in favor of one rule shared with evaluation and
  the Python engine; the divergence would otherwise have stayed in D15.
- **Leaving self-describing metaschemas to a later item.** Rejected: the
  embedded-dialect assembly path is the same path, and self-describing is
  the normal shape of a metaschema.

## Evidence

- Probes for the walk defect (backlog D11) and for validation and the
  cycle guard, re-run after the change: the mixed document now evaluates
  positionally; the raw root still fails the 2020-12 metaschema when
  evaluated directly, which is the negative control for masking.
- A scan of the official suite and remotes: one nested `$schema`
  (2019-09 `ref.json`, same dialect as its root, the no-op case), no
  embedded resource declaring a different dialect, no identifier inside a
  `$ref` sibling under draft-07/06/04. The suite's exact-count pins and the
  CSP check's unregisterable count are unchanged.
- 19,836 tests green, including `per-resource-dialects.test.ts` in core
  (walk, navigation, assembly, validation, siblings) and in the compiler
  (artifact parity across both dialects), and the memo-tagging case in
  `registry-memo.test.ts`.

## Consequences

- DESIGN.md rows D7 (validation inside registration; assembly with retry;
  self-describing metaschemas) and D18 (dialect rebinding at a boundary;
  navigation; sibling skip) are amended in place. Backlog D11 is delivered;
  D15 loses its validation item and records the sibling ruling as
  converged.
- Backlog D5 (native OAS dialect support) can now rely on per-resource
  mixed dialects in one document.
- The Python engine's open item 7 has an answer to port: the check hook
  and `{}` masking, which its staged-registration option (its item 12)
  would make direct.

## Compatibility

- **Behavior change:** an embedded resource declaring another `$schema` is
  now governed by it; documents that registered only because the wrong
  dialect happened to accept them may now throw, and documents that threw
  now register.
- **Behavior change:** under draft-07/06/04, siblings of `$ref` are no
  longer walked at registration (see the bundling-shape cost above).
- **Behavior change:** `validateSchemas` checks each resource under its own
  metaschema; the `SchemaValidationError` message names the failing
  resource rather than always the document root.
- Self-describing custom metaschemas load through `loadSchema`/`load`
  where they used to throw "metaschema cycle".
- New: `UnknownDialectError.dialectUri`; `SchemaRegistry.register`'s
  optional `check` parameter with the `ResourceCheck` and
  `StagedResourceView` types.

## Follow-up work

- D8, D13, and D14 together: what an error or output unit says, and how it
  round-trips.
- Port to the Python engine: the check hook for its open item 7, and the
  convergence note on `$ref` siblings.
- D5, now unblocked on mixed dialects.
