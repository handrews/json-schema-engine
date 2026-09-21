"use strict";
const { isObject: h_obj, isInteger: h_int, jsonEqual: h_eq, canonicalKey: h_ck, codePointLength: h_cpl, escapeSegment: h_esc, isMultipleOf: h_mof, hasDuplicateItems: h_dup, firstDuplicatePair: h_fdp, frag: h_frag, fragList: h_fragl, tooDeep: h_deep } = R;
const h_maxd = R.maxDepth;
const h_s0 = [];
const h_hop = Object.prototype.hasOwnProperty;
const h_fragla = R.fragListAnn;
function u0(v, d, s, ep, ip, errs, anns) { if (d >= h_maxd) h_deep(); d++;
s = [...s, "https://codegen.example/island"];
let ok = true;
const m0 = anns.length; const m2 = errs.length; const m1 = u1(v, d, s, ep + "/if", ip, errs, anns); errs.length = m2; if (!m1) { anns.length = m0; } if (m1) { const m3 = anns.length; if (!u3(v, d, s, ep + "/then", ip, errs, anns)) { ok = false; anns.length = m3; } } else { const m4 = anns.length; if (!u7(v, d, s, ep + "/else", ip, errs, anns)) { ok = false; anns.length = m4; } }
return ok; }
function u1(v, d, s, ep, ip, errs, anns) { if (d >= h_maxd) h_deep(); d++;
const g1 = (typeof v === "object" && v !== null && !Array.isArray(v));
let ok = true;
if ((g1 && ("kind" in v))) { const m0 = anns.length; if (!u2(v["kind"], d, h_s0, ep + "/properties/kind", ip + "/kind", errs, anns)) { ok = false; anns.length = m0; } }
if (g1) {  }
if (g1) { if (!(("kind" in v))) { ok = false; errs.push({ evaluationPath: ep + "/required", schemaLocation: "https://codegen.example/island#/if/required", inputLocation: ip, error: "missing required property 'kind'", keyword: "required", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "missingProperty": "kind" } }); } }
return ok; }
function u2(v, d, s, ep, ip, errs, anns) { let ok = true;
if (!((v === "strict"))) { ok = false; errs.push({ evaluationPath: ep + "/const", schemaLocation: "https://codegen.example/island#/if/properties/kind/const", inputLocation: ip, error: "does not equal the required constant", keyword: "const", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "allowedValue": "strict" } }); }
return ok; }
function u3(v, d, s, ep, ip, errs, anns) { if (d >= h_maxd) h_deep(); d++;
s = [...s, "https://codegen.example/island"];
let ok = true;
const m0 = anns.length; if (!u4(v, d, s, ep + "/$ref", ip, errs, anns)) { ok = false; anns.length = m0; }
return ok; }
function u4(v, d, s, ep, ip, errs, anns) { if (d >= h_maxd) h_deep(); d++;
s = [...s, "https://codegen.example/strict"];
const g2 = (typeof v === "object" && v !== null && !Array.isArray(v));
let ok = true;
const m0 = anns.length; if (!u5(v, d, s, ep + "/$ref", ip, errs, anns)) { ok = false; anns.length = m0; }
if ((g2 && ("data" in v))) { const m1 = anns.length; if (!u6(v["data"], d, s, ep + "/properties/data", ip + "/data", errs, anns)) { ok = false; anns.length = m1; } }
if (g2) {  }
return ok; }
function u5(v, d, s, ep, ip, errs, anns) { if (d >= h_maxd) h_deep(); d++;
s = [...s, "https://codegen.example/tree"];
const g1 = (typeof v === "object" && v !== null && !Array.isArray(v));
let ok = true;
if ((g1 && ("child" in v))) { const m0 = anns.length; if (!h_fragla(T[0], v["child"], s, d, ep + "/properties/child", ip + "/child", errs, anns)) { ok = false; anns.length = m0; } }
if (g1) {  }
if (!(g1)) { ok = false; errs.push({ evaluationPath: ep + "/type", schemaLocation: "https://codegen.example/tree#/type", inputLocation: ip, error: "expected type \"object\"", keyword: "type", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "expected": "object" } }); }
return ok; }
function u6(v, d, s, ep, ip, errs, anns) { let ok = true;
if (!((typeof v === "number" && Number.isInteger(v)))) { ok = false; errs.push({ evaluationPath: ep + "/type", schemaLocation: "https://codegen.example/strict#/properties/data/type", inputLocation: ip, error: "expected type \"integer\"", keyword: "type", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "expected": "integer" } }); }
return ok; }
function u7(v, d, s, ep, ip, errs, anns) { if (d >= h_maxd) h_deep(); d++;
s = [...s, "https://codegen.example/island"];
let ok = true;
const m0 = anns.length; if (!u8(v, d, s, ep + "/$ref", ip, errs, anns)) { ok = false; anns.length = m0; }
return ok; }
function u8(v, d, s, ep, ip, errs, anns) { if (d >= h_maxd) h_deep(); d++;
s = [...s, "https://codegen.example/loose"];
const g2 = (typeof v === "object" && v !== null && !Array.isArray(v));
let ok = true;
const m0 = anns.length; if (!u5(v, d, s, ep + "/$ref", ip, errs, anns)) { ok = false; anns.length = m0; }
if ((g2 && ("data" in v))) { const m1 = anns.length; if (!u9(v["data"], d, s, ep + "/properties/data", ip + "/data", errs, anns)) { ok = false; anns.length = m1; } }
if (g2) {  }
return ok; }
function u9(v, d, s, ep, ip, errs, anns) { let ok = true;
if (!((typeof v === "string"))) { ok = false; errs.push({ evaluationPath: ep + "/type", schemaLocation: "https://codegen.example/loose#/properties/data/type", inputLocation: ip, error: "expected type \"string\"", keyword: "type", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "expected": "string" } }); }
return ok; }
return function evaluateList(v) { const errs = []; const anns = []; const ok = u0(v, 0, h_s0, "", "", errs, anns); return { valid: ok, errors: errs, annotations: anns }; };
