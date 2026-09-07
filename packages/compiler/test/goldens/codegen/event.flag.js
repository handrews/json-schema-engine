"use strict";
const { isObject: h_obj, isInteger: h_int, jsonEqual: h_eq, canonicalKey: h_ck, codePointLength: h_cpl, escapeSegment: h_esc, isMultipleOf: h_mof, hasDuplicateItems: h_dup, firstDuplicatePair: h_fdp, frag: h_frag, fragList: h_fragl, tooDeep: h_deep } = R;
const h_maxd = R.maxDepth;
const h_s0 = [];
const h_hop = Object.prototype.hasOwnProperty;
function u0(v, d, s) { const g1 = (typeof v === "object" && v !== null && !Array.isArray(v));
if ((g1 && ("id" in v))) { const t0 = v["id"];
if (!((typeof t0 === "string"))) { return false; } }
if ((g1 && ("actor" in v))) { const t2 = v["actor"];
if (!((typeof t2 === "string"))) { return false; } }
if (g1) {  }
if (!(g1)) { return false; }
if (g1) { if (!(("id" in v))) { return false; }
if (!(("actor" in v))) { return false; } }
if ((g1 && ("createdAt" in v))) { const t3 = v["createdAt"];
if (!((typeof t3 === "string"))) { return false; } }
if ((g1 && ("updatedAt" in v))) { const t4 = v["updatedAt"];
if (!((typeof t4 === "string"))) { return false; } }
if (g1) {  }
if (!(g1)) { return false; }
if (g1) { if (!(("createdAt" in v))) { return false; } }
if ((g1 && ("kind" in v))) { const t5 = v["kind"];
if (!(((t5 === "created") || (t5 === "updated") || (t5 === "deleted")))) { return false; } }
if (g1) {  }
if (!(g1)) { return false; }
if (g1) { if (!(("kind" in v))) { return false; } }
if (g1) { for (const b0 in v) { if (!(((b0 === "id") || (b0 === "actor") || (b0 === "createdAt") || (b0 === "updatedAt") || (b0 === "kind")))) { return false; } }
 }
return true; }
return function validate(v) { return u0(v, 0, h_s0); };
