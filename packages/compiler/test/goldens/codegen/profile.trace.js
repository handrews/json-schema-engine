"use strict";
const { isObject: h_obj, isInteger: h_int, jsonEqual: h_eq, canonicalKey: h_ck, codePointLength: h_cpl, escapeSegment: h_esc, isMultipleOf: h_mof, hasDuplicateItems: h_dup, firstDuplicatePair: h_fdp, frag: h_frag, fragList: h_fragl, tooDeep: h_deep } = R;
const h_maxd = R.maxDepth;
const h_s0 = [];
const h_hop = Object.prototype.hasOwnProperty;
const { traceState: h_tstate, traceNode: h_tnode, traceError: h_err, traceAnn: h_ann, cutErrors: h_cutE, cutAnns: h_cutA, fragTrace: h_fragt } = R;
function u0(v, d, s, ep, ip, st, tp) { if (d >= h_maxd) h_deep(); d++;
const tn = h_tnode(tp, ep, "https://spike.example/profile#", ip);
const g5 = (typeof v === "object" && v !== null && !Array.isArray(v));
let ok = true;
let k0 = true, k1 = true, k2 = true, k3 = true;
if ((g5 && (v["id"] !== undefined))) { const m4 = st.anns.length; if (!u1(v["id"], d, h_s0, ep + "/properties/id", ip + "/id", st, tn)) { ok = false; k0 = false; h_cutA(st, m4); } }
if ((g5 && (v["displayName"] !== undefined))) { const m6 = st.anns.length; if (!u2(v["displayName"], d, h_s0, ep + "/properties/displayName", ip + "/displayName", st, tn)) { ok = false; k0 = false; h_cutA(st, m6); } }
if ((g5 && (v["bio"] !== undefined))) { const m7 = st.anns.length; if (!u3(v["bio"], d, h_s0, ep + "/properties/bio", ip + "/bio", st, tn)) { ok = false; k0 = false; h_cutA(st, m7); } }
if ((g5 && (v["createdAt"] !== undefined))) { const m8 = st.anns.length; if (!u4(v["createdAt"], d, h_s0, ep + "/properties/createdAt", ip + "/createdAt", st, tn)) { ok = false; k0 = false; h_cutA(st, m8); } }
if (g5) {  }
tn.keywords.push({ name: "properties", valid: k0 });
if (!(g5)) { ok = false; k1 = false; h_err(st, tn, { evaluationPath: ep + "/type", schemaLocation: "https://spike.example/profile#/type", inputLocation: ip, error: "expected type \"object\"", keyword: "type", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "expected": "object" } }); }
tn.keywords.push({ name: "type", valid: k1 });
if (g5) { if (!((v["id"] !== undefined))) { ok = false; k2 = false; h_err(st, tn, { evaluationPath: ep + "/required", schemaLocation: "https://spike.example/profile#/required", inputLocation: ip, error: "missing required property 'id'", keyword: "required", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "missingProperty": "id" } }); } }
tn.keywords.push({ name: "required", valid: k2 });
h_ann(st, tn, { keyword: "title", vocabulary: "https://json-schema.org/draft/2020-12/vocab/meta-data", evaluationPath: ep + "/title", schemaLocation: "https://spike.example/profile#/title", inputLocation: ip, annotation: "User profile" });
tn.keywords.push({ name: "title", valid: k3 });
tn.valid = ok;
return ok; }
function u1(v, d, s, ep, ip, st, tp) { const tn = h_tnode(tp, ep, "https://spike.example/profile#/properties/id", ip);
let ok = true;
let k0 = true, k1 = true, k2 = true;
if (!((typeof v === "string"))) { ok = false; k0 = false; h_err(st, tn, { evaluationPath: ep + "/type", schemaLocation: "https://spike.example/profile#/properties/id/type", inputLocation: ip, error: "expected type \"string\"", keyword: "type", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "expected": "string" } }); }
tn.keywords.push({ name: "type", valid: k0 });
h_ann(st, tn, { keyword: "title", vocabulary: "https://json-schema.org/draft/2020-12/vocab/meta-data", evaluationPath: ep + "/title", schemaLocation: "https://spike.example/profile#/properties/id/title", inputLocation: ip, annotation: "Identifier" });
tn.keywords.push({ name: "title", valid: k1 });
h_ann(st, tn, { keyword: "readOnly", vocabulary: "https://json-schema.org/draft/2020-12/vocab/meta-data", evaluationPath: ep + "/readOnly", schemaLocation: "https://spike.example/profile#/properties/id/readOnly", inputLocation: ip, annotation: true });
tn.keywords.push({ name: "readOnly", valid: k2 });
tn.valid = ok;
return ok; }
function u2(v, d, s, ep, ip, st, tp) { const tn = h_tnode(tp, ep, "https://spike.example/profile#/properties/displayName", ip);
let ok = true;
let k0 = true, k1 = true, k2 = true;
if (!((typeof v === "string"))) { ok = false; k0 = false; h_err(st, tn, { evaluationPath: ep + "/type", schemaLocation: "https://spike.example/profile#/properties/displayName/type", inputLocation: ip, error: "expected type \"string\"", keyword: "type", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "expected": "string" } }); }
tn.keywords.push({ name: "type", valid: k0 });
h_ann(st, tn, { keyword: "title", vocabulary: "https://json-schema.org/draft/2020-12/vocab/meta-data", evaluationPath: ep + "/title", schemaLocation: "https://spike.example/profile#/properties/displayName/title", inputLocation: ip, annotation: "Display name" });
tn.keywords.push({ name: "title", valid: k1 });
h_ann(st, tn, { keyword: "default", vocabulary: "https://json-schema.org/draft/2020-12/vocab/meta-data", evaluationPath: ep + "/default", schemaLocation: "https://spike.example/profile#/properties/displayName/default", inputLocation: ip, annotation: "" });
tn.keywords.push({ name: "default", valid: k2 });
tn.valid = ok;
return ok; }
function u3(v, d, s, ep, ip, st, tp) { const tn = h_tnode(tp, ep, "https://spike.example/profile#/properties/bio", ip);
let ok = true;
let k0 = true, k1 = true, k2 = true;
if (!((typeof v === "string"))) { ok = false; k0 = false; h_err(st, tn, { evaluationPath: ep + "/type", schemaLocation: "https://spike.example/profile#/properties/bio/type", inputLocation: ip, error: "expected type \"string\"", keyword: "type", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "expected": "string" } }); }
tn.keywords.push({ name: "type", valid: k0 });
h_ann(st, tn, { keyword: "title", vocabulary: "https://json-schema.org/draft/2020-12/vocab/meta-data", evaluationPath: ep + "/title", schemaLocation: "https://spike.example/profile#/properties/bio/title", inputLocation: ip, annotation: "Biography" });
tn.keywords.push({ name: "title", valid: k1 });
h_ann(st, tn, { keyword: "default", vocabulary: "https://json-schema.org/draft/2020-12/vocab/meta-data", evaluationPath: ep + "/default", schemaLocation: "https://spike.example/profile#/properties/bio/default", inputLocation: ip, annotation: "" });
tn.keywords.push({ name: "default", valid: k2 });
tn.valid = ok;
return ok; }
function u4(v, d, s, ep, ip, st, tp) { const tn = h_tnode(tp, ep, "https://spike.example/profile#/properties/createdAt", ip);
let ok = true;
let k0 = true, k1 = true, k2 = true;
if (!((typeof v === "string"))) { ok = false; k0 = false; h_err(st, tn, { evaluationPath: ep + "/type", schemaLocation: "https://spike.example/profile#/properties/createdAt/type", inputLocation: ip, error: "expected type \"string\"", keyword: "type", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "expected": "string" } }); }
tn.keywords.push({ name: "type", valid: k0 });
h_ann(st, tn, { keyword: "title", vocabulary: "https://json-schema.org/draft/2020-12/vocab/meta-data", evaluationPath: ep + "/title", schemaLocation: "https://spike.example/profile#/properties/createdAt/title", inputLocation: ip, annotation: "Created" });
tn.keywords.push({ name: "title", valid: k1 });
h_ann(st, tn, { keyword: "readOnly", vocabulary: "https://json-schema.org/draft/2020-12/vocab/meta-data", evaluationPath: ep + "/readOnly", schemaLocation: "https://spike.example/profile#/properties/createdAt/readOnly", inputLocation: ip, annotation: true });
tn.keywords.push({ name: "readOnly", valid: k2 });
tn.valid = ok;
return ok; }
return function evaluateTrace(v) { const st = h_tstate(); const ok = u0(v, 0, h_s0, "", "", st, st.hold); st.valid = ok; return st; };
