"use strict";
const { isObject: h_obj, isInteger: h_int, jsonEqual: h_eq, canonicalKey: h_ck, codePointLength: h_cpl, escapeSegment: h_esc, isMultipleOf: h_mof, hasDuplicateItems: h_dup, firstDuplicatePair: h_fdp, frag: h_frag, fragList: h_fragl, tooDeep: h_deep } = R;
const h_maxd = R.maxDepth;
const h_s0 = [];
const h_hop = Object.prototype.hasOwnProperty;
const { traceState: h_tstate, traceNode: h_tnode, traceError: h_err, traceAnn: h_ann, cutErrors: h_cutE, cutAnns: h_cutA, fragTrace: h_fragt } = R;
const h_covN = R.foldNameCoverage, h_covI = R.foldIndexCoverage;
function u0(v, d, s, ep, ip, st, tp) { if (d >= h_maxd) h_deep(); d++;
const tn = h_tnode(tp, ep, "https://spike.example/event#", ip);
const g11 = (typeof v === "object" && v !== null && !Array.isArray(v));
let ok = true;
const ev = [];
let k0 = true, k1 = true, k2 = true, k3 = true, k4 = true;
const m5 = st.anns.length; const m6 = ev.length; if (!u1c(v, d, h_s0, ep + "/allOf/0", ip, st, tn, ev)) { ok = false; k0 = false; h_cutA(st, m5); ev.length = m6; }
const m7 = st.anns.length; const m8 = ev.length; if (!u5c(v, d, h_s0, ep + "/allOf/1", ip, st, tn, ev)) { ok = false; k0 = false; h_cutA(st, m7); ev.length = m8; }
tn.keywords.push({ name: "allOf", valid: k0 });
const n9 = new Set();
if ((g11 && (v["kind"] !== undefined))) { n9.add("kind"); const m10 = st.anns.length; if (!u9(v["kind"], d, h_s0, ep + "/properties/kind", ip + "/kind", st, tn)) { ok = false; k1 = false; h_cutA(st, m10); } }
if (g11) { if (k1) { ev.push([...n9]); } }
tn.keywords.push({ name: "properties", valid: k1 });
if (!(g11)) { ok = false; k2 = false; h_err(st, tn, { evaluationPath: ep + "/type", schemaLocation: "https://spike.example/event#/type", inputLocation: ip, error: "expected type \"object\"", keyword: "type", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "expected": "object" } }); }
tn.keywords.push({ name: "type", valid: k2 });
if (g11) { if (!((v["kind"] !== undefined))) { ok = false; k3 = false; h_err(st, tn, { evaluationPath: ep + "/required", schemaLocation: "https://spike.example/event#/required", inputLocation: ip, error: "missing required property 'kind'", keyword: "required", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "missingProperty": "kind" } }); } }
tn.keywords.push({ name: "required", valid: k3 });
const n12 = new Set();
if (g11) { const f13 = h_covN(ev);
for (const b1 in v) { if (!(f13.has(b1))) { n12.add(b1); const m14 = st.anns.length; if (!u10(v[b1], d, h_s0, ep + "/unevaluatedProperties", ip + "/" + h_esc(String(b1)), st, tn)) { ok = false; k4 = false; h_cutA(st, m14); } } }
if (k4) { ev.push([...n12]); } }
tn.keywords.push({ name: "unevaluatedProperties", valid: k4 });
tn.valid = ok;
return ok; }
function u1(v, d, s, ep, ip, st, tp) { if (d >= h_maxd) h_deep(); d++;
const tn = h_tnode(tp, ep, "https://spike.example/event#/allOf/0", ip);
let ok = true;
let k0 = true;
const m1 = st.anns.length; if (!u2(v, d, h_s0, ep + "/$ref", ip, st, tn)) { ok = false; k0 = false; h_cutA(st, m1); }
tn.keywords.push({ name: "$ref", valid: k0 });
tn.valid = ok;
return ok; }
function u1c(v, d, s, ep, ip, st, tp, ev) { if (d >= h_maxd) h_deep(); d++;
const tn = h_tnode(tp, ep, "https://spike.example/event#/allOf/0", ip);
let ok = true;
let k0 = true;
const m1 = st.anns.length; const m2 = ev.length; if (!u2c(v, d, h_s0, ep + "/$ref", ip, st, tn, ev)) { ok = false; k0 = false; h_cutA(st, m1); ev.length = m2; }
tn.keywords.push({ name: "$ref", valid: k0 });
tn.valid = ok;
return ok; }
function u2(v, d, s, ep, ip, st, tp) { if (d >= h_maxd) h_deep(); d++;
const tn = h_tnode(tp, ep, "https://spike.example/event#/$defs/base", ip);
const g4 = (typeof v === "object" && v !== null && !Array.isArray(v));
let ok = true;
let k0 = true, k1 = true, k2 = true;
if ((g4 && (v["id"] !== undefined))) { const m3 = st.anns.length; if (!u3(v["id"], d, h_s0, ep + "/properties/id", ip + "/id", st, tn)) { ok = false; k0 = false; h_cutA(st, m3); } }
if ((g4 && (v["actor"] !== undefined))) { const m5 = st.anns.length; if (!u4(v["actor"], d, h_s0, ep + "/properties/actor", ip + "/actor", st, tn)) { ok = false; k0 = false; h_cutA(st, m5); } }
if (g4) {  }
tn.keywords.push({ name: "properties", valid: k0 });
if (!(g4)) { ok = false; k1 = false; h_err(st, tn, { evaluationPath: ep + "/type", schemaLocation: "https://spike.example/event#/$defs/base/type", inputLocation: ip, error: "expected type \"object\"", keyword: "type", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "expected": "object" } }); }
tn.keywords.push({ name: "type", valid: k1 });
if (g4) { if (!((v["id"] !== undefined))) { ok = false; k2 = false; h_err(st, tn, { evaluationPath: ep + "/required", schemaLocation: "https://spike.example/event#/$defs/base/required", inputLocation: ip, error: "missing required property 'id'", keyword: "required", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "missingProperty": "id" } }); }
if (!((v["actor"] !== undefined))) { ok = false; k2 = false; h_err(st, tn, { evaluationPath: ep + "/required", schemaLocation: "https://spike.example/event#/$defs/base/required", inputLocation: ip, error: "missing required property 'actor'", keyword: "required", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "missingProperty": "actor" } }); } }
tn.keywords.push({ name: "required", valid: k2 });
tn.valid = ok;
return ok; }
function u2c(v, d, s, ep, ip, st, tp, ev) { if (d >= h_maxd) h_deep(); d++;
const tn = h_tnode(tp, ep, "https://spike.example/event#/$defs/base", ip);
const g5 = (typeof v === "object" && v !== null && !Array.isArray(v));
let ok = true;
let k0 = true, k1 = true, k2 = true;
const n3 = new Set();
if ((g5 && (v["id"] !== undefined))) { n3.add("id"); const m4 = st.anns.length; if (!u3(v["id"], d, h_s0, ep + "/properties/id", ip + "/id", st, tn)) { ok = false; k0 = false; h_cutA(st, m4); } }
if ((g5 && (v["actor"] !== undefined))) { n3.add("actor"); const m6 = st.anns.length; if (!u4(v["actor"], d, h_s0, ep + "/properties/actor", ip + "/actor", st, tn)) { ok = false; k0 = false; h_cutA(st, m6); } }
if (g5) { if (k0) { ev.push([...n3]); } }
tn.keywords.push({ name: "properties", valid: k0 });
if (!(g5)) { ok = false; k1 = false; h_err(st, tn, { evaluationPath: ep + "/type", schemaLocation: "https://spike.example/event#/$defs/base/type", inputLocation: ip, error: "expected type \"object\"", keyword: "type", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "expected": "object" } }); }
tn.keywords.push({ name: "type", valid: k1 });
if (g5) { if (!((v["id"] !== undefined))) { ok = false; k2 = false; h_err(st, tn, { evaluationPath: ep + "/required", schemaLocation: "https://spike.example/event#/$defs/base/required", inputLocation: ip, error: "missing required property 'id'", keyword: "required", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "missingProperty": "id" } }); }
if (!((v["actor"] !== undefined))) { ok = false; k2 = false; h_err(st, tn, { evaluationPath: ep + "/required", schemaLocation: "https://spike.example/event#/$defs/base/required", inputLocation: ip, error: "missing required property 'actor'", keyword: "required", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "missingProperty": "actor" } }); } }
tn.keywords.push({ name: "required", valid: k2 });
tn.valid = ok;
return ok; }
function u3(v, d, s, ep, ip, st, tp) { const tn = h_tnode(tp, ep, "https://spike.example/event#/$defs/base/properties/id", ip);
let ok = true;
let k0 = true;
if (!((typeof v === "string"))) { ok = false; k0 = false; h_err(st, tn, { evaluationPath: ep + "/type", schemaLocation: "https://spike.example/event#/$defs/base/properties/id/type", inputLocation: ip, error: "expected type \"string\"", keyword: "type", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "expected": "string" } }); }
tn.keywords.push({ name: "type", valid: k0 });
tn.valid = ok;
return ok; }
function u4(v, d, s, ep, ip, st, tp) { const tn = h_tnode(tp, ep, "https://spike.example/event#/$defs/base/properties/actor", ip);
let ok = true;
let k0 = true;
if (!((typeof v === "string"))) { ok = false; k0 = false; h_err(st, tn, { evaluationPath: ep + "/type", schemaLocation: "https://spike.example/event#/$defs/base/properties/actor/type", inputLocation: ip, error: "expected type \"string\"", keyword: "type", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "expected": "string" } }); }
tn.keywords.push({ name: "type", valid: k0 });
tn.valid = ok;
return ok; }
function u5(v, d, s, ep, ip, st, tp) { if (d >= h_maxd) h_deep(); d++;
const tn = h_tnode(tp, ep, "https://spike.example/event#/allOf/1", ip);
let ok = true;
let k0 = true;
const m1 = st.anns.length; if (!u6(v, d, h_s0, ep + "/$ref", ip, st, tn)) { ok = false; k0 = false; h_cutA(st, m1); }
tn.keywords.push({ name: "$ref", valid: k0 });
tn.valid = ok;
return ok; }
function u5c(v, d, s, ep, ip, st, tp, ev) { if (d >= h_maxd) h_deep(); d++;
const tn = h_tnode(tp, ep, "https://spike.example/event#/allOf/1", ip);
let ok = true;
let k0 = true;
const m1 = st.anns.length; const m2 = ev.length; if (!u6c(v, d, h_s0, ep + "/$ref", ip, st, tn, ev)) { ok = false; k0 = false; h_cutA(st, m1); ev.length = m2; }
tn.keywords.push({ name: "$ref", valid: k0 });
tn.valid = ok;
return ok; }
function u6(v, d, s, ep, ip, st, tp) { if (d >= h_maxd) h_deep(); d++;
const tn = h_tnode(tp, ep, "https://spike.example/event#/$defs/timestamps", ip);
const g4 = (typeof v === "object" && v !== null && !Array.isArray(v));
let ok = true;
let k0 = true, k1 = true, k2 = true;
if ((g4 && (v["createdAt"] !== undefined))) { const m3 = st.anns.length; if (!u7(v["createdAt"], d, h_s0, ep + "/properties/createdAt", ip + "/createdAt", st, tn)) { ok = false; k0 = false; h_cutA(st, m3); } }
if ((g4 && (v["updatedAt"] !== undefined))) { const m5 = st.anns.length; if (!u8(v["updatedAt"], d, h_s0, ep + "/properties/updatedAt", ip + "/updatedAt", st, tn)) { ok = false; k0 = false; h_cutA(st, m5); } }
if (g4) {  }
tn.keywords.push({ name: "properties", valid: k0 });
if (!(g4)) { ok = false; k1 = false; h_err(st, tn, { evaluationPath: ep + "/type", schemaLocation: "https://spike.example/event#/$defs/timestamps/type", inputLocation: ip, error: "expected type \"object\"", keyword: "type", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "expected": "object" } }); }
tn.keywords.push({ name: "type", valid: k1 });
if (g4) { if (!((v["createdAt"] !== undefined))) { ok = false; k2 = false; h_err(st, tn, { evaluationPath: ep + "/required", schemaLocation: "https://spike.example/event#/$defs/timestamps/required", inputLocation: ip, error: "missing required property 'createdAt'", keyword: "required", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "missingProperty": "createdAt" } }); } }
tn.keywords.push({ name: "required", valid: k2 });
tn.valid = ok;
return ok; }
function u6c(v, d, s, ep, ip, st, tp, ev) { if (d >= h_maxd) h_deep(); d++;
const tn = h_tnode(tp, ep, "https://spike.example/event#/$defs/timestamps", ip);
const g5 = (typeof v === "object" && v !== null && !Array.isArray(v));
let ok = true;
let k0 = true, k1 = true, k2 = true;
const n3 = new Set();
if ((g5 && (v["createdAt"] !== undefined))) { n3.add("createdAt"); const m4 = st.anns.length; if (!u7(v["createdAt"], d, h_s0, ep + "/properties/createdAt", ip + "/createdAt", st, tn)) { ok = false; k0 = false; h_cutA(st, m4); } }
if ((g5 && (v["updatedAt"] !== undefined))) { n3.add("updatedAt"); const m6 = st.anns.length; if (!u8(v["updatedAt"], d, h_s0, ep + "/properties/updatedAt", ip + "/updatedAt", st, tn)) { ok = false; k0 = false; h_cutA(st, m6); } }
if (g5) { if (k0) { ev.push([...n3]); } }
tn.keywords.push({ name: "properties", valid: k0 });
if (!(g5)) { ok = false; k1 = false; h_err(st, tn, { evaluationPath: ep + "/type", schemaLocation: "https://spike.example/event#/$defs/timestamps/type", inputLocation: ip, error: "expected type \"object\"", keyword: "type", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "expected": "object" } }); }
tn.keywords.push({ name: "type", valid: k1 });
if (g5) { if (!((v["createdAt"] !== undefined))) { ok = false; k2 = false; h_err(st, tn, { evaluationPath: ep + "/required", schemaLocation: "https://spike.example/event#/$defs/timestamps/required", inputLocation: ip, error: "missing required property 'createdAt'", keyword: "required", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "missingProperty": "createdAt" } }); } }
tn.keywords.push({ name: "required", valid: k2 });
tn.valid = ok;
return ok; }
function u7(v, d, s, ep, ip, st, tp) { const tn = h_tnode(tp, ep, "https://spike.example/event#/$defs/timestamps/properties/createdAt", ip);
let ok = true;
let k0 = true;
if (!((typeof v === "string"))) { ok = false; k0 = false; h_err(st, tn, { evaluationPath: ep + "/type", schemaLocation: "https://spike.example/event#/$defs/timestamps/properties/createdAt/type", inputLocation: ip, error: "expected type \"string\"", keyword: "type", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "expected": "string" } }); }
tn.keywords.push({ name: "type", valid: k0 });
tn.valid = ok;
return ok; }
function u8(v, d, s, ep, ip, st, tp) { const tn = h_tnode(tp, ep, "https://spike.example/event#/$defs/timestamps/properties/updatedAt", ip);
let ok = true;
let k0 = true;
if (!((typeof v === "string"))) { ok = false; k0 = false; h_err(st, tn, { evaluationPath: ep + "/type", schemaLocation: "https://spike.example/event#/$defs/timestamps/properties/updatedAt/type", inputLocation: ip, error: "expected type \"string\"", keyword: "type", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "expected": "string" } }); }
tn.keywords.push({ name: "type", valid: k0 });
tn.valid = ok;
return ok; }
function u9(v, d, s, ep, ip, st, tp) { const tn = h_tnode(tp, ep, "https://spike.example/event#/properties/kind", ip);
let ok = true;
let k0 = true;
if (!(((v === "created") || (v === "updated") || (v === "deleted")))) { ok = false; k0 = false; h_err(st, tn, { evaluationPath: ep + "/enum", schemaLocation: "https://spike.example/event#/properties/kind/enum", inputLocation: ip, error: "not one of the allowed values", keyword: "enum", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "allowedValues": ["created","updated","deleted"] } }); }
tn.keywords.push({ name: "enum", valid: k0 });
tn.valid = ok;
return ok; }
function u10(v, d, s, ep, ip, st, tp) { const tn = h_tnode(tp, ep, "https://spike.example/event#/unevaluatedProperties", ip); tn.valid = false; h_err(st, tn, { evaluationPath: ep, schemaLocation: "https://spike.example/event#/unevaluatedProperties", inputLocation: ip, error: "schema is false", params: {} }); return false; }
return function evaluateTrace(v) { const st = h_tstate(); const ok = u0(v, 0, h_s0, "", "", st, st.hold); st.valid = ok; return st; };
