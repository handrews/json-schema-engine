"use strict";
const { isObject: h_obj, isInteger: h_int, jsonEqual: h_eq, canonicalKey: h_ck, codePointLength: h_cpl, escapeSegment: h_esc, isMultipleOf: h_mof, hasDuplicateItems: h_dup, firstDuplicatePair: h_fdp, frag: h_frag, fragList: h_fragl, tooDeep: h_deep } = R;
const h_maxd = R.maxDepth;
const h_s0 = [];
const h_hop = Object.prototype.hasOwnProperty;
const { traceState: h_tstate, traceNode: h_tnode, traceError: h_err, traceAnn: h_ann, cutErrors: h_cutE, cutAnns: h_cutA, fragTrace: h_fragt } = R;
function u0(v, d, s, ep, ip, st, tp) { if (d >= h_maxd) h_deep(); d++;
s = [...s, "https://codegen.example/island"];
const tn = h_tnode(tp, ep, "https://codegen.example/island#", ip);
let ok = true;
let k0 = true, k1 = true, k2 = true;
const m3 = st.anns.length; const m5 = st.errs.length; const m4 = u1(v, d, s, ep + "/if", ip, st, tn); h_cutE(st, m5); if (!m4) { h_cutA(st, m3); } if (m4) { const m6 = st.anns.length; if (!u3(v, d, s, ep + "/then", ip, st, tn)) { ok = false; k1 = false; h_cutA(st, m6); } } else { const m7 = st.anns.length; if (!u7(v, d, s, ep + "/else", ip, st, tn)) { ok = false; k2 = false; h_cutA(st, m7); } }
tn.keywords.push({ name: "if", valid: k0 });
tn.keywords.push({ name: "then", valid: k1 });
tn.keywords.push({ name: "else", valid: k2 });
tn.valid = ok;
return ok; }
function u1(v, d, s, ep, ip, st, tp) { if (d >= h_maxd) h_deep(); d++;
const tn = h_tnode(tp, ep, "https://codegen.example/island#/if", ip);
const g3 = (typeof v === "object" && v !== null && !Array.isArray(v));
let ok = true;
let k0 = true, k1 = true;
if ((g3 && ("kind" in v))) { const m2 = st.anns.length; if (!u2(v["kind"], d, h_s0, ep + "/properties/kind", ip + "/kind", st, tn)) { ok = false; k0 = false; h_cutA(st, m2); } }
if (g3) {  }
tn.keywords.push({ name: "properties", valid: k0 });
if (g3) { if (!(("kind" in v))) { ok = false; k1 = false; h_err(st, tn, { evaluationPath: ep + "/required", schemaLocation: "https://codegen.example/island#/if/required", inputLocation: ip, error: "missing required property 'kind'", keyword: "required", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "missingProperty": "kind" } }); } }
tn.keywords.push({ name: "required", valid: k1 });
tn.valid = ok;
return ok; }
function u2(v, d, s, ep, ip, st, tp) { const tn = h_tnode(tp, ep, "https://codegen.example/island#/if/properties/kind", ip);
let ok = true;
let k0 = true;
if (!((v === "strict"))) { ok = false; k0 = false; h_err(st, tn, { evaluationPath: ep + "/const", schemaLocation: "https://codegen.example/island#/if/properties/kind/const", inputLocation: ip, error: "does not equal the required constant", keyword: "const", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "allowedValue": "strict" } }); }
tn.keywords.push({ name: "const", valid: k0 });
tn.valid = ok;
return ok; }
function u3(v, d, s, ep, ip, st, tp) { if (d >= h_maxd) h_deep(); d++;
s = [...s, "https://codegen.example/island"];
const tn = h_tnode(tp, ep, "https://codegen.example/island#/then", ip);
let ok = true;
let k0 = true;
const m1 = st.anns.length; if (!u4(v, d, s, ep + "/$ref", ip, st, tn)) { ok = false; k0 = false; h_cutA(st, m1); }
tn.keywords.push({ name: "$ref", valid: k0 });
tn.valid = ok;
return ok; }
function u4(v, d, s, ep, ip, st, tp) { if (d >= h_maxd) h_deep(); d++;
s = [...s, "https://codegen.example/strict"];
const tn = h_tnode(tp, ep, "https://codegen.example/strict#", ip);
const g4 = (typeof v === "object" && v !== null && !Array.isArray(v));
let ok = true;
let k0 = true, k1 = true;
const m2 = st.anns.length; if (!u5(v, d, s, ep + "/$ref", ip, st, tn)) { ok = false; k0 = false; h_cutA(st, m2); }
tn.keywords.push({ name: "$ref", valid: k0 });
if ((g4 && ("data" in v))) { const m3 = st.anns.length; if (!u6(v["data"], d, s, ep + "/properties/data", ip + "/data", st, tn)) { ok = false; k1 = false; h_cutA(st, m3); } }
if (g4) {  }
tn.keywords.push({ name: "properties", valid: k1 });
tn.valid = ok;
return ok; }
function u5(v, d, s, ep, ip, st, tp) { if (d >= h_maxd) h_deep(); d++;
s = [...s, "https://codegen.example/tree"];
const tn = h_tnode(tp, ep, "https://codegen.example/tree#", ip);
const g3 = (typeof v === "object" && v !== null && !Array.isArray(v));
let ok = true;
let k0 = true, k1 = true;
if ((g3 && ("child" in v))) { const m2 = st.anns.length; if (!h_fragt(T[0], v["child"], s, d, ep + "/properties/child", ip + "/child", st, tn)) { ok = false; k0 = false; h_cutA(st, m2); } }
if (g3) {  }
tn.keywords.push({ name: "properties", valid: k0 });
if (!(g3)) { ok = false; k1 = false; h_err(st, tn, { evaluationPath: ep + "/type", schemaLocation: "https://codegen.example/tree#/type", inputLocation: ip, error: "expected type \"object\"", keyword: "type", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "expected": "object" } }); }
tn.keywords.push({ name: "type", valid: k1 });
tn.valid = ok;
return ok; }
function u6(v, d, s, ep, ip, st, tp) { const tn = h_tnode(tp, ep, "https://codegen.example/strict#/properties/data", ip);
let ok = true;
let k0 = true;
if (!((typeof v === "number" && Number.isInteger(v)))) { ok = false; k0 = false; h_err(st, tn, { evaluationPath: ep + "/type", schemaLocation: "https://codegen.example/strict#/properties/data/type", inputLocation: ip, error: "expected type \"integer\"", keyword: "type", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "expected": "integer" } }); }
tn.keywords.push({ name: "type", valid: k0 });
tn.valid = ok;
return ok; }
function u7(v, d, s, ep, ip, st, tp) { if (d >= h_maxd) h_deep(); d++;
s = [...s, "https://codegen.example/island"];
const tn = h_tnode(tp, ep, "https://codegen.example/island#/else", ip);
let ok = true;
let k0 = true;
const m1 = st.anns.length; if (!u8(v, d, s, ep + "/$ref", ip, st, tn)) { ok = false; k0 = false; h_cutA(st, m1); }
tn.keywords.push({ name: "$ref", valid: k0 });
tn.valid = ok;
return ok; }
function u8(v, d, s, ep, ip, st, tp) { if (d >= h_maxd) h_deep(); d++;
s = [...s, "https://codegen.example/loose"];
const tn = h_tnode(tp, ep, "https://codegen.example/loose#", ip);
const g4 = (typeof v === "object" && v !== null && !Array.isArray(v));
let ok = true;
let k0 = true, k1 = true;
const m2 = st.anns.length; if (!u5(v, d, s, ep + "/$ref", ip, st, tn)) { ok = false; k0 = false; h_cutA(st, m2); }
tn.keywords.push({ name: "$ref", valid: k0 });
if ((g4 && ("data" in v))) { const m3 = st.anns.length; if (!u9(v["data"], d, s, ep + "/properties/data", ip + "/data", st, tn)) { ok = false; k1 = false; h_cutA(st, m3); } }
if (g4) {  }
tn.keywords.push({ name: "properties", valid: k1 });
tn.valid = ok;
return ok; }
function u9(v, d, s, ep, ip, st, tp) { const tn = h_tnode(tp, ep, "https://codegen.example/loose#/properties/data", ip);
let ok = true;
let k0 = true;
if (!((typeof v === "string"))) { ok = false; k0 = false; h_err(st, tn, { evaluationPath: ep + "/type", schemaLocation: "https://codegen.example/loose#/properties/data/type", inputLocation: ip, error: "expected type \"string\"", keyword: "type", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "expected": "string" } }); }
tn.keywords.push({ name: "type", valid: k0 });
tn.valid = ok;
return ok; }
return function evaluateTrace(v) { const st = h_tstate(); const ok = u0(v, 0, h_s0, "", "", st, st.hold); st.valid = ok; return st; };
