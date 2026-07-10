// Minimizer self-test (DESIGN.md M6.3): prove the differential harness
// actually catches and shrinks a real lowering-shaped bug — WITHOUT touching
// compiler source. We stand up a deliberately buggy "compiled" side (a fake
// that flips the verdict whenever the instance carries a magic key) against a
// truthful "interpreter" side, then assert minimizeDivergence reduces a large
// diverging instance to a small witness that still contains the magic key.
// If the minimizer ever stops shrinking soundly, this test goes red before a
// real compiler bug's repro would be uselessly large.

import { describe, it, expect } from "vitest";
import {
  minimizeDivergence,
  outcomesAgree,
  type DifferentialSubject,
  type JsonValue,
  type SideOutcome,
} from "./index.js";

const MAGIC = "__bug_trigger__";

/** True if `value` contains MAGIC as an object key anywhere in its tree. */
function containsMagic(value: JsonValue): boolean {
  if (value === null || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(containsMagic);
  if (Object.hasOwn(value, MAGIC)) return true;
  return Object.values(value).some(containsMagic);
}

// The "interpreter": everything is valid — a trivial oracle. The bug lives
// only in the fake compiled side.
function truthful(_instance: JsonValue): SideOutcome {
  return { kind: "verdict", valid: true };
}

// The "buggy compiled" side: agrees with truthful EXCEPT it flips the verdict
// whenever the instance contains the magic key — exactly the shape of a
// lowering that mishandles one property.
function buggy(instance: JsonValue): SideOutcome {
  return { kind: "verdict", valid: !containsMagic(instance) };
}

describe("divergence minimizer self-test", () => {
  const subject: DifferentialSubject = {
    // The schema plays no role in this fake; any schema "registers".
    registers: () => true,
    interpreted: (_schema, instance) => truthful(instance),
    compiled: (_schema, instance) => buggy(instance),
  };

  it("shrinks a bloated diverging instance to a small magic-key witness", () => {
    // A large, noisy instance that diverges only because MAGIC is buried in it.
    const bloated: JsonValue = {
      a: [1, 2, 3, { b: "x", c: [true, false, null] }],
      d: { e: { f: { g: { [MAGIC]: "boom", h: "noise" } } } },
      i: "filler",
      j: [{ k: 1 }, { l: 2 }, { m: 3 }],
    };
    const schema: JsonValue = { type: "object", not: false };

    // Sanity: the pair actually diverges before minimizing.
    expect(outcomesAgree(truthful(bloated), buggy(bloated))).toBe(false);

    const min = minimizeDivergence(subject, schema, bloated);

    // The witness still diverges, still carries the magic key, and is small.
    expect(outcomesAgree(min.interpreted, min.compiled)).toBe(false);
    expect(containsMagic(min.instance)).toBe(true);
    // Minimal form the shrinker reaches: the magic key with a null value and
    // no siblings — nesting is hoisted away, the key's value bottoms out to
    // null (the complexity minimum), and the key itself cannot be dropped
    // without ending the divergence.
    expect(min.instance).toEqual({ [MAGIC]: null });
    // The schema is divergence-irrelevant for this fake (any schema
    // registers), so it shrinks to the complexity minimum, `null`.
    expect(min.schema).toEqual(null);
  });

  it("throws when asked to minimize a non-diverging pair", () => {
    const agree: DifferentialSubject = {
      registers: () => true,
      interpreted: () => ({ kind: "verdict", valid: true }),
      compiled: () => ({ kind: "verdict", valid: true }),
    };
    expect(() => minimizeDivergence(agree, true, { x: 1 })).toThrow();
  });

  it("respects registrability: an unregistrable schema shrink is rejected", () => {
    // Divergence depends on a schema keyword; only schemas keeping that
    // keyword "register". The minimizer must not shrink it away.
    const marked: DifferentialSubject = {
      registers: (schema) =>
        typeof schema === "object" &&
        schema !== null &&
        !Array.isArray(schema) &&
        Object.hasOwn(schema, "keep"),
      interpreted: () => ({ kind: "verdict", valid: true }),
      compiled: (_schema, instance) => ({
        kind: "verdict",
        valid: !containsMagic(instance),
      }),
    };
    const min = minimizeDivergence(
      marked,
      { keep: true, drop: [1, 2, 3] },
      { junk: 0, [MAGIC]: "x" },
    );
    expect(containsMagic(min.instance)).toBe(true);
    // The required "keep" key survives (dropping it makes the schema
    // unregistrable, so the shrinker rejects that move); the droppable "drop"
    // key is gone and "keep"'s value bottoms out to null.
    expect(min.schema).toEqual({ keep: null });
  });

  it("sameDivergence keeps the shrink from wandering across classes", () => {
    // Two planted divergence regions of DIFFERENT classes: instances
    // containing MAGIC diverge by verdict flip (the "real bug"); null — the
    // shrinker's favorite endpoint — diverges by throw-vs-verdict (the
    // "garbage tier gap"). Without the class guard, minimizing the real bug
    // wanders onto null and reports the wrong finding; the M6.6 session hit
    // exactly this with 28 real list divergences collapsing onto a
    // prefixItems:null tier gap.
    const twoClasses: DifferentialSubject = {
      registers: () => true,
      interpreted: (_schema, instance) => {
        if (instance === null) throw new TypeError("tier gap");
        return { kind: "verdict", valid: true };
      },
      compiled: (_schema, instance) => ({
        kind: "verdict",
        valid: !containsMagic(instance),
      }),
    };
    // Run each side through the harness's own guards so throws become
    // outcomes, like the real subjects do.
    const wrapped: DifferentialSubject = {
      registers: twoClasses.registers.bind(twoClasses),
      interpreted: (s, i) => {
        try {
          return twoClasses.interpreted(s, i);
        } catch (err) {
          return {
            kind: "throw",
            errorClass: (err as Error).constructor.name,
          };
        }
      },
      compiled: (s, i) => twoClasses.compiled(s, i),
    };
    const start = { pad: [1, 2], [MAGIC]: "x" };

    // Default behavior: existence-preserving shrink wanders to null, the
    // smaller wrong-class witness.
    const wandered = minimizeDivergence(wrapped, true, start);
    expect(wandered.instance).toBe(null);
    expect(wandered.interpreted.kind).toBe("throw");

    // Class-guarded shrink: the witness stays a verdict-flip divergence and
    // keeps the trigger.
    const held = minimizeDivergence(wrapped, true, start, {
      sameDivergence: (initial, candidate) =>
        initial.interpreted.kind === candidate.interpreted.kind &&
        initial.compiled.kind === candidate.compiled.kind,
    });
    expect(containsMagic(held.instance)).toBe(true);
    expect(held.interpreted.kind).toBe("verdict");
  });
});
