# Contributing

This document covers setup, testing, and project conventions. The system
overview and diagram live in [docs/architecture.md](docs/architecture.md);
decision rationale lives in [DESIGN.md](DESIGN.md); do not look for either
here.

The joint unpublished-development plan for aligning this repository with the
downstream project, including the planned pnpm migration, is kept with that
project's tooling-convergence plan.

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

| Path                       | Contents                                                             |
| -------------------------- | -------------------------------------------------------------------- |
| `packages/core`            | The engine: registry, dialects, evaluation, output renderers         |
| `packages/dialect-draft04` | draft-04 dialect, assembled through core's public surface            |
| `packages/test-kit`        | Official-suite runner, output-tests runner, position-tracking parser |
| `test-suite/`              | Git submodule: official JSON-Schema-Test-Suite (pinned)              |
| `bowtie/`                  | Bowtie harness (IO protocol) and Containerfile                       |
| `spike/`                   | F1 benchmark spike; target output shape for the M6 compiler          |
| `docs/guide/`              | User guide (hand-written markdown)                                   |
| `docs/reference/`          | Generated API reference (gitignored; `npm run docs:api`)             |

## Commands

| Command                 | Purpose                                              |
| ----------------------- | ---------------------------------------------------- |
| `npm test`              | Full workspace test run (vitest)                     |
| `npm run check-types`   | `tsc --noEmit`                                       |
| `npm run lint`          | ESLint (type-checked strict tier + TSDoc syntax)     |
| `npm run lint:fix`      | ESLint with autofix                                  |
| `npm run format`        | Prettier write                                       |
| `npm run format:check`  | Prettier check (CI gate)                             |
| `npm run bench`         | F1 spike benchmark; oracle-gated (see DESIGN.md D12) |
| `npm run docs:api`      | Generate `docs/reference/` from TSDoc comments       |
| `npm run build`         | `tsc -b`: dist/ js + d.ts for publishable packages   |
| `npm run pack:check`    | Publication gate: offline tarball install + smoke    |
| `npm run bowtie`        | Bowtie conformance, exact per-dialect pins           |
| `npm run bench:harness` | Report-only corpora bench vs ajv/hyperjump           |
| `npm run bench:compare` | Ratio table between two harness results files        |

CI runs check-types, lint, format:check, test, and docs:api on every push.

## Package resolution and publication shape

`package.json` exports are publication-first: `types`/`default` point at
`dist/`, and in-repo development resolves TS source through the custom
`jse-source` condition (root tsconfig `customConditions`, vitest
`resolve.conditions`, `tsx --conditions=jse-source` in npm scripts). A
new execution surface that imports `@json-schema-engine/*` by package name must enable
that condition or it will resolve — and possibly miss — `dist/`.

The public packages (`core`, `compiler`, `formats`, `dialect-draft04`)
publish to npm under the `@json-schema-engine` scope with
`publishConfig.access: public`. `ajv-compat` and `test-kit` stay
`private: true`; nothing publishes them.

**Consuming an unpublished package or a candidate build:** run
`npm run build`, then install tarballs produced by
`npm pack -w packages/<name>` (npm does not reliably run prepare scripts
for `file:` directory dependencies, so prefer tarballs over directory
links). `npm run pack:check` proves the tarballs install offline, carry
LICENSE and README, and type-check from a consumer.

### Releasing

Every package carries the same version; a release bumps every
`packages/*/package.json`, the inter-package ranges, the root
`package.json`, and the lockfile together, in one commit. Tag the merged
commit `v<version>`: the `Publish` workflow (`.github/workflows/publish.yml`)
runs the gates and publishes every public workspace through npm trusted
publishing, which attaches provenance. A package's first release is made
by the owner with a publish token, since npm configures a trusted publisher
on an existing package; the trusted publisher (this repository, workflow
`publish.yml`) is then set on npmjs.com and tokens disallowed.

## Conformance testing

Each supported dialect has a suite runner in `packages/core/test/`
(`suite.test.ts`, `suite2019.test.ts`, `suite7.test.ts`, `suite6.test.ts`)
plus an elision differential (`elision.test.ts`) that evaluates every case
twice. draft-04's runner, format leg, and elision differential live with
its dialect package (`packages/dialect-draft04/test/`).

**Zero-skip discipline.** Vitest totals are authoritative: the expected
repo-wide skip count is **0** (lint bans native `.skip`/`.only` in test
files; the test-kit self-test exercises the runner's skip mechanism through
a recorder, not real skips), and a thrown error during evaluation fails its
case directly with the real stack. Each suite leg additionally pins its
EXACT case count (`exactRun`) in a trailing summary test — running more or
fewer cases than the pin fails the leg, so a test-suite submodule bump is a
deliberate count update. The runner still prints a summary line per file
set as a diagnostic for WHICH cases skipped:

```txt
suite cases run: 1299, group/case skips: 0
```

The official suite's remote resources are served from the submodule's
`remotes/` directory by `suiteRemotesLoader` — no HTTP server is involved.

### Bowtie

The `bowtie/` directory contains a harness image for
[Bowtie](https://docs.bowtie.report/) covering all five dialects
(draft-04 ships in the image from its dialect package). With a container
tool (podman or docker) and the bowtie CLI installed:

```txt
npm run bowtie
```

builds `localhost/json-schema-engine-bowtie`, smokes it, runs every dialect's official
suite directory through Bowtie, and pins EXACT per-dialect test counts
with zero failures/errors/skips (1299/1259/927/839/618). CI runs the
same script in its own job. macOS PATH note: the script also searches
`/opt/podman/bin` and `~/Library/Python/*/bin`.

The image is never pushed to any registry and no results are submitted;
the public bowtie.report listing is a separate, owner-performed step.
Releases are conformance-gated: suite and Bowtie green, or no release
(DESIGN.md D12).

## Documentation conventions

- Voice: crisp and professional. Short declarative sentences.
- Document as-is. No historical narrative unless history explains a current
  rule (the `npm ci` section above is the model).
- User guide (`docs/guide/`): examples over prose. Mark areas that upcoming
  milestones will change with a `TBD` note instead of documenting twice.
- Every fenced ` ```ts ` block in `docs/guide/*.md`, `docs/conformance.md`,
  `README.md`, and `packages/*/README.md` is
  **executed by CI** (`packages/core/test/docs.test.ts`): it must be a
  self-contained module that imports what it uses (`@json-schema-engine/core`,
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
