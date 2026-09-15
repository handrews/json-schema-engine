// Compilation planner (M6.2): classifies every reachable schema node as a
// static (compilable) or interpreted (trampoline) unit, using ONLY public
// core APIs and analyze() facts — never keyword names (D1). Conservative by
// design: anything uncertain falls back to the interpreter, which is always
// correct.

import {
  UnresolvableRefError,
  type Engine,
  type JsonValue,
  type SchemaRef,
  type StaticFacts,
  type SubschemaApplication,
} from "@json-schema-engine/core";

/** Why a unit is interpreted rather than compiled. */
export type FallbackCause =
  | "dynamic" // $dynamicRef-class keyword present
  | "unlowerable" // a keyword without lower(), or unevaluated* without static coverage
  | "cycle" // participates in a possible in-place cycle
  | "nonSchema"; // ref-into-data; the interpreter's D19 backstop reports it

/** Static evaluated-name coverage for one schema object (slice: own-node trio only). */
export interface StaticNameCoverage {
  names: readonly string[];
  patterns: readonly string[];
  coversAllNames: boolean;
  prefixCount: number;
  coversAllIndexes: boolean;
}

/** One application edge out of a unit, resolved at plan time. */
export interface PlannedApplication {
  keyword: string;
  app: SubschemaApplication;
  targetKey: string;
}

export interface PlannedUnit {
  key: string; // `${baseUri}#${pointer}` — canonical unit identity
  ref: SchemaRef;
  kind: "static" | "interpreted";
  cause?: FallbackCause;
  /** static units: resolved outgoing application edges (keyword order preserved) */
  edges: PlannedApplication[];
  /** static coverage for this schema object, when computable (slice rule) */
  coverage: StaticNameCoverage | null;
  /**
   * Consumer compiled with RUNTIME evaluated-set tracking instead of the
   * interpreter (COMPILED-CONSUMERS.md phase B): a flag-mode consumer whose
   * evaluated coverage is dynamic (static licensing failed), or ANY list-mode
   * consumer (list plans never static-license — see PlanOptions.output).
   * `coverage` stays null; the unit's body threads a runtime coverage channel
   * through its in-place closure (its {@link inRegion} members) and its
   * consumer keywords read it. Never set together with {@link inRegion}
   * (nested tracked consumers island).
   */
  tracking?: boolean;
  /**
   * A static unit in some tracked unit's in-place coverage region: reachable
   * from a tracked (or region) unit via in-place edges. Emitted with a second
   * calling convention (a trailing coverage channel) so its producers'
   * post-success coverage flows to the consumer (COMPILED-CONSUMERS.md phase B).
   */
  inRegion?: boolean;
  /** true when any apply path from this unit can reach an interpreted unit */
  reachesInterpreted: boolean;
  /** number of planned edges targeting this unit (D9 inline licensing) */
  useCount: number;
}

export interface CompilationPlan {
  rootKey: string;
  units: Map<string, PlannedUnit>;
  /** every regex source any static unit tests (pattern + coverage patterns) */
  patterns: string[];
  /** every format name any static unit's asserting `format` tests */
  formats: string[];
  /** interpreted units in stable order; index = target-table slot */
  targets: PlannedUnit[];
}

const unitKey = (ref: SchemaRef): string => `${ref.baseUri}#${ref.pointer}`;

const isObj = (v: JsonValue): v is Record<string, JsonValue> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Build the compilation plan for one registered root schema. The walk mirrors
 * the registration walk's position logic by construction: descent uses the
 * same analyze() facts and the same registry.child pointer navigation.
 */
/** Options for {@link buildPlan}. */
export interface PlanOptions {
  /**
   * The artifact's output mode. Static-coverage licensing for unevaluated*
   * consumers is sound for "flag" only: coverage models the parent-SUCCESS
   * path, but when a contributor (e.g. prefixItems inside an allOf branch)
   * FAILS, the interpreter drops its annotations and unevaluated* reports
   * additional errors. That difference is verdict-invisible — the failing
   * contributor already fails the parent — but list output must reproduce
   * the interpreter's error units exactly. So "list" plans NEVER static-
   * license a consumer: every consumer is compiled with runtime coverage
   * tracking (`tracking`), which reproduces the drop-on-failure behavior by
   * construction (a failed application's channel span truncates, so the sweep
   * covers less). "flag" keeps the static-coverage fast path.
   */
  output?: "flag" | "list";
}

export function buildPlan(
  engine: Engine,
  schemaUri: string,
  options: PlanOptions = {},
): CompilationPlan {
  const registry = engine.registry;
  const units = new Map<string, PlannedUnit>();
  const patterns = new Set<string>();
  const formats = new Set<string>();

  const rootRef = registry.rootRef(schemaUri);

  // inPlaceChain: units connected to the current edge via consecutive
  // in-place applications — a back-edge into this chain is an in-place
  // cycle (same-cursor re-entry, InfiniteLoopError class) and its target
  // must stay interpreted. A descending edge resets the chain.
  const plan = (
    ref: SchemaRef,
    inPlaceChain: readonly string[],
  ): PlannedUnit => {
    const key = unitKey(ref);
    const existing = units.get(key);
    if (existing) return existing;

    const unit: PlannedUnit = {
      key,
      ref,
      kind: "static",
      edges: [],
      coverage: null,
      reachesInterpreted: false,
      useCount: 0,
    };
    units.set(key, unit);

    const node = ref.node;
    if (typeof node === "boolean") return unit; // trivially static

    if (!isObj(node)) {
      unit.kind = "interpreted";
      unit.cause = "nonSchema"; // interpreter D19 backstop reports it lazily
      return unit;
    }

    // No dialect allowlist: keyword facts are the compiler's whole window
    // into semantics (D1), so a dialect compiles exactly when every present
    // keyword lowers — the per-keyword check below. That is what lets a
    // dialect PACKAGE (draft-04, future OAS dialects) become compilable
    // purely by shipping lower() on its behaviors; the only dialect-LEVEL
    // semantic the planner must mirror is refIgnoresSiblings, handled
    // generically here.
    const dialect = registry.dialectFor(ref.baseUri);

    // draft-07/06 (D18, engine.ts:397): a $ref makes every sibling keyword
    // act as if absent — plan/lower ONLY $ref, exactly as applySchemaAtDepth
    // skips every non-$ref entry when refOnly. Without this, a draft-07
    // $ref-with-siblings unit would compile both the ref AND the siblings,
    // a real divergence from the interpreter (unreachable before this
    // milestone, since every legacy unit was interpreted regardless).
    const refOnly = dialect.refIgnoresSiblings && Object.hasOwn(node, "$ref");

    // Gather per-keyword facts; classify the node.
    interface KeywordPlan {
      name: string;
      facts: StaticFacts;
    }
    const present: KeywordPlan[] = [];
    let consumerPresent = false;
    for (const entry of dialect.ordered) {
      if (refOnly && entry.name !== "$ref") continue;
      if (!Object.hasOwn(node, entry.name)) continue;
      const behavior = entry.behavior;
      const value = node[entry.name]!;
      const facts = behavior.analyze?.(value, { schema: node }) ?? {};
      if (facts.dynamicScopeSensitive) {
        unit.kind = "interpreted";
        unit.cause = "dynamic";
        return unit;
      }
      if (typeof behavior.lower !== "function") {
        unit.kind = "interpreted";
        unit.cause = "unlowerable";
        return unit;
      }
      // A coverage consumer (unevaluated*) declares `consumes` AND an
      // evaluated-coverage fact; a keyword consuming other dependency data
      // (then/else reading if's outcome) needs no channel.
      if (
        (facts.consumes?.length ?? 0) > 0 &&
        (facts.evaluatesNames !== undefined ||
          facts.evaluatesIndexes !== undefined)
      ) {
        consumerPresent = true;
      }
      for (const rx of facts.regexes ?? []) patterns.add(rx);
      for (const fmt of facts.formats ?? []) formats.add(fmt);
      present.push({ name: entry.name, facts });
    }
    // Unknown keywords: annotations, elided in flag mode.

    // Consumer licensing (D9a): a consumer lowers only when its coverage
    // kind is statically known — from this object's own contributors plus,
    // transitively, unconditional asserting in-place applications (allOf
    // conjuncts, $ref chains). Anything runtime-conditional (anyOf/oneOf/
    // if/dependentSchemas branches, if's condition, dynamic references,
    // cycles) makes that coverage kind dynamic and the node interpreted.
    if (consumerPresent) {
      if (options.output === "list") {
        // See PlanOptions.output: list mode NEVER static-licenses. Static
        // coverage models only the parent-SUCCESS path (the M6.6 finding) —
        // a FAILING contributor's dropped annotations make the interpreter
        // emit additional unevaluated* errors, verdict-invisible but list-
        // visible. Runtime tracking reproduces that by construction: the
        // failed application's channel span truncates and the consumer sweep
        // then covers less. So every list consumer is tracked; the unit stays
        // static and CONTINUES to edge resolution (its tracked body needs
        // planned in-place edges to thread the channel), and the region
        // fixpoint below threads its in-place closure.
        unit.tracking = true;
      } else {
        // Flag mode: static-coverage licensing is sound (verdict-only), so a
        // consumer whose coverage kind is statically known keeps the fast path.
        const halves = coverageHalves(registry, ref, new Set(), true);
        const needsNames = present.some(
          (k) => (k.facts.consumes?.length ?? 0) > 0 && k.facts.evaluatesNames,
        );
        const needsIndexes = present.some(
          (k) =>
            (k.facts.consumes?.length ?? 0) > 0 && k.facts.evaluatesIndexes,
        );
        if (
          (needsNames && halves.name === null) ||
          (needsIndexes && halves.index === null)
        ) {
          // Static licensing failed. FLAG mode compiles the consumer anyway,
          // with runtime evaluated-set tracking (coverage stays null); the
          // unit stays static and CONTINUES to edge resolution / child
          // planning like any static unit — its tracked body needs planned
          // in-place edges to thread the coverage channel through. The region
          // membership of those edges is computed after the walk (below).
          unit.tracking = true;
        } else {
          unit.coverage = {
            names: halves.name ? [...halves.name.names] : [],
            patterns: halves.name ? halves.name.patterns : [],
            coversAllNames: halves.name?.all ?? false,
            prefixCount: halves.index?.prefix ?? 0,
            coversAllIndexes: halves.index?.all ?? false,
          };
          for (const pat of unit.coverage.patterns) patterns.add(pat);
        }
      }
    }

    // Resolve application edges; plan children.
    for (const { name, facts } of present) {
      for (const app of facts.applications ?? []) {
        let target: SchemaRef;
        try {
          if (app.ref !== undefined) {
            target = registry.resolveRef(app.ref, ref.baseUri);
          } else if (app.sibling !== undefined) {
            target = registry.child(ref, [app.sibling, ...app.path]);
          } else {
            target = registry.child(ref, [name, ...app.path]);
          }
        } catch (err) {
          if (err instanceof UnresolvableRefError) {
            // Lazy-failure parity: the interpreter throws only when the
            // reference is actually followed, so the whole node falls back.
            unit.kind = "interpreted";
            unit.cause = "unlowerable";
            unit.edges = [];
            return unit;
          }
          throw err;
        }
        const targetKey = unitKey(target);
        if (app.mode === "inPlace") {
          if (inPlaceChain.includes(targetKey) || targetKey === key) {
            // In-place cycle: same-cursor re-entry. The interpreter's
            // seen-set gives exact InfiniteLoopError parity.
            const t =
              units.get(targetKey) ?? plan(target, [...inPlaceChain, key]);
            t.kind = "interpreted";
            t.cause = "cycle";
            t.edges = [];
            unit.edges.push({ keyword: name, app, targetKey });
            continue;
          }
          plan(target, [...inPlaceChain, key]);
        } else {
          plan(target, []);
        }
        unit.edges.push({ keyword: name, app, targetKey });
      }
    }
    return unit;
  };

  const root = plan(rootRef, []);

  // Coverage-region fixpoint (COMPILED-CONSUMERS.md phase B). A tracked
  // consumer's coverage comes from its own producers AND, recursively, its
  // asserting in-place applications; each static unit in that in-place closure
  // must report its post-success coverage through the runtime channel, so it
  // gets the second (channel-threaded) calling convention (inRegion). Seeded
  // by tracked units, propagated through in-place edges of static units.
  //
  // Exception — a nested tracked consumer reached inside the closure: threading
  // one unit's channel through another's consumer is a v1 non-goal, so it is
  // re-classified interpreted and becomes an ISLAND. The parent then trampolines
  // it (fragCov) and folds its harvested root coverage — no nested channel.
  // Islands and already-interpreted targets reached by region edges stay
  // interpreted. A consumer-bearing STATIC-coverage unit stays a normal region
  // member (its produces flow like any producer's).
  const regionStack = [...units.values()]
    .filter((u) => u.tracking)
    .map((u) => u.key);
  while (regionStack.length > 0) {
    const u = units.get(regionStack.pop()!)!;
    if (u.kind !== "static") continue; // a seed islanded by another seed
    for (const edge of u.edges) {
      if (edge.app.mode !== "inPlace") continue;
      const m = units.get(edge.targetKey)!;
      if (m.kind !== "static") continue; // island target: stays interpreted
      // Boolean subschemas contribute no coverage and fold to a literal at the
      // call site — never a channel-threaded member.
      if (typeof m.ref.node === "boolean") continue;
      if (m.tracking) {
        // Nested tracked consumer: island it (v1 nested-channel simplification).
        m.kind = "interpreted";
        m.cause = "unlowerable";
        m.edges = [];
        delete m.tracking;
        continue;
      }
      if (!m.inRegion) {
        m.inRegion = true;
        regionStack.push(m.key);
      }
    }
  }

  // reachesInterpreted fixpoint over the edge graph.
  let changed = true;
  while (changed) {
    changed = false;
    for (const unit of units.values()) {
      if (unit.kind === "interpreted" || unit.reachesInterpreted) continue;
      for (const edge of unit.edges) {
        const t = units.get(edge.targetKey)!;
        if (t.kind === "interpreted" || t.reachesInterpreted) {
          unit.reachesInterpreted = true;
          changed = true;
          break;
        }
      }
    }
  }

  for (const unit of units.values()) {
    if (unit.kind !== "static") continue;
    for (const edge of unit.edges) units.get(edge.targetKey)!.useCount++;
  }

  const targets = [...units.values()].filter((u) => u.kind === "interpreted");
  return {
    rootKey: root.key,
    units,
    patterns: [...patterns],
    formats: [...formats],
    targets,
  };
}

/** Per-kind static coverage: null = dynamic (statically unknowable). */
interface CoverageHalves {
  name: { names: Set<string>; patterns: string[]; all: boolean } | null;
  index: { prefix: number; all: boolean } | null;
}

/**
 * The evaluated-coverage a schema node contributes at its own cursor (D9a),
 * including — transitively — unconditional asserting in-place applications.
 * `excludeConsumers` is true only for the licensing node itself: a
 * consumer's own coverage fact describes the state AFTER it runs. Inside
 * transitive targets, consumer facts count (post-success contribution).
 * Facts come from analyze() and are valid regardless of which tier
 * evaluates the target, so contribution is independent of compilability.
 */
function coverageHalves(
  registry: import("@json-schema-engine/core").SchemaRegistry,
  ref: SchemaRef,
  visiting: Set<string>,
  excludeConsumers: boolean,
): CoverageHalves {
  const key = unitKey(ref);
  if (visiting.has(key)) return { name: null, index: null }; // cycle
  visiting.add(key);
  try {
    const node = ref.node;
    if (typeof node === "boolean") {
      // Contributes nothing; `false` fails the parent, making coverage moot.
      return {
        name: { names: new Set(), patterns: [], all: false },
        index: { prefix: 0, all: false },
      };
    }
    if (!isObj(node)) return { name: null, index: null };
    // Coverage comes from analyze() facts alone, dialect-agnostic (D1) —
    // the keyword-author contract is that evaluates* facts are complete.
    const dialect = registry.dialectFor(ref.baseUri);
    // Same $ref-only reading as buildPlan's refOnly (engine.ts:397): a
    // draft-07/06 sibling contributes nothing when $ref is present.
    const refOnly = dialect.refIgnoresSiblings && Object.hasOwn(node, "$ref");

    const acc: CoverageHalves = {
      name: { names: new Set(), patterns: [], all: false },
      index: { prefix: 0, all: false },
    };
    const fold = (h: CoverageHalves): void => {
      if (acc.name && h.name) {
        for (const n of h.name.names) acc.name.names.add(n);
        acc.name.patterns.push(...h.name.patterns);
        acc.name.all ||= h.name.all;
      } else acc.name = null;
      if (acc.index && h.index) {
        acc.index.prefix = Math.max(acc.index.prefix, h.index.prefix);
        acc.index.all ||= h.index.all;
      } else acc.index = null;
    };

    for (const entry of dialect.ordered) {
      if (refOnly && entry.name !== "$ref") continue;
      if (!Object.hasOwn(node, entry.name)) continue;
      const value = node[entry.name]!;
      const facts = entry.behavior.analyze?.(value, { schema: node }) ?? {};
      if (facts.dynamicScopeSensitive) return { name: null, index: null };
      const isConsumer = (facts.consumes?.length ?? 0) > 0;
      if (!(excludeConsumers && isConsumer)) {
        if (acc.name && facts.evaluatesNames) {
          const c = facts.evaluatesNames;
          if (c.kind === "dynamic") acc.name = null;
          else if (c.kind === "all") acc.name.all = true;
          else if (c.kind === "names")
            for (const n of c.names) acc.name.names.add(n);
          else acc.name.patterns.push(...c.patterns);
        }
        if (acc.index && facts.evaluatesIndexes) {
          const c = facts.evaluatesIndexes;
          if (c.kind === "dynamic") acc.index = null;
          else if (c.kind === "prefix")
            acc.index.prefix = Math.max(acc.index.prefix, c.count);
          // allFrom's start is bounded by this node's own prefix
          // contribution (items starts after sibling prefixItems), so the
          // per-node union covers everything.
          else acc.index.all = true;
        }
      }
      for (const app of facts.applications ?? []) {
        if (app.mode !== "inPlace") continue; // child cursors: no contribution here
        if (app.inverted) continue; // never survives the parent-success path
        if (app.conditional || !app.asserts) {
          // Runtime-conditional contribution (branching, or if's condition
          // merging only on its own success): statically unknowable.
          return { name: null, index: null };
        }
        let target: SchemaRef;
        try {
          target =
            app.ref !== undefined
              ? registry.resolveRef(app.ref, ref.baseUri)
              : registry.child(ref, [app.sibling ?? entry.name, ...app.path]);
        } catch {
          return { name: null, index: null };
        }
        fold(coverageHalves(registry, target, visiting, false));
      }
      if (!acc.name && !acc.index) return acc; // both dynamic already
    }
    return acc;
  } finally {
    visiting.delete(key);
  }
}
