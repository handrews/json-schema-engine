"use strict";
const { isObject: h_obj, isInteger: h_int, jsonEqual: h_eq, canonicalKey: h_ck, codePointLength: h_cpl, escapeSegment: h_esc, isMultipleOf: h_mof, hasDuplicateItems: h_dup, firstDuplicatePair: h_fdp, frag: h_frag, fragList: h_fragl, tooDeep: h_deep } = R;
const h_maxd = R.maxDepth;
const h_s0 = [];
const h_hop = Object.prototype.hasOwnProperty;
function u0(v, d, s) { if (d >= h_maxd) h_deep(); d++;
s = [...s, "https://codegen.example/island"];
if (u1(v, d, s)) { if (!u3(v, d, s)) return false; } else { if (!u7(v, d, s)) return false; }
return true; }
function u1(v, d, s) { const g1 = (typeof v === "object" && v !== null && !Array.isArray(v));
if ((g1 && ("kind" in v))) { const t0 = v["kind"];
if (!((t0 === "strict"))) { return false; } }
if (g1) {  }
if (g1) { if (!(("kind" in v))) { return false; } }
return true; }
function u3(v, d, s) { if (d >= h_maxd) h_deep(); d++;
s = [...s, "https://codegen.example/island"];
if (!u4(v, d, s)) return false;
return true; }
function u4(v, d, s) { if (d >= h_maxd) h_deep(); d++;
s = [...s, "https://codegen.example/strict"];
const g1 = (typeof v === "object" && v !== null && !Array.isArray(v));
if (!u5(v, d, s)) return false;
if ((g1 && ("data" in v))) { const t0 = v["data"];
if (!((typeof t0 === "number" && Number.isInteger(t0)))) { return false; } }
if (g1) {  }
return true; }
function u5(v, d, s) { if (d >= h_maxd) h_deep(); d++;
s = [...s, "https://codegen.example/tree"];
const g0 = (typeof v === "object" && v !== null && !Array.isArray(v));
if ((g0 && ("child" in v))) { if (!h_frag(T[0], v["child"], s, d)) return false; }
if (g0) {  }
if (!(g0)) { return false; }
return true; }
function u7(v, d, s) { if (d >= h_maxd) h_deep(); d++;
s = [...s, "https://codegen.example/island"];
if (!u8(v, d, s)) return false;
return true; }
function u8(v, d, s) { if (d >= h_maxd) h_deep(); d++;
s = [...s, "https://codegen.example/loose"];
const g1 = (typeof v === "object" && v !== null && !Array.isArray(v));
if (!u5(v, d, s)) return false;
if ((g1 && ("data" in v))) { const t0 = v["data"];
if (!((typeof t0 === "string"))) { return false; } }
if (g1) {  }
return true; }
return function validate(v) { return u0(v, 0, h_s0); };
