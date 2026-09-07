"use strict";
const { isObject: h_obj, isInteger: h_int, jsonEqual: h_eq, canonicalKey: h_ck, codePointLength: h_cpl, escapeSegment: h_esc, isMultipleOf: h_mof, hasDuplicateItems: h_dup, firstDuplicatePair: h_fdp, frag: h_frag, fragList: h_fragl, tooDeep: h_deep } = R;
const h_maxd = R.maxDepth;
const h_s0 = [];
const h_hop = Object.prototype.hasOwnProperty;
const { traceState: h_tstate, traceNode: h_tnode, traceError: h_err, traceAnn: h_ann, cutErrors: h_cutE, cutAnns: h_cutA, fragTrace: h_fragt } = R;
function u0(v, d, s, ep, ip, st, tp) { if (d >= h_maxd) h_deep(); d++;
s = [...s, "https://codegen.example/island"];
const tn = h_tnode(tp, ep, "https://codegen.example/island#", ip);
const g2 = (typeof v === "object" && v !== null && !Array.isArray(v));
let ok = true;
let k0 = true;
if ((g2 && ("p" in v))) { const m1 = st.anns.length; if (!h_fragt(T[0], v["p"], s, d, ep + "/properties/p", ip + "/p", st, tn)) { ok = false; k0 = false; h_cutA(st, m1); } }
if (g2) {  }
tn.keywords.push({ name: "properties", valid: k0 });
tn.valid = ok;
return ok; }
return function evaluateTrace(v) { const st = h_tstate(); const ok = u0(v, 0, h_s0, "", "", st, st.hold); st.valid = ok; return st; };
