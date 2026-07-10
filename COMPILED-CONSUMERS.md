# Compiled `unevaluated*` consumers — feasibility assessment

Assesses compiling consumer-bearing units (`unevaluatedProperties` /
`unevaluatedItems`) instead of interpreting them: the runtime
evaluated-set tracking that D9(a) names as its "else" branch and has
deferred since M6. Companion to [COMPILED-ANNOTATIONS.md](COMPILED-ANNOTATIONS.md),
which deliberately excludes this; the two share a mechanism (§4) and a
prerequisite (§5).

**Verdict: feasible, and the measurements below argue it is the single
largest performance win left in the compiler — but it is the hardest
compiler work yet proposed for this codebase, in exactly the area
(consumer licensing) that produced the M6.6 flag-only-soundness bug.
The deciding input is workload shape: consumer-free hot paths already
beat AJV and gain nothing; OAS-document-shaped workloads currently get
almost nothing from compilation and stand to gain roughly an order of
magnitude.**

## 1. What the fallback costs today — measurements

All numbers: this machine, Node v24.13.0, tinybench (300–500 ms/task),
verdict-oracle before timing (every subject must agree with the
expected verdict on every instance), plan census verified per case so
the numbers are attributed to the tier that actually ran. Same
methodology as `bench/harness.ts`; runner variance applies (repo
policy: benchmarks are local evidence, not CI gates).

### 1.1 Micro-benchmarks: the fallback cliff

Four small 2020-12 schemas, four instances each (mixed verdicts),
hot-path throughput:

| Case                                                                                    | AJV (2020)  | jse compiled flag     | jse compiled list | jse interpreter |
| --------------------------------------------------------------------------------------- | ----------- | --------------------- | ----------------- | --------------- |
| control: `properties` + `additionalProperties: false` (no consumer)                     | 18.9M ops/s | **22.8M (1.21× AJV)** | 8.3M              | 70k             |
| static coverage: `allOf` of two `properties` conjuncts + `unevaluatedProperties: false` | 13.6M       | **19.8M (1.45× AJV)** | 43k (1/315)       | 44k             |
| dynamic coverage: `anyOf` two-variant union + `unevaluatedProperties: false`            | 7.4M        | 32k (**1/229**)       | 31k               | 32k             |
| dynamic coverage: `if`/`then` `prefixItems` + `unevaluatedItems`                        | 17.7M       | 45k (**1/391**)       | 44k               | 45k             |

Readings:

- **Where the existing static-coverage license applies (flag mode), jse
  already beats AJV** — 1.45× on the static case, a wider margin than
  the consumer-free control (1.21×), because plan-time coverage
  specialization is cheaper than AJV's runtime tracking.
- **Where coverage is dynamic, every jse tier collapses to interpreter
  speed: ~230–400× slower than AJV.** The compiled artifact is a thin
  wrapper around one root trampoline.
- List mode pays the cliff even with static coverage (the M6.6
  soundness finding forces those consumers interpreted), so compiled
  list-mode errors — 8.3M ops/s on the control — drop to 43k the
  moment a consumer appears.

Schemas for reproduction — dynamic-properties case:

```json
{
  "type": "object",
  "properties": { "kind": { "enum": ["k1", "k2"] } },
  "required": ["kind"],
  "anyOf": [
    {
      "properties": {
        "kind": { "const": "k1" },
        "a": { "type": "string" },
        "b": { "type": "string" },
        "c": { "type": "string" }
      },
      "required": ["a"]
    },
    {
      "properties": {
        "kind": { "const": "k2" },
        "d": { "type": "string" },
        "e": { "type": "string" },
        "f": { "type": "string" }
      },
      "required": ["d"]
    }
  ],
  "unevaluatedProperties": false
}
```

and dynamic-items case:

```json
{
  "type": "array",
  "if": { "prefixItems": [{ "const": "tagged" }] },
  "then": { "prefixItems": [true, { "type": "number" }] },
  "unevaluatedItems": { "type": "boolean" }
}
```

(the static case replaces `anyOf` with `allOf`; the control replaces
the consumer with `additionalProperties: false`).

### 1.2 The real corpus: one root consumer poisons the whole plan

The decisive structural finding. The official OAS 3.1 schema
(`bench/corpora/oas-3.1-schema.json`, ~28 `unevaluatedProperties`
sites) validating the corpus OpenAPI document:

| Subject                           | Plan census                            | Hot ops/s  |
| --------------------------------- | -------------------------------------- | ---------- |
| real schema, compiled flag        | **1 unit, 1 interpreted**              | 2,147      |
| real schema, interpreter          | —                                      | 2,141      |
| consumers stripped, compiled flag | **340 units, 4 interpreted (dynamic)** | **25,194** |
| consumers stripped, interpreter   | —                                      | 2,181      |

The root schema object carries `unevaluatedProperties: false` with
runtime-conditional contributors, so `buildPlan` classifies the _root_
interpreted and — because an interpreted unit's subtree is never
planned (the trampoline is one-way) — the entire 340-unit schema
compiles to a single trampoline call. Compilation currently buys the
flagship corpus nothing (2,147 vs 2,141 ops/s; the harness's recorded
2,065 vs 1,916 is the same noise band), and Hyperjump (3,106 ops/s in
`bench/results/results.json`) currently beats both.

Stripping `unevaluated*` (semantics-loosening, so an upper bound, not a
forecast) multiplies compiled throughput by **11.7×** while leaving the
interpreter unchanged — the entire gap is consumer fallback, not
`$dynamicRef` (only 4 units stay interpreted as dynamic islands). Real
consumer compilation pays for its own sweeps and tracking, so the
realistic recovery is below 11.7× but plausibly high single digits.

This also corrects the "consumer-heavy schemas would mostly trampoline"
intuition: the penalty is not proportional to consumer count. One
consumer at the root — where real-world strict schemas put it — wipes
out compilation for the whole document. The OAS schema is the pattern,
not the pathology.

### 1.3 The AJV comparison must be caveated

Two of AJV's numbers in §1.1 are cheaper than spec compliance:

- **`contains` + `unevaluatedItems`: AJV returns the wrong verdict.**
  The oracle rejected AJV on
  `{"type":"array","prefixItems":[{"type":"string"}],"contains":{"type":"number","minimum":10},"unevaluatedItems":{"type":"boolean"}}`
  with instance `["s", 12, "not-bool"]` — AJV says valid (it does not
  track `contains`-matched indexes), the spec and both jse tiers say
  invalid. That case is excluded from the table (jse tiers run ~44–48k
  ops/s there, i.e. the same fallback cliff).
- **AJV short-circuits `anyOf` even under an adjacent consumer**, so it
  skips evaluation work the spec's annotation semantics require —
  part of the known non-compliance that already excludes AJV from the
  `oas-document` harness corpus (it rejects the valid document). A
  compliant compiled consumer must run every in-place branch (channel
  rule 6), so on `anyOf`-heavy shapes jse should be expected to land
  somewhat below AJV at full correctness. The honest target is
  "AJV-class, spec-correct", not "never slower" on these shapes; the
  existing benchmark gate corpus (consumer-free) keeps its threshold
  untouched.

## 2. What makes this the hard project

The annotation project (companion doc) only needs compiled code to
_write_ productions; discard-on-failure reduces to mark/truncate on a
flat array. Consumers add the read side — rule 4 — and that changes
the compiled calling convention:

1. **Runtime coverage must flow across unit functions.** A consumer's
   coverage comes from its own schema object's contributors _and_ from
   successful in-place applications (`allOf`/`anyOf`/`oneOf`/`if`/
   `then`/`else`/`$ref`/`dependentSchemas` targets), recursively. With
   dynamic coverage, each unit in that in-place closure must report at
   runtime which names/indexes it evaluated, with merge-on-success /
   discard-on-failure semantics. That means an extra out-parameter
   (an evaluated-names array + an index summary) threaded through
   every unit function in the consumer-visible region — a planner
   analysis (which units are reachable from a consumer via in-place
   edges at the same cursor) and a second calling convention. The
   flat-array + mark/truncate discipline from the annotations design
   carries over; child-cursor descents start fresh (coverage is
   per-instance-location, which is what makes a dedicated channel
   cheaper than filtering general productions by cursor).

2. **Value shapes are the channel's vocabulary.** The consumer reads
   typed values: name lists, prefix counts, index sets, `true`-covers-
   all (see `unevaluatedItems`'s reader, unevaluated.ts:180–216). The
   coverage channel must carry exactly these — the same produce-value
   recipes the annotation project's IR extension defines (§5:
   sequencing).

3. **Keyword knowledge must stay keyword-side (D1).** The reading
   logic — which behavior ids to union, how `contains: true` differs
   from an index list — belongs to `unevaluated*`'s modules, not the
   serializer. The IR needs read-side operations (e.g. an expression
   for "the runtime evaluated-name set at this unit" and an apply
   attribute marking coverage-contributing edges) so `lower()` in
   unevaluated.ts expresses the sweep against runtime coverage the
   same way it does against static coverage today. `LoweringContext`
   grows; the existing static-coverage path stays as the fast case.

4. **Short-circuit re-licensing.** Today the serializer may emit
   `anyOf` short-circuits because the planner interprets every node
   whose channel could be observed (serialize.ts header). Once
   consumer regions compile, flag-mode emission inside those regions
   must run every branch (rule 6) — a per-region emission mode, and
   the licensing proof in DESIGN §7 needs rewriting. This is the exact
   class of soundness reasoning that was wrong once already: the
   FUZZ_LIST incident found static-coverage licensing flag-only-sound
   after ~20k honest fuzz cases. Assume the first design here is
   subtly wrong somewhere and budget for the fuzzer to find it.

5. **Islands inside consumer regions.** A `$dynamicRef` (or cycle)
   island applied in-place under a consumer must contribute coverage.
   `evaluateFragment` already returns root-frame surviving productions
   with cursor identity, and `makeRuntime`'s flag predicate already
   records consumed ids for exactly this reason (runtime.ts:96–99) —
   today the values are discarded; the caller must filter them to the
   fragment's root cursor and feed them to the channel. The plumbing
   exists; the conversion is new.

6. **What it does NOT require:** dialect changes (2019-09's
   `unevaluated*` pair and draft-04 have no consumers beyond the same
   factory), new interpreter semantics (the interpreter is the oracle
   throughout), or touching the flag-mode static-coverage path that
   already wins against AJV.

## 3. Payoff model — when to invest

- **Consumer-free or static-coverage flag workloads: zero gain.**
  Already at 1.2–1.5× AJV. Nothing here moves.
- **Dynamic-coverage consumers (discriminated unions with
  `unevaluatedProperties`, conditional tuples): ~2 orders of
  magnitude available.** From 1/230–1/400 of AJV to AJV-class. This is
  the strict-API-schema idiom 2020-12 was designed for.
- **OAS 3.1 validation (the oaskit workload): the flagship corpus goes
  from "compilation buys nothing" (§1.2) to bounded 11.7×, realistic
  high single digits** — and from losing to Hyperjump on that corpus
  to leading it by several ×. If validating OpenAPI documents at scale
  is a product surface, this project is what makes the compiled tier
  matter for it.
- **List mode inherits the fix for free-ish:** runtime tracking with
  merge-on-success reproduces the interpreter's annotation-drop
  semantics by construction, so the M6.6 list-mode demotion
  (plan.ts:183) can be lifted, unifying flag and list classification
  again. Compiled list mode currently drops from 8.3M to 43k ops/s
  when a consumer appears (§1.1); this closes that cliff too.

## 4. Relationship to the annotations project

The two projects share one skeleton: a flat runtime channel with
mark/truncate discard at application boundaries. Annotations are the
write-only half (productions out to the caller); consumers are the
read-write half (coverage productions consumed at the unit). Building
consumers without annotations is possible (thread only the dedicated
coverage arrays, no annotation units), but both need the same IR
produce-value recipes and the same island-harvest conversions.

## 5. Recommended sequencing

1. **Produce-value IR extension + keyword audit** (stage 1 of
   COMPILED-ANNOTATIONS.md §3.1) — shared prerequisite; the coverage
   channel's value vocabulary.
2. **Flag-mode runtime tracking** — planner region analysis, the
   second calling convention, unevaluated* `lower()` runtime path,
   short-circuit re-licensing, island coverage harvest. Gate: full
   suites compiled with consumer units pinned static in the census,
   fuzz legs seeded consumer-heavy, and a bench delta on the
   `oas-document` corpus (the number that justifies the project).
3. **List-mode consumer parity** — lift the plan.ts:183 demotion,
   error-unit and order parity for the consumer's sweep, the planted-
   divergence self-test for the new comparison leg (the FUZZ_LIST
   lesson, encoded).
4. **Annotations on top** (rest of the companion doc) in either order
   relative to 3.

Effort: larger than D9e or M6.6 individually — stage 2 alone touches
planner, IR, serializer calling convention, runtime, and the
unevaluated module, and the gate work is comparable to the mechanism
work. Two full milestones is the honest estimate, with the
census/fuzz/bench evidence from §1 as the acceptance baseline: the
`oas-document` census must go from 1 unit to ~340 with only dynamic
islands interpreted, and hot throughput from ~2.1k toward the ~25k
bound, at unchanged verdicts and error/annotation parity everywhere.

## 6. Open questions

- **Region granularity.** Threading coverage parameters only through
  consumer-visible regions keeps consumer-free schemas' emitted code
  byte-identical (worth pinning in a test); whether shared units that
  appear both inside and outside a region get two emissions or one
  parameterized emission is a serializer design choice with code-size
  consequences (D9's size-budget fallback applies).
- **`oneOf` under a consumer.** Both-branches-pass is a keyword
  failure; branch coverage merged before the failure is discarded with
  the unit's span — mark/truncate handles it, but the fuzz referee
  should seed this shape specifically (it is where rule-3/rule-6
  reasoning is easiest to get wrong).
- **AJV-relative positioning.** Decide up front whether the bench gate
  gains a consumer corpus with an enforced threshold, or whether
  consumer shapes stay report-only with the "spec-correct at AJV-class
  speed, AJV short-circuits incorrectly" framing (§1.3). Recommend the
  latter: an enforced never-slower gate against a subject that skips
  required work invites optimizing toward non-compliance.
