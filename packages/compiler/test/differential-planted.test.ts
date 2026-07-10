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
import { outcomesAgree, runListSide, runSide } from "@jse/test-kit";

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
