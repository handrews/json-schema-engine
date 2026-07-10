# Project status

The authoritative statement of what is built, what is deliberately staged
for later, and which quality gates run where. Prose elsewhere (README,
DESIGN.md milestone notes, guide pages) defers to this page when they
disagree — and a disagreement is a bug worth filing.

Last updated: 2026-07-09 (post-M8.6/M6.6; M9 remains).

## Built and gated

| Area                              | State                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Interpreter (`@jse/core`)         | Complete for draft 2020-12, 2019-09, draft-07, draft-06: evaluation, annotations, all output structures/vocabularies, `$dynamicRef`/`$recursiveRef`, `$vocabulary` dialects, loaders, source positions, security bounds.                                                                                                                                                                                                                                                                                                                                                  |
| Compiler (`@jse/compiler`)        | Operational: flag-mode and list-mode artifacts, interpreter trampoline for dynamic islands, CSP-safe standalone emission (flag-only). All five supported dialects compile natively (M6.6) — the gate is capability-based (a dialect compiles when its present keywords lower; `refIgnoresSiblings` mirrored generically), so dialect packages become compilable through the public surface alone. Full-suite differentials (flag + list, all dialect directories) and fuzzing referee both tiers.                                                                         |
| Formats (`@jse/formats`)          | All standard formats from their defining RFCs, including full IDNA2008 `idn-hostname`/`idn-email`; format-assertion vocabulary and `assertFormats` configuration.                                                                                                                                                                                                                                                                                                                                                                                                         |
| AJV adapter (`@jse/ajv-compat`)   | Emulated AJV v8 subset with executed-AJV fixture pins; mutation trio; companions (formats parity, discriminator, ajv-errors, ajv-keywords subset). Internals hardened (M8.6): trace-based error mapping (compiled list primary, interpreter escalation for combinator context), lifecycle pinned by scenario oracle (eager refs, duplicate-add refusal, leak-free anonymous compiles), typed mutation non-convergence + plain-data interpreter routing + idempotence property leg. Scope and divergences: [packages/ajv-compat/COMPAT.md](packages/ajv-compat/COMPAT.md). |
| draft-04 (`@jse/dialect-draft04`) | Complete as a separately packaged dialect assembled through core's public surface (DESIGN.md D11/M10): official draft4 suite zero-skip in BOTH tiers (M6.6 — the package's own keywords lower through exported IR; plan census: zero interpreted units over the draft4 corpus), format leg, list-mode differential, mixed-registry coexistence with 2020-12.                                                                                                                                                                                                              |
| Structured error params           | Opt-in `errorParams` channel in both tiers (DESIGN.md D13).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Trace + schema-walk surface       | Stable (promoted from `@alpha` at the M9a publication-readiness pass): `trace: true` on list output renders the evaluation trace (`Result.trace`, `TraceUnit`); `walkSchema` walks schema positions by dialect keyword facts. Interpreter/rendering only — the compiled tier emits no trace (M8.6).                                                                                                                                                                                                                                                                       |

## Gates and where they run

| Gate                                                                             | Where                                                | Notes                                                                                                                                                                                                                                                                                                                                              |
| -------------------------------------------------------------------------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Type check, lint, format, full test suite, API docs                              | Per-PR CI + local                                    | `npm run verify` aggregates the local set.                                                                                                                                                                                                                                                                                                         |
| CSP check (standalone artifacts under `--disallow-code-generation-from-strings`) | Per-PR CI + local                                    | `npm run csp:check`.                                                                                                                                                                                                                                                                                                                               |
| Fuzz differential (interpreter vs compiler, params-refereeing list mode)         | Smoke in per-PR CI; full budget local                | `npm run fuzz`; `FUZZ_LIST=1` for list mode; `FUZZ_DIALECT=draft7\|draft6\|draft2019-09` seeds from that dialect's suite (CI smokes those legs too).                                                                                                                                                                                               |
| Oracle fixture drift (ajv-compat capture scripts vs committed fixtures)          | Per-PR CI                                            | Re-runs capture against the installed AJV.                                                                                                                                                                                                                                                                                                         |
| Benchmark gate (compiled flag mode vs AJV)                                       | Local, before merging perf-relevant work             | Runner variance makes CI benchmarking noisy; results recorded in DESIGN.md notes.                                                                                                                                                                                                                                                                  |
| Official-suite zero-skip discipline                                              | Per-PR CI (inside the test suite)                    | The eleven full-suite dialect legs pin EXACT run counts (`exactRun`); a submodule bump is a deliberate count update. Vitest-level skips are zero repo-wide (native `.skip`/`.only` lint-banned in test files); an evaluation error fails its case directly; the runner's skip mechanism is self-tested through a recorder harness, not real skips. |
| Plan-classification census (exact static/interpreted counts per dialect)         | Per-PR CI (inside the test suite)                    | `explainCompilation` + `runPlanCensus` over every suite dir, flag AND list modes — a silent static→interpreted flip is behaviorally invisible (fallback is correct) but fails these pins.                                                                                                                                                          |
| Gate self-tests (sensitivity + planted divergence + minimizer class guard)       | Per-PR CI (inside the test suite)                    | The list-mode comparison, the factory routing, and the minimizer's class preservation each have tests proving they detect what they claim (FUZZ_LIST-incident lesson).                                                                                                                                                                             |
| Line/branch coverage (compiler + ajv-compat sources)                             | Per-PR CI step + local                               | `npm run coverage` (report + json-summary); thresholds only on ajv-compat's lifecycle surface (index.ts, mutate.ts) — compiler files are report-only, their gates being the suite/differential/fuzz/census stack.                                                                                                                                  |
| Bowtie conformance                                                               | Local harness runs only (M3/M4 records in DESIGN.md) | Public bowtie.report listing requires submission — see below.                                                                                                                                                                                                                                                                                      |

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
- **draft-04 in the Bowtie harness and ajv-compat.** Both staged: the
  harness gains the dialect with M9's onboarding work, and an AJV
  draft-04 compat class is recorded, not built (DESIGN.md M10 notes).
- **ADR split of DESIGN.md, corepack evaluation, custom-keyword author
  contract docs** and other recorded follow-ups: DESIGN.md deferred
  register. (Coverage thresholds and `explainCompilation` were
  discharged 2026-07-09 by the testing-lessons hardening.)

## Known positioning facts

- Compiled **flag-mode** validation is at-or-faster than AJV on the
  benchmark gate corpus (enforced threshold: never slower).
- **List-mode / all-errors** output is slower than AJV **by design**: it
  never short-circuits and reproduces the interpreter's error units
  exactly (order included). Choose flag mode for hot paths.
- ajv-compat is a **migration adapter for a documented subset**, not a
  full AJV clone; divergences are enumerated in COMPAT.md and enforced
  by fixture tests and a suite-differential golden set.
