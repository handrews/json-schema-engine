# Architecture

Maintainer-facing overview of how the engine is put together. The decision
record behind each element is [DESIGN.md](../DESIGN.md); the market and
architecture analysis is [ANALYSIS.md](../ANALYSIS.md). This page describes
the system as built through M9a: both tiers are operational across every
supported dialect, including compiled list/annotation output and runtime
evaluated-set tracking for dynamic `unevaluated*` coverage. Differential
suite and fuzz gates referee flag, list, and annotation agreement.

## Two tiers, one keyword registry

The engine is an annotation-first, two-tier design (D1). The interpreter in
`@jse/core` is the reference semantics: spec-faithful, CSP-safe (no code
generation anywhere in its dependency graph), covering all four built-in
dialects and every output format. The compiler in `@jse/compiler` emits
specialized JavaScript for the static parts of a schema and falls back to
the interpreter — through one trampoline — for everything else.

Both tiers share a single source of keyword knowledge: the keyword behavior
registered by URI in the dialect registry (D2). A behavior contributes up to
three views of one semantic:

- `analyze(value, context?)` — static facts: subschema positions, reference
  URIs, regex values, channel produces/consumes, evaluated-coverage
  contributions, application edges (D9a).
- `evaluate(value, cursor, ctx)` — interpreter semantics.
- `lower(value, lctx)` — optional compiled form, expressed as IR through a
  `LoweringContext`, never as JavaScript text. A keyword without `lower()`
  makes its schema object an interpreted unit — a fallback, not a failure.

The compiler consumes only `analyze()` facts and `lower()` IR (D1). It never
dispatches on keyword names, which is what prevents the two tiers from
drifting apart semantically.

## Pipeline

```mermaid
flowchart TD
    SD["schema documents"] --> REG
    subgraph CORE ["@jse/core"]
        REG["registration walk\nidentifiers · dialects · refs\n(analyze-driven, D18/D19)"]
        REG --> RY[("SchemaRegistry\ndocuments · anchors ·\ndialects · behaviors")]
        INT["interpreter\nframe channel (§4) ·\ndynamic scope (D8) ·\ncycle + depth guards (D20)"]
        RY --> INT
        OUT["output renderers\nflag · list · hierarchical ·\nBasic/Detailed/Verbose (D6)"]
        INT -- "RenderInput" --> OUT
    end
    subgraph COMP ["@jse/compiler"]
        PLAN["planner\nstatic units vs interpreted units\n(islands, fallbacks, cycles)"]
        LOWER["keyword lower() → IR"]
        EMIT["gated serializer\ntyped escapes only (D20)"]
        ART["artifact\nper schema × retention × output\nconstant locations (D9)"]
        PLAN --> LOWER --> EMIT --> ART
    end
    RY -- "analyze() facts" --> PLAN
    ART -- "evaluateFragment\n(scope · path · depth · cursor)" --> INT
    INT -- "valid · errors · records" --> ART
    INS["instance"] --> INT
    INS --> ART
    ART --> OUT2["flag · flat errors/annotations"]
    ART -- "RenderInput (recorded tree)" --> OUT
```

## The channel

Keyword output flows through a frame-scoped record channel (DESIGN §4,
normative; implemented once, in `engine.ts`) carrying two record kinds:
annotations, whose value is the keyword's own value and which are output, and
dependency data, computed information one keyword communicates to another
and never output. Each schema application pushes a frame; keywords annotate
and produce into it; the frame merges into its parent on success and is
discarded on failure. Consumers (`unevaluatedProperties`/`unevaluatedItems`)
see the current frame's dependency records filtered by cursor identity.
Retention policy filters only annotations in the final result — never
consumer visibility — and elision (D5) drops annotations that cannot be
retained and dependency data that nothing consumes.

The compiler specializes statically known evaluated coverage directly into
consumer sweeps. Dynamic coverage uses a runtime channel with the same
success-merge/failure-discard semantics (array marks and truncation); in-place
islands return surviving root-cursor dependency data to that channel. A
tracked consumer nested inside another tracked in-place region still islands
rather than nesting compiled channel scopes.

## Dynamic scope and islands

`$dynamicRef` resolution (D8) walks a stack of entered schema resources,
outermost first. In compiled artifacts, everything whose evaluation depends
on dynamic state — plus any unit the planner cannot or chooses not to
compile — becomes an _interpreted unit_: compiled code calls
`evaluateFragment` with its constant dynamic-scope contribution, evaluation
path prefix, consumed depth budget, and the instance cursor, and harvests
`{valid, errors, annotations, dependencies}` back. The trampoline is one-way: interpreted
code never re-enters compiled code. That invariant is what makes the channel
analysis of compiled units tractable (an island can only feed its compiled
_ancestors_, never siblings), and it is recorded as a revisit trigger in
DESIGN.md should island-internal recompilation ever be attempted.

## Security posture

The interpreter's resource bounds (ReDoS hooks, uniqueItems hashing, depth
bounds) are D20; see [the security guide](guide/security.md). The compiler
adds the code-generation surface: schema-derived data reaches emitted source
only through the serializer's typed escapes (no raw-code IR node exists),
`new Function` is confined to one module serving the runtime mode (D10), and
standalone emission is the CSP-safe build-time alternative. An adversarial
injection corpus — separate from differential fuzzing, which cannot see
emission-time attacks — gates every compiler milestone.

## Source positions

Loaders may report `getRange` (D17); the registry maps canonical schema
locations back through resource → document pointer tables, so diagnostics
can carry line/column ranges at zero hot-path cost. Compiled artifacts are
unaffected: locations are compile-time constants and correlation stays
post-hoc.
