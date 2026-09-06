"use strict";
const { isObject: h_obj, isInteger: h_int, jsonEqual: h_eq, canonicalKey: h_ck, codePointLength: h_cpl, escapeSegment: h_esc, isMultipleOf: h_mof, hasDuplicateItems: h_dup, firstDuplicatePair: h_fdp, frag: h_frag, fragList: h_fragl, tooDeep: h_deep } = R;
const h_maxd = R.maxDepth;
const h_s0 = [];
const h_hop = Object.prototype.hasOwnProperty;
const h_fragla = R.fragListAnn;
function u0(v, d, s, ep, ip, errs, anns) { if (d >= h_maxd) h_deep(); d++;
s = [...s, "https://codegen.example/island"];
const g1 = (typeof v === "object" && v !== null && !Array.isArray(v));
let ok = true;
if ((g1 && (v["p"] !== undefined))) { const m0 = anns.length; if (!h_fragla(T[0], v["p"], s, d, ep + "/properties/p", ip + "/p", errs, anns)) { ok = false; anns.length = m0; } }
if (g1) {  }
return ok; }
return function evaluateList(v) { const errs = []; const anns = []; const ok = u0(v, 0, h_s0, "", "", errs, anns); return { valid: ok, errors: errs, annotations: anns }; };
