# Custom keywords and vocabularies

A vocabulary is a named map of keyword behaviors; a dialect is an ordered
set of vocabularies. Built-in drafts use exactly this mechanism —
`registerVocabulary` and `registerDialect` are the same API a custom
extension uses.

## An assertion keyword

A keyword behavior's `evaluate` receives the keyword's value, the current
cursor, and a context for applying subschemas, emitting productions, and
reporting failures. This one asserts the instance is a multiple of a
fixed value.

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

## Producers, consumers, and the `consumes` contract

A keyword emits a production with `ctx.produce`; another keyword reads
productions with `ctx.visible`. A consumer must declare every behavior id
it reads in its `analyze().consumes` — this lets the engine elide
productions that nothing declared an interest in. Reading through
`ctx.visible` without declaring it throws `UndeclaredConsumptionError`.

```ts
import assert from "node:assert";
import { createEngine, KeywordBehavior } from "@jse/core";

const VOCAB = "https://example.com/vocab/seen";
const DIALECT = "https://example.com/dialect/seen";

// Producer: records that it ran, with no assertion of its own.
const mark: KeywordBehavior = {
  id: `${VOCAB}#mark`,
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
      ctx.error("expected a sibling 'mark' production");
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

Omitting the declaration is a bug the engine catches rather than a silent
empty read.

```ts
import assert from "node:assert";
import {
  createEngine,
  KeywordBehavior,
  UndeclaredConsumptionError,
} from "@jse/core";

const VOCAB = "https://example.com/vocab/undeclared";
const DIALECT = "https://example.com/dialect/undeclared";

const mark: KeywordBehavior = {
  id: `${VOCAB}#mark`,
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

const engine = createEngine();
engine.registerVocabulary(VOCAB, { mark, sneaky });
engine.registerDialect(DIALECT, [
  "https://json-schema.org/draft/2020-12/vocab/core",
  VOCAB,
]);

const uri = engine.registerSchema(
  { mark: "tag", sneaky: true },
  "https://example.com/undeclared-schema",
  DIALECT,
);
assert.throws(() => engine.evaluate(uri, 1), UndeclaredConsumptionError);
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
