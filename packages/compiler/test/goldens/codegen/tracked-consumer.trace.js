"use strict";
const { isObject: h_obj, isInteger: h_int, jsonEqual: h_eq, canonicalKey: h_ck, codePointLength: h_cpl, escapeSegment: h_esc, isMultipleOf: h_mof, hasDuplicateItems: h_dup, firstDuplicatePair: h_fdp, frag: h_frag, fragList: h_fragl, tooDeep: h_deep } = R;
const h_maxd = R.maxDepth;
const h_s0 = [];
const h_hop = Object.prototype.hasOwnProperty;
const { traceState: h_tstate, traceNode: h_tnode, traceError: h_err, traceAnn: h_ann, cutErrors: h_cutE, cutAnns: h_cutA, fragTrace: h_fragt } = R;
const h_covN = R.foldNameCoverage, h_covI = R.foldIndexCoverage;
function u0(v, d, s, ep, ip, st, tp) { if (d >= h_maxd) h_deep(); d++;
const tn = h_tnode(tp, ep, "https://codegen.example/tracked-consumer#", ip);
const g10 = (typeof v === "object" && v !== null && !Array.isArray(v));
let ok = true;
const ev = [];
let k0 = true, k1 = true;
let c0 = false; const m2 = st.errs.length; { const m3 = st.anns.length; const m4 = ev.length; if (u1c(v, d, h_s0, ep + "/anyOf/0", ip, st, tn, ev)) { c0 = true; } else { h_cutA(st, m3); ev.length = m4; } } { const m5 = st.anns.length; const m6 = ev.length; if (u3c(v, d, h_s0, ep + "/anyOf/1", ip, st, tn, ev)) { c0 = true; } else { h_cutA(st, m5); ev.length = m6; } } if (c0) { h_cutE(st, m2); } else { ok = false; k0 = false; h_err(st, tn, { evaluationPath: ep + "/anyOf", schemaLocation: "https://codegen.example/tracked-consumer#/anyOf", inputLocation: ip, error: "no branch matched", keyword: "anyOf", vocabulary: "https://json-schema.org/draft/2020-12/vocab/applicator", params: {} }); }
tn.keywords.push({ name: "anyOf", valid: k0 });
const n7 = new Set();
if (g10) { const f8 = h_covN(ev);
for (const b1 in v) { if (!(f8.has(b1))) { n7.add(b1); const m9 = st.anns.length; if (!u5(v[b1], d, h_s0, ep + "/unevaluatedProperties", ip + "/" + h_esc(String(b1)), st, tn)) { ok = false; k1 = false; h_cutA(st, m9); } } }
if (k1) { ev.push([...n7]); } }
tn.keywords.push({ name: "unevaluatedProperties", valid: k1 });
tn.valid = ok;
return ok; }
function u1(v, d, s, ep, ip, st, tp) { if (d >= h_maxd) h_deep(); d++;
const tn = h_tnode(tp, ep, "https://codegen.example/tracked-consumer#/anyOf/0", ip);
const g2 = (typeof v === "object" && v !== null && !Array.isArray(v));
let ok = true;
let k0 = true;
if ((g2 && (v["a"] !== undefined))) { const m1 = st.anns.length; if (!u2(v["a"], d, h_s0, ep + "/properties/a", ip + "/a", st, tn)) { ok = false; k0 = false; h_cutA(st, m1); } }
if (g2) {  }
tn.keywords.push({ name: "properties", valid: k0 });
tn.valid = ok;
return ok; }
function u1c(v, d, s, ep, ip, st, tp, ev) { if (d >= h_maxd) h_deep(); d++;
const tn = h_tnode(tp, ep, "https://codegen.example/tracked-consumer#/anyOf/0", ip);
const g3 = (typeof v === "object" && v !== null && !Array.isArray(v));
let ok = true;
let k0 = true;
const n1 = new Set();
if ((g3 && (v["a"] !== undefined))) { n1.add("a"); const m2 = st.anns.length; if (!u2(v["a"], d, h_s0, ep + "/properties/a", ip + "/a", st, tn)) { ok = false; k0 = false; h_cutA(st, m2); } }
if (g3) { if (k0) { ev.push([...n1]); } }
tn.keywords.push({ name: "properties", valid: k0 });
tn.valid = ok;
return ok; }
function u2(v, d, s, ep, ip, st, tp) { const tn = h_tnode(tp, ep, "https://codegen.example/tracked-consumer#/anyOf/0/properties/a", ip);
let ok = true;
let k0 = true;
if (!((typeof v === "number" && Number.isInteger(v)))) { ok = false; k0 = false; h_err(st, tn, { evaluationPath: ep + "/type", schemaLocation: "https://codegen.example/tracked-consumer#/anyOf/0/properties/a/type", inputLocation: ip, error: "expected type \"integer\"", keyword: "type", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "expected": "integer" } }); }
tn.keywords.push({ name: "type", valid: k0 });
tn.valid = ok;
return ok; }
function u3(v, d, s, ep, ip, st, tp) { if (d >= h_maxd) h_deep(); d++;
const tn = h_tnode(tp, ep, "https://codegen.example/tracked-consumer#/anyOf/1", ip);
const g2 = (typeof v === "object" && v !== null && !Array.isArray(v));
let ok = true;
let k0 = true;
if ((g2 && (v["b"] !== undefined))) { const m1 = st.anns.length; if (!u4(v["b"], d, h_s0, ep + "/properties/b", ip + "/b", st, tn)) { ok = false; k0 = false; h_cutA(st, m1); } }
if (g2) {  }
tn.keywords.push({ name: "properties", valid: k0 });
tn.valid = ok;
return ok; }
function u3c(v, d, s, ep, ip, st, tp, ev) { if (d >= h_maxd) h_deep(); d++;
const tn = h_tnode(tp, ep, "https://codegen.example/tracked-consumer#/anyOf/1", ip);
const g3 = (typeof v === "object" && v !== null && !Array.isArray(v));
let ok = true;
let k0 = true;
const n1 = new Set();
if ((g3 && (v["b"] !== undefined))) { n1.add("b"); const m2 = st.anns.length; if (!u4(v["b"], d, h_s0, ep + "/properties/b", ip + "/b", st, tn)) { ok = false; k0 = false; h_cutA(st, m2); } }
if (g3) { if (k0) { ev.push([...n1]); } }
tn.keywords.push({ name: "properties", valid: k0 });
tn.valid = ok;
return ok; }
function u4(v, d, s, ep, ip, st, tp) { const tn = h_tnode(tp, ep, "https://codegen.example/tracked-consumer#/anyOf/1/properties/b", ip);
let ok = true;
let k0 = true;
if (!((typeof v === "string"))) { ok = false; k0 = false; h_err(st, tn, { evaluationPath: ep + "/type", schemaLocation: "https://codegen.example/tracked-consumer#/anyOf/1/properties/b/type", inputLocation: ip, error: "expected type \"string\"", keyword: "type", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "expected": "string" } }); }
tn.keywords.push({ name: "type", valid: k0 });
tn.valid = ok;
return ok; }
function u5(v, d, s, ep, ip, st, tp) { const tn = h_tnode(tp, ep, "https://codegen.example/tracked-consumer#/unevaluatedProperties", ip); tn.valid = false; h_err(st, tn, { evaluationPath: ep, schemaLocation: "https://codegen.example/tracked-consumer#/unevaluatedProperties", inputLocation: ip, error: "schema is false", params: {} }); return false; }
return function evaluateTrace(v) { const st = h_tstate(); const ok = u0(v, 0, h_s0, "", "", st, st.hold); st.valid = ok; return st; };
