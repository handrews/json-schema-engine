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
  type SchemaRegistry,
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

/**
 * A `$dynamicRef` application discharged at plan time: its target was the
 * same under every dynamic scope that can reach the site, so it compiles as
 * a static edge (ADR 0004).
 */
export interface DynamicResolution {
  /**
   * The resource whose `$dynamicAnchor` wins the outermost-first scope walk
   * on every reaching path, or `null` when the reference resolves lexically
   * (its fragment is absent, empty, or a pointer, or the lexical target's
   * resource declares no bookending anchor).
   */
  winner: string | null;
}

/** One application edge out of a unit, resolved at plan time. */
export interface PlannedApplication {
  keyword: string;
  app: SubschemaApplication;
  targetKey: string;
  /** present when `app.resolution === "dynamic"` was discharged statically */
  dynamic?: DynamicResolution;
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

// --- Dynamic-reference sites (ADR 0004) --------------------------------
//
// A `$dynamicRef` whose fragment names a bookended `$dynamicAnchor` resolves
// to the outermost resource in the dynamic scope declaring that anchor. In
// an artifact the scope at a compiled site is the chain of unit base URIs
// from the artifact root (the trampoline is one-way, so compiled sites are
// reached only through compiled ancestors), which is a per-root dataflow
// over the unit graph: settleDynamicSites computes, per anchor name, the set
// of possible outermost declarers on arrival at each unit, and a site whose
// set maps to one target compiles as a static edge. Resolving a site adds
// its target's subtree — new paths that can reach other sites — so the plan
// is built in rounds: each round rebuilds from scratch under the current
// site decisions, then re-settles; decisions move only unknown → resolved →
// unstable, so the loop ends within (#sites + 1) rounds.

/** A site's decision, carried across rounds. */
type SiteState =
  | { kind: "resolved"; target: SchemaRef; winner: string | null }
  | { kind: "unstable" };

/** A dynamic site seen in a round: what settling needs to decide it. */
interface RoundSite {
  key: string;
  /** the unit holding the keyword: the scope walk starts from its arrival set */
  unit: string;
  anchor: string;
  lexical: SchemaRef;
}

const siteKey = (unit: string, keyword: string, ref: string): string =>
  `${unit}|${keyword}|${ref}`;

type EdgeResolution =
  | {
      kind: "resolved";
      target: SchemaRef;
      dynamic?: DynamicResolution;
      site?: RoundSite;
    }
  | { kind: "unresolvable" } // UnresolvableRefError: lazy-failure parity
  | { kind: "unstable" } // dynamic site not provably scope-independent
  | { kind: "pending"; site: RoundSite }; // dynamic site not yet decided this build

/**
 * Resolves one application's target the way the interpreter would: lexically
 * for `$ref` and child positions, and for a `$dynamicRef` through the shared
 * registry prelude plus the current round's site decisions. `$recursiveRef`
 * and any dynamic-scope keyword without a `resolution` fact are always
 * `unstable` (islanded).
 */
function resolveEdge(
  registry: SchemaRegistry,
  from: SchemaRef,
  keyword: string,
  app: SubschemaApplication,
  sites: ReadonlyMap<string, SiteState>,
): EdgeResolution {
  try {
    if (app.ref === undefined) {
      return {
        kind: "resolved",
        target: registry.child(from, [app.sibling ?? keyword, ...app.path]),
      };
    }
    if (app.resolution === undefined) {
      return {
        kind: "resolved",
        target: registry.resolveRef(app.ref, from.baseUri),
      };
    }
    if (app.resolution !== "dynamic") return { kind: "unstable" };
    const { lexical, anchor } = registry.dynamicReference(
      app.ref,
      from.baseUri,
    );
    if (anchor === null) {
      return { kind: "resolved", target: lexical, dynamic: { winner: null } };
    }
    const unit = unitKey(from);
    const site: RoundSite = {
      key: siteKey(unit, keyword, app.ref),
      unit,
      anchor,
      lexical,
    };
    const state = sites.get(site.key);
    if (state === undefined) return { kind: "pending", site };
    if (state.kind === "unstable") return { kind: "unstable" };
    return {
      kind: "resolved",
      target: state.target,
      dynamic: { winner: state.winner },
      site,
    };
  } catch (err) {
    if (err instanceof UnresolvableRefError) return { kind: "unresolvable" };
    throw err;
  }
}

/**
 * The per-anchor dataflow: for every unit, the set of resources that can be
 * the outermost declarer of `anchor` when evaluation arrives at it (`null`
 * = none so far). Seeded at the root, propagated along every static edge
 * (in-place or child, conditional or not — an over-approximation of real
 * paths, so it only ever errs toward "unstable"), joined by union, to a
 * fixpoint.
 */
function outermostDeclarers(
  registry: SchemaRegistry,
  plan: CompilationPlan,
  anchor: string,
): Map<string, Set<string | null>> {
  const decl = (u: PlannedUnit): string | null =>
    registry.dynamicAnchor(u.ref.baseUri, anchor) !== undefined
      ? u.ref.baseUri
      : null;
  const arrival = new Map<string, Set<string | null>>();
  const root = plan.units.get(plan.rootKey)!;
  arrival.set(root.key, new Set([decl(root)]));
  const work = [root.key];
  while (work.length > 0) {
    const u = plan.units.get(work.pop()!)!;
    if (u.kind !== "static") continue;
    const here = arrival.get(u.key)!;
    for (const edge of u.edges) {
      const v = plan.units.get(edge.targetKey)!;
      let there = arrival.get(v.key);
      if (there === undefined) {
        there = new Set();
        arrival.set(v.key, there);
      }
      const own = decl(v);
      let grew = false;
      for (const w of here) {
        const c = w ?? own;
        if (!there.has(c)) {
          there.add(c);
          grew = true;
        }
      }
      if (grew) work.push(v.key);
    }
  }
  return arrival;
}

/**
 * Decides every dynamic site the round saw. Returns whether any decision
 * changed (another round is needed). A site whose arrival set maps to one
 * target resolves to it; two or more targets, or a change to an
 * already-resolved site, is unstable — permanently, which is what bounds
 * the round loop.
 */
function settleDynamicSites(
  registry: SchemaRegistry,
  plan: CompilationPlan,
  seen: ReadonlyMap<string, RoundSite>,
  sites: Map<string, SiteState>,
): boolean {
  if (seen.size === 0) return false;
  const byAnchor = new Map<string, RoundSite[]>();
  for (const site of seen.values()) {
    const list = byAnchor.get(site.anchor) ?? [];
    list.push(site);
    byAnchor.set(site.anchor, list);
  }
  let changed = false;
  for (const [anchor, list] of byAnchor) {
    const arrival = outermostDeclarers(registry, plan, anchor);
    for (const site of list) {
      const set = arrival.get(site.unit);
      // Unreachable through static edges this round (an ancestor islanded
      // after the unit was planned): nothing depends on the decision.
      if (set === undefined || set.size === 0) continue;
      const targets = new Map<string, SiteState & { kind: "resolved" }>();
      for (const winner of set) {
        const target =
          winner === null
            ? site.lexical
            : registry.dynamicAnchor(winner, anchor)!;
        targets.set(unitKey(target), { kind: "resolved", target, winner });
      }
      const prev = sites.get(site.key);
      if (prev?.kind === "unstable") continue;
      if (targets.size === 1) {
        const [only] = targets.values();
        if (prev === undefined) {
          sites.set(site.key, only!);
          changed = true;
        } else if (unitKey(prev.target) !== unitKey(only!.target)) {
          sites.set(site.key, { kind: "unstable" });
          changed = true;
        }
      } else {
        sites.set(site.key, { kind: "unstable" });
        changed = true;
      }
    }
  }
  return changed;
}

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
  const rootRef = registry.rootRef(schemaUri);
  // Rounds: see "Dynamic-reference sites" above. A schema without dynamic
  // sites settles in one round.
  const sites = new Map<string, SiteState>();
  for (;;) {
    const round = planRound(registry, rootRef, options, sites);
    if (!settleDynamicSites(registry, round.plan, round.sites, sites)) {
      return round.plan;
    }
  }
}

function planRound(
  registry: SchemaRegistry,
  rootRef: SchemaRef,
  options: PlanOptions,
  sites: ReadonlyMap<string, SiteState>,
): { plan: CompilationPlan; sites: Map<string, RoundSite> } {
  const units = new Map<string, PlannedUnit>();
  const patterns = new Set<string>();
  const formats = new Set<string>();
  const roundSites = new Map<string, RoundSite>();

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
    // Dynamic applications are resolved here, before any child is planned,
    // so an unstable site islands the node at the same point the old
    // unconditional island did — never with half-planned children.
    const preResolved = new Map<SubschemaApplication, EdgeResolution>();
    let consumerPresent = false;
    for (const entry of dialect.ordered) {
      if (refOnly && entry.name !== "$ref") continue;
      if (!Object.hasOwn(node, entry.name)) continue;
      const behavior = entry.behavior;
      const value = node[entry.name]!;
      const facts = behavior.analyze?.(value, { schema: node }) ?? {};
      if (facts.dynamicScopeSensitive) {
        const apps = facts.applications ?? [];
        if (
          apps.length === 0 ||
          apps.some((a) => a.ref === undefined || a.resolution !== "dynamic")
        ) {
          // $recursiveRef, or a dynamic-scope keyword the planner has no
          // static resolver for: the island it always was.
          unit.kind = "interpreted";
          unit.cause = "dynamic";
          return unit;
        }
        for (const app of apps) {
          const r = resolveEdge(registry, ref, entry.name, app, sites);
          if (r.kind === "unstable") {
            unit.kind = "interpreted";
            unit.cause = "dynamic";
            return unit;
          }
          if (r.kind === "unresolvable") {
            // Lazy-failure parity, as for an unresolvable $ref below.
            unit.kind = "interpreted";
            unit.cause = "unlowerable";
            return unit;
          }
          if (r.site !== undefined) roundSites.set(r.site.key, r.site);
          preResolved.set(app, r);
        }
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
        const halves = coverageHalves(registry, ref, new Set(), true, sites);
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
        const r =
          preResolved.get(app) ?? resolveEdge(registry, ref, name, app, sites);
        if (r.kind === "pending") continue; // decided by settling; no edge yet
        if (r.kind === "unresolvable" || r.kind === "unstable") {
          // Lazy-failure parity: the interpreter throws only when the
          // reference is actually followed, so the whole node falls back.
          // (An unstable dynamic site was islanded above; this arm is the
          // unresolvable $ref/child case.)
          unit.kind = "interpreted";
          unit.cause = r.kind === "unstable" ? "dynamic" : "unlowerable";
          unit.edges = [];
          return unit;
        }
        const target = r.target;
        const edge: PlannedApplication =
          r.dynamic === undefined
            ? { keyword: name, app, targetKey: unitKey(target) }
            : {
                keyword: name,
                app,
                targetKey: unitKey(target),
                dynamic: r.dynamic,
              };
        const targetKey = edge.targetKey;
        if (app.mode === "inPlace") {
          if (inPlaceChain.includes(targetKey) || targetKey === key) {
            // In-place cycle: same-cursor re-entry. The interpreter's
            // seen-set gives exact InfiniteLoopError parity.
            const t =
              units.get(targetKey) ?? plan(target, [...inPlaceChain, key]);
            t.kind = "interpreted";
            t.cause = "cycle";
            t.edges = [];
            unit.edges.push(edge);
            continue;
          }
          plan(target, [...inPlaceChain, key]);
        } else {
          plan(target, []);
        }
        unit.edges.push(edge);
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
    plan: {
      rootKey: root.key,
      units,
      patterns: [...patterns],
      formats: [...formats],
      targets,
    },
    sites: roundSites,
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
  registry: SchemaRegistry,
  ref: SchemaRef,
  visiting: Set<string>,
  excludeConsumers: boolean,
  sites: ReadonlyMap<string, SiteState>,
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
        // A dynamic site resolves the way the plan resolves it — a pending
        // or unstable site is statically unknowable, like an unresolvable ref.
        const r = resolveEdge(registry, ref, entry.name, app, sites);
        if (r.kind !== "resolved") return { name: null, index: null };
        fold(coverageHalves(registry, r.target, visiting, false, sites));
      }
      if (!acc.name && !acc.index) return acc; // both dynamic already
    }
    return acc;
  } finally {
    visiting.delete(key);
  }
}
