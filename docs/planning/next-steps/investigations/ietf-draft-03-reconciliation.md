# Investigation: IETF draft-03 semantic reconciliation

**Requirement:** the IETF draft-03 model is the must-deliver behavior for the
current dialect. Historical computed annotations are optional output
compatibility and must not alter evaluation.

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

## Current JSE fit and gaps

The existing production/channel architecture already has useful ingredients:

- `StaticFacts.produces` and `consumes` describe communication topology;
- static name/index coverage supports compile-time dependency resolution;
- runtime tracked coverage handles dynamic `unevaluated*` dependencies;
- schema-application frames prevent failed subscopes from exporting data;
- the trace retains otherwise dropped data for diagnostic output;
- retention-driven elision recognizes that internal consumer demand overrides
  annotation-output demand;
- unrecognized keywords are already treated as exact-value annotations by
  default.

The current model nevertheless conflates distinct semantics:

- `Production` and `ctx.produce()` represent both exact-value annotations and
  computed evaluated-location information;
- all surviving productions can be rendered as annotations;
- `properties`, `patternProperties`, `additionalProperties`, `prefixItems`,
  `items`, `contains`, and `unevaluated*` produce computed values;
- frames exist at schema-application boundaries, not necessarily at every
  keyword evaluation needed to determine relevance;
- raw errors can survive from rejecting sub-evaluations of an accepting
  applicator even though those errors are irrelevant in non-verbose output.

The reconciliation must determine whether relevance is recorded explicitly or
derived from a richer evaluation graph. It must not assume that current schema
frames or the public trace carry enough information.

IETF draft-03 also recommends treating recognized-but-unsupported keywords as
exact-value annotations. The investigation must define how that case differs
from an unrecognized keyword and from a keyword in a required but unsupported
vocabulary.

## Historical computed-annotation compatibility

Draft 2020-12 and 2019-09 exposed computed applicator annotations. Supporting
those values is optional and must be evaluated against its complexity.

A plausible clean boundary is an output-only compatibility adapter that
synthesizes historical annotations from dependency/evaluation facts, the
schema, input, and trace as necessary. Requirements if this is pursued:

- IETF draft-03 exact-value annotations remain the default and canonical
  evaluator result;
- synthetic annotations never enter or influence dependency processing;
- output structure selection and historical annotation semantics are
  independent configuration dimensions;
- configuration cannot rely on dialect meta-schema identity because IETF
  draft-03 has no new meta-schema;
- the adapter specifies whether and how it reproduces historical dropped
  annotations from failed or irrelevant evaluations;
- interpreter, compiler, and standalone behavior agree;
- users pay retention/trace cost only when requesting compatibility.

Do not add historical computed annotations to the evaluator's canonical
annotation stream merely because an output proposal's examples contain them.
Drop the compatibility feature if it requires duplicating dependency semantics
or contaminating the IETF draft-03 path.

## TypeScript implications

The public and internal types should make accidental conflation difficult. The
investigation should compare separate stores/APIs with a discriminated record
union, but must ensure that:

- dependency records cannot be passed to an annotation renderer by structural
  coincidence;
- exact-value annotation typing remains extensible for custom vocabularies;
- relevance metadata is available where a renderer or processor needs it;
- internal compiler representations need not become the public JSON shape;
- all escaped data remains plain and cloneable.

## Conformance matrix to add

- A directly failing `properties` next to `unevaluatedProperties`.
- Failed and successful contributors under `allOf`, `anyOf`, `oneOf`, `not`,
  references, and conditionals.
- `contains` with relevant and irrelevant matching/non-matching items.
- Nested `unevaluated*` producers and consumers across references.
- Relevant exact-value annotations and irrelevant annotations/errors in each
  selected output format.
- Unrecognized and recognized-but-unsupported keyword handling, including
  required-vocabulary failure.
- Short-circuit decisions with annotations off/on, dependency consumers
  absent/present, and verbose output off/on. Verbose demand itself prevents
  short-circuiting unless the skipped evaluation can be represented faithfully.
- Optional historical output with evaluation results unchanged.

## Exit criteria

- Every built-in production and unsupported-keyword path is classified as
  annotation, dependency information, error, or no output.
- Keyword- and schema-level relevance transitions have an executable model.
- Non-verbose and verbose output requirements are testable.
- Static and runtime dependency paths are separately specified.
- Interpreter and minimal compiler parity are demonstrated before deep
  optimization.
- Historical computed annotations have either a bounded output-only design or
  an explicit decision not to support them.
