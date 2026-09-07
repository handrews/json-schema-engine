// Planted-divergence self-test (testing-lessons hardening): proves the
// fuzz legs' comparisons can detect what they claim to referee. A
// deliberately corrupted compiled side — wrong error params, verdict
// untouched — must trip the LIST comparison and slip past the FLAG
// comparison. The original FUZZ_LIST bug was a list leg that silently ran
// the flag comparison: under it, this planted corruption was invisible,
// so this test is the gate that would have caught the gate.

import { describe, it, expect } from "vitest";
import { createEngine, type JsonValue, type Result } from "@jse/core";
import { compileEvaluator, compileList, compileValidator } from "@jse/compiler";
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

// Structured-comparison plant: the located tree's SHAPE (branch order)
// corrupted, verdict and the flat errors/annotations untouched — visible
// only to a comparison that encodes the WHOLE Result, never to the flat
// { valid, errors } projection the plain LIST comparison uses (that
// projection has no channel for the tree at all). Proves the structured
// (hierarchical/trace) comparison referees something the list leg
// structurally cannot.
const ANYOF_SCHEMA = { anyOf: [{ type: "string" }, { type: "number" }] };
const ANYOF_INSTANCE = "s" as JsonValue;

describe("planted structured divergence: only a structured comparison sees it", () => {
  it("reversed trace.children slips past the flat LIST comparison, catches on the whole Result", () => {
    const engine = createEngine();
    const uri = engine.registerSchema(
      ANYOF_SCHEMA,
      "https://planted.example/structured",
    );
    const result = engine.evaluate(uri, ANYOF_INSTANCE, {
      output: "hierarchical",
      trace: true,
      annotations: true,
      errorParams: true,
    });
    // Sanity: anyOf never short-circuits (engine.ts runs every branch), so
    // both branches produced a trace child to reverse — the plant below
    // isn't vacuous.
    expect(result.trace.children).toHaveLength(2);

    const corrupted: Result = {
      ...result,
      trace: {
        ...result.trace,
        children: [...result.trace.children].reverse(),
      },
    };

    // The plain list projection carries no trace at all, so the reordering
    // is structurally invisible to it.
    const listProject = (r: Result) => ({
      valid: r.valid,
      errors: r.errors ?? [],
    });
    expect(
      outcomesAgree(
        runListSide(() => listProject(result))(ANYOF_INSTANCE),
        runListSide(() => listProject(corrupted))(ANYOF_INSTANCE),
      ),
    ).toBe(true);

    // The whole Result — trace included — is what a structured comparison
    // encodes, and it does see the reordering.
    expect(
      outcomesAgree(
        runListSide(() => result)(ANYOF_INSTANCE),
        runListSide(() => corrupted)(ANYOF_INSTANCE),
      ),
    ).toBe(false);

    // The uncorrupted evaluator agrees with the interpreter's Result under
    // that same whole-Result encoding: the structured comparison isn't only
    // sensitive to corruption, it's correct on the honest artifact too.
    const evaluator = compileEvaluator(engine, uri, {
      errorParams: true,
      annotations: true,
    });
    const compiled = evaluator.evaluate(ANYOF_INSTANCE, {
      output: "hierarchical",
      trace: true,
    });
    expect(
      outcomesAgree(
        runListSide(() => result)(ANYOF_INSTANCE),
        runListSide(() => compiled)(ANYOF_INSTANCE),
      ),
    ).toBe(true);
  });
});
