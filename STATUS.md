# Project status

The authoritative statement of what is built, what is deliberately staged
for later, and which quality gates run where. Prose elsewhere (README,
DESIGN.md milestone notes, guide pages) defers to this page when they
disagree — and a disagreement is a bug worth filing.

Last updated: 2026-07-07 (post-M8, pre-M9).

## Built and gated

| Area                            | State                                                                                                                                                                                                                                     |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Interpreter (`@jse/core`)       | Complete for draft 2020-12, 2019-09, draft-07, draft-06: evaluation, annotations, all output structures/vocabularies, `$dynamicRef`/`$recursiveRef`, `$vocabulary` dialects, loaders, source positions, security bounds.                  |
| Compiler (`@jse/compiler`)      | Operational: flag-mode and list-mode artifacts, interpreter trampoline for dynamic islands, CSP-safe standalone emission (flag-only). Full-suite differential and fuzzing referee both tiers.                                             |
| Formats (`@jse/formats`)        | All standard formats from their defining RFCs, including full IDNA2008 `idn-hostname`/`idn-email`; format-assertion vocabulary and `assertFormats` configuration.                                                                         |
| AJV adapter (`@jse/ajv-compat`) | Emulated AJV v8 subset with executed-AJV fixture pins; mutation trio; companions (formats parity, discriminator, ajv-errors, ajv-keywords subset). Scope and divergences: [packages/ajv-compat/COMPAT.md](packages/ajv-compat/COMPAT.md). |
| Structured error params         | Opt-in `errorParams` channel in both tiers (DESIGN.md D13).                                                                                                                                                                               |

## Gates and where they run

| Gate                                                                             | Where                                                | Notes                                                                                                                                                       |
| -------------------------------------------------------------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Type check, lint, format, full test suite, API docs                              | Per-PR CI + local                                    | `npm run verify` aggregates the local set.                                                                                                                  |
| CSP check (standalone artifacts under `--disallow-code-generation-from-strings`) | Per-PR CI + local                                    | `npm run csp:check`.                                                                                                                                        |
| Fuzz differential (interpreter vs compiler, params-refereeing list mode)         | Smoke in per-PR CI; full budget local                | `npm run fuzz`; `FUZZ_LIST=1` for list mode.                                                                                                                |
| Oracle fixture drift (ajv-compat capture scripts vs committed fixtures)          | Per-PR CI                                            | Re-runs capture against the installed AJV.                                                                                                                  |
| Benchmark gate (compiled flag mode vs AJV)                                       | Local, before merging perf-relevant work             | Runner variance makes CI benchmarking noisy; results recorded in DESIGN.md notes.                                                                           |
| Official-suite zero-skip discipline                                              | Per-PR CI (inside the test suite)                    | Suite runners assert minimum case counts. The 11 vitest-level skips are the test-kit's own self-test exercising its skip mechanism — not conformance skips. |
| Bowtie conformance                                                               | Local harness runs only (M3/M4 records in DESIGN.md) | Public bowtie.report listing requires submission — see below.                                                                                               |

## Deliberately not done yet

These are staged, not overlooked. Each is gated on an explicit decision
or milestone:

- **npm publication, package names, install docs.** All packages are
  `private`, version `0.0.0`, and export TypeScript source directly —
  a workspace-development posture, not a release artifact. Build
  outputs (`dist/`, `.d.ts`), tarball tests, and naming land with M9,
  gated on the owner's npm scope/name decisions.
- **Bowtie submission.** The harness container and results are prepared
  in M9; the PR to Bowtie is made by the owner personally (no automated
  PRs, ever — project policy).
- **draft-04.** A separately packaged dialect (`M10`), re-justified in
  DESIGN.md D11: it exists for the owner's oaskit project and as the
  reference for third-party dialect authoring, not for AJV migration.
- **Compiled lowering for draft-07/06-specific keywords** (M6.6):
  legacy-dialect schemas currently take the interpreter path under
  compilation, which is correct but slower.
- **ajv-compat internals hardening** (M8.6): the error adapter's
  path-string heuristics move to structured traces, engine lifecycle
  (anonymous-schema growth, stale-artifact semantics) gets pinned
  against AJV, and the mutation fixpoint gains property tests and
  non-convergence reporting. Behavior today is correct per the fixture
  and differential gates; M8.6 hardens the mechanisms behind them.
- **Coverage thresholds, ADR split of DESIGN.md, compiler fallback
  diagnostics** and other recorded follow-ups: DESIGN.md deferred
  register.

## Known positioning facts

- Compiled **flag-mode** validation is at-or-faster than AJV on the
  benchmark gate corpus (enforced threshold: never slower).
- **List-mode / all-errors** output is slower than AJV **by design**: it
  never short-circuits and reproduces the interpreter's error units
  exactly (order included). Choose flag mode for hot paths.
- ajv-compat is a **migration adapter for a documented subset**, not a
  full AJV clone; divergences are enumerated in COMPAT.md and enforced
  by fixture tests and a suite-differential golden set.
