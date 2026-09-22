"use strict";
const { isObject: h_obj, isInteger: h_int, jsonEqual: h_eq, canonicalKey: h_ck, codePointLength: h_cpl, escapeSegment: h_esc, isMultipleOf: h_mof, hasDuplicateItems: h_dup, firstDuplicatePair: h_fdp, frag: h_frag, fragList: h_fragl, tooDeep: h_deep } = R;
const h_maxd = R.maxDepth;
const h_s0 = [];
const h_hop = Object.prototype.hasOwnProperty;
function u0(v, d, s) { if (d >= h_maxd) h_deep(); d++;
const g1 = (typeof v === "object" && v !== null && !Array.isArray(v));
if ((g1 && ("name" in v))) { const t0 = v["name"];
if (!((typeof t0 === "string"))) { return false; } }
if ((g1 && ("children" in v))) { const t2 = v["children"];
if (Array.isArray(t2)) { for (let b0 = 0; b0 < t2.length; b0++) { const t3 = t2[b0];
if (!u0(t3, d, h_s0)) return false; } }

if (!(Array.isArray(t2))) { return false; } }
if (g1) {  }
if (!(g1)) { return false; }
if (g1) { if (!(("name" in v))) { return false; } }
return true; }
return function validate(v) { return u0(v, 0, h_s0); };
