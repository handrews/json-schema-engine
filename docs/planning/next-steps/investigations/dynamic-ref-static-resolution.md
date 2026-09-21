# Investigation: static resolution of `$dynamicRef` in compiled artifacts

**Status:** delivered 2026-09-21 as
[ADR 0004](../decisions/0004-static-dynamic-ref-resolution.md). The
implemented analysis is a per-root dataflow over the compiled unit graph
(every path that can reach a site must agree on the target), which covers
the "resolution-stable site" rule below and more: 19 of the 20 `$dynamicRef`
groups in the official suite, both `$ref`-to-metaschema groups, and the
OpenAPI 3.1 schema compile with no interpreted units. Measured on
`oas-document`: compiled flag 45 → 4.0 µs per document (hot row), against
the 2.0 µs ceiling below.

**Original recommendation:** proceed. This is the measured benefit that
backlog item [E4 "Island re-entry"](../backlog-inventory.md) asks for, and
the proposed design does not require island re-entry at all: it removes the
island for the common case instead.

**Release relationship:** off the release path
([ADR 0001](../decisions/0001-first-release-scope.md)). No semantic change;
the compiled tier keeps its parity obligations to the interpreter.

## Question

Every schema object that carries `$dynamicRef` becomes an interpreted unit in
a compiled artifact, and its whole subtree with it. How much does that cost
on schemas that use `$dynamicRef` the way the 2020-12 metaschema and OpenAPI
3.1 do, and can the compiled tier resolve those references itself?

## Measurements (2026-09-21, Node v24.13.0, Apple M4 Pro, `ee46b16`)

Corpus: `oas-document` from `bench/corpora` (the official OpenAPI 3.1
schema against a 2.5 KB OpenAPI document). The schema has four
`$dynamicRef: "#meta"` sites and one `$dynamicAnchor: "meta"` on
`/$defs/schema`, whose body is `{ type: ["object", "boolean"] }`.

| Measurement                                                                 | µs per evaluation |
| --------------------------------------------------------------------------- | ----------------: |
| Compiled artifact, flag mode, as is                                         |              22.2 |
| Same schema with `$dynamicRef` → `$ref` and `$dynamicAnchor` → `$anchor`    |               2.0 |
| ata-validator 1.27.1 on the unmodified schema (its closure interpreter)     |              11.4 |
| JSE interpreter on the unmodified schema                                    |               527 |
| Compiled, with registry URI resolution memoized (experiment)                |              19.1 |
| Compiled, after ADR 0004 (sites resolved at plan time; hot row, 2026-09-21) |               4.0 |

The rewrite changes no verdict on this corpus: nothing rebinds `meta`, so the
dynamic resolution and the static one coincide. It is the ceiling for a
compiled tier that resolves the reference at compile time.

Per document, the artifact makes 13 trampoline entries (one per
`components.schemas` member and one per `schema` keyword in parameters,
headers, and media types), each to evaluate that one `type` check.

The fixed cost of one entry, isolated on a one-property schema:

| Schema                                | Compiled | Interpreter |
| ------------------------------------- | -------: | ----------: |
| `properties.a: { $ref: "#m" }`        | 0.018 µs |     2.83 µs |
| `properties.a: { $dynamicRef: "#m" }` |  2.22 µs |     3.43 µs |

One island entry costs about as much as a whole interpreter evaluation of the
schema, and 120× the compiled static reference.

CPU profile of the compiled artifact on `oas-document` (self time): the
interpreter's `applySchemaAtDepth` 20%, `new URL` parsing 16%, cycle-detection
`exit` 11% and `enter` 7%, `dynamicAnchor` 7%, `resolveRef` 5%,
`splitFragment` 4%. About 80% of all samples are inside `evaluateFragment`.

## Where the cost comes from

The trampoline is one-way and the island is the whole schema object holding
`$dynamicRef` (`packages/compiler/src/plan.ts`, the `dynamicScopeSensitive`
check; `COMPILED-CONSUMERS.md` §"interpreted units"). Per entry:

1. Every compiled ancestor that can reach an island prepends its resource URI
   to the scope array with `s = [...s, uri]`, a fresh copy per unit entry
   (`packages/compiler/src/serialize/index.ts`, `reachesInterpreted`). For a
   single-resource schema every copy pushes the same URI.
2. `Runtime.frag` allocates `FragmentOptions` and a root cursor
   (`packages/compiler/src/runtime.ts`).
3. `evaluateFragment` builds a fresh `EvalState` (frames, errors, dynamic
   scope, a `Map<Cursor, Set<string>>` for cycle detection) and spread-pushes
   the caller's scope (`packages/core/src/engine.ts`).
4. The island object is applied by the interpreter: `dialectFor`, an
   `enter`/`exit` pair that each build the string `baseUri#pointer`, a frame
   push and merge, and a scan of every keyword in the dialect (about 58
   `Object.hasOwn` probes) plus an `Object.keys` pass for unknown keywords.
5. `$dynamicRef` resolves through `resolveDynamic`: `resolveRef` parses
   `new URL(ref, base)` and decodes the fragment, then `resolveDynamic` parses
   the same URL a second time, then one `dynamicAnchor` lookup per scope
   entry. Nothing is memoized (`packages/core/src/registry.ts`,
   `packages/core/src/uri.ts`).
6. The target is applied by the interpreter: step 4 again, then the `type`
   check.
7. The seven-field result object and its arrays are discarded; flag mode
   keeps only `valid`.

The interpreter's per-application scaffolding is the same reason the
interpreter is 6–7× slower than json-schema-library's closure tree on small
payloads and 2–5× slower than hyperjump on every corpus: on `api-payload`,
`applySchemaAtDepth` (35%), `exit` and `enter` (25%), and eager
`escapeSegment` path-node construction (11%) account for most samples, and
keyword semantics for a few percent.

## Proposal

**Resolve `$dynamicRef` at plan time where the resolution is stable, and
compile the target as an ordinary static unit under the extended scope.**

Two existing facts make this sound:

- The artifact binds to a registry snapshot (E1), so the set of
  `$dynamicAnchor` targets for a name is fixed for the artifact's lifetime.
- The trampoline is one-way, so a `$dynamicRef` site in compiled code is
  reached only through compiled ancestors. The planner already knows each
  unit's resource URI and already computes the scope contribution it hands
  to `evaluateFragment`; the dynamic scope at a compiled site is therefore
  determined by the static path from the artifact root.

A site can be reached along several paths with different scopes when the
same schema object is applied from several places. Define a site as
**resolution-stable** when every scope that reaches it resolves the reference
to the same target. Resolution-stable sites compile the target directly, with
the target's own `$dynamicRef` sites resolved recursively under the extended
scope; the planner's existing cycle handling for `$ref` applies unchanged,
since a resolved dynamic reference is a static edge. Sites that are not
resolution-stable keep the island. Both the OpenAPI 3.1 schema and the
2020-12 metaschema's `#meta` sites are resolution-stable.

A later refinement, if a real schema needs it, is per-site dispatch: compile
one target per distinct resolution and select at runtime by the first scope
entry that declares the anchor. That keeps the scope parameter the artifact
already threads and adds only a small switch; it is not needed for the
measured cases.

What stays in the interpreter after this: sites that are not
resolution-stable, `$recursiveRef` (2019-09) unless treated the same way,
fallback units for keywords without a lowering, and nested tracked consumers
(E6).

## Constraints

- DESIGN.md §7 records the one-way trampoline as the invariant behind the
  channel analysis (an island can feed only its compiled ancestors). Compiling
  a resolved target does not re-enter compiled code from interpreted code, so
  the invariant holds; the target's records flow to compiled ancestors in the
  normal direction. The revisit trigger in §7 is reached only if a compiled
  target must itself contain an island whose resolution depends on scope
  pushed by that target, which the resolution-stable rule excludes.
- Unevaluated tracking: the target may consume dependency data from siblings
  of the `$dynamicRef` site; today it does so through the island's harvest.
  As a static unit it uses the same in-place tracked-region machinery as a
  `$ref` target, which is the case COMPILED-CONSUMERS.md already proves.
- `explainCompilation` must report the resolved site as static and name the
  resolution, so a reader can see why a `$dynamicRef` did not island.

## Smaller items, independent of the proposal

Ordered by benefit per effort; each also shrinks whatever islands remain.

1. Memoize `(ref, base)` resolution on the registry: both `new URL` parses
   and the fragment decode go away. Safe on snapshots; live registries
   invalidate on registration.
2. Drop the scope-array copy when the plan has a single resource, or emit
   the push only when the top entry differs.
3. Cache the `baseUri#pointer` identity key on `SchemaRef` so `enter`/`exit`
   stop building it twice per application, or key cycle detection on node
   identity.
4. Precompute each node's present-keyword list to replace the full-dialect
   probe scan and the unknown-keyword `Object.keys` pass.
5. Memoize `registry.child(ref, segment)`; it is pure over a snapshot.
6. Reuse a flag-mode fragment `EvalState` instead of allocating one per entry.

Item 1 alone measured 22.2 → 19.1 µs on `oas-document`. Items 2–6 are the
interpreter's generic overhead; together they are the plausible 2–3×
interpreter improvement, and they are worth doing only after the proposal,
which makes the interpreter irrelevant to the compiled tier's hot path on
this class of schema.

### Delivered (2026-09-21, after ADR 0004)

All six items landed as one commit each, in this order, every one green
under the full gate (verify, the fuzz legs, the harness's document-equality
oracles, the spike gate):

| Item | What landed                                                                                                                                                                                                                                                                                       |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | `resolveRef` and `dynamicReference` memoized per (base, reference); one parse per lookup; `%`-free fragments skip decoding. Invalidated by `register()` and by a dialect registration (`DialectRegistry.generation`); a snapshot keeps its memo. Only `UnresolvableRefError` is memoized, capped. |
| 3    | One interned `SchemaRef` per location with its `key` built once; the cycle guard is two parallel stacks scanned from the top and stopped at the first entry shallower in the instance (cursors carry `depth`); trace stack allocated only when tracing; adjacent duplicate scope pushes skipped.  |
| 4    | A per-node keyword table on the interned ref (present entries in evaluation order, unknown names in key order, the draft-07 `$ref` rule precomputed), validated by dialect identity; `dialectFor` cached per resource; the keyword context takes the dialect entry directly.                      |
| 5    | `registry.child` memoized one hop per segment on the interned ref, under the identifier extractor in force; misses and stale refs are never memoized; own-property indexing only.                                                                                                                 |
| 6    | `createFragmentRunner`: a flag-mode `EvalState` reset and reused per call, re-entrant with a fallback state, discarded after a throw; used by the compiled `frag` trampoline and by `Engine.evaluate`'s flag output.                                                                              |
| 2    | Compiled units guard the scope push on the top entry, so the copy happens once per resource boundary instead of once per unit.                                                                                                                                                                    |

Harness, this branch versus `main` at `6430363` (ops/s ratio; the same
machine and Node as the measurements above):

| Corpus          | interpreter flag, hot | interpreter list+annotations, hot | compile+first, interpreter | compiled flag, hot |
| --------------- | --------------------: | --------------------------------: | -------------------------: | -----------------: |
| api-payload     |   5.91× (31 → 5.3 µs) |                             3.55× |                      1.34× |      0.94× (noise) |
| oas-document    |  4.79× (514 → 107 µs) |                             3.56× |                      1.67× |              0.97× |
| migration       |  5.03× (9.0 → 1.8 µs) |                             2.85× |                      1.21× |              1.01× |
| records-uniform |   3.57× (24 → 6.7 ms) |                             2.93× |                      3.51× |              1.06× |
| records-sparse  |   3.57× (27 → 7.6 ms) |                             2.78× |                      3.44× |              0.99× |

No jse row fell below 0.92× of `main`; run-to-run noise on the same tree is
about 5%. The api-payload profile went from `applySchemaAtDepth` 35% /
`enter`+`exit` 27% / `escapeSegment` 10% to keyword evaluation itself
(applicator and validation behaviors) as the top entries. One island entry
(a 2019-09 `$recursiveRef` root) costs 0.62 µs compiled after item 6, from
0.64 before it: the state allocation was already cheap once the rest of
the per-entry work was gone.

Decided against: a `#`-fragment fast path around `new URL`. It is not
exactly equivalent (`new URL` strips control characters and normalizes the
base, so a document registered at `https://a` fails `#`-refs today and
would start succeeding), and once resolution is memoized the parse happens
once per (base, reference) per registry generation. Not done either: a
hoisted constant scope for single-resource artifacts, which would save one
small array per evaluation and would need a standalone-preamble variant.
The external comparison document's interpreter rows predate this work.

## Validation

- Full-suite differentials for the compiled tier (flag, list, annotations,
  every dialect directory) and the fuzz legs already referee compiled versus
  interpreter; they must stay at zero divergence with `$dynamicRef` sites
  compiled.
- Add `dynamicRef.json` cases to the compiled golden set covering: a
  resolution-stable site under a single scope; the same schema object reached
  under two scopes with the same resolution; two scopes with different
  resolutions (must island); a target that itself carries `$dynamicRef`; the
  bookending case from the official suite.
- `bench/harness.ts` `oas-document` rows are the acceptance number:
  compiled flag should move from about 22 µs toward the 2 µs static ceiling.
- `explainCompilation` output for the OpenAPI 3.1 schema should show zero
  interpreted units.

## Evidence

- Comparison document and harness:
  [docs/comparisons/ata-validator-and-json-schema-library.md](../../../comparisons/ata-validator-and-json-schema-library.md),
  `bench/external/`.
- Backlog: [E4](../backlog-inventory.md), which this note answers, and E6,
  which owns the nested-consumer islands this note leaves in place.
