// Reference produce evaluator (COMPILED-ANNOTATIONS.md §5 stage-1 gate).
//
// An INDEPENDENT interpreter of the produce recipes a keyword's lower()
// emits (LowerProduceValue, core/src/lowering.ts). It runs the collected
// LowerStmt list against a concrete instance and renders each keyword's
// produce exactly as the accumulation-model TSDoc specifies, so the gate can
// differentially check the recipes against the interpreter's own productions
// before the serializer ever consumes them. Depends only on @jse/core (the
// LowerStmt vocabulary and the trampoline live there); it duck-types the
// planner's unit as {@link OracleUnit}, so it never imports @jse/compiler —
// the same one-way dependency discipline census.ts follows.

import {
  evaluateFragment,
  rootCursor,
  canonicalKey,
  codePointLength,
  escapeSegment,
  firstDuplicatePair,
  hasDuplicateItems,
  isMultipleOf,
  jsonEqual,
  type JsonValue,
  type LowerApply,
  type LowerCursor,
  type LowerExpr,
  type LowerProduceValue,
  type LowerStmt,
  type LoweringContext,
  type RegexCache,
  type SchemaRef,
  type SchemaRegistry,
} from "@jse/core";

/** The static evaluated-name coverage a planner attaches to a unit (D9a). */
export interface OracleCoverage {
  names: readonly string[];
  patterns: readonly string[];
  coversAllNames: boolean;
  prefixCount: number;
  coversAllIndexes: boolean;
}

/**
 * The slice of a planned unit the oracle needs: the schema position and its
 * static coverage. Duck-typed so test-kit stays free of \@jse/compiler; a
 * `PlannedUnit` satisfies it structurally.
 */
export interface OracleUnit {
  ref: SchemaRef;
  coverage: OracleCoverage | null;
}

/** One keyword's rendered production. */
export interface RecipeProduction {
  keyword: string;
  value: unknown;
}

const isObjectValue = (v: unknown): v is Record<string, JsonValue> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Per-keyword accumulators the produce recipes read (dedup keeps first). */
interface Accumulators {
  names: string[];
  nameSeen: Set<string>;
  indexes: number[];
  indexSeen: Set<number>;
  /** countRange-counted indexes (contains' matched set), already ascending */
  countedIndexes: number[];
}

const freshAccumulators = (): Accumulators => ({
  names: [],
  nameSeen: new Set(),
  indexes: [],
  indexSeen: new Set(),
  countedIndexes: [],
});

/**
 * Reference-evaluates every produce recipe of `unit`'s schema object against
 * `instance`, returning the productions in execution (dialect) order — the
 * differential oracle for the compiler's produce IR. Boolean schema nodes
 * carry no keywords and produce nothing.
 */
export function evaluateProduceRecipes(
  registry: SchemaRegistry,
  regexCache: RegexCache,
  unit: OracleUnit,
  instance: JsonValue,
): RecipeProduction[] {
  const node = unit.ref.node;
  if (typeof node === "boolean" || !isObjectValue(node)) return [];

  const dialect = registry.dialectFor(unit.ref.baseUri);
  // Mirror engine/serializer refOnly: a draft-07/06/04 $ref silences siblings.
  const refOnly = dialect.refIgnoresSiblings && Object.hasOwn(node, "$ref");

  const productions: RecipeProduction[] = [];
  // A single binding counter across the unit, exactly as serialize.ts's
  // collect() allocates them per-keyword against one shared counter.
  let bindingCounter = 0;
  const bindings = new Map<number, string | number>();

  for (const entry of dialect.ordered) {
    if (refOnly && entry.name !== "$ref") continue;
    if (!Object.hasOwn(node, entry.name)) continue;
    const behavior = entry.behavior;
    if (typeof behavior.lower !== "function") continue;

    // Collect this keyword's lowered statement list, exactly as serialize.ts.
    const stmts: LowerStmt[] = [];
    const lctx: LoweringContext = {
      instance: { kind: "instance" },
      schema: node,
      staticCoverage: () => unit.coverage,
      runtimeCoverage: () => false,
      emit: (...s) => stmts.push(...s),
      binding: () => bindingCounter++,
    };
    behavior.lower(node[entry.name]!, lctx);

    const accum = freshAccumulators();
    const exec = new RecipeExecutor(
      registry,
      regexCache,
      unit.ref,
      entry.name,
      instance,
      bindings,
      accum,
      productions,
    );
    exec.runStmts(stmts);
  }
  return productions;
}

/** Executes one keyword's lowered statement list against the instance. */
class RecipeExecutor {
  constructor(
    private registry: SchemaRegistry,
    private regexCache: RegexCache,
    private unitRef: SchemaRef,
    private keyword: string,
    private instance: JsonValue,
    private bindings: Map<number, string | number>,
    private accum: Accumulators,
    private out: RecipeProduction[],
  ) {}

  runStmts(stmts: readonly LowerStmt[]): void {
    for (const stmt of stmts) this.runStmt(stmt);
  }

  private runStmt(stmt: LowerStmt): void {
    switch (stmt.kind) {
      case "if":
        if (truthy(this.evalExpr(stmt.cond))) this.runStmts(stmt.then);
        else if (stmt.else) this.runStmts(stmt.else);
        return;
      case "forEachKey": {
        const target = this.evalExpr(stmt.target);
        if (!isObjectValue(target)) return;
        for (const key of Object.keys(target)) {
          this.bindings.set(stmt.binding, key);
          this.runStmts(stmt.body);
        }
        return;
      }
      case "forEachIndex": {
        const target = this.evalExpr(stmt.target);
        if (!Array.isArray(target)) return;
        for (let i = stmt.start ?? 0; i < target.length; i++) {
          this.bindings.set(stmt.binding, i);
          this.runStmts(stmt.body);
        }
        return;
      }
      case "fail":
        // List-mode semantics: record nothing, do not short-circuit.
        return;
      case "combineCheck":
        return;
      case "countRange": {
        const target = this.evalExpr(stmt.target);
        if (!Array.isArray(target)) return;
        for (let i = 0; i < target.length; i++) {
          this.bindings.set(stmt.binding, i);
          const matched = truthy(this.evalExpr(stmt.countWhen));
          if (matched && stmt.collectIndexes) this.accum.countedIndexes.push(i);
        }
        // The range check itself records no production.
        return;
      }
      case "apply":
        this.execApply(stmt.apply);
        return;
      case "produce": {
        const rendered = this.render(stmt.value);
        if (rendered.has) {
          this.out.push({ keyword: this.keyword, value: rendered.value });
        }
        return;
      }
    }
  }

  /** Renders a produce recipe; `has: false` means no production ("nothing"). */
  private render(v: LowerProduceValue): { has: boolean; value?: unknown } {
    switch (v.kind) {
      case "const":
        return { has: true, value: v.value };
      case "expr":
        return { has: true, value: this.evalExpr(v.expr) };
      case "collectedNames":
        // Possibly empty; the object-type guard is the lower()'s job.
        return { has: true, value: [...this.accum.names] };
      case "collectedIndexes":
        return this.renderIndexes(v.render);
    }
  }

  private renderIndexes(
    render: "largestOrTrue" | "appliedTrue" | "matchedOrAllTrue",
  ): { has: boolean; value?: unknown } {
    if (render === "matchedOrAllTrue") {
      const counted = this.accum.countedIndexes;
      if (counted.length === 0) return { has: false };
      const arrayLength = Array.isArray(this.instance)
        ? this.instance.length
        : 0;
      return counted.length === arrayLength
        ? { has: true, value: true }
        : { has: true, value: [...counted] };
    }
    const indexes = this.accum.indexes;
    if (render === "appliedTrue") {
      return indexes.length > 0 ? { has: true, value: true } : { has: false };
    }
    // largestOrTrue
    if (indexes.length === 0) return { has: false };
    const max = Math.max(...indexes);
    const arrayLength = Array.isArray(this.instance) ? this.instance.length : 0;
    return max + 1 === arrayLength
      ? { has: true, value: true }
      : { has: true, value: max };
  }

  /**
   * Executes one subschema application: records the attempted child segment
   * (child-of-here cursors only, before the verdict — attempted-not-succeeded
   * semantics), then returns the fragment's verdict. Apply statements ignore
   * the verdict; applyExpr operands consume it.
   */
  private execApply(apply: LowerApply): boolean {
    const target = this.resolveTarget(apply);
    const childValue = this.cursorValue(apply.cursor);
    this.recordSegment(apply.cursor);
    const { valid } = evaluateFragment(
      this.registry,
      target,
      rootCursor(childValue),
      { dynamicScope: [this.unitRef.baseUri], regexCache: this.regexCache },
    );
    return valid;
  }

  private resolveTarget(apply: LowerApply): SchemaRef {
    if (apply.ref !== undefined) {
      return this.registry.resolveRef(apply.ref, this.unitRef.baseUri);
    }
    const first = apply.sibling ?? this.keyword;
    const path = apply.path.map((seg) => {
      if (typeof seg === "object") {
        throw new Error("apply paths are compile-time constants (binding seg)");
      }
      return seg;
    });
    return this.registry.child(this.unitRef, [first, ...path]);
  }

  /** The concrete instance value a cursor points at. */
  private cursorValue(cursor: LowerCursor): JsonValue {
    if (cursor.kind === "here") return this.instance;
    if (cursor.kind === "key") {
      return this.bindings.get(cursor.binding) as string;
    }
    const parent = this.cursorValue(cursor.of);
    const seg = this.segmentValue(cursor.segment);
    return (parent as Record<string | number, JsonValue>)[seg] as JsonValue;
  }

  private segmentValue(seg: LowerExpr | string | number): string | number {
    if (typeof seg === "string" || typeof seg === "number") return seg;
    return this.evalExpr(seg) as string | number;
  }

  /**
   * Accumulates the attempted child segment for a child-of-here application:
   * string segments to the name accumulation, numeric to the index
   * accumulation (dedup keeping first). Applications at `here`/`key` cursors
   * record nothing (they are not child-of-here descents).
   */
  private recordSegment(cursor: LowerCursor): void {
    if (cursor.kind !== "child" || cursor.of.kind !== "here") return;
    const seg = this.segmentValue(cursor.segment);
    if (typeof seg === "string") {
      if (!this.accum.nameSeen.has(seg)) {
        this.accum.nameSeen.add(seg);
        this.accum.names.push(seg);
      }
    } else if (!this.accum.indexSeen.has(seg)) {
      this.accum.indexSeen.add(seg);
      this.accum.indexes.push(seg);
    }
  }

  evalExpr(e: LowerExpr): unknown {
    switch (e.kind) {
      case "instance":
        return this.instance;
      case "const":
        return e.value;
      case "member":
        return (this.evalExpr(e.target) as Record<string, JsonValue>)[e.key];
      case "item":
        return (this.evalExpr(e.target) as JsonValue[])[
          this.evalExpr(e.index) as number
        ];
      case "binding":
        return this.bindings.get(e.id);
      case "typeIs":
        return this.typeIs(this.evalExpr(e.target), e.types);
      case "hasOwn": {
        const target = this.evalExpr(e.target);
        const key = typeof e.key === "string" ? e.key : this.evalExpr(e.key);
        return (
          typeof target === "object" &&
          target !== null &&
          Object.hasOwn(target, key as PropertyKey)
        );
      }
      case "cmp":
        return this.cmp(e.op, this.evalExpr(e.left), this.evalExpr(e.right));
      case "helper":
        return this.helper(e.helper, e.args);
      case "regexTest":
        return this.regexCache
          .compile(e.source)
          .test(this.evalExpr(e.target) as string);
      case "not":
        return !truthy(this.evalExpr(e.expr));
      case "logic": {
        if (e.op === "and")
          return e.parts.every((p) => truthy(this.evalExpr(p)));
        return e.parts.some((p) => truthy(this.evalExpr(p)));
      }
      case "applyExpr":
        return this.execApply(e.apply);
      case "tally":
      case "tallyList":
        // Message/param-only; the oracle never renders those.
        throw new Error(`'${e.kind}' is only legal in messages/params`);
    }
  }

  private typeIs(value: unknown, types: readonly string[]): boolean {
    return types.some((t) => {
      switch (t) {
        case "object":
          return isObjectValue(value);
        case "array":
          return Array.isArray(value);
        case "null":
          return value === null;
        case "integer":
          return typeof value === "number" && Number.isInteger(value);
        case "number":
          // integers match number too (JSON has one numeric type).
          return typeof value === "number";
        case "string":
        case "boolean":
          return typeof value === t;
        default:
          throw new Error(`unknown type test '${t}'`);
      }
    });
  }

  private cmp(op: string, left: unknown, right: unknown): boolean {
    switch (op) {
      case "<":
        return (left as number) < (right as number);
      case "<=":
        return (left as number) <= (right as number);
      case ">":
        return (left as number) > (right as number);
      case ">=":
        return (left as number) >= (right as number);
      case "===":
        return left === right;
      case "!==":
        return left !== right;
      default:
        throw new Error(`unknown comparison '${op}'`);
    }
  }

  private helper(name: string, args: readonly LowerExpr[]): unknown {
    const a = args.map((arg) => this.evalExpr(arg));
    switch (name) {
      case "keysOf":
        return Object.keys(a[0] as object);
      case "lengthOf":
        return (a[0] as { length: number }).length;
      case "codePointLength":
        return codePointLength(a[0] as string);
      case "jsonEqual":
        return jsonEqual(a[0] as JsonValue, a[1] as JsonValue);
      case "canonicalKey":
        return canonicalKey(a[0] as JsonValue);
      case "escapeSegment":
        return escapeSegment(a[0] as string);
      case "isMultipleOf":
        return isMultipleOf(a[0] as number, a[1] as number);
      case "hasDuplicateItems":
        return hasDuplicateItems(a[0] as JsonValue[]);
      case "firstDuplicatePair":
        return firstDuplicatePair(a[0] as JsonValue[]);
      default:
        throw new Error(`unknown helper '${name}'`);
    }
  }
}

// The serializer drops each cond straight into `if (...)`, so runtime
// truthiness (not strict `=== true`) is the matching semantics.
const truthy = (v: unknown): boolean => Boolean(v);
