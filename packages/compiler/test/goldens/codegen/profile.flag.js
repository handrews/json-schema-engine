"use strict";
const { isObject: h_obj, isInteger: h_int, jsonEqual: h_eq, canonicalKey: h_ck, codePointLength: h_cpl, escapeSegment: h_esc, isMultipleOf: h_mof, hasDuplicateItems: h_dup, firstDuplicatePair: h_fdp, frag: h_frag, fragList: h_fragl, tooDeep: h_deep } = R;
const h_maxd = R.maxDepth;
const h_s0 = [];
const h_hop = Object.prototype.hasOwnProperty;
function u0(v, d, s) { const g1 = (typeof v === "object" && v !== null && !Array.isArray(v));
if ((g1 && (v["id"] !== undefined))) { const t0 = v["id"];
if (!((typeof t0 === "string"))) { return false; }

 }
if ((g1 && (v["displayName"] !== undefined))) { const t2 = v["displayName"];
if (!((typeof t2 === "string"))) { return false; }

 }
if ((g1 && (v["bio"] !== undefined))) { const t3 = v["bio"];
if (!((typeof t3 === "string"))) { return false; }

 }
if ((g1 && (v["createdAt"] !== undefined))) { const t4 = v["createdAt"];
if (!((typeof t4 === "string"))) { return false; }

 }
if (g1) {  }
if (!(g1)) { return false; }
if (g1) { if (!((v["id"] !== undefined))) { return false; } }

return true; }
return function validate(v) { return u0(v, 0, h_s0); };
