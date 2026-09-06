// Sensitivity self-tests for the differential side machinery — direct
// encodings of the FUZZ_LIST incident class: a comparison that LOOKS green
// while measuring nothing. Each case pins that the list encoding detects
// exactly the differences the flag policy is blind to, and that the
// factory routes hot-loop sides and the minimizer subject through one
// construction path.

import { describe, it, expect } from "vitest";
import {
  outcomesAgree,
  runAnnotationsSide,
  runListSide,
  runSide,
  sameAnnotationsDivergenceClass,
  sameListDivergenceClass,
  subjectFromFactory,
  type DifferentialFactory,
} from "./index.js";

const listResult = (valid: boolean, errors: unknown[]) => ({ valid, errors });

// Annotations-mode payload: the list result WITH the annotations key, so
// present-but-empty and absent encode differently (part of the contract).
const listAnn = (
  valid: boolean,
  errors: unknown[],
  annotations: unknown[],
) => ({ valid, errors, annotations });

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

// One annotation unit with all rendered fields; `extra` overrides any of them
// (keyword, vocabulary, the locations, the value) so a test can vary exactly
// the field it means to probe.
const annUnit = (
  annotation: unknown,
  extra: Record<string, unknown> = {},
): Record<string, unknown> => ({
  keyword: "title",
  vocabulary: "https://json-schema.org/draft/2020-12/vocab/meta-data",
  evaluationPath: "/title",
  schemaLocation: "https://s.example#/title",
  inputLocation: "",
  annotation,
  ...extra,
});

describe("runAnnotationsSide sensitivity", () => {
  // The plain list and flag encodings the annotation leg must out-see: same
  // verdict, same (empty) errors — annotations never enter their payload.
  const flag = () => runSide(() => true)(null);
  const list = () => runListSide(() => listResult(true, []))(null);

  it("same verdict, same errors, different annotation VALUE → disagreement", () => {
    const a = runAnnotationsSide(() => listAnn(true, [], [annUnit("A")]))(null);
    const b = runAnnotationsSide(() => listAnn(true, [], [annUnit("B")]))(null);
    expect(outcomesAgree(a, b)).toBe(false);
    // The flag and plain-list encodings are blind to exactly this.
    expect(outcomesAgree(flag(), flag())).toBe(true);
    expect(outcomesAgree(list(), list())).toBe(true);
  });

  it("different annotation ORDER → disagreement", () => {
    const u1 = annUnit("A", { inputLocation: "/a" });
    const u2 = annUnit("B", { inputLocation: "/b" });
    const a = runAnnotationsSide(() => listAnn(true, [], [u1, u2]))(null);
    const b = runAnnotationsSide(() => listAnn(true, [], [u2, u1]))(null);
    expect(outcomesAgree(a, b)).toBe(false);
    expect(outcomesAgree(list(), list())).toBe(true);
  });

  it("a missing annotation unit → disagreement", () => {
    const a = runAnnotationsSide(() =>
      listAnn(true, [], [annUnit("A"), annUnit("B", { inputLocation: "/b" })]),
    )(null);
    const b = runAnnotationsSide(() => listAnn(true, [], [annUnit("A")]))(null);
    expect(outcomesAgree(a, b)).toBe(false);
    expect(outcomesAgree(list(), list())).toBe(true);
  });

  it("annotations key present vs absent → disagreement", () => {
    const present = runAnnotationsSide(() => listAnn(true, [], []))(null);
    const absent = runAnnotationsSide(() => listResult(true, []))(null);
    expect(outcomesAgree(present, absent)).toBe(false);
    // Both flag and plain-list are blind: neither payload carried annotations.
    expect(outcomesAgree(flag(), flag())).toBe(true);
    expect(outcomesAgree(list(), list())).toBe(true);
  });

  it("identical results (annotations included) → agreement", () => {
    const make = () =>
      runAnnotationsSide(() => listAnn(true, [], [annUnit("A")]))(null);
    expect(outcomesAgree(make(), make())).toBe(true);
  });
});

describe("sameAnnotationsDivergenceClass", () => {
  interface AnnPayload {
    valid: boolean;
    errors: unknown[];
    annotations?: unknown[];
  }
  const adiv = (
    interpreted: AnnPayload | Error,
    compiled: AnnPayload | Error,
  ) => ({
    schema: true as const,
    instance: null,
    interpreted: runAnnotationsSide(() => {
      if (interpreted instanceof Error) throw interpreted;
      return interpreted;
    })(null),
    compiled: runAnnotationsSide(() => {
      if (compiled instanceof Error) throw compiled;
      return compiled;
    })(null),
  });

  it("both valid with annotations, contents differ → same class", () => {
    const a = adiv(
      listAnn(true, [], [annUnit("A")]),
      listAnn(true, [], [annUnit("B")]),
    );
    const b = adiv(
      listAnn(true, [], [annUnit("A"), annUnit("C")]),
      listAnn(true, [], []),
    );
    expect(sameAnnotationsDivergenceClass(a, b)).toBe(true);
  });

  it("annotation-content divergence never matches a throw-vs-result tier gap", () => {
    const real = adiv(
      listAnn(true, [], [annUnit("A")]),
      listAnn(true, [], [annUnit("B")]),
    );
    const tierGap = adiv(new TypeError("boom"), listAnn(true, [], []));
    expect(sameAnnotationsDivergenceClass(real, tierGap)).toBe(false);
  });

  it("verdict flips are their own class", () => {
    const flip = adiv(listAnn(true, [], []), listResult(false, [{}]));
    const content = adiv(
      listAnn(true, [], [annUnit("A")]),
      listAnn(true, [], [annUnit("B")]),
    );
    expect(sameAnnotationsDivergenceClass(flip, content)).toBe(false);
  });

  it("key-present-vs-absent is a distinct class from content divergence", () => {
    // Both valid, but one side omits the annotations key entirely — a
    // different kind of annotation bug than two present-but-differing arrays.
    const keyGap = adiv(listAnn(true, [], []), listResult(true, []));
    const content = adiv(
      listAnn(true, [], [annUnit("A")]),
      listAnn(true, [], [annUnit("B")]),
    );
    expect(sameAnnotationsDivergenceClass(keyGap, content)).toBe(false);
    expect(sameAnnotationsDivergenceClass(keyGap, keyGap)).toBe(true);
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
