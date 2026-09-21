# Security and resource limits

Schemas and instances are often untrusted input. Validation is safe against
prototype pollution — reserved names like `__proto__` and `constructor` are
treated as ordinary properties and never reach the prototype chain. Three
other concerns need a choice from the caller: regular-expression cost,
array-comparison cost, and recursion depth. Each has a bound or an opt-out
below.

The `@json-schema-engine/core` interpreter generates no code, so code-injection concerns
that apply to compiling validators do not apply to it. A denial-of-service
bound is best effort, not a guarantee: treat wildly untrusted schemas with
the same care as any other untrusted program input.

## The compiler tier and code generation

`@json-schema-engine/compiler` DOES generate code: `compileValidator`, `compileList`, and
`compileEvaluator` build artifact source and instantiate it with
`new Function` (the only such call sites, fenced by lint rules). Two
properties bound the risk:

- All emitted text is assembled through a gated formatter whose typed
  wrappers escape every schema-derived value; there is no raw-code path in
  the lowering IR, so schema content cannot reach the artifact as code. An
  injection corpus exercises hostile schema values against both optimizer
  configurations.
- Under a Content-Security-Policy that forbids runtime code generation,
  use the interpreter (identical semantics — the compiler trampolines to
  it for anything it cannot compile) or build-time standalone emission,
  which is verified by a gate that runs every emitted module under
  `node --disallow-code-generation-from-strings`.

Do not compile schemas you would not run as code review-free: runtime
compilation of untrusted schemas is safe against injection by
construction, but the interpreter avoids the question entirely. See
[docs/architecture.md](../architecture.md) for the tier boundary.

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
import { createEngine, UnsafeRegexError } from "@json-schema-engine/core";

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
import { createEngine, type RegexEngine } from "@json-schema-engine/core";

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
import { detectUnsafeRegex } from "@json-schema-engine/core";

assert.equal(detectUnsafeRegex("(a+)+$").safe, false);
assert.equal(detectUnsafeRegex("^[a-z]+$").safe, true);
```

## Unicode-mode regular expressions

JSON Schema specifies ECMA-262 regular expressions with Unicode semantics,
which is the native `RegExp` in unicode mode (the `u` flag). The non-unicode
grammar carries Annex B web-compatibility extensions the unicode grammar
rejects: identity escapes such as `\a`, an unescaped `-` inside a character
class, `\c` before a digit. The engine compiles `pattern` and
`patternProperties` in unicode mode, and by default a pattern the unicode
grammar rejects is a registration error, `NonUnicodeRegexError` (as is a
pattern invalid under both grammars). That matches AJV, which has compiled
with the `u` flag and no fallback since v7, so schemas in circulation are
already written to it. `strictUnicodeRegex: false` restores the non-unicode
fallback for a schema that other validators would also reject.
`classifyRegex` reports which case a pattern is, for a build-time lint.

```ts
import assert from "node:assert";
import {
  createEngine,
  classifyRegex,
  NonUnicodeRegexError,
} from "@json-schema-engine/core";

// `\a` is a SyntaxError in unicode mode and the letter "a" under Annex B.
assert.equal(classifyRegex("^\\a$"), "legacy");

const strict = createEngine();
assert.throws(
  () => strict.registerSchema({ pattern: "^\\a$" }, "https://ex/strict"),
  NonUnicodeRegexError,
);

const lenient = createEngine({ strictUnicodeRegex: false });
const uri = lenient.registerSchema({ pattern: "^\\a$" }, "https://ex/legacy");
assert.equal(lenient.evaluate(uri, "a").valid, true);
```

The `regex` format in `@json-schema-engine/formats` always uses the unicode
grammar: a string that only Annex B accepts is not a valid `format: "regex"`
value, regardless of this option. The screen judges a pattern by the native
`RegExp` grammar even when a custom `regexEngine` is installed; the option
is about the grammar the specification names, not about the engine.

## Recursion depth

A self-referencing schema over deeply nested data, or a deeply nested schema
document, would otherwise overflow the call stack with an uncatchable-by-type
`RangeError`. Registration and evaluation are bounded by `maxDepth`, and
exceeding it throws `MaxDepthExceededError`. The engine stays usable
afterward — each evaluation runs in fresh state.

```ts
import assert from "node:assert";
import { createEngine, MaxDepthExceededError } from "@json-schema-engine/core";

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
