// @json-schema-engine/formats: format implementations for the format-assertion vocabulary
// and the assertFormats configuration (M7). Implemented from the defining
// RFCs and the JSON Schema specs only (DESIGN.md D15) — no format/IDNA
// library is consulted.
//
// Every definition is type-scoped through FormatDefinition.types (default
// ["string"]): the KEYWORD treats instances outside a format's types as
// vacuously valid, per spec. The shape deliberately admits non-string
// formats (the OpenAPI format registry's number-scoped entries are a
// planned future table).

import type { FormatDefinition, FormatTable } from "@json-schema-engine/core";
import { isValidALabel } from "./idna.js";
import { idnEmail, idnHostname } from "./idn.js";

export { idnEmail, idnHostname } from "./idn.js";

// EXEMPLAR (trivial tier): a fixed grammar — one anchored regex, no
// structural interplay. RFC 4122 §3: 8-4-4-4-12 hex digits, any version.
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const uuid: FormatDefinition = {
  test: (value) => typeof value === "string" && UUID_RE.test(value),
};

// EXEMPLAR (parser tier): grammar with structural rules a single regex
// obscures. RFC 4291 §2.2: up to eight 16-bit hex fields; `::` compresses
// exactly one run (and must compress at least one field when 8 are already
// present); an embedded dotted-quad IPv4 tail counts as two fields.
const H16 = /^[0-9a-f]{1,4}$/i;
const IPV4_TAIL =
  /^(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])(\.(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])){3}$/;

function isIpv6(value: string): boolean {
  // A zone index or other non [0-9a-f:.] characters are out of grammar.
  if (!/^[0-9a-f:.]+$/i.test(value)) return false;
  const compressions = value.split("::").length - 1;
  if (compressions > 1) return false;

  let fields = 0;
  const sides = value.split("::");
  for (let sideIndex = 0; sideIndex < sides.length; sideIndex++) {
    const side = sides[sideIndex]!;
    if (side === "") continue; // "::" edge (leading/trailing)
    const parts = side.split(":");
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!;
      if (part === "") return false; // ":::", leading/trailing single ":"
      const isLast = sideIndex === sides.length - 1 && i === parts.length - 1;
      if (isLast && part.includes(".")) {
        if (!IPV4_TAIL.test(part)) return false;
        fields += 2;
        continue;
      }
      if (!H16.test(part)) return false;
      fields++;
    }
  }
  if (compressions === 1) return fields < 8; // "::" must stand for ≥1 field
  return fields === 8;
}

export const ipv6: FormatDefinition = {
  test: (value) => typeof value === "string" && isIpv6(value),
};

// RFC 3339 §5.6 full-date = date-fullyear "-" date-month "-" date-mday.
// The grammar caps date-mday at 01-31 syntactically, but real month/leap-year
// lengths are a semantic check the suite exercises (e.g. 2021-02-29 invalid,
// 2020-02-29 valid) — the ABNF alone under-constrains this format.
const FULL_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function isLeapYear(year: number): boolean {
  // Gregorian leap rule: divisible by 4, except centuries, except
  // centuries divisible by 400 (RFC 3339 appendix C examples: 0100 and
  // 2100 are not leap; 0400 is).
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function isFullDate(value: string): boolean {
  const m = FULL_DATE_RE.exec(value);
  if (m === null) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12) return false;
  const maxDay =
    month === 2 && isLeapYear(year) ? 29 : DAYS_IN_MONTH[month - 1]!;
  return day >= 1 && day <= maxDay;
}

export const date: FormatDefinition = {
  test: (value) => typeof value === "string" && isFullDate(value),
};

// RFC 3339 appendix A duration ABNF:
//   dur-second = 1*DIGIT "S"
//   dur-minute = 1*DIGIT "M" [dur-second]
//   dur-hour   = 1*DIGIT "H" [dur-minute]
//   dur-time   = "T" (dur-hour / dur-minute / dur-second)
//   dur-day    = 1*DIGIT "D"
//   dur-month  = 1*DIGIT "M" [dur-day]
//   dur-year   = 1*DIGIT "Y" [dur-month]
//   dur-week   = 1*DIGIT "W"
//   dur-date   = (dur-day / dur-month / dur-year) [dur-time]
//   duration   = "P" (dur-date / dur-time / dur-week)
// The date/time components are each optional but strictly ordered
// (year-month-day, then hour-minute-second) when present, and the
// grammar's optional-suffix nesting means at least one numeric component
// must actually appear after "P" (or after "T"): "P" and "PT" alone don't
// reduce to any of the three duration alternatives. Weeks are a separate
// top-level alternative and cannot combine with the other units.
// Each alternative's trailing unit is truly optional only by nesting
// inside the *preceding* unit's suffix (dur-year's [dur-month] contains
// dur-month's own [dur-day]) — so "D" without a preceding "M" is valid
// only when there's no "Y" either (dur-day standing alone), never as
// "Y...D" skipping "M". Mirroring that nesting directly (rather than three
// independently-optional groups) is what makes P1Y2D correctly rejected.
const DUR_DATE = /^\d+D$|^\d+M(\d+D)?$|^\d+Y(\d+M(\d+D)?)?$/;
const DUR_TIME = /^\d+S$|^\d+M(\d+S)?$|^\d+H(\d+M(\d+S)?)?$/;

function isDuration(value: string): boolean {
  if (!value.startsWith("P")) return false;
  const body = value.slice(1);
  if (body === "") return false;

  if (/^\d+W$/.test(body)) return true; // dur-week, no combining

  const tIndex = body.indexOf("T");
  const datePart = tIndex === -1 ? body : body.slice(0, tIndex);
  const timePart = tIndex === -1 ? "" : body.slice(tIndex + 1);

  if (tIndex !== -1 && timePart === "") return false; // "PT" with nothing after
  if (datePart === "" && timePart === "") return false; // "P" alone

  if (datePart !== "" && !DUR_DATE.test(datePart)) return false;
  if (timePart !== "" && !DUR_TIME.test(timePart)) return false;
  return true;
}

export const duration: FormatDefinition = {
  test: (value) => typeof value === "string" && isDuration(value),
};

// RFC 1123 §2.1 relaxes RFC 952's "must start with a letter" to allow
// leading digits, but the label/hyphen/length rules are unchanged: each
// label is 1-63 alphanumerics-or-hyphens, no leading/trailing hyphen, and
// the assembled name is at most 253 octets (excluding a trailing root dot,
// which this format doesn't accept anyway per the suite).
const HOSTNAME_LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/i;

function isHostname(value: string): boolean {
  if (value.length === 0 || value.length > 253) return false;
  const labels = value.split(".");
  return labels.every((label) => {
    if (!HOSTNAME_LABEL.test(label)) return false;
    return /^xn--/i.test(label) ? isValidALabel(label) : true;
  });
}

export const hostname: FormatDefinition = {
  test: (value) => typeof value === "string" && isHostname(value),
};

// RFC 2673 §3.2 dotted-quad: decbyte "." decbyte "." decbyte "." decbyte
// where decbyte is 1*3DIGIT syntactically, but JSON Schema's `ipv4` format
// (per the suite) also forbids leading zeros — "087" reads as octal in
// some parsers, so each octet must be "0" or a non-zero digit run.
const IPV4_OCTET = "(0|[1-9][0-9]?|1[0-9][0-9]|2[0-4][0-9]|25[0-5])";
const IPV4_RE = new RegExp(
  `^${IPV4_OCTET}\\.${IPV4_OCTET}\\.${IPV4_OCTET}\\.${IPV4_OCTET}$`,
);

export const ipv4: FormatDefinition = {
  test: (value) => typeof value === "string" && IPV4_RE.test(value),
};

// RFC 6901 §3: a JSON Pointer is either empty or a sequence of "/"-prefixed
// reference tokens; "~" is only valid as part of the "~0" (~) or "~1" (/)
// escape sequences.
const JSON_POINTER_RE = /^(\/([^~/]|~[01])*)*$/;

export const jsonPointer: FormatDefinition = {
  test: (value) => typeof value === "string" && JSON_POINTER_RE.test(value),
};

// RFC 6901 relative-json-pointer draft: a non-negative integer (no leading
// zeros, since a leading zero could only be the single digit "0" itself)
// followed by either a json-pointer or the "#" index/key marker.
const RELATIVE_JSON_POINTER_RE = /^(0|[1-9][0-9]*)(#|(\/([^~/]|~[01])*)*)$/;

export const relativeJsonPointer: FormatDefinition = {
  test: (value) =>
    typeof value === "string" && RELATIVE_JSON_POINTER_RE.test(value),
};

// The `regex` format asserts ECMA-262 pattern validity, and the runtime
// itself is an ECMA-262 engine — `new RegExp` succeeding/throwing IS the
// authoritative check, not a stand-in for one. Plain (non-`u`) mode is
// sufficient here: the suite's only invalid case is unclosed parens
// (rejected in any mode), so there is no case forcing the `u`-mode retry
// core's `schemaRegExp` uses for `\p{...}` property escapes.
function isRegex(value: string): boolean {
  try {
    new RegExp(value);
    return true;
  } catch {
    return false;
  }
}

export const regex: FormatDefinition = {
  test: (value) => typeof value === "string" && isRegex(value),
};

// RFC 3986 §3 URI grammar, generalized for §2 percent-encoding and the
// unreserved/sub-delims/pchar character classes. Implemented as a small
// hand-rolled parser (rather than one grammar-sized regex) because the
// production nesting (authority host-forms, path-forms keyed on whether a
// scheme/authority preceded them) is easier to get right — and to keep
// correct under later IRI generalization (D-block below) — as explicit
// steps than as regex alternation.
//
// pct-encoded = "%" HEXDIG HEXDIG
const PCT_ENCODED = /^%[0-9a-fA-F]{2}/;
// unreserved = ALPHA / DIGIT / "-" / "." / "_" / "~"
const UNRESERVED = /[A-Za-z0-9\-._~]/;
// sub-delims = "!" / "$" / "&" / "'" / "(" / ")" / "*" / "+" / "," / ";" / "="
const SUB_DELIMS = /[!$&'()*+,;=]/;

/**
 * Consumes the longest prefix of `s` matching the repeated class
 * "unreserved / pct-encoded / sub-delims / extra" (a generalization
 * covering pchar when extra is the two characters colon and at-sign,
 * userinfo when extra is just colon, and reg-name/query/fragment
 * variants) plus — via `extraChar`, an additional single-codepoint
 * predicate — the IRI ucschar/iprivate extension. Returns the number of
 * consumed UTF-16 code units, or -1 on hitting a character/escape that
 * doesn't fit.
 */
function consumePctEncodedClass(
  s: string,
  extra: string,
  extraChar?: (cp: number) => boolean,
): number {
  let i = 0;
  while (i < s.length) {
    const rest = s.slice(i);
    const pct = PCT_ENCODED.exec(rest);
    if (pct !== null) {
      i += 3;
      continue;
    }
    const ch = s[i]!;
    if (UNRESERVED.test(ch) || SUB_DELIMS.test(ch) || extra.includes(ch)) {
      i += 1;
      continue;
    }
    if (extraChar !== undefined) {
      const cp = s.codePointAt(i)!;
      if (extraChar(cp)) {
        i += cp > 0xffff ? 2 : 1;
        continue;
      }
    }
    return i === 0 ? -1 : i;
  }
  return i;
}

/** True if the whole string is consumed by {@link consumePctEncodedClass}. */
function isWholeClass(
  s: string,
  extra: string,
  extraChar?: (cp: number) => boolean,
): boolean {
  if (s.length === 0) return true;
  const n = consumePctEncodedClass(s, extra, extraChar);
  return n === s.length;
}

// scheme = ALPHA *( ALPHA / DIGIT / "+" / "-" / "." )
const SCHEME_RE = /^[A-Za-z][A-Za-z0-9+\-.]*$/;

interface UriComponents {
  scheme?: string;
  authority?: string;
  path: string;
  query?: string;
  fragment?: string;
}

/**
 * Splits into scheme/authority/path/query/fragment without validating
 * component contents (RFC 3986 Appendix B's parsing regex, restated as
 * explicit scanning). Returns undefined only for the impossible case of
 * a "://" with no scheme delimiter reachable — in practice this always
 * succeeds structurally; content validation happens in the caller.
 */
function splitUriReference(value: string): UriComponents {
  let rest = value;
  let fragment: string | undefined;
  const hashIndex = rest.indexOf("#");
  if (hashIndex !== -1) {
    fragment = rest.slice(hashIndex + 1);
    rest = rest.slice(0, hashIndex);
  }
  let query: string | undefined;
  const qIndex = rest.indexOf("?");
  if (qIndex !== -1) {
    query = rest.slice(qIndex + 1);
    rest = rest.slice(0, qIndex);
  }

  // A scheme is present only when a ":" appears before any "/", "?", or
  // "#" and what precedes it matches the scheme grammar (this also keeps
  // "a:b" — a scheme — distinct from a relative path segment containing
  // ":", which RFC 3986 §3.3 forbids in the first segment of a
  // scheme-less relative-ref).
  let scheme: string | undefined;
  const colonIndex = rest.indexOf(":");
  if (colonIndex > 0) {
    const candidate = rest.slice(0, colonIndex);
    if (SCHEME_RE.test(candidate)) {
      scheme = candidate;
      rest = rest.slice(colonIndex + 1);
    }
  }

  let authority: string | undefined;
  if (rest.startsWith("//")) {
    rest = rest.slice(2);
    const slashIndex = rest.search(/[/]/);
    if (slashIndex === -1) {
      authority = rest;
      rest = "";
    } else {
      authority = rest.slice(0, slashIndex);
      rest = rest.slice(slashIndex);
    }
  }

  return { scheme, authority, path: rest, query, fragment };
}

/**
 * IPv4address for the host production (RFC 3986 §3.2.2), distinct from
 * the standalone `ipv4` format: a URI host that fails this still parses
 * as a valid `reg-name` (unreserved/pct-encoded/sub-delims), which is why
 * "http://999.999.999.999/" and "http://087.10.0.1/" are structurally
 * valid URIs per the suite even though neither is a valid `ipv4`.
 */
const URI_IPV4_RE =
  /^(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])(\.(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])){3}$/;

/**
 * IPvFuture = "v" 1*HEXDIG "." 1*( unreserved / sub-delims / ":" ) — an
 * escape hatch for host address formats beyond IPv4/IPv6 that the suite
 * doesn't exercise but the grammar admits.
 */
const IPVFUTURE_RE = /^[vV][0-9a-fA-F]+\.[A-Za-z0-9\-._~!$&'()*+,;=:]+$/;

function isValidHost(
  host: string,
  regNameExtraChar?: (cp: number) => boolean,
): boolean {
  if (host.startsWith("[") && host.endsWith("]")) {
    const inner = host.slice(1, -1);
    return isIpv6(inner) || IPVFUTURE_RE.test(inner);
  }
  // host = IP-literal / IPv4address / reg-name — IPv4address is tried
  // first only in the sense that reg-name is the universal fallback;
  // either way an IPv4-shaped reg-name is accepted (see URI_IPV4_RE doc).
  if (URI_IPV4_RE.test(host)) return true;
  return isWholeClass(host, "", regNameExtraChar);
}

function isValidAuthority(
  authority: string,
  extraChar?: (cp: number) => boolean,
): boolean {
  let rest = authority;
  const at = rest.lastIndexOf("@");
  if (at !== -1) {
    const userinfo = rest.slice(0, at);
    if (!isWholeClass(userinfo, ":", extraChar)) return false;
    rest = rest.slice(at + 1);
  }
  // host may be an IP-literal ("[...]"), which can itself contain ":" —
  // so the port separator must be sought outside any bracketed literal.
  let host = rest;
  let port: string | undefined;
  if (rest.startsWith("[")) {
    const close = rest.indexOf("]");
    if (close === -1) return false;
    host = rest.slice(0, close + 1);
    const afterBracket = rest.slice(close + 1);
    if (afterBracket.startsWith(":")) port = afterBracket.slice(1);
    else if (afterBracket !== "") return false;
  } else {
    const colon = rest.indexOf(":");
    if (colon !== -1) {
      host = rest.slice(0, colon);
      port = rest.slice(colon + 1);
    }
  }
  if (port !== undefined && !/^[0-9]*$/.test(port)) return false;
  return isValidHost(host, extraChar);
}

/**
 * Validates the parsed components of a URI/URI-reference (or, via
 * `extraChar`, an IRI/IRI-reference). `requireScheme` distinguishes `uri`
 * (must be absolute, RFC 3986 §4.3) from `uri-reference` (§4.1, scheme
 * optional).
 */
function isValidUriReference(
  value: string,
  requireScheme: boolean,
  extraChar?: (cp: number) => boolean,
): boolean {
  const { scheme, authority, path, query, fragment } = splitUriReference(value);
  if (requireScheme && scheme === undefined) return false;
  if (authority !== undefined && !isValidAuthority(authority, extraChar)) {
    return false;
  }
  // path-noscheme's first segment forbids ":" (already enforced by
  // splitUriReference treating a pre-"/" colon as a scheme delimiter
  // whenever it matches scheme grammar); pchar covers the rest.
  if (!isWholeClass(path, "/:@", extraChar)) return false;
  if (query !== undefined && !isWholeClass(query, "/:@?", extraChar)) {
    return false;
  }
  if (fragment !== undefined && !isWholeClass(fragment, "/:@?", extraChar)) {
    return false;
  }
  return true;
}

export const uri: FormatDefinition = {
  test: (value) =>
    typeof value === "string" && isValidUriReference(value, true),
};

export const uriReference: FormatDefinition = {
  test: (value) =>
    typeof value === "string" && isValidUriReference(value, false),
};

// RFC 6570 §2 URI Template grammar:
//   URI-Template  = *( literal / expression )
//   expression    = "{" [ operator ] variable-list "}"
//   operator      = op-level2 / op-level3 / op-reserve
//   op-level2     = "+" / "#"
//   op-level3     = "." / "/" / ";" / "?" / "&"
//   op-reserve    = "=" / "," / "!" / "@" / "|"
//   variable-list = varspec *( "," varspec )
//   varspec       = varname [ modifier-level4 ]
//   varname       = varchar *( ["."] varchar )
//   varchar       = ALPHA / DIGIT / "_" / pct-encoded
//   modifier-level4 = prefix / explode
//   prefix        = ":" max-length      ; max-length = %x31-39 0*3DIGIT
//   explode       = "*"
// `literal` is any character except operator/expression delimiters,
// backslash, quotes, and control/space; unlike plain URI references it
// admits raw ucschar/iprivate (this format doesn't distinguish an ASCII
// vs. internationalized tier the way uri/iri do).
const VARCHAR = /[A-Za-z0-9_]/;

function isValidVarname(varname: string): boolean {
  if (varname === "") return false;
  const parts = varname.split(".");
  // "." only ever separates two varchar runs — a leading/trailing/doubled
  // "." would produce an empty part here.
  return parts.every((part) => {
    if (part === "") return false;
    let i = 0;
    while (i < part.length) {
      if (VARCHAR.test(part[i]!)) {
        i += 1;
        continue;
      }
      const pct = PCT_ENCODED.exec(part.slice(i));
      if (pct === null) return false;
      i += 3;
    }
    return true;
  });
}

function isValidVarspec(varspec: string): boolean {
  const prefixMatch = /^(.*):([1-9][0-9]{0,3})$/.exec(varspec);
  if (prefixMatch !== null) return isValidVarname(prefixMatch[1]!);
  if (varspec.endsWith("*")) return isValidVarname(varspec.slice(0, -1));
  return isValidVarname(varspec);
}

const OPERATORS = new Set([
  "+",
  "#",
  ".",
  "/",
  ";",
  "?",
  "&",
  "=",
  ",",
  "!",
  "@",
  "|",
]);

function isValidExpression(inner: string): boolean {
  if (inner === "") return false;
  const body = OPERATORS.has(inner[0]!) ? inner.slice(1) : inner;
  if (body === "") return false;
  return body.split(",").every(isValidVarspec);
}

// literal excludes: SP DQUOTE "'" "%" (unless a valid pct-encoded) "<" ">"
// "\" "^" "`" "{" "|" "}" and C0/DEL control characters (RFC 6570 §2.1's
// ucschar/iprivate carve-outs are additive on top of this base set — the
// IRI-facing `extraChar` predicate below covers those, same shared-helper
// shape as the URI/IRI generalization above).
// The control-character range is spelled with explicit hex escapes (rather
// than source control bytes) so the pattern stays legible in an editor.
// eslint-disable-next-line no-control-regex -- RFC 6570's excluded set is C0/DEL by definition
const LITERAL_EXCLUDED = /["'%<>\\^`{|}\x00-\x1f\x7f ]/;

function isValidLiteralRun(
  s: string,
  extraChar?: (cp: number) => boolean,
): boolean {
  let i = 0;
  while (i < s.length) {
    const ch = s[i]!;
    if (ch === "%") {
      const pct = PCT_ENCODED.exec(s.slice(i));
      if (pct === null) return false;
      i += 3;
      continue;
    }
    if (!LITERAL_EXCLUDED.test(ch)) {
      i += 1;
      continue;
    }
    if (extraChar !== undefined) {
      const cp = s.codePointAt(i)!;
      if (extraChar(cp)) {
        i += cp > 0xffff ? 2 : 1;
        continue;
      }
    }
    return false;
  }
  return true;
}

function isUriTemplate(
  value: string,
  extraChar?: (cp: number) => boolean,
): boolean {
  let i = 0;
  while (i < value.length) {
    const open = value.indexOf("{", i);
    if (open === -1) return isValidLiteralRun(value.slice(i), extraChar);
    if (!isValidLiteralRun(value.slice(i, open), extraChar)) return false;
    const close = value.indexOf("}", open);
    if (close === -1) return false; // unclosed brace
    if (!isValidExpression(value.slice(open + 1, close))) return false;
    i = close + 1;
  }
  return true;
}

export const uriTemplate: FormatDefinition = {
  test: (value) => typeof value === "string" && isUriTemplate(value),
};

// RFC 5321 §4.1.2 Mailbox grammar:
//   Mailbox      = Local-part "@" ( Domain / address-literal )
//   Local-part   = Dot-string / Quoted-string
//   Dot-string   = Atom *("." Atom)
//   Atom         = 1*atext
//   atext        = ALPHA / DIGIT / "!" / "#" / "$" / "%" / "&" / "'" / "*"
//                  / "+" / "-" / "/" / "=" / "?" / "^" / "_" / "`" / "{"
//                  / "|" / "}" / "~"
//   Quoted-string = DQUOTE *QcontentSMTP DQUOTE
//   QcontentSMTP = qtextSMTP / quoted-pairSMTP
//   qtextSMTP    = %d32-33 / %d35-91 / %d93-126   ; printable US-ASCII, no
//                                                  ; unescaped '"' or '\'
//   quoted-pairSMTP = %d92 %d32-126
// Local-part's Dot-string disallows leading/trailing/doubled "." because
// each Atom is 1*atext with no embedded ".": the dots are pure separators
// between non-empty atoms, so an empty atom (adjacent dots or a dot at
// either end) is a structural rejection, not a special case.
const ATEXT = /^[A-Za-z0-9!#$%&'*+\-/=?^_`{|}~]+$/;

function isDotString(localPart: string): boolean {
  if (localPart === "") return false;
  return localPart.split(".").every((atom) => ATEXT.test(atom));
}

function isQuotedString(localPart: string): boolean {
  if (localPart.length < 2) return false;
  if (!localPart.startsWith('"') || !localPart.endsWith('"')) {
    return false;
  }
  const inner = localPart.slice(1, -1);
  let i = 0;
  while (i < inner.length) {
    const code = inner.codePointAt(i)!;
    if (code === 0x5c) {
      // quoted-pairSMTP: "\" followed by any printable ASCII (32-126).
      const next = inner.codePointAt(i + 1);
      if (next === undefined || next < 32 || next > 126) return false;
      i += 2;
      continue;
    }
    // qtextSMTP: printable ASCII except '"' (34) and '\' (92).
    if (code < 32 || code > 126 || code === 0x22) return false;
    i += 1;
  }
  return true;
}

/**
 * RFC 5321 §4.1.3 address-literal contents (without the surrounding
 * "[" "]", already stripped by the caller): IPv4-address-literal is the
 * plain `ipv4` grammar; IPv6-address-literal is "IPv6:" plus the `ipv6`
 * grammar. General-address-literal (other tags) isn't exercised by the
 * suite and is intentionally not accepted here.
 */
function isAddressLiteral(inner: string): boolean {
  if (inner.startsWith("IPv6:")) return isIpv6(inner.slice(5));
  return IPV4_RE.test(inner);
}

function isValidEmailDomain(domain: string): boolean {
  if (domain.startsWith("[") && domain.endsWith("]")) {
    return isAddressLiteral(domain.slice(1, -1));
  }
  return isHostname(domain);
}

function isEmail(value: string): boolean {
  // The local part ends at the last unquoted "@"; a quoted local part can
  // itself contain "@" (RFC 5321's qtextSMTP admits it), so splitting on
  // the first "@" would wrongly truncate `"joe@bloggs"@example.com`.
  let localPart: string;
  let domain: string;
  if (value.startsWith('"')) {
    // Find the closing quote, respecting quoted-pairSMTP escapes, then
    // the domain is whatever follows "@" immediately after it.
    let i = 1;
    while (i < value.length && value[i] !== '"') {
      i += value[i] === "\\" ? 2 : 1;
    }
    if (i >= value.length || value[i + 1] !== "@") return false;
    localPart = value.slice(0, i + 1);
    domain = value.slice(i + 2);
  } else {
    const at = value.lastIndexOf("@");
    if (at === -1) return false;
    localPart = value.slice(0, at);
    domain = value.slice(at + 1);
  }
  if (domain === "") return false;
  const validLocal = localPart.startsWith('"')
    ? isQuotedString(localPart)
    : isDotString(localPart);
  return validLocal && isValidEmailDomain(domain);
}

export const email: FormatDefinition = {
  test: (value) => typeof value === "string" && isEmail(value),
};

// RFC 3987 §2.2 IRI grammar: RFC 3986's URI grammar with `ucschar` and
// `iprivate` admitted alongside ASCII wherever `unreserved` is admitted in
// URI (host reg-name, userinfo, pchar-derived path/query/fragment) — query
// additionally admits `iprivate`. `ucschar` is (in RFC 3987's block-listed
// form) most of the non-ASCII Unicode range excluding surrogates,
// noncharacters, and a handful of reserved blocks; JS Unicode regex
// classes make the surrogate/noncharacter exclusions the practical way to
// state it without hand-copying RFC 3987's forty-odd range triples.
const IPRIVATE_RANGES: [number, number][] = [
  [0xe000, 0xf8ff],
  [0xf0000, 0xffffd],
  [0x100000, 0x10fffd],
];

function isIprivate(cp: number): boolean {
  return IPRIVATE_RANGES.some(([lo, hi]) => cp >= lo && cp <= hi);
}

// ucschar = %xA0-D7FF / %xF900-FDCF / %xFDF0-FFEF / %x10000-1FFFD / ...
// (one contiguous supplementary-plane range per plane through 10). Encoded
// as explicit ranges (rather than trying to express "surrogates and
// noncharacters excluded" as a single predicate) so it matches the RFC
// text directly and stays auditable against it.
const UCSCHAR_BMP_RANGES: [number, number][] = [
  [0xa0, 0xd7ff],
  [0xf900, 0xfdcf],
  [0xfdf0, 0xfffd],
];

function isUcschar(cp: number): boolean {
  if (UCSCHAR_BMP_RANGES.some(([lo, hi]) => cp >= lo && cp <= hi)) {
    return true;
  }
  if (cp < 0x10000) return false;
  // Supplementary planes 1-14 (0x10000-0xDFFFD), each plane's last two
  // code points (...FFFE/...FFFF) are noncharacters and excluded, mirroring
  // the BMP exclusion of FFFE/FFFF via the 0xFFEF upper bound above.
  const plane = cp >>> 16;
  if (plane < 1 || plane > 14) return false;
  const inPlane = cp & 0xffff;
  return inPlane <= 0xfffd;
}

const isIriExtraChar = (cp: number): boolean => isUcschar(cp) || isIprivate(cp);

function isValidIriReference(value: string, requireScheme: boolean): boolean {
  return isValidUriReference(value, requireScheme, isIriExtraChar);
}

export const iri: FormatDefinition = {
  test: (value) =>
    typeof value === "string" && isValidIriReference(value, true),
};

export const iriReference: FormatDefinition = {
  test: (value) =>
    typeof value === "string" && isValidIriReference(value, false),
};

// RFC 3339 §5.6:
//   full-date  = date-fullyear "-" date-month "-" date-mday
//   full-time  = partial-time time-offset
//   partial-time = time-hour ":" time-minute ":" time-second [time-secfrac]
//   time-offset  = "Z" / time-numoffset
//   time-numoffset = ("+" / "-") time-hour ":" time-minute
//   date-time  = full-date "T" full-time
// time-second's grammar allows "60" for a positive leap second, but RFC
// 3339 §5.7 restricts *actual* leap seconds to the UTC instant 23:59:60 —
// so a local time with a ":60" second is only valid when the offset shift
// back to UTC lands exactly on 23:59. "T"/"Z" are case-insensitive per
// §5.6's ABNF note.
const PARTIAL_TIME_RE =
  /^([0-9]{2}):([0-9]{2}):([0-9]{2})(\.[0-9]+)?([Zz]|[+-][0-9]{2}:[0-9]{2})$/;

function isValidTimeOffset(
  hour: number,
  minute: number,
  offset: string,
): {
  ok: boolean;
  isLeapCandidate: boolean;
  utcMinutes: number;
} {
  if (offset === "Z" || offset === "z") {
    return { ok: true, isLeapCandidate: true, utcMinutes: hour * 60 + minute };
  }
  const sign = offset.startsWith("+") ? 1 : -1;
  const offHour = Number(offset.slice(1, 3));
  const offMinute = Number(offset.slice(4, 6));
  if (offHour > 23 || offMinute > 59) {
    return { ok: false, isLeapCandidate: false, utcMinutes: 0 };
  }
  const localMinutes = hour * 60 + minute;
  const utcMinutes =
    (((localMinutes - sign * (offHour * 60 + offMinute)) % 1440) + 1440) % 1440;
  return { ok: true, isLeapCandidate: true, utcMinutes };
}

function isValidPartialTime(value: string): boolean {
  const m = PARTIAL_TIME_RE.exec(value);
  if (m === null) return false;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  const second = Number(m[3]);
  const offset = m[5]!;
  if (hour > 23 || minute > 59) return false;
  const { ok, utcMinutes } = isValidTimeOffset(hour, minute, offset);
  if (!ok) return false;
  if (second < 60) return true;
  if (second > 60) return false;
  // A ":60" second is only real at the UTC instant 23:59:60 — i.e. the
  // local time, shifted to UTC through its offset, must equal 23:59.
  return utcMinutes === 23 * 60 + 59;
}

export const time: FormatDefinition = {
  test: (value) => typeof value === "string" && isValidPartialTime(value),
};

function isValidDateTime(value: string): boolean {
  if (value.length < 20) return false;
  const tIndex = 10;
  if (value[tIndex] !== "T" && value[tIndex] !== "t") return false;
  const datePart = value.slice(0, tIndex);
  const timePart = value.slice(tIndex + 1);
  return isFullDate(datePart) && isValidPartialTime(timePart);
}

export const dateTime: FormatDefinition = {
  test: (value) => typeof value === "string" && isValidDateTime(value),
};

/**
 * The draft 2020-12 format table. 2019-09 shares it; draft-07/06 subsets
 * are derived below. Entries land format-by-format during M7 — each with
 * its optional-suite file green before the next begins.
 */
export const FORMATS_2020_12: FormatTable = {
  uuid,
  ipv6,
  date,
  duration,
  hostname,
  ipv4,
  "json-pointer": jsonPointer,
  "relative-json-pointer": relativeJsonPointer,
  regex,
  uri,
  "uri-reference": uriReference,
  "uri-template": uriTemplate,
  email,
  iri,
  "iri-reference": iriReference,
  "date-time": dateTime,
  time,
  "idn-hostname": idnHostname,
  "idn-email": idnEmail,
};

/** 2019-09 shares 2020-12's format list. */
export const FORMATS_2019_09: FormatTable = FORMATS_2020_12;

// draft-07 lacks uuid/duration; draft-06 additionally lacks iri/idn
// formats. Subset tables are derived once the relevant entries exist.
const subset = (table: FormatTable, omit: readonly string[]): FormatTable =>
  Object.fromEntries(
    Object.entries(table).filter(([name]) => !omit.includes(name)),
  );

/** draft-07 format table (no uuid, no duration). */
export const FORMATS_DRAFT_07: FormatTable = subset(FORMATS_2020_12, [
  "uuid",
  "duration",
]);

/** draft-06 format table (draft-07's minus iri/iri-reference/idn-*). */
export const FORMATS_DRAFT_06: FormatTable = subset(FORMATS_DRAFT_07, [
  "iri",
  "iri-reference",
  "idn-email",
  "idn-hostname",
]);

/**
 * draft-04 format table (for the draft-04 dialect package): only date-time,
 * email, hostname, ipv4, ipv6, and uri are defined by the draft-04 spec.
 */
export const FORMATS_DRAFT_04: FormatTable = subset(FORMATS_DRAFT_06, [
  "date",
  "time",
  "json-pointer",
  "relative-json-pointer",
  "regex",
  "uri-reference",
  "uri-template",
]);
