# F1 spike: constant-evaluation-path compilation vs AJV and Hyperjump

**Verdict: GATE PASS — decisively.** Hand-compiled validators in the shape the
compiler tier would emit (ANALYSIS.md §7.4/§7.5) were _faster than AJV in every
gated comparison_ (AJV/ours ratios 0.46–0.87 across three runs; the gate required
≤ 1.50), while carrying full `keywordLocation`-bearing output and configurable
annotation collection as separately-specialized artifacts. The load-bearing claim
holds: **evaluation-path output and annotation support do not cost flag-mode
throughput, because the path is a compile-time constant at every emit site.**

Reproduce: `npm run bench` (correctness oracle runs first; benchmarks abort if any
implementation disagrees on any verdict).

## Method

- Three schemas (`spike/schemas.ts`): (1) draft-07-shaped API payload —
  properties/required/enum/pattern/items/nesting/`additionalProperties: false`;
  (2) 2020-12 composition — `$ref` into `$defs` + `allOf` +
  `unevaluatedProperties: false`; (3) annotation-heavy — `title`/`readOnly`/
  `default` on all properties.
- `spike/compiled.ts` contains hand-written validators restricted to what the
  planned static-analysis pass can derive (each optimization is annotated):
  constant `keywordLocation`/`absoluteKeywordLocation` strings at emit sites
  (including across `$ref`, e.g. `/allOf/0/$ref/properties/id/type`);
  `unevaluatedProperties` lowered to a static evaluated-name set; flag artifacts
  with zero location bookkeeping; a list artifact (all-errors BASIC-style units);
  an annotation artifact specialized to retention policy `{readOnly, default}`
  (`title` compiled away).
- Competitors: `ajv@8.20` (`Ajv2020`, default short-circuit mode; a second
  `allErrors: true` instance for the list comparison) and
  `@hyperjump/json-schema@1.17` (compiled `Validator`, FLAG mode; BASIC and the
  experimental `annotate` API for the output/annotation comparisons).
- tinybench, 300 ms per task after 100 ms warmup; Node v24.13.0, Apple Silicon
  macOS; correctness oracle (verdict agreement across all implementations on all
  seven instance cases) gates the run.

## Results (representative run; ratios varied ±0.1 across three runs, all PASS)

| Case                                     |                    ours (compiled) |                         ajv |         hyperjump | ajv/ours |
| ---------------------------------------- | ---------------------------------: | --------------------------: | ----------------: | -------: |
| user valid (flag)                        |                        17.5M ops/s |                       11.4M |              273k | **0.66** |
| user invalid (flag)                      |                              26.6M |                       12.2M |              258k | **0.46** |
| event valid (flag)                       |                              47.4M |                       38.8M |              241k | **0.82** |
| event invalid (flag)                     |                              47.4M |                       29.6M |              253k | **0.62** |
| user all-errors with locations           |                  5.6M (full units) |  11.8M (proprietary errors) |      219k (BASIC) |        — |
| profile annotations                      | 32.1M (retained: readOnly+default) | n/a (no annotation support) | 151k (`annotate`) |        — |
| profile flag (annotations compiled away) |                              51.0M |                           — |                 — |        — |

Compile time for the three schemas: ajv ≈ 19 ms, hyperjump ≈ 17 ms, ours
precompiled (models build-time/standalone emission; runtime codegen cost for our
future compiler is not yet measured).

## Findings

1. **The §7.4 claim is validated.** Flag-mode artifacts with zero location
   bookkeeping beat AJV while the _same compilation approach_ produces, from the
   same schema, artifacts emitting spec-shaped output units whose
   `keywordLocation`/`absoluteKeywordLocation` are string constants — including
   evaluation paths through `$ref`, which no runtime bookkeeping produced.
2. **Configurable annotation collection is a speedup mechanism, not a tax.**
   The retention-specialized artifact runs at 32M ops/s (~210× Hyperjump's
   `annotate`); the flag artifact from the same schema, with annotations compiled
   away, runs at 51M ops/s. Pay only for what the policy retains — the
   ANALYSIS.md §7.3/§7.5 config-specialization story, observed.
3. **The interpreter gap is as expected.** Hyperjump sits 50–200× behind compiled
   code across all cases (consistent with ANALYSIS.md §3.5's order-of-magnitude
   estimate), which confirms both that the compiler tier is necessary for
   AJV-class workloads and that an interpreter tier is a perfectly serviceable
   reference/edge tier.
4. **Lowering heuristics matter and belong to the compiler.** Switching the
   `unevaluatedProperties`/`additionalProperties` name sweep from `Set.has` to an
   equality chain (legitimate: the set is a compile-time constant; choose by set
   size) moved the event-schema ratio from 1.34 to 0.82 — the kind of decision
   the compiler tier owns via `analyze()` results.
5. **All-errors mode with full output units runs at ~half of AJV's `allErrors`**
   (5.6M vs 11.8M) while producing strictly more information (AJV's errors carry
   no evaluation path and no spec output shape) and ~26× Hyperjump's BASIC.
   Untuned: units are materialized eagerly with message strings; lazy
   materialization and unit pooling are known headroom. Acceptable for the rare
   path; not gated.

## Threats to validity

- Hand-written "compiled" code risks encoding cleverness a real compiler wouldn't
  have. Mitigation: every construct in `spike/compiled.ts` is annotated with the
  static-analysis fact that licenses it; nothing uses information outside the
  schema.
- Three schemas, seven instances, one machine, microbenchmark conditions
  (monomorphic call sites, warm JIT). The F3 design keeps a full benchmark
  harness as a real milestone; this spike only needed to falsify/confirm the
  architectural claim.
- Hyperjump's `annotate` returns an annotated-instance structure rather than a
  unit list (richer in some uses); the comparison is directional, not apples-to-
  apples. Its FLAG-mode numbers are the fair core comparison and tell the same
  story.
- ajv compile-time includes first-instance setup costs amortized across three
  schemas; both incumbents' compile times are fine in practice and not a
  differentiator either way.

## Consequence

Proceed to F2 (channels prototype) and F3 (engineering design) on the
ANALYSIS.md §7 architecture unchanged. The compiler tier's lowering catalogue
(finding 4) and lazy error materialization (finding 5) should be explicit design
items in F3.
