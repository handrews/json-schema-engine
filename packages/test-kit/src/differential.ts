// Differential comparison policy + divergence minimizer for the M6.3 fuzzer
// (DESIGN.md M6.3, §7 comparison policy). Two verdict-producing sides — the
// interpreter and a compiled artifact — are run on the same instance and
// compared under the flag-tier policy; a divergence is shrunk to a minimal
// (schema, instance) repro so a real lowering bug reports a small witness.
//
// This module is validator-agnostic: callers pass plain callbacks, so it
// carries no @jse/core or @jse/compiler dependency and can referee any two
// implementations (including the minimizer self-test's deliberately buggy
// fake). IP policy (DESIGN.md D15): implemented from spec/suite only.

import type { JsonValue } from "./index.js";
import { isObject } from "./index.js";

/**
 * The outcome of running one side on one instance: either a boolean verdict
 * or a thrown error identified by its constructor name (the error *class*,
 * per the §7 policy — message text is not compared).
 */
export type SideOutcome =
  { kind: "verdict"; valid: boolean } | { kind: "throw"; errorClass: string };

/** Run a validate callback, capturing a verdict or the thrown error's class. */
export function runSide(
  validate: (instance: JsonValue) => boolean,
): (instance: JsonValue) => SideOutcome {
  return (instance) => {
    try {
      return { kind: "verdict", valid: validate(instance) };
    } catch (err) {
      return { kind: "throw", errorClass: (err as Error).constructor.name };
    }
  };
}

/**
 * The §7 flag-tier agreement policy: outcomes agree when both are verdicts
 * with equal `valid`, OR both throw the same error class. A verdict on one
 * side and a throw on the other is a divergence, as is a mismatched verdict
 * or a different error class.
 */
export function outcomesAgree(a: SideOutcome, b: SideOutcome): boolean {
  if (a.kind === "verdict" && b.kind === "verdict") return a.valid === b.valid;
  if (a.kind === "throw" && b.kind === "throw") {
    return a.errorClass === b.errorClass;
  }
  return false;
}

/** Human-readable one-liner for an outcome, for failure messages. */
export function describeOutcome(o: SideOutcome): string {
  return o.kind === "verdict"
    ? `valid=${String(o.valid)}`
    : `throw ${o.errorClass}`;
}

/**
 * List-mode outcome encoding: the full result as canonical JSON in the
 * throw channel, so {@link outcomesAgree} === full structural equality —
 * message text, params, and FIELD ORDER included (JSON.stringify is
 * order-sensitive, which is the point: the M8.1 params contract pins field
 * order). Real throws become `"THREW:" + constructor.name`, which can never
 * collide with a JSON-encoded result.
 */
export function runListSide(
  evaluate: (instance: JsonValue) => unknown,
): (instance: JsonValue) => SideOutcome {
  return (instance) => {
    try {
      return { kind: "throw", errorClass: JSON.stringify(evaluate(instance)) };
    } catch (err) {
      return {
        kind: "throw",
        errorClass: "THREW:" + (err as Error).constructor.name,
      };
    }
  };
}

/** Both prepared sides for ONE schema, sharing whatever `prepare` built. */
export interface DifferentialSides {
  /** The interpreter's outcome on an instance. */
  interpret(instance: JsonValue): SideOutcome;
  /** The compiled artifact's outcome on an instance. */
  validate(instance: JsonValue): SideOutcome;
}

/**
 * A single point of side construction. The FUZZ_LIST incident happened
 * because the fuzz hot loop and the post-divergence minimizer each built
 * their comparisons independently — one was rewired for list mode, the
 * other silently kept comparing flag verdicts. A factory makes that
 * unrepresentable: every consumer derives BOTH the hot-loop sides and the
 * minimizer subject ({@link subjectFromFactory}) from the same `prepare`.
 *
 * `prepare` must be deterministic per schema: the minimizer re-prepares
 * candidates as it shrinks.
 */
export interface DifferentialFactory {
  /**
   * Both sides for a schema, or undefined when it does not
   * register/compile (replaces a separate registrability probe).
   */
  prepare(schema: JsonValue): DifferentialSides | undefined;
}

/** The minimizer-facing view of a factory: one construction path, two APIs. */
export function subjectFromFactory(
  factory: DifferentialFactory,
): DifferentialSubject {
  const mustPrepare = (schema: JsonValue): DifferentialSides => {
    const sides = factory.prepare(schema);
    if (sides === undefined) {
      throw new Error(
        "DifferentialFactory.prepare returned undefined for a schema it " +
          "previously accepted — prepare must be deterministic per schema",
      );
    }
    return sides;
  };
  return {
    registers: (schema) => factory.prepare(schema) !== undefined,
    interpreted: (schema, instance) => mustPrepare(schema).interpret(instance),
    compiled: (schema, instance) => mustPrepare(schema).validate(instance),
  };
}

/**
 * A side under differential test: given a schema and an instance, produce an
 * outcome. The minimizer re-registers/re-compiles the schema as it shrinks
 * it, so the callback receives both — but `registers` lets a caller memoize a
 * per-schema compilation and report whether a candidate schema is even
 * registrable (an unregistrable shrink is not a valid smaller schema).
 */
export interface DifferentialSubject {
  /** Whether this schema registers/compiles at all (shrink guard). */
  registers(schema: JsonValue): boolean;
  /** The interpreter's outcome on (schema, instance). */
  interpreted(schema: JsonValue, instance: JsonValue): SideOutcome;
  /** The compiled artifact's outcome on (schema, instance). */
  compiled(schema: JsonValue, instance: JsonValue): SideOutcome;
}

/** A minimized divergence witness. */
export interface Divergence {
  schema: JsonValue;
  instance: JsonValue;
  interpreted: SideOutcome;
  compiled: SideOutcome;
}

/** True when (schema, instance) diverges under the subject's two sides. */
function diverges(
  subject: DifferentialSubject,
  schema: JsonValue,
  instance: JsonValue,
): Divergence | undefined {
  if (!subject.registers(schema)) return undefined;
  const interpreted = subject.interpreted(schema, instance);
  const compiled = subject.compiled(schema, instance);
  if (outcomesAgree(interpreted, compiled)) return undefined;
  return { schema, instance, interpreted, compiled };
}

/**
 * A monotone size measure: node count plus total key/string length. Every
 * accepted shrink must strictly decrease it, which guarantees termination
 * even though {@link shrinkValue} may propose lateral candidates (e.g.
 * `false`↔`null`). `null` is the unique minimum, so primitive replacements
 * converge rather than cycle.
 */
function complexity(value: JsonValue): number {
  if (value === null) return 0;
  if (typeof value === "boolean") return 1;
  if (typeof value === "number") return 1;
  if (typeof value === "string") return 1 + value.length;
  let sum = 1;
  if (Array.isArray(value)) {
    for (const v of value) sum += complexity(v);
    return sum;
  }
  for (const [k, v] of Object.entries(value)) {
    sum += 1 + k.length + complexity(v);
  }
  return sum;
}

/**
 * Candidate simplifications of a JSON value: delete each object key, delete
 * each array element, and replace the whole value (and each subtree) with a
 * primitive. Ordered smallest-effect-first so the greedy loop converges on a
 * minimal witness. Recurses into children so nested culprits shrink too.
 * The caller ({@link shrinkFixpoint}) only accepts complexity-decreasing
 * candidates, so lateral proposals here are harmless.
 */
function* shrinkValue(value: JsonValue): Generator<JsonValue> {
  // Whole-value replacements: the most aggressive shrinks, tried first.
  for (const primitive of [null, false, 0, ""] as JsonValue[]) {
    if (value !== primitive) yield primitive;
  }
  // Hoist a child up to replace the whole value — collapses nesting so a
  // culprit buried deep in wrapper objects/arrays surfaces to the top.
  if (Array.isArray(value)) {
    for (const child of value) yield child;
  } else if (isObject(value)) {
    for (const child of Object.values(value)) yield child;
  }
  if (Array.isArray(value)) {
    // Drop each element.
    for (let i = 0; i < value.length; i++) {
      yield [...value.slice(0, i), ...value.slice(i + 1)];
    }
    // Shrink each element in place.
    for (let i = 0; i < value.length; i++) {
      for (const smaller of shrinkValue(value[i]!)) {
        const copy = [...value];
        copy[i] = smaller;
        yield copy;
      }
    }
  } else if (isObject(value)) {
    const entries = Object.entries(value);
    const keys = Object.keys(value);
    // Drop each key by rebuilding without it (avoids dynamic `delete`).
    for (const dropped of keys) {
      const copy: Record<string, JsonValue> = {};
      for (const [k, v] of entries) if (k !== dropped) copy[k] = v;
      yield copy;
    }
    // Shrink each member in place.
    for (const key of keys) {
      for (const smaller of shrinkValue(value[key]!)) {
        yield { ...value, [key]: smaller };
      }
    }
  }
}

/**
 * Greedily apply shrinks that preserve the divergence AND strictly decrease
 * {@link complexity}, until no candidate does. The strict-decrease gate makes
 * the loop terminating and deterministic regardless of candidate order: each
 * accepted step lowers a bounded non-negative measure, so the loop runs at
 * most `complexity(start)` times. `keeps` decides whether a candidate still
 * diverges *and* is admissible (the schema pass also checks registrability).
 */
function shrinkFixpoint(
  start: JsonValue,
  keeps: (candidate: JsonValue) => Divergence | undefined,
): { value: JsonValue; divergence: Divergence } {
  let current = start;
  let currentDiv = keeps(current)!;
  let currentSize = complexity(current);
  let progress = true;
  while (progress) {
    progress = false;
    for (const candidate of shrinkValue(current)) {
      const size = complexity(candidate);
      if (size >= currentSize) continue; // never accept a lateral/larger move
      const div = keeps(candidate);
      if (div !== undefined) {
        current = candidate;
        currentDiv = div;
        currentSize = size;
        progress = true;
        break;
      }
    }
  }
  return { value: current, divergence: currentDiv };
}

/**
 * Given a diverging (schema, instance), shrink the instance first, then the
 * schema, holding the divergence throughout. Returns the minimal witness.
 * Purely deterministic in (subject, schema, instance).
 * @throws Error if the input pair does not actually diverge.
 */
export function minimizeDivergence(
  subject: DifferentialSubject,
  schema: JsonValue,
  instance: JsonValue,
): Divergence {
  const initial = diverges(subject, schema, instance);
  if (initial === undefined) {
    throw new Error("minimizeDivergence called on a non-diverging pair");
  }

  // Phase 1: shrink the instance against the fixed schema.
  const instancePhase = shrinkFixpoint(instance, (candidate) =>
    diverges(subject, schema, candidate),
  );

  // Phase 2: shrink the schema against the minimized instance. A schema
  // shrink must still register (an unregistrable schema is not a valid
  // smaller reproduction); diverges() enforces that via registers().
  const minInstance = instancePhase.value;
  const schemaPhase = shrinkFixpoint(schema, (candidate) =>
    diverges(subject, candidate, minInstance),
  );

  // Phase 3: re-shrink the instance once more against the minimized schema —
  // a smaller schema can unlock further instance shrinks.
  const finalPhase = shrinkFixpoint(minInstance, (candidate) =>
    diverges(subject, schemaPhase.value, candidate),
  );

  return finalPhase.divergence;
}
