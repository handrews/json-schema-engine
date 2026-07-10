// @jse/compiler public API (M6.2 vertical slice): compile a registered
// schema into a specialized flag-mode validator. Static subschemas become
// emitted JS; dynamic islands and every fallback cause trampoline to the
// interpreter through core's evaluateFragment, so the compiled artifact is
// exactly as correct as the interpreter — never less complete.

import {
  DEFAULT_MAX_DEPTH,
  type Engine,
  type ErrorUnit,
  type JsonValue,
} from "@jse/core";
import { buildPlan, type CompilationPlan } from "./plan.js";
import { serializePlan } from "./serialize.js";
import { makeRuntime } from "./runtime.js";
import {
  instantiate,
  instantiateList,
  type CompiledValidate,
} from "./runtime-compile.js";

export type { CompilationPlan, PlannedUnit, FallbackCause } from "./plan.js";
export { buildPlan } from "./plan.js";
export { explainCompilation } from "./explain.js";
export type { CompilationExplanation } from "./explain.js";
export { serializePlan } from "./serialize.js";
export { emitStandalone, StandaloneUnsupportedError } from "./standalone.js";
export type { StandaloneOptions } from "./standalone.js";

/** Options for {@link compileValidator}. */
export interface CompileOptions {
  /** depth bound shared between compiled nesting and fragments; default core's */
  maxDepth?: number;
  /**
   * Disable the D9 optimizations (inlining, plain-data fast paths). Exists
   * so the differential fuzzer referees both configurations; not a
   * user-facing tuning knob.
   */
  conservative?: boolean;
}

/** Options for {@link compileList}. */
export interface ListCompileOptions extends CompileOptions {
  /**
   * Include `keyword` + structured `params` on each error unit, matching
   * `Engine.evaluate(uri, x, { output: "list", errorParams: true })` (D13).
   */
  errorParams?: boolean;
}

/** A compiled list-mode result: interpreter-exact flat error units. */
export interface CompiledListResult {
  valid: boolean;
  errors: ErrorUnit[];
}

/** A compiled list-mode artifact (see {@link compileList}). */
export interface CompiledListArtifact {
  /** evaluate with full error collection ({@link CompiledListResult}) */
  evaluateList(instance: JsonValue): CompiledListResult;
  /**
   * The same result renamed to the 2020-12 Basic document field names.
   * Matches the interpreter's Basic document exactly for INVALID instances;
   * valid ones omit `annotations` (compiled annotation collection is out of
   * scope — DESIGN §7 — use the interpreter when annotations are needed).
   */
  basic(instance: JsonValue): {
    valid: boolean;
    keywordLocation: string;
    absoluteKeywordLocation: string;
    instanceLocation: string;
    errors?: {
      keywordLocation: string;
      absoluteKeywordLocation: string;
      instanceLocation: string;
      error: string;
    }[];
  };
  plan: CompilationPlan;
  source: string;
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
  const source = serializePlan(
    plan,
    engine.registry,
    "runtime",
    options.conservative
      ? { inline: false, plainData: false }
      : { inline: true, plainData: true },
  );
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

/**
 * Compile a registered schema into a list-output validator (D9e): flat,
 * interpreter-exact error units — the same elements
 * `Engine.evaluate(uri, x, { output: "list" }).errors` yields, in the same
 * order (list artifacts never short-circuit; every branch runs, DESIGN §7).
 * Error-unit objects materialize only on failure paths.
 */
export function compileList(
  engine: Engine,
  schemaUri: string,
  options: ListCompileOptions = {},
): CompiledListArtifact {
  const plan = buildPlan(engine, schemaUri, { output: "list" });
  const source = serializePlan(
    plan,
    engine.registry,
    "runtime",
    options.conservative
      ? { inline: false, plainData: false }
      : { inline: true, plainData: true },
    "list",
    options.errorParams ?? false,
  );
  const runtime = makeRuntime(
    engine.registry,
    engine.patternCache,
    plan.patterns,
    options.maxDepth ?? DEFAULT_MAX_DEPTH,
    options.errorParams ?? false,
  );
  const evaluateList = instantiateList<ErrorUnit>(
    source,
    runtime,
    plan.targets.map((t) => t.ref),
  );
  const root = engine.registry.rootRef(schemaUri);
  const rootLocation = `${root.baseUri}#${root.pointer}`;
  return {
    evaluateList,
    basic: (instance) => {
      const { valid, errors } = evaluateList(instance);
      const doc: ReturnType<CompiledListArtifact["basic"]> = {
        valid,
        keywordLocation: "",
        absoluteKeywordLocation: rootLocation,
        instanceLocation: "",
      };
      if (!valid) {
        doc.errors = errors.map((e) => ({
          keywordLocation: e.evaluationPath!,
          absoluteKeywordLocation: e.schemaLocation!,
          instanceLocation: e.instanceLocation,
          error: e.error,
        }));
      }
      return doc;
    },
    plan,
    source,
  };
}
