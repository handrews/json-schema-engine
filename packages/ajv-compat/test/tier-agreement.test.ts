// assertTierAgreement guards the flag/list split in makeValidate (index.ts):
// the flag tier decides pass/fail, the list tier supplies error detail on
// failure, and the two must never disagree about whether there IS an
// error to report. The disagreement itself can't be provoked from outside
// makeValidate (it would require the compiler to actually produce
// inconsistent tiers), so this exercises the extracted guard directly.

import { describe, it, expect } from "vitest";
import { assertTierAgreement } from "../src/index.js";

describe("assertTierAgreement", () => {
  it("throws when the flag tier says invalid but the list tier has no errors", () => {
    expect(() => {
      assertTierAgreement(false, []);
    }).toThrow(/tier-agreement/);
  });

  it("does not throw when invalid and the list tier reports errors", () => {
    expect(() => {
      assertTierAgreement(false, [{ keyword: "type" }]);
    }).not.toThrow();
  });

  it("does not throw when valid, regardless of the errors array", () => {
    expect(() => {
      assertTierAgreement(true, []);
    }).not.toThrow();
    expect(() => {
      assertTierAgreement(true, [{ keyword: "type" }]);
    }).not.toThrow();
  });
});
