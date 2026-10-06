// Applicators with a `false` subschema (D13). A `false` subschema fails
// everything it is applied to and explains nothing: its only error is
// "schema is false", once per child, while the useful fact — which
// properties were additional, which indexes were past the prefix — is the
// applicator's. So an applicator does not apply a `false` subschema at all.
// It names the keys it would have applied it to and reports them in one
// error of its own, built here so the wording is shared across keywords and
// both tiers.

import { JsonValue } from "../json.js";
import { Description, LowerExpr, LowerParams, lowerIR } from "../lowering.js";

/** The boolean schema `false`: `value === false`, never a falsy value. */
export const isFalse = (value: JsonValue): value is false => value === false;

/** `additional properties "b", "c" not allowed`, params `properties`. */
export function namesRejected(
  prefix: string,
  suffix: string,
  names: LowerExpr,
  extra?: LowerParams,
): Description {
  return {
    message: [
      prefix,
      lowerIR.helper(
        "labeledNames",
        names,
        lowerIR.constant("property"),
        lowerIR.constant("properties"),
      ),
      suffix,
    ],
    params: { properties: names, ...extra },
  };
}

/** `property "a" present, which dependentSchemas forbids`: shared with draft-07's `dependencies`. */
export function dependentsRejected(
  keyword: string,
  names: LowerExpr,
): Description {
  return namesRejected("", ` present, which ${keyword} forbids`, names);
}

/** `items not allowed from index 1: 1-4`: every index from `start`. */
export function tailRejected(
  noun: string,
  start: number,
  indexes: LowerExpr,
): Description {
  return {
    message: [
      `${noun} not allowed from index ${start}: `,
      lowerIR.helper("indexRanges", indexes),
    ],
    params: {
      start: lowerIR.constant(start),
      failed: lowerIR.helper("ranges", indexes),
    },
  };
}

/** `items not allowed at 1, 3`: the positions a tuple forbids. */
export function positionsRejected(indexes: LowerExpr): Description {
  return {
    message: ["items not allowed at ", lowerIR.helper("indexRanges", indexes)],
    params: { failed: lowerIR.helper("ranges", indexes) },
  };
}

/** `unevaluated items not allowed, first at index 2: 2, 3, 6`. */
export function unevaluatedRejected(indexes: LowerExpr): Description {
  const first: LowerExpr = {
    kind: "item",
    target: indexes,
    index: lowerIR.constant(0),
  };
  return {
    message: [
      "unevaluated items not allowed, first at index ",
      first,
      ": ",
      lowerIR.helper("indexRanges", indexes),
    ],
    params: { start: first, failed: lowerIR.helper("ranges", indexes) },
  };
}
