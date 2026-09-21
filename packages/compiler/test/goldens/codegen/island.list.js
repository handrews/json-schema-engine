"use strict";
const { isObject: h_obj, isInteger: h_int, jsonEqual: h_eq, canonicalKey: h_ck, codePointLength: h_cpl, escapeSegment: h_esc, isMultipleOf: h_mof, hasDuplicateItems: h_dup, firstDuplicatePair: h_fdp, frag: h_frag, fragList: h_fragl, tooDeep: h_deep } = R;
const h_maxd = R.maxDepth;
const h_s0 = [];
const h_hop = Object.prototype.hasOwnProperty;
function u0(v, d, s, ep, ip, errs) { if (d >= h_maxd) h_deep(); d++;
s = [...s, "https://codegen.example/island"];
let ok = true;
 const m1 = errs.length; const m0 = u1(v, d, s, ep + "/if", ip, errs); errs.length = m1; if (m0) { if (!u3(v, d, s, ep + "/then", ip, errs)) { ok = false; } } else { if (!u7(v, d, s, ep + "/else", ip, errs)) { ok = false; } }
return ok; }
function u1(v, d, s, ep, ip, errs) { if (d >= h_maxd) h_deep(); d++;
const g0 = (typeof v === "object" && v !== null && !Array.isArray(v));
let ok = true;
if ((g0 && ("kind" in v))) { if (!u2(v["kind"], d, h_s0, ep + "/properties/kind", ip + "/kind", errs)) { ok = false; } }
if (g0) {  }
if (g0) { if (!(("kind" in v))) { ok = false; errs.push({ evaluationPath: ep + "/required", schemaLocation: "https://codegen.example/island#/if/required", inputLocation: ip, error: "missing required property 'kind'", keyword: "required", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "missingProperty": "kind" } }); } }
return ok; }
function u2(v, d, s, ep, ip, errs) { let ok = true;
if (!((v === "strict"))) { ok = false; errs.push({ evaluationPath: ep + "/const", schemaLocation: "https://codegen.example/island#/if/properties/kind/const", inputLocation: ip, error: "does not equal the required constant", keyword: "const", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "allowedValue": "strict" } }); }
return ok; }
function u3(v, d, s, ep, ip, errs) { if (d >= h_maxd) h_deep(); d++;
s = [...s, "https://codegen.example/island"];
let ok = true;
if (!u4(v, d, s, ep + "/$ref", ip, errs)) { ok = false; }
return ok; }
function u4(v, d, s, ep, ip, errs) { if (d >= h_maxd) h_deep(); d++;
s = [...s, "https://codegen.example/strict"];
const g0 = (typeof v === "object" && v !== null && !Array.isArray(v));
let ok = true;
if (!u5(v, d, s, ep + "/$ref", ip, errs)) { ok = false; }
if ((g0 && ("data" in v))) { if (!u6(v["data"], d, s, ep + "/properties/data", ip + "/data", errs)) { ok = false; } }
if (g0) {  }
return ok; }
function u5(v, d, s, ep, ip, errs) { if (d >= h_maxd) h_deep(); d++;
s = [...s, "https://codegen.example/tree"];
const g0 = (typeof v === "object" && v !== null && !Array.isArray(v));
let ok = true;
if ((g0 && ("child" in v))) { if (!h_fragl(T[0], v["child"], s, d, ep + "/properties/child", ip + "/child", errs)) { ok = false; } }
if (g0) {  }
if (!(g0)) { ok = false; errs.push({ evaluationPath: ep + "/type", schemaLocation: "https://codegen.example/tree#/type", inputLocation: ip, error: "expected type \"object\"", keyword: "type", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "expected": "object" } }); }
return ok; }
function u6(v, d, s, ep, ip, errs) { let ok = true;
if (!((typeof v === "number" && Number.isInteger(v)))) { ok = false; errs.push({ evaluationPath: ep + "/type", schemaLocation: "https://codegen.example/strict#/properties/data/type", inputLocation: ip, error: "expected type \"integer\"", keyword: "type", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "expected": "integer" } }); }
return ok; }
function u7(v, d, s, ep, ip, errs) { if (d >= h_maxd) h_deep(); d++;
s = [...s, "https://codegen.example/island"];
let ok = true;
if (!u8(v, d, s, ep + "/$ref", ip, errs)) { ok = false; }
return ok; }
function u8(v, d, s, ep, ip, errs) { if (d >= h_maxd) h_deep(); d++;
s = [...s, "https://codegen.example/loose"];
const g0 = (typeof v === "object" && v !== null && !Array.isArray(v));
let ok = true;
if (!u5(v, d, s, ep + "/$ref", ip, errs)) { ok = false; }
if ((g0 && ("data" in v))) { if (!u9(v["data"], d, s, ep + "/properties/data", ip + "/data", errs)) { ok = false; } }
if (g0) {  }
return ok; }
function u9(v, d, s, ep, ip, errs) { let ok = true;
if (!((typeof v === "string"))) { ok = false; errs.push({ evaluationPath: ep + "/type", schemaLocation: "https://codegen.example/loose#/properties/data/type", inputLocation: ip, error: "expected type \"string\"", keyword: "type", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "expected": "string" } }); }
return ok; }
return function evaluateList(v) { const errs = []; const ok = u0(v, 0, h_s0, "", "", errs); return { valid: ok, errors: errs }; };
