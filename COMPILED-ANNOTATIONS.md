# Compiled list-mode annotation collection — feasibility assessment

Assesses extending the compiled tier to the flat annotation surface:
`Result.annotations` (the root frame's surviving productions, rendered as
`AnnotationUnit[]`) and the Basic document's `annotations` array on valid
instances. Today both are interpreter-only: `compileList` produces
interpreter-exact **error** units, and its Basic adapter omits
`annotations` on valid instances (packages/compiler/src/index.ts:64,
DESIGN.md §7 "Compiled-output scope"). Trace-shaped outputs
(hierarchical/verbose/modern LIST documents, `trace: true`) are out of
scope here and stay on the interpreter regardless.

**Verdict: feasible, at moderate cost.** The deferred-register entry
("compiled annotation collection (channel frames)") overstates what this
surface needs. Full channel frames in emitted code are required only if
compiled code must _consume_ productions (rule 4 visibility filtering).
It never does: list-mode plans already classify every consumer-bearing
unit as interpreted (packages/compiler/src/plan.ts:183). Compiled code
only _writes_ productions, and write-side frame semantics (rule 3:
merge on success, discard on failure) reduce to a mark/truncate
discipline on one flat array. The genuinely new work is in the produce
IR's value shapes, the serializer's produce emission, and the gates.

**Status (2026-07-10): stages 1 and 2 (§7) are delivered.** Stage 1:
`LowerProduceValue` carries per-keyword render recipes
(`collectedIndexes` with `largestOrTrue`/`appliedTrue`/
`matchedOrAllTrue`; `countRange` gained `collectIndexes`), every
`lower()` emits produce IR matching its `evaluate()` oracle across all
five dialects, pinned by the recipe gate
(packages/compiler/test/produce-recipes.test.ts over test-kit's
`evaluateProduceRecipes` reference evaluator; its first honest run
caught and fixed a real gap — `unevaluatedProperties` with
statically-total coverage must still produce the empty names
annotation). Stage 2: `compileList(engine, uri, { collectAnnotations,
retention })` emits interpreter-exact annotations — mark/truncate at
every application boundary, hoisted marks for the two `applyExpr`
shapes, unknown-keyword constant pushes, static retention-list elision
at serialize time with `keep` at the wrapper, and `fragListAnn` island
harvest — gated by the five-dialect suite differential with exact pins
(packages/compiler/test/list-annotations-suite.test.ts: 4,942
instances, 2,199 annotation units order-compared, Basic side,
retention matrix, planted self-tests), the annotations fuzz leg
(`FUZZ_ANNOTATIONS=1`, sensitivity + planted self-tests, CI smoke),
and plan-identity asserts. Zero divergences surfaced in stage 2's
gates. Remaining: stage 3 bench (a compiled list+annotations subject
in bench/harness.ts), and one recorded pre-existing caveat — dialects
with `allowUnknownKeywords: false` throw in the interpreter but are
silently ignored by every compiled tier, annotation mode included.

## 1. What already exists

The infrastructure is further along than "bounces up to the interpreter"
suggests. Inventory, with the load-bearing facts:

| Piece                       | State                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Compiled list mode (errors) | Built (D9e). Flat, interpreter-exact error units, same order; never short-circuits; error objects materialize only on failure paths.                                                                                                                                                                                                                                                                                                    |
| Consumer classification     | List-mode plans interpret any unit containing `unevaluated*` (plan.ts:183–189, for error-unit parity reasons that apply equally here). Compiled units therefore never consume from the channel.                                                                                                                                                                                                                                         |
| Produce IR                  | `LowerStmt` has a `produce` kind with `LowerProduceValue` (`const` / `collectedNames` / `collectedIndexes` / `expr`, core/src/lowering.ts:248), and keyword `lower()` implementations already emit it (`title` et al. via core.ts:49, `properties` at applicator.ts:348, `contains` at applicator.ts:730, `unevaluated*` at unevaluated.ts:91/178). The serializer currently discards every `produce` (serialize.ts, `case "produce"`). |
| Trampoline harvest          | `evaluateFragment` already returns the fragment's root-frame surviving productions with cursor identity intact, exactly so "a compiled caller can merge them under channel rule 3" (core/src/engine.ts:534–547). The list-mode trampoline `fragList` simply drops them today (compiler/src/runtime.ts:132).                                                                                                                             |
| Rendering + retention       | `renderAnnotation`, `selectRetained`, `applyRetention`, `makeRecordPredicate` (core/src/output.ts) are shared functions the compiled tier can call — same one-implementation-per-semantic rule the error path follows.                                                                                                                                                                                                                  |
| Artifact keying             | D5 already memoizes one artifact per (schema, retention policy, output config), so a retention-specialized annotation artifact fits the existing contract.                                                                                                                                                                                                                                                                              |

## 2. Why this surface avoids channel frames

The asymmetry that made compiled **errors** easy is inverted for
annotations, but a cheaper mechanism than frames closes the gap:

- **Errors never drop.** The interpreter keeps errors from failed
  branches of a successful `anyOf`, so flat appends into one `errs`
  array reproduce the interpreter exactly. That is what D9e ships.
- **Annotations drop on application failure** (rule 3). But schema
  application is strictly LIFO, and a discarded frame's productions —
  its own plus everything merged from its descendants — occupy a
  contiguous suffix of any append-ordered array. So the caller-side
  discipline

  ```js
  const m = anns.length;
  if (!uN(v, d, s, ep, ip, errs, anns)) {
    ok = false;
    anns.length = m;
  }
  ```

  at every application boundary is _exactly_ frame discard. No frame
  objects, no per-frame allocation on the hot path.

- **Rule 4 (visibility) never fires in compiled code.** Consumers are
  interpreted (plan.ts:183); the trampoline is one-way; DESIGN §7
  already proves an island cannot consume from a compiled sibling
  (cousin invisibility — rule 4 has no lateral flow). Inside an island
  the interpreter's real frames handle consumption as today.

- **Ordering.** The interpreter appends a child frame's productions to
  its parent at application end (engine.ts:440,
  `state.frame.productions.push(...frame.productions)`), i.e. in
  completion order — which is precisely append order in the flat array.
  Within a unit, keywords run in `dialect.ordered` order in both tiers.
  This is an argument, not a proof; the differential gate (§5) is the
  proof obligation, matching how list-mode error order was pinned.

- **Grouped folds need no special casing.** `anyOf` branches: mark/
  truncate per branch (failed branches discard, successful ones keep).
  `oneOf` with two passing branches: both branches' productions merge
  into the unit's span, the keyword fails, the unit returns false, and
  the _caller's_ truncate discards the whole span — identical to the
  interpreter discarding the unit's frame. Same reasoning covers `not`
  (a succeeding negated subschema merges, then the unit fails and the
  caller discards) and `contains` probes. List mode already disables
  inlining and boolean folding of `false` (serialize.ts:75–79), so no
  interaction with D9c arises.

- **Laziness inverts, by design.** D9e's "unit objects materialize only
  on failure paths" cannot hold for annotations: they exist only on
  success paths. Allocation on valid instances is the point of the
  feature. This lands under the existing positioning rule — list-tier
  artifacts are slower than flag by design; the comparator is the
  interpreter, not AJV (which has no annotation collection at all).

## 3. What has to be built

### 3.1 Produce IR value shapes (core, breaking nothing)

The blocking gap. `collectedIndexes` is one IR kind but three
interpreter-exact annotation values:

| Keyword                                  | Interpreter value (evaluate())                                                 |
| ---------------------------------------- | ------------------------------------------------------------------------------ |
| `prefixItems`                            | largest applied index, or `true` when it covered the array (applicator.ts:604) |
| `items` / 2019 `items`/`additionalItems` | `true` iff it applied to any item (applicator.ts:668)                          |
| `contains`                               | matched index list, or `true` when every item matched (applicator.ts:761)      |

Similarly `collectedNames` covers `properties` (schema-key order),
`patternProperties` (deduped via a Set), `additionalProperties`
(enumeration order), each conditional on different emptiness rules
(`items` produces only if it applied; `prefixItems` only if `n > 0`;
`contains` only if non-empty). The produce IR must carry the value
recipe — either new kinds (`largestIndexOrTrue`, `appliedTrue`,
`indexListOrAllTrue`, `nameList`) or a `render` discriminator on the
existing kinds. Since the serializer currently discards all `produce`
nodes, extending the type is compatible; each keyword's recipe stays in
its own module (D1).

Audit required across all `lower()` implementations: at least the
2019-09 `items`/`additionalItems` lowerings deliberately emit **no**
produce ("the compiled tier has no annotation channel",
vocab2019.ts:118) — sound for flag/list-errors, wrong for annotation
artifacts. `format`'s produce-regardless-of-assertion-outcome quirk
(format.ts:81) must be mirrored. The draft-04 package needs the same
sweep it got for M6.6 lowering.

### 3.2 Serializer (compiler)

A third emit output (`"list+annotations"`, or an option on `"list"`):

- Thread an `anns` parameter alongside `errs` through unit functions
  and the root wrapper.
- Emit `produce` statements: constant produces push a unit object with
  compile-time-constant `keyword`/`vocabulary`/`evaluationPath` suffix/
  `schemaLocation` and runtime `instanceLocation` (`ip` concatenation,
  same as errors); collected-value produces emit an accumulator in the
  keyword's sweep and a guarded push after it.
- Mark/truncate at every application call site (§2), including each
  branch inside `anyMayPass`/`exactlyOne` groups and `applyExpr`
  probes.
- Retention specialization: productions statically ruled out by the
  allow/deny lists simply don't emit — the compiled analogue of
  produce-time elision, sound for the same reason (`makeRecordPredicate`
  is also `selectRetained`'s list stage, output.ts:150). A `keep`
  predicate runs once at the wrapper over the surviving array, exactly
  matching the interpreter's render-time contract (record the superset,
  filter at render).
- Standalone emission stays flag-only; this mode is runtime-only, as
  list mode already is (list-mode standalone is separately deferred).

### 3.3 Unknown keywords (planner + serializer)

The interpreter collects unknown keywords as annotations
(engine.ts:421–437); the planner never looks at them (it iterates
`dialect.ordered` only), which is sound today because they are
annotation-only. Annotation artifacts must emit them as constant
produces (`vocabularyUri: null`, value = the keyword's schema value),
gated by the same static retention filter. While auditing this path,
verify flag/list parity for dialects with `allowUnknownKeywords: false`
(custom dialects only — the interpreter throws `UnknownKeywordError` at
evaluation, and it is worth confirming the compiled tiers reproduce
that; if not, it is a pre-existing gap this work would surface).

### 3.4 Trampoline (compiler runtime)

Extend the list trampoline (or add `fragAnn`): pass
`makeRecordPredicate(registry.consumedIds(), true, retention)` so
islands record consumed _and_ retainable productions; on fragment
success, render survivors via `renderAnnotation`, re-root
`instanceLocation` under `ip` (the same one-synthetic-PathNode trick
`fragList` uses for errors covers `evaluationPath`), apply the
retention lists, and append. The call-site mark/truncate handles
fragment failure uniformly — no new discard logic.

### 3.5 Public API

`compileList(engine, uri, { collectAnnotations: true, retention })`
returning `{ valid, errors, annotations? }` with `annotations` present
only when valid (matching `Engine.evaluate`, index.ts:577), and the
Basic adapter gaining its `annotations` array on success — closing the
documented gap in `CompiledListArtifact.basic()`. `positions` decoration
can be applied post-hoc by the wrapper if wanted; not required for a
first slice.

## 4. What stays interpreted (unchanged classification)

- **Consumer-bearing units** (`unevaluated*` present): interpreted, as
  in list mode today. Schemas leaning on `unevaluated*` will mostly
  trampoline; the harvest path makes them correct, not fast. Lifting
  this needs the general channel-frames design plus runtime
  evaluated-set tracking — a separate, much larger effort, assessed
  with measurements in [COMPILED-CONSUMERS.md](COMPILED-CONSUMERS.md)
  (short version: one root-level consumer currently reduces the entire
  OAS 3.1 plan to a single interpreted unit, ~230–400× behind AJV on
  dynamic-coverage shapes).
- **Dynamic islands, cycles, unlowerables, non-schema refs**: exactly
  the current fallback causes.
- **Trace-shaped outputs**: hierarchical/verbose/modern LIST documents
  and `trace: true` remain interpreter renderings over `allProductions`
  and the trace tree; nothing here changes them.

## 5. Gates (the actual acceptance bar)

Per the repo's testing discipline, the mechanism is only half the work:

- **Full-suite differential**: every dialect directory, compiled
  annotation artifact vs `Engine.evaluate(..., { output: "list",
collectAnnotations: true })` — unit-by-unit equality _including
  order_, plus the Basic document's annotation side. The channels tests
  are the order oracle.
- **Retention matrix**: allow/deny lists and `keep` predicates on/off,
  compiled vs interpreter (mirroring the M5.5 elision on/off
  differential).
- **Fuzz leg**: extend the `FUZZ_LIST` referee to compare annotations —
  with a planted-divergence self-test proving the comparison detects
  what it claims (the FUZZ_LIST-incident lesson; that leg silently not
  running is a failure mode this repo has already paid for once).
- **Plan census**: exact static/interpreted pins for the new mode over
  every suite directory (annotation mode should classify identically to
  list mode; a silent flip must fail loudly).
- **Bench**: report-only annotations-on comparison vs the interpreter —
  the claim to validate is "meaningfully faster than interpreted
  annotation collection on valid instances", with cost proportional to
  retention (SPIKE.md's finding, now on the compiled side).

## 6. Cost estimate and risks

Touched surfaces: `core/lowering.ts` (IR extension), a produce audit
across every keyword module with `lower()` (including
`dialect-draft04`), `compiler/serialize.ts` (the bulk: produce
emission, `anns` threading, mark/truncate), `compiler/runtime.ts`
(harvest), `compiler/index.ts` (API), `compiler/plan.ts` (mode
plumbing, unknown keywords), plus the gate suite. Comparable in shape
and size to the D9e list-errors milestone — the closest precedent, and
it landed cleanly on the same plan/serialize skeleton.

Main risks, none fatal:

1. **Value-shape parity** (§3.1) — mechanical but wide; every produce
   recipe is a potential divergence. The differential gate catches all
   of them; the work is enumerating, not inventing.
2. **Ordering parity** rests on merge-at-application-end append
   semantics (§2). If a counterexample surfaces, the fallback is
   recording (pathNode-ish) sort keys — but no such case is currently
   known, and the channels tests would expose one immediately.
3. **Scope creep toward consumers.** The temptation to also compile
   `unevaluated*` units (runtime evaluated-set tracking, D9(a)'s "else"
   branch) should be resisted in the first slice; it is the part that
   genuinely needs frames-or-equivalent and static licensing care
   (M6.6's flag-only-sound licensing bug lives exactly there).

## 7. Recommendation

Build it as a self-contained milestone in three stages: (1) IR value
shapes + produce audit, gated by an interpreter-side self-check that
`lower()` produce recipes reproduce `evaluate()` produce values; (2)
serializer + trampoline + API, gated by the full differential/fuzz/
census stack; (3) retention specialization + bench. Leave consumer
compilation and trace-shaped outputs explicitly out, updating the
DESIGN.md deferred-register entry to distinguish "flat annotation list
(feasible now, this document)" from "channel frames for compiled
consumers (still deferred)".
