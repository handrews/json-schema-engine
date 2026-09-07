"use strict";
const { isObject: h_obj, isInteger: h_int, jsonEqual: h_eq, canonicalKey: h_ck, codePointLength: h_cpl, escapeSegment: h_esc, isMultipleOf: h_mof, hasDuplicateItems: h_dup, firstDuplicatePair: h_fdp, frag: h_frag, fragList: h_fragl, tooDeep: h_deep } = R;
const h_maxd = R.maxDepth;
const h_s0 = [];
const h_hop = Object.prototype.hasOwnProperty;
const h_covN = R.foldNameCoverage, h_covI = R.foldIndexCoverage, h_fragc = R.fragCov;
function u0(v, d, s) { if (d >= h_maxd) h_deep(); d++;
const g4 = (typeof v === "object" && v !== null && !Array.isArray(v));
const ev = [];
let c0 = false; { const m0 = ev.length; if (u1c(v, d, h_s0, ev)) { c0 = true; } else { ev.length = m0; } } { const m1 = ev.length; if (u3c(v, d, h_s0, ev)) { c0 = true; } else { ev.length = m1; } } if (!c0) return false;
const n2 = new Set();
if (g4) { const f3 = h_covN(ev);
for (const b1 in v) { if (!(f3.has(b1))) { n2.add(b1); return false; } }
ev.push([...n2]); }
return true; }
function u1(v, d, s) { if (d >= h_maxd) h_deep(); d++;
const g0 = (typeof v === "object" && v !== null && !Array.isArray(v));
if ((g0 && ("a" in v))) { if (!u2(v["a"], d, h_s0)) return false; }
if (g0) {  }
return true; }
function u1c(v, d, s, ev) { if (d >= h_maxd) h_deep(); d++;
const g1 = (typeof v === "object" && v !== null && !Array.isArray(v));
const n0 = new Set();
if ((g1 && ("a" in v))) { n0.add("a"); if (!u2(v["a"], d, h_s0)) return false; }
if (g1) { ev.push([...n0]); }
return true; }
function u2(v, d, s) { if (!((typeof v === "number" && Number.isInteger(v)))) { return false; }
return true; }
function u3(v, d, s) { if (d >= h_maxd) h_deep(); d++;
const g0 = (typeof v === "object" && v !== null && !Array.isArray(v));
if ((g0 && ("b" in v))) { if (!u4(v["b"], d, h_s0)) return false; }
if (g0) {  }
return true; }
function u3c(v, d, s, ev) { if (d >= h_maxd) h_deep(); d++;
const g1 = (typeof v === "object" && v !== null && !Array.isArray(v));
const n0 = new Set();
if ((g1 && ("b" in v))) { n0.add("b"); if (!u4(v["b"], d, h_s0)) return false; }
if (g1) { ev.push([...n0]); }
return true; }
function u4(v, d, s) { if (!((typeof v === "string"))) { return false; }
return true; }
return function validate(v) { return u0(v, 0, h_s0); };
