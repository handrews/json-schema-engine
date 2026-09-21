# 0004: Static resolution of `$dynamicRef` in compiled artifacts

**Status:** accepted 2026-09-21 (owner decision, on the evidence in
[the investigation](../investigations/dynamic-ref-static-resolution.md)).

## Context

The compiled tier classified every schema object holding `$dynamicRef` as an
interpreted island, together with its whole subtree, because the reference
resolves against the dynamic scope of the evaluation (D8). On the OpenAPI
3.1 schema that cost 20 of the compiled tier's 22 µs per document: thirteen
trampoline entries, each building a fresh interpreter state, applying two
schema objects through the interpreter's generic path, and parsing two URLs,
to evaluate a target that is a single `type` check. The same schema with its
references made static ran in 2 µs. Backlog item E4 ("island re-entry")
had asked for measured benefit before any change to the trampoline.

## Decision

The planner resolves a `$dynamicRef` site at plan time when every path that
can reach it yields the same target, and compiles that target as an
ordinary static edge, exactly like `$ref`. Sites that are not provably
stable island as before.

- **Why the resolution is decidable.** `resolveDynamic` is a pure function
  of the registry snapshot, the reference, the lexical base, and the dynamic
  scope. Its scope-independent steps (the lexical target must exist; a
  fragment-free or pointer reference and a target without a bookending
  `$dynamicAnchor` behave like `$ref`) now live on the registry
  (`SchemaRegistry.dynamicReference`) and are shared by both tiers. For the
  scope walk, the trampoline being one-way means a compiled site is reached
  only through compiled ancestors, so the dynamic scope at the site is the
  chain of unit base URIs from the artifact root, which the planner knows.
- **The analysis.** Per anchor name, a forward dataflow over the unit graph
  computes for each unit the set of resources that can be the outermost
  declarer of that anchor when evaluation arrives at it: seeded at the
  artifact root, propagated along every planned edge (in-place or child,
  conditional or not), joined by union. A site whose set maps to one target
  is stable; two or more targets is unstable. The graph over-approximates
  real paths, so the analysis errs only toward islanding. Because a
  resolved site adds its target's subtree, and so new paths, the plan is
  built in rounds: each round rebuilds from scratch under the current site
  decisions and re-settles; decisions move only unknown → resolved →
  unstable, so the loop is bounded by the number of sites.
- **Facts, not keyword names (D1).** Reference applications carry a
  `resolution` fact (`"dynamic"` for `$dynamicRef`, `"recursive"` for
  `$recursiveRef`); `$dynamicRef` lowers exactly like `$ref`, the plan
  holding the target. A dynamic-scope keyword whose applications carry no
  `resolution` the planner can discharge still islands.
- **`$recursiveRef` is excluded.** 2019-09's degenerate form keeps
  islanding; the same analysis with `hasRecursiveRoot` in place of
  `dynamicAnchor` is a follow-up, not part of this decision.
- **Diagnostics.** `explainCompilation` lists every resolved site
  (`resolvedDynamicSites`: unit, keyword, reference, target, winning
  resource) and the plan census counts them, so a regression back to
  islands is as loud as any other classification change.

## Alternatives

- **Island re-entry** (E4 as originally framed): let interpreted code call
  back into compiled units. Rejected: it breaks the one-way trampoline that
  the channel analysis relies on (DESIGN.md §7) and still pays the
  per-entry cost for the common case, which this decision removes.
- **Registry-wide rules only** (fragment class, bookending, root declares
  the anchor, unique declarer in the registry): sound and simpler, but
  scope-blind. It covers the OpenAPI schema and the metaschema as root, yet
  leaves a `$ref` into the 2020-12 metaschema from a non-declaring root
  with its ~19 `#meta` islands, and about 14 of the suite's 20 groups. The
  dataflow subsumes it and covers 19 of 20 groups plus that pattern.
- **Per-site runtime dispatch** for unstable sites (compile one target per
  possible resolution and select by the first scope entry that declares
  the anchor): deferred until a real schema needs it; the single unstable
  suite group is the only known case.
- **Interpreter-side tuning alone** (memoized URI resolution, cheaper
  fragment state): measured at 14% on the same corpus; worth doing later,
  but it leaves the trampoline in the hot path.

## Evidence

- Investigation measurements: compiled 22.2 µs as was, 2.0 µs with the
  references made static, 19.1 µs with resolution memoized; one island
  entry 2.22 µs versus 0.018 µs for the static reference.
- After the change (`bench/harness.ts`, `oas-document`): compiled flag
  45 µs → 4.0 µs per document on the hot row, 22 µs → 4.0 µs on the valid
  instance; the harness's document-equality oracle passes on every row.
- Plan census (2020-12): dynamic islands 59 → 1 (the suite's "multiple
  dynamic paths to the $dynamicRef keyword"), 58 sites resolved; 2019-09,
  draft-07, and draft-06 unchanged. The CSP check emits 350 standalone
  modules over 1197 verdicts (was 332 over 1164).
- `packages/compiler/test/dynamic-resolution.test.ts`: over every
  `dynamicRef.json` group and `unevaluated*`'s dynamic cases, the target
  the planner chose for each resolved site equals the target the interpreter
  applied, observed through its trace; a fixture corpus of stable and
  unstable shapes agrees with the interpreter on every output surface.
- Every official-suite leg, the differentials, the codegen goldens, and
  the fuzz legs (flag, list, annotations, evaluator, and the four other
  dialects) are green with zero divergence; a full 200k-case flag run was
  also clean.

## Consequences

- D8's compiler clause is amended; DESIGN.md §7's one-way invariant is
  untouched (a resolved target is a static edge, not code inside an island).
- Schemas that previously islanded on `$dynamicRef` now emit standalone
  modules and pass the CSP check; `emitStandalone` refuses only genuinely
  unstable sites.
- The codegen golden set carries both an unstable-site island and a
  statically resolved case; the island-pinned tests moved to unstable
  fixtures so the trampoline stays covered.
- The interpreter tier is unchanged in behavior and speed; its generic
  per-application cost still bounds whatever islands remain.

## Compatibility

No verdict, error, annotation, or trace output changes: every parity gate
is at zero divergence. Public additions only: `SubschemaApplication.resolution`,
`SchemaRegistry.dynamicReference`, `PlannedApplication.dynamic`,
`CompilationExplanation.resolvedDynamicSites`, and the census field.

## Follow-up work

- `$recursiveRef` through the same analysis (2019-09 metaschemas and
  `recursiveRef.json` are the remaining 49 dynamic islands in that census).
- The interpreter-side items in the investigation note: memoized reference
  resolution, elided scope-array copies, cached cycle keys, per-node
  present-keyword lists, memoized `child`, fragment state reuse.
  Delivered 2026-09-21 (see the note's "Delivered" section): interpreter
  flag rows 3.6–5.9× faster than at this decision, compiled rows unchanged.
- Per-site dispatch for unstable sites if a real schema needs it.
- Re-run `bench/external` against ata-validator and json-schema-library
  and refresh the comparison document's `oas-document` rows.
