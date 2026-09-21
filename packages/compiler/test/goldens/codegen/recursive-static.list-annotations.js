"use strict";
const { isObject: h_obj, isInteger: h_int, jsonEqual: h_eq, canonicalKey: h_ck, codePointLength: h_cpl, escapeSegment: h_esc, isMultipleOf: h_mof, hasDuplicateItems: h_dup, firstDuplicatePair: h_fdp, frag: h_frag, fragList: h_fragl, tooDeep: h_deep } = R;
const h_maxd = R.maxDepth;
const h_s0 = [];
const h_hop = Object.prototype.hasOwnProperty;
const h_fragla = R.fragListAnn;
function u0(v, d, s, ep, ip, errs, anns) { if (d >= h_maxd) h_deep(); d++;
const g1 = (typeof v === "object" && v !== null && !Array.isArray(v));
let ok = true;
if ((g1 && ("name" in v))) { const m0 = anns.length; if (!u1(v["name"], d, h_s0, ep + "/properties/name", ip + "/name", errs, anns)) { ok = false; anns.length = m0; } }
if ((g1 && ("children" in v))) { const m2 = anns.length; if (!u2(v["children"], d, h_s0, ep + "/properties/children", ip + "/children", errs, anns)) { ok = false; anns.length = m2; } }
if (g1) {  }
if (!(g1)) { ok = false; errs.push({ evaluationPath: ep + "/type", schemaLocation: "https://codegen.example/recursive-static#/type", inputLocation: ip, error: "expected type \"object\"", keyword: "type", vocabulary: "https://json-schema.org/draft/2019-09/vocab/validation", params: { "expected": "object" } }); }
if (g1) { if (!(("name" in v))) { ok = false; errs.push({ evaluationPath: ep + "/required", schemaLocation: "https://codegen.example/recursive-static#/required", inputLocation: ip, error: "missing required property 'name'", keyword: "required", vocabulary: "https://json-schema.org/draft/2019-09/vocab/validation", params: { "missingProperty": "name" } }); } }
return ok; }
function u1(v, d, s, ep, ip, errs, anns) { let ok = true;
if (!((typeof v === "string"))) { ok = false; errs.push({ evaluationPath: ep + "/type", schemaLocation: "https://codegen.example/recursive-static#/properties/name/type", inputLocation: ip, error: "expected type \"string\"", keyword: "type", vocabulary: "https://json-schema.org/draft/2019-09/vocab/validation", params: { "expected": "string" } }); }
return ok; }
function u2(v, d, s, ep, ip, errs, anns) { if (d >= h_maxd) h_deep(); d++;
let ok = true;
if (Array.isArray(v)) { for (let b0 = 0; b0 < v.length; b0++) { const m0 = anns.length; if (!u3(v[b0], d, h_s0, ep + "/items", ip + "/" + h_esc(String(b0)), errs, anns)) { ok = false; anns.length = m0; } } }

if (!(Array.isArray(v))) { ok = false; errs.push({ evaluationPath: ep + "/type", schemaLocation: "https://codegen.example/recursive-static#/properties/children/type", inputLocation: ip, error: "expected type \"array\"", keyword: "type", vocabulary: "https://json-schema.org/draft/2019-09/vocab/validation", params: { "expected": "array" } }); }
return ok; }
function u3(v, d, s, ep, ip, errs, anns) { if (d >= h_maxd) h_deep(); d++;
let ok = true;
const m0 = anns.length; if (!u0(v, d, h_s0, ep + "/$recursiveRef", ip, errs, anns)) { ok = false; anns.length = m0; }
return ok; }
return function evaluateList(v) { const errs = []; const anns = []; const ok = u0(v, 0, h_s0, "", "", errs, anns); return { valid: ok, errors: errs, annotations: anns }; };
