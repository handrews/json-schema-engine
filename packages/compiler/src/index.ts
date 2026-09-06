// @jse/compiler public API (M6.2 vertical slice): compile a registered
// schema into a specialized flag-mode validator. Static subschemas become
// emitted JS; dynamic islands and every fallback cause trampoline to the
// interpreter through core's evaluateFragment, so the compiled artifact is
// exactly as correct as the interpreter — never less complete.

import {
  DEFAULT_MAX_DEPTH,
  type AnnotationSelection,
  type AnnotationUnit,
  type BasicAnnotationUnit,
  type BasicOutputDocument,
  type Engine,
  type ErrorUnit,
  type JsonValue,
} from "@jse/core";
import { buildPlan, type CompilationPlan } from "./plan.js";
import { serializePlan } from "./serialize/index.js";
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
export { serializePlan } from "./serialize/index.js";
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
   * Include `keyword`, `vocabulary`, and structured `params` on each error
   * unit, matching the interpreter's `errorParams` option on `list` output
   * (D13).
   */
  errorParams?: boolean;
  /**
   * Which annotations to collect, matching the interpreter's `annotations`
   * option: `true` or a selection makes `evaluateList` return an
   * `annotations` array on valid instances and `basic()` render the Basic
   * document's annotation side. A selection's allow/deny lists are
   * specialized into the artifact at compile time; its `keep` predicate runs
   * at evaluation.
   */
  annotations?: boolean | AnnotationSelection;
}

/** A compiled list-mode result: interpreter-exact flat error units, plus annotations when collected. */
export interface CompiledListResult {
  valid: boolean;
  errors: ErrorUnit[];
  /**
   * Present on valid instances when compiled with `annotations` (absent on
   * invalid ones, matching `Engine.evaluate`'s valid-only annotation
   * contract); always absent otherwise.
   */
  annotations?: AnnotationUnit[];
}

/** A compiled list-mode artifact (see {@link compileList}). */
export interface CompiledListArtifact {
  /** evaluate with full error collection ({@link CompiledListResult}) */
  evaluateList(instance: JsonValue): CompiledListResult;
  /**
   * The same result as the Basic document (IETF draft-03 §13.4.2), matching
   * `Engine.evaluate(uri, x, { output: "basic" }).outputDocument`: the flat
   * `errors` array on invalid instances; on valid instances compiled with
   * `annotations`, the selected annotations, present only when non-empty.
   */
  basic(instance: JsonValue): BasicOutputDocument;
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
 * binds to a snapshot of the engine's schema and dialect registries taken at
 * compile time, plus the engine's pattern cache: schemas registered,
 * re-registered, or given a new dialect later are invisible to it, and a
 * reference unresolved at compile time stays unresolved for it (E1).
 */
export function compileValidator(
  engine: Engine,
  schemaUri: string,
  options: CompileOptions = {},
): CompiledArtifact {
  const plan = buildPlan(engine, schemaUri);
  // Compilation is synchronous, so the plan (built from the live registry)
  // and this snapshot see one state; the artifact's islands never see a
  // later registration.
  const registry = engine.registry.snapshot();
  const source = serializePlan(
    plan,
    registry,
    "runtime",
    options.conservative
      ? { inline: false, plainData: false }
      : { inline: true, plainData: true },
  );
  const runtime = makeRuntime(
    registry,
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
 * Error-unit objects materialize only on failure paths. Binds to registry
 * snapshots exactly like {@link compileValidator}.
 */
export function compileList(
  engine: Engine,
  schemaUri: string,
  options: ListCompileOptions = {},
): CompiledListArtifact {
  const selection = options.annotations ?? false;
  const collect = selection !== false;
  const errorParams = options.errorParams ?? false;
  const plan = buildPlan(engine, schemaUri, { output: "list" });
  const registry = engine.registry.snapshot();
  const source = serializePlan(
    plan,
    registry,
    "runtime",
    options.conservative
      ? { inline: false, plainData: false }
      : { inline: true, plainData: true },
    "list",
    errorParams,
    collect ? { selection } : undefined,
  );
  const runtime = makeRuntime(
    registry,
    engine.patternCache,
    plan.patterns,
    options.maxDepth ?? DEFAULT_MAX_DEPTH,
    errorParams,
    collect ? { selection } : undefined,
    engine.formats,
    plan.formats,
  );
  const targets = plan.targets.map((t) => t.ref);
  const root = registry.rootRef(schemaUri);
  const rootLocation = `${root.baseUri}#${root.pointer}`;
  const keep = typeof selection === "object" ? selection.keep : undefined;

  if (!collect) {
    const evaluateList = instantiateList<ErrorUnit>(source, runtime, targets);
    return {
      evaluateList,
      basic: (instance) => {
        const { valid, errors } = evaluateList(instance);
        const doc: BasicOutputDocument = {
          valid,
          keywordLocation: "",
          absoluteKeywordLocation: rootLocation,
          instanceLocation: "",
        };
        if (!valid) doc.errors = errors.map(toBasicError);
        return doc;
      },
      plan,
      source,
    };
  }

  // The emitted evaluator returns the raw (static-list-filtered) annotation
  // array; the wrapper applies `keep` (over the native unit, as the
  // interpreter does) and the valid-only presence rule, matching
  // `Engine.evaluate`'s Result.annotations; `basic()` then re-projects the
  // survivors to the Basic document's field names.
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
      const doc: BasicOutputDocument = {
        valid: r.valid,
        keywordLocation: "",
        absoluteKeywordLocation: rootLocation,
        instanceLocation: "",
      };
      if (!r.valid) {
        doc.errors = r.errors.map(toBasicError);
        return doc;
      }
      const anns = keep ? r.annotations.filter(keep) : r.annotations;
      if (anns.length > 0) doc.annotations = anns.map(toBasicAnnotation);
      return doc;
    },
    plan,
    source,
  };
}

// Re-projections of native units to the Basic document's field names, key
// order matching core's renderBasic.
const toBasicError = (
  e: ErrorUnit,
): NonNullable<BasicOutputDocument["errors"]>[number] => ({
  keywordLocation: e.evaluationPath,
  absoluteKeywordLocation: e.schemaLocation,
  instanceLocation: e.inputLocation,
  error: e.error,
});

const toBasicAnnotation = (u: AnnotationUnit): BasicAnnotationUnit => ({
  keywordLocation: u.evaluationPath,
  absoluteKeywordLocation: u.schemaLocation,
  instanceLocation: u.inputLocation,
  annotation: u.annotation,
});
