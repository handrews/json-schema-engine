"use strict";
const { isObject: h_obj, isInteger: h_int, jsonEqual: h_eq, canonicalKey: h_ck, codePointLength: h_cpl, escapeSegment: h_esc, isMultipleOf: h_mof, hasDuplicateItems: h_dup, firstDuplicatePair: h_fdp, frag: h_frag, fragList: h_fragl, tooDeep: h_deep } = R;
const h_maxd = R.maxDepth;
const h_s0 = [];
const h_hop = Object.prototype.hasOwnProperty;
const r0 = R.re["^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$"];
const r1 = R.re["^[0-9]{5}$"];
function u0(v, d, s, ep, ip, errs) { if (d >= h_maxd) h_deep(); d++;
const g0 = (typeof v === "object" && v !== null && !Array.isArray(v));
let ok = true;
if ((g0 && ("id" in v))) { if (!u1(v["id"], d, h_s0, ep + "/properties/id", ip + "/id", errs)) { ok = false; } }
if ((g0 && ("name" in v))) { if (!u2(v["name"], d, h_s0, ep + "/properties/name", ip + "/name", errs)) { ok = false; } }
if ((g0 && ("email" in v))) { if (!u3(v["email"], d, h_s0, ep + "/properties/email", ip + "/email", errs)) { ok = false; } }
if ((g0 && ("role" in v))) { if (!u4(v["role"], d, h_s0, ep + "/properties/role", ip + "/role", errs)) { ok = false; } }
if ((g0 && ("tags" in v))) { if (!u5(v["tags"], d, h_s0, ep + "/properties/tags", ip + "/tags", errs)) { ok = false; } }
if ((g0 && ("address" in v))) { if (!u7(v["address"], d, h_s0, ep + "/properties/address", ip + "/address", errs)) { ok = false; } }
if (g0) {  }
if (g0) { for (const b0 in v) { if (!(((b0 === "id") || (b0 === "name") || (b0 === "email") || (b0 === "role") || (b0 === "tags") || (b0 === "address")))) { if (!u11(v[b0], d, h_s0, ep + "/additionalProperties", ip + "/" + h_esc(String(b0)), errs)) { ok = false; } } } }
if (g0) {  }
if (!(g0)) { ok = false; errs.push({ evaluationPath: ep + "/type", schemaLocation: "https://spike.example/user#/type", inputLocation: ip, error: "expected type \"object\"", keyword: "type", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "expected": "object" } }); }
if (g0) { if (!(("id" in v))) { ok = false; errs.push({ evaluationPath: ep + "/required", schemaLocation: "https://spike.example/user#/required", inputLocation: ip, error: "missing required property 'id'", keyword: "required", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "missingProperty": "id" } }); }
if (!(("name" in v))) { ok = false; errs.push({ evaluationPath: ep + "/required", schemaLocation: "https://spike.example/user#/required", inputLocation: ip, error: "missing required property 'name'", keyword: "required", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "missingProperty": "name" } }); }
if (!(("email" in v))) { ok = false; errs.push({ evaluationPath: ep + "/required", schemaLocation: "https://spike.example/user#/required", inputLocation: ip, error: "missing required property 'email'", keyword: "required", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "missingProperty": "email" } }); }
if (!(("tags" in v))) { ok = false; errs.push({ evaluationPath: ep + "/required", schemaLocation: "https://spike.example/user#/required", inputLocation: ip, error: "missing required property 'tags'", keyword: "required", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "missingProperty": "tags" } }); } }
return ok; }
function u1(v, d, s, ep, ip, errs) { let ok = true;
if (!((typeof v === "number" && Number.isInteger(v)))) { ok = false; errs.push({ evaluationPath: ep + "/type", schemaLocation: "https://spike.example/user#/properties/id/type", inputLocation: ip, error: "expected type \"integer\"", keyword: "type", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "expected": "integer" } }); }
if (((typeof v === "number") && !((v >= 1)))) { ok = false; errs.push({ evaluationPath: ep + "/minimum", schemaLocation: "https://spike.example/user#/properties/id/minimum", inputLocation: ip, error: "must be >= 1", keyword: "minimum", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "limit": 1 } }); }
return ok; }
function u2(v, d, s, ep, ip, errs) { let ok = true;
if (!((typeof v === "string"))) { ok = false; errs.push({ evaluationPath: ep + "/type", schemaLocation: "https://spike.example/user#/properties/name/type", inputLocation: ip, error: "expected type \"string\"", keyword: "type", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "expected": "string" } }); }
if (((typeof v === "string") && ((v.length < 1) || ((v.length < 2) && (h_cpl(v) < 1))))) { ok = false; errs.push({ evaluationPath: ep + "/minLength", schemaLocation: "https://spike.example/user#/properties/name/minLength", inputLocation: ip, error: "must be at least 1 characters", keyword: "minLength", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "limit": 1 } }); }
if (((typeof v === "string") && (v.length > 100) && (h_cpl(v) > 100))) { ok = false; errs.push({ evaluationPath: ep + "/maxLength", schemaLocation: "https://spike.example/user#/properties/name/maxLength", inputLocation: ip, error: "must be at most 100 characters", keyword: "maxLength", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "limit": 100 } }); }
return ok; }
function u3(v, d, s, ep, ip, errs) { let ok = true;
if (!((typeof v === "string"))) { ok = false; errs.push({ evaluationPath: ep + "/type", schemaLocation: "https://spike.example/user#/properties/email/type", inputLocation: ip, error: "expected type \"string\"", keyword: "type", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "expected": "string" } }); }
if (((typeof v === "string") && !(r0.test(v)))) { ok = false; errs.push({ evaluationPath: ep + "/pattern", schemaLocation: "https://spike.example/user#/properties/email/pattern", inputLocation: ip, error: "does not match required pattern", keyword: "pattern", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "pattern": "^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$" } }); }
return ok; }
function u4(v, d, s, ep, ip, errs) { let ok = true;
if (!(((v === "admin") || (v === "user") || (v === "guest")))) { ok = false; errs.push({ evaluationPath: ep + "/enum", schemaLocation: "https://spike.example/user#/properties/role/enum", inputLocation: ip, error: "not one of the allowed values", keyword: "enum", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "allowedValues": ["admin","user","guest"] } }); }
return ok; }
function u5(v, d, s, ep, ip, errs) { if (d >= h_maxd) h_deep(); d++;
let ok = true;
if (Array.isArray(v)) { for (let b0 = 0; b0 < v.length; b0++) { if (!u6(v[b0], d, h_s0, ep + "/items", ip + "/" + h_esc(String(b0)), errs)) { ok = false; } } }

if (!(Array.isArray(v))) { ok = false; errs.push({ evaluationPath: ep + "/type", schemaLocation: "https://spike.example/user#/properties/tags/type", inputLocation: ip, error: "expected type \"array\"", keyword: "type", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "expected": "array" } }); }
if ((Array.isArray(v) && !((v.length <= 10)))) { ok = false; errs.push({ evaluationPath: ep + "/maxItems", schemaLocation: "https://spike.example/user#/properties/tags/maxItems", inputLocation: ip, error: "must have at most 10 items", keyword: "maxItems", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "limit": 10 } }); }
return ok; }
function u6(v, d, s, ep, ip, errs) { let ok = true;
if (!((typeof v === "string"))) { ok = false; errs.push({ evaluationPath: ep + "/type", schemaLocation: "https://spike.example/user#/properties/tags/items/type", inputLocation: ip, error: "expected type \"string\"", keyword: "type", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "expected": "string" } }); }
return ok; }
function u7(v, d, s, ep, ip, errs) { if (d >= h_maxd) h_deep(); d++;
const g0 = (typeof v === "object" && v !== null && !Array.isArray(v));
let ok = true;
if ((g0 && ("street" in v))) { if (!u8(v["street"], d, h_s0, ep + "/properties/street", ip + "/street", errs)) { ok = false; } }
if ((g0 && ("city" in v))) { if (!u9(v["city"], d, h_s0, ep + "/properties/city", ip + "/city", errs)) { ok = false; } }
if ((g0 && ("zip" in v))) { if (!u10(v["zip"], d, h_s0, ep + "/properties/zip", ip + "/zip", errs)) { ok = false; } }
if (g0) {  }
if (!(g0)) { ok = false; errs.push({ evaluationPath: ep + "/type", schemaLocation: "https://spike.example/user#/properties/address/type", inputLocation: ip, error: "expected type \"object\"", keyword: "type", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "expected": "object" } }); }
if (g0) { if (!(("street" in v))) { ok = false; errs.push({ evaluationPath: ep + "/required", schemaLocation: "https://spike.example/user#/properties/address/required", inputLocation: ip, error: "missing required property 'street'", keyword: "required", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "missingProperty": "street" } }); }
if (!(("city" in v))) { ok = false; errs.push({ evaluationPath: ep + "/required", schemaLocation: "https://spike.example/user#/properties/address/required", inputLocation: ip, error: "missing required property 'city'", keyword: "required", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "missingProperty": "city" } }); } }
return ok; }
function u8(v, d, s, ep, ip, errs) { let ok = true;
if (!((typeof v === "string"))) { ok = false; errs.push({ evaluationPath: ep + "/type", schemaLocation: "https://spike.example/user#/properties/address/properties/street/type", inputLocation: ip, error: "expected type \"string\"", keyword: "type", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "expected": "string" } }); }
return ok; }
function u9(v, d, s, ep, ip, errs) { let ok = true;
if (!((typeof v === "string"))) { ok = false; errs.push({ evaluationPath: ep + "/type", schemaLocation: "https://spike.example/user#/properties/address/properties/city/type", inputLocation: ip, error: "expected type \"string\"", keyword: "type", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "expected": "string" } }); }
return ok; }
function u10(v, d, s, ep, ip, errs) { let ok = true;
if (!((typeof v === "string"))) { ok = false; errs.push({ evaluationPath: ep + "/type", schemaLocation: "https://spike.example/user#/properties/address/properties/zip/type", inputLocation: ip, error: "expected type \"string\"", keyword: "type", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "expected": "string" } }); }
if (((typeof v === "string") && !(r1.test(v)))) { ok = false; errs.push({ evaluationPath: ep + "/pattern", schemaLocation: "https://spike.example/user#/properties/address/properties/zip/pattern", inputLocation: ip, error: "does not match required pattern", keyword: "pattern", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "pattern": "^[0-9]{5}$" } }); }
return ok; }
function u11(v, d, s, ep, ip, errs) { errs.push({ evaluationPath: ep, schemaLocation: "https://spike.example/user#/additionalProperties", inputLocation: ip, error: "schema is false", params: {} }); return false; }
return function evaluateList(v) { const errs = []; const ok = u0(v, 0, h_s0, "", "", errs); return { valid: ok, errors: errs }; };
