"use strict";
const { isObject: h_obj, isInteger: h_int, jsonEqual: h_eq, canonicalKey: h_ck, codePointLength: h_cpl, escapeSegment: h_esc, isMultipleOf: h_mof, hasDuplicateItems: h_dup, firstDuplicatePair: h_fdp, frag: h_frag, fragList: h_fragl, tooDeep: h_deep } = R;
const h_maxd = R.maxDepth;
const h_s0 = [];
const h_hop = Object.prototype.hasOwnProperty;
const { labeledNames: h_lnames, typedPreview: h_tprev, apparentType: h_atype, missingNames: h_miss, preview: h_prev } = R.messageHelpers;
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
if (g0) { const b1 = []; for (const b0 in v) { if (!(((b0 === "id") || (b0 === "name") || (b0 === "email") || (b0 === "role") || (b0 === "tags") || (b0 === "address")))) { b1.push(b0); } } if (b1.length) { ok = false; errs.push({ evaluationPath: ep + "/additionalProperties", schemaLocation: "https://spike.example/user#/additionalProperties", inputLocation: ip, error: ("additional " + String(h_lnames(b1, "property", "properties")) + " not allowed"), keyword: "additionalProperties", vocabulary: "https://json-schema.org/draft/2020-12/vocab/applicator", params: { "properties": b1 } }); } }
if (g0) {  }
if (!(g0)) { ok = false; errs.push({ evaluationPath: ep + "/type", schemaLocation: "https://spike.example/user#/type", inputLocation: ip, error: ("expected object, got " + String(h_tprev(v))), keyword: "type", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "expected": ["object"], "actual": h_atype(v), "value": v } }); }
if ((g0 && (!(("id" in v)) || !(("name" in v)) || !(("email" in v)) || !(("tags" in v))))) { ok = false; errs.push({ evaluationPath: ep + "/required", schemaLocation: "https://spike.example/user#/required", inputLocation: ip, error: ("missing required " + String(h_lnames(h_miss(v, ["id","name","email","tags"]), "property", "properties"))), keyword: "required", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "missing": h_miss(v, ["id","name","email","tags"]) } }); }
return ok; }
function u1(v, d, s, ep, ip, errs) { let ok = true;
if (!((typeof v === "number" && Number.isInteger(v)))) { ok = false; errs.push({ evaluationPath: ep + "/type", schemaLocation: "https://spike.example/user#/properties/id/type", inputLocation: ip, error: ("expected integer, got " + String(h_tprev(v))), keyword: "type", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "expected": ["integer"], "actual": h_atype(v), "value": v } }); }
if (((typeof v === "number") && !((v >= 1)))) { ok = false; errs.push({ evaluationPath: ep + "/minimum", schemaLocation: "https://spike.example/user#/properties/id/minimum", inputLocation: ip, error: ("must be >= 1, got " + String(h_prev(v))), keyword: "minimum", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "limit": 1, "value": v } }); }
return ok; }
function u2(v, d, s, ep, ip, errs) { let ok = true;
if (!((typeof v === "string"))) { ok = false; errs.push({ evaluationPath: ep + "/type", schemaLocation: "https://spike.example/user#/properties/name/type", inputLocation: ip, error: ("expected string, got " + String(h_tprev(v))), keyword: "type", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "expected": ["string"], "actual": h_atype(v), "value": v } }); }
if (((typeof v === "string") && ((v.length < 1) || ((v.length < 2) && (h_cpl(v) < 1))))) { ok = false; errs.push({ evaluationPath: ep + "/minLength", schemaLocation: "https://spike.example/user#/properties/name/minLength", inputLocation: ip, error: ("must be at least 1 characters, got " + String(h_prev(v)) + " (" + String(h_cpl(v)) + ")"), keyword: "minLength", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "limit": 1, "value": v, "length": h_cpl(v) } }); }
if (((typeof v === "string") && (v.length > 100) && (h_cpl(v) > 100))) { ok = false; errs.push({ evaluationPath: ep + "/maxLength", schemaLocation: "https://spike.example/user#/properties/name/maxLength", inputLocation: ip, error: ("must be at most 100 characters, got " + String(h_prev(v)) + " (" + String(h_cpl(v)) + ")"), keyword: "maxLength", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "limit": 100, "value": v, "length": h_cpl(v) } }); }
return ok; }
function u3(v, d, s, ep, ip, errs) { let ok = true;
if (!((typeof v === "string"))) { ok = false; errs.push({ evaluationPath: ep + "/type", schemaLocation: "https://spike.example/user#/properties/email/type", inputLocation: ip, error: ("expected string, got " + String(h_tprev(v))), keyword: "type", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "expected": ["string"], "actual": h_atype(v), "value": v } }); }
if (((typeof v === "string") && !(r0.test(v)))) { ok = false; errs.push({ evaluationPath: ep + "/pattern", schemaLocation: "https://spike.example/user#/properties/email/pattern", inputLocation: ip, error: ("must match pattern \"^[^@\\\\s]+@[^@\\\\s]+\\\\.[^@\\\\s]+$\", got " + String(h_prev(v))), keyword: "pattern", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "pattern": "^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$", "value": v } }); }
return ok; }
function u4(v, d, s, ep, ip, errs) { let ok = true;
if (!(((v === "admin") || (v === "user") || (v === "guest")))) { ok = false; errs.push({ evaluationPath: ep + "/enum", schemaLocation: "https://spike.example/user#/properties/role/enum", inputLocation: ip, error: ("must be one of [\"admin\", \"user\", \"guest\"], got " + String(h_prev(v))), keyword: "enum", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "allowedValues": ["admin","user","guest"], "value": v } }); }
return ok; }
function u5(v, d, s, ep, ip, errs) { if (d >= h_maxd) h_deep(); d++;
let ok = true;
if (Array.isArray(v)) { for (let b0 = 0; b0 < v.length; b0++) { if (!u6(v[b0], d, h_s0, ep + "/items", ip + "/" + h_esc(String(b0)), errs)) { ok = false; } } }

if (!(Array.isArray(v))) { ok = false; errs.push({ evaluationPath: ep + "/type", schemaLocation: "https://spike.example/user#/properties/tags/type", inputLocation: ip, error: ("expected array, got " + String(h_tprev(v))), keyword: "type", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "expected": ["array"], "actual": h_atype(v), "value": v } }); }
if ((Array.isArray(v) && !((v.length <= 10)))) { ok = false; errs.push({ evaluationPath: ep + "/maxItems", schemaLocation: "https://spike.example/user#/properties/tags/maxItems", inputLocation: ip, error: ("must have at most 10 items, got " + String(v.length)), keyword: "maxItems", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "limit": 10, "count": v.length } }); }
return ok; }
function u6(v, d, s, ep, ip, errs) { let ok = true;
if (!((typeof v === "string"))) { ok = false; errs.push({ evaluationPath: ep + "/type", schemaLocation: "https://spike.example/user#/properties/tags/items/type", inputLocation: ip, error: ("expected string, got " + String(h_tprev(v))), keyword: "type", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "expected": ["string"], "actual": h_atype(v), "value": v } }); }
return ok; }
function u7(v, d, s, ep, ip, errs) { if (d >= h_maxd) h_deep(); d++;
const g0 = (typeof v === "object" && v !== null && !Array.isArray(v));
let ok = true;
if ((g0 && ("street" in v))) { if (!u8(v["street"], d, h_s0, ep + "/properties/street", ip + "/street", errs)) { ok = false; } }
if ((g0 && ("city" in v))) { if (!u9(v["city"], d, h_s0, ep + "/properties/city", ip + "/city", errs)) { ok = false; } }
if ((g0 && ("zip" in v))) { if (!u10(v["zip"], d, h_s0, ep + "/properties/zip", ip + "/zip", errs)) { ok = false; } }
if (g0) {  }
if (!(g0)) { ok = false; errs.push({ evaluationPath: ep + "/type", schemaLocation: "https://spike.example/user#/properties/address/type", inputLocation: ip, error: ("expected object, got " + String(h_tprev(v))), keyword: "type", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "expected": ["object"], "actual": h_atype(v), "value": v } }); }
if ((g0 && (!(("street" in v)) || !(("city" in v))))) { ok = false; errs.push({ evaluationPath: ep + "/required", schemaLocation: "https://spike.example/user#/properties/address/required", inputLocation: ip, error: ("missing required " + String(h_lnames(h_miss(v, ["street","city"]), "property", "properties"))), keyword: "required", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "missing": h_miss(v, ["street","city"]) } }); }
return ok; }
function u8(v, d, s, ep, ip, errs) { let ok = true;
if (!((typeof v === "string"))) { ok = false; errs.push({ evaluationPath: ep + "/type", schemaLocation: "https://spike.example/user#/properties/address/properties/street/type", inputLocation: ip, error: ("expected string, got " + String(h_tprev(v))), keyword: "type", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "expected": ["string"], "actual": h_atype(v), "value": v } }); }
return ok; }
function u9(v, d, s, ep, ip, errs) { let ok = true;
if (!((typeof v === "string"))) { ok = false; errs.push({ evaluationPath: ep + "/type", schemaLocation: "https://spike.example/user#/properties/address/properties/city/type", inputLocation: ip, error: ("expected string, got " + String(h_tprev(v))), keyword: "type", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "expected": ["string"], "actual": h_atype(v), "value": v } }); }
return ok; }
function u10(v, d, s, ep, ip, errs) { let ok = true;
if (!((typeof v === "string"))) { ok = false; errs.push({ evaluationPath: ep + "/type", schemaLocation: "https://spike.example/user#/properties/address/properties/zip/type", inputLocation: ip, error: ("expected string, got " + String(h_tprev(v))), keyword: "type", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "expected": ["string"], "actual": h_atype(v), "value": v } }); }
if (((typeof v === "string") && !(r1.test(v)))) { ok = false; errs.push({ evaluationPath: ep + "/pattern", schemaLocation: "https://spike.example/user#/properties/address/properties/zip/pattern", inputLocation: ip, error: ("must match pattern \"^[0-9]{5}$\", got " + String(h_prev(v))), keyword: "pattern", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "pattern": "^[0-9]{5}$", "value": v } }); }
return ok; }
function u11(v, d, s, ep, ip, errs) { errs.push({ evaluationPath: ep, schemaLocation: "https://spike.example/user#/additionalProperties", inputLocation: ip, error: "schema is false", params: {} }); return false; }
return function evaluateList(v) { const errs = []; const ok = u0(v, 0, h_s0, "", "", errs); return { valid: ok, errors: errs }; };
