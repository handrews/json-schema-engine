// Regular-expression handling for `pattern`/`patternProperties`: a pluggable
// compile hook, a per-engine compiled-pattern cache, and a conservative
// static detector for exponential-backtracking (ReDoS) shapes.
//
// `pattern`/`patternProperties` compile untrusted regex from the schema and
// run it against untrusted instance strings. The native RegExp engine is
// vulnerable to catastrophic backtracking; callers who evaluate untrusted
// schemas can inject a linear-time engine (e.g. RE2) through `regexEngine`,
// and/or reject unsafe patterns at registration with `rejectUnsafeRegex`
// (backed by {@link detectUnsafeRegex}). See docs/guide/security.md.

import { schemaRegExp } from "./json.js";

/** A compiled pattern: only membership testing is needed. */
export interface CompiledRegex {
  test(input: string): boolean;
}

/** Compiles a JSON Schema `pattern` string into a {@link CompiledRegex}. */
export interface RegexEngine {
  compile(pattern: string): CompiledRegex;
}

/**
 * The built-in engine: ECMA-262 semantics via the native `RegExp` (unicode
 * mode where valid). Fast, but subject to catastrophic backtracking on
 * adversarial patterns — see {@link RegexEngine} for the linear-time opt-out.
 */
export const defaultRegexEngine: RegexEngine = {
  compile: (pattern) => schemaRegExp(pattern),
};

/**
 * Compiles patterns through a {@link RegexEngine}, caching by pattern string.
 * One cache lives per {@link Engine}, so a pattern that appears in many
 * schemas — or is tested against many instances — compiles once even when the
 * engine's own compilation is expensive.
 */
export class RegexCache {
  private cache = new Map<string, CompiledRegex>();

  constructor(private engine: RegexEngine = defaultRegexEngine) {}

  compile(pattern: string): CompiledRegex {
    let compiled = this.cache.get(pattern);
    if (compiled === undefined) {
      compiled = this.engine.compile(pattern);
      this.cache.set(pattern, compiled);
    }
    return compiled;
  }
}

/** A pattern was rejected by {@link EngineOptions.rejectUnsafeRegex}. */
export class UnsafeRegexError extends Error {}

/** A pattern was rejected by {@link EngineOptions.strictUnicodeRegex}. */
export class NonUnicodeRegexError extends Error {}

/**
 * Classifies a pattern against the ECMA-262 regular-expression grammar:
 * `"unicode"` when it compiles in unicode mode (the `u` flag) — the grammar
 * JSON Schema specifies; `"legacy"` when only the non-unicode grammar, with
 * its Annex B web-compatibility extensions (identity escapes such as `\a`,
 * unescaped `-` inside a class, `\c` before a digit), accepts it — the case
 * the built-in engine falls back on; `"invalid"` when neither does.
 */
export function classifyRegex(
  pattern: string,
): "unicode" | "legacy" | "invalid" {
  try {
    new RegExp(pattern, "u");
    return "unicode";
  } catch {
    try {
      new RegExp(pattern);
      return "legacy";
    } catch {
      return "invalid";
    }
  }
}

/**
 * Flags regular expressions whose structure admits exponential-time
 * backtracking (ReDoS). The test is star height: a repetition applied to a
 * subexpression that itself contains an unbounded repetition — `(a+)+`,
 * `(a*)*`, `(.*)+` — is the classic exponential shape.
 *
 * This is a conservative heuristic, not a proof. It targets nested unbounded
 * quantifiers; it does not catch every dangerous pattern (e.g. overlapping
 * alternation such as `(a|a)*`), and a linear-time engine remains the only
 * hard guarantee. Safe by default when the pattern cannot be parsed.
 */
export function detectUnsafeRegex(pattern: string): {
  safe: boolean;
  reason?: string;
} {
  let i = 0;

  // Parses a sequence (alternation of concatenations) up to a closing `)` or
  // end of input, returning its star height.
  const parseSeq = (): number => {
    let maxHeight = 0;
    while (i < pattern.length) {
      const c = pattern[i];
      if (c === "|") {
        i++;
        continue;
      }
      if (c === ")") break;

      let atomHeight = 0;
      if (c === "\\") {
        i += 2; // escaped atom
      } else if (c === "[") {
        skipCharClass();
      } else if (c === "(") {
        i++;
        skipGroupPrefix();
        atomHeight = parseSeq();
        if (pattern[i] === ")") i++;
      } else {
        i++; // literal
      }

      const height = atomHeight + (consumeQuantifier() ? 1 : 0);
      if (height > maxHeight) maxHeight = height;
    }
    return maxHeight;
  };

  // Consumes a trailing quantifier if present; returns whether it was
  // unbounded (`*`, `+`, `{n,}`). Bounded quantifiers (`?`, `{n}`, `{n,m}`)
  // do not raise star height.
  const consumeQuantifier = (): boolean => {
    let unbounded = false;
    const q = pattern[i];
    if (q === "*" || q === "+") {
      unbounded = true;
      i++;
    } else if (q === "?") {
      i++;
    } else if (q === "{") {
      const close = pattern.indexOf("}", i);
      if (close !== -1) {
        const body = pattern.slice(i + 1, close);
        i = close + 1;
        unbounded = /^\s*\d+\s*,\s*$/.test(body);
      }
    }
    // Lazy/possessive suffix does not change star height.
    if (pattern[i] === "?" || pattern[i] === "+") i++;
    return unbounded;
  };

  const skipCharClass = (): void => {
    i++; // opening [
    if (pattern[i] === "^") i++;
    if (pattern[i] === "]") i++; // a leading ] is literal
    while (i < pattern.length && pattern[i] !== "]") {
      if (pattern[i] === "\\") i++;
      i++;
    }
    i++; // closing ]
  };

  // Skips `(?:`, `(?=`, `(?!`, `(?<=`, `(?<!`, `(?<name>` prefixes.
  const skipGroupPrefix = (): void => {
    if (pattern[i] !== "?") return;
    i++;
    if (
      pattern[i] === "<" &&
      pattern[i + 1] !== "=" &&
      pattern[i + 1] !== "!"
    ) {
      const close = pattern.indexOf(">", i);
      if (close !== -1) i = close + 1;
      return;
    }
    // ?:, ?=, ?!, ?<=, ?<!
    i++;
    if (pattern[i] === "=" || pattern[i] === "!") i++;
  };

  let height: number;
  try {
    height = parseSeq();
  } catch {
    return { safe: true };
  }
  return height >= 2
    ? {
        safe: false,
        reason: `nested unbounded quantifier (star height ${height})`,
      }
    : { safe: true };
}
