# 0005: Atomic, duplicate-checked registration with explicit unregister

**Status:** accepted 2026-09-23 (owner decision, on the probes recorded as
backlog items D9, D10, and D12 and on the Python engine's P12/P13 work,
which found the same defects there first).

## Context

`SchemaRegistry.register` wrote every index as the walk went. A throw
part-way — a non-schema value, a regex screen, a keyword's `analyze()`, a
native stack overflow — left the document half-indexed and still
evaluable, with partial `produces`/`consumes` contributions feeding the
elision predicate, so the failure surfaced later as a wrong answer rather
than at once as an error. `InvalidSchemaError`'s documentation said so and
told the caller to re-register or discard the engine.

Identifiers were last-write-wins. Two `$id`s naming one resource resolved
`$ref` to whichever the walk reached last; `$anchor: "n"` on one object
and `$dynamicAnchor: "n"` on another left `$ref` and `$dynamicRef` on `#n`
reaching different schemas. Worst, an embedded `{"$id": "#a"}` under
2020-12 resolved to the enclosing resource and `documents.set` replaced
the root document with the subschema: the root's own keywords vanished
without a sound.

`validateSchemas` ran after registration, so a document that failed its
metaschema stayed registered; documents fetched by loaders were never
checked at all. `loadPending` drained the whole pending set before
fetching, so a loader that threw on one URI lost every URI after it,
permanently.

Re-registering a URI with different content silently replaced the
document (its embedded resources and anchors lingering), and six tests,
an executed guide snippet, and ajv-compat relied on that.

## Decision

- **Registration stages, then commits.** The walk writes into a
  per-registration staging object (resources with their anchors, the
  union contributions, the pending references); a single throw-free,
  non-recursive `commit()` applies it. A throw anywhere in the walk leaves
  every live index untouched. Copy-on-write for snapshots (`mutable()`)
  and the memo reset happen only on commit, so a failed walk never
  un-shares a snapshot's maps. Anchors are committed after documents so
  that `intern()` hands them the interned ref. The produced/consumed
  unions are never evicted: they only widen retention, and a stale entry
  is harmless.
- **One resource, one schema; one anchor name, one object.** Two schema
  objects claiming one resource URI — twice in one document, or against a
  resource a registered document holds with different content — throw
  `DuplicateResourceError`; an equal copy (`jsonEqual`) is not a duplicate
  and takes ownership of the resource. Two objects in one resource
  claiming one anchor name (plain, dynamic, or the legacy plain-fragment
  `$id`, in any combination) throw `DuplicateAnchorError`; one object
  carrying both keywords under one name is fine. A retrieval URI that
  already names or aliases another resource, or an `$id` equal to an
  existing retrieval alias, is refused the same way: the alias lookup
  would otherwise make one of them unreachable. Re-registering an equal
  document is allowed and walked again, so its references are queued
  again (ajv-compat's dangling-`$ref` check depends on that).
- **Replacement is explicit.** `Engine.unregisterSchema(uri)` /
  `SchemaRegistry.unregister(uri)` removes a document root and everything
  its registration claimed — embedded resources, anchors, dynamic anchors,
  recursive roots, dialect and location entries, the source-range lookup,
  every retrieval alias — while a snapshot taken earlier keeps it all. A
  resource an equal copy in another document has since taken over stays
  with that document. Unregister then register is how a document changes.
- **A base identifier must name a resource.** An extractor's `baseId`
  that is empty, `#`, or carries a non-empty fragment throws
  `InvalidIdentifierError`, at the root and embedded alike; an empty
  trailing fragment (`"sub#"`, the bundled legacy metaschemas' own
  spelling) is accepted. The check reads the raw text, so a malformed
  escape cannot surface as a `URIError` first. Legacy and draft-04
  extractors already turn `#name` into an anchor, so under them only the
  empty form reaches the check.
- **`validateSchemas` runs before the walk, on every path.**
  `registerSchema`, `loadSchema`, `load`, and every document a loader
  fetches for a reference are checked against the raw document before
  `register`; a failing document is never registered. A metaschema
  registered before its own dialect exists is not checked against itself,
  as the bundled metaschemas never were. `SchemaRegistry.identify` and
  `dialectUriOf` compute the base URI and dialect a registration would
  use without registering, and `Engine.ensureDialectFor` uses the latter
  in place of its own copy of that logic.
- **The load queue is taken one entry at a time.**
  `SchemaRegistry.nextUnresolved()` pops one pending, still-unregistered
  resource; `loadPending` loops on it. A throw leaves the unattempted
  remainder for the next drain and does not requeue the one that failed.
- **Registration has the evaluation tier's overflow backstop.** A native
  `RangeError` from the walk is rethrown as `MaxDepthExceededError`
  (`isStackOverflow`, shared with `engine.ts`); nothing has been written
  either way.

## Alternatives

- **An undo journal**, as the Python engine's `_Registration`: record
  every index write and undo on any throw. Same cost, but the live
  indexes are half-written during the walk, the journal must be
  save/restored for a re-entrant registration, and — decisive here —
  copy-on-write must un-share a snapshot's maps before a walk that may
  fail. Staging is not a language-idiom outcome; it is recorded for the
  Python engine as a behavior-neutral refactor option.
- **Implicit root replacement** (the previous behavior for root URIs,
  with the new duplicate rules for embedded ones). Rejected by the owner:
  the default should error on a duplicate unless the caller says to
  override or removes and re-adds, matching the Python engine.
- **Last-wins across documents** (errors only within one registration).
  Rejected: it keeps the silent shadowing that the whole change exists
  to remove.
- **Validating only the root target**, as before. Rejected: the guide
  already claimed every loaded schema was checked, and a loader-fetched
  document is no more trustworthy than the one passed in.

## Evidence

- Probes for every defect, recorded in the backlog rows D9, D10, D12 and
  re-run after the change: each now throws the typed error or keeps state.
- The official suite's exact-count pins, every fixture, the bundled
  metaschemas, and the bench corpora declare no in-scope duplicate
  identifier and no fragment-only embedded `$id` under 2020-12/2019-09;
  the CSP check's unregisterable-group count is unchanged at two.
- 19,803 tests green, including `registry-integrity.test.ts` (atomicity
  per failure kind, duplicates, unregister, fragment-only identifiers
  under three modern dialects and two legacy ones) and
  `engine-loading.test.ts` (validate-first on every path, queue
  survival).

## Consequences

- DESIGN.md rows D7 (load queue, validate-first), D18 (identifiers,
  duplicates, explicit unregister), and D19 (all-or-nothing) are amended
  in place; backlog rows D9, D10, D12 are delivered and D15 loses its
  stale-`getRange` item, which unregister discharges.
- The compiler keeps building plans on the live registry and binding
  artifacts to snapshots; nothing it reads changed shape except the
  two-level anchor maps, which it never touched directly.
- D11 (per-resource dialects) can now assemble a dialect an embedded
  resource demands and retry the registration from a clean state.

## Compatibility

- **Breaking:** registering a different document under a URI that is
  already registered throws `DuplicateResourceError`; callers that
  replaced schemas by re-registering call `unregisterSchema` first.
  Duplicate `$id`s and anchors within a document, and a fragment-only or
  empty `$id`, now throw where they used to register.
- `validateSchemas` now also checks loader-fetched documents and runs
  before registration; a document that fails is no longer registered.
- New exports: `DuplicateResourceError`, `DuplicateAnchorError`,
  `InvalidIdentifierError`, `RootIdentity`, `isStackOverflow`;
  `Engine.unregisterSchema`; `SchemaRegistry.unregister`, `identify`,
  `dialectUriOf`, `nextUnresolved`. `takeUnresolved` is unchanged.
- ajv-compat maps `DuplicateResourceError` from `compile()` onto its
  "already exists" error; `getSchema` and `addMetaSchema` re-register
  equal objects and are unaffected.

## Follow-up work

- D11 per-resource dialects, then D8, D13, and D14.
- Port `unregister` to the Python engine (its DESIGN.md open item 14) and
  record staging there as a refactor option.
- The Python engine's open item 10 lists the alias collisions this
  decision refuses; its rules should converge on these.
