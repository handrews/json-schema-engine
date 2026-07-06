# json-schema-engine

Pre-implementation work for an **annotation-first, two-tier JSON Schema
implementation** for JavaScript/TypeScript: a spec-faithful interpreter core
plus a compiler tier that emits specialized JS with constant evaluation-path
locations, sharing one keyword registry.

## Read in this order

1. [ANALYSIS.md](ANALYSIS.md) — validated findings on AJV and
   `@hyperjump/json-schema`, why neither converges on "fast **and** complete",
   and the recommended architecture.
2. [SPIKE.md](SPIKE.md) — F1 performance spike results. Verdict: hand-emitted
   compiler-tier output **beats ajv@8 flag mode** (0.46–0.87× ajv/ours) while
   supporting `keywordLocation`-bearing output and retention-configurable
   annotations.
3. [DESIGN.md](DESIGN.md) — the engineering design and milestone contract for
   implementation sessions. Start here if you are implementing.

## Code in this repo

- `spike/` — F1's hand-written "compiled" validators + benchmark harness
  (`npm run bench`; installs nothing at runtime, competitors are dev deps).
  Kept as the M6 compiler tier's target output shape.
- `packages/` — npm workspaces (DESIGN.md D16):
  - `packages/core` (`@jse/core`) — the M1 interpreter core: dialect/
    vocabulary registry (keywords identified by URI), analyze-driven schema
    registration, instance cursors, the frame-scoped production channel with
    retention policy, cycle guard, and output renderers in both location
    vocabularies (`evaluationPath`/`schemaLocation` default,
    `keywordLocation`/`absoluteKeywordLocation` compat). Covers the F2
    prototype's 2020-12 keyword set; keywords owed by M2/M3 are loud
    not-implemented placeholders, never silent annotations. The F2
    `prototype/` directory was absorbed here (its tests live on in
    `packages/core/test/`).
  - `packages/test-kit` (`@jse/test-kit`) — reusable official-suite runner
    generalized from `prototype/suite.test.ts`'s schema-position-only
    unsupported-keyword scan and group/test iteration. Exposes a
    dependency-free "collect" mode (`runSuiteFiles`) returning per-file/
    per-case results, and a thin `runSuiteFilesVitest` wrapper that registers
    `describe`/`it` (vitest is injected by the caller, not imported by the
    package). `packages/test-kit/src/self-test.test.ts` exercises the skip
    and pass/fail counting machinery itself.

`test-suite/` is a git submodule pinned to the official
[JSON-Schema-Test-Suite](https://github.com/json-schema-org/JSON-Schema-Test-Suite)
repo.

## Commands

```
git submodule update --init
npm install
npm test            # core vs official suite + channels/output/engine tests + test-kit self-test
npm run bench       # F1 spike benchmarks (oracle-gated)
npm run check-types
```

## IP policy

Implementation is written from the specifications and the official test suite
only. AJV and Hyperjump are executed as benchmark subjects and correctness
oracles; their source is not an implementation reference. See DESIGN.md D15.
