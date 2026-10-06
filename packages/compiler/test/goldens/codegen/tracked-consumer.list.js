"use strict";
const { isObject: h_obj, isInteger: h_int, jsonEqual: h_eq, canonicalKey: h_ck, codePointLength: h_cpl, escapeSegment: h_esc, isMultipleOf: h_mof, hasDuplicateItems: h_dup, firstDuplicatePair: h_fdp, frag: h_frag, fragList: h_fragl, tooDeep: h_deep } = R;
const h_maxd = R.maxDepth;
const h_s0 = [];
const h_hop = Object.prototype.hasOwnProperty;
const { labeledNames: h_lnames, typedPreview: h_tprev, apparentType: h_atype } = R.messageHelpers;
const h_covN = R.foldNameCoverage, h_covI = R.foldIndexCoverage;
function u0(v, d, s, ep, ip, errs) { if (d >= h_maxd) h_deep(); d++;
const g6 = (typeof v === "object" && v !== null && !Array.isArray(v));
let ok = true;
const ev = [];
let c0 = false; const m0 = errs.length; { const m1 = ev.length; if (u1c(v, d, h_s0, ep + "/anyOf/0", ip, errs, ev)) { c0 = true; } else { ev.length = m1; } } { const m2 = ev.length; if (u3c(v, d, h_s0, ep + "/anyOf/1", ip, errs, ev)) { c0 = true; } else { ev.length = m2; } } if (c0) { errs.length = m0; } else { ok = false; errs.push({ evaluationPath: ep + "/anyOf", schemaLocation: "https://codegen.example/tracked-consumer#/anyOf", inputLocation: ip, error: "does not match any of the 2 anyOf branches", keyword: "anyOf", vocabulary: "https://json-schema.org/draft/2020-12/vocab/applicator", params: {} }); }
let k3 = true;
const n4 = new Set();
if (g6) { const f5 = h_covN(ev);
const b2 = []; for (const b1 in v) { if (!(f5.has(b1))) { b2.push(b1); } } if (b2.length) { ok = false; k3 = false; errs.push({ evaluationPath: ep + "/unevaluatedProperties", schemaLocation: "https://codegen.example/tracked-consumer#/unevaluatedProperties", inputLocation: ip, error: ("unevaluated " + String(h_lnames(b2, "property", "properties")) + " not allowed"), keyword: "unevaluatedProperties", vocabulary: "https://json-schema.org/draft/2020-12/vocab/unevaluated", params: { "properties": b2 } }); }
if (k3) { ev.push([...n4]); } }
return ok; }
function u1(v, d, s, ep, ip, errs) { if (d >= h_maxd) h_deep(); d++;
const g0 = (typeof v === "object" && v !== null && !Array.isArray(v));
let ok = true;
if ((g0 && ("a" in v))) { if (!u2(v["a"], d, h_s0, ep + "/properties/a", ip + "/a", errs)) { ok = false; } }
if (g0) {  }
return ok; }
function u1c(v, d, s, ep, ip, errs, ev) { if (d >= h_maxd) h_deep(); d++;
const g2 = (typeof v === "object" && v !== null && !Array.isArray(v));
let ok = true;
let k0 = true;
const n1 = new Set();
if ((g2 && ("a" in v))) { n1.add("a"); if (!u2(v["a"], d, h_s0, ep + "/properties/a", ip + "/a", errs)) { ok = false; k0 = false; } }
if (g2) { if (k0) { ev.push([...n1]); } }
return ok; }
function u2(v, d, s, ep, ip, errs) { let ok = true;
if (!((typeof v === "number" && Number.isInteger(v)))) { ok = false; errs.push({ evaluationPath: ep + "/type", schemaLocation: "https://codegen.example/tracked-consumer#/anyOf/0/properties/a/type", inputLocation: ip, error: ("expected integer, got " + String(h_tprev(v))), keyword: "type", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "expected": ["integer"], "actual": h_atype(v), "value": v } }); }
return ok; }
function u3(v, d, s, ep, ip, errs) { if (d >= h_maxd) h_deep(); d++;
const g0 = (typeof v === "object" && v !== null && !Array.isArray(v));
let ok = true;
if ((g0 && ("b" in v))) { if (!u4(v["b"], d, h_s0, ep + "/properties/b", ip + "/b", errs)) { ok = false; } }
if (g0) {  }
return ok; }
function u3c(v, d, s, ep, ip, errs, ev) { if (d >= h_maxd) h_deep(); d++;
const g2 = (typeof v === "object" && v !== null && !Array.isArray(v));
let ok = true;
let k0 = true;
const n1 = new Set();
if ((g2 && ("b" in v))) { n1.add("b"); if (!u4(v["b"], d, h_s0, ep + "/properties/b", ip + "/b", errs)) { ok = false; k0 = false; } }
if (g2) { if (k0) { ev.push([...n1]); } }
return ok; }
function u4(v, d, s, ep, ip, errs) { let ok = true;
if (!((typeof v === "string"))) { ok = false; errs.push({ evaluationPath: ep + "/type", schemaLocation: "https://codegen.example/tracked-consumer#/anyOf/1/properties/b/type", inputLocation: ip, error: ("expected string, got " + String(h_tprev(v))), keyword: "type", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "expected": ["string"], "actual": h_atype(v), "value": v } }); }
return ok; }
function u5(v, d, s, ep, ip, errs) { errs.push({ evaluationPath: ep, schemaLocation: "https://codegen.example/tracked-consumer#/unevaluatedProperties", inputLocation: ip, error: "schema is false", params: {} }); return false; }
return function evaluateList(v) { const errs = []; const ok = u0(v, 0, h_s0, "", "", errs); return { valid: ok, errors: errs }; };
