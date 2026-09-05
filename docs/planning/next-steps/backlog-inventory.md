# Backlog inventory

**Baseline:** JSE `main` at `8f077531` and oaskit `main` at `6ab5faf7`,
2026-07-12. Publication-only work is excluded. Documented compatibility
divergences are not promoted into promised fixes.

## Evaluator, compiler, and output

| ID  | Item                                                                        | Dependencies and completion signal                                                                                                         |
| --- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| E1  | Freeze registry visibility across compiled code and interpreter trampolines | Compile an unresolved-ref island, register its target, prove the old artifact still throws while a new artifact sees it. Constrains A3/A6. |
| E2  | Reconsider native output formats and names                                  | O1; define guarantees, direct/derived forms, costs, migration, and parity before implementation.                                           |
| E3  | List-mode standalone emission                                               | Depends on E1/E2; prove parity for errors, annotations, retention, and closed-world behavior.                                              |
| E4  | Island re-entry                                                             | Depends on E1 and overlaps E6; require measured benefit.                                                                                   |
| E5  | Generated membership thresholds (D9d)                                       | Representative Set-versus-chain benchmarks plus differential/fuzz parity.                                                                  |
| E6  | Nested tracked consumers                                                    | Measure current islands, prototype nested scopes, preserve local visibility, failed discard, successful merge, and outer visibility.       |
| E7  | AJV `code.source` mapping                                                   | Compatibility feature depending on standalone decisions, not publication.                                                                  |
| E8  | Split serializer responsibilities                                           | Separate orchestration from emission, rendering, guard CSE, and inlining before E3/E6 complexity if warranted.                             |
| E9  | Warn when list-only options are ignored                                     | One typed validation mechanism for at least `errorParams` and `trace`.                                                                     |
| E10 | Compiler-tier user guide                                                    | User-facing guide listed as TBD in `docs/guide/index.md`; follows stable artifact/output APIs.                                             |

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

| ID  | Item                                              | Dependencies and completion signal                                                                                |
| --- | ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| R1  | Generic error transformation and grouping         | O2/E2; separate evaluator guarantees, generic primitives, and presentation; demonstrate native and AJV consumers. |
| R2  | Structured error adoption in oaskit               | Depends on R1; remove `NOISE_KEYWORDS` and path inference while preserving targets, grouping, order, and ranges.  |
| R3  | Engine-position adoption for oaskit/SARIF         | Keep evaluation locations distinct from source-text range correlation and preserve cloneable diagnostics.         |
| A1  | Fix custom-keyword `compile` lifecycle            | Oracle call/throw timing and retained state; cache per registered schema occurrence.                              |
| A2  | Dialect-aware discriminator discovery             | Stop treating data under `const`/`default`/`examples` as schemas; may share a primitive with A5.                  |
| A3  | Discriminator external branch refs                | Depends on E1; eager local/external/unresolved oracle cases against the artifact registry.                        |
| A4  | Discriminator compilation coverage                | Depends on D1; cache tag maps, lower routed and ordinary `oneOf`, and avoid decompiling unrelated schemas.        |
| A5  | Dialect-aware `ajv-errors` discovery              | Same mechanism defect as A2, with separate behavior and tests.                                                    |
| A6  | Discover `ajv-errors` across referenced resources | Depends on E1; search the artifact snapshot, not later registrations.                                             |

Random AJV differential fuzzing and `ajv-i18n` were historically mentioned but
have no current completion contract. They remain candidates pending an oracle
strategy or renewed demand.

## Transformation and default filling

| ID  | Item                                  | Dependencies and completion signal                                                                                                                         |
| --- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T1  | Generic annotation post-processing    | O3/E2; define addressing, multiplicity, order, composition, failure, and parity.                                                                           |
| T2  | Schema-driven instance transformation | O3; determine which extension-keyword operations can use annotations or transformation proposals; include `transform` and `contentSchema`.                 |
| T3  | Runtime-option policy mechanism       | O3, explicitly separate from T2; study shared infrastructure for `coerceTypes`, `removeAdditional`, etc. without representing them as annotation keywords. |
| T4  | OAS annotation adoption               | Depends on D5; surface `readOnly`, `writeOnly`, and `deprecated`. Compiled collection is delivered.                                                        |
| T5  | Mutation fuzz-corpus integration      | Share plumbing with Q2 while retaining a distinct acceptance leg.                                                                                          |
| F1  | Default-filling facility              | O4/E2; define absent-target traversal, order, passes, creation, conflict, failure, dialect, and compiled semantics.                                        |

Oaskit Overlay is evidence for an explicit pre-pipeline transformation, not
evidence that JSONPath overlays and schema-driven transformations share semantics.

## Documentation, testing, and infrastructure

| ID  | Item                                                  | Completion signal                                                            |
| --- | ----------------------------------------------------- | ---------------------------------------------------------------------------- |
| Q1  | Split `DESIGN.md` into architecture, ADR, and history | Preserve traceability while making current contracts discoverable.           |
| Q2  | Expand fuzz corpora                                   | Add legacy-dialect and format-bearing seeds with reproducible distinct legs. |
| Q3  | pnpm/tooling convergence                              | Follow oaskit's plan; preserve JSE gates and unpublished tarball boundary.   |
| Q4  | IDNA second-`--` owner review                         | Confirm the RFC basis and update the explanatory comment.                    |

## Duplicate normalization

- A2/A5 share raw JSON recursion but retain separate acceptance tests.
- A6 consumes E1's snapshot rule; it does not define another one.
- E4/E6 overlap at compiled/interpreted boundaries and share measurement work.
- Q2/T5 share corpus plumbing but remain distinct test legs.
- Structured params and removal of `NOISE_KEYWORDS` are one item, R2.
- OAS vocabularies, collection, and display are the D5 → T4 chain; compiled
  annotation support itself is complete.

## Delivered items removed from the backlog

Compiled annotation collection, compiled `unevaluated*` tracking, runtime
format-table lowering, draft-04 lowering, Bowtie harness support,
`explainCompilation`, lifecycle coverage thresholds, mutation non-convergence,
and stabilization of `TraceUnit`/`trace`/`walkSchema` are complete.

## Documented divergences, not planned corrections

`COMPAT.md` records `strictNumbers`, combiner-heavy error ordering, coercion and
`transform` interleaving/fixpoint differences, `prohibited` companion errors,
and the plain-data compiled contract. These are boundaries, not roadmap promises.
