"use strict";
const { isObject: h_obj, isInteger: h_int, jsonEqual: h_eq, canonicalKey: h_ck, codePointLength: h_cpl, escapeSegment: h_esc, isMultipleOf: h_mof, hasDuplicateItems: h_dup, firstDuplicatePair: h_fdp, frag: h_frag, fragList: h_fragl, tooDeep: h_deep } = R;
const h_maxd = R.maxDepth;
const h_s0 = [];
const h_hop = Object.prototype.hasOwnProperty;
const h_fragla = R.fragListAnn;
const { labeledNames: h_lnames, typedPreview: h_tprev, apparentType: h_atype } = R.messageHelpers;
const h_covN = R.foldNameCoverage, h_covI = R.foldIndexCoverage;
function u0(v, d, s, ep, ip, errs, anns) { if (d >= h_maxd) h_deep(); d++;
const g3 = (typeof v === "object" && v !== null && !Array.isArray(v));
let ok = true;
const ev = [];
let k0 = true;
const n1 = new Set();
if ((g3 && ("a" in v))) { n1.add("a"); const m2 = anns.length; if (!u1(v["a"], d, h_s0, ep + "/properties/a", ip + "/a", errs, anns)) { ok = false; k0 = false; anns.length = m2; } }
if (g3) { if (k0) { ev.push([...n1]); } }
let k4 = true;
const n5 = new Set();
if (g3) { const f6 = h_covN(ev);
const b2 = []; for (const b1 in v) { if (!(f6.has(b1))) { b2.push(b1); } } if (b2.length) { ok = false; k4 = false; errs.push({ evaluationPath: ep + "/unevaluatedProperties", schemaLocation: "https://codegen.example/static-consumer#/unevaluatedProperties", inputLocation: ip, error: ("unevaluated " + String(h_lnames(b2, "property", "properties")) + " not allowed"), keyword: "unevaluatedProperties", vocabulary: "https://json-schema.org/draft/2020-12/vocab/unevaluated", params: { "properties": b2 } }); }
if (k4) { ev.push([...n5]); } }
return ok; }
function u1(v, d, s, ep, ip, errs, anns) { let ok = true;
if (!((typeof v === "string"))) { ok = false; errs.push({ evaluationPath: ep + "/type", schemaLocation: "https://codegen.example/static-consumer#/properties/a/type", inputLocation: ip, error: ("expected string, got " + String(h_tprev(v))), keyword: "type", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "expected": ["string"], "actual": h_atype(v), "value": v } }); }
return ok; }
function u2(v, d, s, ep, ip, errs, anns) { errs.push({ evaluationPath: ep, schemaLocation: "https://codegen.example/static-consumer#/unevaluatedProperties", inputLocation: ip, error: "schema is false", params: {} }); return false; }
return function evaluateList(v) { const errs = []; const anns = []; const ok = u0(v, 0, h_s0, "", "", errs, anns); return { valid: ok, errors: errs, annotations: anns }; };
