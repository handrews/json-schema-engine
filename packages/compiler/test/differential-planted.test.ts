// Planted-divergence self-test (testing-lessons hardening): proves the
// fuzz legs' comparisons can detect what they claim to referee. A
// deliberately corrupted compiled side — wrong error params, verdict
// untouched — must trip the LIST comparison and slip past the FLAG
// comparison. The original FUZZ_LIST bug was a list leg that silently ran
// the flag comparison: under it, this planted corruption was invisible,
// so this test is the gate that would have caught the gate.

import { describe, it, expect } from "vitest";
import { createEngine, type JsonValue } from "@jse/core";
import { compileList, compileValidator } from "@jse/compiler";
import {
  outcomesAgree,
  runAnnotationsSide,
  runListSide,
  runSide,
} from "@jse/test-kit";

const SCHEMA = { type: "object", properties: { n: { minimum: 3 } } };
const FAILING = { n: 1 } as JsonValue;

function build() {
  const engine = createEngine();
  const uri = engine.registerSchema(SCHEMA, "https://planted.example/s");
  const listArtifact = compileList(engine, uri, { errorParams: true });
  const flagArtifact = compileValidator(engine, uri);
  const corruptedList = (x: JsonValue) => {
    const r = listArtifact.evaluateList(x);
    if (r.valid) return { valid: true, errors: [] };
    const [first, ...rest] = r.errors;
    return {
      valid: false,
      errors: [{ ...first, params: { limit: 999 } }, ...rest],
    };
  };
  return { engine, uri, listArtifact, flagArtifact, corruptedList };
}

describe("planted divergence: the comparisons detect what they claim", () => {
  it("corrupted params trip the LIST comparison", () => {
    const { engine, uri, corruptedList } = build();
    const interpret = runListSide((x) => {
      const r = engine.evaluate(uri, x, { output: "list", errorParams: true });
      return { valid: r.valid, errors: r.errors ?? [] };
    });
    const validate = runListSide(corruptedList);
    expect(outcomesAgree(interpret(FAILING), validate(FAILING))).toBe(false);
    // Sanity: the uncorrupted artifact agrees, so the disagreement above is
    // the plant, not a real divergence.
    const { listArtifact } = build();
    const honest = runListSide((x) => {
      const r = listArtifact.evaluateList(x);
      return { valid: r.valid, errors: r.valid ? [] : r.errors };
    });
    expect(outcomesAgree(interpret(FAILING), honest(FAILING))).toBe(true);
  });

  it("the same corruption slips past the FLAG comparison — the asymmetry the FUZZ_LIST bug hid", () => {
    const { engine, uri, corruptedList } = build();
    const interpret = runSide((x) => engine.evaluate(uri, x).valid);
    const validate = runSide((x) => corruptedList(x).valid);
    expect(outcomesAgree(interpret(FAILING), validate(FAILING))).toBe(true);
  });
});

// Annotation plant: verdict and errors untouched, one annotation VALUE
// swapped — visible only to the annotations encoding. Both the FLAG and the
// plain LIST comparisons must stay blind, or the annotations leg would be
// redundant rather than the only referee of the channel.
const ANN_SCHEMA = { title: "root", properties: { n: { title: "n-title" } } };
const PASSING = { n: 1 } as JsonValue;

function buildAnn() {
  const engine = createEngine();
  const uri = engine.registerSchema(ANN_SCHEMA, "https://planted.example/ann");
  const annArtifact = compileList(engine, uri, { annotations: true });
  const corruptedAnn = (x: JsonValue) => {
    const r = annArtifact.evaluateList(x);
    if (!r.valid || r.annotations === undefined) return r;
    const [first, ...rest] = r.annotations;
    return {
      valid: r.valid,
      errors: r.errors,
      annotations: [{ ...first!, annotation: "PLANTED" }, ...rest],
    };
  };
  return { engine, uri, annArtifact, corruptedAnn };
}

describe("planted annotation divergence: only the annotations comparison sees it", () => {
  it("a corrupted annotation value trips the ANNOTATIONS comparison", () => {
    const { engine, uri, annArtifact, corruptedAnn } = buildAnn();
    const interpret = runAnnotationsSide((x) => {
      const r = engine.evaluate(uri, x, {
        output: "list",
        annotations: true,
      });
      return r.annotations === undefined
        ? { valid: r.valid, errors: r.errors ?? [] }
        : {
            valid: r.valid,
            errors: r.errors ?? [],
            annotations: r.annotations,
          };
    });
    const validate = runAnnotationsSide(corruptedAnn);
    expect(outcomesAgree(interpret(PASSING), validate(PASSING))).toBe(false);
    // Sanity: the uncorrupted artifact agrees, so the disagreement above is
    // the plant, not a real divergence — and the instance actually produces
    // annotations (the plant is not vacuous).
    const honest = runAnnotationsSide((x) => annArtifact.evaluateList(x));
    expect(outcomesAgree(interpret(PASSING), honest(PASSING))).toBe(true);
    expect(
      annArtifact.evaluateList(PASSING).annotations!.length,
    ).toBeGreaterThan(0);
  });

  it("the same corruption slips past the FLAG and plain LIST comparisons", () => {
    const { engine, uri, corruptedAnn } = buildAnn();
    const flagInterpret = runSide((x) => engine.evaluate(uri, x).valid);
    const flagValidate = runSide((x) => corruptedAnn(x).valid);
    expect(outcomesAgree(flagInterpret(PASSING), flagValidate(PASSING))).toBe(
      true,
    );
    // Plain LIST encoding: verdict + errors only — the annotation channel
    // never enters its payload, so the plant is invisible.
    const listInterpret = runListSide((x) => {
      const r = engine.evaluate(uri, x, { output: "list" });
      return { valid: r.valid, errors: r.errors ?? [] };
    });
    const listValidate = runListSide((x) => {
      const r = corruptedAnn(x);
      return { valid: r.valid, errors: r.errors };
    });
    expect(outcomesAgree(listInterpret(PASSING), listValidate(PASSING))).toBe(
      true,
    );
  });
});
