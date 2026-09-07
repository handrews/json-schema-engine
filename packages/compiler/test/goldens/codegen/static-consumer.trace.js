"use strict";
const { isObject: h_obj, isInteger: h_int, jsonEqual: h_eq, canonicalKey: h_ck, codePointLength: h_cpl, escapeSegment: h_esc, isMultipleOf: h_mof, hasDuplicateItems: h_dup, firstDuplicatePair: h_fdp, frag: h_frag, fragList: h_fragl, tooDeep: h_deep } = R;
const h_maxd = R.maxDepth;
const h_s0 = [];
const h_hop = Object.prototype.hasOwnProperty;
const { traceState: h_tstate, traceNode: h_tnode, traceError: h_err, traceAnn: h_ann, cutErrors: h_cutE, cutAnns: h_cutA, fragTrace: h_fragt } = R;
const h_covN = R.foldNameCoverage, h_covI = R.foldIndexCoverage;
function u0(v, d, s, ep, ip, st, tp) { if (d >= h_maxd) h_deep(); d++;
const tn = h_tnode(tp, ep, "https://codegen.example/static-consumer#", ip);
const g4 = (typeof v === "object" && v !== null && !Array.isArray(v));
let ok = true;
const ev = [];
let k0 = true, k1 = true;
const n2 = new Set();
if ((g4 && ("a" in v))) { n2.add("a"); const m3 = st.anns.length; if (!u1(v["a"], d, h_s0, ep + "/properties/a", ip + "/a", st, tn)) { ok = false; k0 = false; h_cutA(st, m3); } }
if (g4) { if (k0) { ev.push([...n2]); } }
tn.keywords.push({ name: "properties", valid: k0 });
const n5 = new Set();
if (g4) { const f6 = h_covN(ev);
for (const b1 in v) { if (!(f6.has(b1))) { n5.add(b1); const m7 = st.anns.length; if (!u2(v[b1], d, h_s0, ep + "/unevaluatedProperties", ip + "/" + h_esc(String(b1)), st, tn)) { ok = false; k1 = false; h_cutA(st, m7); } } }
if (k1) { ev.push([...n5]); } }
tn.keywords.push({ name: "unevaluatedProperties", valid: k1 });
tn.valid = ok;
return ok; }
function u1(v, d, s, ep, ip, st, tp) { const tn = h_tnode(tp, ep, "https://codegen.example/static-consumer#/properties/a", ip);
let ok = true;
let k0 = true;
if (!((typeof v === "string"))) { ok = false; k0 = false; h_err(st, tn, { evaluationPath: ep + "/type", schemaLocation: "https://codegen.example/static-consumer#/properties/a/type", inputLocation: ip, error: "expected type \"string\"", keyword: "type", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "expected": "string" } }); }
tn.keywords.push({ name: "type", valid: k0 });
tn.valid = ok;
return ok; }
function u2(v, d, s, ep, ip, st, tp) { const tn = h_tnode(tp, ep, "https://codegen.example/static-consumer#/unevaluatedProperties", ip); tn.valid = false; h_err(st, tn, { evaluationPath: ep, schemaLocation: "https://codegen.example/static-consumer#/unevaluatedProperties", inputLocation: ip, error: "schema is false", params: {} }); return false; }
return function evaluateTrace(v) { const st = h_tstate(); const ok = u0(v, 0, h_s0, "", "", st, st.hold); st.valid = ok; return st; };
