# Conformance and evidence

This page is the evidence behind one claim: that JSE implements the IETF
draft-03 evaluation and output model — exact-value annotations, dependency
information, and output relevance — rather than approximating it. Every claim
here points at code, a test, a committed fixture, or spec text. Where JSE
disagrees with the draft or falls short of it, [Divergences and
limits](#divergences-and-limits) says so.

"IETF draft-03" is
[`draft-ietf-jsonschema-json-schema-03`](https://www.ietf.org/archive/id/draft-ietf-jsonschema-json-schema-03.html),
not the 2010 JSON Schema draft-03. Output formats are under active discussion
in the IETF process and may change before the final RFC.

[STATUS.md](../STATUS.md) is authoritative for what is built today; this page
is the argument and the citations.

## What is being claimed

Four separable things, each with its own kind of evidence:

1. **Verdicts** match the official test suites, in every supported dialect and
   in both evaluation tiers.
2. **The output model** — which records exist, which are relevant, and which
   reach the caller — follows draft-03 §12 and §13.
3. **The compiled tier is semantically identical** to the interpreter, not
   merely also correct.
4. **The gates that check 1–3 are themselves tested**, because a gate that
   silently measures nothing looks exactly like a gate that passes.

## The evaluation model

JSE separates four kinds of information. The separation is typed, not a
convention: annotations and dependency data are distinct record types written
through distinct `KeywordContext` entry points, renderers accept annotation
records only, and a keyword that produces dependency data without declaring it
throws `UndeclaredProductionError`.

| Kind               | Value                                                       | Consumer                                  | Reaches output                       |
| ------------------ | ----------------------------------------------------------- | ----------------------------------------- | ------------------------------------ |
| Annotation         | Exactly the keyword's own value (§12.9)                     | Applications above evaluation             | When selected and relevant           |
| Error              | A message plus structured failure data                      | Output and error processors               | When configured and relevant         |
| Static dependency  | An adjacent keyword's value, or a fact derived from it      | Another keyword in the same dynamic scope | Never; resolved at load or plan time |
| Runtime dependency | Information from a keyword evaluation or accepting subscope | A depending keyword                       | Never                                |

Static dependencies include `additionalProperties` reading the names and
patterns beside it, `items` reading the length of `prefixItems`, and
`contains` reading `minContains`/`maxContains`. Runtime dependencies include
the evaluated names and indexes that `unevaluatedProperties`/`unevaluatedItems`
consume, and the `if` outcome that `then` or `else` reads as a same-scope
dependency ([§12.3](https://www.ietf.org/archive/id/draft-ietf-jsonschema-json-schema-03.html#section-12.3)).

### Relevance

[§12.2](https://www.ietf.org/archive/id/draft-ietf-jsonschema-json-schema-03.html#section-12.2)
relevance is a one-way transition. Every keyword evaluation begins relevant,
and:

- a rejecting schema object makes its accepting keyword sub-evaluations
  irrelevant;
- an accepting keyword makes its rejecting sub-evaluations irrelevant;
- an accepting schema object changes nothing;
- an irrelevant evaluation never becomes relevant again.

Dependency data is produced only by an accepting keyword
([Appendix D](https://www.ietf.org/archive/id/draft-ietf-jsonschema-json-schema-03.html#appendix-D)):
`contains` reports the positions it matched, and every other producer reports
nothing when it rejects.

No keyword carries relevance code of its own. One generic rule marks the error
list before a keyword runs and, when the keyword accepts, removes what its
rejecting sub-evaluations pushed. The other direction — an accepting
sub-evaluation under a rejecting schema object — is the frame discard that
already governs annotations and dependency data. The normative statement is
DESIGN.md's "Channel semantics (normative)" section, rules 3 and 6.

The distinction that matters to an implementer is that this is evaluation
semantics, not renderer pruning. The record is produced and then dropped, and
the verbose level can show what was dropped:

```ts
import assert from "node:assert";
import { createEngine } from "@json-schema-engine/core";

const engine = createEngine();
const uri = engine.registerSchema(
  {
    allOf: [{ anyOf: [{ type: "string" }, { type: "integer" }] }],
    maximum: 0,
  },
  "https://conformance.example/relevance",
);

// 5 is an integer, so the anyOf accepts; its failing branch's error is
// irrelevant and absent, even though the instance is invalid overall.
const relevant = engine.evaluate(uri, 5, { output: "list" });
assert.equal(relevant.valid, false);
assert.deepEqual(
  relevant.errors.map((e) => e.evaluationPath),
  ["/maximum"],
);

// The verbose level shows it was produced and dropped, not never evaluated.
const verbose = engine.evaluate(uri, 5, { output: "list", verbose: true });
const dropped = (verbose.droppedErrors ?? []).map((e) => e.evaluationPath);
assert.ok(dropped.includes("/allOf/0/anyOf/0/type"));
```

### Short-circuiting

[§12](https://www.ietf.org/archive/id/draft-ietf-jsonschema-json-schema-03.html#section-12)
permits short-circuiting only when no annotation could be produced, no
dependency communication could be affected, and no verbose output is
requested. The interpreter never short-circuits. The compiler short-circuits
`anyOf`/`oneOf` only in verdict-only regions, and list output runs every
branch. Asking for more output therefore never changes the answer.

### Annotation values

An annotation's value is exactly its keyword's own value. Applicator keywords
such as `properties` and `unevaluatedProperties` contribute dependency data
and no annotation at all — see
[Divergences and limits](#divergences-and-limits), since 2019-09 and 2020-12
readers may expect otherwise.

```ts
import assert from "node:assert";
import { createEngine } from "@json-schema-engine/core";

const engine = createEngine();
const uri = engine.registerSchema(
  {
    title: "Item",
    "x-vendor": { note: "kept verbatim" },
    properties: { id: { type: "integer" } },
    unevaluatedProperties: false,
  },
  "https://conformance.example/annotations",
);

const result = engine.evaluate(
  uri,
  { id: 1 },
  {
    output: "basic",
    annotations: true,
  },
);
assert.equal(result.valid, true);

const byKeyword = new Map(
  (result.annotations ?? []).map((a) => [a.keyword, a.annotation]),
);
// Exact keyword values, unknown keywords included.
assert.equal(byKeyword.get("title"), "Item");
assert.deepEqual(byKeyword.get("x-vendor"), { note: "kept verbatim" });
// Applicators produced no annotation — yet unevaluatedProperties accepted,
// so the dependency channel carried the evaluated names.
assert.equal(byKeyword.has("properties"), false);
assert.equal(byKeyword.has("unevaluatedProperties"), false);
```

Formats, levels, and the mapping between JSE's field names and each document
shape's are in the [output formats guide](guide/output-formats.md).

## Conformance fixtures

The official suites test verdicts. They do not test relevance or annotation
shape, so those are pinned by dedicated fixtures:

- **`packages/core/test/relevance.test.ts`** — a thirteen-case table of errors
  under an accepting keyword (`anyOf`, `oneOf`, `not`, `if`/`then`/`else`,
  `contains`, `$ref` into a rejecting branch, a `false` branch), each checked
  in five renderings; `if`/`then`/`else` as separate keyword evaluations;
  annotations under a rejecting ancestor; trace completeness; the Appendix D
  accepting-producer rule; and a four-fixture × ten-option-mode matrix
  asserting the verdict never varies with output configuration.
- **`packages/compiler/test/relevance-compiled.test.ts`** — thirteen cases
  through the compiled tier, matched unit for unit and in order: the same
  combinator shapes plus the Appendix D producer rules, including the
  `contains`/`unevaluatedItems` interaction and the table 5 row 4 case
  discussed under [Divergences and limits](#divergences-and-limits).
- **`packages/core/test/goldens/`** — one schema/instance pair rendered into
  seven format × level combinations, valid and invalid, committed as fourteen
  plain JSON files. These are the artifact another implementer can diff their
  own output against; `packages/core/test/goldens.test.ts` explains the
  relevance outcome they encode.
- **`packages/core/test/output-suite.test.ts`** — the official output tests.
  Each rendered Basic document is validated against that case's own output
  schema, using JSE itself: 8 of 8.

## Suite results and tier parity

Five dialects, both tiers, zero skips. Counts are pinned exactly, so a test
suite submodule bump is a deliberate edit rather than a silent drift:

| Dialect      | Cases | Interpreter | Compiled |
| ------------ | ----- | ----------- | -------- |
| draft2020-12 | 1299  | ✓           | ✓        |
| draft2019-09 | 1259  | ✓           | ✓        |
| draft-07     | 927   | ✓           | ✓        |
| draft-06     | 839   | ✓           | ✓        |
| draft-04     | 618   | ✓           | ✓        |

`scripts/bowtie-check.ts` reproduces the same five numbers through
[Bowtie](https://bowtie.report/)'s IO protocol with zero failures, errors, or
skips. The public bowtie.report listing is pending the owner's submission.

Parity between the tiers is checked at four increasing strengths:

- **Whole-suite structured sweeps.** `packages/compiler/test/evaluator-suite.test.ts`
  and `packages/compiler/test/list-annotations-suite.test.ts` pin instance
  totals _equal to_ the suite counts above, plus per-dialect trace-node,
  detail-unit, dropped-unit, and annotation-unit counts. Structured output is
  exercised on every suite case, not a sample.
- **Differential fuzzing.** `scripts/fuzz.ts` runs 200,000 cases per leg from a
  fixed seed, in four strictly nested comparison modes: verdict, then whole
  flat list including error-param field order, then every annotation unit, then
  the entire `Result` including the trace. The strongest mode compares both
  artifact levels at once, and is the only referee for the retained
  `droppedErrors`/`droppedAnnotations` channel. Every divergence reproduces
  deterministically and is reported as a minimized schema/instance pair.
- **Plan classification census.** Interpreted fallback is always _correct_, so
  a subschema that silently stops compiling passes every other gate.
  `packages/compiler/test/plan-census.test.ts` pins the split: draft-07,
  draft-06, and draft-04 compile with zero interpreted units, and draft2020-12
  flag mode has 59, every one of them caused by dynamic references.
- **Gate self-tests.** `packages/compiler/test/differential-planted.test.ts`
  plants divergences to prove each comparison detects what it claims — and
  records the blindness each one has, such as a corrupted error param slipping
  past a verdict-only comparison. `packages/test-kit/src/self-test.test.ts`
  proves the exact-count assertion detects under-running.

Tier parity is document-level identity, not verdict agreement:

```ts
import assert from "node:assert";
import { createEngine } from "@json-schema-engine/core";
import { compileEvaluator } from "@json-schema-engine/compiler";

const engine = createEngine();
const uri = engine.registerSchema(
  {
    allOf: [{ anyOf: [{ type: "string" }, { type: "integer" }] }],
    maximum: 0,
  },
  "https://conformance.example/parity",
);

const evaluator = compileEvaluator(engine, uri);
for (const output of ["list", "hierarchical", "detailed", "basic"] as const) {
  assert.deepStrictEqual(
    evaluator.evaluate(5, { output }),
    engine.evaluate(uri, 5, { output }),
  );
}
```

And the verdict does not depend on how much output is requested:

```ts
import assert from "node:assert";
import { createEngine, type EvaluateOptions } from "@json-schema-engine/core";

const engine = createEngine();
const uri = engine.registerSchema(
  { anyOf: [{ type: "string" }, { type: "integer" }], maximum: 0 },
  "https://conformance.example/invariant",
);

const modes: EvaluateOptions[] = [
  {},
  { output: "basic" },
  { output: "list" },
  { output: "list", verbose: true },
  { output: "hierarchical", trace: true },
  { output: "list", annotations: true },
];
const verdicts = new Set(modes.map((m) => engine.evaluate(uri, 5, m).valid));
assert.equal(verdicts.size, 1);
```

## Architecture

The two tiers deliver one semantics twice; they are not two implementations
kept roughly in sync.

The interpreter is the reference implementation of the channel rules above.
The compiler consumes only the facts a keyword reports from `analyze()` and
the IR it returns from `lower()` — never keyword names — so a keyword it
cannot lower becomes an interpreted island reached through a one-way
trampoline, and the artifact is exactly as correct as the interpreter. A
compiled evaluator records the same application tree the interpreter builds
and renders it through _core's_ renderers, so no format is implemented twice.
Short-circuiting happens only under the §12 conditions above.

[docs/architecture.md](architecture.md) covers the pipeline, the channel, and
islands in detail.

## Resource limits and security posture

Bounds are enforced identically in both tiers. `DEFAULT_MAX_DEPTH` is 512
(`packages/core/src/registry.ts`), bounding registration, schema walks, and
evaluation; when a configured bound exceeds the runtime's own stack ceiling,
the native overflow is converted rather than leaked.
`packages/compiler/test/depth-parity.test.ts` asserts the same
`MaxDepthExceededError` at the same `maxDepth` from the interpreter,
`compileValidator`, `compileList`, and `compileEvaluator` — including through
a dynamic island that trampolines back into the interpreter's counter.
Standalone modules, which cannot import that class, reach structural parity
instead — see [Divergences and limits](#divergences-and-limits).

```ts
import assert from "node:assert";
import { createEngine, MaxDepthExceededError } from "@json-schema-engine/core";
import { compileValidator } from "@json-schema-engine/compiler";

const engine = createEngine({ maxDepth: 16 });
const uri = engine.registerSchema(
  { type: "array", items: { $ref: "#" } },
  "https://conformance.example/depth",
);

let deep: unknown = 0;
for (let i = 0; i < 64; i++) deep = [deep];

const validate = compileValidator(engine, uri, { maxDepth: 16 }).validate;
assert.throws(() => engine.evaluate(uri, deep), MaxDepthExceededError);
assert.throws(() => validate(deep), MaxDepthExceededError);
```

`packages/core/test/security.test.ts` measures the hostile cases under time
budgets, so a regression fails loudly rather than merely running slowly: 100k
distinct items compared in under a second; 5000-deep instances and schemas
rejected; a hostile `__proto__` payload leaving `Object.prototype` intact;
165k annotation units and 160k dropped errors collected from single
evaluations.

Compiled artifacts are built with `new Function`, confined to four call sites
with a repo-wide lint ban elsewhere. `npm run csp:check` emits every
fully-static suite schema as a standalone module and runs 332 modules over
1164 verdicts under `node --disallow-code-generation-from-strings`, with the
interpreter as the oracle and a corpus of hostile schema-derived strings —
quote-escapes, template syntax, comment terminators, line separators.

[docs/guide/security.md](guide/security.md) is the operational guidance:
regex cost, recursion depth, and array-comparison cost for a caller handling
untrusted input.

## Benchmarks

One benchmark gates merges. Everything else is report-only.

`npm run bench` runs a verdict oracle across every subject first and exits
non-zero on disagreement, then times four flag-mode groups against AJV. The
gate is `ajv / ours <= 1.00` — compiled flag mode must never be slower.
Current ratios are 0.53–0.82. [SPIKE.md](../SPIKE.md) records the method and
its threats to validity.

`npm run bench:harness` is the reproducible report: five corpora, nothing
fetched at run time, a verdict oracle before any timing, and every compiled
row additionally oracled by document equality against the interpreter.
`bench/results/` is gitignored; CI uploads the results as an artifact and does
not gate on them, because shared-runner variance would make that a flaky gate
rather than a real one. [bench/corpora/README.md](../bench/corpora/README.md)
documents provenance and per-corpus methodology.

**Where AJV is faster.** List (all-errors) output is slower than AJV by
design: it never short-circuits and reproduces the interpreter's error units
exactly, in order, at roughly half AJV's `allErrors` throughput. That mode is
not gated. In the report-only harness AJV is also ahead on hot-path throughput
for `api-payload` (3.39M vs 5.30M ops/s) and `migration` (10.4M vs 14.2M), and
well ahead on `records-uniform` (27.0k vs 87.6k). JSE leads on
`records-sparse` (232 vs 44), on `oas-document` — where AJV is excluded from
the corpus because it returns the wrong verdict — and on every compile-time
row. These figures are machine-dependent and report-only; regenerate them
rather than citing them.

Some of that margin is bought with incorrectness. AJV short-circuits `anyOf`
when an adjacent `unevaluatedProperties` still needs the branch's evaluated
names, which is why it is faster on that shape and why it disagrees with the
suite there. [COMPILED-CONSUMERS.md](../COMPILED-CONSUMERS.md) §1.3 has the
measurement.

## Divergences and limits

**No computed applicator annotations.** In 2019-09 and 2020-12, `properties`
and friends were described as producing annotations of computed values —
the set of names they matched. JSE does not emit those: under §12.9 an
annotation's value is the keyword's own value, and Appendix D describes the
matched-name information as dependency data between keywords. Both forms of
information still exist and still drive `unevaluated*`; only the output
changes. Neither the official suite nor Bowtie checks annotation output, so
this is invisible to conformance testing — which is why it is stated here.
Reasoning in
[ADR 0002](planning/next-steps/decisions/0002-drop-historical-computed-annotations.md).

**Table 5 row 4 is read as an erratum.** The draft's example shows a rejecting
`prefixItems` reporting a validated prefix length of 1, which contradicts the
Appendix D table 7 rule that a rejecting producer reports nothing. JSE follows
the rule: in that example `unevaluatedItems` applies to both positions. The
case is pinned in both tiers, as `Appendix D table 5 row 4` in
`packages/core/test/relevance.test.ts` and
`packages/compiler/test/relevance-compiled.test.ts`. An implementer
diffing against the draft will reach a different answer there.

**§12.5 has no runtime category.** JSE has no "recognized but unsupported"
state. Every keyword of an assembled dialect is supported; a metaschema
requiring an unregistered vocabulary is refused at assembly with
`UnknownVocabularyError`; an optional vocabulary's keywords take the
unknown-keyword path and become exact-value annotations.

**The unsafe-regex screen is a heuristic.** `rejectUnsafeRegex` is a
conservative star-height analysis, not a proof. It does not detect overlapping
alternation such as `(a|a)*`. A linear-time engine injected through
`regexEngine` is the only hard guarantee. Built-in metaschemas are
deliberately not screened.

**`pattern` falls back to the non-unicode regex grammar.** JSON Schema
specifies ECMA-262 regular expressions with Unicode semantics; JSE compiles
`pattern` and `patternProperties` in unicode mode and, when the unicode
grammar rejects the pattern, retries under the non-unicode grammar with its
Annex B extensions (identity escapes such as `\a`). That leniency keeps
existing schemas working and is what the official `pattern` cases exercise;
`strictUnicodeRegex` makes it a registration error
([security guide](guide/security.md#unicode-mode-regular-expressions)). The
`regex` format has no such fallback: it accepts exactly the unicode grammar,
which is what `optional/format/ecmascript-regex.json` requires.

**The CSP check skips island-bearing schemas.** Only fully-static schemas emit
standalone modules; schemas needing the interpreter at runtime are counted and
skipped, because under CSP they run on the interpreter by design. The skip
count is reported on every run, so the check cannot quietly degrade to zero
coverage.

**Standalone modules reach only structural depth parity.** A standalone
module has no imports at all, so it cannot share core's
`MaxDepthExceededError` class object: the error it throws has the same
constructor name, message, and bound, but `instanceof` against core's class
is false by construction. That is a limit of self-contained emission, not a
defect, and `packages/compiler/test/depth-parity.test.ts` pins both halves —
what matches and what cannot.

**Output formats may change.** They are under active discussion in the IETF
process. JSE follows its two cited sources and names each format as its source
does.

**Streaming is not implemented.** Draft-03 permits annotations to be presented
as a stream of events. Because a unit's relevance is not final when it is
emitted, a stream must either buffer or expose stable identity plus monotonic
relevance transitions. The record/renderer boundary was designed not to
foreclose that; no streaming surface ships.

## Reproducing this page

```txt
npm ci
npm run verify        # types, lint, format, full suite, API docs, CSP check
npm run bowtie        # five dialects through the Bowtie IO protocol
npm run csp:check     # standalone modules with code generation disabled

npm run fuzz                              # verdict differential
FUZZ_LIST=1 npm run fuzz                  # flat list, error params included
FUZZ_ANNOTATIONS=1 npm run fuzz           # every annotation unit
FUZZ_EVALUATOR=1 npm run fuzz             # whole Result, both levels
FUZZ_CONSERVATIVE=1 npm run fuzz          # optimizations off
FUZZ_DIALECT=draft7 npm run fuzz          # also draft6, draft2019-09, draft4

npm run bench           # the enforced gate; exits non-zero on failure
npm run bench:harness   # report-only corpora
```

Benchmark numbers are machine-dependent. [CONTRIBUTING.md](../CONTRIBUTING.md)
covers the build and test workflow.

## Further reading

- [Output formats](guide/output-formats.md) — format names, levels, controls,
  and the field-name mapping.
- [Architecture](architecture.md) — pipeline, channel, islands.
- [Security and resource limits](guide/security.md) — operational guidance.
- [ADR 0002](planning/next-steps/decisions/0002-drop-historical-computed-annotations.md)
  — dropping historical computed annotations.
- [ADR 0003](planning/next-steps/decisions/0003-output-levels-and-orthogonal-controls.md)
  — output levels and orthogonal controls.
- [STATUS.md](../STATUS.md) — what is built, staged, and gated.
