// @jse/compiler public API (M6.2 vertical slice): compile a registered
// schema into a specialized flag-mode validator. Static subschemas become
// emitted JS; dynamic islands and every fallback cause trampoline to the
// interpreter through core's evaluateFragment, so the compiled artifact is
// exactly as correct as the interpreter — never less complete.

import {
  DEFAULT_MAX_DEPTH,
  type AnnotationUnit,
  type Engine,
  type ErrorUnit,
  type JsonValue,
  type RetentionPolicy,
} from "@jse/core";
import { buildPlan, type CompilationPlan } from "./plan.js";
import { serializePlan } from "./serialize.js";
import { makeRuntime } from "./runtime.js";
import {
  instantiate,
  instantiateList,
  instantiateListAnn,
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
  /**
   * Collect annotations, matching the interpreter's list output under
   * `collectAnnotations: true`: `evaluateList` gains an `annotations` array on
   * valid instances and `basic()` gains the Basic document's annotation side.
   */
  collectAnnotations?: boolean;
  /**
   * Retention policy for collected annotations (D5). Allow/deny lists are
   * specialized into the artifact at compile time; the `keep` predicate runs
   * at evaluation. Ignored unless `collectAnnotations` is set.
   */
  retention?: RetentionPolicy;
}

/** A compiled list-mode result: interpreter-exact flat error units, plus annotations when collected. */
export interface CompiledListResult {
  valid: boolean;
  errors: ErrorUnit[];
  /**
   * Present on valid instances when compiled with `collectAnnotations`
   * (absent on invalid ones, matching `Engine.evaluate`'s valid-only
   * annotation contract); always absent otherwise.
   */
  annotations?: AnnotationUnit[];
}

/** A compiled list-mode artifact (see {@link compileList}). */
export interface CompiledListArtifact {
  /** evaluate with full error collection ({@link CompiledListResult}) */
  evaluateList(instance: JsonValue): CompiledListResult;
  /**
   * The same result renamed to the 2020-12 Basic document field names. On
   * invalid instances it carries the flat `errors` array; on valid instances
   * compiled with `collectAnnotations`, the `annotations` array (2020-12
   * field names, `keep`-filtered), present only when non-empty — matching the
   * interpreter's `renderBasic`.
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
    annotations?: AnnotationUnit[];
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
    false,
    undefined,
    engine.formats,
    plan.formats,
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
  const collect = options.collectAnnotations ?? false;
  const errorParams = options.errorParams ?? false;
  const retention = collect ? options.retention : undefined;
  const plan = buildPlan(engine, schemaUri, { output: "list" });
  const source = serializePlan(
    plan,
    engine.registry,
    "runtime",
    options.conservative
      ? { inline: false, plainData: false }
      : { inline: true, plainData: true },
    "list",
    errorParams,
    collect ? { retention } : undefined,
  );
  const runtime = makeRuntime(
    engine.registry,
    engine.patternCache,
    plan.patterns,
    options.maxDepth ?? DEFAULT_MAX_DEPTH,
    errorParams,
    collect ? { retention } : undefined,
    engine.formats,
    plan.formats,
  );
  const targets = plan.targets.map((t) => t.ref);
  const root = engine.registry.rootRef(schemaUri);
  const rootLocation = `${root.baseUri}#${root.pointer}`;
  const keep = retention?.keep;

  if (!collect) {
    const evaluateList = instantiateList<ErrorUnit>(source, runtime, targets);
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

  // The emitted evaluator returns the raw (static-list-filtered) annotation
  // array; the wrapper applies `keep` and the valid-only presence rule,
  // matching `Engine.evaluate`'s Result.annotations. `basic()` re-projects to
  // the 2020-12 field names and applies `keep` over those (renderBasic's
  // vocabulary is "2020-12"), so a keep predicate sees the shape it will in
  // each surface.
  const rawEval = instantiateListAnn<ErrorUnit>(source, runtime, targets);
  return {
    evaluateList: (instance): CompiledListResult => {
      const r = rawEval(instance);
      if (!r.valid) return { valid: false, errors: r.errors };
      const anns = keep ? r.annotations.filter(keep) : r.annotations;
      return { valid: true, errors: r.errors, annotations: anns };
    },
    basic: (instance) => {
      const r = rawEval(instance);
      const doc: ReturnType<CompiledListArtifact["basic"]> = {
        valid: r.valid,
        keywordLocation: "",
        absoluteKeywordLocation: rootLocation,
        instanceLocation: "",
      };
      if (!r.valid) {
        doc.errors = r.errors.map((e) => ({
          keywordLocation: e.evaluationPath!,
          absoluteKeywordLocation: e.schemaLocation!,
          instanceLocation: e.instanceLocation,
          error: e.error,
        }));
        return doc;
      }
      let mapped = r.annotations.map(annToBasic);
      if (keep) mapped = mapped.filter(keep);
      if (mapped.length > 0) doc.annotations = mapped;
      return doc;
    },
    plan,
    source,
  };
}

/**
 * Re-project a modern-shaped annotation unit to the 2020-12 Basic field names,
 * key order matching `renderAnnotation(_, "2020-12")` (keyword, vocabulary?,
 * keywordLocation, absoluteKeywordLocation, instanceLocation, annotation).
 */
function annToBasic(u: AnnotationUnit): AnnotationUnit {
  return {
    keyword: u.keyword,
    ...(u.vocabulary !== undefined ? { vocabulary: u.vocabulary } : {}),
    keywordLocation: u.evaluationPath,
    absoluteKeywordLocation: u.schemaLocation,
    instanceLocation: u.instanceLocation,
    annotation: u.annotation,
  };
}
