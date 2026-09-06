"use strict";
const { isObject: h_obj, isInteger: h_int, jsonEqual: h_eq, canonicalKey: h_ck, codePointLength: h_cpl, escapeSegment: h_esc, isMultipleOf: h_mof, hasDuplicateItems: h_dup, firstDuplicatePair: h_fdp, frag: h_frag, fragList: h_fragl, tooDeep: h_deep } = R;
const h_maxd = R.maxDepth;
const h_s0 = [];
const h_hop = Object.prototype.hasOwnProperty;
const h_covN = R.foldNameCoverage, h_covI = R.foldIndexCoverage;
function u0(v, d, s, ep, ip, errs) { if (d >= h_maxd) h_deep(); d++;
const g4 = (typeof v === "object" && v !== null && !Array.isArray(v));
let ok = true;
const ev = [];
const m0 = ev.length; if (!u1c(v, d, h_s0, ep + "/allOf/0", ip, errs, ev)) { ok = false; ev.length = m0; }
const m1 = ev.length; if (!u5c(v, d, h_s0, ep + "/allOf/1", ip, errs, ev)) { ok = false; ev.length = m1; }
let k2 = true;
const n3 = new Set();
if ((g4 && (v["kind"] !== undefined))) { n3.add("kind"); if (!u9(v["kind"], d, h_s0, ep + "/properties/kind", ip + "/kind", errs)) { ok = false; k2 = false; } }
if (g4) { if (k2) { ev.push([...n3]); } }
if (!(g4)) { ok = false; errs.push({ evaluationPath: ep + "/type", schemaLocation: "https://spike.example/event#/type", inputLocation: ip, error: "expected type \"object\"", keyword: "type", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "expected": "object" } }); }
if (g4) { if (!((v["kind"] !== undefined))) { ok = false; errs.push({ evaluationPath: ep + "/required", schemaLocation: "https://spike.example/event#/required", inputLocation: ip, error: "missing required property 'kind'", keyword: "required", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "missingProperty": "kind" } }); } }
let k5 = true;
const n6 = new Set();
if (g4) { const f7 = h_covN(ev);
for (const b1 in v) { if (!(f7.has(b1))) { n6.add(b1); if (!u10(v[b1], d, h_s0, ep + "/unevaluatedProperties", ip + "/" + h_esc(String(b1)), errs)) { ok = false; k5 = false; } } }
if (k5) { ev.push([...n6]); } }
return ok; }
function u1(v, d, s, ep, ip, errs) { if (d >= h_maxd) h_deep(); d++;
let ok = true;
if (!u2(v, d, h_s0, ep + "/$ref", ip, errs)) { ok = false; }
return ok; }
function u1c(v, d, s, ep, ip, errs, ev) { if (d >= h_maxd) h_deep(); d++;
let ok = true;
const m0 = ev.length; if (!u2c(v, d, h_s0, ep + "/$ref", ip, errs, ev)) { ok = false; ev.length = m0; }
return ok; }
function u2(v, d, s, ep, ip, errs) { if (d >= h_maxd) h_deep(); d++;
const g0 = (typeof v === "object" && v !== null && !Array.isArray(v));
let ok = true;
if ((g0 && (v["id"] !== undefined))) { if (!u3(v["id"], d, h_s0, ep + "/properties/id", ip + "/id", errs)) { ok = false; } }
if ((g0 && (v["actor"] !== undefined))) { if (!u4(v["actor"], d, h_s0, ep + "/properties/actor", ip + "/actor", errs)) { ok = false; } }
if (g0) {  }
if (!(g0)) { ok = false; errs.push({ evaluationPath: ep + "/type", schemaLocation: "https://spike.example/event#/$defs/base/type", inputLocation: ip, error: "expected type \"object\"", keyword: "type", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "expected": "object" } }); }
if (g0) { if (!((v["id"] !== undefined))) { ok = false; errs.push({ evaluationPath: ep + "/required", schemaLocation: "https://spike.example/event#/$defs/base/required", inputLocation: ip, error: "missing required property 'id'", keyword: "required", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "missingProperty": "id" } }); }
if (!((v["actor"] !== undefined))) { ok = false; errs.push({ evaluationPath: ep + "/required", schemaLocation: "https://spike.example/event#/$defs/base/required", inputLocation: ip, error: "missing required property 'actor'", keyword: "required", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "missingProperty": "actor" } }); } }
return ok; }
function u2c(v, d, s, ep, ip, errs, ev) { if (d >= h_maxd) h_deep(); d++;
const g2 = (typeof v === "object" && v !== null && !Array.isArray(v));
let ok = true;
let k0 = true;
const n1 = new Set();
if ((g2 && (v["id"] !== undefined))) { n1.add("id"); if (!u3(v["id"], d, h_s0, ep + "/properties/id", ip + "/id", errs)) { ok = false; k0 = false; } }
if ((g2 && (v["actor"] !== undefined))) { n1.add("actor"); if (!u4(v["actor"], d, h_s0, ep + "/properties/actor", ip + "/actor", errs)) { ok = false; k0 = false; } }
if (g2) { if (k0) { ev.push([...n1]); } }
if (!(g2)) { ok = false; errs.push({ evaluationPath: ep + "/type", schemaLocation: "https://spike.example/event#/$defs/base/type", inputLocation: ip, error: "expected type \"object\"", keyword: "type", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "expected": "object" } }); }
if (g2) { if (!((v["id"] !== undefined))) { ok = false; errs.push({ evaluationPath: ep + "/required", schemaLocation: "https://spike.example/event#/$defs/base/required", inputLocation: ip, error: "missing required property 'id'", keyword: "required", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "missingProperty": "id" } }); }
if (!((v["actor"] !== undefined))) { ok = false; errs.push({ evaluationPath: ep + "/required", schemaLocation: "https://spike.example/event#/$defs/base/required", inputLocation: ip, error: "missing required property 'actor'", keyword: "required", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "missingProperty": "actor" } }); } }
return ok; }
function u3(v, d, s, ep, ip, errs) { let ok = true;
if (!((typeof v === "string"))) { ok = false; errs.push({ evaluationPath: ep + "/type", schemaLocation: "https://spike.example/event#/$defs/base/properties/id/type", inputLocation: ip, error: "expected type \"string\"", keyword: "type", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "expected": "string" } }); }
return ok; }
function u4(v, d, s, ep, ip, errs) { let ok = true;
if (!((typeof v === "string"))) { ok = false; errs.push({ evaluationPath: ep + "/type", schemaLocation: "https://spike.example/event#/$defs/base/properties/actor/type", inputLocation: ip, error: "expected type \"string\"", keyword: "type", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "expected": "string" } }); }
return ok; }
function u5(v, d, s, ep, ip, errs) { if (d >= h_maxd) h_deep(); d++;
let ok = true;
if (!u6(v, d, h_s0, ep + "/$ref", ip, errs)) { ok = false; }
return ok; }
function u5c(v, d, s, ep, ip, errs, ev) { if (d >= h_maxd) h_deep(); d++;
let ok = true;
const m0 = ev.length; if (!u6c(v, d, h_s0, ep + "/$ref", ip, errs, ev)) { ok = false; ev.length = m0; }
return ok; }
function u6(v, d, s, ep, ip, errs) { if (d >= h_maxd) h_deep(); d++;
const g0 = (typeof v === "object" && v !== null && !Array.isArray(v));
let ok = true;
if ((g0 && (v["createdAt"] !== undefined))) { if (!u7(v["createdAt"], d, h_s0, ep + "/properties/createdAt", ip + "/createdAt", errs)) { ok = false; } }
if ((g0 && (v["updatedAt"] !== undefined))) { if (!u8(v["updatedAt"], d, h_s0, ep + "/properties/updatedAt", ip + "/updatedAt", errs)) { ok = false; } }
if (g0) {  }
if (!(g0)) { ok = false; errs.push({ evaluationPath: ep + "/type", schemaLocation: "https://spike.example/event#/$defs/timestamps/type", inputLocation: ip, error: "expected type \"object\"", keyword: "type", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "expected": "object" } }); }
if (g0) { if (!((v["createdAt"] !== undefined))) { ok = false; errs.push({ evaluationPath: ep + "/required", schemaLocation: "https://spike.example/event#/$defs/timestamps/required", inputLocation: ip, error: "missing required property 'createdAt'", keyword: "required", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "missingProperty": "createdAt" } }); } }
return ok; }
function u6c(v, d, s, ep, ip, errs, ev) { if (d >= h_maxd) h_deep(); d++;
const g2 = (typeof v === "object" && v !== null && !Array.isArray(v));
let ok = true;
let k0 = true;
const n1 = new Set();
if ((g2 && (v["createdAt"] !== undefined))) { n1.add("createdAt"); if (!u7(v["createdAt"], d, h_s0, ep + "/properties/createdAt", ip + "/createdAt", errs)) { ok = false; k0 = false; } }
if ((g2 && (v["updatedAt"] !== undefined))) { n1.add("updatedAt"); if (!u8(v["updatedAt"], d, h_s0, ep + "/properties/updatedAt", ip + "/updatedAt", errs)) { ok = false; k0 = false; } }
if (g2) { if (k0) { ev.push([...n1]); } }
if (!(g2)) { ok = false; errs.push({ evaluationPath: ep + "/type", schemaLocation: "https://spike.example/event#/$defs/timestamps/type", inputLocation: ip, error: "expected type \"object\"", keyword: "type", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "expected": "object" } }); }
if (g2) { if (!((v["createdAt"] !== undefined))) { ok = false; errs.push({ evaluationPath: ep + "/required", schemaLocation: "https://spike.example/event#/$defs/timestamps/required", inputLocation: ip, error: "missing required property 'createdAt'", keyword: "required", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "missingProperty": "createdAt" } }); } }
return ok; }
function u7(v, d, s, ep, ip, errs) { let ok = true;
if (!((typeof v === "string"))) { ok = false; errs.push({ evaluationPath: ep + "/type", schemaLocation: "https://spike.example/event#/$defs/timestamps/properties/createdAt/type", inputLocation: ip, error: "expected type \"string\"", keyword: "type", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "expected": "string" } }); }
return ok; }
function u8(v, d, s, ep, ip, errs) { let ok = true;
if (!((typeof v === "string"))) { ok = false; errs.push({ evaluationPath: ep + "/type", schemaLocation: "https://spike.example/event#/$defs/timestamps/properties/updatedAt/type", inputLocation: ip, error: "expected type \"string\"", keyword: "type", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "expected": "string" } }); }
return ok; }
function u9(v, d, s, ep, ip, errs) { let ok = true;
if (!(((v === "created") || (v === "updated") || (v === "deleted")))) { ok = false; errs.push({ evaluationPath: ep + "/enum", schemaLocation: "https://spike.example/event#/properties/kind/enum", inputLocation: ip, error: "not one of the allowed values", keyword: "enum", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "allowedValues": ["created","updated","deleted"] } }); }
return ok; }
function u10(v, d, s, ep, ip, errs) { errs.push({ evaluationPath: ep, schemaLocation: "https://spike.example/event#/unevaluatedProperties", inputLocation: ip, error: "schema is false", params: {} }); return false; }
return function evaluateList(v) { const errs = []; const ok = u0(v, 0, h_s0, "", "", errs); return { valid: ok, errors: errs }; };
