// draft-07 and draft-06 dialects (DESIGN.md M4-B, D11, D18). These drafts
// predate `$vocabulary`, so there are no official vocabulary URIs to assemble
// from (contrast vocab2019.ts) — the URIs minted below are registry
// identities only (D2/D18), never exposed as spec-meaningful vocabulary
// documents. draft-06 is a strict keyword subset of draft-07 (D11 amendment),
// so its vocabulary objects are built by omission from the draft-07 ones.

import { isObject, JsonValue } from "../json.js";
import {
  DialectRegistry,
  KeywordBehavior,
  StaticFacts,
  SubschemaApplication,
  identifiersLegacy,
} from "../dialect.js";
import { childCursor } from "../cursor.js";
import { Description, LowerExpr, LowerStmt, lowerIR } from "../lowering.js";
import { missingDependencies } from "../messages.js";
import {
  $ref,
  structural,
  annotationOnly,
  mapPositions,
  SELF,
} from "./core.js";
import {
  allOf,
  anyOf,
  oneOf,
  not,
  ifKeyword,
  conditionalBranch,
  properties,
  patternProperties,
  propertyNames,
  additionalProperties,
} from "./applicator.js";
import { items2019, additionalItems } from "./vocab2019.js";
import {
  describeDependencies,
  dependencyAbsent,
  validationVocabulary,
} from "./validation.js";
import { dependentsRejected, isFalse } from "./rejects.js";

/** draft-07 core vocabulary identity (registry-internal; not a spec-meaningful URI, D2/D18). */
export const VOCAB_CORE_07 = "urn:jse:vocab:draft-07:core";
/** draft-07 applicator vocabulary identity (registry-internal; not a spec-meaningful URI, D2/D18). */
export const VOCAB_APPLICATOR_07 = "urn:jse:vocab:draft-07:applicator";
/** draft-07 validation vocabulary identity (registry-internal; not a spec-meaningful URI, D2/D18). */
export const VOCAB_VALIDATION_07 = "urn:jse:vocab:draft-07:validation";
/** draft-07 meta-data vocabulary identity (registry-internal; not a spec-meaningful URI, D2/D18). */
export const VOCAB_META_DATA_07 = "urn:jse:vocab:draft-07:meta-data";
/** draft-07 format vocabulary identity (registry-internal; not a spec-meaningful URI, D2/D18). */
export const VOCAB_FORMAT_07 = "urn:jse:vocab:draft-07:format";
/** draft-07 content vocabulary identity (registry-internal; not a spec-meaningful URI, D2/D18). */
export const VOCAB_CONTENT_07 = "urn:jse:vocab:draft-07:content";

/** draft-06 core vocabulary identity (registry-internal; not a spec-meaningful URI, D2/D18). */
export const VOCAB_CORE_06 = "urn:jse:vocab:draft-06:core";
/** draft-06 applicator vocabulary identity (registry-internal; not a spec-meaningful URI, D2/D18). */
export const VOCAB_APPLICATOR_06 = "urn:jse:vocab:draft-06:applicator";
/** draft-06 validation vocabulary identity (registry-internal; not a spec-meaningful URI, D2/D18). */
export const VOCAB_VALIDATION_06 = "urn:jse:vocab:draft-06:validation";
/** draft-06 meta-data vocabulary identity (registry-internal; not a spec-meaningful URI, D2/D18). */
export const VOCAB_META_DATA_06 = "urn:jse:vocab:draft-06:meta-data";
/** draft-06 format vocabulary identity (registry-internal; not a spec-meaningful URI, D2/D18). */
export const VOCAB_FORMAT_06 = "urn:jse:vocab:draft-06:format";

/** draft-07 dialect URI. */
export const DIALECT_DRAFT_07 = "http://json-schema.org/draft-07/schema";
/** draft-06 dialect URI. */
export const DIALECT_DRAFT_06 = "http://json-schema.org/draft-06/schema";

const id07 = (name: string): string => `${VOCAB_APPLICATOR_07}#${name}`;

/**
 * `no item matches the contains subschema`, params `count` (the matches),
 * `matched` (their indexes) and `minContains` (always 1 here).
 */
function describeContains(count: LowerExpr, matched: LowerExpr): Description {
  return {
    message: ["no item matches the contains subschema"],
    params: { count, matched, minContains: lowerIR.constant(1) },
  };
}

/**
 * `contains` (draft-07/06): unlike 2020-12's `contains`, these drafts have
 * no `minContains`/`maxContains` keywords at all — any occurrence of those
 * names is just an unknown (annotation-only) keyword, never a sibling
 * `contains` reads. So the count assertion is unconditionally "at least 1",
 * with no min/max reads.
 */
export const containsLegacy: KeywordBehavior = {
  id: id07("contains"),
  // Per-item probes don't individually assert (the count does) — same
  // asserts:false shape as 2020-12 contains' childSweep application.
  analyze: (): StaticFacts => ({
    ...SELF,
    applications: [
      { path: [], mode: "childSweep", conditional: false, asserts: false },
    ],
  }),
  // Unconditional "at least 1" — countRange with no upper bound. A `false`
  // subschema matches nothing, so no item is probed and the failure is
  // reported directly.
  lower: (value, lctx) => {
    if (isFalse(value)) {
      lctx.emit(
        lowerIR.when(lowerIR.typeIs(lctx.instance, "array"), [
          lowerIR.failDescribed(
            describeContains(lowerIR.constant(0), lowerIR.constant([])),
          ),
        ]),
      );
      return;
    }
    const b = lctx.binding();
    const failure = describeContains({ kind: "tally" }, { kind: "tallyList" });
    lctx.emit(
      lowerIR.when(lowerIR.typeIs(lctx.instance, "array"), [
        {
          kind: "countRange",
          target: lctx.instance,
          binding: b,
          countWhen: {
            kind: "applyExpr",
            apply: {
              path: [],
              cursor: {
                kind: "child",
                of: { kind: "here" },
                segment: { kind: "binding", id: b },
              },
              fold: "discard",
            },
          },
          min: 1,
          max: Infinity,
          outOfRangeMessage: failure.message,
          outOfRangeParams: failure.params,
        },
      ]),
    );
  },
  evaluate: (value, cursor, ctx) => {
    if (!Array.isArray(cursor.value)) return true;
    const matched: JsonValue[] = [];
    if (!isFalse(value)) {
      for (let i = 0; i < cursor.value.length; i++) {
        if (ctx.apply(["contains"], childCursor(cursor, i, cursor.value[i]!)))
          matched.push(i);
      }
    }
    if (matched.length === 0) {
      ctx.report(() =>
        describeContains(
          lowerIR.constant(matched.length),
          lowerIR.constant(matched),
        ),
      );
      return false;
    }
    return true;
  },
};

// Member values are exactly one of two shapes per the metaschema's `anyOf`
// (schema vs stringArray) — a member is never both, so reading the JS type
// of the value at evaluate/analyze time is sufficient to dispatch, no
// declared-shape tracking needed.
const isSchemaValue = (v: JsonValue): boolean =>
  v === true || v === false || (isObject(v) && !Array.isArray(v));

/**
 * `dependencies` (draft-07/06): a single keyword folding what 2019-09+ split
 * into `dependentRequired` (array-valued members) and `dependentSchemas`
 * (schema-valued members).
 */
export const dependencies: KeywordBehavior = {
  id: id07("dependencies"),
  analyze: (value): StaticFacts => {
    if (!isObject(value)) return {};
    const schemaMembers = Object.entries(value).filter(([, v]) =>
      isSchemaValue(v),
    );
    return {
      subschemas: schemaMembers.map(([k]) => [k]),
      // Only schema-valued members get an edge — array-valued members
      // (dependentRequired's shape) have no subschema to plan/apply at all.
      applications: schemaMembers.map(([k]): SubschemaApplication => ({
        path: [k],
        mode: "inPlace",
        conditional: true,
        asserts: true,
      })),
    };
  },
  // Per-member dispatch is plan-time (the value shape is static, just like
  // evaluate()'s Array.isArray/isSchemaValue reads): schema-valued members
  // lower like dependentSchemas (applicator.ts, path ["dependencies", name]),
  // a `false` one rejected and named once; array-valued members lower like
  // dependentRequired (validation.ts), one error after the schema members'.
  lower: (value, lctx) => {
    if (!isObject(value)) return;
    const members = Object.entries(value as Record<string, JsonValue>).filter(
      ([, dep]) => !Array.isArray(dep) && isSchemaValue(dep),
    );
    const r = members.some(([, dep]) => isFalse(dep)) ? lctx.binding() : null;
    const schemaSteps = members.map(([name, dep]) =>
      lowerIR.when({ kind: "hasOwn", target: lctx.instance, key: name }, [
        r !== null && isFalse(dep)
          ? lowerIR.reject(r, lowerIR.constant(name))
          : {
              kind: "apply",
              apply: {
                path: [name],
                cursor: { kind: "here" },
                fold: "allMustPass",
              },
            },
      ]),
    );
    const body: LowerStmt[] =
      r === null
        ? schemaSteps
        : [
            lowerIR.rejectScope(
              r,
              schemaSteps,
              dependentsRejected("dependencies", { kind: "binding", id: r }),
            ),
          ];
    const absent = dependencyAbsent(value, lctx.instance);
    if (absent !== null) {
      body.push(
        lowerIR.when(absent, [
          lowerIR.failDescribed(describeDependencies(value, lctx.instance)),
        ]),
      );
    }
    if (body.length === 0) return;
    lctx.emit(lowerIR.when(lowerIR.typeIs(lctx.instance, "object"), body));
  },
  evaluate: (value, cursor, ctx) => {
    if (!isObject(cursor.value)) return true;
    const instance = cursor.value;
    const spec = value as Record<string, JsonValue>;
    let ok = true;
    const rejected: JsonValue[] = [];
    for (const [name, dep] of Object.entries(spec)) {
      if (!Object.hasOwn(instance, name) || Array.isArray(dep)) continue;
      if (!isSchemaValue(dep)) continue;
      if (isFalse(dep)) rejected.push(name);
      else if (!ctx.apply(["dependencies", name], cursor)) ok = false;
    }
    if (rejected.length > 0) {
      ctx.report(() =>
        dependentsRejected("dependencies", lowerIR.constant(rejected)),
      );
      ok = false;
    }
    if (Object.keys(missingDependencies(instance, spec)).length > 0) {
      ctx.report(() => describeDependencies(spec, lowerIR.instance));
      ok = false;
    }
    return ok;
  },
};

const core07Vocabulary: Record<string, KeywordBehavior> = {
  $ref,
  $id: structural(`${VOCAB_CORE_07}#$id`),
  $schema: structural(`${VOCAB_CORE_07}#$schema`),
  $comment: structural(`${VOCAB_CORE_07}#$comment`),
  // definitions is draft-07/06's pre-$defs name for the same inert-container
  // shape: subschemas exist for identification/registration but nothing
  // evaluates them directly.
  definitions: {
    id: `${VOCAB_CORE_07}#definitions`,
    structural: true,
    analyze: mapPositions,
    evaluate: () => true,
    lower: () => {
      /* contents are reachable only by reference */
    },
  },
};

const applicator07Vocabulary: Record<string, KeywordBehavior> = {
  allOf,
  anyOf,
  oneOf,
  not,
  if: ifKeyword,
  then: conditionalBranch(id07("then"), "then", true),
  else: conditionalBranch(id07("else"), "else", false),
  dependencies,
  properties,
  patternProperties,
  propertyNames,
  additionalProperties,
  items: items2019,
  additionalItems,
  contains: containsLegacy,
};

const metaData07Vocabulary = Object.fromEntries(
  ["title", "description", "default", "readOnly", "writeOnly", "examples"].map(
    (name) => [name, annotationOnly(`${VOCAB_META_DATA_07}#${name}`)],
  ),
);

const content07Vocabulary = Object.fromEntries(
  ["contentMediaType", "contentEncoding"].map((name) => [
    name,
    annotationOnly(`${VOCAB_CONTENT_07}#${name}`),
  ]),
);

// draft-06: draft-07 minus if/then/else, $comment, readOnly/writeOnly,
// contentMediaType/contentEncoding (D11 amendment — a compatible subset).
const { $comment: _dropComment, ...core06Rest } = core07Vocabulary;
const core06Vocabulary: Record<string, KeywordBehavior> = {
  ...core06Rest,
  $id: structural(`${VOCAB_CORE_06}#$id`),
  $schema: structural(`${VOCAB_CORE_06}#$schema`),
  definitions: {
    id: `${VOCAB_CORE_06}#definitions`,
    structural: true,
    analyze: mapPositions,
    evaluate: () => true,
    lower: () => {
      /* contents are reachable only by reference */
    },
  },
};

const {
  if: _dropIf,
  then: _dropThen,
  else: _dropElse,
  ...applicator06Rest
} = applicator07Vocabulary;
const applicator06Vocabulary: Record<string, KeywordBehavior> = {
  ...applicator06Rest,
};

const {
  readOnly: _dropReadOnly,
  writeOnly: _dropWriteOnly,
  ...metaData06Rest
} = metaData07Vocabulary;
const metaData06Vocabulary = metaData06Rest;

// draft-07/06 predate minContains/maxContains/dependentRequired: those names
// are unknown keywords (annotation-only) in these dialects — registering the
// 2020-12 behaviors would silently enforce assertions these drafts don't have.
const {
  minContains: _dropMinContains,
  maxContains: _dropMaxContains,
  dependentRequired: _dropDependentRequired,
  ...validationLegacyVocabulary
} = validationVocabulary;

/** Registers the draft-07 vocabularies and dialect. */
export function registerDialect07(
  registry: DialectRegistry,
  format: (id: string) => KeywordBehavior = annotationOnly,
): void {
  registry.registerVocabulary(VOCAB_CORE_07, core07Vocabulary);
  registry.registerVocabulary(VOCAB_APPLICATOR_07, applicator07Vocabulary);
  registry.registerVocabulary(VOCAB_VALIDATION_07, validationLegacyVocabulary);
  registry.registerVocabulary(VOCAB_META_DATA_07, metaData07Vocabulary);
  registry.registerVocabulary(VOCAB_FORMAT_07, {
    format: format(`${VOCAB_FORMAT_07}#format`),
  });
  registry.registerVocabulary(VOCAB_CONTENT_07, content07Vocabulary);

  registry.registerDialect(
    DIALECT_DRAFT_07,
    [
      VOCAB_CORE_07,
      VOCAB_APPLICATOR_07,
      VOCAB_VALIDATION_07,
      VOCAB_META_DATA_07,
      VOCAB_FORMAT_07,
      VOCAB_CONTENT_07,
    ],
    { identifiers: identifiersLegacy, refIgnoresSiblings: true },
  );
}

/** Registers the draft-06 vocabularies and dialect. */
export function registerDialect06(
  registry: DialectRegistry,
  format: (id: string) => KeywordBehavior = annotationOnly,
): void {
  registry.registerVocabulary(VOCAB_CORE_06, core06Vocabulary);
  registry.registerVocabulary(VOCAB_APPLICATOR_06, applicator06Vocabulary);
  registry.registerVocabulary(VOCAB_VALIDATION_06, validationLegacyVocabulary);
  registry.registerVocabulary(VOCAB_META_DATA_06, metaData06Vocabulary);
  registry.registerVocabulary(VOCAB_FORMAT_06, {
    format: format(`${VOCAB_FORMAT_06}#format`),
  });

  registry.registerDialect(
    DIALECT_DRAFT_06,
    [
      VOCAB_CORE_06,
      VOCAB_APPLICATOR_06,
      VOCAB_VALIDATION_06,
      VOCAB_META_DATA_06,
      VOCAB_FORMAT_06,
    ],
    { identifiers: identifiersLegacy, refIgnoresSiblings: true },
  );
}
