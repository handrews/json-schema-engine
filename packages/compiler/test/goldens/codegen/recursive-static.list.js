"use strict";
const { isObject: h_obj, isInteger: h_int, jsonEqual: h_eq, canonicalKey: h_ck, codePointLength: h_cpl, escapeSegment: h_esc, isMultipleOf: h_mof, hasDuplicateItems: h_dup, firstDuplicatePair: h_fdp, frag: h_frag, fragList: h_fragl, tooDeep: h_deep } = R;
const h_maxd = R.maxDepth;
const h_s0 = [];
const h_hop = Object.prototype.hasOwnProperty;
function u0(v, d, s, ep, ip, errs) { if (d >= h_maxd) h_deep(); d++;
const g0 = (typeof v === "object" && v !== null && !Array.isArray(v));
let ok = true;
if ((g0 && ("name" in v))) { if (!u1(v["name"], d, h_s0, ep + "/properties/name", ip + "/name", errs)) { ok = false; } }
if ((g0 && ("children" in v))) { if (!u2(v["children"], d, h_s0, ep + "/properties/children", ip + "/children", errs)) { ok = false; } }
if (g0) {  }
if (!(g0)) { ok = false; errs.push({ evaluationPath: ep + "/type", schemaLocation: "https://codegen.example/recursive-static#/type", inputLocation: ip, error: "expected type \"object\"", keyword: "type", vocabulary: "https://json-schema.org/draft/2019-09/vocab/validation", params: { "expected": "object" } }); }
if (g0) { if (!(("name" in v))) { ok = false; errs.push({ evaluationPath: ep + "/required", schemaLocation: "https://codegen.example/recursive-static#/required", inputLocation: ip, error: "missing required property 'name'", keyword: "required", vocabulary: "https://json-schema.org/draft/2019-09/vocab/validation", params: { "missingProperty": "name" } }); } }
return ok; }
function u1(v, d, s, ep, ip, errs) { let ok = true;
if (!((typeof v === "string"))) { ok = false; errs.push({ evaluationPath: ep + "/type", schemaLocation: "https://codegen.example/recursive-static#/properties/name/type", inputLocation: ip, error: "expected type \"string\"", keyword: "type", vocabulary: "https://json-schema.org/draft/2019-09/vocab/validation", params: { "expected": "string" } }); }
return ok; }
function u2(v, d, s, ep, ip, errs) { if (d >= h_maxd) h_deep(); d++;
let ok = true;
if (Array.isArray(v)) { for (let b0 = 0; b0 < v.length; b0++) { if (!u3(v[b0], d, h_s0, ep + "/items", ip + "/" + h_esc(String(b0)), errs)) { ok = false; } } }

if (!(Array.isArray(v))) { ok = false; errs.push({ evaluationPath: ep + "/type", schemaLocation: "https://codegen.example/recursive-static#/properties/children/type", inputLocation: ip, error: "expected type \"array\"", keyword: "type", vocabulary: "https://json-schema.org/draft/2019-09/vocab/validation", params: { "expected": "array" } }); }
return ok; }
function u3(v, d, s, ep, ip, errs) { if (d >= h_maxd) h_deep(); d++;
let ok = true;
if (!u0(v, d, h_s0, ep + "/$recursiveRef", ip, errs)) { ok = false; }
return ok; }
return function evaluateList(v) { const errs = []; const ok = u0(v, 0, h_s0, "", "", errs); return { valid: ok, errors: errs }; };
