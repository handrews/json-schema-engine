"use strict";
const { isObject: h_obj, isInteger: h_int, jsonEqual: h_eq, canonicalKey: h_ck, codePointLength: h_cpl, escapeSegment: h_esc, isMultipleOf: h_mof, hasDuplicateItems: h_dup, firstDuplicatePair: h_fdp, frag: h_frag, fragList: h_fragl, tooDeep: h_deep } = R;
const h_maxd = R.maxDepth;
const h_s0 = [];
const h_hop = Object.prototype.hasOwnProperty;
const h_fragla = R.fragListAnn;
function u0(v, d, s, ep, ip, errs, anns) { if (d >= h_maxd) h_deep(); d++;
const g1 = (typeof v === "object" && v !== null && !Array.isArray(v));
let ok = true;
if ((g1 && (v["id"] !== undefined))) { const m0 = anns.length; if (!u1(v["id"], d, h_s0, ep + "/properties/id", ip + "/id", errs, anns)) { ok = false; anns.length = m0; } }
if ((g1 && (v["displayName"] !== undefined))) { const m2 = anns.length; if (!u2(v["displayName"], d, h_s0, ep + "/properties/displayName", ip + "/displayName", errs, anns)) { ok = false; anns.length = m2; } }
if ((g1 && (v["bio"] !== undefined))) { const m3 = anns.length; if (!u3(v["bio"], d, h_s0, ep + "/properties/bio", ip + "/bio", errs, anns)) { ok = false; anns.length = m3; } }
if ((g1 && (v["createdAt"] !== undefined))) { const m4 = anns.length; if (!u4(v["createdAt"], d, h_s0, ep + "/properties/createdAt", ip + "/createdAt", errs, anns)) { ok = false; anns.length = m4; } }
if (g1) {  }
if (!(g1)) { ok = false; errs.push({ evaluationPath: ep + "/type", schemaLocation: "https://spike.example/profile#/type", inputLocation: ip, error: "expected type \"object\"", keyword: "type", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "expected": "object" } }); }
if (g1) { if (!((v["id"] !== undefined))) { ok = false; errs.push({ evaluationPath: ep + "/required", schemaLocation: "https://spike.example/profile#/required", inputLocation: ip, error: "missing required property 'id'", keyword: "required", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "missingProperty": "id" } }); } }
anns.push({ keyword: "title", vocabulary: "https://json-schema.org/draft/2020-12/vocab/meta-data", evaluationPath: ep + "/title", schemaLocation: "https://spike.example/profile#/title", inputLocation: ip, annotation: "User profile" });
return ok; }
function u1(v, d, s, ep, ip, errs, anns) { let ok = true;
if (!((typeof v === "string"))) { ok = false; errs.push({ evaluationPath: ep + "/type", schemaLocation: "https://spike.example/profile#/properties/id/type", inputLocation: ip, error: "expected type \"string\"", keyword: "type", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "expected": "string" } }); }
anns.push({ keyword: "title", vocabulary: "https://json-schema.org/draft/2020-12/vocab/meta-data", evaluationPath: ep + "/title", schemaLocation: "https://spike.example/profile#/properties/id/title", inputLocation: ip, annotation: "Identifier" });
anns.push({ keyword: "readOnly", vocabulary: "https://json-schema.org/draft/2020-12/vocab/meta-data", evaluationPath: ep + "/readOnly", schemaLocation: "https://spike.example/profile#/properties/id/readOnly", inputLocation: ip, annotation: true });
return ok; }
function u2(v, d, s, ep, ip, errs, anns) { let ok = true;
if (!((typeof v === "string"))) { ok = false; errs.push({ evaluationPath: ep + "/type", schemaLocation: "https://spike.example/profile#/properties/displayName/type", inputLocation: ip, error: "expected type \"string\"", keyword: "type", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "expected": "string" } }); }
anns.push({ keyword: "title", vocabulary: "https://json-schema.org/draft/2020-12/vocab/meta-data", evaluationPath: ep + "/title", schemaLocation: "https://spike.example/profile#/properties/displayName/title", inputLocation: ip, annotation: "Display name" });
anns.push({ keyword: "default", vocabulary: "https://json-schema.org/draft/2020-12/vocab/meta-data", evaluationPath: ep + "/default", schemaLocation: "https://spike.example/profile#/properties/displayName/default", inputLocation: ip, annotation: "" });
return ok; }
function u3(v, d, s, ep, ip, errs, anns) { let ok = true;
if (!((typeof v === "string"))) { ok = false; errs.push({ evaluationPath: ep + "/type", schemaLocation: "https://spike.example/profile#/properties/bio/type", inputLocation: ip, error: "expected type \"string\"", keyword: "type", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "expected": "string" } }); }
anns.push({ keyword: "title", vocabulary: "https://json-schema.org/draft/2020-12/vocab/meta-data", evaluationPath: ep + "/title", schemaLocation: "https://spike.example/profile#/properties/bio/title", inputLocation: ip, annotation: "Biography" });
anns.push({ keyword: "default", vocabulary: "https://json-schema.org/draft/2020-12/vocab/meta-data", evaluationPath: ep + "/default", schemaLocation: "https://spike.example/profile#/properties/bio/default", inputLocation: ip, annotation: "" });
return ok; }
function u4(v, d, s, ep, ip, errs, anns) { let ok = true;
if (!((typeof v === "string"))) { ok = false; errs.push({ evaluationPath: ep + "/type", schemaLocation: "https://spike.example/profile#/properties/createdAt/type", inputLocation: ip, error: "expected type \"string\"", keyword: "type", vocabulary: "https://json-schema.org/draft/2020-12/vocab/validation", params: { "expected": "string" } }); }
anns.push({ keyword: "title", vocabulary: "https://json-schema.org/draft/2020-12/vocab/meta-data", evaluationPath: ep + "/title", schemaLocation: "https://spike.example/profile#/properties/createdAt/title", inputLocation: ip, annotation: "Created" });
anns.push({ keyword: "readOnly", vocabulary: "https://json-schema.org/draft/2020-12/vocab/meta-data", evaluationPath: ep + "/readOnly", schemaLocation: "https://spike.example/profile#/properties/createdAt/readOnly", inputLocation: ip, annotation: true });
return ok; }
return function evaluateList(v) { const errs = []; const anns = []; const ok = u0(v, 0, h_s0, "", "", errs, anns); return { valid: ok, errors: errs, annotations: anns }; };
