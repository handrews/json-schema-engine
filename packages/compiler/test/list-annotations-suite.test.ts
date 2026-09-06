// Compiled-annotation gate suite (COMPILED-ANNOTATIONS.md §5): the ordering
// argument in §2 is an argument, not a proof — these differentials are the
// proof obligation, matching how list-mode error order was pinned. Every
// official-suite case in all five dialects runs through both tiers; the
// annotation arrays must agree INCLUDING ORDER, and the totals are pinned
// exactly (the plan-census/exactRun discipline: a suite bump is a deliberate
// pin update, never a silent drift). The comparison itself is a helper that
// REPORTS divergences rather than asserting, so Leg 4 can prove the gate
// detects what it claims (the FUZZ_LIST-incident lesson).

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createEngine,
  DIALECT_2019_09,
  DIALECT_DRAFT_07,
  DIALECT_DRAFT_06,
  type AnnotationUnit,
  type Engine,
  type ErrorUnit,
  type JsonValue,
  type AnnotationSelection,
} from "@jse/core";
import {
  compileList,
  type CompilationPlan,
  type CompiledListResult,
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
// Shared comparison machinery. Both tiers are normalized into one Outcome
// shape (throws included — throw parity is part of the contract, mirroring
// list-output.test.ts), and annotationDivergence REPORTS the first mismatch
// instead of asserting so Leg 4 can corrupt real results through it.
// ---------------------------------------------------------------------------

interface Outcome {
  threw: string | null;
  valid: boolean;
  errors: readonly ErrorUnit[];
  annotations?: readonly AnnotationUnit[];
}

function interpOutcome(
  engine: Engine,
  uri: string,
  data: JsonValue,
  selection: boolean | AnnotationSelection = true,
): Outcome {
  try {
    const r = engine.evaluate(uri, data, {
      output: "list",
      annotations: selection,
      errorParams: true,
    });
    return {
      threw: null,
      valid: r.valid,
      errors: r.errors ?? [],
      ...(r.annotations === undefined ? {} : { annotations: r.annotations }),
    };
  } catch (err) {
    return { threw: (err as Error).constructor.name, valid: false, errors: [] };
  }
}

function compiledOutcome(
  evaluateList: (x: JsonValue) => CompiledListResult,
  data: JsonValue,
): Outcome {
  try {
    const r = evaluateList(data);
    return {
      threw: null,
      valid: r.valid,
      // Valid list results may retain successful-run bookkeeping arrays;
      // parity on the error side is only meaningful on failure (same
      // normalization as list-output.test.ts's full-suite leg).
      errors: r.valid ? [] : r.errors,
      ...(r.annotations === undefined ? {} : { annotations: r.annotations }),
    };
  } catch (err) {
    return { threw: (err as Error).constructor.name, valid: false, errors: [] };
  }
}

// Key-set-sensitive deep equal (a present-but-undefined property is NOT the
// same as an absent one, matching toStrictEqual), array order significant —
// order is the whole point of this gate.
function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (
    typeof a !== "object" ||
    typeof b !== "object" ||
    a === null ||
    b === null
  ) {
    return false;
  }
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    if (a.length !== (b as unknown[]).length) return false;
    return a.every((v, i) => deepEqual(v, (b as unknown[])[i]));
  }
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every(
    (k) =>
      k in b &&
      deepEqual(
        (a as Record<string, unknown>)[k],
        (b as Record<string, unknown>)[k],
      ),
  );
}

/**
 * First mismatch between the interpreter's outcome and the compiled one, or
 * null when they agree. Checks, in order: throw parity, verdict, error
 * parity on failure, the valid-only annotations-presence contract, then
 * order-strict unit-by-unit annotation equality. With `annotationsExpected`
 * false (annotations deselected) both sides must omit the key.
 */
function annotationDivergence(
  interp: Outcome,
  compiled: Outcome,
  annotationsExpected = true,
): string | null {
  if (interp.threw !== null || compiled.threw !== null) {
    return interp.threw === compiled.threw
      ? null
      : `throw parity: interpreter threw ${String(interp.threw)}, ` +
          `compiled threw ${String(compiled.threw)}`;
  }
  if (compiled.valid !== interp.valid) {
    return `valid: interpreter ${String(interp.valid)}, compiled ${String(compiled.valid)}`;
  }
  if (!deepEqual(compiled.errors, interp.errors)) {
    return `errors differ: interpreter=${JSON.stringify(interp.errors)} compiled=${JSON.stringify(compiled.errors)}`;
  }
  if (!interp.valid || !annotationsExpected) {
    // Both sides must omit annotations on invalid instances, and everywhere
    // when annotations are deselected.
    if (compiled.annotations !== undefined) {
      return "compiled annotations present but not expected";
    }
    if (interp.annotations !== undefined) {
      return "interpreter annotations present but not expected";
    }
    return null;
  }
  if (compiled.annotations === undefined) {
    return "compiled annotations missing on a valid instance";
  }
  if (interp.annotations === undefined) {
    return "interpreter annotations missing on a valid instance";
  }
  if (compiled.annotations.length !== interp.annotations.length) {
    return (
      `annotation count: interpreter ${String(interp.annotations.length)}, ` +
      `compiled ${String(compiled.annotations.length)}`
    );
  }
  for (let i = 0; i < interp.annotations.length; i++) {
    if (!deepEqual(compiled.annotations[i], interp.annotations[i])) {
      return (
        `annotation unit ${String(i)} differs: ` +
        `interpreter=${JSON.stringify(interp.annotations[i])} ` +
        `compiled=${JSON.stringify(compiled.annotations[i])}`
      );
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Leg 1 — full-suite differential, five dialects, both surfaces: the flat
// list result with error params and annotations, and the Basic document.
// Enumeration mirrors produce-recipes.test.ts's Leg B: every .json in the
// dialect directory (non-recursive, so optional/ stays out), remotes loader,
// per-dialect default dialect, draft-04 via its dialect package.
// Load/compile failures (remote misses, D19 non-schema) are skipped AND
// pinned, so a silent skip growth fails as loudly as a divergence.
// ---------------------------------------------------------------------------

interface DialectPin {
  dir: string;
  defaultDialect?: string;
  setup?: (engine: Engine) => void;
  groups: number;
  skippedGroups: number;
  instances: number;
  annotationUnits: number;
}

// Totals transcribed from a local run (deterministic — two runs agree). The
// instance counts equal the Bowtie/exactRun conformance pins per dialect
// (1299/1259/927/839/618) — nothing the verdict legs run escapes this gate.
const SWEEP: Record<string, DialectPin> = {
  "draft2020-12": {
    dir: "draft2020-12",
    groups: 383,
    skippedGroups: 0,
    instances: 1299,
    annotationUnits: 215,
  },
  "draft2019-09": {
    dir: "draft2019-09",
    defaultDialect: DIALECT_2019_09,
    groups: 372,
    skippedGroups: 0,
    instances: 1259,
    annotationUnits: 197,
  },
  draft7: {
    dir: "draft7",
    defaultDialect: DIALECT_DRAFT_07,
    groups: 257,
    skippedGroups: 0,
    instances: 927,
    annotationUnits: 122,
  },
  draft6: {
    dir: "draft6",
    defaultDialect: DIALECT_DRAFT_06,
    groups: 232,
    skippedGroups: 0,
    instances: 839,
    annotationUnits: 83,
  },
  draft4: {
    dir: "draft4",
    defaultDialect: DIALECT_DRAFT_04,
    setup: registerDraft04,
    groups: 160,
    skippedGroups: 0,
    instances: 618,
    annotationUnits: 59,
  },
};

async function sweepDialect(
  pin: DialectPin,
  selection: boolean | AnnotationSelection = true,
): Promise<{
  groups: number;
  skippedGroups: number;
  instances: number;
  annotationUnits: number;
}> {
  const suiteDir = join(SUITE_ROOT, "tests", pin.dir);
  const files = readdirSync(suiteDir)
    .filter((f) => f.endsWith(".json"))
    .sort();
  let groups = 0;
  let skippedGroups = 0;
  let instances = 0;
  let annotationUnits = 0;
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
      let artifact: ReturnType<typeof compileList>;
      try {
        uri = await engine.loadSchema(
          group.schema,
          `https://ann-suite.example/${pin.dir}/${file}/${String(gi)}`,
        );
        artifact = compileList(engine, uri, {
          annotations: selection,
          errorParams: true,
        });
      } catch {
        skippedGroups++;
        continue;
      }
      groups++;
      for (const test of group.tests) {
        instances++;
        const label = `${pin.dir}/${file}#${String(gi)} "${test.description}"`;
        const interp = interpOutcome(engine, uri, test.data, selection);
        const compiled = compiledOutcome(
          (x) => artifact.evaluateList(x),
          test.data,
        );
        const d = annotationDivergence(interp, compiled, selection !== false);
        if (d !== null) {
          throw new Error(
            `${pin.dir}/${file}#${String(gi)} "${group.description}" / ` +
              `"${test.description}": ${d}\ndata=${JSON.stringify(test.data)}`,
          );
        }
        // The helper is the reporter; toStrictEqual is the independent
        // order-strict check on the same arrays (belt and braces — either
        // one failing fails the case).
        if (interp.threw === null && interp.valid && selection !== false) {
          expect(compiled.annotations, label).toStrictEqual(interp.annotations);
          annotationUnits += interp.annotations?.length ?? 0;
        }
        // The Basic document, valid and invalid alike, with throw parity
        // folded into the comparison the way list-output.test.ts folds it.
        let iDoc: unknown;
        let cDoc: unknown;
        try {
          iDoc = engine.evaluate(uri, test.data, {
            output: "basic",
            annotations: selection,
            errorParams: true,
          }).outputDocument;
        } catch (err) {
          iDoc = (err as Error).constructor.name;
        }
        try {
          cDoc = artifact.basic(test.data);
        } catch (err) {
          cDoc = (err as Error).constructor.name;
        }
        expect(cDoc, label).toStrictEqual(iDoc);
      }
    }
  }
  return { groups, skippedGroups, instances, annotationUnits };
}

describe("Leg 1 — compiled annotations ≡ interpreter over every dialect suite", () => {
  for (const [name, pin] of Object.entries(SWEEP)) {
    it(`${name} agrees on every case and matches the pinned totals`, async () => {
      expect(await sweepDialect(pin), `${name} sweep totals`).toEqual({
        groups: pin.groups,
        skippedGroups: pin.skippedGroups,
        instances: pin.instances,
        annotationUnits: pin.annotationUnits,
      });
    });
  }
});

// ---------------------------------------------------------------------------
// Leg 2 — annotations deselected, five dialects: the plain compileList
// artifact's flat result and Basic document (valid instances included, so
// the annotation-free document side is covered) still equal the
// interpreter's, with the same skips as Leg 1.
// ---------------------------------------------------------------------------

describe("Leg 2 — compiled ≡ interpreter with annotations deselected, every dialect", () => {
  for (const [name, pin] of Object.entries(SWEEP)) {
    it(`${name} agrees on both surfaces`, async () => {
      expect(await sweepDialect(pin, false), `${name} sweep totals`).toEqual({
        groups: pin.groups,
        skippedGroups: pin.skippedGroups,
        instances: pin.instances,
        annotationUnits: 0,
      });
    });
  }
});

// ---------------------------------------------------------------------------
// Leg 3 — retention matrix. Annotation-rich curated schemas × instances ×
// every retention mechanism (allow/deny lists, keep, combinations), compiled
// vs interpreter on BOTH surfaces (mirroring the M5.5 elision on/off
// differential), plus a static-elision proof on the artifact source.
// ---------------------------------------------------------------------------

const META_DATA_VOCAB = "https://json-schema.org/draft/2020-12/vocab/meta-data";
const APPLICATOR_VOCAB =
  "https://json-schema.org/draft/2020-12/vocab/applicator";

interface RetentionCase {
  name: string;
  retention?: AnnotationSelection;
}

const RETENTIONS: RetentionCase[] = [
  { name: "undefined (collect everything)" },
  {
    name: "keywords allow-list",
    retention: { keywords: ["title", "properties"] },
  },
  {
    name: "vocabularies allow-list",
    retention: { vocabularies: [META_DATA_VOCAB] },
  },
  {
    name: "excludeKeywords deny-list",
    retention: { excludeKeywords: ["title", "properties"] },
  },
  {
    name: "excludeVocabularies deny-list",
    retention: { excludeVocabularies: [APPLICATOR_VOCAB] },
  },
  {
    name: "allow + deny combined",
    retention: {
      keywords: ["title", "description", "properties"],
      excludeKeywords: ["description"],
    },
  },
  {
    name: "keep predicate on inputLocation",
    retention: { keep: (u) => u.inputLocation === "" },
  },
  {
    name: "keep combined with lists",
    retention: {
      keywords: ["title", "properties", "x-vendor"],
      keep: (u) => u.inputLocation !== "",
    },
  },
];

interface CuratedCase {
  name: string;
  schema: JsonValue;
  instances: JsonValue[];
}

const CURATED: CuratedCase[] = [
  {
    name: "nested meta-data (title/description/deprecated/readOnly/default)",
    schema: {
      title: "root",
      description: "root desc",
      deprecated: true,
      properties: {
        a: {
          title: "a",
          description: "a desc",
          readOnly: true,
          type: "integer",
        },
        b: { properties: { c: { title: "c", default: 3 } } },
      },
    },
    instances: [{ a: 1, b: { c: 2 } }, { a: "x" }, {}, { a: 2, b: {}, z: 9 }],
  },
  {
    name: "property-name buckets (properties/patternProperties/additionalProperties)",
    schema: {
      properties: { a: true, b: { type: "string" } },
      patternProperties: { "^x": { title: "x-ish" }, x$: true },
      additionalProperties: { title: "extra" },
    },
    instances: [
      { a: 1, b: "s", xy: 2, yx: 3, other: 4 },
      { b: 5 },
      {},
      { xx: 1 },
    ],
  },
  {
    name: "array indexes (prefixItems/items/contains)",
    schema: {
      prefixItems: [{ title: "p0" }, { title: "p1" }],
      items: { title: "rest" },
      contains: { type: "number", title: "num" },
      minContains: 1,
    },
    instances: [[1, 2, 3], [1, 2], ["a", "b"], []],
  },
  {
    name: "unknown x- keywords",
    schema: {
      "x-vendor": { cache: true },
      "x-rate": 5,
      title: "known",
      properties: { a: { "x-nested": [1, 2] } },
    },
    instances: [{ a: 1 }, {}, 7, [3]],
  },
  {
    name: "$dynamicRef island",
    schema: {
      $id: "https://ann-suite.example/leg3/dyn",
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
  },
  {
    name: "unevaluatedProperties consumer island",
    schema: {
      allOf: [{ properties: { a: { title: "a-inner" } } }],
      properties: { b: { title: "b" } },
      unevaluatedProperties: { title: "extra", type: "number" },
    },
    instances: [{ a: 1, b: 2, c: 3 }, { a: 1, b: 2, c: "x" }, { a: 1 }, {}],
  },
  {
    name: "conditionals (if/then/else + anyOf + oneOf)",
    schema: {
      if: { type: "number", title: "cond" },
      then: { title: "then", minimum: 0 },
      else: { title: "else", minLength: 1 },
      anyOf: [
        { title: "A", type: "number" },
        { title: "B", type: "string" },
      ],
      oneOf: [
        { title: "one", const: 5 },
        { title: "two", minimum: 10 },
      ],
    },
    instances: [5, 12, "hello", -3],
  },
  {
    name: "format/content/examples + dependentSchemas",
    schema: {
      format: "email",
      contentMediaType: "application/json",
      contentEncoding: "base64",
      examples: [1, 2],
      dependentSchemas: { a: { title: "dep", required: ["b"] } },
      properties: { a: { title: "a" } },
    },
    instances: [{ a: 1, b: 2 }, { a: 1 }, {}, "user@example.com"],
  },
];

describe("Leg 3 — retention matrix, compiled ≡ interpreter on both surfaces", () => {
  for (const c of CURATED) {
    it(c.name, () => {
      const engine = createEngine();
      const uri = engine.registerSchema(
        c.schema,
        `https://ann-retention.example/${encodeURIComponent(c.name)}`,
      );
      for (const r of RETENTIONS) {
        const artifact = compileList(engine, uri, {
          annotations: r.retention ?? true,
          errorParams: true,
        });
        for (const instance of c.instances) {
          const ctx = `${c.name} / ${r.name} / ${JSON.stringify(instance)}`;
          const interp = interpOutcome(engine, uri, instance, r.retention);
          const compiled = compiledOutcome(
            (x) => artifact.evaluateList(x),
            instance,
          );
          expect(annotationDivergence(interp, compiled), ctx).toBeNull();
          if (interp.valid) {
            expect(compiled.annotations, ctx).toStrictEqual(interp.annotations);
          }
          const iDoc = engine.evaluate(uri, instance, {
            output: "basic",
            annotations: r.retention ?? true,
          }).outputDocument;
          expect(artifact.basic(instance), ctx).toStrictEqual(iDoc);
        }
      }
    });
  }

  it("an allow-list statically elides the excluded keyword's produce from the source", () => {
    const engine = createEngine();
    const uri = engine.registerSchema(
      { title: "t", description: "d" },
      "https://ann-retention.example/elision",
    );
    const full = compileList(engine, uri, { annotations: true });
    const pruned = compileList(engine, uri, {
      annotations: { keywords: ["title"] },
    });
    // Control first: the probe string (the excluded keyword's evaluation-path
    // suffix in its push) IS how an emitted produce shows up, so its absence
    // below is elision, not a wrong probe.
    expect(full.source).toContain("/description");
    expect(pruned.source).not.toContain("/description");
    // The specialized artifact still evaluates correctly.
    const r = pruned.evaluateList(1);
    expect(r.valid).toBe(true);
    expect(r.annotations?.map((u) => u.keyword)).toStrictEqual(["title"]);
  });
});

// ---------------------------------------------------------------------------
// Leg 4 — planted-divergence self-test: the gate that would catch the gate.
// Real compiled results are corrupted through wrapped evaluateList functions
// and must be REPORTED by the same annotationDivergence Leg 1 trusts.
// ---------------------------------------------------------------------------

describe("Leg 4 — planted corruptions are reported by the comparison", () => {
  const engine = createEngine();
  const uri = engine.registerSchema(
    {
      title: "root",
      properties: { a: { title: "a" }, b: { title: "b" } },
    },
    "https://ann-suite.example/planted",
  );
  const artifact = compileList(engine, uri, { annotations: true });
  const instance: JsonValue = { a: 1, b: 2 };
  const interp = interpOutcome(engine, uri, instance);

  const corrupted = (
    corrupt: (anns: AnnotationUnit[]) => AnnotationUnit[],
  ): Outcome => {
    const wrapped = (x: JsonValue): CompiledListResult => {
      const r = artifact.evaluateList(x);
      return {
        ...r,
        annotations: corrupt(structuredClone(r.annotations)!),
      };
    };
    return compiledOutcome(wrapped, instance);
  };

  it("has enough units for the corruptions to be distinct", () => {
    expect(interp.valid).toBe(true);
    expect(interp.annotations!.length).toBeGreaterThanOrEqual(3);
  });

  it("reports a dropped trailing unit", () => {
    const d = annotationDivergence(
      interp,
      corrupted((a) => a.slice(0, -1)),
    );
    expect(d).not.toBeNull();
    expect(d).toContain("annotation count");
  });

  it("reports two reordered units", () => {
    const d = annotationDivergence(
      interp,
      corrupted((a) => [a[1]!, a[0]!, ...a.slice(2)]),
    );
    expect(d).not.toBeNull();
    expect(d).toContain("annotation unit 0 differs");
  });

  it("reports a mutated annotation value", () => {
    const d = annotationDivergence(
      interp,
      corrupted((a) => {
        a[0] = { ...a[0]!, annotation: "corrupted" };
        return a;
      }),
    );
    expect(d).not.toBeNull();
    expect(d).toContain("annotation unit 0 differs");
    expect(d).toContain("corrupted");
  });

  it("control: the unwrapped artifact reports null", () => {
    const d = annotationDivergence(
      interp,
      compiledOutcome((x) => artifact.evaluateList(x), instance),
    );
    expect(d).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Leg 5 — plan identity. compileList with and without the `annotations`
// option is driven by the same buildPlan(engine, uri, { output: "list" });
// a silent
// classification flip between the two would evade every differential above
// (interpreted fallback is always correct), so the unit-kind census must be
// identical.
// ---------------------------------------------------------------------------

function unitCensus(plan: CompilationPlan): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, unit] of plan.units) out[key] = unit.kind;
  return out;
}

function expectSamePlanShape(engine: Engine, uri: string): void {
  const plain = compileList(engine, uri);
  const annotated = compileList(engine, uri, { annotations: true });
  expect(unitCensus(annotated.plan)).toStrictEqual(unitCensus(plain.plan));
  expect(annotated.plan.targets.map((t) => t.key)).toStrictEqual(
    plain.plan.targets.map((t) => t.key),
  );
  expect(annotated.plan.rootKey).toBe(plain.plan.rootKey);
}

describe("Leg 5 — the annotations option does not change plan classification", () => {
  it("consumer-bearing schema plans identically", () => {
    const engine = createEngine();
    const uri = engine.registerSchema(
      {
        allOf: [{ properties: { a: { title: "a" } } }],
        properties: { b: { title: "b" } },
        unevaluatedProperties: { type: "number" },
      },
      "https://ann-suite.example/plan-consumer",
    );
    expectSamePlanShape(engine, uri);
    // The consumer must actually exercise runtime coverage tracking (list
    // plans never static-license, plan.ts), or this assert proves nothing.
    const annotated = compileList(engine, uri, { annotations: true });
    const root = annotated.plan.units.get(annotated.plan.rootKey)!;
    expect(root.kind).toBe("static");
    expect(root.tracking).toBe(true);
  });

  it("OAS 3.1 schema corpus plans identically", () => {
    const oasSchema = JSON.parse(
      readFileSync(join(BENCH_CORPORA, "oas-3.1-schema.json"), "utf8"),
    ) as JsonValue;
    const engine = createEngine();
    const uri = engine.registerSchema(
      oasSchema,
      "https://spec.openapis.org/oas/3.1/schema/2025-09-15",
    );
    expectSamePlanShape(engine, uri);
  });
});

// ---------------------------------------------------------------------------
// Leg 6 — one selection over the whole draft2020-12 suite: a vocabulary
// allow-list, a keyword deny-list, and a keep predicate together, on both
// surfaces (Leg 3 covers every mechanism on curated schemas only).
// ---------------------------------------------------------------------------

const SUITE_SELECTION: AnnotationSelection = {
  vocabularies: [META_DATA_VOCAB],
  excludeKeywords: ["description"],
  keep: (u) => u.inputLocation === "",
};
// Transcribed from a local run (deterministic — two runs agree).
const LEG6_ANNOTATION_UNITS = 16;

describe("Leg 6 — a combined selection over the draft2020-12 suite", () => {
  it("agrees on every case and matches the pinned unit count", async () => {
    const pin = SWEEP["draft2020-12"]!;
    expect(await sweepDialect(pin, SUITE_SELECTION)).toEqual({
      groups: pin.groups,
      skippedGroups: pin.skippedGroups,
      instances: pin.instances,
      annotationUnits: LEG6_ANNOTATION_UNITS,
    });
  });
});
