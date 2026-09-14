# A fast, feature-complete JSON Schema implementation for JavaScript/TypeScript

**Status:** analysis + recommended architecture (not yet an engineering design)
**Date:** 2026-07-05
**Method:** all claims about AJV and Hyperjump were verified against current sources
(docs, issue trackers, GitHub/npm APIs, Bowtie, and each project's source as of this
date). Architecture-level study of both codebases informed the design-space analysis;
no code from either project is to be ported or translated into any implementation
(see [IP policy](#11-ip-policy)).

---

## 1. Executive summary

The two leading JS implementations fail in complementary ways, and neither is
positioned to converge on "fast **and** complete":

- **AJV** is a draft-07-era error-reporting codegen engine. Its 2020-12 support is
  measurably incomplete (80% of the official test suite per Bowtie), it has **no
  annotation collection at all** (assumption confirmed), no standard output formats,
  and its `$dynamicRef` is a structurally wrong approximation with multiple
  community fixes stalled in open PRs. Maintenance is skeletal but not dead.
- **Hyperjump `@hyperjump/json-schema`** is nearly complete on semantics (99% on
  Bowtie for 2020-12) and actively maintained, but only the FLAG output format is
  stable; BASIC/DETAILED are experimental, VERBOSE/hierarchical formats absent; the
  annotation API is experimental; and `keywordLocation` is still deliberately
  omitted (assumption confirmed, rationale verified verbatim). Its interpreter
  architecture pays per-keyword dispatch, plugin-hook, and URI-string costs that
  make AJV-class throughput implausible without a redesign.

**Recommendation:** build a new engine designed _annotation-first_ with two
execution tiers sharing one keyword registry: a spec-faithful interpreter (the
semantics reference — all dialects, all output formats, CSP-safe) and a compiler
tier that emits specialized JavaScript for the statically-analyzable parts of a
schema, falling back to the interpreter for dynamic islands. The key architectural
insight is that **`keywordLocation` and annotation collection are nearly free in
compiled code** — the evaluation path is a compile-time constant at every emit
site — so AJV-class speed does not require abandoning the annotation model.
AJV's and Hyperjump's failures are both consequences of retrofitting: AJV bolted
2019-09+ semantics onto an error-centric compiler, Hyperjump bolted output onto a
purist interpreter. Starting from the annotation model and _lowering_ it is the
design neither can reach from where they are.

Verdicts on the three assumptions flagged for validation:

| Assumption                                                            | Verdict                                                                                                                                                                                                                                  |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AJV does not collect annotations                                      | **Confirmed.** No annotation machinery exists in `lib/`; the only "annotation" references are the vocabulary metaschema files. Errors use AJV's own `instancePath`/`schemaPath` format; none of the spec output formats are implemented. |
| Hyperjump omits `keywordLocation`, includes `absoluteKeywordLocation` | **Confirmed, still current.** Both the BASIC-output and annotations plugins emit only `keyword` (URI), `absoluteKeywordLocation`, `instanceLocation`. The maintainer's rationale is on record (§3.3).                                    |
| Hyperjump may not support all output formats                          | **Confirmed.** FLAG is the only stable format; BASIC and DETAILED exist behind the `/experimental` export; VERBOSE does not exist.                                                                                                       |

---

## 2. State of AJV

Sources: [repo](https://github.com/ajv-validator/ajv), [docs](https://ajv.js.org/),
[releases](https://github.com/ajv-validator/ajv/releases), GitHub/npm APIs, source
inspection (master @ Apr 2026, v8.20.0).

### 2.1 Position

~316M weekly npm downloads (2026-07-05) — roughly **1,800×** Hyperjump's 174k, and
most of the JS ecosystem's transitive schema validation (eslint, webpack, fastify,
countless OpenAPI tools). This dominance is exactly why its draft-07-centricity
retards 2020-12 adoption: the default validator everyone already has does draft-07
well and 2020-12 poorly.

### 2.2 Compliance

- Bowtie official-test-suite pass rates: **draft-07 85%, 2019-09 83%, 2020-12 80%**
  ([badge](https://bowtie.report/badges/javascript-ajv/compliance/draft2020-12.json),
  [report](https://bowtie.report/)). Even its home draft isn't clean.
- `$dynamicRef`/`$dynamicAnchor` (source-verified, `lib/vocabularies/dynamic/dynamicRef.ts`):
  - throws unless the reference is a bare fragment (`"$dynamicRef" only supports
hash fragment reference`) — cross-resource dynamic references are unsupported;
  - dynamic anchors live in a single **root-level registry** with
    first-assignment-wins at runtime — an emulation of `$recursiveRef` semantics,
    not 2020-12 lexical-scope + dynamic-scope resolution;
  - a `TODO` comment in the source acknowledges known-incorrect resolution cases.
- Community fixes exist and are stalled: open PRs/issues
  [#2615](https://github.com/ajv-validator/ajv/pull/2615),
  [#2622](https://github.com/ajv-validator/ajv/pull/2622),
  [#2573](https://github.com/ajv-validator/ajv/pull/2573),
  [#2642](https://github.com/ajv-validator/ajv/pull/2642) — all open as of
  2026-07. This is the clearest single signal that AJV will not get to full
  2020-12 on its own.
- The docs still describe 2020-12 as "the upcoming draft" / "the next JSON Schema
  draft" in places
  ([combining-schemas](https://ajv.js.org/guide/combining-schemas.html#extending-recursive-schemas)) —
  the 2020-12 work was done once, early, and not revisited.
- `unevaluatedProperties`/`unevaluatedItems` are implemented via bespoke
  static+dynamic "evaluated" tracking compiled into the generated code — a
  functional stand-in for annotation flow in the cases its static analysis
  understands, and the natural way to _lower_ the annotation model (§7.5), but in
  AJV it is the _only_ representation, which is why general annotation collection
  can't be retrofitted cheaply.
- Vocabularies: no real vocabulary system; `$vocabulary` is not processed
  meaningfully. Strict mode adds useful but non-spec schema rejections (its
  defaults reject spec-valid schemas until configured).
- draft-04 support was dropped from the core package in v8 (separate
  `ajv-draft-04` package) — relevant to the migration story, since a long tail of
  AJV users still run draft-04 schemas on ajv@6.

### 2.3 Annotations and output

None. No annotation collection, no Flag/Basic/Detailed/Verbose (2019-09/2020-12
style), no list/hierarchical (current output spec style). Errors are AJV-proprietary
objects (`keyword`, `instancePath`, `schemaPath`, `params`, `message`). `format` is
assertion-only via `ajv-formats`. This confirms the working assumption and defines
the compat-layer mapping surface (§8.1).

### 2.4 Performance posture

- Compiles each schema to a specialized JS function via an internal codegen DSL
  (`lib/compile/codegen/`, ~2.5k lines with the validate pipeline): tree-shaken
  keyword code, monomorphic shapes, no allocation on the happy path, subschema
  functions only where needed.
- The README's marketing claims — "The fastest JSON validator for Node.js and
  browser", "50% faster than the second place" — cite
  [json-schema-benchmark](https://github.com/ebdrup/json-schema-benchmark) and
  other draft-04-era harnesses; the README's performance chart still points at the
  long-dead Google Image Charts API. The claims are stale but directionally real:
  nothing interpreter-shaped in JS is currently near compiled-validator throughput
  for flag-style validation.
- Costs of the approach as AJV made it: requires `new Function`/`eval` (CSP-hostile
  environments need its separate standalone-codegen mode), compile time is
  significant on cold starts, and the generated code is error-centric with no
  evaluation-path bookkeeping — speed was bought partly by _not_ doing the things
  this project needs, though §7.4 argues that trade was unnecessary.

### 2.5 Maintenance and governance

- Release history tells the story: v8.17.1 (2024-07) → **19-month gap** → v8.18.0
  (2026-02), v8.19.0/v8.20.0 (2026-04). The recent releases are Node-version
  support, a type fix, a prototype-pollution fix — no spec-compliance work.
  356 open issues.
- The Mozilla MOSS grant funded the original 2019-09/JTD work; the OpenJS
  membership and the ReadySet maintainer-recruitment effort did not produce a
  sustained maintainer community; "v9" has been referenced in fundraising language
  ("once the next major version is released") for years without materializing.
- Conclusion: AJV is in **caretaker mode** — secure enough that it won't die,
  understaffed enough that deep spec work (which requires touching the codegen
  core) is not going to happen. Its dominance is self-sustaining via transitive
  dependencies regardless of quality, which is precisely why an upgrade path has
  to be offered _to_ its users rather than waiting for it to improve.

---

## 3. State of Hyperjump JSON Schema

Sources: [repo](https://github.com/hyperjump-io/json-schema),
[npm](https://www.npmjs.com/package/@hyperjump/json-schema), source inspection
(main @ 2026-07-01, v1.17.6).

### 3.1 Position and compliance

- Actively and responsively maintained by a single person (Jason Desrosiers):
  last commit 2026-07-01, 7 open issues. 174k weekly downloads.
- Bowtie 2020-12: **99% passing** — the reference-quality implementation in JS.
- Real multi-dialect support: draft-04/06/07/2019-09/2020-12 plus OpenAPI 3.0/3.1/3.2
  dialects, vocabularies as first-class objects (keywords are identified by URI,
  dialects are vocabulary sets, custom vocabularies/dialects are supported), media-type
  driven schema loading, schema bundling, compiled-validator serialization.

### 3.2 Output formats

From the README and `lib/core.js`: FLAG is the only **stable** output format.
BASIC and DETAILED are implemented as experimental evaluation plugins
(`lib/evaluation-plugins/basic-output.js`, `detailed-output.js`), documented with
"the output format is still evolving, so these may change or be replaced in the
future". There is no VERBOSE and no implementation of the newer output spec's
list/hierarchical formats. Output units carry `keyword` (a keyword-URI extension
field), `absoluteKeywordLocation`, and `instanceLocation` — **no `keywordLocation`**,
in errors or annotations.

### 3.3 The `keywordLocation` position

Verified verbatim from the (archived) json-schema-core README, and still true of
the current code:

> "This implementation does not include the suggested `keywordLocation` property in
> the output unit. I think `absoluteKeywordLocation`+`instanceLocation` is
> sufficient for debugging and it's awkward for the output to produce JSON Pointers
> that potentially won't resolve because they cross schema boundaries."

This conflates the two fields' purposes: `absoluteKeywordLocation` tells you _where
the keyword lives_; `keywordLocation` tells you _how evaluation got there_ — which
`$ref`/`$dynamicRef` chain, which `allOf` branch, which array position. For
annotation consumers (and for debugging dynamic references at all), the evaluation
path is the primary key, and it is not recoverable from the other two fields. Since
the objection is philosophical rather than technical, and the maintainer is
consistent about it, this is not going to change upstream — one of the concrete
justifications for a new engine rather than a PR.

### 3.4 Annotations

The annotation API exists but the whole surface is exported as
`@hyperjump/json-schema/annotations/experimental`. The `AnnotationsPlugin`
(`lib/evaluation-plugins/annotations.js`) correctly implements
annotation-dropping-on-failure semantics, and the annotated-instance API is
genuinely useful, but: no `keywordLocation` (same gap), no collection
configurability (all-or-nothing via plugin), and experimental status means no
stability contract — thin ice for anything load-bearing (a caution relevant to
the downstream project's D12, §10).

### 3.5 Performance posture (architecture-level)

The evaluation pipeline (from source): async `compile()` traverses schemas through
the `@hyperjump/browser` document abstraction with async generators and pubsub-based
meta-validation, producing an AST keyed by canonical schema URI; sync `interpret()`
walks that AST dispatching each keyword through a handler object, with **every
registered evaluation plugin's `beforeSchema`/`beforeKeyword`/`afterKeyword`/
`afterSchema` hooks called at every keyword application**, instances wrapped in
`JsonNode` cursor objects, and instance locations materialized as URI strings via
`Instance.uri()`. This is a clean, extensible reference architecture — and it pays
allocation + polymorphic dispatch + string-building costs per keyword that a
compiled validator simply doesn't have.

Community evidence it matters in practice:
[#85 "Validation is extremely slow (1.7 seconds)"](https://github.com/hyperjump-io/json-schema/issues/85)
(closed with improvements, 2025),
[#121 core keywords don't short-circuit](https://github.com/hyperjump-io/json-schema/issues/121).
No credible published head-to-head vs AJV exists (the classic benchmark suites
predate it), but architecturally the gap on hot-path flag validation should be
expected to be one to two orders of magnitude, which matches the anecdotal issue
reports. **For your own use: Hyperjump is fine for document-scale validation
(editor/CLI/viewer workloads) and the wrong tool for per-request or
million-instance workloads.** That is the gap the new engine exists to close.

### 3.6 Governance

The inverse of AJV: one highly engaged maintainer with strong opinions and no bus
factor. The single-maintainer risk is structural — the project _is_ its
maintainer's view of the spec, including where that view diverges (keywordLocation,
output stability). Sustainable, but not steerable from outside.

---

## 4. Prior art establishing the design range

- **[@exodus/schemasafe](https://github.com/ExodusMovement/schemasafe)** (~4.2M
  weekly): proof that **codegen and modern drafts are not incompatible** — a
  code-generating validator supporting draft-04 through 2020-12, with a
  "strict subset by default" philosophy and CSP-compatible generated code. Its
  existence undercuts any claim that AJV's gaps are inherent to compilation.
- **[@cfworker/json-schema](https://github.com/cfworker/json-schema)** (~5.2M
  weekly): interpreter built specifically because AJV's `new Function` codegen is
  banned in CSP-restricted runtimes (Cloudflare Workers). Demonstrates real demand
  for an interpreter tier as a _product feature_, not just a reference tier.
- **[Bowtie](https://bowtie.report/)**: cross-implementation compliance reporting
  against the official
  [JSON-Schema-Test-Suite](https://github.com/json-schema-org/JSON-Schema-Test-Suite);
  joining it is both the verification backbone and the marketing channel ("show,
  don't tell" against AJV's 80%).

The design range, then: AJV and schemasafe at the compiled end (fast, static,
error-centric), Hyperjump and cfworker at the interpreted end (complete or
CSP-safe, slow). Nothing in the JS ecosystem occupies "compiled + annotation-model

- spec-complete." That is the open position.

---

## 5. What the spec actually licenses (and encourages)

All quotes verified against
[draft-ietf-jsonschema-json-schema-02](https://www.ietf.org/archive/id/draft-ietf-jsonschema-json-schema-02.html)
(the consolidated IETF draft, 2020-12-metaschema-compatible).

- **Configurable collection is sanctioned, verbatim:** "The interface to access
  annotations may be highly configurable depending on the implementation, in such
  ways as limiting output to certain annotation keywords, aggregating values
  together, or other features to enhance performance." And: "Annotation output may
  be bypassed entirely." Also: "Because annotation collection can add significant
  cost in terms of both computation and memory, implementations MAY opt out of
  this feature." → §7.3's retention-policy API is squarely inside the spec, not an
  extension.
- **Keyword interactions are defined _in terms of_ annotations, not _by means of_
  them:** "Keyword behavior MAY be defined in terms of the annotation results of
  subschemas," and the draft moved its annotation implementation suggestions into
  an informative appendix ("Using annotations in implementations": "Annotations
  gathered while evaluating some keywords can be used to simplify the logic of
  evaluating other dependent keywords," with the `properties` →
  `additionalProperties`/`required`/`unevaluatedProperties` worked example). An
  implementation is free to carry that information through any internal mechanism
  with equivalent results — which is exactly the experimentation surface wanted
  here, and §7.2 makes it a first-class abstraction rather than an accident.
- **Unknown keywords become annotations:** "Implementations SHOULD treat keywords
  they do not recognize, or that they recognize but do not support, as
  annotations, where the value of the keyword is the value of the annotation." A
  cheap, high-value behavior neither AJV (throws or ignores per strict-mode
  config) nor most others get right.
- **Output:** the -02 draft retains 2020-12-style output — `keywordLocation` +
  optional `absoluteKeywordLocation` + `instanceLocation`, in Flag / Basic /
  Detailed / Verbose structures. Meanwhile the post-2020-12 output work
  ([spec doc](https://github.com/json-schema-org/json-schema-spec/blob/main/specs/output/jsonschema-validation-output-machines.md),
  [blog](https://json-schema.org/blog/posts/fixing-json-schema-output)) renames
  `keywordLocation` → `evaluationPath` and `absoluteKeywordLocation` →
  `schemaLocation`, with flag/list/hierarchical structures. → The engine should
  treat **evaluation path** as the internal concept and render either field
  vocabulary per requested format profile; both format families are then cheap
  projections of one result tree.

---

## 6. Why neither incumbent converges

Worth stating plainly because it justifies a new project on merits:

- AJV's compiler was designed around draft-07's needs: assertions and errors. The
  annotation model, dynamic scope, and vocabulary processing all require
  information flow its generated code deliberately doesn't carry. Adding them
  means rearchitecting the codegen core — the one thing a caretaker-mode project
  cannot staff. The stalled `$dynamicRef` PRs are the experiment already run.
- Hyperjump _has_ the semantics but its architecture (per-keyword plugin hooks,
  cursor wrappers, URI materialization) puts a ceiling on throughput, and its
  maintainer has a principled objection to a field this project considers a hard
  requirement. Neither a perf rewrite nor a `keywordLocation` PR is a realistic
  path.
- Both have governance failure modes that are mirror images: AJV has users and no
  maintainers; Hyperjump has a maintainer and (comparatively) no users. A new
  project should be designed against _both_ failure modes from day one (§12).

---

## 7. Recommended architecture

An **annotation-first, two-tier engine**. One semantic definition of every
keyword; two execution strategies over it.

### 7.1 Semantic core (interpreter tier)

- **Dialect/vocabulary registry as data.** Keywords identified by URI (Hyperjump's
  registry concept is the right _idea_; adopt the idea, not the code), dialects =
  ordered vocabulary sets, drafts = predefined dialects. Custom keywords,
  vocabularies, and dialects are the same mechanism the built-ins use — no
  privileged path, which is what keeps the compiler tier honest (§7.5).
- **Keyword behavior interface** (sketch): `analyze(schemaCtx)` → static info for
  the compiler; `evaluate(instanceCursor, evalCtx)` → assertion verdict +
  productions into the evaluation state (§7.2). Applicator keywords receive a
  subschema-evaluation callback from the engine rather than recursing themselves,
  so the engine owns path/scope bookkeeping in exactly one place.
- **Evaluation context** tracks: evaluation path (the `keywordLocation` /
  `evaluationPath` value), lexical scope (base URI, active dialect), dynamic scope
  (for `$dynamicRef` — full 2020-12 semantics: lexical-first-then-dynamic
  bookended resolution, per-resource anchors, cross-resource refs; the exact
  things AJV gets wrong and your oas-tree-viewer work has already mapped),
  evaluated-names/indexes state, and the annotation channel.
- **Sync evaluation, async only at the resource boundary.** Loading/registration
  (network, filesystem, media types) is async; `compile` and `evaluate` are sync.
  Hyperjump's async compile via generator pipelines is a real ergonomic and
  performance tax; resource resolution is the only genuinely async concern.
- **CSP-safe by construction** — the interpreter is the product for edge runtimes
  (cfworker's entire niche), not just the reference.

### 7.2 Evaluation state as channels (the keyword-communication experiment surface)

Internally, keywords _produce_ typed facts (`properties` produces the matched
property-name set; `prefixItems` produces the max evaluated index; any keyword may
produce its annotation value) and _consume_ facts from a scoped evaluation state.
The standard annotation collector is just one subscriber to this channel; the
`unevaluated*` keywords are another; a future experimental keyword mechanism per
the IETF draft's appendix is a third. This gives:

- spec-exact behavior (annotation dropping on failed schemas is a property of the
  channel's scoping rules, implemented once);
- a place to try keyword-communication mechanisms that are _not_ annotations
  without touching the engine core;
- a natural point for the retention policy (§7.3) to filter what escapes to output
  versus what exists only transiently for dependent keywords.

### 7.3 Configurable annotation collection

A retention policy, supplied at compile time (so the compiler tier can specialize)
and defaulting to "none" for flag-mode: include/exclude by keyword name, by
vocabulary URI, by schema-location prefix, by instance-location pattern; plus
"transient" retention where a value is kept only long enough to serve dependent
keywords. Spec cover is direct (§5, first bullet). This is also the honest answer
to "annotations are too slow to always collect": make the cost opt-in and visible.

### 7.4 Why `keywordLocation` is nearly free (the load-bearing performance claim)

In an interpreter, the evaluation path is a push/pop on the context the engine
already maintains — materialize the JSON Pointer string only when an output unit
is actually emitted (lazy materialization; errors and retained annotations are the
rare path). In compiled code it is better still: **at every emit site the
evaluation path is a compile-time constant** — the compiler knows it is at
`/properties/foo/allOf/1/pattern` when it emits that check, including through
static `$ref` chains (each compiled schema-resource function takes its caller's
path prefix; for the static case that prefix is a constant argument or is inlined).
Only `$dynamicRef` requires runtime path composition, and dynamic islands fall
back to the interpreter anyway (§7.5). Conclusion: AJV-class flag throughput and
full evaluation-path output are not in tension; AJV's omission was a design
choice, not physics. This claim should be validated early with a spike benchmark
(§13), because the whole positioning rests on it.

### 7.5 Compiler tier

- **Static analysis pass** over the compiled-form schema classifies each subschema:
  _static_ (no dynamic-scope sensitivity, no runtime dialect switching, retention
  policy resolvable at compile time) or _dynamic_. Experience says the
  overwhelming majority of real-world schemas — and near-100% of the AJV-migration
  corpus, which is draft-07-shaped — are fully static.
- **Lowering:** for static subschemas, keyword semantics are lowered to specialized
  JS: annotation productions that nothing consumes are compiled away (verdict via
  the channel-consumer graph, e.g. `unevaluatedProperties` present or retention
  policy matches); productions consumed only by `unevaluated*` are lowered to
  evaluated-set bitmask/set tracking (the AJV/schemasafe trick, but _derived from_
  the annotation model rather than replacing it); retained annotations compile to
  constant-path emit sites.
- **Dynamic islands** (`$dynamicRef` targets and everything downstream of a
  dynamic-scope dependency) trampoline into the interpreter with the compiled
  code's current context. Correctness never depends on the optimizer's coverage.
- **Config-specialized compilation:** a schema compiled under retention policy P
  is a different (memoized) artifact than under P′ — this is the capability AJV
  structurally lacks and the reason "configurable annotations" and "fast" compose
  here.
- **Standalone code generation** (emit source text, not `new Function`) as a
  build-time mode: serverless cold starts, CSP with precompiled validators, and a
  drop-in answer to AJV's standalone mode.
- Both tiers run the **same official test suite and the same keyword registry**;
  the compiler is _forbidden_ to have keyword knowledge not derived from
  `analyze()` — that single constraint is what prevents the semantic fork that
  killed AJV's spec agility.

### 7.6 Output formats

One internal result tree; renderers for: 2020-12/-02-draft Flag/Basic/Detailed/
Verbose with `keywordLocation` + `absoluteKeywordLocation`, and current-output-spec
flag/list/hierarchical with `evaluationPath` + `schemaLocation`. Format choice and
field-vocabulary choice are orthogonal knobs; both families are thin projections.

### 7.7 Multi-draft support and what narrower scope would save

Full native span: draft-04 → 2020-12 → current IETF drafts, as dialect definitions
over the same registry. Realistic effort deltas:

- **2020-12 + IETF drafts only:** saves perhaps 35–40% of total keyword-behavior
  and reference-semantics surface (draft-04's `id`/boolean-exclusive*/no-`$ref`-
  siblings quirks; draft-06/07 deltas; 2019-09's `$recursiveRef` and
  `definitions`/`dependencies` shims) — but forfeits the AJV market, whose center
  of mass is draft-07 with a draft-04 tail. Not compatible with the stated goal.
- **2019-09+ native with draft-04/06/07 as a compatibility layer** (schema
  upgrading or keyword-shim dialects): saves maybe 20% and keeps most of the
  migration story, at the cost of edge-case fidelity for the oldest schemas
  (draft-04 `exclusiveMinimum` etc. shim cleanly; `$ref`-ignores-siblings and
  draft-04 `id` scoping do not always).
- **Recommended:** native draft-07/2019-09/2020-12/IETF-drafts in the core;
  draft-04/06 as a separately-packaged legacy dialect module (mirroring AJV's own
  `ajv-draft-04` split, so the migration mapping stays 1:1). This concentrates the
  effort where the market is without freezing the old quirks into the core.

---

## 8. Migration paths

### 8.1 AJV (`ajv-compat` package) — market-critical

A drop-in adapter exposing AJV's dominant API surface over the new engine:
`new Ajv(options)` / `Ajv2019` / `Ajv2020`, `compile`, `validate`, `addSchema`,
`getSchema`, `addFormat`, `addKeyword`, `errors` — with an error adapter mapping
output units to AJV error objects (`instanceLocation`→`instancePath`, evaluation
path→`schemaPath`, keyword params reconstructed per keyword). Honest boundaries,
documented per option:

- **Emulatable:** the object-style custom keywords (`validate`, `compile`,
  `macro`), formats (ship an `ajv-formats`-parity module), `allErrors`,
  `verbose`-ish data, most schema-management APIs.
- **Not emulatable:** `code`-style custom keywords written against AJV's codegen
  internals (`KeywordCxt`, its codegen DSL) — these are AJV-implementation-coupled
  by definition; the adapter should detect and fail loudly with a porting guide.
  Likewise strict-mode's exact non-spec rejections (provide a lint layer instead,
  §14) and `$data` references (assess demand before committing).
- **Wedge targets, in order:** OpenAPI 3.1+ tooling (blocked on real 2020-12
  today — this is the constituency actively suffering), fastify's pluggable
  validator-compiler slot, then the long tail via codemod + compat package.
  Transitive-dependency users (eslint et al.) are not migration targets and don't
  need to be.

### 8.2 Hyperjump (`hyperjump-compat` or a migration guide + thin shim)

Smaller and easier: `registerSchema`/`validate(schemaUri, instance, outputFormat)`
map nearly 1:1; the annotations-experimental API maps onto the annotation channel
with _more_ fields (adding `keywordLocation` is additive — output-unit consumers
keep working); media-type-driven loading is a resource-loader plugin. The main
behavioral deltas to document: sync-vs-async evaluate, keyword-URI naming in the
`keyword` field (worth keeping — it's a genuinely good idea), and stable-vs-
experimental output formats becoming all-stable.

---

## 9. Performance strategy

- **Tier expectations, stated honestly:** interpreter tier lands in Hyperjump's
  order of magnitude (target: beat it via sync evaluation, no per-keyword plugin
  hooks, lazy string materialization); compiler tier targets AJV-class flag-mode
  throughput on the static corpus. The differentiator is not "faster than AJV" —
  it is "AJV-class speed _with_ 100% compliance and annotations," verified in
  public via Bowtie.
- **Techniques** (all standard, none AJV-specific): monomorphic compiled functions
  per subschema; allocation-free happy path; short-circuit in flag mode
  (spec-legal since annotation collection is bypassed); evaluated-set lowering for
  `unevaluated*`; compile-time regex/format precompilation; lazy output-unit
  materialization; memoized config-specialized artifacts (§7.5).
- **Benchmarking is future work, deliberately:** the existing public benchmarks
  (json-schema-benchmark etc.) are draft-04-era and should not be cited except as
  history. Plan: a small open harness over (a) the official test suite as a
  correctness gate, (b) representative real-world corpora — OpenAPI documents,
  API-payload schemas, the AJV-migration shape — measured for compile time, first
  validation, hot-path throughput, and annotation-on overhead. Publishing the
  harness alongside Bowtie compliance is the credibility package the AJV pitch
  needs. The §7.4 constant-path claim gets a dedicated spike before the
  architecture is committed.

---

## 10. Relationship to the downstream project (aware, not coupled)

`~/src/oas-codegen-replacement/DESIGN.md` D12 pins `@hyperjump/json-schema` for
document validation and runtime residuals, with the explicit revisit trigger
"annotation-collection API limits the lowering pipeline → evaluate alternatives
then." This engine, if built, is that alternative: the lowering pipeline's
annotation needs (`readOnly`/`writeOnly`, discriminators, extension-keyword
annotations, per-location retention) map directly onto §7.3, and D9's
runtime-checked residuals could eventually use the compiler tier to generate
standalone residual validators (D9's own noted "bigger lift, later"). Also note
§3.4: the downstream project's current dependency rests on Hyperjump's
_experimental_ annotation surface — a stability risk worth logging against D12
regardless of whether this project proceeds. No design coupling in either
direction beyond that; the engine must stand as a general-purpose JSON Schema
implementation or it will end up an internal of the downstream project.

## 11. IP policy

- Implementation is written from the specifications and the official
  JSON-Schema-Test-Suite; test-suite-driven development is the clean-room
  discipline.
- AJV and Hyperjump were studied at the architecture level for this analysis
  (evaluation strategies, module boundaries, failure modes). Design _ideas_ noted
  for adoption — keyword-URI registries, evaluated-set lowering, standalone
  codegen, media-type loading — are unprotectable concepts also present across
  the wider ecosystem. No code, code structure, identifier scheme, or
  documentation text is to be ported or translated from either codebase (both are
  MIT, but the bar here is "no colorable derivation claim," not "license
  compliance").
- Compat-layer API surfaces (§8) reproduce _interfaces_ for interoperability —
  the legally distinct and well-trodden category — not implementations.

## 12. Governance and sustainability (designing against both incumbents' failure modes)

- **Against the intractable-maintainer mode:** semantics live in the spec + test
  suite, not in a person: keyword behaviors as data/plugins, a lightweight RFC
  process for anything touching the keyword interface, and a published policy that
  spec-conformance disputes are settled by the test suite and the spec text.
- **Against the maintainer-vacuum mode:** minimum two maintainers with release
  rights from day one under a neutral org; conformance-gated releases (Bowtie +
  suite must be green) so releases stay safe even when review bandwidth is thin;
  the compiler tier isolated so the high-expertise surface area is small.
- **Funding:** grants bootstrap but don't sustain (AJV is the case study).
  Realistic paths: corporate underwriting from OpenAPI-tooling vendors (the
  constituency blocked on 2020-12 — and per the downstream project's competitive analyses,
  substrate libraries are commoditizing in exactly this space), Tidelift/
  thanks.dev passive income, and keeping scope small enough that maintenance is
  measured in hours/month. A conformance-profile relationship with your OAS test
  suite project is a natural adjacency.

## 13. Suggested validation sequence (pre-implementation)

1. **Spike the §7.4 claim:** hand-write the "compiled" output for 2–3 schemas
   (one draft-07-shaped, one with `unevaluatedProperties`, one with retained
   annotations) and benchmark against ajv@8 and @hyperjump/json-schema. If
   constant-path emission doesn't hold AJV-class throughput, the architecture
   needs rethinking _before_ any engine exists.
2. **Prototype the channel abstraction (§7.2)** in a toy interpreter over ~10
   keywords including the `properties`→`unevaluatedProperties` dependency; check
   that annotation dropping and the retention policy fall out of scoping rules.
3. **Draft the ajv-compat surface** against real consumers (an OpenAPI validator,
   a fastify app) to size the emulatable/not-emulatable boundary empirically.
4. Then, and only then, an engineering design (packages, module boundaries,
   milestones) in the DESIGN.md style.

## 14. Open questions

- **Spec (for the co-author, i.e. you):** Should new output default to the
  `evaluationPath`/`schemaLocation` vocabulary with 2020-12 field names as a
  compatibility rendering, or the reverse? Is there appetite for standardized
  _annotation_ test cases (the official suite exercises validation; annotation
  behavior — especially dropping and `unevaluated*` interaction — has thin
  third-party coverage, which weakens any implementation's "fully compliant"
  claim on exactly the features this project leads with)? And is the -02
  appendix's keyword-communication material expected to grow into something an
  implementation should expose experimentally (§7.2 assumes yes)?
- **Strict-mode demand:** AJV users partly rely on strict mode's non-spec schema
  rejections. Proposed answer: a separate opt-in lint layer (spec-clean core,
  lint for hygiene) — needs validation against real migration candidates. This
  also has obvious overlap with your OAS-viewer library/CLI/SARIF roadmap.
- **`$data` references:** AJV-proprietary, moderately used. Support in compat
  only, or not at all?
- **Scope of formats:** assertion-mode format per Format-Assertion vocabulary
  with full RFC-grade validators is its own sub-project (Hyperjump ships
  `formats`/`formats-lite`; AJV delegates to `ajv-formats`). Recommend a separate
  package from day one.
- **Name/scope:** unclaimed; needs an npm scope decision before any public
  artifact.

---

## Appendix: fact table (as of 2026-07-05)

|                                      | AJV                                                                     | @hyperjump/json-schema                                            |
| ------------------------------------ | ----------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Version                              | 8.20.0 (2026-04-24)                                                     | 1.17.6 (active, last push 2026-07-03)                             |
| Weekly npm downloads                 | 316,245,732                                                             | 174,042                                                           |
| GitHub                               | 14.8k ★, 356 open issues                                                | 311 ★, 7 open issues                                              |
| Bowtie 2020-12                       | 80%                                                                     | 99%                                                               |
| Bowtie 2019-09 / draft-07 / draft-04 | 83% / 85% / (separate pkg)                                              | 99% / 98% / 98%                                                   |
| Drafts                               | 04 (separate pkg), 06, 07, 2019-09, 2020-12 (partial)                   | 04, 06, 07, 2019-09, 2020-12, OpenAPI 3.0/3.1/3.2 dialects        |
| Annotations                          | none                                                                    | experimental, no `keywordLocation`, not configurable              |
| Output formats                       | proprietary errors only                                                 | FLAG stable; BASIC/DETAILED experimental; no VERBOSE/hierarchical |
| `$dynamicRef`                        | fragment-only, root-registry approximation, known broken, fixes stalled | correct                                                           |
| Vocabularies                         | not meaningfully processed                                              | first-class                                                       |
| Execution                            | compiled (`new Function`; standalone mode for CSP)                      | async compile, sync interpret; CSP-safe                           |
| Maintenance                          | caretaker mode (19-month release gap 2024–26)                           | single active maintainer                                          |
