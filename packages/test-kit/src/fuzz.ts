// Seeded, reproducible instance-mutation library for the M6.3 differential
// fuzzer (DESIGN.md M6.3, D12). Every run is a pure function of its seed:
// the same (seed, group index, case index) always produces the same
// mutated instance, so any divergence the differential finds reproduces
// exactly from the reported seed.
//
// IP policy (DESIGN.md D15): mutators and the PRNG are implemented from
// public algorithm descriptions and the JSON Schema specs/suite only. No
// validator or fuzzer library (AJV, Hyperjump, fast-check, schemasafe, …)
// is read, ported, or translated.

import type { JsonValue } from "./index.js";
import { isObject } from "./index.js";

/**
 * Deterministic PRNG. mulberry32 — a well-known public-domain 32-bit
 * generator; chosen for a tiny reproducible state seeded by one integer.
 * Not cryptographic; reproducibility is the only requirement here.
 */
export class Prng {
  private state: number;

  constructor(seed: number) {
    // Fold to an unsigned 32-bit word; a zero seed still advances.
    this.state = seed >>> 0;
  }

  /** Next float in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Integer in [0, n). */
  int(n: number): number {
    return Math.floor(this.next() * n);
  }

  /** Uniformly pick one element; caller guarantees a non-empty array. */
  pick<T>(items: readonly T[]): T {
    return items[this.int(items.length)]!;
  }

  /** True with probability p. */
  chance(p: number): boolean {
    return this.next() < p;
  }
}

/** Derive an independent stream seed from a base seed and coordinates. */
export function deriveSeed(base: number, ...coords: number[]): number {
  // A small integer hash (splitmix-style avalanche on each coordinate) so
  // adjacent (group, case) pairs get well-separated streams.
  let h = base >>> 0;
  for (const c of coords) {
    h = (h ^ (c >>> 0)) >>> 0;
    h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
    h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
    h = (h ^ (h >>> 16)) >>> 0;
  }
  return h >>> 0;
}

// ---------------------------------------------------------------------------
// Edge-value corpora. Constants chosen to probe the boundaries the compiler
// and interpreter must agree on: numeric extremes around the double and
// safe-integer limits, strings that look like other JSON types or carry
// escape/pointer/prototype hazards, and object keys that trip naive
// property access.
// ---------------------------------------------------------------------------

/** Numeric edge values (finite; JSON has no ±Infinity/NaN). */
export const NUMERIC_EDGES: readonly number[] = [
  0,
  -0,
  1,
  -1,
  0.1,
  -0.1,
  5e-324, // smallest positive subnormal double
  Number.MIN_VALUE,
  9007199254740991, // Number.MAX_SAFE_INTEGER
  9007199254740992,
  // 2^53 + 1 written arithmetically: as a literal it silently rounds to 2^53
  // (the precision-loss the mutator means to probe); the sum makes the intent
  // explicit and satisfies no-loss-of-precision.
  2 ** 53 + 1,
  -9007199254740991,
  1e308,
  -1e308,
  1.7976931348623157e308, // Number.MAX_VALUE
  2.220446049250313e-16, // machine epsilon
  3.141592653589793,
  2147483647,
  2147483648,
  -2147483648,
  4294967296,
];

/** String edge values, including type-lookalikes and escape/pointer hazards. */
export const STRING_EDGES: readonly string[] = [
  "",
  " ",
  "0",
  "1",
  "-1",
  "true",
  "false",
  "null",
  "[]",
  "{}",
  "NaN",
  "undefined",
  "\u0000", // NUL
  "😀", // surrogate pair (emoji)
  "\uD83D", // lone high surrogate
  "\uDE00", // lone low surrogate
  " ", // line separator
  " ", // paragraph separator
  "\\", // backslash
  '"', // quote
  "`", // backtick
  "${x}", // template-literal-looking
  "a\nb", // newline
  "a\tb", // tab
  "café", // combining/accented
  "ＡＢＣ", // fullwidth
  "~", // JSON pointer escape hazards below
  "/",
  "~0",
  "~1",
  "~0/",
  "a/b~",
  "__proto__",
  "constructor",
  "prototype",
];

/** Object keys that trip naive property access / prototype handling. */
export const PROTO_TRAP_KEYS: readonly string[] = [
  "__proto__",
  "constructor",
  "prototype",
  "toString",
  "valueOf",
  "hasOwnProperty",
  "isPrototypeOf",
  "propertyIsEnumerable",
  "__defineGetter__",
];

/** JSON Pointer escape hazards used as object keys. */
export const POINTER_ESCAPE_KEYS: readonly string[] = [
  "~",
  "/",
  "~1",
  "~0",
  "~0/",
  "a/b~",
  "//",
  "~~",
];

const PRIMITIVE_EDGES: readonly JsonValue[] = [
  null,
  true,
  false,
  0,
  1,
  -1,
  "",
  "x",
];

// ---------------------------------------------------------------------------
// Mutators. Each takes (prng, instance) and returns a new JsonValue; none
// mutate the input in place (the seed instance and prior pool members must
// stay stable for reproducibility). A mutation is one atomic transform;
// mutateInstance picks one uniformly.
// ---------------------------------------------------------------------------

/** Structural clone (JSON values only; preserves -0 which JSON round-trip drops). */
function clone(value: JsonValue): JsonValue {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(clone);
  const out: Record<string, JsonValue> = {};
  for (const [k, v] of Object.entries(value)) out[k] = clone(v);
  return out;
}

/** Flip to a value of a different JSON type. */
function typeFlip(prng: Prng, value: JsonValue): JsonValue {
  const candidates: JsonValue[] = [
    null,
    prng.chance(0.5),
    prng.pick(NUMERIC_EDGES),
    prng.pick(STRING_EDGES),
    [],
    {},
    [clone(value)],
    { wrapped: clone(value) },
  ];
  return prng.pick(candidates);
}

/** Nudge a number by ±1 or ±epsilon, or swap in a numeric edge. */
function numericNudge(prng: Prng, value: JsonValue): JsonValue {
  if (typeof value !== "number") return prng.pick(NUMERIC_EDGES);
  const kind = prng.int(6);
  switch (kind) {
    case 0:
      return value + 1;
    case 1:
      return value - 1;
    case 2:
      return value + Number.EPSILON;
    case 3:
      return value - Number.EPSILON;
    case 4:
      return -value;
    default:
      return prng.pick(NUMERIC_EDGES);
  }
}

/** Swap in a string edge, or perturb an existing string. */
function stringEdge(prng: Prng, value: JsonValue): JsonValue {
  if (typeof value !== "string" || prng.chance(0.5)) {
    return prng.pick(STRING_EDGES);
  }
  const kind = prng.int(4);
  switch (kind) {
    case 0:
      return value + prng.pick(STRING_EDGES);
    case 1:
      return prng.pick(STRING_EDGES) + value;
    case 2:
      return value === "" ? prng.pick(STRING_EDGES) : value.slice(1);
    default:
      return value.toUpperCase() === value ? value.toLowerCase() : value;
  }
}

/** Add a hazardous key to an object (proto-trap or pointer-escape). */
function addTrapKey(prng: Prng, value: JsonValue): JsonValue {
  const obj = isObject(value) ? { ...value } : {};
  const key = prng.chance(0.5)
    ? prng.pick(PROTO_TRAP_KEYS)
    : prng.pick(POINTER_ESCAPE_KEYS);
  obj[key] = prng.pick(PRIMITIVE_EDGES);
  return obj;
}

/** Mutate an array: add, remove, or swap an element. */
function arrayMutate(prng: Prng, value: JsonValue): JsonValue {
  const arr = Array.isArray(value) ? [...value] : [];
  const kind = prng.int(4);
  if (kind === 0 || arr.length === 0) {
    arr.push(prng.pick(PRIMITIVE_EDGES));
  } else if (kind === 1) {
    arr.splice(prng.int(arr.length), 1);
  } else if (kind === 2 && arr.length >= 2) {
    const i = prng.int(arr.length);
    const j = prng.int(arr.length);
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  } else {
    // duplicate an element (uniqueItems / contains counting hazard)
    arr.push(clone(arr[prng.int(arr.length)]!));
  }
  return arr;
}

/** Mutate an object: add, remove, or replace a member. */
function objectMutate(prng: Prng, value: JsonValue): JsonValue {
  const source: Record<string, JsonValue> = isObject(value) ? value : {};
  const keys = Object.keys(source);
  const kind = prng.int(3);
  if (kind === 1 && keys.length > 0) {
    // Remove one member by rebuilding without it (avoids dynamic `delete`).
    const drop = prng.pick(keys);
    const obj: Record<string, JsonValue> = {};
    for (const [k, v] of Object.entries(source)) {
      if (k !== drop) obj[k] = v;
    }
    return obj;
  }
  const obj = { ...source };
  if (kind === 2 && keys.length > 0) {
    obj[prng.pick(keys)] = prng.pick(PRIMITIVE_EDGES);
  } else {
    const key = prng.chance(0.3)
      ? prng.pick([...PROTO_TRAP_KEYS, ...POINTER_ESCAPE_KEYS])
      : prng.pick(STRING_EDGES);
    obj[key] = prng.pick(PRIMITIVE_EDGES);
  }
  return obj;
}

/** Wrap the value one level deeper, or pad with deep nesting. */
function nestingWrap(prng: Prng, value: JsonValue): JsonValue {
  if (prng.chance(0.3)) {
    // Deep array padding (~50 levels) to probe depth bounds on both tiers.
    let acc: JsonValue = clone(value);
    const depth = 40 + prng.int(20);
    for (let i = 0; i < depth; i++) acc = [acc];
    return acc;
  }
  return prng.chance(0.5) ? [clone(value)] : { k: clone(value) };
}

/** Descend to a random sub-location and apply one mutation there. */
function mutateWithin(prng: Prng, value: JsonValue): JsonValue {
  if (Array.isArray(value) && value.length > 0) {
    const i = prng.int(value.length);
    const copy = [...value];
    copy[i] = mutateInstance(prng, copy[i]!);
    return copy;
  }
  if (isObject(value)) {
    const keys = Object.keys(value);
    if (keys.length > 0) {
      const key = prng.pick(keys);
      return { ...value, [key]: mutateInstance(prng, value[key]!) };
    }
  }
  return typeFlip(prng, value);
}

// M6.4 postmortem: empty containers found two real lowering divergences
// (enum []/anyOf []/oneOf [] silently valid) that no other mutator could
// reach — nothing above ever *empties* a value.
function emptyContainer(prng: Prng, value: JsonValue): JsonValue {
  const kind = prng.int(3);
  if (kind === 0) return [];
  if (kind === 1) return {};
  // Empty a nested container instead of the root, when one exists.
  if (Array.isArray(value) && value.length > 0) {
    const copy = [...value];
    copy[prng.int(copy.length)] = prng.chance(0.5) ? [] : {};
    return copy;
  }
  if (isObject(value)) {
    const keys = Object.keys(value);
    if (keys.length > 0) {
      return { ...value, [prng.pick(keys)]: prng.chance(0.5) ? [] : {} };
    }
  }
  return prng.chance(0.5) ? [] : {};
}

type Mutator = (prng: Prng, value: JsonValue) => JsonValue;

const MUTATORS: readonly Mutator[] = [
  typeFlip,
  numericNudge,
  stringEdge,
  addTrapKey,
  arrayMutate,
  objectMutate,
  nestingWrap,
  mutateWithin,
  emptyContainer,
];

/**
 * Apply one random mutation to `instance`, returning a new value (the input
 * is never modified). Deterministic given the PRNG state.
 */
export function mutateInstance(prng: Prng, instance: JsonValue): JsonValue {
  return prng.pick(MUTATORS)(prng, instance);
}

/**
 * Apply `steps` successive mutations, threading the result through each.
 * Useful for reaching states a single mutation cannot (e.g. a proto key
 * added then nudged), while staying reproducible.
 */
export function mutateChain(
  prng: Prng,
  instance: JsonValue,
  steps: number,
): JsonValue {
  let acc = instance;
  for (let i = 0; i < steps; i++) acc = mutateInstance(prng, acc);
  return acc;
}

/**
 * Extra suite-shaped seed groups for the ANNOTATIONS differential legs. The
 * official suite tests validation, so its schemas barely use the pure
 * annotation producers — no `title` and no unknown keywords anywhere in
 * draft2020-12 — leaving the annotation channel under-exercised by
 * suite-only seeding. These groups add those producers combined with the
 * applicators whose annotations drive placement/merge/drop behavior; the
 * consumers append them to the suite corpus exactly like another suite file.
 */
export const ANNOTATION_SEED_GROUPS: readonly {
  description: string;
  schema: JsonValue;
  tests: { description: string; data: JsonValue; valid: boolean }[];
}[] = [
  {
    description: "title/const producers at nested property positions",
    schema: {
      title: "root",
      properties: {
        a: { title: "a-title", const: 7 },
        b: { properties: { c: { title: "c-title" } } },
      },
    },
    tests: [
      { description: "all match", data: { a: 7, b: { c: 1 } }, valid: true },
      { description: "const miss", data: { a: 8 }, valid: false },
      { description: "non-object", data: 3, valid: true },
    ],
  },
  {
    description: "unknown keywords riding array applicators",
    schema: {
      "x-unknown": { note: ["opaque", 1] },
      prefixItems: [{ title: "t0", "x-mark": true }],
      items: { title: "rest" },
      contains: { type: "number" },
    },
    tests: [
      { description: "mixed array", data: [1, "x", 2], valid: true },
      { description: "empty array", data: [], valid: false },
      { description: "all numbers", data: [1, 2], valid: true },
    ],
  },
  {
    description: "branch annotations under anyOf and if/then/else",
    schema: {
      anyOf: [
        { title: "branch-A", type: "string" },
        { title: "branch-B", type: "number" },
      ],
      if: { type: "number", title: "cond" },
      then: { title: "then-branch", "x-mark": 1 },
      else: { title: "else-branch" },
    },
    tests: [
      { description: "number branch", data: 42, valid: true },
      { description: "string branch", data: "s", valid: true },
      { description: "no branch", data: null, valid: false },
    ],
  },
  {
    description: "property-name annotations feeding unevaluatedProperties",
    schema: {
      properties: { a: true },
      patternProperties: { "^x": { title: "x-title" } },
      additionalProperties: { title: "extra" },
      unevaluatedProperties: false,
    },
    tests: [
      {
        description: "all buckets hit",
        data: { a: 1, xy: 2, other: 3 },
        valid: true,
      },
      { description: "empty object", data: {}, valid: true },
    ],
  },
];

/**
 * Extra suite-shaped seed groups for the compiled-consumer differential legs
 * (COMPILED-CONSUMERS.md phase B). The suite exercises `unevaluated*`
 * verdicts, but the schemas where FLAG-mode runtime coverage tracking can be
 * subtly wrong are under-represented: dynamic-coverage unions, conditional
 * tuples, the sparse `contains` index channel, both-branch `oneOf` merges,
 * `$dynamicRef` islands harvested under a consumer, nested (islanding)
 * consumers, the 2019-09 consumer pair, and non-`false` unevaluated subschemas
 * whose uncovered names must be APPLIED rather than merely rejected. These
 * seeds matter most to the flag leg (which is what runs tracking) but exercise
 * the list and annotations legs too; the consumers append them to the suite
 * corpus exactly like another suite file. Descriptions tag the shape each
 * group probes so a divergence report names the channel it found.
 */
export const CONSUMER_SEED_GROUPS: readonly {
  description: string;
  schema: JsonValue;
  tests: { description: string; data: JsonValue; valid: boolean }[];
}[] = [
  {
    // (a) COMPILED-CONSUMERS.md §1.1 dynamic-properties: an anyOf discriminated
    // union whose coverage is known only at runtime, under uP:false.
    description: "anyOf two-variant union + unevaluatedProperties:false",
    schema: {
      type: "object",
      properties: { kind: { enum: ["k1", "k2"] } },
      required: ["kind"],
      anyOf: [
        {
          properties: {
            kind: { const: "k1" },
            a: { type: "string" },
            b: { type: "string" },
            c: { type: "string" },
          },
          required: ["a"],
        },
        {
          properties: {
            kind: { const: "k2" },
            d: { type: "string" },
            e: { type: "string" },
            f: { type: "string" },
          },
          required: ["d"],
        },
      ],
      unevaluatedProperties: false,
    },
    tests: [
      {
        description: "k1 branch covered",
        data: { kind: "k1", a: "x", b: "y" },
        valid: true,
      },
      {
        description: "k2 branch covered",
        data: { kind: "k2", d: "z" },
        valid: true,
      },
      {
        description: "unevaluated extra prop",
        data: { kind: "k1", a: "x", z: 1 },
        valid: false,
      },
      {
        description: "no branch matches",
        data: { kind: "k1", b: "y" },
        valid: false,
      },
    ],
  },
  {
    // (b) COMPILED-CONSUMERS.md §1.1 dynamic-items: a conditional tuple whose
    // prefix length is known only after `if` runs, under unevaluatedItems.
    description: "if/then prefixItems + unevaluatedItems",
    schema: {
      type: "array",
      if: { prefixItems: [{ const: "tagged" }] },
      then: { prefixItems: [true, { type: "number" }] },
      unevaluatedItems: { type: "boolean" },
    },
    tests: [
      {
        description: "tagged, then-prefix covers both",
        data: ["tagged", 5],
        valid: true,
      },
      {
        description: "tagged, trailing boolean",
        data: ["tagged", 5, true],
        valid: true,
      },
      {
        description: "tagged, trailing non-boolean",
        data: ["tagged", 5, "x"],
        valid: false,
      },
      {
        description: "untagged, all unevaluated must be boolean",
        data: [false, true],
        valid: true,
      },
    ],
  },
  {
    // (c) COMPILED-CONSUMERS.md §1.3 sparse-index channel: `contains` marks a
    // non-prefix index evaluated, leaving a gap the unevaluatedItems sweep must
    // honor (the case where AJV returns the wrong verdict).
    description: "contains + prefixItems + unevaluatedItems (sparse index)",
    schema: {
      type: "array",
      prefixItems: [{ type: "string" }],
      contains: { type: "number", minimum: 10 },
      unevaluatedItems: { type: "boolean" },
    },
    tests: [
      {
        description: "gap index rejected",
        data: ["s", 12, "not-bool"],
        valid: false,
      },
      { description: "gap index boolean", data: ["s", 12, true], valid: true },
      { description: "no gap", data: ["s", 12], valid: true },
      {
        description: "contains at tail, sparse middle",
        data: ["s", true, 15],
        valid: true,
      },
    ],
  },
  {
    // (d) COMPILED-CONSUMERS.md §6 both-branches-pass: coverage from every
    // oneOf branch merges before the keyword failure discards the span.
    description:
      "oneOf both branches pass then fail, under unevaluatedProperties",
    schema: {
      type: "object",
      oneOf: [
        { properties: { a: { type: "string" } }, required: ["a"] },
        { properties: { b: { type: "string" } }, required: ["b"] },
      ],
      unevaluatedProperties: false,
    },
    tests: [
      { description: "exactly branch A", data: { a: "x" }, valid: true },
      { description: "exactly branch B", data: { b: "y" }, valid: true },
      {
        description: "both branches pass (merge then fail)",
        data: { a: "x", b: "y" },
        valid: false,
      },
      { description: "neither branch", data: { c: 1 }, valid: false },
    ],
  },
  {
    // (e) COMPILED-CONSUMERS.md §2 rule 5: a $dynamicRef island applied
    // in-place under a consumer must contribute its harvested coverage.
    description: "$dynamicRef island inside a tracked consumer region",
    schema: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $defs: {
        item: {
          $dynamicAnchor: "T",
          type: "object",
          properties: { x: { type: "string" } },
        },
      },
      allOf: [{ $dynamicRef: "#T" }],
      unevaluatedProperties: false,
    },
    tests: [
      { description: "island covers x", data: { x: "hello" }, valid: true },
      {
        description: "uncovered prop after island",
        data: { x: "hi", y: 2 },
        valid: false,
      },
      { description: "empty object", data: {}, valid: true },
      { description: "island fails", data: { x: 5 }, valid: false },
    ],
  },
  {
    // (f) COMPILED-CONSUMERS.md §2 nested consumers: an in-place allOf branch
    // that itself carries unevaluatedProperties islands from the outer region.
    description: "nested unevaluatedProperties consumer (islanding path)",
    schema: {
      type: "object",
      allOf: [
        {
          properties: { a: { type: "string" } },
          unevaluatedProperties: false,
        },
      ],
      unevaluatedProperties: false,
    },
    tests: [
      { description: "inner covers a", data: { a: "x" }, valid: true },
      {
        description: "inner rejects extra",
        data: { a: "x", b: 1 },
        valid: false,
      },
      { description: "empty object", data: {}, valid: true },
      { description: "inner type fails", data: { a: 5 }, valid: false },
    ],
  },
  {
    // (g) 2019-09 variant of (a): the 2019 consumer pair has its own runtime
    // path; the embedded $schema switches the group's dialect even under the
    // default-2020-12 legs.
    description: "2019-09 anyOf union + unevaluatedProperties:false",
    schema: {
      $schema: "https://json-schema.org/draft/2019-09/schema",
      type: "object",
      properties: { kind: { enum: ["k1", "k2"] } },
      required: ["kind"],
      anyOf: [
        {
          properties: {
            kind: { const: "k1" },
            a: { type: "string" },
            b: { type: "string" },
          },
          required: ["a"],
        },
        {
          properties: {
            kind: { const: "k2" },
            d: { type: "string" },
            e: { type: "string" },
          },
          required: ["d"],
        },
      ],
      unevaluatedProperties: false,
    },
    tests: [
      {
        description: "k1 branch covered",
        data: { kind: "k1", a: "x", b: "y" },
        valid: true,
      },
      {
        description: "k2 branch covered",
        data: { kind: "k2", d: "z" },
        valid: true,
      },
      {
        description: "unevaluated extra prop",
        data: { kind: "k2", d: "z", q: 1 },
        valid: false,
      },
      {
        description: "no branch matches",
        data: { kind: "k2", e: "y" },
        valid: false,
      },
    ],
  },
  {
    // (h) non-false unevaluatedProperties: uncovered names must be APPLIED to
    // the subschema, so a covered miss is a type failure, not an existence one.
    description:
      "unevaluatedProperties non-false subschema (uncovered applied)",
    schema: {
      type: "object",
      properties: { a: { type: "string" } },
      anyOf: [
        { properties: { b: { type: "string" } } },
        { properties: { c: { type: "string" } } },
      ],
      unevaluatedProperties: { type: "integer" },
    },
    tests: [
      {
        description: "uncovered integer accepted",
        data: { a: "x", z: 5 },
        valid: true,
      },
      {
        description: "uncovered non-integer rejected",
        data: { a: "x", z: "no" },
        valid: false,
      },
      {
        description: "branch-covered plus uncovered integer",
        data: { a: "x", b: "y", extra: 9 },
        valid: true,
      },
      {
        description: "uncovered boolean rejected",
        data: { a: "x", extra: true },
        valid: false,
      },
    ],
  },
];

/**
 * Build a pool of `count` instances seeded from `seedInstances` (typically a
 * suite group's own `data` values). The seed instances are included verbatim
 * first, then each additional slot is a 1–3-step mutation chain starting from
 * a randomly chosen seed. A `null`-only seed set still yields useful edge
 * coverage via the mutators' built-in corpora.
 */
export function instancePool(
  prng: Prng,
  seedInstances: readonly JsonValue[],
  count: number,
): JsonValue[] {
  const seeds = seedInstances.length > 0 ? seedInstances : [null];
  const pool: JsonValue[] = [];
  for (const seed of seeds) {
    if (pool.length >= count) break;
    pool.push(seed);
  }
  while (pool.length < count) {
    const base = prng.pick(seeds);
    const steps = 1 + prng.int(3);
    pool.push(mutateChain(prng, base, steps));
  }
  return pool;
}

/**
 * Suite-shaped seed groups for `$dynamicRef` resolution (ADR 0004). The
 * compiler resolves a site at plan time when every path that can reach it
 * yields the same target, and islands it otherwise; `classification` says
 * which the planner must choose for the group's sites. The differential
 * legs append these like {@link CONSUMER_SEED_GROUPS}, so both the static
 * path (resolved targets, including recursion through them) and the island
 * path (unstable sites through the trampoline) stay under fuzz pressure.
 */
export interface DynamicSeedGroup {
  description: string;
  schema: JsonValue;
  tests: { description: string; data: JsonValue; valid: boolean }[];
  /** what the planner must do with every dynamic-scope site in the group */
  classification: "static" | "island";
}

const DYNAMIC_DIALECT = "https://json-schema.org/draft/2020-12/schema";

export const DYNAMIC_SEEDS = {
  /** the root declares the anchor; the site recurses through it */
  stableSingle: {
    description: "$dynamicRef: root anchor, recursion through the target",
    classification: "static",
    schema: {
      $schema: DYNAMIC_DIALECT,
      $id: "https://dyn.example/stable-single",
      $dynamicAnchor: "node",
      type: "object",
      properties: { child: { $dynamicRef: "#node" } },
    },
    tests: [
      {
        description: "nested objects",
        data: { child: { child: {} } },
        valid: true,
      },
      { description: "empty root", data: {}, valid: true },
      {
        description: "non-object leaf",
        data: { child: { child: "x" } },
        valid: false,
      },
    ],
  },
  /** one bookended site reached along two paths that agree on the winner */
  stableTwoPaths: {
    description: "$dynamicRef: same site under two scopes, same resolution",
    classification: "static",
    schema: {
      $schema: DYNAMIC_DIALECT,
      $id: "https://dyn.example/stable-two-paths",
      $defs: {
        item: { $dynamicAnchor: "item", type: "number" },
        shared: {
          $id: "shared",
          $defs: { bookend: { $dynamicAnchor: "item" } },
          type: "array",
          items: { $dynamicRef: "#item" },
        },
        a: { $id: "a", $ref: "shared" },
        b: { $id: "b", $ref: "shared" },
      },
      anyOf: [{ $ref: "a" }, { $ref: "b" }],
    },
    tests: [
      { description: "numbers", data: [1, 2], valid: true },
      { description: "empty", data: [], valid: true },
      { description: "a string", data: ["x"], valid: false },
    ],
  },
  /** the resolved target itself carries a `$dynamicRef` */
  chained: {
    description: "$dynamicRef: resolved target carries another $dynamicRef",
    classification: "static",
    schema: {
      $schema: DYNAMIC_DIALECT,
      $id: "https://dyn.example/chained",
      $defs: {
        mid: {
          $dynamicAnchor: "mid",
          type: "object",
          properties: { b: { $dynamicRef: "#inner" } },
        },
        inner: { $dynamicAnchor: "inner", type: "integer" },
      },
      properties: { a: { $dynamicRef: "#mid" } },
    },
    tests: [
      { description: "integer leaf", data: { a: { b: 1 } }, valid: true },
      { description: "empty", data: {}, valid: true },
      { description: "string leaf", data: { a: { b: "x" } }, valid: false },
      { description: "non-object mid", data: { a: 1 }, valid: false },
    ],
  },
  /** no bookending `$dynamicAnchor` at the lexical target: plain `$ref` */
  bookendAbsent: {
    description: "$dynamicRef: no bookending anchor, resolves lexically",
    classification: "static",
    schema: {
      $schema: DYNAMIC_DIALECT,
      $id: "https://dyn.example/bookend-absent",
      $ref: "list",
      $defs: {
        foo: { $dynamicAnchor: "items", type: "string" },
        list: {
          $id: "list",
          type: "array",
          items: { $dynamicRef: "#items" },
          $defs: { items: { $anchor: "items", type: "number" } },
        },
      },
    },
    tests: [
      { description: "number (lexical target)", data: [1], valid: true },
      {
        description: "string (root anchor ignored)",
        data: ["a"],
        valid: false,
      },
    ],
  },
  /** a non-declaring root that references the 2020-12 metaschema */
  metaschemaWrapper: {
    description:
      "$dynamicRef: $ref to the 2020-12 metaschema from a plain root",
    classification: "static",
    schema: {
      $schema: DYNAMIC_DIALECT,
      $id: "https://dyn.example/metaschema-wrapper",
      $ref: "https://json-schema.org/draft/2020-12/schema",
    },
    tests: [
      { description: "a valid schema", data: { type: "string" }, valid: true },
      { description: "bad type value", data: { type: 12 }, valid: false },
      {
        description: "bad nested keyword",
        data: { properties: { a: { minimum: "x" } } },
        valid: false,
      },
    ],
  },
  /** the official suite's "multiple dynamic paths" shape: two declarers */
  unstableTwoPaths: {
    description:
      "$dynamicRef: same site under two scopes, different resolutions",
    classification: "island",
    schema: {
      $schema: DYNAMIC_DIALECT,
      $id: "https://dyn.example/unstable-two-paths",
      if: { properties: { kind: { const: "numbers" } }, required: ["kind"] },
      then: { $ref: "numbers" },
      else: { $ref: "strings" },
      $defs: {
        generic: {
          $id: "generic",
          $defs: { bookend: { $dynamicAnchor: "item" } },
          type: "object",
          properties: {
            list: { type: "array", items: { $dynamicRef: "#item" } },
          },
        },
        numbers: {
          $id: "numbers",
          $defs: { item: { $dynamicAnchor: "item", type: "number" } },
          $ref: "generic",
        },
        strings: {
          $id: "strings",
          $defs: { item: { $dynamicAnchor: "item", type: "string" } },
          $ref: "generic",
        },
      },
    },
    tests: [
      {
        description: "numbers with numbers",
        data: { kind: "numbers", list: [1] },
        valid: true,
      },
      {
        description: "numbers with a string",
        data: { kind: "numbers", list: ["a"] },
        valid: false,
      },
      {
        description: "strings with strings",
        data: { list: ["a"] },
        valid: true,
      },
      {
        description: "strings with a number",
        data: { list: [1] },
        valid: false,
      },
    ],
  },
  /** two declarers around a shared recursive resource: an island that recurses */
  unstableRecursive: {
    description: "$dynamicRef: unstable site recursing through the trampoline",
    classification: "island",
    schema: {
      $schema: DYNAMIC_DIALECT,
      $id: "https://dyn.example/unstable-recursive",
      if: { properties: { kind: { const: "strict" } }, required: ["kind"] },
      then: { $ref: "strict" },
      else: { $ref: "loose" },
      $defs: {
        tree: {
          $id: "tree",
          $dynamicAnchor: "node",
          type: "object",
          properties: { child: { $dynamicRef: "#node" } },
        },
        strict: {
          $id: "strict",
          $dynamicAnchor: "node",
          title: "node-title",
          $ref: "tree",
          properties: { data: { type: "integer" } },
        },
        loose: {
          $id: "loose",
          $dynamicAnchor: "node",
          title: "node-title",
          $ref: "tree",
          properties: { data: { type: "string" } },
        },
      },
    },
    tests: [
      {
        description: "strict tree",
        data: { kind: "strict", data: 1, child: { data: 2 } },
        valid: true,
      },
      {
        description: "strict tree, string leaf",
        data: { kind: "strict", child: { data: "x" } },
        valid: false,
      },
      {
        description: "loose tree",
        data: { data: "s", child: { data: "t" } },
        valid: true,
      },
      {
        description: "loose tree, integer leaf",
        data: { child: { data: 3 } },
        valid: false,
      },
      {
        description: "non-object child",
        data: { child: { child: "x" } },
        valid: false,
      },
    ],
  },
} as const satisfies Record<string, DynamicSeedGroup>;

export type DynamicSeedName = keyof typeof DYNAMIC_SEEDS;

/** {@link DYNAMIC_SEEDS} in a fixed order, for the differential corpora. */
export const DYNAMIC_SEED_GROUPS: readonly DynamicSeedGroup[] =
  Object.values(DYNAMIC_SEEDS);

const RECURSIVE_DIALECT = "https://json-schema.org/draft/2019-09/schema";
const META_2019 = "https://json-schema.org/draft/2019-09/schema";

/**
 * The `$recursiveRef` counterpart of {@link DYNAMIC_SEEDS} (ADR 0004's
 * amendment): 2019-09's degenerate case rebinds on a root-level
 * `$recursiveAnchor: true` flag instead of a name, and the target is always
 * the winning resource's root. Same shape and classification contract.
 */
export const RECURSIVE_SEEDS = {
  /** the root declares the anchor; the site recurses through it */
  stableSingle: {
    description: "$recursiveRef: root anchor, recursion through the root",
    classification: "static",
    schema: {
      $schema: RECURSIVE_DIALECT,
      $id: "https://rec.example/stable-single",
      $recursiveAnchor: true,
      type: "object",
      properties: { child: { $recursiveRef: "#" } },
    },
    tests: [
      {
        description: "nested objects",
        data: { child: { child: {} } },
        valid: true,
      },
      { description: "empty root", data: {}, valid: true },
      {
        description: "non-object leaf",
        data: { child: { child: "x" } },
        valid: false,
      },
    ],
  },
  /** an extension re-enters itself through the base's site: target ≠ lexical */
  stableExtension: {
    description: "$recursiveRef: extension rebinds the base's recursion",
    classification: "static",
    schema: {
      $schema: RECURSIVE_DIALECT,
      $id: "https://rec.example/stable-extension",
      $recursiveAnchor: true,
      $ref: "stable-extension-base",
      properties: { data: { type: "string" } },
      $defs: {
        base: {
          $id: "stable-extension-base",
          $recursiveAnchor: true,
          type: "object",
          properties: {
            data: true,
            children: { type: "array", items: { $recursiveRef: "#" } },
          },
        },
      },
    },
    tests: [
      {
        description: "string data all the way down",
        data: { data: "a", children: [{ data: "b", children: [] }] },
        valid: true,
      },
      {
        description: "nested data must be a string too (rebinding)",
        data: { children: [{ data: 42 }] },
        valid: false,
      },
      {
        description: "top-level data must be a string",
        data: { data: 1 },
        valid: false,
      },
      {
        description: "children must be objects",
        data: { children: [1] },
        valid: false,
      },
    ],
  },
  /** two paths to one site, both under the same outermost declarer */
  stableTwoPaths: {
    description: "$recursiveRef: same site under two paths, one resolution",
    classification: "static",
    schema: {
      $schema: RECURSIVE_DIALECT,
      $id: "https://rec.example/stable-two-paths",
      $recursiveAnchor: true,
      type: "object",
      properties: { left: { $ref: "inner" }, right: { $ref: "inner" } },
      $defs: {
        inner: {
          $id: "inner",
          $recursiveAnchor: true,
          type: "object",
          properties: { child: { $recursiveRef: "#" } },
        },
      },
    },
    tests: [
      {
        description: "child rebinds to the root, which accepts objects",
        data: { left: { child: { right: { child: {} } } } },
        valid: true,
      },
      {
        description: "child rebinds to the root: left must be an object",
        data: { right: { child: { left: "x" } } },
        valid: false,
      },
      {
        description: "non-object child",
        data: { left: { child: 3 } },
        valid: false,
      },
    ],
  },
  /** the site sits in a subschema the root reaches in place */
  chained: {
    description: "$recursiveRef: site under an in-place $ref from the root",
    classification: "static",
    schema: {
      $schema: RECURSIVE_DIALECT,
      $id: "https://rec.example/chained",
      $recursiveAnchor: true,
      type: "object",
      $ref: "#/$defs/shape",
      $defs: {
        shape: {
          properties: {
            next: { $recursiveRef: "#" },
            leaf: { type: "string" },
          },
        },
      },
    },
    tests: [
      {
        description: "chain of shapes",
        data: { next: { next: { leaf: "x" } } },
        valid: true,
      },
      {
        description: "leaf constraint applies at depth",
        data: { next: { leaf: 1 } },
        valid: false,
      },
      {
        description: "next must be an object",
        data: { next: "x" },
        valid: false,
      },
    ],
  },
  /** no anchor anywhere: the site is a plain root reference */
  noAnchor: {
    description: "$recursiveRef: no $recursiveAnchor, behaves like $ref",
    classification: "static",
    schema: {
      $schema: RECURSIVE_DIALECT,
      $id: "https://rec.example/no-anchor",
      type: "object",
      properties: { child: { $recursiveRef: "#" } },
    },
    tests: [
      {
        description: "nested objects",
        data: { child: { child: {} } },
        valid: true,
      },
      { description: "non-object child", data: { child: 1 }, valid: false },
    ],
  },
  /** `$recursiveAnchor: false` is no anchor */
  anchorFalse: {
    description: "$recursiveRef: $recursiveAnchor false, behaves like $ref",
    classification: "static",
    schema: {
      $schema: RECURSIVE_DIALECT,
      $id: "https://rec.example/anchor-false",
      $recursiveAnchor: false,
      type: "object",
      properties: { child: { $recursiveRef: "#" } },
    },
    tests: [
      {
        description: "nested objects",
        data: { child: { child: {} } },
        valid: true,
      },
      { description: "non-object child", data: { child: 1 }, valid: false },
    ],
  },
  /** the lexical target's resource has no anchor: no rebinding (suite shape) */
  initialTargetNoAnchor: {
    description:
      "$recursiveRef: no $recursiveAnchor in the initial target resource",
    classification: "static",
    schema: {
      $schema: RECURSIVE_DIALECT,
      $id: "https://rec.example/initial-target",
      $recursiveAnchor: true,
      $ref: "initial-target-inner",
      properties: { extra: { type: "string" } },
      $defs: {
        inner: {
          $id: "initial-target-inner",
          type: "object",
          properties: { child: { $recursiveRef: "#" } },
        },
      },
    },
    tests: [
      {
        description: "root constraint applies at the top",
        data: { extra: 1 },
        valid: false,
      },
      {
        description: "recursion stays lexical: no root constraint below",
        data: { child: { extra: 1 } },
        valid: true,
      },
      {
        description: "non-object child",
        data: { child: { child: 1 } },
        valid: false,
      },
    ],
  },
  /** a pointer fragment is a plain $ref */
  pointerFragment: {
    description: "$recursiveRef: pointer fragment behaves like $ref",
    classification: "static",
    schema: {
      $schema: RECURSIVE_DIALECT,
      $id: "https://rec.example/pointer-fragment",
      $recursiveAnchor: true,
      properties: { x: { $recursiveRef: "#/$defs/str" } },
      $defs: { str: { type: "string" } },
    },
    tests: [
      { description: "string", data: { x: "a" }, valid: true },
      { description: "number", data: { x: 1 }, valid: false },
    ],
  },
  /** a plain-name fragment is a plain $ref too (unlike $dynamicRef) */
  plainNameFragment: {
    description: "$recursiveRef: plain-name fragment behaves like $ref",
    classification: "static",
    schema: {
      $schema: RECURSIVE_DIALECT,
      $id: "https://rec.example/plain-name-fragment",
      $recursiveAnchor: true,
      properties: { x: { $recursiveRef: "#num" } },
      $defs: { num: { $anchor: "num", type: "number" } },
    },
    tests: [
      { description: "number", data: { x: 1 }, valid: true },
      { description: "string", data: { x: "a" }, valid: false },
    ],
  },
  /** a fragment-less reference to another anchored resource rebinds to the outermost declarer: the root */
  externalRebinds: {
    description:
      "$recursiveRef: external target, root declares, rebinds to root",
    classification: "static",
    schema: {
      $schema: RECURSIVE_DIALECT,
      $id: "https://rec.example/external-rebinds",
      $recursiveAnchor: true,
      type: "object",
      properties: { tag: { type: "string" }, item: { $recursiveRef: "other" } },
      $defs: {
        other: {
          $id: "other",
          $recursiveAnchor: true,
          type: "object",
          properties: { tag: { type: "number" }, item: { $recursiveRef: "#" } },
        },
      },
    },
    tests: [
      {
        description: "item rebinds to the root: string tag",
        data: { item: { tag: "s" } },
        valid: true,
      },
      {
        description: "item rebinds to the root: number tag rejected",
        data: { item: { tag: 1 } },
        valid: false,
      },
      {
        description: "deep",
        data: { item: { item: { tag: "s" } } },
        valid: true,
      },
    ],
  },
  /** the same, from a root that does not declare: lexical target */
  externalLexical: {
    description: "$recursiveRef: external target, root silent, stays lexical",
    classification: "static",
    schema: {
      $schema: RECURSIVE_DIALECT,
      $id: "https://rec.example/external-lexical",
      type: "object",
      properties: { tag: { type: "string" }, item: { $recursiveRef: "other" } },
      $defs: {
        other: {
          $id: "other",
          $recursiveAnchor: true,
          type: "object",
          properties: { tag: { type: "number" }, item: { $recursiveRef: "#" } },
        },
      },
    },
    tests: [
      {
        description: "item is other: number tag",
        data: { item: { tag: 1 } },
        valid: true,
      },
      {
        description: "item is other: string tag rejected",
        data: { item: { tag: "s" } },
        valid: false,
      },
      {
        description: "other recurses into other",
        data: { item: { item: { tag: 2 } } },
        valid: true,
      },
    ],
  },
  /** a plain root $ref-ing the 2019-09 metaschema: 18 sites, one winner */
  metaschemaWrapper: {
    description: "$recursiveRef: plain root $ref-ing the 2019-09 metaschema",
    classification: "static",
    schema: {
      $schema: RECURSIVE_DIALECT,
      $id: "https://rec.example/meta-wrapper",
      $ref: META_2019,
    },
    tests: [
      { description: "a schema", data: { type: "string" }, valid: true },
      { description: "bad type", data: { type: 12 }, valid: false },
      {
        description: "bad nested schema (recursion through the metaschema)",
        data: { properties: { a: { type: "nope" } } },
        valid: false,
      },
    ],
  },
  /** the official suite's "multiple dynamic paths" shape: two declarers */
  unstableTwoPaths: {
    description:
      "$recursiveRef: same site under two scopes, different resolutions",
    classification: "island",
    schema: {
      $schema: RECURSIVE_DIALECT,
      $id: "https://rec.example/unstable-two-paths",
      if: { properties: { kind: { const: "numbers" } }, required: ["kind"] },
      then: { $ref: "numbers" },
      else: { $ref: "strings" },
      $defs: {
        generic: {
          $id: "generic",
          $recursiveAnchor: true,
          type: "object",
          properties: {
            list: { type: "array", items: { $recursiveRef: "#" } },
          },
        },
        numbers: {
          $id: "numbers",
          $recursiveAnchor: true,
          $ref: "generic",
          properties: { value: { type: "number" } },
        },
        strings: {
          $id: "strings",
          $recursiveAnchor: true,
          $ref: "generic",
          properties: { value: { type: "string" } },
        },
      },
    },
    tests: [
      {
        description: "numbers with numbers",
        data: { kind: "numbers", list: [{ value: 1 }] },
        valid: true,
      },
      {
        description: "numbers with a string",
        data: { kind: "numbers", list: [{ value: "a" }] },
        valid: false,
      },
      {
        description: "strings with strings",
        data: { list: [{ value: "a" }] },
        valid: true,
      },
      {
        description: "strings with a number",
        data: { list: [{ value: 1 }] },
        valid: false,
      },
    ],
  },
  /** two declarers around a shared recursive resource, chosen by anyOf */
  unstableRecursive: {
    description: "$recursiveRef: shared recursive resource under two declarers",
    classification: "island",
    schema: {
      $schema: RECURSIVE_DIALECT,
      $id: "https://rec.example/unstable-recursive",
      anyOf: [{ $ref: "numbers" }, { $ref: "strings" }],
      $defs: {
        generic: {
          $id: "generic",
          $recursiveAnchor: true,
          type: "object",
          properties: {
            list: { type: "array", items: { $recursiveRef: "#" } },
          },
        },
        numbers: {
          $id: "numbers",
          $recursiveAnchor: true,
          $ref: "generic",
          properties: { value: { type: "number" } },
        },
        strings: {
          $id: "strings",
          $recursiveAnchor: true,
          $ref: "generic",
          properties: { value: { type: "string" } },
        },
      },
    },
    tests: [
      {
        description: "all numbers",
        data: { list: [{ value: 1 }, { value: 2, list: [{ value: 3 }] }] },
        valid: true,
      },
      {
        description: "all strings",
        data: { list: [{ value: "a" }, { value: "b" }] },
        valid: true,
      },
      {
        description: "mixed: neither branch",
        data: { list: [{ value: 1 }, { value: "a" }] },
        valid: false,
      },
      { description: "empty list", data: { list: [] }, valid: true },
    ],
  },
} as const satisfies Record<string, DynamicSeedGroup>;

export type RecursiveSeedName = keyof typeof RECURSIVE_SEEDS;

/** {@link RECURSIVE_SEEDS} in a fixed order, for the differential corpora. */
export const RECURSIVE_SEED_GROUPS: readonly DynamicSeedGroup[] =
  Object.values(RECURSIVE_SEEDS);
