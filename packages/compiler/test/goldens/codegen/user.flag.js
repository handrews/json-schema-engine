"use strict";
const { isObject: h_obj, isInteger: h_int, jsonEqual: h_eq, canonicalKey: h_ck, codePointLength: h_cpl, escapeSegment: h_esc, isMultipleOf: h_mof, hasDuplicateItems: h_dup, firstDuplicatePair: h_fdp, frag: h_frag, fragList: h_fragl, tooDeep: h_deep } = R;
const h_maxd = R.maxDepth;
const h_s0 = [];
const h_hop = Object.prototype.hasOwnProperty;
const r0 = R.re["^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$"];
const r1 = R.re["^[0-9]{5}$"];
function u0(v, d, s) { const g1 = (typeof v === "object" && v !== null && !Array.isArray(v));
if ((g1 && (v["id"] !== undefined))) { const t0 = v["id"];
if (!((typeof t0 === "number" && Number.isInteger(t0)))) { return false; }
if (((typeof t0 === "number") && !((t0 >= 1)))) { return false; } }
if ((g1 && (v["name"] !== undefined))) { const t2 = v["name"];
if (!((typeof t2 === "string"))) { return false; }
if (((typeof t2 === "string") && ((t2.length < 1) || ((t2.length < 2) && (h_cpl(t2) < 1))))) { return false; }
if (((typeof t2 === "string") && (t2.length > 100) && (h_cpl(t2) > 100))) { return false; } }
if ((g1 && (v["email"] !== undefined))) { const t3 = v["email"];
if (!((typeof t3 === "string"))) { return false; }
if (((typeof t3 === "string") && !(r0.test(t3)))) { return false; } }
if ((g1 && (v["role"] !== undefined))) { const t4 = v["role"];
if (!(((t4 === "admin") || (t4 === "user") || (t4 === "guest")))) { return false; } }
if ((g1 && (v["tags"] !== undefined))) { const t5 = v["tags"];
if (Array.isArray(t5)) { for (let b0 = 0; b0 < t5.length; b0++) { const t6 = t5[b0];
if (!((typeof t6 === "string"))) { return false; } } }

if (!(Array.isArray(t5))) { return false; }
if ((Array.isArray(t5) && !((t5.length <= 10)))) { return false; } }
if ((g1 && (v["address"] !== undefined))) { const t7 = v["address"];
const g9 = (typeof t7 === "object" && t7 !== null && !Array.isArray(t7));
if ((g9 && (t7["street"] !== undefined))) { const t8 = t7["street"];
if (!((typeof t8 === "string"))) { return false; } }
if ((g9 && (t7["city"] !== undefined))) { const t10 = t7["city"];
if (!((typeof t10 === "string"))) { return false; } }
if ((g9 && (t7["zip"] !== undefined))) { const t11 = t7["zip"];
if (!((typeof t11 === "string"))) { return false; }
if (((typeof t11 === "string") && !(r1.test(t11)))) { return false; } }
if (g9) {  }
if (!(g9)) { return false; }
if (g9) { if (!((t7["street"] !== undefined))) { return false; }
if (!((t7["city"] !== undefined))) { return false; } } }
if (g1) {  }
if (g1) { for (const b1 in v) { if (!(((b1 === "id") || (b1 === "name") || (b1 === "email") || (b1 === "role") || (b1 === "tags") || (b1 === "address")))) { return false; } } }
if (g1) {  }
if (!(g1)) { return false; }
if (g1) { if (!((v["id"] !== undefined))) { return false; }
if (!((v["name"] !== undefined))) { return false; }
if (!((v["email"] !== undefined))) { return false; }
if (!((v["tags"] !== undefined))) { return false; } }
return true; }
return function validate(v) { return u0(v, 0, h_s0); };
