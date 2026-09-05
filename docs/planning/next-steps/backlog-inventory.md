# Backlog inventory

**Baseline:** JSE `main` at `044b3c5a`, IETF draft-03, the machines-oriented
output proposal at `4f56a990`, and the transform gist at `c164535e`,
2026-09-05. Documented compatibility divergences are not promoted into promised
fixes. Public release is now a near-term project stage; owner-controlled
publication actions remain separate from architectural decisions.

## IETF draft-03 semantic foundation

| ID  | Item                                                     | Dependencies and completion signal                                                                                                                                                                 |
| --- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1  | Separate annotations from keyword dependency information | Classify every built-in `produce`/`consume` occurrence; exact-value annotations are output, while static/runtime dependencies have distinct internal semantics and cannot reach annotation output. |
| S2  | Implement keyword/schema relevance and irrelevance       | Executable monotonic relevance model; consumers see only currently relevant dependency data; terse output omits irrelevant errors/annotations and verbose targets can identify them.               |
| S3  | Reconcile short-circuit and retention analysis           | Annotation, error, dependency, and verbose-output demand are distinct; prove every short-circuit preserves configured output and dependency behavior.                                              |
| S4  | IETF draft-03 terminology and conformance guide          | Use “IETF draft-03,” distinguish input from accepted instance, map JSE concepts to target-format fields, and add direct-sibling/applicator/reference conformance fixtures.                         |
| S5  | Optional 2020-12/2019-09 computed-annotation output      | Nice-to-have after S1/S2/E2. Either synthesize through an explicitly configured output-only adapter with no dependency effects and tier parity, or record a decision to drop it.                   |

## Evaluator, compiler, and output

| ID  | Item                                                                        | Dependencies and completion signal                                                                                                                                          |
| --- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E1  | Freeze registry visibility across compiled code and interpreter trampolines | Compile an unresolved-ref island, register its target, prove the old artifact still throws while a new artifact sees it. Constrains A3/A6.                                  |
| E2  | Flexible output-format architecture                                         | Depends on S1-S3; map stable JSE concepts to IETF and machines-oriented targets, allow new formats without evaluator changes, and preserve useful TypeScript result typing. |
| E3  | Standalone emission for selected non-flag formats                           | Depends on E1/E2; prove parity for errors, exact annotations, relevance, format requirements, and closed-world behavior.                                                    |
| E4  | Island re-entry                                                             | Depends on E1 and overlaps E6; require measured benefit.                                                                                                                    |
| E5  | Generated membership thresholds (D9d)                                       | Representative Set-versus-chain benchmarks plus differential/fuzz parity.                                                                                                   |
| E6  | Nested runtime-dependency consumers                                         | After S1/S2, measure current islands, prototype nested scopes, and preserve relevance, local visibility, failed discard, successful merge, and outer visibility.            |
| E7  | AJV `code.source` mapping                                                   | Compatibility feature depending on standalone decisions, not publication.                                                                                                   |
| E8  | Split serializer responsibilities                                           | Separate orchestration from emission, rendering, guard CSE, and inlining before E3/E6 complexity if warranted.                                                              |
| E9  | Validate format-specific options and capabilities                           | One typed mechanism for incompatible options such as current list-only `errorParams`/`trace` and future renderer data requirements.                                         |
| E10 | Compiler-tier user guide                                                    | User-facing guide listed as TBD in `docs/guide/index.md`; follows stable artifact/output APIs.                                                                              |

A strict-hygiene compiler mode for unusual prototypes is mentioned but is not a
formal deferred-register commitment. Confirm a consumer and contract first.

## Dialects, registry, and extension APIs

| ID  | Item                                         | Dependencies and completion signal                                                                                                                                        |
| --- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Explicit dialect keyword overrides           | Reject accidental collisions; pin declared precedence, identity, order, and multiple-override ambiguity; migrate discriminator replacement.                               |
| D2  | Optional `registerSchema` retrieval URI      | Infer after dialect selection only from an absolute root identifier; cover native, draft-04, relative/no-id, boolean, alias, and ignored-sibling cases. API form is open. |
| D3  | Dialect/keyword authoring guide              | Use draft-04 end to end; cover assembly, identifiers, schema positions, `analyze`/`evaluate`/`lower`, mixed dialects, errors, differential tests, and plan census.        |
| D4  | Reconcile registration walk and `walkSchema` | Decide whether sharing is possible without bloating the public walker with URI rebasing, anchors, and reference collection.                                               |
| D5  | Native OAS dialect support                   | Depends on D1/D3; OAS 3.0 keywords, OAS 3.1/3.2 vocabularies, and per-resource mixed-dialect parity including Arazzo.                                                     |
| D6  | AJV-compatible draft-04 class                | Separate from the delivered native draft-04 dialect package; define class/options and executed-AJV fixtures.                                                              |
| D7  | OpenAPI number-scoped format table           | Confirm ownership and concrete consumer behavior before scheduling.                                                                                                       |

The Hyperjump compatibility shim is dropped, not merely deprioritized.

## Errors and compatibility processing

| ID  | Item                                              | Dependencies and completion signal                                                                                                                                 |
| --- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| R1  | Generic error transformation and grouping         | S2/E2/O2; normative relevance precedes generic grouping; separate evaluator, renderer, generic primitives, and presentation; demonstrate native and AJV consumers. |
| R2  | Structured error adoption in oaskit               | Depends on R1; remove `NOISE_KEYWORDS` and path inference while preserving targets, grouping, order, and ranges.                                                   |
| R3  | Engine-position adoption for oaskit/SARIF         | Keep evaluation locations distinct from source-text range correlation and preserve cloneable diagnostics.                                                          |
| A1  | Fix custom-keyword `compile` lifecycle            | Oracle call/throw timing and retained state; cache per registered schema occurrence.                                                                               |
| A2  | Dialect-aware discriminator discovery             | Stop treating data under `const`/`default`/`examples` as schemas; may share a primitive with A5.                                                                   |
| A3  | Discriminator external branch refs                | Depends on E1; eager local/external/unresolved oracle cases against the artifact registry.                                                                         |
| A4  | Discriminator compilation coverage                | Depends on D1; cache tag maps, lower routed and ordinary `oneOf`, and avoid decompiling unrelated schemas.                                                         |
| A5  | Dialect-aware `ajv-errors` discovery              | Same mechanism defect as A2, with separate behavior and tests.                                                                                                     |
| A6  | Discover `ajv-errors` across referenced resources | Depends on E1; search the artifact snapshot, not later registrations.                                                                                              |

Random AJV differential fuzzing and `ajv-i18n` were historically mentioned but
have no current completion contract. They remain candidates pending an oracle
strategy or renewed demand.

## Transformation and default filling

| ID  | Item                                     | Dependencies and completion signal                                                                                                                                                                |
| --- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T1  | Generic exact-annotation post-processing | S1/S2/E2/O3; define addressing, multiplicity, relevance, order, composition, failure, and parity.                                                                                                 |
| T2  | Schema-driven input transformation       | O3; compare exact annotation instructions, separate computed proposals, trace reasoning, and re-evaluation; include the transform gist and `contentSchema`.                                       |
| T3  | Runtime-option policy mechanism          | O3, explicitly separate from T2; study shared infrastructure for `coerceTypes`, `removeAdditional`, etc. without representing them as annotation keywords.                                        |
| T4  | OAS annotation adoption                  | Depends on D5; surface `readOnly`, `writeOnly`, and `deprecated`. Compiled collection is delivered.                                                                                               |
| T5  | Mutation fuzz-corpus integration         | Share plumbing with Q2 while retaining a distinct acceptance leg.                                                                                                                                 |
| F1  | Default-filling facility                 | S1/S2/O4/E2; exact `default` annotations cover existing relevant locations; define separate absent-target traversal, order, passes, creation, conflict, failure, dialect, and compiled semantics. |

Oaskit Overlay is evidence for an explicit pre-pipeline transformation, not
evidence that JSONPath overlays and schema-driven transformations share semantics.

## Documentation, testing, and infrastructure

| ID  | Item                                                  | Completion signal                                                                                                                                                  |
| --- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Q1  | Split `DESIGN.md` into architecture, ADR, and history | Preserve traceability while making current contracts discoverable.                                                                                                 |
| Q2  | Expand fuzz corpora                                   | Add legacy-dialect and format-bearing seeds with reproducible distinct legs.                                                                                       |
| Q3  | pnpm/tooling convergence                              | Reconcile oaskit's pre-release plan with JSE's earlier public release; preserve every JSE gate and the tarball boundary until a stable semver package replaces it. |
| Q4  | IDNA second-`--` owner review                         | Confirm the RFC basis and update the explanatory comment.                                                                                                          |

## Public release

| ID  | Item                                      | Dependencies and completion signal                                                                                                                                              |
| --- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1  | Define the first public package/API slice | After S1-S4 and E2. Decide whether `ajv-compat` is fixed and included or omitted; identify which output targets and processors are stable enough to promise.                    |
| P2  | IETF draft-03 viability evidence          | Publish conformance fixtures, architecture explanation, tier parity, resource/security posture, and reproducible benchmark context.                                             |
| P3  | Release-readiness gates                   | Types, lint, formatting, tests, API docs, CSP, package-consumer checks, fuzz/differential coverage, migration notes, and documented limitations all pass for the shipped slice. |
| P4  | Publication mechanics and outreach        | Naming, versions, package metadata, `private` latch, registry publication, Bowtie/reporting, and announcements remain owner-controlled actions after P1-P3.                     |

## Duplicate normalization

- A2/A5 share raw JSON recursion but retain separate acceptance tests.
- A6 consumes E1's snapshot rule; it does not define another one.
- S1 separates two meanings currently carried by `Production`; S2 supplies the
  lifecycle both meanings need without recombining them.
- S5 is a renderer/compatibility consumer of S1/S2, not an alternate keyword-
  dependency implementation.
- E4/E6 overlap at compiled/interpreted boundaries and share measurement work.
- Q2/T5 share corpus plumbing but remain distinct test legs.
- Structured params and removal of `NOISE_KEYWORDS` are one item, R2.
- OAS vocabularies, collection, and display are the D5 → T4 chain; compiled
  annotation support itself is complete.

## Delivered items removed from the backlog

The mechanics of compiled annotation collection and compiled `unevaluated*`
tracking are complete, but their shared production representation now requires
S1/S2 reconciliation. Runtime format-table lowering, draft-04 lowering, Bowtie
harness support, `explainCompilation`, lifecycle coverage thresholds, mutation
non-convergence, and stabilization of `TraceUnit`/`trace`/`walkSchema` remain
complete.

## Documented divergences, not planned corrections

`COMPAT.md` records `strictNumbers`, combiner-heavy error ordering, coercion and
`transform` interleaving/fixpoint differences, `prohibited` companion errors,
and the plain-data compiled contract. These are boundaries, not roadmap promises.
