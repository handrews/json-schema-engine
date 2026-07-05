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

## Code in this repo (throwaway, semantics are not)

- `spike/` — hand-written "compiled" validators + benchmark harness
  (`npm run bench`; installs nothing at runtime, competitors are dev deps).
- `prototype/` — F2 channels prototype: miniature interpreter with the
  production-channel/retention design, run against the official
  JSON-Schema-Test-Suite (`npm test`; 852/852 non-skipped draft2020-12 cases
  green). Requires the suite: `git clone --depth 1
  https://github.com/json-schema-org/JSON-Schema-Test-Suite.git test-suite`.

Both directories exist to validate DESIGN.md decisions and serve as exemplars;
per DESIGN.md M1, the real `core` package replaces them.

## Commands

```
npm install
git clone --depth 1 https://github.com/json-schema-org/JSON-Schema-Test-Suite.git test-suite
npm test            # prototype vs official suite + channels tests
npm run bench       # F1 spike benchmarks (oracle-gated)
npm run check-types
```

## IP policy

Implementation is written from the specifications and the official test suite
only. AJV and Hyperjump are executed as benchmark subjects and correctness
oracles; their source is not an implementation reference. See DESIGN.md D15.
