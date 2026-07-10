# JSON Schema engine: engineering design

**Status:** living design contract, implementation through M8 + M10 complete —
see [STATUS.md](STATUS.md) for the authoritative current state (built
milestones, gates, and deliberately staged work). Successor to
[ANALYSIS.md](ANALYSIS.md) (market/architecture analysis) as validated by
[SPIKE.md](SPIKE.md) (F1 performance spike) and `prototype/` (F2 channels
prototype). Milestone status notes below are historical records kept for
session continuity; a split into architecture/ADR/changelog documents is
in the deferred register.

**How to use this document:** it is the contract for implementation sessions.
A fresh session (any model) should be able to pick up one milestone from §6
with only this file, the repo, and the referenced specs. Each milestone names
a mechanical done-signal; a milestone is not done until its signal is green.
The **model-tier column is advisory routing**: "patterned" milestones follow
exemplars and are suitable for Sonnet-class sessions; "judgment" milestones
change interfaces or semantics and should go to Opus/Fable-class sessions.

Normative references: [draft-ietf-jsonschema-json-schema-02](https://www.ietf.org/archive/id/draft-ietf-jsonschema-json-schema-02.html)
(compatible with the 2020-12 metaschema), the 2020-12 spec pair, the
[output spec](https://github.com/json-schema-org/json-schema-spec/blob/main/specs/output/jsonschema-validation-output-machines.md),
and the [official test suite](https://github.com/json-schema-org/JSON-Schema-Test-Suite).

---

## 1. Decision register

| #   | Decision                              | Choice                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Why / evidence                                                                                                                                                                                                                                                                                                         | Revisit trigger                                                                                                                           |
| --- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Execution model                       | **Two tiers, one keyword registry**: interpreter core (reference semantics) + compiler emitting specialized JS for static subschemas, trampolining to the interpreter for dynamic islands. The compiler may consume **only** `analyze()` output from keyword behaviors — no keyword knowledge hard-coded in the compiler. **Amended (M6.1, 2026-07-06):** per-keyword compiled forms come from the optional `lower()` slot on the keyword behavior itself, expressed as IR through `LoweringContext` (§7) — never JavaScript text, never compiler-side name dispatch. Keyword knowledge stays in exactly one module per keyword; the compiler owns planning, descent, frames, locations, and serialization. A keyword without `lower()` makes its schema object an interpreted unit (trampoline fallback).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | SPIKE.md: hand-emitted artifacts beat ajv flag mode (0.46–0.87×) with constant-location output; the analyze-only rule prevents the semantic fork that froze AJV                                                                                                                                                        | Compiler needs a fact `analyze()` can't express → extend `StaticFacts`, never special-case                                                |
| D2  | Keyword identity                      | Keywords identified by **URI**; a vocabulary is a named map of keyword URIs; a dialect is an ordered set of vocabularies; drafts are predefined dialects. All data, no privileged built-ins.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Enables multi-draft + custom vocabularies with one mechanism (idea also proven in the ecosystem; implementation is ours per D15)                                                                                                                                                                                       | —                                                                                                                                         |
| D3  | Keyword interface                     | `analyze(schemaValue, lexicalScope) → StaticFacts` + `evaluate(schemaValue, cursor, ctx) → boolean` (§3). Applicators request subschema application through the engine; the engine owns path/scope/frame bookkeeping in exactly one place.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Prototype: 30 keywords fit this shape; engine-owned descent is what makes locations constants for the compiler                                                                                                                                                                                                         | —                                                                                                                                         |
| D4  | Keyword communication                 | **Frame-scoped production channel** (§4): schema application pushes a frame; productions merge to the parent frame only on success. Annotation dropping, in-place-applicator visibility for `unevaluated*`, and cousin-invisibility all fall out of the one scoping rule.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Prototype: 852 suite cases + channels tests pass with no per-keyword special cases                                                                                                                                                                                                                                     | IETF keyword-communication experiments needing non-annotation payloads → add production kinds, not mechanisms                             |
| D5  | Annotation retention                  | Retention policy supplied at compile/evaluate time: allow-list by keyword name and vocabulary URI, schema/instance-location predicates; internal consumers always see the channel regardless of retention ("transient" retention). Compiler memoizes one artifact per (schema, policy, output config). **Amended (owner request, M5.5, 2026-07-06):** deny lists (`excludeKeywords`/`excludeVocabularies`) subtract after the allow lists, before the predicate. The interpreter elides productions at produce time when they are provably neither consumed (registry-accumulated `StaticFacts.consumes`) nor retainable (collection off, or ruled out by the lists; the `keep` predicate only runs at render, so recording its superset is required). Elision never runs while tracing. **Consumers MUST declare `consumes` in `analyze()`** — `ctx.visible()` throws `UndeclaredConsumptionError` for undeclared ids while elision is active, so a violation is loud, never a silently empty channel. Verified by an elision-on/off differential over all four dialect suites.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Spec-sanctioned (ANALYSIS.md §5 quotes); SPIKE.md: policy-specialized artifact 32M ops/s vs 51M with annotations fully elided — cost proportional to retention. Interpreter-side elision buys allocation/GC relief but only ~2% throughput (interpretation dominates); the CPU win is D9b's, in the compiler           | —                                                                                                                                         |
| D6  | Output                                | Evaluation path tracked natively (constant in compiled code; push/pop + lazy string materialization in the interpreter). One internal result tree; renderers for 2020-12/-02 Flag/Basic/Detailed/Verbose with `keywordLocation`/`absoluteKeywordLocation` **and** current-output-spec flag/list/hierarchical with `evaluationPath`/`schemaLocation`. Field vocabulary and structure are orthogonal knobs. **Default field vocabulary: `evaluationPath`/`schemaLocation`**, with the 2020-12 names as a compatibility option (owner decision, 2026-07-05).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | The engine exists partly because both incumbents refuse half of this                                                                                                                                                                                                                                                   | Output spec changes upstream                                                                                                              |
| D7  | Async boundary                        | Loading/registration async (loaders for file/http/media types); **`compile` and `evaluate` are sync**.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Hyperjump's async-generator compile pipeline is a real tax; resource I/O is the only inherent async                                                                                                                                                                                                                    | —                                                                                                                                         |
| D8  | Dynamic scope                         | Full 2020-12 `$dynamicRef` semantics: dynamic scope = stack of entered schema resources; resolution requires the anchor lexically at the target, then rebinds to the outermost dynamic scope containing a matching `$dynamicAnchor`. 2019-09 `$recursiveRef/(Anchor)` as the degenerate case. Compiler marks everything dynamically reachable from a `$dynamicRef`-influenced scope as a dynamic island → interpreter trampoline with the compiled caller's scope stack.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | The single thing AJV got structurally wrong (fragment-only, root-registry, first-write-wins); prior art in the user's oas-tree-viewer `dynamicScope.ts` strict-winner analysis                                                                                                                                         | —                                                                                                                                         |
| D9  | Lowering catalogue                    | Compiler lowerings, each licensed by `StaticFacts`: (a) `unevaluated*` → static evaluated-name/index sets when all contributors are static, else runtime evaluated-set tracking; (b) production elision when no consumer (retention ∪ dependent keywords) exists; (c) constant-location emit sites incl. through static `$ref`; (d) small-set membership → equality chains (threshold ~8, measure), else hoisted `Set`; (e) lazy error/annotation unit materialization; (f) regex/format hoisting.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | SPIKE.md findings 1–5 (finding 4: equality-chain vs `Set.has` moved a ratio from 1.34 to 0.82)                                                                                                                                                                                                                         | Benchmarks show a lowering never pays                                                                                                     |
| D10 | Compiler output modes                 | Runtime compilation (`new Function`) **and** standalone source emission (build-time artifact, CSP-safe, serverless cold-start). Interpreter is the always-available CSP-safe fallback.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Matches ajv standalone + cfworker niches; spike modeled the standalone case                                                                                                                                                                                                                                            | —                                                                                                                                         |
| D11 | Draft support                         | Native in core: 2020-12, IETF drafts, 2019-09, draft-07, **draft-06** (owner amendment 2026-07-06: draft-06 is a compatible subset of draft-07, so it rides along in M4). draft-04 as a separately packaged legacy dialect module (M10). **Amended (2026-07-07):** separate packaging retained but RE-JUSTIFIED — the driver is no longer AJV migration (`ajv-draft-04` users are not a wedge; AJV's draft-04 support is unproblematic in production) but the owner's oaskit project needing draft-04 alongside later drafts. Packaging never limited capability: a separately packaged dialect registers into the same engine and coexists with every draft in one registry (the D18 extractor + `refIgnoresSiblings` hooks were built for exactly this). New rationale: (a) core's native-drafts story stays spec-clean (no vendored draft-04 metaschema, `id` extractor, boolean `exclusive*`, or draft-04 `integer` semantics in every consumer's bundle); (b) the package is the reference proof of the PUBLIC dialect-authoring surface — the same path oaskit's OAS 3.0 Schema dialect (draft-04-based + `nullable`/`discriminator`/`xml`) will follow. M10 MUST build against the public registry API only; any needed private hook is a core extension-surface bug to fix, never a reason to fold draft-04 into core. oaskit is the integration point (depends on the package, registers the dialect in its setup path).                                                                                                                                                                                                                                                                                                               | ANALYSIS.md §7.7: market center of mass is draft-07+; only draft-04's genuinely different syntax (`id`, boolean `exclusive*`) stays out of core                                                                                                                                                                        | ajv-compat adoption data shows heavy draft-04 demand                                                                                      |
| D12 | Testing strategy                      | Official suite as git submodule with a generated runner; **both tiers must pass the identical suite**; differential fuzzing (interpreter vs compiler on suite schemas × mutated instances) as the compiler's primary correctness gate; Bowtie harness from M3; releases are conformance-gated (suite + Bowtie green or no release).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | The suite is the clean-room discipline (D15) and the marketing story                                                                                                                                                                                                                                                   | —                                                                                                                                         |
| D13 | Error model                           | Keywords emit structured error data (keyword id, params, message key) into units; message rendering is a presentation concern. Params designed so ajv-compat can reconstruct `instancePath`/`schemaPath`/`params` mechanically.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Compat layer must not parse message strings                                                                                                                                                                                                                                                                            | —                                                                                                                                         |
| D14 | Strictness                            | Validator core is spec-clean (spec-valid schemas evaluate per spec; unknown keywords annotate per SHOULD). AJV-strict-style schema hygiene is **opt-in only**, via two paths: (a) a separate lint layer, out of the validation path; (b) **stricter meta-schemas** covering the common strict-mode use cases — worth offering as the idiomatic migration path since it stays inside the spec's own extension model. ajv-compat may enable hygiene checks where AJV's defaults imply them, since compat mode is itself opt-in.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Owner decision 2026-07-05; ANALYSIS.md §14; overlaps the user's OAS-viewer lint/SARIF roadmap                                                                                                                                                                                                                          | —                                                                                                                                         |
| D15 | IP policy                             | Implementation from specs + official suite only. AJV/Hyperjump may be executed as oracles/benchmarks; their code is never read for implementation, ported, or translated. Concepts noted in ANALYSIS.md §11 (keyword-URI registries, evaluated-set lowering, standalone emission, media-type loading) are used as ideas. Compat layers reproduce public API _surfaces_ only. **This policy binds every implementation session, including subagents — restate it in any task prompt.**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | No colorable derivation claim, per project owner                                                                                                                                                                                                                                                                       | —                                                                                                                                         |
| D16 | Packaging                             | Monorepo, npm workspaces; packages under a scope TBD (owner decision, M0 blocker): `core`, `compiler`, `formats`, `dialect-draft04` (named `dialect-legacy` until M10 landed under the draft-04-specific name), `ajv-compat`, `test-kit` (suite runner + differential fuzzer), `bench`. `hyperjump-compat` later, likely just a documented shim.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Mirrors the staging in §6                                                                                                                                                                                                                                                                                              | —                                                                                                                                         |
| D18 | Per-dialect identifier syntax         | Identifier extraction is **dialect data**, not keyword behavior: `DialectOptions.identifiers` is an `IdentifierExtractor` `(schemaObject) → { baseId?, anchors?, dynamicAnchor?, recursiveAnchor? }`, consumed by the registration walk and by JSON Pointer navigation (which uses the target document's dialect). Shipped extractors: 2020-12 (`$id`/`$anchor`/`$dynamicAnchor`), 2019-09 (`$id`/`$anchor`/boolean `$recursiveAnchor`, root-effective), legacy draft-07/06 (`$id` only; plain-fragment `$id` mints an anchor; **`$ref` present ⇒ no identifiers at all**, which yields the suite's sibling-`$id` suppression). Companion option `refIgnoresSiblings` (draft-07/06): a schema object with `$ref` evaluates only `$ref` — siblings act as if absent ("ignores", not "overrides": nothing about their values changes, they are simply not there for evaluation). `$vocabulary`-assembled dialects inherit the extractor of whichever core vocabulary they include.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | draft-07/06 in core (D11) need identifier and `$ref` semantics that no keyword-level mechanism can express; extractors keep the registry draft-agnostic                                                                                                                                                                | A draft whose identifiers depend on evaluation state (none known)                                                                         |
| D17 | Source-position correlation           | Loaders MAY report positions: a loader returns `{ value, getRange?: (documentRootPointer) => Range \| undefined }` — a _function_, so implementations can keep a parse AST and resolve lazily instead of materializing a map. `Range` distinguishes **key range vs value range** for object members (diagnostics point at keys for missing/extra-property errors, values for type errors; SARIF/LSP need both). The registry records a `resource base URI → (document URI, document-root pointer prefix)` table during the registration walk, so canonical `schemaLocation`s (which are resource-rooted) translate to document-rooted pointers for lookup. Correlation happens only at unit escape or via an on-demand `locate()` helper — **zero hot-path cost, zero cost when no loader provides positions**. Instance-side correlation uses the same `getRange` interface against `instanceLocation` and needs no registry involvement. The M6 compiler is unaffected (constant location strings; correlation is post-hoc).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Owner request 2026-07-05: diagnostics tooling (SARIF/LSP-class consumers) needs pointer→line/column                                                                                                                                                                                                                    | Position-map memory becomes a problem for huge documents → the function interface already permits offset-only or windowed implementations |
| D19 | Non-schema values in schema positions | **Fail loud, in two layers (owner decision 2026-07-06):** the registration walk throws `InvalidSchemaError` when a keyword-claimed schema position holds a value that is neither an object nor a boolean; `applySchema` throws the same error as a lazy backstop for positions the walk cannot see (a `$ref` whose pointer lands inside unwalked data). The line that prevents scope creep: **schema-shape errors are structural and the engine's own; keyword-value validity (`minLength: "3"`) stays the metaschema's job** (`validateSchemas`, D14 lint layer) — no per-keyword value policing in core. Which positions are schema positions is dialect-defined via `analyze()` (draft-07 tuple `items` claims elements; 2020-12 `items` claims its whole value), so the same document can register under one dialect and throw under another.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Silent inertness of invalid applicator values was a migration footgun — draft-07 tuple `items` under 2020-12 validated everything without a sound. Both checks are free: registration-time shape test per position, and the evaluation-time branch already existed                                                     | Users need lenient registration of known-invalid documents → add an opt-out flag then, not now                                            |
| D20 | Resource-exhaustion bounds            | **Interpreter-level DoS defenses, pre-M6 (owner decision 2026-07-06, M5.6).** Threat model: untrusted _schemas_ and _instances_ can exhaust CPU/stack independent of correctness, and the M6 differential fuzzer cannot catch this (interpreter and compiler share the regex engine, the stack, and O(n²) — they agree while the vector stays live). Three defenses. **(1) ReDoS:** `pattern`/`patternProperties` compile untrusted regex and run it on untrusted input. A pluggable `regexEngine` (default native `RegExp`, per-engine compile cache) lets callers inject a linear-time engine (RE2) for the hard guarantee; a conservative star-height detector (`detectUnsafeRegex`, exported for the D14 lint layer) backs opt-in `rejectUnsafeRegex`, which throws `UnsafeRegexError` at registration. Keyword regexes are declared via `StaticFacts.regexes`; the registry's `onRegex` hook is installed after the trusted metaschemas register, so the screen applies only to caller schemas. **(2) `uniqueItems`:** O(n) bucketing by a canonical key (`canonicalKey`), confirming key collisions with `jsonEqual` for spec-exactness. **(3) Depth:** a `maxDepth` bound (default `DEFAULT_MAX_DEPTH`, below the native stack ceiling) throws the typed, catchable `MaxDepthExceededError` from both the registration walk and `applySchema`, replacing an uncatchable-by-type `RangeError`; a boundary catch converts any native overflow (if `maxDepth` is raised past the stack) to the same error. Fresh eval state per run keeps the engine reusable after a throw. **Scope line:** these are resource _bounds_, not validity — a rejected pattern or exceeded depth is an operational limit, not a schema/instance being invalid. | schemasafe's Secure-code-generation guidance flagged the class; probes confirmed all three live in the interpreter (ReDoS hang, 100k uniqueItems = 3.8s, deep input → native stack overflow). schemasafe's own code-generation escaping concerns are inapplicable to the interpreter (it emits no code) and move to M6 | A guarantee stronger than the heuristic detector is needed → the `regexEngine` hook already delivers it; codegen-time escaping is M6's    |

## 2. System shape

```
                    ┌────────────────────────────────────────────┐
                    │                 registry                   │
                    │ documents · $id/$anchor index · dialects · │
                    │ vocabularies · keyword behaviors (by URI)  │
                    └────────────┬───────────────┬───────────────┘
                          analyze() facts   evaluate() impls
                                 │               │
                    ┌────────────▼──┐      ┌─────▼──────────────┐
   schema ──────►   │  compiler     │      │  interpreter core  │
   + retention      │  (static      │      │  ctx: eval path ·  │
   policy           │  subschemas)  │      │  lexical+dynamic   │
                    │               │─────►│  scope · channel   │
                    │ emit JS with  │ tram-│  frames            │
                    │ constant      │ po-  └─────┬──────────────┘
                    │ locations     │ line       │ productions/errors
                    └────────┬──────┘            │
                             ▼                   ▼
                      compiled artifact    result tree ──► output renderers
                      (per schema ×        (both field vocabularies,
                       policy × config)     all structures)
```

The prototype (`prototype/`) is the interpreter column in miniature and is the
semantic reference for M1; `spike/compiled.ts` is the compiler column's target
output shape for M6. Both are throwaway code with non-throwaway semantics:
**promote the semantics and the test expectations, rewrite the code.**

## 3. Keyword behavior interface (normative for M1+)

```ts
interface KeywordBehavior<V = JsonValue> {
  readonly id: string; // keyword URI (D2)
  // Static facts for the compiler and for schema preprocessing. Pure.
  analyze?(value: V, scope: LexicalScope): StaticFacts;
  // Interpreter semantics. Sync (D7). Applicators use ctx.applyChild/applyRef;
  // they never recurse into the engine themselves.
  evaluate(value: V, cursor: InstanceCursor, ctx: EvalContext): boolean;
}

interface StaticFacts {
  subschemas?: SubschemaPosition[]; // where child schemas live
  references?: string[]; // reference URIs in the keyword value
  // (drives transitive loading, D7)
  produces?: ProductionKind[]; // channel productions it can emit
  consumes?: ProductionKind[]; // channel productions it reads
  evaluatesNames?: StaticNameSet; // static contribution to evaluated props
  evaluatesIndexes?: StaticIndexSpan; // static contribution to evaluated items
  dynamicScopeSensitive?: boolean; // $dynamicRef and friends (D8)
}
```

Engine-owned context services (the only path to descent, locations, and the
channel — this is what makes D1's compiler contract enforceable):
`ctx.applyChild(segments, cursor)`, `ctx.applyRef(target)`,
`ctx.resolveDynamic(ref)` (D8 rebinding; the engine owns the dynamic-scope
stack), `ctx.produce(value)`, `ctx.visibleProductions(kinds)`,
`ctx.error(params)`. See `prototype/engine.ts`
(`KwApi`) for the working miniature, including exemplars of each keyword class:
assertion (`pattern`), in-place applicator (`anyOf`), child applicator
(`properties`), channel consumer (`unevaluatedProperties`), annotation-only
(unknown-keyword handling), reference (`$ref`).

## 4. Channel semantics (normative)

1. Each schema application pushes a frame.
2. `ctx.produce()` appends a production `{keyword, evaluationPath,
schemaLocation, instanceLocation, value}` to the current frame.
3. On application **success**, the frame's productions merge into the parent
   frame; on **failure**, they are discarded. No other visibility rule exists.
4. `ctx.visibleProductions()` filters the current frame by instance location —
   thereby seeing own-schema productions and merged productions from
   successful in-place child applications, and _not_ seeing cousins or failed
   branches. (`unevaluatedProperties/Items` correctness in the suite is the
   regression test for this rule.)
5. The annotation result of an evaluation is the root frame's surviving
   productions filtered by the retention policy (D5). Retention never affects
   rule 4. `$comment` is structural and never produces.
6. Consequence to preserve: `anyOf`/`oneOf` branches cannot short-circuit when
   any channel consumer or retained annotation is in scope; the compiler may
   short-circuit exactly when `StaticFacts` proves nothing consumes (D9b).

## 5. Carry-over findings that must not be relearned

- SPIKE.md: gate ratios 0.46–0.87× vs ajv; annotation cost proportional to
  retention; hyperjump 50–200× behind compiled; lowering heuristics (D9d)
  worth a real ratio; all-errors unit materialization is the untuned spot.
- Prototype: `Object.hasOwn` everywhere (`__proto__`/`toString`/`constructor`
  suite traps); regex needs `u`-flag-with-fallback (`schemaRegExp`);
  registration must walk **schema positions only** ($id/$anchor inside `enum`
  are not identifiers); pointer navigation must track $id-induced base changes.
- Prototype has **no `$ref` cycle guard** (suite `infinite-loop-detection.json`
  not run); the real core needs one (M1): seen-set keyed by
  (schema location, instance location).
- Skipped in prototype, owed by M2/M3: `multipleOf` (decimal-safe), `uniqueItems`,
  `min/maxContains`, `dependentRequired`, `propertyNames`, `$dynamicRef/Anchor`,
  `format-assertion`, vocabulary processing, metaschema validation policy.

## 6. Milestones

| M    | Deliverable                                                                                                                                                                                                                                                                         | Tier                                                                    | Done-signal (mechanical)                                                                                                                                                                  |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M0   | Monorepo scaffolding (D16): workspaces, TS/vitest/CI, suite submodule, generated suite runner in `test-kit`                                                                                                                                                                         | patterned                                                               | CI green; suite runner executes and reports per-file totals                                                                                                                               |
| M1   | `core` interpreter: registry, cursor, context, channel, cycle guard, output result tree + Basic/list renderers (both vocabularies); the six exemplar keywords from §3 promoted to production form                                                                                   | judgment                                                                | Prototype's suite file list + channels tests green under `core`; prototype deleted                                                                                                        |
| M2   | Keyword fan-out: full 2020-12 assertion/applicator/annotation set, per exemplar patterns                                                                                                                                                                                            | patterned                                                               | Full draft2020-12 suite green except `dynamicRef`, `vocabulary`, `refRemote`; each keyword lands with its suite file                                                                      |
| M3   | References hardened: `$dynamicRef`/dynamic scope (D8), `$vocabulary` processing, remote-resource loaders **including the D17 position capability** (`getRange`, key/value ranges) with an `Engine.locate()` helper and an opt-in unit-decoration flag, metaschema validation policy | judgment                                                                | `dynamicRef`, `anchor`, `vocabulary`, `refRemote` (suite remotes served by test-kit) green; local Bowtie run ≥ 99%; position lookup round-trips through an embedded-`$id` resource        |
| M4   | Dialects: 2019-09 (incl. `$recursiveRef`), draft-07, draft-06 (D11 amendment)                                                                                                                                                                                                       | patterned (D18 interfaces + `$recursiveRef`: judgment, done as prework) | draft2019-09, draft7, draft6 suites green with runner summary `skips: 0`; Bowtie ≥99% per dialect; 2020-12 + bench gates stay green                                                       |
| M5   | Output completion: Detailed/Verbose/hierarchical renderers, official output-tests adoption, golden fixtures, retention deny lists                                                                                                                                                   | patterned (trace capture: judgment, prework)                            | Renderer goldens green; official `output-tests/` (draft2019-09 + draft2020-12 `basic`) green, output self-validated by the engine                                                         |
| M5.5 | Annotation-collection controls (owner request 2026-07-06): retention-driven produce-time elision — skip productions provably neither channel-consumed (StaticFacts.consumes) nor retainable (policy + collectAnnotations); channels MUST be unaffected                              | judgment                                                                | Full suite + channels tests green with elision active; elision on/off differential run identical over suite schemas; bench quantifies annotations-off win                                 |
| M5.6 | Security baseline (owner request 2026-07-06, pre-M6, D20): pluggable+cached `regexEngine` + `detectUnsafeRegex`/`rejectUnsafeRegex`; O(n) `uniqueItems`; `maxDepth`/`MaxDepthExceededError`; standing adversarial resource-exhaustion suite                                         | patterned + judgment (detector, depth default)                          | Adversarial suite green within time budgets; four dialect suites unchanged zero-skip; ReDoS/uniqueItems/deep-nesting probes bounded; prototype-pollution probes locked in                 |
| M6   | `compiler` (@jse/compiler): five sub-milestones below, scoped to **draft2020-12** — other dialects classify as interpreted units (fallback)                                                                                                                                         | judgment overall                                                        | All five sub-signals below                                                                                                                                                                |
| M6.1 | Compiler contracts in core: StaticFacts v2 (AnalyzeContext, coverage + application facts, produces fan-out), lowering IR types + `lower()` slot, `evaluateFragment` trampoline, Engine getters/exports, docs/architecture.md                                                        | judgment (Fable)                                                        | Full suite green, interpreter untouched; facts-snapshot + fragment tests green                                                                                                            |
| M6.2 | Vertical slice: planner + unit classification, gated serializer, runtime `new Function` mode, trampoline glue, six exemplar `lower()`s, non-2020-12 fallback default, ESLint fences, injection exemplars                                                                            | judgment (Fable)                                                        | Smoke differential green over spike schemas + suite subset (incl. dynamicRef, infinite-loop-detection, one metaschema-$ref case); injection exemplars green                               |
| M6.3 | Differential fuzz + injection harness in test-kit: seeded mutators, comparison policy (§7), divergence minimizer, full adversarial codegen corpus                                                                                                                                   | judgment (Opus)                                                         | 50k-case seeded run zero divergences over M6.2 keywords; minimizer reduces a planted bug; injection corpus green                                                                          |
| M6.4 | Lowering fan-out: `lower()` + facts for all remaining 2020-12 keywords per exemplars, fuzz-refereed batches                                                                                                                                                                         | patterned (Sonnet)                                                      | Full draft2020-12 suite green through the compiled tier, skips 0, totals = interpreter; fuzz clean over full keyword set; interpreter suites/Bowtie unchanged                             |
| M6.5 | Output modes + performance: standalone source emission (D10), D9b elision + short-circuit licensing, lazy units (D9e), membership thresholds (D9d)                                                                                                                                  | judgment (Fable)                                                        | Bench gate PASS through the compiler; standalone artifact re-runs suite + injection corpus under `node --disallow-code-generation-from-strings`; fuzz clean with optimizations on and off |
| M6.6 | Legacy-dialect lowering (2019-09/draft-07/06): refIgnoresSiblings, 2019-09 items/additionalItems; outside the M6 gate                                                                                                                                                               | patterned                                                               | Per-dialect suites green compiled; fuzz clean                                                                                                                                             |
| M7   | `formats` package (annotation + assertion modes)                                                                                                                                                                                                                                    | patterned                                                               | format suite incl. optional format-assertion tests green                                                                                                                                  |
| M8   | `ajv-compat`: API surface, error mapping (D13), formats parity, loud failure for `code`-keywords and `$data` (§7); PoC against a fastify app and an OpenAPI validator                                                                                                               | judgment (surface) + patterned (mapping tables)                         | Compat test suite green; both PoCs validate real traffic                                                                                                                                  |
| M9   | `bench` harness (compile/first/hot/annotations-on × corpora), Bowtie onboarding PR, docs                                                                                                                                                                                            | patterned                                                               | Published Bowtie report; bench reproducible in CI                                                                                                                                         |
| M10  | `dialect-draft04`: draft-04 (draft-06 moved into M4 core, D11 amendment)                                                                                                                                                                                                            | patterned                                                               | draft4 suite green                                                                                                                                                                        |

**Status note (M4/M5/M5.5, completed 2026-07-06):** all three milestones
green. Bowtie: 100.00% on draft2020-12 (1299), draft2019-09 (1259), draft7
(927), draft6 (839). Official output-tests: 8/8 (basic, both drafts). M5.5
differential (flag/elided vs hierarchical/traced) agrees on every official
case; elision throughput on an annotation-heavy no-consumer schema:
175k → 178k ops/s (~1.02×) — the interpreter win is allocation/GC, the CPU
win arrives with the M6 compiler's D9b.

**Status note (M3, completed 2026-07-06):** all done-signal legs green. The
Bowtie leg ran locally (podman + `bowtie/` harness image, `bowtie suite` over
`test-suite/tests/draft2020-12`): **1299/1299 = 100%**, no errored or wrong
results. Getting there required bundling the 2020-12 metaschema resources in
core (`keywords/metaschemas2020.ts`) — the suite's metaschema-`$ref` cases
expect them resolvable without loaders, and the local runner had been
silently error-skipping those 4 tests. The `bowtie/` harness is the starting
point for M9's Bowtie onboarding PR.

Session protocol for a milestone: read this file §1–§5 + the milestone row;
run the done-signal first (red); implement; done-signal green; conformance
gate (D12) stays green for everything previously done; restate D15 in any
subagent prompts. Keep changes within the milestone — interface changes
(§3–§4) require a judgment-tier session and an update to this file.

## 7. Open items (owner decisions)

1. **npm scope + project name** — blocks M0 publishing setup (not scaffolding).
2. **Governance/funding** per ANALYSIS.md §12 — needed before any public
   release, not before code.

### Resolved (owner, 2026-07-05)

- **`$data` references**: not in the first public version. Candidate for a
  later **extension vocabulary** (which the D2 registry supports without core
  changes). Context: not actually AJV-proprietary — proposed for the standard
  well over a decade ago, never agreed to be in scope — and it carries
  security concerns (keyword values become instance-controlled). ajv-compat
  (M8) fails loudly on `$data` with a pointer to this rationale.
- **Strict mode**: folded into D14 — opt-in only; explore stricter
  meta-schemas as the primary AJV-migration path for common strict-mode uses.
- **Output default field vocabulary**: folded into D6 —
  `evaluationPath`/`schemaLocation` default, 2020-12 names as a compat option.
- **Annotation tests upstream**: not pursuing with the suite maintainer
  (historically unreceptive; his implementation doesn't collect annotations).
  Our channels tests remain the local gate. Watch for official annotation
  cases arriving via other maintainers (reported in progress); adopt them into
  test-kit when they land.

## 7. M6 compiler contracts (normative, added M6.1 2026-07-06)

**StaticFacts v2.** `analyze?(value, context?: AnalyzeContext)` — the
context carries the keyword's containing schema object for
sibling-dependent facts, mirroring `evaluate()`'s `ctx.schema` reads
(`items` starts after `prefixItems`; `if` declares applications for sibling
`then`/`else`). New facts: `evaluatesNames`/`evaluatesIndexes` (D9a coverage
as predicate descriptions — `patterns` still lowers; only `dynamic` forces
runtime evaluated-set tracking), `applications` (planner edge facts: path,
sibling, mode, conditional, asserts), and a `produces` discipline (the
`structural` factory declares `[]`, `annotationOnly` its own id; the
compiler assumes own-id production for any occurrence lacking the fact —
sound degradation, never a broken proof).

**Trampoline.** `evaluateFragment(registry, target, cursor, {dynamicScope,
pathNode, depth, shouldRecord, regexCache, maxDepth})` → `{valid, errors,
productions}`. One mechanism for dynamic islands and every fallback cause
(unlowerable keyword, non-2020-12 dialect, in-place cycle, size budget).
The caller passes its constant dynamic-scope contribution (outermost first,
duplicates preserved — resolution is outermost-match), an evaluation-path
prefix (one synthetic pre-escaped PathNode segment is valid), consumed
depth (combined compiled+interpreted nesting trips `MaxDepthExceededError`
at one bound, D20), and its artifact's RecordPredicate (flag-mode artifacts
elide everything → near-free harvest). Returned productions are the
fragment's full root-frame survivors with cursor identity intact; the
caller merges on success and discards on failure (channel rules 3/5) and
consumers filter by cursor (rule 4). **The trampoline is one-way**:
interpreted code never re-enters compiled code. This is what makes island
channel flow strictly upward (rule 4 has no lateral flow), so an island can
never consume from a compiled sibling. Revisit trigger: compiling static
subtrees inside islands would break this proof and requires a second
harvest direction.

**Short-circuit licensing (rule 6, sharpened).** The interpreter never
short-circuits and never discards errors — failed branches of a successful
`anyOf` keep their errors. Compiled code may short-circuit `anyOf` (first
success) / `oneOf` (fail at second success — never stop-at-first) only in
verdict-only regions: flag output, no reachable channel consumer, no
retainable annotation under the artifact's policy (a `keep` predicate
blocks annotation elision but not error short-circuiting). List-mode
artifacts run all branches so the error multiset matches the interpreter
exactly. The lowering IR's `combine` is eager by definition; short-circuit
is a licensed serializer optimization, never an IR semantic.

**Compiled-output scope (amended post-M6, D9e delivered).** Compiled
artifacts serve flag, flat error lists (`compileList` — interpreter-exact
units, same order; list artifacts never short-circuit and run every
branch), and the 2020-12 Basic document's error side. Compiled
**annotation** collection would require channel frames in emitted code and
stays on the interpreter (the Basic adapter omits `annotations` on valid
instances; the per-output-config artifact key makes the interpreter a clean
fallback). Modern-vocabulary LIST documents and all hierarchical/verbose
documents are trace-shaped (renderList flattens renderHierarchical over the
trace) and stay on the interpreter. D9e is realized in list emission:
error-unit objects and message strings materialize only on failure paths.

**Plain-data instance contract (M6.5).** Compiled artifacts assume the
instance is plain JSON data — the output of `JSON.parse` or equivalent —
with `Object.prototype` intact and no inherited enumerable properties. Under
that contract, emitted code tests own-property presence with `x[key] !==
undefined` and enumerates with a bare `for…in` (no per-property `Object.keys`
array, no per-access `Object.hasOwn` call) — the dominant flag-mode cost in
profiling; the plain-data forms run several times faster and lifted the
spike schemas from ~3.5x slower than ajv to at/under parity. Two escape
hatches preserve correctness: a `key` that exists on `Object.prototype`
(`constructor`, `toString`, …) or is literally `__proto__` would
false-positive through the chain, so those emit an explicit
`hasOwnProperty.call`. The interpreter makes NO such assumption — it uses
`Object.hasOwn` throughout — so a caller validating hand-built objects with a
mutated prototype should use the interpreter (or the compiler once a
strict-hygiene emit mode is added; not in M6). The differential fuzzer only
feeds JSON-shaped data, matching the contract.

**Planner ground rules.** The planner walks with public core APIs only
(`rootRef`/`child`/`resolveRef`/`dialectFor` + `analyze(value, {schema})`),
so it cannot disagree with the registration walk about schema positions.
Artifact key = (root URI × registry snapshot × retention × output config);
later registrations do not retro-patch artifacts. `$ref` targets inline
when single-use/acyclic/under-budget (constant locations through the ref),
else become deduped called units; plan-time-unresolvable refs lower to
lazy `UnresolvableRefError` sites. Ref-SCCs whose every cycle crosses a
child-applicator edge compile under the depth budget; SCCs with possible
in-place cycles classify interpreted (exact `InfiniteLoopError` parity).
Emitted code uses `Object.hasOwn`/`Object.keys` only (never `in`/`for-in` —
spike/compiled.ts is the target shape, not a literal template), and shared
runtime helpers (`jsonEqual`, `canonicalKey`, `codePointLength`,
`escapeSegment`, the regex helper) are imported from core, never
re-emitted — one implementation per semantic across both tiers.

**Status note (M6, completed 2026-07-06):** all five sub-milestones green.
Full draft2020-12 suite through the compiled tier: 1299 cases, 0 skips,
totals identical to the interpreter leg. Differential fuzz: zero
divergences across 500k+ cumulative cases, multiple seeds, optimizations on
and off (`FUZZ_CONSERVATIVE=1`). Bench gate through the real compiler:
ajv/ours 0.53–0.82 on the spike flag groups (was 2.2–3.2 before the M6.5
lowerings: inlining, guard CSE, plain-data emission — the §7 contract —
prologue hoisting, shared empty scope, conditional depth guards);
compile time ~4x faster than ajv's. Standalone emission (D10): fully
static schemas → self-contained ES modules; `npm run csp:check` re-runs
332 suite groups + injection corpus (1164 verdicts) under
`node --disallow-code-generation-from-strings`, zero failures; island
schemas use the interpreter under CSP by design. Post-gate optimizations
deferred: compiled list/Basic output + lazy unit materialization (D9e,
with the M7-era output work), Set-vs-chain membership thresholds beyond
the defaults (D9d — chains measured sufficient at suite scale), island
re-entry (revisit trigger recorded in §7).

**Status note (M7 + compiled list output, completed 2026-07-06):** M7
formats delivered as @jse/formats: all 21 draft2020-12 optional formats
implemented from their defining RFCs (D15), including full IDNA2008
idn-hostname/idn-email (RFC 3492 Punycode both directions, RFC 5892
Appendix A context rules + §2.6 exceptions, RFC 5893 bidi rule, NFC,
ideographic label separators; Unicode data via ECMA-262 \p{...} escapes
plus small cited tables in packages/formats/src/{idna,idn}.ts). Suite:
2020-12/2019-09/draft-07/draft-06 optional-format legs green, zero skips
(552+545+478+273 cases + idn legs), official format-assertion.json green
through $vocabulary dialect assembly. Format contract: FormatDefinition is
type-scoped (`types`, default ["string"]) so the OpenAPI format registry's
number-scoped entries fit later; the format-assertion VOCABULARY refuses
unsupported formats at registration (UnknownFormatError) while
format-annotation + assertFormats stays best-effort (unknown → annotate).
Asserting-format nodes classify interpreted under compilation (Runtime
format-table lowering deferred). Separately, compiled list/Basic output
landed (D9e; commit 613ac51): compileList produces interpreter-exact flat
error units — full-suite differential zero divergence, FUZZ_LIST leg.

**Status note (M8 ajv-compat, completed 2026-07-07):** @jse/ajv-compat
delivers AJV v8's public surface over the engine, pinned end-to-end by
EXECUTED-AJV fixtures (capture scripts in packages/ajv-compat/test/oracle;
AJV source never read — D15). Prework M8.1 added the D13 structured error
channel: ctx.error(message, params) + LowerParams IR, surfaced behind the
opt-in `errorParams` flag in both tiers (goldens unchanged; the compiled
list differential and FUZZ_LIST referee params, including field order).
Emulated: schema management, compile/compileAsync, addFormat/addKeyword
(validate/compile forms), errorsText, allErrors/verbose/messages,
strictSchema subset, the mutation trio (coerceTypes/useDefaults/
removeAdditional as a compat-layer evaluate→mutate→re-evaluate fixpoint —
fastify's default config passes end-to-end), ajv-formats parity,
discriminator (AJV replaces oneOf dispatch entirely — fixture-pinned),
ajv-errors, non-mutating ajv-keywords subset. Loud failures per D14/§7:
$data, code-style keywords, $async, macro, JTD, built-in removeKeyword.
Gates: official-suite differential (compat matches the suite on all 1250
registerable cases; AJV itself non-compliant on 30; error-object parity
416/477 with the divergence count ratcheted), both DESIGN-mandated PoCs
green (fastify validator-compiler under fastify's real default config
with injected traffic; OpenAPI 3.1 document schemas incl. discriminator),
migration guide docs/guide/ajv-migration.md (tested snippets). Deferred,
recorded: FUZZ_AJV random differential (AJV's own non-compliance makes a
random referee noisy; the deterministic suite differential + oracle
fixtures cover the mapping), code.source standalone mapping, ajv-keywords
transform/dynamicDefaults (ride the mutation machinery when demanded),
ajv-i18n.

**Status note (M10 @jse/dialect-draft04, completed 2026-07-08):** done-
signals green: official draft4 suite 618/618 cases zero-skip (interpreter
tier) plus the optional id.json leg (3/3), optional/format leg 206/206
under `FORMATS_DRAFT_04`/`assertFormats`, an in-package elision
differential over the full draft4 directory, error-params pins for the
package-defined keywords, and the mixed-registry gate (draft-04 and
2020-12 cross-referencing in one engine, both directions — the oaskit
shape). Built against core's public surface only, zero new core API
(owner decision 2026-07-08): keywords shared with draft-07 are harvested
as behavior objects from `engine.dialects.getDialect(DIALECT_DRAFT_07)
.keywords` — behaviors are stateless shared values (draft-06 already
shares draft-07's objects), harvesting `format` inherits the engine's
formats/assertFormats configuration, and future M6.6 `lower()` additions
flow to draft-04 automatically. Fresh per the public interfaces:
`identifiersDraft04` (`id`-keyed legacy extractor), structural `id`/
`exclusiveMinimum`/`exclusiveMaximum`, and sibling-reading `minimum`/
`maximum` (params stay `{ limit }`; exclusivity is schema-derivable).
Findings vs this note's item-1 text: `required` (already array-form),
`dependencies`, and tuple `items`/`additionalItems` were direct harvests,
not new code; draft-04's stricter `integer` (reject 1.0) is
unrepresentable after `JSON.parse` — the suite itself makes it optional
(zeroTerminatedFloats.json) for that reason, so `type` is shared and the
file is a recorded exclusion alongside bignum/float-overflow and the two
regex-variance files no dialect's leg runs. The vendored draft-04
metaschema registers through `engine.registerSchema` (self-validates
cleanly under `validateSchemas`). Recorded, not built: ajv-compat draft-04
class. (The draft-04 `lower()` sweep landed with M6.6; the Bowtie
harness draft-04 entry landed with M9a.)

**Status note (M8.6 ajv-compat hardening, completed 2026-07-09):** all
three workstreams landed in nine local commits, every gate green per
commit. (a) Trace-based error adapter: core exports `TraceUnit` +
`trace: true` on list output and `walkSchema` (`@alpha` until the M9a
stabilization pass, 2026-07-10; rendering
only — list evaluation already recorded the trace). The four string
heuristics (NAME_POSITION/keywordPositions filtering, unitSchemaPrefix,
instanceDescents) are deleted; filtering and companion synthesis walk
real applications. Owner-decided ESCALATION design, from measurement
(150-prop schema + 2000-item instance, one failure: compiled flag 15µs,
compiled list 0.32ms, interpreter list+trace 16.7ms ≈ 50x, interpreter
flag 11.7ms — the cost is dispatch, no cheap trace-lite exists): the
compiled list stays the primary error path; `needsTrace` (conservative
segment scan for anyOf/oneOf/not/contains/if/then/else/propertyNames,
plus keyword-less units the root-anchored classifier cannot place)
re-runs the interpreter for its trace. Golden set 61 → 60, removal only
(if-then-else.json#8: we no longer emit the `if: false` probe's
false-schema unit AJV never shows; verified byte-equal against executed
AJV); one refinement pinned the other way — a boolean-false failure AT
a contains probe IS reported. `discriminatorRouted` is deleted, not
formalized: a routed combiner's single invalid branch with no valid
sibling reads as failed straight from the trace. strictSchemaCheck rides
walkSchema (DESCEND_* tables deleted); four pointer codecs collapsed
onto core's escape/unescape via one adapter module. (b) Lifecycle:
scenario capture (capture-lifecycle.ts → ajv-lifecycle.json, in the CI
drift block) pinned six behaviors; two fixes brought full match —
compile() now resolves refs eagerly (throws on missing, via
registry.takeUnresolved drained around registration) and addSchema
refuses duplicate keys; the never-invalidated object cache turned out
AJV-faithful (pinned, kept). Anonymous compiles use a PRIVATE engine —
the shared registry never accretes urn:ajv-compat:anonymous:* entries
(deterministic 1000-compile footprint test; the fn closure is the only
holder). (c) Mutation: typed `MutationNonConvergenceError` at
MAX_PASSES (owner decision over logger-warn; AJV has no fixpoint to
match). Combiner×mutation pinned by nine new oracle cases; two rules
fixed to match AJV (defaults never apply inside anyOf/oneOf branches;
removal skips a failing branch once a sibling passed) and one coercion
cascade divergence double-pinned (fixture holds AJV's true→1→"1", the
test holds our schema-valid 1) and documented. Non-plain data on a
mutating validator routes wholly to the interpreter, unmutated;
plainness accepts behavior-free prototype chains (fastify's
empty-carrier query objects — PoC-caught). Idempotence property leg
(mutation-property.test.ts) on the seeded harness: suite-corpus ×
option-combo × perturbed instances, ~760 sequences in `npm test`,
`MUTATION_PROPERTY_BUDGET` scales locally (clean at 50x); properties:
data fixpoint after one call, verdict stability, non-convergence
deterministic and exceptional. COMPAT.md (lifecycle semantics section,
divergence updates) and the migration guide track all of it.

**Status note (M6.6 legacy-dialect lowering, completed 2026-07-09;
Fable orchestration, two Sonnet sweeps):** all five supported dialects
compile natively; four local commits. Sweep 1 (Sonnet): lower() for
every draft-07/06 and 2019-09 delta keyword — items (both forms),
additionalItems (sibling read via LoweringContext.schema), legacy
contains (fixed at-least-1, message byte-exact), dependencies
(plan-time member dispatch onto the dependentRequired/dependentSchemas
shapes), definitions/then/else (inert), plus the 2019-09 unevaluated*
pair through the 2020-12 static-coverage factory. The sweep exposed a
latent planner gap: those keywords never declared
StaticFacts.applications (subschemas drives registration, not planner
edges) — harmless while they blocked compilation, fatal once they
lowered; all four now declare application facts. refIgnoresSiblings is
mirrored from the interpreter in buildPlan/coverageHalves/unitBody
(previously unreachable, a real divergence once legacy units compile).
Gates: compiled suite legs draft7 908+/draft6 822+/draft2019-09 1234+
zero-skip, list-mode differentials with errorParams over all three
directories. Then the dialect allowlist was REMOVED (owner-side
judgment): a dialect compiles exactly when its present keywords lower
(D1 — facts are the compiler's whole window), which is what lets a
dialect PACKAGE become compilable through the public surface alone.
Sweep 2 (Sonnet): draft-04's own minimum/maximum lower via exported IR
(sibling exclusive* boolean read at plan time; messages/{limit} params
byte-exact), package structural() gains the empty lower() the
capability check requires; in-package gates (compiled draft4 leg 618
zero-skip, list differential, plan census: 510 units, zero
interpreted). FUZZ HARNESS FINDINGS while adding legacy seeding
(FUZZ_DIALECT env + CI legs): (1) the FUZZ_LIST leg NEVER refereed
list output — LIST_MODE only switched subjectFor (the minimizer),
while the hot loop compared flag verdicts; every FUZZ_LIST run since
613ac51 re-ran the flag differential. (2) Fixed and re-run, the honest
leg found within 20k cases that static-coverage licensing for
unevaluated* is FLAG-ONLY sound: coverage models the parent-success
path, and a FAILING contributor's dropped annotations make the
interpreter emit additional unevaluated* errors — verdict-invisible,
list-visible. buildPlan now takes the artifact output mode; list
artifacts classify those consumers interpreted (pinned
deterministically in list-output.test.ts). (3) Interpreter prefixItems
threw raw TypeError on malformed non-array values where compiled
no-ops; aligned lenient (D19 scope line), unblocking the minimizer
from converging on garbage-schema tier gaps. All seven fuzz legs clean
at full 200k budget (~1.4M cases). 18228 tests; every gate green per
commit; @emnapi lockfile recipe re-applied after the devDependency
add, npm ci verified.

**Status note (testing-lessons hardening, completed 2026-07-09; Fable
orchestration + two Sonnet sweeps, eight commits):** the FUZZ_LIST
incident's lessons, encoded as gates rather than memory. (1) One
construction path for differential comparisons: test-kit gains
`runListSide` + `DifferentialFactory`/`subjectFromFactory` — the fuzz
hot loop and the post-divergence minimizer both derive from one
`prepare()`, making the incident's failure shape (one rewired for a
mode, the other silently not) unrepresentable; both consumers
refactored onto it, and the CI vitest fuzz gains a list-mode leg
(~4.6k cases, floor-guarded) so the list differential has a backstop
independent of scripts/fuzz.ts. Sensitivity unit tests pin that the
list encoding detects same-verdict/different-errors, params field
order, and error order; a PLANTED-DIVERGENCE self-test corrupts a
compiled artifact's params and asserts the list comparison trips while
the flag comparison stays blind — the gate that would have caught the
gate. (2) Class-preserving minimization: `minimizeDivergence` takes
`sameDivergence(initial, candidate)` (compared against the ORIGINAL,
never phase-local); `sameListDivergenceClass` guards both list legs —
a real error-content divergence can no longer shrink into a
garbage-schema tier gap (the 28→prefixItems:null collapse). (3) Plan
census: `explainCompilation()` (register entry discharged) +
test-kit's `runPlanCensus` pin EXACT per-dialect unit/cause counts —
2020-12 and 2019-09 in both output modes (list demotes unevaluated*
consumers and never plans their subtrees), draft7/6 at zero
interpreted with a self-maintaining list≡flag pin, draft-04 at its
all-static 510; a silent static→interpreted flip is now loud despite
being behaviorally invisible. (4) Trampoline pins: depth-exhaustion
parity (MaxDepthExceededError across interpreter/flag/list, static
chain asserted all-static + $dynamicRef island, non-vacuity checked)
and per-cause legacy island pins (draft-07/06 "cycle" behind items,
2019-09 $recursiveRef "dynamic") with flag+list parity. (5) Exact
suite-run pins: `exactRun` replaces the >= floors on all eleven
full-suite legs — which had ALREADY drifted (every leg ran more cases
than its stale floor: 1299/1259/927/839/618 vs 1280/1234/908/822/605),
the exact silent-upward-drift failure the floors could not flag. (6)
Coverage (owner decision: two-phase): @vitest/coverage-v8, report over
compiler+ajv-compat src (`npm run coverage`, own CI step, outside npm
test — instrumentation taxes the fuzz-heavy suite; first report 92.2%
lines), then glob thresholds on the ajv-compat lifecycle surface only
(index.ts 82/82, mutate.ts 93/87 vs 84.3/84.2 and 95.4/89.9 measured;
enforcement verified by planting a 99% threshold). Register entries
discharged: explainCompilation, coverage thresholds; corepack stays.

**Handoff note (2026-07-07, owner-directed; Fable availability
corrected 2026-07-08):** Fable access is available through midnight
Sunday 2026-07-12 — judgment/orchestration work routes to Fable-class
sessions until then; thereafter remaining milestones execute on Opus
(orchestration/judgment) with Sonnet subagents for patterned sweeps.
Standing constraints bind every session and every subagent
prompt: D15 IP policy (restate it verbatim in each subagent prompt;
oracles are executed, never read); local commits only, NEVER push;
NEVER open a PR to any repository — prepare everything, the owner
submits personally; zero-skip suite discipline; comment policy (WHY
only, no history narration); docs voice crisp, not conversational;
re-apply the @emnapi lockfile recipe after ANY `npm install` that
touches the workspace set, then verify with `npm ci`. Gates for every
milestone: npm test (zero suite skips), lint, check-types,
format:check, docs:api, bench OVERALL GATE PASS, fuzz (FUZZ_LIST=1
leg included), csp-check.

Owner-priority order and per-milestone contracts:

1. **M10 — @jse/dialect-draft04 (top priority: oaskit needs it).**
   Separate workspace package per the amended D11. Build against the
   PUBLIC registry surface only: `registerVocabulary`/`registerDialect`
   with `DialectOptions.identifiers` (an `id`-based extractor: plain
   `id`, fragment-only `id` mints an anchor) and `refIgnoresSiblings`;
   vendor the draft-04 metaschema. Genuinely-new keyword behaviors:
   boolean `exclusiveMinimum`/`exclusiveMaximum` (modify sibling
   `minimum`/`maximum`), draft-04 `type`'s stricter `integer` (reject
   1.0 — register a dialect-local `type` behavior), draft-04 `required`
   (array form), `dependencies`, tuple `items`/`additionalItems` —
   most re-use draft-06/07 modules; check what vocab7.ts already
   exports before writing anything new. Gate: official draft4 suite
   directory zero-skip (interpreter; lowering NOT required — draft-04
   schema objects classify as interpreted units until M6.6-equivalent
   work, which is acceptable), plus a mixed-registry test (draft-04 and
   2020-12 resources cross-referencing in one engine — the oaskit
   shape). Error params: sweep draft-04 keyword error sites to the M8.1
   params vocabulary so ajv-compat's draft-04 class can follow later
   (do NOT build an Ajv draft-04 compat class in M10; record it).
   Routing: one Opus session; Sonnet subagent optional for the keyword
   sweep. If any step needs a private core import, STOP and record the
   missing public hook as a D-register issue instead of importing.

2. **M6.6 — legacy-dialect lowering (perf completeness).** Add
   `lower()` to the draft-07/06-specific keyword behaviors (vocab7.ts)
   so legacy schemas stop classifying as interpreted units. Patterned
   Sonnet work against existing exemplars in validation.ts/
   applicator.ts; params must match the interpreter exactly (the
   error-params differential pattern from M8.1 — extend
   list-output-style differential legs to draft-07/06 suite dirs as the
   gate, plus a FUZZ leg seeded from the draft7 suite directory if
   cheap). Include the M8.1 params vocabulary in every new lower().

3. **M8.6 — ajv-compat hardening (Opus; before M9 because ajv-compat
   is a flagship external claim).** Three coherent workstreams from the
   2026-07-07 adversarial review, promoted out of the deferred register:
   a. **Trace-based error adapter.** Replace the evaluationPath string
   heuristics in packages/ajv-compat/src/errors.ts (NAME_POSITION,
   keywordPositions, unitSchemaPrefix's no-$ref-crossing assumption,
   instanceDescents' properties-only counting) by consuming core's
   structured TraceNodes (engine.ts — schemaRef/pathNode/cursor per
   application; may need a small PUBLIC core surface to expose the
   trace alongside list errors). This also retires the
   `discriminatorRouted` params-smuggled control signal (make it an
   explicit internal channel) and should collapse the duplicated
   applicator-position knowledge (strict walk in index.ts, mutate.ts
   descent) into ONE core-exported schema-walk utility. Gate: the
   suite-differential golden set SHRINKS or holds — document any
   identity that changes; oracle fixtures all still pass.
   b. **Engine/artifact lifecycle.** Fix unbounded registry growth from
   anonymous compile() (urn:ajv-compat:anonymous accretion in the
   shared engine); pin invalidate()/compiledByObject semantics
   against AJV by ORACLE (does a cached ValidateFunction see schemas
   added after its compile?) and match or document. Gate: a
   compile-in-a-loop memory test + new oracle fixtures.
   c. **Mutation hardening.** Surface fixpoint non-convergence (logger
   warning or typed error at MAX_PASSES instead of silent stop);
   idempotence property tests (validating already-mutated data
   changes nothing) over randomized suite-seeded schemas; oracle
   fixtures for combiner×mutation interactions (removeAdditional
   inside anyOf/oneOf, coercion with competing branch types —
   currently unpinned); plain-data guard (route non-plain instances
   to the interpreter path so class instances cannot silently
   diverge from the interpreter's own answer).

4. **M9 — bench harness + Bowtie onboarding (LAST: gated on owner
   decisions — npm scope/name, publication).** Build the public bench
   harness (real-world corpora per ANALYSIS §9; cite no draft-04-era
   benchmarks) and the Bowtie harness container + local `bowtie run`
   results for all supported dialects. STOP at submission: no PR, no
   publish — package the branch, image, and results for the owner.

**Status note (M9a, completed 2026-07-10, owner-scoped: run everything
locally and in CI, publish nothing, contact no external registry).**
Five local commits, every gate green per commit:

- **Publication-ready packages.** The five publishable packages build
  `dist/` (tsc -b composite projects, d.ts + maps) behind
  publication-first export maps; in-repo development resolves TS source
  through the custom `jse-source` condition (tsconfig
  `customConditions`, vitest `resolve.conditions`,
  `tsx --conditions=jse-source`). Inter-package ranges pinned to the
  lockstep `0.0.0`. `private: true` + version `0.0.0` are the deliberate
  not-published latch — flipping them plus the scope/name decision is
  all that publication requires. `scripts/pack-check.ts` is the
  publication gate: tarballs installed into a tmpdir consumer with
  `npm install --offline` (registry contact = failure), runtime smoke
  across every package's installed dist, typed consumer resolved
  against the published d.ts graph. Sibling projects consume via
  `npm pack` tarballs (CONTRIBUTING).
- **Interface stabilization.** `TraceUnit`/`trace`/`walkSchema`
  promoted out of `@alpha` (the register item, pulled forward: sibling
  projects consume the packages ahead of publication).
- **Bowtie, local + CI.** The harness image ships
  `@jse/dialect-draft04`; inbound dialect URIs normalize fragment-free
  (Bowtie sends legacy dialects as `…schema#`). `npm run bowtie`
  (scripts/bowtie-check.ts) builds the image, smokes it, and pins
  EXACT per-dialect counts with zero failures/errors/skips —
  1299/1259/927/839/618, all five dialects 100% via Bowtie's own
  runner; a planted wrong pin fails with exit 1. CI runs it as its own
  job (bowtie pinned 2026.6.1). No submission, no image push — M9b.
- **Bench harness, report-only.** `npm run bench:harness`
  (bench/harness.ts) over vendored, license-documented corpora
  (bench/corpora/README.md): OAS 3.1 meta-schema × hand-authored
  OpenAPI document, generated API payloads, draft-07 migration schema
  (native / ajv-compat / real AJV). Verdict oracle before timing.
  Recorded findings from real inputs: AJV rejects the valid OpenAPI
  document (known 2020-12 `$dynamicRef`/`unevaluatedProperties`
  non-compliance; excluded from that corpus with the reason in the
  results JSON) and refuses the OAS schema without `strict: false`;
  the OAS corpus runs at interpreter speed in both jse tiers (dynamic-
  heavy plan). No thresholds — the spike bench stays the enforced
  gate; CI uploads results as an artifact.
- **M9b (open, owner-gated):** final npm scope/name decision, version
  bump, `private` flip, `npm publish`; Bowtie PR + bowtie.report
  listing (owner submits personally). First CI run of the new jobs
  happens on the owner's next push and may need one follow-up tweak.

Deferred register (for continuity): compiled annotation
collection (channel frames), list-mode standalone, Runtime
format-table lowering, D9d thresholds, island re-entry, ajv-keywords
transform/dynamicDefaults, code.source mapping, hyperjump-compat shim,
idna.ts second-'--' owner review (above). Added at M10 (2026-07-08):
draft-04 `lower()` sweep for the package-defined keywords — DELIVERED
with M6.6; ajv-compat draft-04 class (per the M10 contract: recorded,
not built); Bowtie harness draft-04 entry — DELIVERED 2026-07-10 with
M9a (dialect package in the harness image, URI appended to
`DIALECTS` in bowtie/harness.ts). Added from the 2026-07-07
audit remediation: explainCompilation() fallback diagnostics — DELIVERED
2026-07-09 (packages/compiler/src/explain.ts, feeding the per-dialect
plan-census gates in plan-census.test.ts/plan4.test.ts); packageManager
pinning / corepack evaluation (the @emnapi lockfile surgery is a process
smell); coverage thresholds for ajv-compat lifecycle paths — DELIVERED
2026-07-09 (vitest.config.ts: v8 report over compiler+ajv-compat src,
glob thresholds on ajv-compat index.ts/mutate.ts only; compiler files
stay report-only by decision — their gates are the suite/differential/
fuzz/census stack, so line thresholds there would be maintenance
without signal); custom-keyword AUTHOR contract documentation
(analyze() obligations and how wrong facts break compilation); DESIGN →
ARCHITECTURE/ADR/CHANGELOG split; serialize.ts split (UnitContext mixes
plan lookup, statement emission, message/params rendering, guard CSE,
and inlining — separate unit orchestration from statement emission
before the file grows again); fuzz corpus expansion (mutators currently
seed from the draft2020-12 suite only — add legacy-dialect and
format-bearing seeds); errorParams on non-list outputs (currently
silently list-only; documented, but a typed warning would be kinder).
The ajv-compat hardening items (trace-based error adapter,
discriminatorRouted channel, anonymous-schema/lifecycle, mutation
property tests + non-convergence surfacing, plain-data guard) were
PROMOTED out of this register into milestone M8.6 above and DELIVERED
(2026-07-09 status note). Added at M8.6: refactor the registry's
private registration walk atop the public `walkSchema` (deliberately
not done in-milestone — the registration walk interleaves base-URI
rebasing, anchor indexing, and reference collection that would fatten
the public signature); seed `scripts/fuzz.ts` mutation legs from the
mutation-property corpus (the vitest leg covers it today); stabilize
`TraceUnit`/`trace`/`walkSchema` out of `@alpha` at the M9 publication
pass — DELIVERED 2026-07-10 (M9a stabilization).

**Owner review (idn-hostname):** `isValidALabel` in
packages/formats/src/idna.ts rejects any second `--` in an A-label's
ASCII text after the `xn--` prefix (suite case `XN--aa---o47jg78q`,
"contains '--' in the 3rd and 4th position"). This reading is consistent
with every suite case but was inferred, not traced to a pinpoint RFC
sentence — the block comment there records the reasoning (RFC 5890
§2.3.1 R-LDH reservation). Working hypothesis: such a label is a "fake
A-label" (RFC 5890 §2.3.2.1 terminology) and therefore invalid; confirm
the correct citation (fake A-label vs. §4.4 canonical round-trip) and
adjust the comment.
