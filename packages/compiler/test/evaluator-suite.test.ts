// Compiled-evaluator gate suite: `compileEvaluator` renders every output
// format from one recorded application tree (index.ts), so — unlike
// `compileList`'s single flat surface — its differential has to prove
// parity across the whole render-time surface: six option sets, thrown
// errors, and the render-time control rejections (ADR 0003: an unsupported
// combination is refused, never silently ignored). The comparison formula
// (`interpreterFor`) makes the compile-time selection stand in for the
// interpreter's `annotations`/`errorParams` options — the render-time
// options replay as-is — because a compiled evaluator fixes that selection
// at compile time and rejects it at evaluate time.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createEngine,
  DIALECT_2019_09,
  DIALECT_DRAFT_07,
  DIALECT_DRAFT_06,
  MaxDepthExceededError,
  OutputOptionsError,
  type AnnotationSelection,
  type Engine,
  type JsonValue,
  type ListOutputDocument,
  type OutputUnit,
  type Result,
  type TraceUnit,
} from "@jse/core";
import {
  compileEvaluator,
  compileList,
  type CompilationPlan,
  type CompiledEvaluator,
  type EvaluatorCompileOptions,
  type EvaluatorOptions,
  type PlannedUnit,
} from "@jse/compiler";
import { registerDraft04, DIALECT_DRAFT_04 } from "@jse/dialect-draft04";
import { suiteRemotesLoader } from "@jse/test-kit";

const SUITE_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "test-suite",
);
const REMOTES = join(SUITE_ROOT, "remotes");
const BENCH_CORPORA = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "bench",
  "corpora",
);

interface SuiteGroup {
  description: string;
  schema: JsonValue;
  tests: { description: string; data: JsonValue }[];
}

// ---------------------------------------------------------------------------
// The comparison contract. `interpreterFor` is the one place that applies
// it — every leg below calls it rather than re-deriving the rule.
// ---------------------------------------------------------------------------

interface CompiledSelection {
  annotations: boolean | AnnotationSelection;
  errorParams: boolean;
}

/**
 * `artifact.evaluate(x, o)` must match `engine.evaluate` given the same
 * render-time options `o`, with the artifact's fixed compile-time selection
 * substituted for `annotations`/`errorParams` — except the flag set, which
 * carries no records (D5/ADR 0003) and so cannot see that selection: there,
 * `evaluate` calls the bare interpreter, matching `CompiledEvaluator`'s own
 * flag-path answer of exactly `{ valid }`.
 */
function interpreterFor(
  engine: Engine,
  uri: string,
  compiled: CompiledSelection,
): (x: JsonValue, o?: EvaluatorOptions) => Result {
  return (x, o = {}) => {
    if (o.output === undefined || o.output === "flag") {
      return engine.evaluate(uri, x);
    }
    return engine.evaluate(uri, x, {
      ...o,
      annotations: compiled.annotations,
      errorParams: compiled.errorParams,
    });
  };
}

const OPTION_SETS: readonly { name: string; options: EvaluatorOptions }[] = [
  { name: "flag", options: {} },
  { name: "basic", options: { output: "basic" } },
  { name: "list", options: { output: "list" } },
  { name: "hierarchical", options: { output: "hierarchical" } },
  { name: "detailed", options: { output: "detailed" } },
  { name: "list+trace", options: { output: "list", trace: true } },
];

// ---------------------------------------------------------------------------
// Generic value-level and throw-level comparison. `resultDivergence` is a
// pure structural diff (used standalone by Leg 4's planted-corruption
// self-test); `attempt`/`outcomeDivergence` add throw parity around it for
// the sweeps and the curated legs.
// ---------------------------------------------------------------------------

function typeLabel(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

/**
 * First differing JSON path between two values, or null when they agree.
 * Key-set-sensitive — a present-but-undefined property is not the same as
 * an absent one, `toStrictEqual`'s rule — and array-order-strict, since
 * order (error order, trace order, detail order) is exactly what several
 * legs below are proving.
 */
function resultDivergence(a: unknown, b: unknown, path = "$"): string | null {
  if (a === undefined && b === undefined) return null;
  if (Object.is(a, b)) return null;
  const ta = typeLabel(a);
  const tb = typeLabel(b);
  if (ta !== tb) {
    return `${path}: ${ta} vs ${tb} (${JSON.stringify(a)} vs ${JSON.stringify(b)})`;
  }
  if (ta === "array") {
    const aa = a as unknown[];
    const bb = b as unknown[];
    if (aa.length !== bb.length) {
      return `${path}.length: ${String(aa.length)} vs ${String(bb.length)}`;
    }
    for (let i = 0; i < aa.length; i++) {
      const d = resultDivergence(aa[i], bb[i], `${path}[${String(i)}]`);
      if (d !== null) return d;
    }
    return null;
  }
  if (ta === "object") {
    const ao = a as Record<string, unknown>;
    const bo = b as Record<string, unknown>;
    const keysA = Object.keys(ao).filter((k) => ao[k] !== undefined);
    const remaining = new Set(
      Object.keys(bo).filter((k) => bo[k] !== undefined),
    );
    for (const k of keysA) {
      if (!remaining.has(k)) {
        return `${path}.${k}: present on the interpreter side only`;
      }
      remaining.delete(k);
    }
    if (remaining.size > 0) {
      return `${path}.${[...remaining][0]!}: present on the compiled side only`;
    }
    for (const k of keysA) {
      const d = resultDivergence(ao[k], bo[k], `${path}.${k}`);
      if (d !== null) return d;
    }
    return null;
  }
  return `${path}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`;
}

interface Attempt<T> {
  threw: string | null;
  value: T | undefined;
}

function attempt<T>(fn: () => T): Attempt<T> {
  try {
    return { threw: null, value: fn() };
  } catch (err) {
    return { threw: (err as Error).constructor.name, value: undefined };
  }
}

function outcomeDivergence(
  interp: Attempt<Result>,
  compiled: Attempt<Result>,
): string | null {
  if (interp.threw !== null || compiled.threw !== null) {
    return interp.threw === compiled.threw
      ? null
      : `throw parity: interpreter threw ${String(interp.threw)}, ` +
          `compiled threw ${String(compiled.threw)}`;
  }
  return resultDivergence(interp.value, compiled.value);
}

function countTraceNodes(node: TraceUnit): number {
  let count = 1;
  for (const child of node.children) count += countTraceNodes(child);
  return count;
}

// ---------------------------------------------------------------------------
// Leg 1 / Leg 2 / Leg 3 — full-suite and combined-selection sweeps, sharing
// one sweep function: compile one evaluator per group, replay every
// instance across the requested option sets, and total the pinned counts
// only over agreeing cases (a divergence is reported, not folded into a
// total that would then mean nothing).
// ---------------------------------------------------------------------------

interface DialectPin {
  dir: string;
  defaultDialect?: string;
  setup?: (engine: Engine) => void;
  groups: number;
  skippedGroups: number;
  instances: number;
  traceNodes: number;
  detailsUnits: number;
}

// Instance totals equal the Bowtie/exactRun conformance pins per dialect
// (1299/1259/927/839/618) — nothing this gate sweeps escapes it. Transcribed
// from a local run (deterministic — two runs agree).
const SWEEP: Record<string, DialectPin> = {
  "draft2020-12": {
    dir: "draft2020-12",
    groups: 383,
    skippedGroups: 0,
    instances: 1299,
    traceNodes: 3772,
    detailsUnits: 893,
  },
  "draft2019-09": {
    dir: "draft2019-09",
    defaultDialect: DIALECT_2019_09,
    groups: 372,
    skippedGroups: 0,
    instances: 1259,
    traceNodes: 3722,
    detailsUnits: 903,
  },
  draft7: {
    dir: "draft7",
    defaultDialect: DIALECT_DRAFT_07,
    groups: 257,
    skippedGroups: 0,
    instances: 927,
    traceNodes: 2044,
    detailsUnits: 573,
  },
  draft6: {
    dir: "draft6",
    defaultDialect: DIALECT_DRAFT_06,
    groups: 232,
    skippedGroups: 0,
    instances: 839,
    traceNodes: 1879,
    detailsUnits: 519,
  },
  draft4: {
    dir: "draft4",
    defaultDialect: DIALECT_DRAFT_04,
    setup: registerDraft04,
    groups: 160,
    skippedGroups: 0,
    instances: 618,
    traceNodes: 1412,
    detailsUnits: 368,
  },
};

interface SweepOutcome {
  groups: number;
  skippedGroups: number;
  instances: number;
  traceNodes: number;
  detailsUnits: number;
  annotationUnits: number;
  divergences: string[];
}

async function sweepDialect(
  pin: Pick<DialectPin, "dir" | "defaultDialect" | "setup">,
  compileOptions: EvaluatorCompileOptions,
  optionSets: readonly {
    name: string;
    options: EvaluatorOptions;
  }[] = OPTION_SETS,
): Promise<SweepOutcome> {
  const suiteDir = join(SUITE_ROOT, "tests", pin.dir);
  const files = readdirSync(suiteDir)
    .filter((f) => f.endsWith(".json"))
    .sort();
  let groups = 0;
  let skippedGroups = 0;
  let instances = 0;
  let traceNodes = 0;
  let detailsUnits = 0;
  let annotationUnits = 0;
  const divergences: string[] = [];
  for (const file of files) {
    const fileGroups = JSON.parse(
      readFileSync(join(suiteDir, file), "utf8"),
    ) as SuiteGroup[];
    for (let gi = 0; gi < fileGroups.length; gi++) {
      const group = fileGroups[gi]!;
      const engine = createEngine({
        loaders: [suiteRemotesLoader(REMOTES)],
        ...(pin.defaultDialect === undefined
          ? {}
          : { defaultDialect: pin.defaultDialect }),
      });
      pin.setup?.(engine);
      let uri: string;
      let evaluator: CompiledEvaluator;
      try {
        uri = await engine.loadSchema(
          group.schema,
          `https://eval-suite.example/${pin.dir}/${file}/${String(gi)}`,
        );
        evaluator = compileEvaluator(engine, uri, compileOptions);
      } catch {
        skippedGroups++;
        continue;
      }
      groups++;
      const interp = interpreterFor(engine, uri, {
        annotations: compileOptions.annotations ?? false,
        errorParams: compileOptions.errorParams ?? false,
      });
      for (const test of group.tests) {
        instances++;
        const label =
          `${pin.dir}/${file}#${String(gi)} "${group.description}" / ` +
          `"${test.description}"`;
        for (const { name, options } of optionSets) {
          const iAttempt = attempt(() => interp(test.data, options));
          const cAttempt = attempt(() =>
            evaluator.evaluate(test.data, options),
          );
          const d = outcomeDivergence(iAttempt, cAttempt);
          if (d !== null) {
            divergences.push(`${label} [${name}]: ${d}`);
            continue;
          }
          if (iAttempt.threw !== null) continue;
          const result = iAttempt.value!;
          annotationUnits += result.annotations?.length ?? 0;
          if (name === "list+trace" && result.trace !== undefined) {
            traceNodes += countTraceNodes(result.trace);
          }
          if (name === "list" && result.outputDocument !== undefined) {
            detailsUnits += (result.outputDocument as ListOutputDocument)
              .details.length;
          }
        }
      }
    }
  }
  return {
    groups,
    skippedGroups,
    instances,
    traceNodes,
    detailsUnits,
    annotationUnits,
    divergences,
  };
}

function expectNoDivergences(divergences: string[], label: string): void {
  const shown = divergences.slice(0, 10);
  expect(
    shown,
    `${String(divergences.length)} divergence(s) in ${label}` +
      (divergences.length > shown.length ? " (first 10 shown)" : ""),
  ).toEqual([]);
}

const CONSERVATIVE = process.env.EVALUATOR_CONSERVATIVE === "1";

describe("Leg 1 — compiled evaluator ≡ interpreter over every dialect suite, all six option sets", () => {
  for (const [name, pin] of Object.entries(SWEEP)) {
    it(`${name} agrees on every case and matches the pinned totals`, async () => {
      const outcome = await sweepDialect(pin, {
        annotations: true,
        errorParams: true,
        ...(CONSERVATIVE ? { conservative: true } : {}),
      });
      expectNoDivergences(outcome.divergences, name);
      expect(
        {
          groups: outcome.groups,
          skippedGroups: outcome.skippedGroups,
          instances: outcome.instances,
          traceNodes: outcome.traceNodes,
          detailsUnits: outcome.detailsUnits,
        },
        `${name} sweep totals`,
      ).toEqual({
        groups: pin.groups,
        skippedGroups: pin.skippedGroups,
        instances: pin.instances,
        traceNodes: pin.traceNodes,
        detailsUnits: pin.detailsUnits,
      });
    });
  }
});

describe("Leg 2 — draft2020-12 only, evaluator compiled with annotations and errorParams off", () => {
  it("agrees on every case and matches the pinned instance total", async () => {
    const pin = SWEEP["draft2020-12"]!;
    const outcome = await sweepDialect(pin, {
      annotations: false,
      errorParams: false,
    });
    expectNoDivergences(outcome.divergences, "draft2020-12 (Leg 2)");
    expect(outcome.groups).toBe(pin.groups);
    expect(outcome.skippedGroups).toBe(pin.skippedGroups);
    expect(outcome.instances).toBe(pin.instances);
  });
});

const META_DATA_VOCAB = "https://json-schema.org/draft/2020-12/vocab/meta-data";
const LEG3_SELECTION: AnnotationSelection = {
  vocabularies: [META_DATA_VOCAB],
  excludeKeywords: ["description"],
  keep: (u) => u.inputLocation !== "/skip",
};
const HIER_AND_TRACE = OPTION_SETS.filter(
  (o) => o.name === "hierarchical" || o.name === "list+trace",
);
// Transcribed from a local run (deterministic — two runs agree).
const LEG3_ANNOTATION_UNITS = 56;

describe("Leg 3 — a combined annotation selection over the draft2020-12 suite", () => {
  it("agrees on hierarchical and list+trace and matches the pinned annotation-unit total", async () => {
    const pin = SWEEP["draft2020-12"]!;
    const outcome = await sweepDialect(
      pin,
      { annotations: LEG3_SELECTION, errorParams: true },
      HIER_AND_TRACE,
    );
    expectNoDivergences(outcome.divergences, "draft2020-12 (Leg 3)");
    expect(outcome.groups).toBe(pin.groups);
    expect(outcome.skippedGroups).toBe(pin.skippedGroups);
    expect(outcome.instances).toBe(pin.instances);
    expect(outcome.annotationUnits).toBe(LEG3_ANNOTATION_UNITS);
  });
});

// ---------------------------------------------------------------------------
// Leg 4 — planted-corruption self-test: the gate that would catch the gate
// (the FUZZ_LIST-incident lesson). One real, traced, invalid Result is
// corrupted five distinct ways; resultDivergence must report every one, and
// the uncorrupted control must report none.
// ---------------------------------------------------------------------------

interface MutableTraceUnit {
  segments: string[];
  schemaLocation: string;
  inputLocation: string;
  valid: boolean;
  errorIndexes: number[];
  children: MutableTraceUnit[];
}

function findNodeWithErrors(node: MutableTraceUnit): MutableTraceUnit | null {
  if (node.errorIndexes.length > 0) return node;
  for (const child of node.children) {
    const found = findNodeWithErrors(child);
    if (found !== null) return found;
  }
  return null;
}

const LEG4_SCHEMA: JsonValue = {
  properties: {
    a: { anyOf: [{ type: "integer" }, { type: "string", minLength: 5 }] },
    b: { type: "boolean" },
  },
};
const LEG4_INSTANCE: JsonValue = { a: "x", b: 1 };

describe("Leg 4 — planted corruptions are reported by resultDivergence", () => {
  const engine = createEngine();
  const uri = engine.registerSchema(
    LEG4_SCHEMA,
    "https://eval-suite.example/leg4/corruption",
  );
  const real = engine.evaluate(uri, LEG4_INSTANCE, {
    output: "hierarchical",
    trace: true,
  });

  it("the fixture is invalid with enough structure for every corruption to be distinct", () => {
    expect(real.valid).toBe(false);
    expect(real.trace.children.length).toBeGreaterThanOrEqual(2);
    expect((real.errors ?? []).length).toBeGreaterThanOrEqual(3);
  });

  it("reports swapped trace.children order", () => {
    const clone = structuredClone(real);
    const trace = clone.trace as unknown as MutableTraceUnit;
    trace.children = [
      trace.children[1]!,
      trace.children[0]!,
      ...trace.children.slice(2),
    ];
    expect(resultDivergence(real, clone)).not.toBeNull();
  });

  it("reports a flipped valid on a nested details unit", () => {
    const clone = structuredClone(real);
    const doc = clone.outputDocument;
    const nested = doc.details![0]!;
    nested.valid = !nested.valid;
    expect(resultDivergence(real, clone)).not.toBeNull();
  });

  it("reports a deleted errors map on one unit", () => {
    const clone = structuredClone(real);
    const doc = clone.outputDocument;
    const nested = doc.details!.find((u: OutputUnit) => u.errors !== undefined);
    expect(nested).toBeDefined();
    delete nested!.errors;
    expect(resultDivergence(real, clone)).not.toBeNull();
  });

  it("reports reordered flat errors", () => {
    const clone = structuredClone(real);
    clone.errors = [...clone.errors!].reverse();
    expect(resultDivergence(real, clone)).not.toBeNull();
  });

  it("reports a changed errorIndexes entry", () => {
    const clone = structuredClone(real);
    const trace = clone.trace as unknown as MutableTraceUnit;
    const node = findNodeWithErrors(trace);
    expect(node).not.toBeNull();
    const errorCount = clone.errors!.length;
    node!.errorIndexes[0] = (node!.errorIndexes[0]! + 1) % errorCount;
    expect(resultDivergence(real, clone)).not.toBeNull();
  });

  it("control: an unmodified clone reports no divergence", () => {
    expect(resultDivergence(real, structuredClone(real))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Leg 5 — plan identity. compileEvaluator and compileList both build from
// buildPlan(engine, uri, { output: "list" }); a silent classification flip
// between the two would evade every differential above (an interpreted
// fallback is always correct, never wrong), so the unit-kind census, target
// order, and root must be identical.
// ---------------------------------------------------------------------------

function unitCensus(
  plan: CompilationPlan,
): Record<string, Pick<PlannedUnit, "kind" | "tracking" | "inRegion">> {
  const out: Record<
    string,
    Pick<PlannedUnit, "kind" | "tracking" | "inRegion">
  > = {};
  for (const [key, unit] of plan.units) {
    out[key] = {
      kind: unit.kind,
      tracking: unit.tracking,
      inRegion: unit.inRegion,
    };
  }
  return out;
}

function expectSamePlan(engine: Engine, uri: string): void {
  const evaluator = compileEvaluator(engine, uri);
  const list = compileList(engine, uri);
  expect(unitCensus(evaluator.plan)).toStrictEqual(unitCensus(list.plan));
  expect(evaluator.plan.targets.map((t) => t.key)).toStrictEqual(
    list.plan.targets.map((t) => t.key),
  );
  expect(evaluator.plan.rootKey).toBe(list.plan.rootKey);
}

describe("Leg 5 — compileEvaluator's plan is identical to compileList's", () => {
  it("a consumer-bearing schema plans identically", () => {
    const engine = createEngine();
    const uri = engine.registerSchema(
      {
        anyOf: [
          { properties: { a: { type: "integer" } } },
          { properties: { b: { type: "string" } } },
        ],
        unevaluatedProperties: false,
      },
      "https://eval-suite.example/leg5/consumer",
    );
    expectSamePlan(engine, uri);
  });

  it("the OAS 3.1 schema corpus plans identically", () => {
    const oasSchema = JSON.parse(
      readFileSync(join(BENCH_CORPORA, "oas-3.1-schema.json"), "utf8"),
    ) as JsonValue;
    const engine = createEngine();
    const uri = engine.registerSchema(
      oasSchema,
      "https://spec.openapis.org/oas/3.1/schema/2025-09-15",
    );
    expectSamePlan(engine, uri);
  });
});

// ---------------------------------------------------------------------------
// Leg 6 — every render-time control rejection compileEvaluator's own
// `evaluate` and `resolveOutputDemand` define (ADR 0003: no silent no-ops),
// plus the flag/basic-with-no-annotations contracts interpreterFor assumes.
// ---------------------------------------------------------------------------

const REJECTIONS: readonly { name: string; options: EvaluatorOptions }[] = [
  {
    name: "verbose:true with output:list (relevant-level only)",
    options: { output: "list", verbose: true },
  },
  {
    name: "output:verbose (the verbose level always demands retention)",
    options: { output: "verbose" },
  },
  {
    name: "an annotations key present",
    options: {
      output: "list",
      annotations: true,
    } as unknown as EvaluatorOptions,
  },
  {
    name: "an errorParams key present",
    options: {
      output: "list",
      errorParams: true,
    } as unknown as EvaluatorOptions,
  },
  {
    name: "a positions key present",
    options: {
      output: "list",
      positions: true,
    } as unknown as EvaluatorOptions,
  },
  {
    name: "an unknown output format",
    options: { output: "bogus" } as unknown as EvaluatorOptions,
  },
  {
    name: "verbose:true with output:basic",
    options: { output: "basic", verbose: true },
  },
  {
    name: "verbose:true with output:detailed",
    options: { output: "detailed", verbose: true },
  },
  {
    name: "trace:true with output:flag (default)",
    options: { trace: true },
  },
  {
    name: "trace:true with output:flag (explicit)",
    options: { output: "flag", trace: true },
  },
];

describe("Leg 6 — option rejections and the flag/annotation-less contracts", () => {
  const engine = createEngine();
  const uri = engine.registerSchema(
    { type: "integer" },
    "https://eval-suite.example/leg6/reject",
  );
  const evaluator = compileEvaluator(engine, uri, {
    annotations: true,
    errorParams: true,
  });

  for (const rejection of REJECTIONS) {
    it(`rejects ${rejection.name}`, () => {
      expect(() => evaluator.evaluate(1, rejection.options)).toThrow(
        OutputOptionsError,
      );
    });
  }

  it("evaluate(x) with no options matches the bare interpreter's { valid }", () => {
    const interp = interpreterFor(engine, uri, {
      annotations: true,
      errorParams: true,
    });
    for (const x of [1, "x"]) {
      expect(evaluator.evaluate(x)).toStrictEqual(interp(x));
    }
  });

  it("evaluate(x, { output: 'flag' }) matches the bare interpreter's { valid }", () => {
    const interp = interpreterFor(engine, uri, {
      annotations: true,
      errorParams: true,
    });
    for (const x of [1, "x"]) {
      expect(evaluator.evaluate(x, { output: "flag" })).toStrictEqual(
        interp(x, { output: "flag" }),
      );
    }
  });

  it("an annotation-less artifact's basic output matches the interpreter", () => {
    const plain = compileEvaluator(engine, uri);
    const interp = interpreterFor(engine, uri, {
      annotations: false,
      errorParams: false,
    });
    for (const x of [1, "x", 2.5]) {
      expect(plain.evaluate(x, { output: "basic" })).toStrictEqual(
        interp(x, { output: "basic" }),
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Leg 7 — curated ordering: schema shapes the official suite under-exercises
// (deeply nested anyOf, if/then/else annotation, unknown keywords, legacy
// $ref siblings, every $dynamicRef island shape), each run across every
// option set with the same interpreterFor/outcomeDivergence machinery as
// the sweeps.
// ---------------------------------------------------------------------------

interface CuratedCase {
  name: string;
  schema: JsonValue;
  instances: JsonValue[];
  compileOptions?: EvaluatorCompileOptions;
  dialect?: string;
}

function runCurated(c: CuratedCase): void {
  it(c.name, () => {
    const engine = createEngine(
      c.dialect === undefined ? {} : { defaultDialect: c.dialect },
    );
    const uri = engine.registerSchema(
      c.schema,
      `https://eval-suite.example/leg7/${encodeURIComponent(c.name)}`,
    );
    const compileOptions: EvaluatorCompileOptions = c.compileOptions ?? {
      annotations: true,
      errorParams: true,
    };
    const evaluator = compileEvaluator(engine, uri, compileOptions);
    const interp = interpreterFor(engine, uri, {
      annotations: compileOptions.annotations ?? false,
      errorParams: compileOptions.errorParams ?? false,
    });
    for (const instance of c.instances) {
      for (const { name, options } of OPTION_SETS) {
        const iAttempt = attempt(() => interp(instance, options));
        const cAttempt = attempt(() => evaluator.evaluate(instance, options));
        const d = outcomeDivergence(iAttempt, cAttempt);
        expect(
          d,
          `${c.name} / ${name} / ${JSON.stringify(instance)}`,
        ).toBeNull();
      }
    }
  });
}

const X_NOTE_SCHEMA: JsonValue = {
  title: "root",
  "x-note": "root note",
  properties: { a: { title: "a", "x-note": "a note" } },
};

describe("Leg 7 — curated ordering across every option set", () => {
  runCurated({
    name: "nested anyOf inside a failing anyOf branch",
    schema: {
      anyOf: [
        { anyOf: [{ type: "integer" }, { type: "string", minLength: 10 }] },
        { type: "boolean" },
      ],
    },
    instances: [3.14, 5, "short", true],
  });

  runCurated({
    name: "oneOf with two branches that can both pass",
    schema: { oneOf: [{ minimum: 0 }, { maximum: 100 }] },
    instances: [50, -5, 200, 0],
  });

  runCurated({
    name: "contains with minContains/maxContains and mixed items",
    schema: {
      items: { type: "number" },
      contains: { type: "number", minimum: 10 },
      minContains: 1,
      maxContains: 2,
    },
    instances: [[1, 2, 3], [15, 20, 25], [5, "x", 15], []],
  });

  runCurated({
    name: "if condition (with title) fails, then/else present",
    schema: {
      if: { title: "cond", type: "number" },
      then: { minimum: 0 },
      else: { minLength: 1 },
    },
    instances: ["", "hello", 5, -3],
  });

  runCurated({
    name: "if condition (with title), no then/else",
    schema: { if: { title: "cond", type: "number" } },
    instances: [5, "x"],
  });

  runCurated({
    name: "not over a subschema with title",
    schema: { not: { title: "should-not-match", type: "string" } },
    instances: [5, "x", true, []],
  });

  runCurated({
    name: "boolean false and true property subschemas",
    schema: { properties: { a: false, b: true } },
    instances: [{}, { a: 1 }, { b: 2 }, { a: 1, b: 2 }],
  });

  runCurated({
    name: "unknown keyword x-note, full annotation collection",
    schema: X_NOTE_SCHEMA,
    instances: [{ a: 1 }, {}, { a: 1, b: 2 }],
    compileOptions: { annotations: true, errorParams: true },
  });

  runCurated({
    name: "unknown keyword x-note, title-only selection",
    schema: X_NOTE_SCHEMA,
    instances: [{ a: 1 }, {}, { a: 1, b: 2 }],
    compileOptions: {
      annotations: { keywords: ["title"] },
      errorParams: true,
    },
  });

  runCurated({
    name: "draft-07 $ref with siblings ignored",
    schema: {
      $ref: "#/definitions/pos",
      title: "ignored-sibling-in-draft7",
      minimum: 100,
      definitions: { pos: { type: "number", minimum: 0 } },
    },
    instances: [5, -1, "x"],
    dialect: DIALECT_DRAFT_07,
  });

  runCurated({
    name: "$dynamicRef island, standalone",
    schema: {
      $id: "https://eval-suite.example/leg7/dyn-standalone",
      $defs: {
        node: { $dynamicAnchor: "node", title: "node-title", type: "object" },
      },
      allOf: [{ $dynamicRef: "#node" }],
    },
    instances: [{}, { x: 1 }, "not-an-object"],
  });

  runCurated({
    name: "$dynamicRef island, nested under properties",
    schema: {
      $id: "https://eval-suite.example/leg7/dyn-nested",
      $defs: {
        node: { $dynamicAnchor: "node", title: "node-title", type: "object" },
      },
      title: "outer",
      properties: {
        child: { $dynamicRef: "#node" },
        other: { title: "plain" },
      },
    },
    instances: [{ child: {} }, { child: {}, other: 1 }, { child: 3 }, {}],
  });

  runCurated({
    name: "$dynamicRef island, whole schema root",
    schema: {
      $id: "https://eval-suite.example/leg7/dyn-root",
      $defs: {
        node: { $dynamicAnchor: "node", title: "node-title", type: "object" },
      },
      $dynamicRef: "#node",
    },
    instances: [{}, { x: 1 }, 5],
  });

  it("a recursive items chain near a small maxDepth throws MaxDepthExceededError on both sides", () => {
    const engine = createEngine({ maxDepth: 8 });
    const uri = engine.registerSchema(
      { items: { $ref: "#" } },
      "https://eval-suite.example/leg7/depth",
    );
    const evaluator = compileEvaluator(engine, uri, {
      maxDepth: 8,
      annotations: true,
      errorParams: true,
    });
    let deep: JsonValue = [];
    for (let i = 0; i < 20; i++) deep = [deep];

    expect(() =>
      engine.evaluate(uri, deep, { output: "hierarchical", trace: true }),
    ).toThrow(MaxDepthExceededError);
    expect(() =>
      evaluator.evaluate(deep, { output: "hierarchical", trace: true }),
    ).toThrow(MaxDepthExceededError);
  });
});
