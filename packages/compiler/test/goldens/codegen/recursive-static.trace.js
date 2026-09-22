"use strict";
const { isObject: h_obj, isInteger: h_int, jsonEqual: h_eq, canonicalKey: h_ck, codePointLength: h_cpl, escapeSegment: h_esc, isMultipleOf: h_mof, hasDuplicateItems: h_dup, firstDuplicatePair: h_fdp, frag: h_frag, fragList: h_fragl, tooDeep: h_deep } = R;
const h_maxd = R.maxDepth;
const h_s0 = [];
const h_hop = Object.prototype.hasOwnProperty;
const { traceState: h_tstate, traceNode: h_tnode, traceError: h_err, traceAnn: h_ann, cutErrors: h_cutE, cutAnns: h_cutA, fragTrace: h_fragt } = R;
function u0(v, d, s, ep, ip, st, tp) { if (d >= h_maxd) h_deep(); d++;
const tn = h_tnode(tp, ep, "https://codegen.example/recursive-static#", ip);
const g4 = (typeof v === "object" && v !== null && !Array.isArray(v));
let ok = true;
let k0 = true, k1 = true, k2 = true;
if ((g4 && ("name" in v))) { const m3 = st.anns.length; if (!u1(v["name"], d, h_s0, ep + "/properties/name", ip + "/name", st, tn)) { ok = false; k0 = false; h_cutA(st, m3); } }
if ((g4 && ("children" in v))) { const m5 = st.anns.length; if (!u2(v["children"], d, h_s0, ep + "/properties/children", ip + "/children", st, tn)) { ok = false; k0 = false; h_cutA(st, m5); } }
if (g4) {  }
tn.keywords.push({ name: "properties", valid: k0 });
if (!(g4)) { ok = false; k1 = false; h_err(st, tn, { evaluationPath: ep + "/type", schemaLocation: "https://codegen.example/recursive-static#/type", inputLocation: ip, error: "expected type \"object\"", keyword: "type", vocabulary: "https://json-schema.org/draft/2019-09/vocab/validation", params: { "expected": "object" } }); }
tn.keywords.push({ name: "type", valid: k1 });
if (g4) { if (!(("name" in v))) { ok = false; k2 = false; h_err(st, tn, { evaluationPath: ep + "/required", schemaLocation: "https://codegen.example/recursive-static#/required", inputLocation: ip, error: "missing required property 'name'", keyword: "required", vocabulary: "https://json-schema.org/draft/2019-09/vocab/validation", params: { "missingProperty": "name" } }); } }
tn.keywords.push({ name: "required", valid: k2 });
tn.valid = ok;
return ok; }
function u1(v, d, s, ep, ip, st, tp) { const tn = h_tnode(tp, ep, "https://codegen.example/recursive-static#/properties/name", ip);
let ok = true;
let k0 = true;
if (!((typeof v === "string"))) { ok = false; k0 = false; h_err(st, tn, { evaluationPath: ep + "/type", schemaLocation: "https://codegen.example/recursive-static#/properties/name/type", inputLocation: ip, error: "expected type \"string\"", keyword: "type", vocabulary: "https://json-schema.org/draft/2019-09/vocab/validation", params: { "expected": "string" } }); }
tn.keywords.push({ name: "type", valid: k0 });
tn.valid = ok;
return ok; }
function u2(v, d, s, ep, ip, st, tp) { if (d >= h_maxd) h_deep(); d++;
const tn = h_tnode(tp, ep, "https://codegen.example/recursive-static#/properties/children", ip);
let ok = true;
let k0 = true, k1 = true;
if (Array.isArray(v)) { for (let b0 = 0; b0 < v.length; b0++) { const m2 = st.anns.length; if (!u3(v[b0], d, h_s0, ep + "/items", ip + "/" + h_esc(String(b0)), st, tn)) { ok = false; k0 = false; h_cutA(st, m2); } } }

tn.keywords.push({ name: "items", valid: k0 });
if (!(Array.isArray(v))) { ok = false; k1 = false; h_err(st, tn, { evaluationPath: ep + "/type", schemaLocation: "https://codegen.example/recursive-static#/properties/children/type", inputLocation: ip, error: "expected type \"array\"", keyword: "type", vocabulary: "https://json-schema.org/draft/2019-09/vocab/validation", params: { "expected": "array" } }); }
tn.keywords.push({ name: "type", valid: k1 });
tn.valid = ok;
return ok; }
function u3(v, d, s, ep, ip, st, tp) { if (d >= h_maxd) h_deep(); d++;
const tn = h_tnode(tp, ep, "https://codegen.example/recursive-static#/properties/children/items", ip);
let ok = true;
let k0 = true;
const m1 = st.anns.length; if (!u0(v, d, h_s0, ep + "/$recursiveRef", ip, st, tn)) { ok = false; k0 = false; h_cutA(st, m1); }
tn.keywords.push({ name: "$recursiveRef", valid: k0 });
tn.valid = ok;
return ok; }
return function evaluateTrace(v) { const st = h_tstate(); const ok = u0(v, 0, h_s0, "", "", st, st.hold); st.valid = ok; return st; };
