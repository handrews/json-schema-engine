# JSON Schema engine: engineering design

**Status:** agreed design, pre-implementation. Successor to
[ANALYSIS.md](ANALYSIS.md) (market/architecture analysis) as validated by
[SPIKE.md](SPIKE.md) (F1 performance spike) and `prototype/` (F2 channels
prototype, 852/852 non-skipped official draft2020-12 suite cases green).

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

| # | Decision | Choice | Why / evidence | Revisit trigger |
|---|---|---|---|---|
| D1 | Execution model | **Two tiers, one keyword registry**: interpreter core (reference semantics) + compiler emitting specialized JS for static subschemas, trampolining to the interpreter for dynamic islands. The compiler may consume **only** `analyze()` output from keyword behaviors — no keyword knowledge hard-coded in the compiler. | SPIKE.md: hand-emitted artifacts beat ajv flag mode (0.46–0.87×) with constant-location output; the analyze-only rule prevents the semantic fork that froze AJV | Compiler needs a fact `analyze()` can't express → extend `StaticFacts`, never special-case |
| D2 | Keyword identity | Keywords identified by **URI**; a vocabulary is a named map of keyword URIs; a dialect is an ordered set of vocabularies; drafts are predefined dialects. All data, no privileged built-ins. | Enables multi-draft + custom vocabularies with one mechanism (idea also proven in the ecosystem; implementation is ours per D15) | — |
| D3 | Keyword interface | `analyze(schemaValue, lexicalScope) → StaticFacts` + `evaluate(schemaValue, cursor, ctx) → boolean` (§3). Applicators request subschema application through the engine; the engine owns path/scope/frame bookkeeping in exactly one place. | Prototype: 30 keywords fit this shape; engine-owned descent is what makes locations constants for the compiler | — |
| D4 | Keyword communication | **Frame-scoped production channel** (§4): schema application pushes a frame; productions merge to the parent frame only on success. Annotation dropping, in-place-applicator visibility for `unevaluated*`, and cousin-invisibility all fall out of the one scoping rule. | Prototype: 852 suite cases + channels tests pass with no per-keyword special cases | IETF keyword-communication experiments needing non-annotation payloads → add production kinds, not mechanisms |
| D5 | Annotation retention | Retention policy supplied at compile/evaluate time: allow-list by keyword name and vocabulary URI, schema/instance-location predicates; internal consumers always see the channel regardless of retention ("transient" retention). Compiler memoizes one artifact per (schema, policy, output config). | Spec-sanctioned (ANALYSIS.md §5 quotes); SPIKE.md: policy-specialized artifact 32M ops/s vs 51M with annotations fully elided — cost proportional to retention | — |
| D6 | Output | Evaluation path tracked natively (constant in compiled code; push/pop + lazy string materialization in the interpreter). One internal result tree; renderers for 2020-12/-02 Flag/Basic/Detailed/Verbose with `keywordLocation`/`absoluteKeywordLocation` **and** current-output-spec flag/list/hierarchical with `evaluationPath`/`schemaLocation`. Field vocabulary and structure are orthogonal knobs. **Default field vocabulary: `evaluationPath`/`schemaLocation`**, with the 2020-12 names as a compatibility option (owner decision, 2026-07-05). | The engine exists partly because both incumbents refuse half of this | Output spec changes upstream |
| D7 | Async boundary | Loading/registration async (loaders for file/http/media types); **`compile` and `evaluate` are sync**. | Hyperjump's async-generator compile pipeline is a real tax; resource I/O is the only inherent async | — |
| D8 | Dynamic scope | Full 2020-12 `$dynamicRef` semantics: dynamic scope = stack of entered schema resources; resolution requires the anchor lexically at the target, then rebinds to the outermost dynamic scope containing a matching `$dynamicAnchor`. 2019-09 `$recursiveRef/(Anchor)` as the degenerate case. Compiler marks everything dynamically reachable from a `$dynamicRef`-influenced scope as a dynamic island → interpreter trampoline with the compiled caller's scope stack. | The single thing AJV got structurally wrong (fragment-only, root-registry, first-write-wins); prior art in the user's oas-tree-viewer `dynamicScope.ts` strict-winner analysis | — |
| D9 | Lowering catalogue | Compiler lowerings, each licensed by `StaticFacts`: (a) `unevaluated*` → static evaluated-name/index sets when all contributors are static, else runtime evaluated-set tracking; (b) production elision when no consumer (retention ∪ dependent keywords) exists; (c) constant-location emit sites incl. through static `$ref`; (d) small-set membership → equality chains (threshold ~8, measure), else hoisted `Set`; (e) lazy error/annotation unit materialization; (f) regex/format hoisting. | SPIKE.md findings 1–5 (finding 4: equality-chain vs `Set.has` moved a ratio from 1.34 to 0.82) | Benchmarks show a lowering never pays |
| D10 | Compiler output modes | Runtime compilation (`new Function`) **and** standalone source emission (build-time artifact, CSP-safe, serverless cold-start). Interpreter is the always-available CSP-safe fallback. | Matches ajv standalone + cfworker niches; spike modeled the standalone case | — |
| D11 | Draft support | Native in core: 2020-12, IETF drafts, 2019-09, draft-07. draft-04/06 as a separately packaged legacy dialect module. | ANALYSIS.md §7.7: market center of mass is draft-07+; keeps oldest quirks out of the core | ajv-compat adoption data shows heavy draft-04 demand |
| D12 | Testing strategy | Official suite as git submodule with a generated runner; **both tiers must pass the identical suite**; differential fuzzing (interpreter vs compiler on suite schemas × mutated instances) as the compiler's primary correctness gate; Bowtie harness from M3; releases are conformance-gated (suite + Bowtie green or no release). | The suite is the clean-room discipline (D15) and the marketing story | — |
| D13 | Error model | Keywords emit structured error data (keyword id, params, message key) into units; message rendering is a presentation concern. Params designed so ajv-compat can reconstruct `instancePath`/`schemaPath`/`params` mechanically. | Compat layer must not parse message strings | — |
| D14 | Strictness | Validator core is spec-clean (spec-valid schemas evaluate per spec; unknown keywords annotate per SHOULD). AJV-strict-style schema hygiene is **opt-in only**, via two paths: (a) a separate lint layer, out of the validation path; (b) **stricter meta-schemas** covering the common strict-mode use cases — worth offering as the idiomatic migration path since it stays inside the spec's own extension model. ajv-compat may enable hygiene checks where AJV's defaults imply them, since compat mode is itself opt-in. | Owner decision 2026-07-05; ANALYSIS.md §14; overlaps the user's OAS-viewer lint/SARIF roadmap | — |
| D15 | IP policy | Implementation from specs + official suite only. AJV/Hyperjump may be executed as oracles/benchmarks; their code is never read for implementation, ported, or translated. Concepts noted in ANALYSIS.md §11 (keyword-URI registries, evaluated-set lowering, standalone emission, media-type loading) are used as ideas. Compat layers reproduce public API *surfaces* only. **This policy binds every implementation session, including subagents — restate it in any task prompt.** | No colorable derivation claim, per project owner | — |
| D16 | Packaging | Monorepo, npm workspaces; packages under a scope TBD (owner decision, M0 blocker): `core`, `compiler`, `formats`, `dialect-legacy` (draft-04/06), `ajv-compat`, `test-kit` (suite runner + differential fuzzer), `bench`. `hyperjump-compat` later, likely just a documented shim. | Mirrors the staging in §6 | — |
| D17 | Source-position correlation | Loaders MAY report positions: a loader returns `{ value, getRange?: (documentRootPointer) => Range \| undefined }` — a *function*, so implementations can keep a parse AST and resolve lazily instead of materializing a map. `Range` distinguishes **key range vs value range** for object members (diagnostics point at keys for missing/extra-property errors, values for type errors; SARIF/LSP need both). The registry records a `resource base URI → (document URI, document-root pointer prefix)` table during the registration walk, so canonical `schemaLocation`s (which are resource-rooted) translate to document-rooted pointers for lookup. Correlation happens only at unit escape or via an on-demand `locate()` helper — **zero hot-path cost, zero cost when no loader provides positions**. Instance-side correlation uses the same `getRange` interface against `instanceLocation` and needs no registry involvement. The M6 compiler is unaffected (constant location strings; correlation is post-hoc). | Owner request 2026-07-05: diagnostics tooling (SARIF/LSP-class consumers) needs pointer→line/column | Position-map memory becomes a problem for huge documents → the function interface already permits offset-only or windowed implementations |

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
  readonly id: string;                    // keyword URI (D2)
  // Static facts for the compiler and for schema preprocessing. Pure.
  analyze?(value: V, scope: LexicalScope): StaticFacts;
  // Interpreter semantics. Sync (D7). Applicators use ctx.applyChild/applyRef;
  // they never recurse into the engine themselves.
  evaluate(value: V, cursor: InstanceCursor, ctx: EvalContext): boolean;
}

interface StaticFacts {
  subschemas?: SubschemaPosition[];       // where child schemas live
  produces?: ProductionKind[];            // channel productions it can emit
  consumes?: ProductionKind[];            // channel productions it reads
  evaluatesNames?: StaticNameSet;         // static contribution to evaluated props
  evaluatesIndexes?: StaticIndexSpan;     // static contribution to evaluated items
  dynamicScopeSensitive?: boolean;        // $dynamicRef and friends (D8)
}
```

Engine-owned context services (the only path to descent, locations, and the
channel — this is what makes D1's compiler contract enforceable):
`ctx.applyChild(segments, cursor)`, `ctx.applyRef(target)`, `ctx.produce(value)`,
`ctx.visibleProductions(kinds)`, `ctx.error(params)`. See `prototype/engine.ts`
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
   successful in-place child applications, and *not* seeing cousins or failed
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

| M | Deliverable | Tier | Done-signal (mechanical) |
|---|---|---|---|
| M0 | Monorepo scaffolding (D16): workspaces, TS/vitest/CI, suite submodule, generated suite runner in `test-kit` | patterned | CI green; suite runner executes and reports per-file totals |
| M1 | `core` interpreter: registry, cursor, context, channel, cycle guard, output result tree + Basic/list renderers (both vocabularies); the six exemplar keywords from §3 promoted to production form | judgment | Prototype's suite file list + channels tests green under `core`; prototype deleted |
| M2 | Keyword fan-out: full 2020-12 assertion/applicator/annotation set, per exemplar patterns | patterned | Full draft2020-12 suite green except `dynamicRef`, `vocabulary`, `refRemote`; each keyword lands with its suite file |
| M3 | References hardened: `$dynamicRef`/dynamic scope (D8), `$vocabulary` processing, remote-resource loaders **including the D17 position capability** (`getRange`, key/value ranges) with an `Engine.locate()` helper and an opt-in unit-decoration flag, metaschema validation policy | judgment | `dynamicRef`, `anchor`, `vocabulary`, `refRemote` (suite remotes served by test-kit) green; local Bowtie run ≥ 99%; position lookup round-trips through an embedded-`$id` resource |
| M4 | Dialects: 2019-09 (incl. `$recursiveRef`) and draft-07 | patterned ( `$recursiveRef` piece: judgment) | draft2019-09 and draft7 suites green |
| M5 | Output completion: Detailed/Verbose/hierarchical renderers, golden fixtures | patterned | Renderer goldens + output-format tests green |
| M6 | `compiler`: static analysis over `StaticFacts`, lowering catalogue (D9), trampoline (D8), both output modes (D10) | judgment | Differential fuzz (test-kit): interpreter ≡ compiler over suite schemas × mutated instances; bench meets SPIKE gate on the spike schemas |
| M7 | `formats` package (annotation + assertion modes) | patterned | format suite incl. optional format-assertion tests green |
| M8 | `ajv-compat`: API surface, error mapping (D13), formats parity, loud failure for `code`-keywords and `$data` (§7); PoC against a fastify app and an OpenAPI validator | judgment (surface) + patterned (mapping tables) | Compat test suite green; both PoCs validate real traffic |
| M9 | `bench` harness (compile/first/hot/annotations-on × corpora), Bowtie onboarding PR, docs | patterned | Published Bowtie report; bench reproducible in CI |
| M10 | `dialect-legacy`: draft-04/06 | patterned | draft4/draft6 suites green |

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
