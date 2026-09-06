"use strict";
const { isObject: h_obj, isInteger: h_int, jsonEqual: h_eq, canonicalKey: h_ck, codePointLength: h_cpl, escapeSegment: h_esc, isMultipleOf: h_mof, hasDuplicateItems: h_dup, firstDuplicatePair: h_fdp, frag: h_frag, fragList: h_fragl, tooDeep: h_deep } = R;
const h_maxd = R.maxDepth;
const h_s0 = [];
const h_hop = Object.prototype.hasOwnProperty;
const h_fragla = R.fragListAnn;
const h_covN = R.foldNameCoverage, h_covI = R.foldIndexCoverage;
function u0(v, d, s, ep, ip, errs, anns) { if (d >= h_maxd) h_deep(); d++;
const g9 = (typeof v === "object" && v !== null && !Array.isArray(v));
let ok = true;
const ev = [];
let c0 = false; const m0 = errs.length; { const m1 = anns.length; const m2 = ev.length; if (u1c(v, d, h_s0, ep + "/anyOf/0", ip, errs, anns, ev)) { c0 = true; } else { anns.length = m1; ev.length = m2; } } { const m3 = anns.length; const m4 = ev.length; if (u3c(v, d, h_s0, ep + "/anyOf/1", ip, errs, anns, ev)) { c0 = true; } else { anns.length = m3; ev.length = m4; } } if (c0) { errs.length = m0; } else { ok = false; errs.push({ evaluationPath: ep + "/anyOf", schemaLocation: "https://codegen.example/tracked-consumer#/anyOf", inputLocation: ip, error: "no branch matched", keyword: "anyOf", vocabulary: "https://json-schema.org/draft/2020-12/vocab/applicator", params: {} }); }
let k5 = true;
const n6 = new Set();
if (g9) { const f7 = h_covN(ev);
for (const b1 in v) { if (!(f7.has(b1))) { n6.add(b1); const m8 = anns.length; if (!u5(v[b1], d, h_s0, ep + "/unevaluatedProperties", ip + "/" + h_esc(String(b1)), errs, anns)) { ok = false; k5 = false; anns.length = m8; } } }
if (k5) { ev.push([...n6]); } }
return ok; }
function u1(v, d, s, ep, ip, errs, anns) { if (d >= h_maxd) h_deep(); d++;
const g1 = (typeof v === "object" && v !== null && !Array.isArray(v));
let ok = true;
if ((g1 && (v["a"] !== undefined))) { const m0 = anns.length; if (!u2(v["a"], d, h_s0, ep + "/properties/a", ip + "/a", errs, anns)) { ok = false; anns.length = m0; } }
if (g1) {  }
return ok; }
function u1c(v, d, s, ep, ip, errs, anns, ev) { if (d >= h_maxd) h_deep(); d++;
const g3 = (typeof v === "object" && v !== null && !Array.isArray(v));
let ok = true;
let k0 = true;
const n1 = new Set();
if ((g3 && (v["a"] !== undefined))) { n1.add("a"); const m2 = anns.length; if (!u2(v["a"], d, h_s0, ep + "/properties/a", ip + "/a", errs, anns)) { ok = false; k0 = false; anns.length = m2; } }
if (g3) { if (k0) { ev.push([...n1]); } }
return ok; }
function u2(v, d, s, ep, ip, errs, anns) { let ok = true;
if (!((typeof v === "number" && Number.isInteger(v)))) { ok = false; errs.push({ evaluationPath: ep + "/type", schemaLocation: "https://codegen.example/tracked-consumer#/anyOf/0/properties/a/type", inputLocation: ip, error: "expected type \"integer\"", keyword: "type", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "expected": "integer" } }); }
return ok; }
function u3(v, d, s, ep, ip, errs, anns) { if (d >= h_maxd) h_deep(); d++;
const g1 = (typeof v === "object" && v !== null && !Array.isArray(v));
let ok = true;
if ((g1 && (v["b"] !== undefined))) { const m0 = anns.length; if (!u4(v["b"], d, h_s0, ep + "/properties/b", ip + "/b", errs, anns)) { ok = false; anns.length = m0; } }
if (g1) {  }
return ok; }
function u3c(v, d, s, ep, ip, errs, anns, ev) { if (d >= h_maxd) h_deep(); d++;
const g3 = (typeof v === "object" && v !== null && !Array.isArray(v));
let ok = true;
let k0 = true;
const n1 = new Set();
if ((g3 && (v["b"] !== undefined))) { n1.add("b"); const m2 = anns.length; if (!u4(v["b"], d, h_s0, ep + "/properties/b", ip + "/b", errs, anns)) { ok = false; k0 = false; anns.length = m2; } }
if (g3) { if (k0) { ev.push([...n1]); } }
return ok; }
function u4(v, d, s, ep, ip, errs, anns) { let ok = true;
if (!((typeof v === "string"))) { ok = false; errs.push({ evaluationPath: ep + "/type", schemaLocation: "https://codegen.example/tracked-consumer#/anyOf/1/properties/b/type", inputLocation: ip, error: "expected type \"string\"", keyword: "type", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "expected": "string" } }); }
return ok; }
function u5(v, d, s, ep, ip, errs, anns) { errs.push({ evaluationPath: ep, schemaLocation: "https://codegen.example/tracked-consumer#/unevaluatedProperties", inputLocation: ip, error: "schema is false", params: {} }); return false; }
return function evaluateList(v) { const errs = []; const anns = []; const ok = u0(v, 0, h_s0, "", "", errs, anns); return { valid: ok, errors: errs, annotations: anns }; };
