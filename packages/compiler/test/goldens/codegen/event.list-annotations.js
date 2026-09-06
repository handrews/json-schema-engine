"use strict";
const { isObject: h_obj, isInteger: h_int, jsonEqual: h_eq, canonicalKey: h_ck, codePointLength: h_cpl, escapeSegment: h_esc, isMultipleOf: h_mof, hasDuplicateItems: h_dup, firstDuplicatePair: h_fdp, frag: h_frag, fragList: h_fragl, tooDeep: h_deep } = R;
const h_maxd = R.maxDepth;
const h_s0 = [];
const h_hop = Object.prototype.hasOwnProperty;
const h_fragla = R.fragListAnn;
const h_covN = R.foldNameCoverage, h_covI = R.foldIndexCoverage;
function u0(v, d, s, ep, ip, errs, anns) { if (d >= h_maxd) h_deep(); d++;
const g7 = (typeof v === "object" && v !== null && !Array.isArray(v));
let ok = true;
const ev = [];
const m0 = anns.length; const m1 = ev.length; if (!u1c(v, d, h_s0, ep + "/allOf/0", ip, errs, anns, ev)) { ok = false; anns.length = m0; ev.length = m1; }
const m2 = anns.length; const m3 = ev.length; if (!u5c(v, d, h_s0, ep + "/allOf/1", ip, errs, anns, ev)) { ok = false; anns.length = m2; ev.length = m3; }
let k4 = true;
const n5 = new Set();
if ((g7 && (v["kind"] !== undefined))) { n5.add("kind"); const m6 = anns.length; if (!u9(v["kind"], d, h_s0, ep + "/properties/kind", ip + "/kind", errs, anns)) { ok = false; k4 = false; anns.length = m6; } }
if (g7) { if (k4) { ev.push([...n5]); } }
if (!(g7)) { ok = false; errs.push({ evaluationPath: ep + "/type", schemaLocation: "https://spike.example/event#/type", inputLocation: ip, error: "expected type \"object\"", keyword: "type", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "expected": "object" } }); }
if (g7) { if (!((v["kind"] !== undefined))) { ok = false; errs.push({ evaluationPath: ep + "/required", schemaLocation: "https://spike.example/event#/required", inputLocation: ip, error: "missing required property 'kind'", keyword: "required", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "missingProperty": "kind" } }); } }
let k8 = true;
const n9 = new Set();
if (g7) { const f10 = h_covN(ev);
for (const b1 in v) { if (!(f10.has(b1))) { n9.add(b1); const m11 = anns.length; if (!u10(v[b1], d, h_s0, ep + "/unevaluatedProperties", ip + "/" + h_esc(String(b1)), errs, anns)) { ok = false; k8 = false; anns.length = m11; } } }
if (k8) { ev.push([...n9]); } }
return ok; }
function u1(v, d, s, ep, ip, errs, anns) { if (d >= h_maxd) h_deep(); d++;
let ok = true;
const m0 = anns.length; if (!u2(v, d, h_s0, ep + "/$ref", ip, errs, anns)) { ok = false; anns.length = m0; }
return ok; }
function u1c(v, d, s, ep, ip, errs, anns, ev) { if (d >= h_maxd) h_deep(); d++;
let ok = true;
const m0 = anns.length; const m1 = ev.length; if (!u2c(v, d, h_s0, ep + "/$ref", ip, errs, anns, ev)) { ok = false; anns.length = m0; ev.length = m1; }
return ok; }
function u2(v, d, s, ep, ip, errs, anns) { if (d >= h_maxd) h_deep(); d++;
const g1 = (typeof v === "object" && v !== null && !Array.isArray(v));
let ok = true;
if ((g1 && (v["id"] !== undefined))) { const m0 = anns.length; if (!u3(v["id"], d, h_s0, ep + "/properties/id", ip + "/id", errs, anns)) { ok = false; anns.length = m0; } }
if ((g1 && (v["actor"] !== undefined))) { const m2 = anns.length; if (!u4(v["actor"], d, h_s0, ep + "/properties/actor", ip + "/actor", errs, anns)) { ok = false; anns.length = m2; } }
if (g1) {  }
if (!(g1)) { ok = false; errs.push({ evaluationPath: ep + "/type", schemaLocation: "https://spike.example/event#/$defs/base/type", inputLocation: ip, error: "expected type \"object\"", keyword: "type", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "expected": "object" } }); }
if (g1) { if (!((v["id"] !== undefined))) { ok = false; errs.push({ evaluationPath: ep + "/required", schemaLocation: "https://spike.example/event#/$defs/base/required", inputLocation: ip, error: "missing required property 'id'", keyword: "required", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "missingProperty": "id" } }); }
if (!((v["actor"] !== undefined))) { ok = false; errs.push({ evaluationPath: ep + "/required", schemaLocation: "https://spike.example/event#/$defs/base/required", inputLocation: ip, error: "missing required property 'actor'", keyword: "required", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "missingProperty": "actor" } }); } }
return ok; }
function u2c(v, d, s, ep, ip, errs, anns, ev) { if (d >= h_maxd) h_deep(); d++;
const g3 = (typeof v === "object" && v !== null && !Array.isArray(v));
let ok = true;
let k0 = true;
const n1 = new Set();
if ((g3 && (v["id"] !== undefined))) { n1.add("id"); const m2 = anns.length; if (!u3(v["id"], d, h_s0, ep + "/properties/id", ip + "/id", errs, anns)) { ok = false; k0 = false; anns.length = m2; } }
if ((g3 && (v["actor"] !== undefined))) { n1.add("actor"); const m4 = anns.length; if (!u4(v["actor"], d, h_s0, ep + "/properties/actor", ip + "/actor", errs, anns)) { ok = false; k0 = false; anns.length = m4; } }
if (g3) { if (k0) { ev.push([...n1]); } }
if (!(g3)) { ok = false; errs.push({ evaluationPath: ep + "/type", schemaLocation: "https://spike.example/event#/$defs/base/type", inputLocation: ip, error: "expected type \"object\"", keyword: "type", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "expected": "object" } }); }
if (g3) { if (!((v["id"] !== undefined))) { ok = false; errs.push({ evaluationPath: ep + "/required", schemaLocation: "https://spike.example/event#/$defs/base/required", inputLocation: ip, error: "missing required property 'id'", keyword: "required", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "missingProperty": "id" } }); }
if (!((v["actor"] !== undefined))) { ok = false; errs.push({ evaluationPath: ep + "/required", schemaLocation: "https://spike.example/event#/$defs/base/required", inputLocation: ip, error: "missing required property 'actor'", keyword: "required", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "missingProperty": "actor" } }); } }
return ok; }
function u3(v, d, s, ep, ip, errs, anns) { let ok = true;
if (!((typeof v === "string"))) { ok = false; errs.push({ evaluationPath: ep + "/type", schemaLocation: "https://spike.example/event#/$defs/base/properties/id/type", inputLocation: ip, error: "expected type \"string\"", keyword: "type", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "expected": "string" } }); }
return ok; }
function u4(v, d, s, ep, ip, errs, anns) { let ok = true;
if (!((typeof v === "string"))) { ok = false; errs.push({ evaluationPath: ep + "/type", schemaLocation: "https://spike.example/event#/$defs/base/properties/actor/type", inputLocation: ip, error: "expected type \"string\"", keyword: "type", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "expected": "string" } }); }
return ok; }
function u5(v, d, s, ep, ip, errs, anns) { if (d >= h_maxd) h_deep(); d++;
let ok = true;
const m0 = anns.length; if (!u6(v, d, h_s0, ep + "/$ref", ip, errs, anns)) { ok = false; anns.length = m0; }
return ok; }
function u5c(v, d, s, ep, ip, errs, anns, ev) { if (d >= h_maxd) h_deep(); d++;
let ok = true;
const m0 = anns.length; const m1 = ev.length; if (!u6c(v, d, h_s0, ep + "/$ref", ip, errs, anns, ev)) { ok = false; anns.length = m0; ev.length = m1; }
return ok; }
function u6(v, d, s, ep, ip, errs, anns) { if (d >= h_maxd) h_deep(); d++;
const g1 = (typeof v === "object" && v !== null && !Array.isArray(v));
let ok = true;
if ((g1 && (v["createdAt"] !== undefined))) { const m0 = anns.length; if (!u7(v["createdAt"], d, h_s0, ep + "/properties/createdAt", ip + "/createdAt", errs, anns)) { ok = false; anns.length = m0; } }
if ((g1 && (v["updatedAt"] !== undefined))) { const m2 = anns.length; if (!u8(v["updatedAt"], d, h_s0, ep + "/properties/updatedAt", ip + "/updatedAt", errs, anns)) { ok = false; anns.length = m2; } }
if (g1) {  }
if (!(g1)) { ok = false; errs.push({ evaluationPath: ep + "/type", schemaLocation: "https://spike.example/event#/$defs/timestamps/type", inputLocation: ip, error: "expected type \"object\"", keyword: "type", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "expected": "object" } }); }
if (g1) { if (!((v["createdAt"] !== undefined))) { ok = false; errs.push({ evaluationPath: ep + "/required", schemaLocation: "https://spike.example/event#/$defs/timestamps/required", inputLocation: ip, error: "missing required property 'createdAt'", keyword: "required", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "missingProperty": "createdAt" } }); } }
return ok; }
function u6c(v, d, s, ep, ip, errs, anns, ev) { if (d >= h_maxd) h_deep(); d++;
const g3 = (typeof v === "object" && v !== null && !Array.isArray(v));
let ok = true;
let k0 = true;
const n1 = new Set();
if ((g3 && (v["createdAt"] !== undefined))) { n1.add("createdAt"); const m2 = anns.length; if (!u7(v["createdAt"], d, h_s0, ep + "/properties/createdAt", ip + "/createdAt", errs, anns)) { ok = false; k0 = false; anns.length = m2; } }
if ((g3 && (v["updatedAt"] !== undefined))) { n1.add("updatedAt"); const m4 = anns.length; if (!u8(v["updatedAt"], d, h_s0, ep + "/properties/updatedAt", ip + "/updatedAt", errs, anns)) { ok = false; k0 = false; anns.length = m4; } }
if (g3) { if (k0) { ev.push([...n1]); } }
if (!(g3)) { ok = false; errs.push({ evaluationPath: ep + "/type", schemaLocation: "https://spike.example/event#/$defs/timestamps/type", inputLocation: ip, error: "expected type \"object\"", keyword: "type", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "expected": "object" } }); }
if (g3) { if (!((v["createdAt"] !== undefined))) { ok = false; errs.push({ evaluationPath: ep + "/required", schemaLocation: "https://spike.example/event#/$defs/timestamps/required", inputLocation: ip, error: "missing required property 'createdAt'", keyword: "required", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "missingProperty": "createdAt" } }); } }
return ok; }
function u7(v, d, s, ep, ip, errs, anns) { let ok = true;
if (!((typeof v === "string"))) { ok = false; errs.push({ evaluationPath: ep + "/type", schemaLocation: "https://spike.example/event#/$defs/timestamps/properties/createdAt/type", inputLocation: ip, error: "expected type \"string\"", keyword: "type", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "expected": "string" } }); }
return ok; }
function u8(v, d, s, ep, ip, errs, anns) { let ok = true;
if (!((typeof v === "string"))) { ok = false; errs.push({ evaluationPath: ep + "/type", schemaLocation: "https://spike.example/event#/$defs/timestamps/properties/updatedAt/type", inputLocation: ip, error: "expected type \"string\"", keyword: "type", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "expected": "string" } }); }
return ok; }
function u9(v, d, s, ep, ip, errs, anns) { let ok = true;
if (!(((v === "created") || (v === "updated") || (v === "deleted")))) { ok = false; errs.push({ evaluationPath: ep + "/enum", schemaLocation: "https://spike.example/event#/properties/kind/enum", inputLocation: ip, error: "not one of the allowed values", keyword: "enum", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "allowedValues": ["created","updated","deleted"] } }); }
return ok; }
function u10(v, d, s, ep, ip, errs, anns) { errs.push({ evaluationPath: ep, schemaLocation: "https://spike.example/event#/unevaluatedProperties", inputLocation: ip, error: "schema is false", params: {} }); return false; }
return function evaluateList(v) { const errs = []; const anns = []; const ok = u0(v, 0, h_s0, "", "", errs, anns); return { valid: ok, errors: errs, annotations: anns }; };
