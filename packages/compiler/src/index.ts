// @jse/compiler public API (M6.2 vertical slice): compile a registered
// schema into a specialized flag-mode validator. Static subschemas become
// emitted JS; dynamic islands and every fallback cause trampoline to the
// interpreter through core's evaluateFragment, so the compiled artifact is
// exactly as correct as the interpreter — never less complete.

import { DEFAULT_MAX_DEPTH, type Engine, type JsonValue } from "@jse/core";
import { buildPlan, type CompilationPlan } from "./plan.js";
import { serializePlan } from "./serialize.js";
import { makeRuntime } from "./runtime.js";
import { instantiate, type CompiledValidate } from "./runtime-compile.js";

export type { CompilationPlan, PlannedUnit, FallbackCause } from "./plan.js";
export { buildPlan } from "./plan.js";
export { serializePlan } from "./serialize.js";

/** Options for {@link compileValidator}. */
export interface CompileOptions {
  /** depth bound shared between compiled nesting and fragments; default core's */
  maxDepth?: number;
}

/** A compiled artifact: the validator plus its plan and source (inspection/tests). */
export interface CompiledArtifact {
  validate: CompiledValidate;
  plan: CompilationPlan;
  source: string;
}

/**
 * Compile a registered schema into a flag-mode validator. The artifact
 * binds to the engine's registry and pattern cache at compile time; schemas
 * registered later are not visible to it.
 */
export function compileValidator(
  engine: Engine,
  schemaUri: string,
  options: CompileOptions = {},
): CompiledArtifact {
  const plan = buildPlan(engine, schemaUri);
  const source = serializePlan(plan, engine.registry);
  const runtime = makeRuntime(
    engine.registry,
    engine.patternCache,
    plan.patterns,
    options.maxDepth ?? DEFAULT_MAX_DEPTH,
  );
  const validate = instantiate(
    source,
    runtime,
    plan.targets.map((t) => t.ref),
  );
  return {
    validate: (instance: JsonValue) => validate(instance),
    plan,
    source,
  };
}
