# Investigation: IETF draft-03 semantic reconciliation

**Requirement:** the IETF draft-03 model is the must-deliver behavior for the
current dialect. Historical computed annotations are not produced
([ADR 0002](../decisions/0002-drop-historical-computed-annotations.md)).

## Evidence baseline

- [IETF draft-03](https://www.ietf.org/archive/id/draft-ietf-jsonschema-json-schema-03.html),
  especially [keyword output relevance](https://www.ietf.org/archive/id/draft-ietf-jsonschema-json-schema-03.html#section-12.2),
  [keyword interactions](https://www.ietf.org/archive/id/draft-ietf-jsonschema-json-schema-03.html#section-12.3),
  [annotations](https://www.ietf.org/archive/id/draft-ietf-jsonschema-json-schema-03.html#section-12.9),
  and [Appendix D](https://www.ietf.org/archive/id/draft-ietf-jsonschema-json-schema-03.html#appendix-D).
- The current JSE `main` behavior and tests as of `044b3c5a`.

"IETF draft-03" is used throughout to avoid confusion with the very old JSON
Schema draft-03, which JSE does not support.

## Required semantic separation

| Kind               | Value                                                                 | Consumer                                  | Output behavior                                                                               |
| ------------------ | --------------------------------------------------------------------- | ----------------------------------------- | --------------------------------------------------------------------------------------------- |
| Annotation         | Exactly the annotation keyword's value                                | Applications above evaluation             | Included only when configured and relevant, except formats that expose irrelevant evaluations |
| Error              | Implementation-defined message plus structured failure data           | Output and error processors               | Included only when configured and relevant, except formats that expose irrelevant evaluations |
| Static dependency  | Adjacent keyword value or fact derived from it                        | Another keyword in the same dynamic scope | Not annotation output; normally resolved at load/plan time                                    |
| Runtime dependency | Information from a keyword evaluation or relevant successful subscope | A depending keyword                       | Not annotation output; usable only while its producer is relevant                             |

Examples of static dependencies include `additionalProperties` reading the
names and patterns in adjacent keywords, `items` reading the length of
`prefixItems`, and `contains` reading `minContains` and `maxContains`. Runtime
dependencies include evaluated names/indexes for `unevaluated*` and the `if`
outcome used by `then` or `else`.

The separation is realized as two record kinds with distinct types and
distinct `KeywordContext` entry points. A dependency record cannot be passed
where an annotation record is expected.

## Relevance model

Every keyword evaluation begins relevant. Relevance can only transition to
irrelevance:

- a rejecting schema object makes its accepting keyword sub-evaluations
  irrelevant;
- an accepting keyword makes its rejecting sub-evaluations irrelevant;
- an accepting schema object does not change relevance;
- a rejecting keyword has no immediate transition of its own, but causes its
  parent schema object to reject;
- an irrelevant evaluation never becomes relevant again.

Dependency information is usable only from producers relevant at the time of
consumption. Non-verbose outputs omit irrelevant errors and annotations;
verbose formats may expose them. This is evaluation semantics plus output
policy, not merely renderer pruning.

IETF draft-03 also permits annotations to be presented as a stream of events.
Because a keyword evaluation begins relevant and can become irrelevant only
after an ancestor result is known, emission does not necessarily finalize a
unit's relevance. A future stream must therefore either buffer until relevance
is final or expose stable evaluation/unit identity plus monotonic relevance-
transition events. Rejection of the input voids annotations already emitted
from that input. The consumer, rather than a finalized-document renderer, may
need to apply these transitions.

## Current JSE fit and gaps

The existing production/channel architecture already has useful ingredients:

- `StaticFacts.produces` and `consumes` describe communication topology;
- static name/index coverage supports compile-time dependency resolution;
- runtime tracked coverage handles dynamic `unevaluated*` dependencies;
- schema-application frames prevent failed subscopes from exporting data;
- the trace retains otherwise dropped data for diagnostic output;
- annotation elision and dependency elision are separate decisions, and
  retention never touches dependency data;
- unrecognized keywords are already treated as exact-value annotations by
  default;
- the two record kinds are separate stores in both tiers (S1):
  `AnnotationRecord` is written by `ctx.annotate()` with the keyword's own
  value, `DependencyRecord` by `ctx.produce()` and read through
  `ctx.visible()`; renderers accept annotation records only; a producer that
  does not declare `produces` throws `UndeclaredProductionError`.

Remaining gaps:

- frames exist at schema-application boundaries, not necessarily at every
  keyword evaluation needed to determine relevance;
- errors are one flat array that is never rolled back
  (`packages/core/src/engine.ts`), so errors from rejecting sub-evaluations of
  an accepting applicator reach `list` and `hierarchical` output. Probe
  (2026-09-05): with `anyOf: [{"type":"string"}, {"type":"number","title":"num"}]`
  and input `5`, the `/anyOf/0` error unit is rendered in a valid result. The
  `locations: "2020-12"` path omits it only because it renders errors solely
  when the run is invalid;
- annotations from accepting sub-evaluations under a rejecting schema object
  reach `list` output: `packages/core/test/goldens/list.json` keeps the
  `/properties/item` `title` annotation under an invalid root, which §13.4
  excludes from relevant-level output.

The reconciliation must determine whether relevance is recorded explicitly or
derived from a richer evaluation graph. It must not assume that current schema
frames or the public trace carry enough information. Candidates for the
Phase 1 spike:

- a relevance flag on each record, set by the owning keyword or schema
  evaluation on transition, with irrelevant records dropped unless verbose
  demand is present;
- record buffers scoped per keyword evaluation, discarded or marked on
  transition, with the trace as the verbose-level source.

IETF draft-03 also recommends treating recognized-but-unsupported keywords as
exact-value annotations. The investigation must define how that case differs
from an unrecognized keyword and from a keyword in a required but unsupported
vocabulary.

## Historical computed annotations

Not produced
([ADR 0002](../decisions/0002-drop-historical-computed-annotations.md)).
Applicator keywords produce dependency information only. The machines-oriented
proposal's examples that show computed annotations are structural evidence
only.

## Compiler impact estimate

Inputs for the relevance step (S2/S3) in the compiled tier, from the
2026-09-05 census after the record split:

- Compiled list-mode errors are one flat `errs` array that is deliberately
  never a span (`packages/compiler/src/serialize.ts`, `channelSpans` and
  `pushError`); spans with mark/truncate exist only for the annotation list
  and the coverage channel (`branchSpan`). The reverse irrelevance case
  (annotations under a rejecting schema object) is therefore already handled
  for compiled annotations; error relevance needs error spans at every
  `pushError` site plus branch bookkeeping.
- Rules to reproduce in compiled list mode: an accepting `anyOf`/`oneOf`
  drops the errors of its rejecting branches; `if`'s subschema errors are
  always irrelevant (the keyword accepts); an accepting `contains` drops
  non-matching items' errors while a rejecting one keeps them; `not` never
  surfaces sub-errors.
- Order must match the interpreter byte-for-byte (`differential.ts` compares
  whole results), so the interpreter defines it: remove irrelevant units,
  keep encounter order. Splicing a branch's span out of `errs` reproduces
  that.
- Unaffected: plan-census pins, the produce oracle, standalone emission
  (flag-only), Bowtie (validity only).
- Consequences to plan for: `Result.trace`'s positional `errorIndexes`
  correlation (`renderTrace`) must be recomputed when `Result.errors` omits
  units; ajv-compat's `makeSurvives` filter (`packages/ajv-compat/src/errors.ts`)
  becomes partly redundant, and its oracle fixture `anyOf-pass-sibling-fail`
  proves the current leak.
- Estimate: interpreter error scoping is the semantic work; the compiler side
  is span plumbing at the `pushError` sites in the largest file in the repo,
  gated by `list-output.test.ts` and the FUZZ_LIST leg.

## TypeScript implications

Separate stores were chosen for the record split (S1): renderers accept
`AnnotationRecord[]` only, so a dependency record cannot reach one by
structural coincidence. The relevance work must also ensure that:

- exact-value annotation typing remains extensible for custom vocabularies;
- relevance metadata is available where a renderer or processor needs it;
- streamed records and relevance transitions cannot be mismatched by
  structurally interchangeable identifiers;
- internal compiler representations need not become the public JSON shape;
- all escaped data remains plain and cloneable.

## Conformance matrix to add

- A directly failing `properties` next to `unevaluatedProperties`.
- Failed and successful contributors under `allOf`, `anyOf`, `oneOf`, `not`,
  references, and conditionals.
- `contains` with relevant and irrelevant matching/non-matching items.
- Nested `unevaluated*` producers and consumers across references.
- An accepting sub-evaluation under a rejecting schema object: absent from
  relevant-level output, present and marked at the verbose level.
- Relevant exact-value annotations and irrelevant annotations/errors in each
  format at each supported level.
- Unrecognized and recognized-but-unsupported keyword handling, including
  required-vocabulary failure.
- Short-circuit decisions with annotations off/on, dependency consumers
  absent/present, and verbose demand off/on. Short-circuiting is permitted
  only when all three are absent (§12).
- Streamed provisional units followed by ancestor-driven irrelevance,
  including final reduction to the same result as document output.

## Exit criteria

- Every built-in production and unsupported-keyword path is classified as
  annotation, dependency information, error, or no output.
- Keyword- and schema-level relevance transitions have an executable model.
- Non-verbose and verbose output requirements are testable.
- The relevance model can support a later streaming protocol without requiring
  evaluator semantics to be replaced.
- Static and runtime dependency paths are separately specified.
- Interpreter semantics are fixed first; compiler parity follows in Phase 3
  of the [roadmap](../roadmap.md), before any optimization.
