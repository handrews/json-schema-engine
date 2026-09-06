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
consumption, and is produced only by an accepting keyword (Appendix D table
7): `contains` reports the positions it matched, every other producer
reports nothing when it rejects. Table 5 row 4 of the draft (a rejecting
`prefixItems` reporting validated prefix length 1) contradicts that rule and
is treated as a draft erratum: JSE applies `unevaluatedItems` to both
positions in that example. `if` produces its subschema's outcome and always
accepts; `then`/`else` consume it as a same-scope dependency (§12.3) and
report their own subschema's verdict. Non-verbose outputs omit irrelevant
errors and annotations; verbose formats may expose them. This is evaluation
semantics plus output policy, not merely renderer pruning.

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

Relevance (S2) is implemented as one generic rule in the engine: a keyword
evaluation marks the error list before it runs and, when it accepts, the
errors pushed meanwhile (its rejecting sub-evaluations') are removed — kept
aside only when tracing, for verbose output. No keyword needs relevance
code of its own because every keyword that reports an error rejects
(`KeywordContractError` enforces it). Frames already realize the
rejecting-schema rule for annotations and dependency data; a valid run's
root-frame annotations are the relevant ones, and an invalid run has none.
Errors at one trace node are uniformly relevant or irrelevant (relevance
depends only on the ancestor keyword chain, and every application has its
own path node), so verbose rendering can attach dropped errors per unit.
The trace also records each keyword's verdict in evaluation order, which is
what the draft-03 `detailed`/`verbose` documents render one node from. The
fixtures live in `packages/core/test/relevance.test.ts` and
`packages/compiler/test/relevance-compiled.test.ts`.

Recognized-but-unsupported keywords (§12.5) have no runtime category in
JSE: every keyword of an assembled dialect is supported, a required but
unregistered vocabulary is refused at assembly, and an optional one's
keywords take the unknown-keyword path (exact-value annotations).

## Historical computed annotations

Not produced
([ADR 0002](../decisions/0002-drop-historical-computed-annotations.md)).
Applicator keywords produce dependency information only. The machines-oriented
proposal's examples that show computed annotations are structural evidence
only.

## Compiled list-mode relevance

The compiled tier reproduces the interpreter's relevant error list
byte-for-byte (`differential.ts`, FUZZ_LIST): `anyOf`/`oneOf` runs, `not`,
`if`'s condition, and `contains`' probe loop take an `errs` mark before
their applies and truncate on the accept path (`errMark` in
`packages/compiler/src/serialize/`); `if`'s condition truncates
unconditionally. Channel producers in list mode gate their push on a
per-keyword verdict (`kwOk`), since the unit-level `ok` may already be false
from an earlier sibling. Coverage harvests and channel gates key on
`SchemaRegistry.coverageIds()` (consumed producers that declare evaluated
coverage) so `if`'s boolean outcome never reaches the shape-dispatching
folds. The compiled `if` lowering realizes the `then`/`else` dependency
structurally, so the produce-oracle gate skips `if`'s record.

Effects recorded elsewhere: the produce-recipes sweep counts three more
compared pairs (a rejecting `items` no longer hides positions from
`unevaluatedItems`); ajv-compat's error-parity golden set gains
`unevaluatedProperties.json#33` at two nesting levels and `COMPAT.md`
records the `contains: false` + `minContains: 0` quirk core no longer
exposes; ajv-compat's own `makeSurvives`/`needsTrace` re-filtering is now
partly redundant (backlog A7).

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
