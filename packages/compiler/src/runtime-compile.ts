// The ONLY module that materializes code at runtime (D10 runtime mode).
// Confining `new Function` here keeps the CSP story auditable: everything
// else, including the interpreter, is greppably free of code generation.
// Standalone source emission (M6.5) bypasses this module entirely.

import type { JsonValue, SchemaRef } from "@jse/core";
import type { Runtime } from "./runtime.js";

/** A compiled flag-mode validator. */
export type CompiledValidate = (instance: JsonValue) => boolean;

/** Instantiate artifact source against its runtime closure and target table. */
export function instantiate(
  source: string,
  runtime: Runtime,
  targets: readonly SchemaRef[],
): CompiledValidate {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const factory = new Function("R", "T", source) as (
    R: Runtime,
    T: readonly SchemaRef[],
  ) => CompiledValidate;
  return factory(runtime, targets);
}
