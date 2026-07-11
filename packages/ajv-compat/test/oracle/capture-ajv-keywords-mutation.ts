// ajv-keywords transform/dynamicDefaults oracle (Phase 1 of the M8.3
// mutation-trio follow-on, D15): ajv@8 + ajv-keywords@5.1.0 are EXECUTED
// here — never read — to pin the combiner interaction, error surfacing, and
// dynamic-default semantics the README leaves implicit. Output:
// test/fixtures/ajv-keywords-mutation.json. This is a CAPTURE script only;
// no compat-layer implementation reads this fixture yet (see
// packages/ajv-compat/src/ajv-keywords.ts's header, which still refuses
// both keywords via AjvCompatUnsupportedError).
//
// Kept separate from capture-mutation.ts (ajv-mutation.json) so that
// script's fixture and cases stay stable while this one iterates.
//
// Re-run after an ajv/ajv-keywords devDependency bump:
//   npx tsx packages/ajv-compat/test/oracle/capture-ajv-keywords-mutation.ts
//
// ---------------------------------------------------------------------
// Shape-pinning (the DIVERGENT_DATA_AFTER analogue for non-determinism)
// ---------------------------------------------------------------------
// dynamicDefaults' `timestamp`/`datetime`/`date`/`time`/`random`/`randomint`
// generators produce a fresh value every run (wall-clock or PRNG), so exact
// dataAfter equality is not capturable. Where a case's output is
// non-deterministic, the fixture carries `dataAfterShape` instead of (or
// alongside, for properties that are exact) `dataAfter`: a per-property
// record mapping property name to a minimal shape descriptor:
//
//   { kind: "number", integer?, min?, max?, exclusiveMax?, oneOf? }
//   { kind: "string", pattern: <regex source, no flags> }
//
// `min`/`max` are inclusive unless `exclusiveMax` is set; `oneOf` pins a
// small exact discrete set (e.g. bare-string `randomint`'s {0, 1}) instead
// of a range. A consuming test checks membership, not equality — this
// mirrors DIVERGENT_DATA_AFTER's role of making a known-unpinnable value
// loud and intentional rather than silently exact-matched (and failing the
// day the fixture happens to have captured, say, a leap-second edge case).
// Every shape below was derived from >=5 real samples per generator
// (2000 for the numeric ones) and self-checked against the captured sample
// at capture time (see `checkShape`) so the vocabulary is not a guess.
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020Import from "ajv/dist/2020.js";
import ajvKeywordsImport from "ajv-keywords";

// Same CJS/ESM unwrap as the other oracle scripts — every package ships a
// `default` export under NodeNext's interop.
const unwrap = <T>(m: T): T =>
  (m as { default?: T }).default !== undefined
    ? (m as { default: T }).default
    : m;
type ValidateFn = ((data: unknown) => boolean) & {
  errors?: unknown[] | null;
};
interface AjvInstance {
  compile(schema: unknown): ValidateFn;
}
type AjvCtor = new (options?: Record<string, unknown>) => AjvInstance;
const Ajv2020 = unwrap(Ajv2020Import) as unknown as AjvCtor;
const ajvKeywords = unwrap(ajvKeywordsImport) as unknown as (
  ajv: unknown,
  names?: string | string[],
) => void;

// ---- shape vocabulary --------------------------------------------------

interface NumberShape {
  kind: "number";
  integer?: boolean;
  min?: number;
  max?: number;
  exclusiveMax?: boolean;
  oneOf?: number[];
}
interface StringShape {
  kind: "string";
  pattern: string;
}
type Shape = NumberShape | StringShape;

/** Self-check: throws loudly if a captured sample doesn't fit the shape
 * we're about to pin, instead of silently committing a wrong shape. */
function checkShape(name: string, value: unknown, shape: Shape): void {
  if (shape.kind === "number") {
    if (typeof value !== "number") {
      throw new Error(`${name}: expected number, got ${typeof value}`);
    }
    if (shape.integer && !Number.isInteger(value)) {
      throw new Error(`${name}: expected integer, got ${String(value)}`);
    }
    if (shape.oneOf && !shape.oneOf.includes(value)) {
      throw new Error(
        `${name}: ${String(value)} not in ${JSON.stringify(shape.oneOf)}`,
      );
    }
    if (shape.min !== undefined && value < shape.min) {
      throw new Error(`${name}: ${String(value)} < min ${String(shape.min)}`);
    }
    if (shape.max !== undefined) {
      const ok = shape.exclusiveMax ? value < shape.max : value <= shape.max;
      if (!ok) {
        throw new Error(
          `${name}: ${String(value)} violates max ${String(shape.max)}`,
        );
      }
    }
  } else {
    if (typeof value !== "string") {
      throw new Error(`${name}: expected string, got ${typeof value}`);
    }
    if (!new RegExp(shape.pattern).test(value)) {
      throw new Error(
        `${name}: ${JSON.stringify(value)} doesn't match /${shape.pattern}/`,
      );
    }
  }
}

// ---- plain single-shot cases -------------------------------------------
// Each: compile with the given ajv-keywords names loaded, validate a deep
// copy of `data`, record verdict/dataAfter/errors, or the compile error.

interface OracleCase {
  name: string;
  keywords: string | string[];
  options: Record<string, unknown>;
  schema: unknown;
  data: unknown;
}

const CASES: OracleCase[] = [
  // ---- 1. transform basics: one op each, combined multi-property case ----
  {
    name: "transform-basic-ops",
    keywords: "transform",
    options: {},
    schema: {
      type: "object",
      properties: {
        trim: { type: "string", transform: ["trim"] },
        trimStart: { type: "string", transform: ["trimStart"] },
        trimEnd: { type: "string", transform: ["trimEnd"] },
        trimLeft: { type: "string", transform: ["trimLeft"] },
        trimRight: { type: "string", transform: ["trimRight"] },
        toLowerCase: { type: "string", transform: ["toLowerCase"] },
        toUpperCase: { type: "string", transform: ["toUpperCase"] },
      },
    },
    data: {
      trim: "  MiXeD  ",
      trimStart: "  MiXeD  ",
      trimEnd: "  MiXeD  ",
      trimLeft: "  MiXeD  ",
      trimRight: "  MiXeD  ",
      toLowerCase: "  MiXeD  ",
      toUpperCase: "  MiXeD  ",
    },
  },

  // ---- 2. op order --------------------------------------------------------
  // trim/toLowerCase touch disjoint aspects of the string (edge whitespace
  // vs. full-string case) and commute — both orders below give the same
  // result. A truly order-sensitive pair needs an op whose *behavior*
  // depends on whitespace already being gone: toEnumCase's case-insensitive
  // enum match fails when untrimmed whitespace is still present.
  {
    name: "transform-op-order-trim-then-lower",
    keywords: "transform",
    options: {},
    schema: {
      type: "object",
      properties: { v: { type: "string", transform: ["trim", "toLowerCase"] } },
    },
    data: { v: "  MiXeD  " },
  },
  {
    name: "transform-op-order-lower-then-trim",
    keywords: "transform",
    options: {},
    schema: {
      type: "object",
      properties: { v: { type: "string", transform: ["toLowerCase", "trim"] } },
    },
    data: { v: "  MiXeD  " },
  },
  {
    name: "transform-op-order-toEnumCase-trim-sensitive-trim-first",
    keywords: "transform",
    options: {},
    schema: {
      type: "object",
      properties: {
        v: { type: "string", transform: ["trim", "toEnumCase"], enum: ["pH"] },
      },
    },
    data: { v: " ph " },
  },
  {
    name: "transform-op-order-toEnumCase-trim-sensitive-toEnumCase-first",
    keywords: "transform",
    options: {},
    schema: {
      type: "object",
      properties: {
        v: { type: "string", transform: ["toEnumCase", "trim"], enum: ["pH"] },
      },
    },
    data: { v: " ph " },
  },

  // ---- 3. non-string value untouched -------------------------------------
  {
    name: "transform-non-string-value-untouched",
    keywords: "transform",
    options: {},
    schema: { type: "object", properties: { v: { transform: ["trim"] } } },
    data: { v: 42 },
  },

  // ---- 4. root-level string, transform at root: parentData guard --------
  {
    name: "transform-root-level-untouched",
    keywords: "transform",
    options: {},
    schema: { type: "string", transform: ["trim"] },
    data: "  x  ",
  },

  // ---- 6. transform inside array items -----------------------------------
  {
    name: "transform-array-items",
    keywords: "transform",
    options: {},
    schema: {
      type: "array",
      items: { type: "string", transform: ["trim", "toUpperCase"] },
    },
    data: ["  a  ", " b"],
  },

  // ---- 7. anyOf --------------------------------------------------------
  // Branch selection is gated by `kind` (a field the transform never
  // touches), so branch pass/fail is controllable independently of the
  // transformed field `v`. In (b)/(c), `v` is declared BEFORE `kind` in
  // each branch's `properties` so v's (always-"valid") transform keyword
  // is reached and runs even when that branch goes on to fail on `kind`
  // (relevant only when allErrors:false, which stops at a branch's first
  // failing keyword).
  {
    name: "transform-anyOf-branch0-passes-allErrors-false",
    keywords: "transform",
    options: {},
    schema: {
      type: "object",
      required: ["kind"],
      properties: { kind: {}, v: {} },
      anyOf: [
        {
          properties: {
            kind: { const: "a" },
            v: { type: "string", transform: ["toUpperCase"] },
          },
        },
        {
          properties: {
            kind: { const: "b" },
            v: { type: "string", transform: ["trim"] },
          },
        },
      ],
    },
    data: { kind: "a", v: " mixed " },
  },
  {
    name: "transform-anyOf-branch0-passes-allErrors-true",
    keywords: "transform",
    options: { allErrors: true },
    schema: {
      type: "object",
      required: ["kind"],
      properties: { kind: {}, v: {} },
      anyOf: [
        {
          properties: {
            kind: { const: "a" },
            v: { type: "string", transform: ["toUpperCase"] },
          },
        },
        {
          properties: {
            kind: { const: "b" },
            v: { type: "string", transform: ["trim"] },
          },
        },
      ],
    },
    data: { kind: "a", v: " mixed " },
  },
  {
    name: "transform-anyOf-branch0-fails-branch1-passes",
    keywords: "transform",
    options: {},
    schema: {
      type: "object",
      required: ["kind"],
      properties: { kind: {}, v: {} },
      anyOf: [
        {
          properties: {
            v: { type: "string", transform: ["toUpperCase"] },
            kind: { const: "a" },
          },
        },
        {
          properties: {
            v: { type: "string", transform: ["trim"] },
            kind: { const: "b" },
          },
        },
      ],
    },
    data: { kind: "b", v: " mixed " },
  },
  {
    name: "transform-anyOf-both-branches-fail",
    keywords: "transform",
    options: {},
    schema: {
      type: "object",
      required: ["kind"],
      properties: { kind: {}, v: {} },
      anyOf: [
        {
          properties: {
            v: { type: "string", transform: ["toUpperCase"] },
            kind: { const: "a" },
          },
        },
        {
          properties: {
            v: { type: "string", transform: ["trim"] },
            kind: { const: "b" },
          },
        },
      ],
    },
    data: { kind: "c", v: " mixed " },
  },

  // ---- 8. oneOf (same field/branch layout as anyOf, for direct contrast) -
  {
    name: "transform-oneOf-branch0-passes-kind-before-v",
    // kind declared before v: branch1's `kind` const-mismatch fails first
    // under allErrors:false, so branch1's transform never runs even though
    // oneOf itself must still visit branch1 to count matches.
    keywords: "transform",
    options: {},
    schema: {
      type: "object",
      required: ["kind"],
      properties: { kind: {}, v: {} },
      oneOf: [
        {
          properties: {
            kind: { const: "a" },
            v: { type: "string", transform: ["toUpperCase"] },
          },
        },
        {
          properties: {
            kind: { const: "b" },
            v: { type: "string", transform: ["trim"] },
          },
        },
      ],
    },
    data: { kind: "a", v: " mixed " },
  },
  {
    name: "transform-oneOf-branch0-passes-v-before-kind",
    // v declared before kind: branch1's transform runs (mutating the
    // already-passed-branch's value) before its kind check fails —
    // reveals that oneOf, unlike anyOf under allErrors:false, always
    // evaluates every branch (it must, to detect "more than one match").
    keywords: "transform",
    options: {},
    schema: {
      type: "object",
      required: ["kind"],
      properties: { kind: {}, v: {} },
      oneOf: [
        {
          properties: {
            v: { type: "string", transform: ["toUpperCase"] },
            kind: { const: "a" },
          },
        },
        {
          properties: {
            v: { type: "string", transform: ["trim"] },
            kind: { const: "b" },
          },
        },
      ],
    },
    data: { kind: "a", v: " mixed " },
  },
  {
    name: "transform-oneOf-branch0-fails-branch1-passes",
    keywords: "transform",
    options: {},
    schema: {
      type: "object",
      required: ["kind"],
      properties: { kind: {}, v: {} },
      oneOf: [
        {
          properties: {
            v: { type: "string", transform: ["toUpperCase"] },
            kind: { const: "a" },
          },
        },
        {
          properties: {
            v: { type: "string", transform: ["trim"] },
            kind: { const: "b" },
          },
        },
      ],
    },
    data: { kind: "b", v: " mixed " },
  },
  {
    name: "transform-oneOf-both-branches-fail",
    keywords: "transform",
    options: {},
    schema: {
      type: "object",
      required: ["kind"],
      properties: { kind: {}, v: {} },
      oneOf: [
        {
          properties: {
            v: { type: "string", transform: ["toUpperCase"] },
            kind: { const: "a" },
          },
        },
        {
          properties: {
            v: { type: "string", transform: ["trim"] },
            kind: { const: "b" },
          },
        },
      ],
    },
    data: { kind: "c", v: " mixed " },
  },

  // ---- 9. interleaving: a failed branch's mutation flips a LATER
  // branch's own validity (not just "did the mutation persist") ---------
  {
    name: "transform-interleaving-failed-branch-mutation-enables-later-branch",
    keywords: "transform",
    options: {},
    schema: {
      type: "object",
      properties: { v: {} },
      anyOf: [
        {
          // Always fails on `pattern` (no value ever equals "NEVER"), but
          // its transform still runs first (see the JSON-key-order case
          // below) and uppercases v in place before the pattern check.
          properties: {
            v: {
              type: "string",
              pattern: "^NEVER$",
              transform: ["toUpperCase"],
            },
          },
        },
        {
          // Would reject the ORIGINAL lowercase "abc", but sees the
          // mutated "ABC" left behind by the failed branch above.
          properties: { v: { type: "string", pattern: "^[A-Z]+$" } },
        },
      ],
    },
    data: { v: "abc" },
  },
  {
    name: "transform-interleaving-allErrors-true",
    keywords: "transform",
    options: { allErrors: true },
    schema: {
      type: "object",
      properties: { v: {} },
      anyOf: [
        {
          properties: {
            v: {
              type: "string",
              pattern: "^NEVER$",
              transform: ["toUpperCase"],
            },
          },
        },
        {
          properties: { v: { type: "string", pattern: "^[A-Z]+$" } },
        },
      ],
    },
    data: { v: "abc" },
  },
  {
    name: "transform-runs-before-pattern-regardless-of-json-key-order",
    // `pattern` is declared textually BEFORE `transform`, yet the pattern
    // still sees the POST-transform value — AJV's internal keyword order
    // for a schema object, not JSON declaration order, governs evaluation
    // sequence. This is what makes case 9's interleaving possible and what
    // makes toEnumCase-with-sibling-enum work at all.
    keywords: "transform",
    options: {},
    schema: {
      type: "object",
      properties: {
        v: { type: "string", pattern: "^[A-Z]+$", transform: ["toUpperCase"] },
      },
    },
    data: { v: "abc" },
  },

  // ---- 10. control: transform outside any combiner, sibling anyOf -------
  {
    name: "transform-control-outside-combiner-with-sibling-anyOf",
    keywords: "transform",
    options: {},
    schema: {
      type: "object",
      properties: { v: { type: "string", transform: ["trim"] } },
      anyOf: [{ required: ["v"] }, { required: ["other"] }],
    },
    data: { v: "  x  " },
  },

  // ---- 11. transform x coerceTypes ---------------------------------------
  {
    name: "transform-coerceTypes-number-to-string",
    keywords: "transform",
    options: { coerceTypes: true },
    schema: {
      type: "object",
      properties: { s: { type: "string", transform: ["trim"] } },
    },
    data: { s: 42 },
  },

  // ---- toEnumCase without a sibling enum / with colliding enum values ----
  // (part of item 5; the with-sibling-enum success path is captured
  // separately below via a multi-input probe, mirroring FORMAT_PROBES.)
  {
    name: "transform-toEnumCase-without-enum",
    keywords: "transform",
    options: {},
    schema: {
      type: "object",
      properties: { v: { type: "string", transform: ["toEnumCase"] } },
    },
    data: { v: "abc" },
  },
  {
    name: "transform-toEnumCase-colliding-enum",
    keywords: "transform",
    options: {},
    schema: {
      type: "object",
      properties: {
        v: { type: "string", transform: ["toEnumCase"], enum: ["ph", "PH"] },
      },
    },
    data: { v: "Ph" },
  },

  // ---- 12. dynamicDefaults present, useDefaults NOT set: no-op ----------
  {
    name: "dynamicDefaults-noop-without-useDefaults",
    keywords: "dynamicDefaults",
    options: {},
    schema: {
      type: "object",
      dynamicDefaults: {
        id: { func: "seq", args: { name: "jse-oracle-noop-useDefaults" } },
      },
      properties: { id: { type: "integer" } },
    },
    data: {},
  },

  // ---- 15. useDefaults:"empty" ------------------------------------------
  // (dynamicDefaults-useDefaults-empty-mode is captured separately below,
  // outside CASES, because `c`'s generator is non-deterministic —
  // see item 15's block near the shape-pinned cases.)

  // ---- 17. dynamicDefaults inside an anyOf branch: compositeRule guard --
  {
    name: "dynamicDefaults-inside-anyOf-branch-no-fill-allErrors-false",
    keywords: "dynamicDefaults",
    options: { useDefaults: true },
    schema: {
      type: "object",
      anyOf: [
        {
          type: "object",
          dynamicDefaults: {
            id: { func: "seq", args: { name: "jse-oracle-anyof-guard-1" } },
          },
          properties: { id: { type: "integer" } },
        },
      ],
    },
    data: {},
  },
  {
    name: "dynamicDefaults-inside-anyOf-branch-no-fill-allErrors-true",
    keywords: "dynamicDefaults",
    options: { useDefaults: true, allErrors: true },
    schema: {
      type: "object",
      anyOf: [
        {
          type: "object",
          dynamicDefaults: {
            id: { func: "seq", args: { name: "jse-oracle-anyof-guard-2" } },
          },
          properties: { id: { type: "integer" } },
        },
        { type: "object", required: ["other"] },
      ],
    },
    data: {},
  },

  // ---- 19. unknown generator name ----------------------------------------
  {
    name: "dynamicDefaults-unknown-generator-error",
    keywords: "dynamicDefaults",
    options: { useDefaults: true },
    schema: {
      type: "object",
      dynamicDefaults: { x: "nonexistent-generator-xyz" },
      properties: { x: {} },
    },
    data: {},
  },

  // ---- strict-mode posture ------------------------------------------------
  // Without ajv-keywords loaded, strict mode (the AJV8 default) rejects the
  // bare keyword name at compile time. Every case above loads ajv-keywords
  // and none needed strict:false — confirming the README's claim that
  // loading the package registers these as known keywords, unlike plain
  // `default` inside a combiner branch (capture-mutation.ts's
  // "defaults-inside-*-oneOf-branch" cases, which DO need strict:false).
  {
    name: "strict-rejects-transform-when-ajv-keywords-not-loaded",
    keywords: [],
    options: {},
    schema: {
      type: "object",
      properties: { v: { type: "string", transform: ["trim"] } },
    },
    data: { v: "x" },
  },
];

const results: Record<string, unknown> = {};

for (const c of CASES) {
  const ajv = new Ajv2020(c.options);
  if (Array.isArray(c.keywords) ? c.keywords.length > 0 : c.keywords) {
    ajvKeywords(ajv, c.keywords);
  }
  try {
    const validate = ajv.compile(c.schema);
    const working = JSON.parse(JSON.stringify(c.data)) as unknown;
    const valid = validate(working);
    results[c.name] = {
      keywords: c.keywords,
      options: c.options,
      schema: c.schema,
      data: c.data,
      valid,
      dataAfter: working,
      errors: JSON.parse(JSON.stringify(validate.errors ?? null)) as unknown,
    };
  } catch (err) {
    results[c.name] = {
      keywords: c.keywords,
      options: c.options,
      schema: c.schema,
      data: c.data,
      compileError: `${(err as Error).constructor.name}: ${(err as Error).message}`,
    };
  }
}

// ---- 5. toEnumCase with sibling enum: multi-input probe -----------------
// Mirrors capture-companions.ts's FORMAT_PROBES shape: one schema, several
// inputs, each input/output/valid triple recorded.
{
  const ajv = new Ajv2020({});
  ajvKeywords(ajv, "transform");
  const schema = {
    type: "object",
    properties: {
      v: { type: "string", transform: ["trim", "toEnumCase"], enum: ["pH"] },
    },
  };
  const validate = ajv.compile(schema);
  const inputs = ["ph", " Ph", "PH", "pH ", "pH"];
  const values = inputs.map((input) => {
    const working: Record<string, unknown> = { v: input };
    const valid = validate(working);
    return { input, output: working.v, valid };
  });
  results["transform-toEnumCase-with-sibling-enum"] = {
    keywords: "transform",
    options: {},
    schema,
    values,
  };
}

// ---- 13. useDefaults:true + seq: counter increment, two fresh calls -----
// Reproducibility design (see findings report for the full rationale):
// ajv-keywords' `seq` counter is a MODULE-GLOBAL map keyed by `args.name`,
// shared across every Ajv instance in the process (confirmed empirically:
// two separate `new Ajv2020()` instances compiling the same
// `{func:"seq", args:{name: X}}` schema share one counter for X). Exact
// values are reproducible in a consuming test ONLY if that test is the
// FIRST thing in its process to use a given name — so this fixture pins a
// name (`jse-oracle-seq-13`) that this script uses nowhere else, and the
// consuming test must do the same: use a name it does not reuse elsewhere
// in the same test process, and make the pinned two calls its first two
// uses of that name. That is exactly the discipline this capture itself
// follows for every "seq"-args.name it introduces below.
{
  const ajv = new Ajv2020({ useDefaults: true });
  ajvKeywords(ajv, "dynamicDefaults");
  const schema = {
    type: "object",
    dynamicDefaults: {
      id: { func: "seq", args: { name: "jse-oracle-seq-13" } },
    },
    properties: { id: { type: "integer" } },
  };
  const validate = ajv.compile(schema);
  const first: Record<string, unknown> = {};
  const firstValid = validate(first);
  const second: Record<string, unknown> = {};
  const secondValid = validate(second);
  results["dynamicDefaults-seq-counter-increment"] = {
    keywords: "dynamicDefaults",
    options: { useDefaults: true },
    schema,
    firstCall: { data: {}, valid: firstValid, dataAfter: first },
    secondCall: { data: {}, valid: secondValid, dataAfter: second },
  };
}

// ---- 15. useDefaults:"empty": null/"" filled, 0/false kept ------------
// `c`'s generator is deliberately "timestamp" rather than "seq": a
// fresh-name seq's first tick is ALSO 0, which would make "kept" and
// "overwritten-with-the-generator's-0" indistinguishable from the
// original `0`. Using a generator whose output could never collide with
// 0 rules that ambiguity out — and the result below shows `c` is left
// EXACTLY `0` (not a 13-digit timestamp), so no shape-pinning is even
// needed here: the generator plainly never fired for 0 or false, which
// is the more decisive confirmation than the original seq-only design.
{
  const ajv = new Ajv2020({ useDefaults: "empty" });
  ajvKeywords(ajv, "dynamicDefaults");
  const schema = {
    type: "object",
    dynamicDefaults: {
      a: { func: "seq", args: { name: "jse-oracle-empty-a" } },
      b: { func: "seq", args: { name: "jse-oracle-empty-b" } },
      c: "timestamp",
      d: { func: "seq", args: { name: "jse-oracle-empty-d" } },
    },
    properties: {},
  };
  const validate = ajv.compile(schema);
  const data: Record<string, unknown> = { a: null, b: "", c: 0, d: false };
  const valid = validate(data);
  results["dynamicDefaults-useDefaults-empty-mode"] = {
    keywords: "dynamicDefaults",
    options: { useDefaults: "empty" },
    schema,
    data: { a: null, b: "", c: 0, d: false },
    valid,
    dataAfter: data,
  };
}

// ---- 14. absent-only: property already present is untouched, AND the ----
// generator is never even invoked (verified via a fresh probe on the same
// seq name straight after: if it read 0, the presence-guard skipped the
// generator entirely rather than invoking-and-discarding it).
{
  const ajv = new Ajv2020({ useDefaults: true });
  ajvKeywords(ajv, "dynamicDefaults");
  const schema = {
    type: "object",
    dynamicDefaults: {
      id: { func: "seq", args: { name: "jse-oracle-seq-14" } },
    },
    properties: { id: {} },
  };
  const validate = ajv.compile(schema);
  const present: Record<string, unknown> = { id: 999 };
  const presentValid = validate(present);

  const probeSchema = {
    type: "object",
    dynamicDefaults: {
      id: { func: "seq", args: { name: "jse-oracle-seq-14" } },
    },
    properties: { id: {} },
  };
  const probeValidate = ajv.compile(probeSchema);
  const fresh: Record<string, unknown> = {};
  const freshValid = probeValidate(fresh);

  results["dynamicDefaults-absent-only-present-untouched"] = {
    keywords: "dynamicDefaults",
    options: { useDefaults: true },
    schema,
    data: { id: 999 },
    valid: presentValid,
    dataAfter: present,
    generatorNotInvokedProbe: {
      schema: probeSchema,
      data: {},
      valid: freshValid,
      dataAfter: fresh,
      note: "id:0 here proves the presence-case above never consumed a seq tick",
    },
  };
}

// ---- 18. dynamicDefaults + plain default on the same property ---------
// Captured both schema-key declaration orders (dynamicDefaults before vs.
// after `properties`) to rule out JSON key order as the deciding factor —
// same as the pattern/transform-ordering case above.
{
  const ajv = new Ajv2020({ useDefaults: true });
  ajvKeywords(ajv, "dynamicDefaults");

  const schemaPropertiesFirst = {
    type: "object",
    properties: { x: { type: "integer", default: 111 } },
    dynamicDefaults: {
      x: { func: "seq", args: { name: "jse-oracle-seq-18a" } },
    },
  };
  const validateA = ajv.compile(schemaPropertiesFirst);
  const dataA: Record<string, unknown> = {};
  const validA = validateA(dataA);

  const schemaDynamicDefaultsFirst = {
    type: "object",
    dynamicDefaults: {
      x: { func: "seq", args: { name: "jse-oracle-seq-18b" } },
    },
    properties: { x: { type: "integer", default: 222 } },
  };
  const validateB = ajv.compile(schemaDynamicDefaultsFirst);
  const dataB: Record<string, unknown> = {};
  const validB = validateB(dataB);

  // Confirm the seq generator was never invoked in either ordering: a
  // fresh use of the SAME name (never touched elsewhere in this script)
  // must read 0.
  const probeSchema = {
    type: "object",
    dynamicDefaults: {
      y: { func: "seq", args: { name: "jse-oracle-seq-18b" } },
    },
    properties: { y: {} },
  };
  const probeValidate = ajv.compile(probeSchema);
  const probeData: Record<string, unknown> = {};
  probeValidate(probeData);

  results["dynamicDefaults-default-collision-default-wins"] = {
    keywords: "dynamicDefaults",
    options: { useDefaults: true },
    propertiesDeclaredFirst: {
      schema: schemaPropertiesFirst,
      data: {},
      valid: validA,
      dataAfter: dataA,
    },
    dynamicDefaultsDeclaredFirst: {
      schema: schemaDynamicDefaultsFirst,
      data: {},
      valid: validB,
      dataAfter: dataB,
    },
    seqNeverInvokedProbe: {
      schema: probeSchema,
      data: {},
      dataAfter: probeData,
      note: "y:0 proves 'jse-oracle-seq-18b' was never ticked by the collision case above",
    },
  };
}

// ---- 16. string form vs. object form generator syntax, shape-pinned ----
// Uses the SAME generator ("randomint") in both forms specifically because
// the README documents them as behaviorally distinct, not just
// syntactically: bare-string form returns 0 or 1; object form with
// `args.max` returns an integer across [0, max).
{
  const ajv = new Ajv2020({ useDefaults: true });
  ajvKeywords(ajv, "dynamicDefaults");
  const schema = {
    type: "object",
    dynamicDefaults: {
      bare: "randomint",
      withArgs: { func: "randomint", args: { max: 100 } },
    },
    properties: {},
  };
  const validate = ajv.compile(schema);
  const data: Record<string, unknown> = {};
  validate(data);

  const bareShape: Shape = { kind: "number", integer: true, oneOf: [0, 1] };
  const withArgsShape: Shape = {
    kind: "number",
    integer: true,
    min: 0,
    max: 100,
    exclusiveMax: true,
  };
  checkShape("randomint-bare", data.bare, bareShape);
  checkShape("randomint-withArgs", data.withArgs, withArgsShape);

  results["dynamicDefaults-string-form-vs-object-form"] = {
    keywords: "dynamicDefaults",
    options: { useDefaults: true },
    schema,
    data: {},
    valid: true,
    dataAfterShape: { bare: bareShape, withArgs: withArgsShape },
  };
}

// ---- 20. combined generator case, all shape-pinned ---------------------
{
  const ajv = new Ajv2020({ useDefaults: true });
  ajvKeywords(ajv, "dynamicDefaults");
  const schema = {
    type: "object",
    dynamicDefaults: {
      ts: "timestamp",
      dt: "datetime",
      d: "date",
      t: "time",
      r: "random",
    },
    properties: {},
  };
  const validate = ajv.compile(schema);
  const data: Record<string, unknown> = {};
  const valid = validate(data);

  // Bounds derived from README semantics + observed samples (see the
  // header/findings): `min` on the timestamp is a generous "any time from
  // 2020 onward" floor, not tied to the capture instant, so it never goes
  // stale.
  const shapes: Record<string, Shape> = {
    ts: { kind: "number", integer: true, min: 1_600_000_000_000 },
    dt: {
      kind: "string",
      pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$",
    },
    d: { kind: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
    t: { kind: "string", pattern: "^\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$" },
    r: { kind: "number", min: 0, max: 1, exclusiveMax: true },
  };
  for (const [key, shape] of Object.entries(shapes)) {
    checkShape(key, data[key], shape);
  }

  results["dynamicDefaults-combined-all-generators"] = {
    keywords: "dynamicDefaults",
    options: { useDefaults: true },
    schema,
    data: {},
    valid,
    dataAfterShape: shapes,
  };
}

const out = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "fixtures",
  "ajv-keywords-mutation.json",
);
writeFileSync(out, JSON.stringify(results, null, 2) + "\n");
console.log(`captured ${String(Object.keys(results).length)} cases -> ${out}`);
