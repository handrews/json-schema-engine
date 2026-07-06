# Contributing

This document covers setup, testing, and project conventions. Architecture
and design rationale live in [DESIGN.md](DESIGN.md); do not look for them
here.

## Setup

Requirements: Node 24+, git. Optional for conformance reporting: podman and
[Bowtie](https://docs.bowtie.report/).

```txt
git clone <repo>
cd json-schema-engine
git submodule update --init   # official JSON-Schema-Test-Suite
npm ci                        # NOT npm install — see below
```

### Use `npm ci`, not `npm install`

npm on macOS has repeatedly written a `package-lock.json` missing hoisted
optional entries (`@emnapi/core`, `@emnapi/runtime` — optional peers of
`@napi-rs/wasm-runtime` in the toolchain's dependency tree). The lockfile
works locally but fails `npm ci` on Linux CI with
`Missing: @emnapi/core@… from lock file`.

- Day to day: `npm ci`.
- After an intentional dependency change: run `npm install`, then check that
  the hoisted `node_modules/@emnapi/core` and `node_modules/@emnapi/runtime`
  entries still exist in `package-lock.json`. If they were dropped, restore
  them (copy the shape from git history — see commit `ecc388a`), then verify
  with `rm -rf node_modules && npm ci`.
- Never "fix" CI by switching it to `npm install`.

## Repository layout

| Path                | Contents                                                             |
| ------------------- | -------------------------------------------------------------------- |
| `packages/core`     | The engine: registry, dialects, evaluation, output renderers         |
| `packages/test-kit` | Official-suite runner, output-tests runner, position-tracking parser |
| `test-suite/`       | Git submodule: official JSON-Schema-Test-Suite (pinned)              |
| `bowtie/`           | Bowtie harness (IO protocol) and Containerfile                       |
| `spike/`            | F1 benchmark spike; target output shape for the M6 compiler          |
| `docs/guide/`       | User guide (hand-written markdown)                                   |
| `docs/reference/`   | Generated API reference (gitignored; `npm run docs:api`)             |

## Commands

| Command                | Purpose                                              |
| ---------------------- | ---------------------------------------------------- |
| `npm test`             | Full workspace test run (vitest)                     |
| `npm run check-types`  | `tsc --noEmit`                                       |
| `npm run lint`         | ESLint (type-checked strict tier + TSDoc syntax)     |
| `npm run lint:fix`     | ESLint with autofix                                  |
| `npm run format`       | Prettier write                                       |
| `npm run format:check` | Prettier check (CI gate)                             |
| `npm run bench`        | F1 spike benchmark; oracle-gated (see DESIGN.md D12) |
| `npm run docs:api`     | Generate `docs/reference/` from TSDoc comments       |

CI runs check-types, lint, format:check, test, and docs:api on every push.

## Conformance testing

Each supported dialect has a suite runner in `packages/core/test/`
(`suite.test.ts`, `suite2019.test.ts`, `suite7.test.ts`, `suite6.test.ts`)
plus an elision differential (`elision.test.ts`) that evaluates every case
twice.

**Zero-skip discipline.** The runner prints a summary line per file set:

```txt
suite cases run: 1299, group/case skips: 0
```

A thrown error during evaluation is reported as a skip, not a failure, and
vitest's totals will NOT show it. When touching evaluation code, check the
summary line (`npx vitest run packages/core/test/suite.test.ts
--reporter=verbose | grep "suite cases"`), not just the pass count. Each
runner's `minRun` is a floor set ~2% under the expected case count to catch
mass skipping.

The official suite's remote resources are served from the submodule's
`remotes/` directory by `suiteRemotesLoader` — no HTTP server is involved.

### Bowtie

The `bowtie/` directory contains a harness image for
[Bowtie](https://docs.bowtie.report/). With podman and bowtie installed:

```txt
podman build -t localhost/jse-bowtie -f bowtie/Containerfile .
bowtie suite -i image:localhost/jse-bowtie test-suite/tests/draft2020-12 \
  | bowtie summary
```

Repeat per dialect directory (`draft2019-09`, `draft7`, `draft6`). Releases
are conformance-gated: suite and Bowtie green, or no release (DESIGN.md
D12).

## Documentation conventions

- Voice: crisp and professional. Short declarative sentences.
- Document as-is. No historical narrative unless history explains a current
  rule (the `npm ci` section above is the model).
- User guide (`docs/guide/`): examples over prose. Mark areas that upcoming
  milestones will change with a `TBD` note instead of documenting twice.
- Every fenced ` ```ts ` block in `docs/guide/*.md` and `README.md` is
  **executed by CI** (`packages/core/test/docs.test.ts`): it must be a
  self-contained module that imports what it uses (`@jse/core`,
  `node:assert`) and throws on failure. Use ` ```jsonc ` or ` ```txt ` for
  non-runnable content.
- API reference comes from TSDoc comments on exported symbols; run
  `npm run docs:api` and review the output when changing public API
  documentation.

## Code comment policy

- Comments explain WHY — a constraint the code cannot show. Never restate
  what the next line does. Never narrate history.
- Never describe downstream behavior (what other code does with a result);
  that knowledge drifts. Describe the local contract only.
- Each complex concept is described in exactly one place; other sites
  reference it. Canonical homes: channel/frame semantics → `engine.ts`
  header; source positions (D17) → `loader.ts`; retention and elision →
  `output.ts` (`makeRecordPredicate`); identifier extraction (D18) →
  `dialect.ts` (`IdentifierFacts`); dynamic-scope resolution (D8) →
  `engine.ts` (`resolveDynamic`/`resolveRecursive`).
- Exported symbols carry TSDoc (`/** */`); internals use `//`.

## Process

- Milestones, done-signals, and the session protocol: DESIGN.md §6. A
  milestone is not done until its mechanical done-signal is green.
- IP policy: DESIGN.md D15. The implementation is written from the
  specifications and the official test suite only; AJV and
  `@hyperjump/json-schema` source is never read for implementation.
- Dependency updates arrive weekly via Dependabot, grouped per ecosystem.
  After merging one, re-run the full gate set locally, and re-check the
  lockfile rule above.
