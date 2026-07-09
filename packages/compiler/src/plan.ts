// Compilation planner (M6.2): classifies every reachable schema node as a
// static (compilable) or interpreted (trampoline) unit, using ONLY public
// core APIs and analyze() facts — never keyword names (D1). Conservative by
// design: anything uncertain falls back to the interpreter, which is always
// correct.

import {
  DIALECT_2019_09,
  DIALECT_2020_12,
  DIALECT_DRAFT_06,
  DIALECT_DRAFT_07,
  UnresolvableRefError,
  type Engine,
  type JsonValue,
  type SchemaRef,
  type StaticFacts,
  type SubschemaApplication,
} from "@jse/core";

// Dialects the planner can compile (M6.6): every dialect whose
// dialect-specific keywords now all carry lower() — 2020-12, 2019-09
// (items/additionalItems/then/else/unevaluatedItems/unevaluatedProperties,
// vocab2019.ts), and draft-07/06 (vocab7.ts). draft-04 stays off this list
// (M10 note): its lowerings are a separate, not-yet-built milestone.
const COMPILABLE_DIALECTS: ReadonlySet<string> = new Set([
  DIALECT_2020_12,
  DIALECT_2019_09,
  DIALECT_DRAFT_07,
  DIALECT_DRAFT_06,
]);

/** Why a unit is interpreted rather than compiled. */
export type FallbackCause =
  | "dynamic" // $dynamicRef-class keyword present
  | "unlowerable" // a keyword without lower(), or unevaluated* without static coverage
  | "dialect" // node's dialect is not 2020-12
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
export function buildPlan(engine: Engine, schemaUri: string): CompilationPlan {
  const registry = engine.registry;
  const units = new Map<string, PlannedUnit>();
  const patterns = new Set<string>();

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

    const dialect = registry.dialectFor(ref.baseUri);
    if (!COMPILABLE_DIALECTS.has(dialect.uri)) {
      unit.kind = "interpreted";
      unit.cause = "dialect";
      return unit;
    }

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
      if ((facts.consumes?.length ?? 0) > 0) consumerPresent = true;
      for (const rx of facts.regexes ?? []) patterns.add(rx);
      present.push({ name: entry.name, facts });
    }
    // Unknown keywords: annotation-only productions, elided in flag mode.

    // Consumer licensing (D9a): a consumer lowers only when its coverage
    // kind is statically known — from this object's own contributors plus,
    // transitively, unconditional asserting in-place applications (allOf
    // conjuncts, $ref chains). Anything runtime-conditional (anyOf/oneOf/
    // if/dependentSchemas branches, if's condition, dynamic references,
    // cycles) makes that coverage kind dynamic and the node interpreted.
    if (consumerPresent) {
      const halves = coverageHalves(registry, ref, new Set(), true);
      const needsNames = present.some(
        (k) => (k.facts.consumes?.length ?? 0) > 0 && k.facts.evaluatesNames,
      );
      const needsIndexes = present.some(
        (k) => (k.facts.consumes?.length ?? 0) > 0 && k.facts.evaluatesIndexes,
      );
      if (
        (needsNames && halves.name === null) ||
        (needsIndexes && halves.index === null)
      ) {
        unit.kind = "interpreted";
        unit.cause = "unlowerable";
        return unit;
      }
      unit.coverage = {
        names: halves.name ? [...halves.name.names] : [],
        patterns: halves.name ? halves.name.patterns : [],
        coversAllNames: halves.name?.all ?? false,
        prefixCount: halves.index?.prefix ?? 0,
        coversAllIndexes: halves.index?.all ?? false,
      };
      for (const pat of unit.coverage.patterns) patterns.add(pat);
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
  registry: import("@jse/core").SchemaRegistry,
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
    const dialect = registry.dialectFor(ref.baseUri);
    if (!COMPILABLE_DIALECTS.has(dialect.uri))
      return { name: null, index: null };
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
