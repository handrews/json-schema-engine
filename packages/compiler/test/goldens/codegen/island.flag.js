"use strict";
const { isObject: h_obj, isInteger: h_int, jsonEqual: h_eq, canonicalKey: h_ck, codePointLength: h_cpl, escapeSegment: h_esc, isMultipleOf: h_mof, hasDuplicateItems: h_dup, firstDuplicatePair: h_fdp, frag: h_frag, fragList: h_fragl, tooDeep: h_deep } = R;
const h_maxd = R.maxDepth;
const h_s0 = [];
const h_hop = Object.prototype.hasOwnProperty;
function u0(v, d, s) { if (d >= h_maxd) h_deep(); d++;
s = [...s, "https://codegen.example/island"];
const g0 = (typeof v === "object" && v !== null && !Array.isArray(v));
if ((g0 && ("p" in v))) { if (!h_frag(T[0], v["p"], s, d)) return false; }
if (g0) {  }
return true; }
return function validate(v) { return u0(v, 0, h_s0); };
