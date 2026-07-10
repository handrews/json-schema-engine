// Coverage configuration ONLY — test discovery stays on vitest defaults
// (the exactRun suite pins prove the case set is unchanged by this file's
// existence). Instrumentation scope: the compiler and the ajv-compat
// adapter, the two packages whose correctness is NOT conformance-driven
// line by line — core's lines are exercised by construction through the
// official suites, so thresholds there would be maintenance without
// signal (deferred-register decision). Run via `npm run coverage`;
// deliberately not part of `npm test`/`verify` — v8 instrumentation taxes
// the fuzz-heavy suite.

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      include: ["packages/compiler/src/**", "packages/ajv-compat/src/**"],
      reporter: ["text", "json-summary"],
    },
  },
});
