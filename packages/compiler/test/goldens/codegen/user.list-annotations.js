"use strict";
const { isObject: h_obj, isInteger: h_int, jsonEqual: h_eq, canonicalKey: h_ck, codePointLength: h_cpl, escapeSegment: h_esc, isMultipleOf: h_mof, hasDuplicateItems: h_dup, firstDuplicatePair: h_fdp, frag: h_frag, fragList: h_fragl, tooDeep: h_deep } = R;
const h_maxd = R.maxDepth;
const h_s0 = [];
const h_hop = Object.prototype.hasOwnProperty;
const h_fragla = R.fragListAnn;
const r0 = R.re["^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$"];
const r1 = R.re["^[0-9]{5}$"];
function u0(v, d, s, ep, ip, errs, anns) { if (d >= h_maxd) h_deep(); d++;
const g1 = (typeof v === "object" && v !== null && !Array.isArray(v));
let ok = true;
if ((g1 && (v["id"] !== undefined))) { const m0 = anns.length; if (!u1(v["id"], d, h_s0, ep + "/properties/id", ip + "/id", errs, anns)) { ok = false; anns.length = m0; } }
if ((g1 && (v["name"] !== undefined))) { const m2 = anns.length; if (!u2(v["name"], d, h_s0, ep + "/properties/name", ip + "/name", errs, anns)) { ok = false; anns.length = m2; } }
if ((g1 && (v["email"] !== undefined))) { const m3 = anns.length; if (!u3(v["email"], d, h_s0, ep + "/properties/email", ip + "/email", errs, anns)) { ok = false; anns.length = m3; } }
if ((g1 && (v["role"] !== undefined))) { const m4 = anns.length; if (!u4(v["role"], d, h_s0, ep + "/properties/role", ip + "/role", errs, anns)) { ok = false; anns.length = m4; } }
if ((g1 && (v["tags"] !== undefined))) { const m5 = anns.length; if (!u5(v["tags"], d, h_s0, ep + "/properties/tags", ip + "/tags", errs, anns)) { ok = false; anns.length = m5; } }
if ((g1 && (v["address"] !== undefined))) { const m6 = anns.length; if (!u7(v["address"], d, h_s0, ep + "/properties/address", ip + "/address", errs, anns)) { ok = false; anns.length = m6; } }
if (g1) {  }
if (g1) { for (const b0 in v) { if (!(((b0 === "id") || (b0 === "name") || (b0 === "email") || (b0 === "role") || (b0 === "tags") || (b0 === "address")))) { const m7 = anns.length; if (!u11(v[b0], d, h_s0, ep + "/additionalProperties", ip + "/" + h_esc(String(b0)), errs, anns)) { ok = false; anns.length = m7; } } } }
if (g1) {  }
if (!(g1)) { ok = false; errs.push({ evaluationPath: ep + "/type", schemaLocation: "https://spike.example/user#/type", inputLocation: ip, error: "expected type \"object\"", keyword: "type", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "expected": "object" } }); }
if (g1) { if (!((v["id"] !== undefined))) { ok = false; errs.push({ evaluationPath: ep + "/required", schemaLocation: "https://spike.example/user#/required", inputLocation: ip, error: "missing required property 'id'", keyword: "required", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "missingProperty": "id" } }); }
if (!((v["name"] !== undefined))) { ok = false; errs.push({ evaluationPath: ep + "/required", schemaLocation: "https://spike.example/user#/required", inputLocation: ip, error: "missing required property 'name'", keyword: "required", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "missingProperty": "name" } }); }
if (!((v["email"] !== undefined))) { ok = false; errs.push({ evaluationPath: ep + "/required", schemaLocation: "https://spike.example/user#/required", inputLocation: ip, error: "missing required property 'email'", keyword: "required", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "missingProperty": "email" } }); }
if (!((v["tags"] !== undefined))) { ok = false; errs.push({ evaluationPath: ep + "/required", schemaLocation: "https://spike.example/user#/required", inputLocation: ip, error: "missing required property 'tags'", keyword: "required", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "missingProperty": "tags" } }); } }
return ok; }
function u1(v, d, s, ep, ip, errs, anns) { let ok = true;
if (!((typeof v === "number" && Number.isInteger(v)))) { ok = false; errs.push({ evaluationPath: ep + "/type", schemaLocation: "https://spike.example/user#/properties/id/type", inputLocation: ip, error: "expected type \"integer\"", keyword: "type", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "expected": "integer" } }); }
if (((typeof v === "number") && !((v >= 1)))) { ok = false; errs.push({ evaluationPath: ep + "/minimum", schemaLocation: "https://spike.example/user#/properties/id/minimum", inputLocation: ip, error: "must be >= 1", keyword: "minimum", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "limit": 1 } }); }
return ok; }
function u2(v, d, s, ep, ip, errs, anns) { let ok = true;
if (!((typeof v === "string"))) { ok = false; errs.push({ evaluationPath: ep + "/type", schemaLocation: "https://spike.example/user#/properties/name/type", inputLocation: ip, error: "expected type \"string\"", keyword: "type", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "expected": "string" } }); }
if (((typeof v === "string") && ((v.length < 1) || ((v.length < 2) && (h_cpl(v) < 1))))) { ok = false; errs.push({ evaluationPath: ep + "/minLength", schemaLocation: "https://spike.example/user#/properties/name/minLength", inputLocation: ip, error: "must be at least 1 characters", keyword: "minLength", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "limit": 1 } }); }
if (((typeof v === "string") && (v.length > 100) && (h_cpl(v) > 100))) { ok = false; errs.push({ evaluationPath: ep + "/maxLength", schemaLocation: "https://spike.example/user#/properties/name/maxLength", inputLocation: ip, error: "must be at most 100 characters", keyword: "maxLength", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "limit": 100 } }); }
return ok; }
function u3(v, d, s, ep, ip, errs, anns) { let ok = true;
if (!((typeof v === "string"))) { ok = false; errs.push({ evaluationPath: ep + "/type", schemaLocation: "https://spike.example/user#/properties/email/type", inputLocation: ip, error: "expected type \"string\"", keyword: "type", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "expected": "string" } }); }
if (((typeof v === "string") && !(r0.test(v)))) { ok = false; errs.push({ evaluationPath: ep + "/pattern", schemaLocation: "https://spike.example/user#/properties/email/pattern", inputLocation: ip, error: "does not match required pattern", keyword: "pattern", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "pattern": "^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$" } }); }
return ok; }
function u4(v, d, s, ep, ip, errs, anns) { let ok = true;
if (!(((v === "admin") || (v === "user") || (v === "guest")))) { ok = false; errs.push({ evaluationPath: ep + "/enum", schemaLocation: "https://spike.example/user#/properties/role/enum", inputLocation: ip, error: "not one of the allowed values", keyword: "enum", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "allowedValues": ["admin","user","guest"] } }); }
return ok; }
function u5(v, d, s, ep, ip, errs, anns) { if (d >= h_maxd) h_deep(); d++;
let ok = true;
if (Array.isArray(v)) { for (let b0 = 0; b0 < v.length; b0++) { const m0 = anns.length; if (!u6(v[b0], d, h_s0, ep + "/items", ip + "/" + h_esc(String(b0)), errs, anns)) { ok = false; anns.length = m0; } } }

if (!(Array.isArray(v))) { ok = false; errs.push({ evaluationPath: ep + "/type", schemaLocation: "https://spike.example/user#/properties/tags/type", inputLocation: ip, error: "expected type \"array\"", keyword: "type", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "expected": "array" } }); }
if ((Array.isArray(v) && !((v.length <= 10)))) { ok = false; errs.push({ evaluationPath: ep + "/maxItems", schemaLocation: "https://spike.example/user#/properties/tags/maxItems", inputLocation: ip, error: "must have at most 10 items", keyword: "maxItems", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "limit": 10 } }); }
return ok; }
function u6(v, d, s, ep, ip, errs, anns) { let ok = true;
if (!((typeof v === "string"))) { ok = false; errs.push({ evaluationPath: ep + "/type", schemaLocation: "https://spike.example/user#/properties/tags/items/type", inputLocation: ip, error: "expected type \"string\"", keyword: "type", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "expected": "string" } }); }
return ok; }
function u7(v, d, s, ep, ip, errs, anns) { if (d >= h_maxd) h_deep(); d++;
const g1 = (typeof v === "object" && v !== null && !Array.isArray(v));
let ok = true;
if ((g1 && (v["street"] !== undefined))) { const m0 = anns.length; if (!u8(v["street"], d, h_s0, ep + "/properties/street", ip + "/street", errs, anns)) { ok = false; anns.length = m0; } }
if ((g1 && (v["city"] !== undefined))) { const m2 = anns.length; if (!u9(v["city"], d, h_s0, ep + "/properties/city", ip + "/city", errs, anns)) { ok = false; anns.length = m2; } }
if ((g1 && (v["zip"] !== undefined))) { const m3 = anns.length; if (!u10(v["zip"], d, h_s0, ep + "/properties/zip", ip + "/zip", errs, anns)) { ok = false; anns.length = m3; } }
if (g1) {  }
if (!(g1)) { ok = false; errs.push({ evaluationPath: ep + "/type", schemaLocation: "https://spike.example/user#/properties/address/type", inputLocation: ip, error: "expected type \"object\"", keyword: "type", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "expected": "object" } }); }
if (g1) { if (!((v["street"] !== undefined))) { ok = false; errs.push({ evaluationPath: ep + "/required", schemaLocation: "https://spike.example/user#/properties/address/required", inputLocation: ip, error: "missing required property 'street'", keyword: "required", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "missingProperty": "street" } }); }
if (!((v["city"] !== undefined))) { ok = false; errs.push({ evaluationPath: ep + "/required", schemaLocation: "https://spike.example/user#/properties/address/required", inputLocation: ip, error: "missing required property 'city'", keyword: "required", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "missingProperty": "city" } }); } }
return ok; }
function u8(v, d, s, ep, ip, errs, anns) { let ok = true;
if (!((typeof v === "string"))) { ok = false; errs.push({ evaluationPath: ep + "/type", schemaLocation: "https://spike.example/user#/properties/address/properties/street/type", inputLocation: ip, error: "expected type \"string\"", keyword: "type", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "expected": "string" } }); }
return ok; }
function u9(v, d, s, ep, ip, errs, anns) { let ok = true;
if (!((typeof v === "string"))) { ok = false; errs.push({ evaluationPath: ep + "/type", schemaLocation: "https://spike.example/user#/properties/address/properties/city/type", inputLocation: ip, error: "expected type \"string\"", keyword: "type", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "expected": "string" } }); }
return ok; }
function u10(v, d, s, ep, ip, errs, anns) { let ok = true;
if (!((typeof v === "string"))) { ok = false; errs.push({ evaluationPath: ep + "/type", schemaLocation: "https://spike.example/user#/properties/address/properties/zip/type", inputLocation: ip, error: "expected type \"string\"", keyword: "type", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "expected": "string" } }); }
if (((typeof v === "string") && !(r1.test(v)))) { ok = false; errs.push({ evaluationPath: ep + "/pattern", schemaLocation: "https://spike.example/user#/properties/address/properties/zip/pattern", inputLocation: ip, error: "does not match required pattern", keyword: "pattern", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "pattern": "^[0-9]{5}$" } }); }
return ok; }
function u11(v, d, s, ep, ip, errs, anns) { errs.push({ evaluationPath: ep, schemaLocation: "https://spike.example/user#/additionalProperties", inputLocation: ip, error: "schema is false", params: {} }); return false; }
return function evaluateList(v) { const errs = []; const anns = []; const ok = u0(v, 0, h_s0, "", "", errs, anns); return { valid: ok, errors: errs, annotations: anns }; };
