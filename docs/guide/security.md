# Security and resource limits

Schemas and instances are often untrusted input. Validation is safe against
prototype pollution — reserved names like `__proto__` and `constructor` are
treated as ordinary properties and never reach the prototype chain. Three
other concerns need a choice from the caller: regular-expression cost,
array-comparison cost, and recursion depth. Each has a bound or an opt-out
below.

The engine generates no code, so code-injection concerns that apply to
compiling validators do not apply here. A denial-of-service bound is best
effort, not a guarantee: treat wildly untrusted schemas with the same care as
any other untrusted program input.

## Regular expressions (ReDoS)

`pattern` and `patternProperties` compile untrusted regular expressions and
run them against untrusted strings. The native `RegExp` engine can backtrack
catastrophically — a pattern like `(a+)+$` takes exponential time on a
non-matching input. There are two defenses; they compose.

Reject exponential-looking patterns at registration with `rejectUnsafeRegex`.
The screen is a conservative star-height heuristic: it flags nested unbounded
quantifiers and accepts ordinary patterns.

```ts
import assert from "node:assert";
import { createEngine, UnsafeRegexError } from "@jse/core";

const engine = createEngine({ rejectUnsafeRegex: true });

assert.throws(
  () => engine.registerSchema({ pattern: "(a+)+$" }, "https://ex/redos"),
  UnsafeRegexError,
);

// Ordinary patterns register and evaluate normally.
const uri = engine.registerSchema(
  { pattern: "^[a-z]{2,10}$" },
  "https://ex/safe",
);
assert.equal(engine.evaluate(uri, "hello").valid, true);
```

For a hard guarantee, supply a linear-time engine through `regexEngine`. Any
object with a `compile(pattern)` method returning something `.test`-able
works; a production deployment would wrap [`re2`](https://github.com/uhop/node-re2).
The engine compiles each pattern once and caches it.

```ts
import assert from "node:assert";
import { createEngine, type RegexEngine } from "@jse/core";

// Shape only — a real deployment returns an RE2 instance from compile().
const re2Like: RegexEngine = { compile: (pattern) => new RegExp(pattern) };
const engine = createEngine({ regexEngine: re2Like });
const uri = engine.registerSchema({ pattern: "^\\d+$" }, "https://ex/re");
assert.equal(engine.evaluate(uri, "123").valid, true);
```

The detector is also exported directly, for a build-time lint over a schema
corpus:

```ts
import assert from "node:assert";
import { detectUnsafeRegex } from "@jse/core";

assert.equal(detectUnsafeRegex("(a+)+$").safe, false);
assert.equal(detectUnsafeRegex("^[a-z]+$").safe, true);
```

## Recursion depth

A self-referencing schema over deeply nested data, or a deeply nested schema
document, would otherwise overflow the call stack with an uncatchable-by-type
`RangeError`. Registration and evaluation are bounded by `maxDepth`, and
exceeding it throws `MaxDepthExceededError`. The engine stays usable
afterward — each evaluation runs in fresh state.

```ts
import assert from "node:assert";
import { createEngine, MaxDepthExceededError } from "@jse/core";

const engine = createEngine({ maxDepth: 16 });
const uri = engine.registerSchema(
  { items: { $ref: "#" } },
  "https://ex/recursive",
);

let nested: unknown[] = [];
for (let i = 0; i < 40; i++) nested = [nested];

assert.throws(
  () => engine.evaluate(uri, nested as never),
  MaxDepthExceededError,
);
// A shallow instance still validates.
assert.equal(engine.evaluate(uri, [[]]).valid, true);
```

The default bound sits below the runtime's native stack ceiling so the typed
error fires first. Raise `maxDepth` for legitimately deep documents, within
what the stack allows; if it is set too high, a native overflow is still
converted to `MaxDepthExceededError` rather than leaking.

## Array uniqueness

`uniqueItems` compares array elements in near-linear time by bucketing on a
canonical key and confirming collisions with full JSON equality. Large
arrays of distinct values do not incur quadratic cost, and genuine
duplicates — including objects that differ only in member order — are still
reported.
