# Custom keywords and vocabularies

A vocabulary is a named map of keyword behaviors; a dialect is an ordered
set of vocabularies. Built-in drafts use exactly this mechanism —
`registerVocabulary` and `registerDialect` are the same API a custom
extension uses.

## An assertion keyword

A keyword behavior's `evaluate` receives the keyword's value, the current
cursor, and a context for applying subschemas, recording annotations,
communicating dependency data, and reporting failures. This one asserts the
instance is a multiple of a fixed value.

```ts
import assert from "node:assert";
import { createEngine, KeywordBehavior } from "@jse/core";

const VOCAB = "https://example.com/vocab/even";
const DIALECT = "https://example.com/dialect/even";

const evenMultipleOf: KeywordBehavior = {
  id: `${VOCAB}#evenMultipleOf`,
  evaluate: (value, cursor, ctx) => {
    if (typeof cursor.value !== "number") return true;
    if (cursor.value % (value as number) !== 0) {
      ctx.error(`must be a multiple of ${value}`);
      return false;
    }
    return true;
  },
};

const engine = createEngine();
engine.registerVocabulary(VOCAB, { evenMultipleOf });
engine.registerDialect(DIALECT, [
  "https://json-schema.org/draft/2020-12/vocab/core",
  VOCAB,
]);

const uri = engine.registerSchema(
  { evenMultipleOf: 4 },
  "https://example.com/schema",
  DIALECT,
);
assert.equal(engine.evaluate(uri, 8).valid, true);
assert.equal(engine.evaluate(uri, 6).valid, false);
```

## An annotation keyword

`ctx.annotate()` records the keyword's value as an annotation at the current
instance location. An annotation's value is always the keyword's own value,
so there is nothing to pass.

```ts
import assert from "node:assert";
import { createEngine, KeywordBehavior } from "@jse/core";

const VOCAB = "https://example.com/vocab/hint";
const DIALECT = "https://example.com/dialect/hint";

const hint: KeywordBehavior = {
  id: `${VOCAB}#hint`,
  evaluate: (_value, _cursor, ctx) => {
    ctx.annotate();
    return true;
  },
};

const engine = createEngine();
engine.registerVocabulary(VOCAB, { hint });
engine.registerDialect(DIALECT, [
  "https://json-schema.org/draft/2020-12/vocab/core",
  VOCAB,
]);

const uri = engine.registerSchema(
  { hint: { render: "textarea" } },
  "https://example.com/hint-schema",
  DIALECT,
);
const result = engine.evaluate(uri, "x", { collectAnnotations: true });
assert.equal(result.annotations?.[0]?.keyword, "hint");
assert.deepEqual(result.annotations?.[0]?.annotation, { render: "textarea" });
```

## Dependency data: producers and consumers

A keyword communicates computed data to other keywords with `ctx.produce`;
another keyword reads it with `ctx.visible`. Dependency data never appears in
output, and a keyword produces it only when it accepts. A producer declares
its own id in `analyze().produces` and a consumer declares every id it reads
in `analyze().consumes` — the declarations let the engine elide data nothing
reads. Producing without the declaration throws
`UndeclaredProductionError`; reading without it throws
`UndeclaredConsumptionError`. The built-in exemplar is `if`, which produces
its subschema's outcome, and `then`/`else`, which read it with
`ctx.visible(ids, "adjacent")` — a same-schema-object dependency, unlike
`unevaluatedProperties`, which also sees data merged from successful
in-place sub-applications.

A keyword that reports an error through `ctx.error` must reject: the engine
drops the errors of an accepting keyword's sub-evaluations (draft-03 §12.2)
and throws `KeywordContractError` if the keyword itself reported one and
then returned `true`.

```ts
import assert from "node:assert";
import { createEngine, KeywordBehavior } from "@jse/core";

const VOCAB = "https://example.com/vocab/seen";
const DIALECT = "https://example.com/dialect/seen";

// Producer: records that it ran, with no assertion of its own.
const mark: KeywordBehavior = {
  id: `${VOCAB}#mark`,
  analyze: () => ({ produces: [`${VOCAB}#mark`] }),
  evaluate: (value, _cursor, ctx) => {
    ctx.produce(value);
    return true;
  },
};

// Consumer: declares `mark` in `consumes`, then reads it via `visible`.
const requireMark: KeywordBehavior = {
  id: `${VOCAB}#requireMark`,
  analyze: () => ({ consumes: [`${VOCAB}#mark`] }),
  evaluate: (value, _cursor, ctx) => {
    const seen = ctx.visible([`${VOCAB}#mark`]);
    if (value === true && seen.length === 0) {
      ctx.error("expected a sibling 'mark'");
      return false;
    }
    return true;
  },
};

const engine = createEngine();
engine.registerVocabulary(VOCAB, { mark, requireMark });
engine.registerDialect(DIALECT, [
  "https://json-schema.org/draft/2020-12/vocab/core",
  VOCAB,
]);

const uri = engine.registerSchema(
  { mark: "tag", requireMark: true },
  "https://example.com/seen-schema",
  DIALECT,
);
assert.equal(engine.evaluate(uri, 1).valid, true);
```

Omitting a declaration is a bug the engine catches rather than a silent
empty read or an invisible write.

```ts
import assert from "node:assert";
import {
  createEngine,
  KeywordBehavior,
  UndeclaredConsumptionError,
  UndeclaredProductionError,
} from "@jse/core";

const VOCAB = "https://example.com/vocab/undeclared";
const DIALECT = "https://example.com/dialect/undeclared";

const mark: KeywordBehavior = {
  id: `${VOCAB}#mark`,
  analyze: () => ({ produces: [`${VOCAB}#mark`] }),
  evaluate: (value, _cursor, ctx) => {
    ctx.produce(value);
    return true;
  },
};

// Missing `analyze().consumes` for the id it reads.
const sneaky: KeywordBehavior = {
  id: `${VOCAB}#sneaky`,
  evaluate: (_value, _cursor, ctx) => {
    ctx.visible([`${VOCAB}#mark`]);
    return true;
  },
};

// Missing `analyze().produces` for the data it writes.
const unmarked: KeywordBehavior = {
  id: `${VOCAB}#unmarked`,
  evaluate: (value, _cursor, ctx) => {
    ctx.produce(value);
    return true;
  },
};

const engine = createEngine();
engine.registerVocabulary(VOCAB, { mark, sneaky, unmarked });
engine.registerDialect(DIALECT, [
  "https://json-schema.org/draft/2020-12/vocab/core",
  VOCAB,
]);

const reads = engine.registerSchema(
  { mark: "tag", sneaky: true },
  "https://example.com/undeclared-read",
  DIALECT,
);
assert.throws(() => engine.evaluate(reads, 1), UndeclaredConsumptionError);

const writes = engine.registerSchema(
  { unmarked: "tag" },
  "https://example.com/undeclared-write",
  DIALECT,
);
assert.throws(() => engine.evaluate(writes, 1), UndeclaredProductionError);
```

## Identifier syntax for custom dialects

`registerDialect`'s `identifiers` option supplies the `$id`/anchor
extraction rules for schema objects written in the dialect. `identifiers2019`
and `identifiersLegacy` are the pre-2020-12 strategies, exported for reuse
when a custom dialect's core vocabulary follows an older draft's syntax.

```ts
import assert from "node:assert";
import { createEngine, identifiersLegacy } from "@jse/core";

const DIALECT = "https://example.com/dialect/legacy-ids";

const engine = createEngine();
engine.registerDialect(
  DIALECT,
  [
    "https://json-schema.org/draft/2020-12/vocab/core",
    "https://json-schema.org/draft/2020-12/vocab/validation",
  ],
  { identifiers: identifiersLegacy },
);

const uri = engine.registerSchema(
  {
    $ref: "#/definitions/inner",
    // Under legacy identifier syntax, a sibling `$id` next to `$ref` does
    // not change the base — `$ref` prevents any identifier extraction here.
    $id: "https://example.com/ignored",
    definitions: { inner: { type: "integer" } },
  },
  "https://example.com/legacy-ids-schema",
  DIALECT,
);
assert.equal(engine.evaluate(uri, 1).valid, true);
assert.equal(engine.evaluate(uri, "x").valid, false);
```
