// Sensitivity self-tests for the differential side machinery — direct
// encodings of the FUZZ_LIST incident class: a comparison that LOOKS green
// while measuring nothing. Each case pins that the list encoding detects
// exactly the differences the flag policy is blind to, and that the
// factory routes hot-loop sides and the minimizer subject through one
// construction path.

import { describe, it, expect } from "vitest";
import {
  outcomesAgree,
  runListSide,
  runSide,
  sameListDivergenceClass,
  subjectFromFactory,
  type DifferentialFactory,
} from "./index.js";

const listResult = (valid: boolean, errors: unknown[]) => ({ valid, errors });

describe("runListSide sensitivity", () => {
  it("same verdict, different error lists → disagreement", () => {
    const a = runListSide(() =>
      listResult(false, [{ keyword: "type", params: { expected: "string" } }]),
    )(null);
    const b = runListSide(() =>
      listResult(false, [{ keyword: "type", params: { expected: "number" } }]),
    )(null);
    expect(outcomesAgree(a, b)).toBe(false);
    // ...and the flag policy is blind to exactly this — the asymmetry the
    // FUZZ_LIST bug hid.
    const fa = runSide(() => false)(null);
    const fb = runSide(() => false)(null);
    expect(outcomesAgree(fa, fb)).toBe(true);
  });

  it("same errors, different params FIELD ORDER → disagreement", () => {
    const a = runListSide(() =>
      listResult(false, [{ params: { i: 1, j: 0 } }]),
    )(null);
    const b = runListSide(() =>
      listResult(false, [{ params: { j: 0, i: 1 } }]),
    )(null);
    expect(outcomesAgree(a, b)).toBe(false);
  });

  it("identical results → agreement", () => {
    const make = () =>
      runListSide(() =>
        listResult(false, [{ keyword: "minimum", params: { limit: 3 } }]),
      )(null);
    expect(outcomesAgree(make(), make())).toBe(true);
  });

  it("error ORDER within the list is significant", () => {
    const a = runListSide(() =>
      listResult(false, [{ keyword: "a" }, { keyword: "b" }]),
    )(null);
    const b = runListSide(() =>
      listResult(false, [{ keyword: "b" }, { keyword: "a" }]),
    )(null);
    expect(outcomesAgree(a, b)).toBe(false);
  });

  it("both throw the same class → agreement; throw vs result → disagreement", () => {
    const boom = runListSide(() => {
      throw new TypeError("x");
    })(null);
    const boom2 = runListSide(() => {
      throw new TypeError("different message, same class");
    })(null);
    const ok = runListSide(() => listResult(true, []))(null);
    expect(outcomesAgree(boom, boom2)).toBe(true);
    expect(outcomesAgree(boom, ok)).toBe(false);
    const rangeErr = runListSide(() => {
      throw new RangeError("x");
    })(null);
    expect(outcomesAgree(boom, rangeErr)).toBe(false);
  });
});

describe("sameListDivergenceClass", () => {
  const div = (interpreted: unknown, compiled: unknown) => ({
    schema: true as const,
    instance: null,
    interpreted: runListSide(() => {
      if (interpreted instanceof Error) throw interpreted;
      return interpreted;
    })(null),
    compiled: runListSide(() => {
      if (compiled instanceof Error) throw compiled;
      return compiled;
    })(null),
  });

  it("same shape (both sides invalid results, errors differ) → same class", () => {
    const a = div(listResult(false, [{ keyword: "a" }]), listResult(false, []));
    const b = div(listResult(false, [{ keyword: "b" }]), listResult(false, []));
    expect(sameListDivergenceClass(a, b)).toBe(true);
  });

  it("error-content divergence never matches a throw-vs-result tier gap", () => {
    // The M6.6 incident shape: real bug = both sides invalid with different
    // errors; minimizer endpoint = interpreter THREW while compiled said
    // valid. These must never compare as the same class.
    const real = div(
      listResult(false, [{ keyword: "a" }]),
      listResult(false, [{ keyword: "b" }]),
    );
    const tierGap = div(new TypeError("boom"), listResult(true, []));
    expect(sameListDivergenceClass(real, tierGap)).toBe(false);
  });

  it("verdict flips are their own class", () => {
    const flip = div(listResult(true, []), listResult(false, [{}]));
    const content = div(
      listResult(false, [{ keyword: "a" }]),
      listResult(false, [{ keyword: "b" }]),
    );
    expect(sameListDivergenceClass(flip, content)).toBe(false);
    expect(sameListDivergenceClass(flip, flip)).toBe(true);
  });
});

describe("subjectFromFactory", () => {
  it("routes registers/interpreted/compiled through ONE prepare", () => {
    let prepares = 0;
    const factory: DifferentialFactory = {
      prepare: (schema) => {
        prepares++;
        if (schema === false) return undefined;
        return {
          interpret: (x) => ({ kind: "verdict", valid: x !== null }),
          validate: (x) => ({ kind: "verdict", valid: x !== null }),
        };
      },
    };
    const subject = subjectFromFactory(factory);
    expect(subject.registers(false)).toBe(false);
    expect(subject.registers({})).toBe(true);
    expect(subject.interpreted({}, 1)).toEqual({
      kind: "verdict",
      valid: true,
    });
    expect(subject.compiled({}, null)).toEqual({
      kind: "verdict",
      valid: false,
    });
    expect(prepares).toBe(4);
  });

  it("throws loudly on a non-deterministic prepare", () => {
    let first = true;
    const factory: DifferentialFactory = {
      prepare: () => {
        if (!first) return undefined;
        first = false;
        return {
          interpret: () => ({ kind: "verdict", valid: true }),
          validate: () => ({ kind: "verdict", valid: true }),
        };
      },
    };
    const subject = subjectFromFactory(factory);
    expect(subject.registers({})).toBe(true);
    expect(() => subject.interpreted({}, 1)).toThrow(/deterministic/);
  });
});
