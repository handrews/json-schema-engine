// Compilation planner (M6.2): classifies every reachable schema node as a
// static (compilable) or interpreted (trampoline) unit, using ONLY public
// core APIs and analyze() facts — never keyword names (D1). Conservative by
// design: anything uncertain falls back to the interpreter, which is always
// correct.

import {
  DIALECT_2020_12,
  UnresolvableRefError,
  type Engine,
  type IndexCoverage,
  type JsonValue,
  type NameCoverage,
  type SchemaRef,
  type StaticFacts,
  type SubschemaApplication,
} from "@jse/core";

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
    if (dialect.uri !== DIALECT_2020_12) {
      unit.kind = "interpreted";
      unit.cause = "dialect";
      return unit;
    }

    // Gather per-keyword facts; classify the node.
    interface KeywordPlan {
      name: string;
      facts: StaticFacts;
    }
    const present: KeywordPlan[] = [];
    let hasInPlace = false;
    let consumerPresent = false;
    const nameCoverages: NameCoverage[] = [];
    const indexCoverages: IndexCoverage[] = [];
    for (const entry of dialect.ordered) {
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
      const isConsumer = (facts.consumes?.length ?? 0) > 0;
      if (isConsumer) consumerPresent = true;
      // A consumer's own coverage fact describes the state AFTER it runs;
      // its sweep is licensed by prior contributors only.
      if (facts.evaluatesNames && !isConsumer)
        nameCoverages.push(facts.evaluatesNames);
      if (facts.evaluatesIndexes && !isConsumer)
        indexCoverages.push(facts.evaluatesIndexes);
      for (const app of facts.applications ?? []) {
        if (app.mode === "inPlace") hasInPlace = true;
      }
      for (const rx of facts.regexes ?? []) patterns.add(rx);
      present.push({ name: entry.name, facts });
    }
    // Unknown keywords: annotation-only productions, elided in flag mode.

    // Consumer licensing (slice rule): a channel consumer lowers only when
    // every coverage contributor is this object's own static trio — any
    // in-place application or dynamic coverage forces the interpreter.
    if (consumerPresent) {
      if (
        hasInPlace ||
        nameCoverages.some((c) => c.kind === "dynamic") ||
        indexCoverages.some((c) => c.kind === "dynamic")
      ) {
        unit.kind = "interpreted";
        unit.cause = "unlowerable";
        return unit;
      }
      const names = new Set<string>();
      const patternList: string[] = [];
      let coversAllNames = false;
      for (const c of nameCoverages) {
        if (c.kind === "names") for (const n of c.names) names.add(n);
        else if (c.kind === "patterns") patternList.push(...c.patterns);
        else if (c.kind === "all") coversAllNames = true;
      }
      let prefixCount = 0;
      let coversAllIndexes = false;
      for (const c of indexCoverages) {
        if (c.kind === "prefix") prefixCount = Math.max(prefixCount, c.count);
        else if (c.kind === "allFrom" || c.kind === "all") {
          coversAllIndexes = true;
        }
      }
      unit.coverage = {
        names: [...names],
        patterns: patternList,
        coversAllNames,
        prefixCount,
        coversAllIndexes,
      };
      for (const p of patternList) patterns.add(p);
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

  const targets = [...units.values()].filter((u) => u.kind === "interpreted");
  return {
    rootKey: root.key,
    units,
    patterns: [...patterns],
    targets,
  };
}
