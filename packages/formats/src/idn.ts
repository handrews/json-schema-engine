// idn-hostname / idn-email (RFC 5890/5891/5892/5893, RFC 6531) — the
// U-label side of the IDNA2008 machinery in idna.ts. Implemented from the
// RFCs with Unicode data through ECMA-262's native \p{...} property
// escapes plus small cited tables (DESIGN.md D15).

import type { FormatDefinition } from "@jse/core";
import {
  decodePunycode,
  encodePunycode,
  isValidALabel,
  isValidIdnaLabel,
} from "./idna.js";

// ---------------------------------------------------------------------------
// RFC 5892 derived-property approximation for U-label code points. PVALID's
// backbone is letters/digits/marks in lowercase or caseless form; uppercase
// (and anything case-unstable), symbols, punctuation, spaces, and controls
// are DISALLOWED. Context characters (Appendix A) are admitted here and
// judged by their rules in isValidIdnaLabel.
const LETTER_DIGIT_MARK = /^[\p{Ll}\p{Lo}\p{Lm}\p{Mn}\p{Mc}\p{Nd}]$/u;
const CONTEXT_CPS = new Set([
  0x200c, // ZWNJ (CONTEXTJ, A.1)
  0x200d, // ZWJ (CONTEXTJ, A.2)
  0x00b7, // MIDDLE DOT (A.3)
  0x0375, // GREEK KERAIA (A.4)
  0x05f3, // HEBREW GERESH (A.5)
  0x05f4, // HEBREW GERSHAYIM (A.6)
  0x30fb, // KATAKANA MIDDLE DOT (A.7)
]);

// RFC 5892 §2.6 exceptions carrying PVALID despite their general
// category (punctuation/symbol/number-letter): TIBETAN TSHEG, IDEOGRAPHIC
// ZERO, the Sindhi Arabic signs. (ß/ς are Ll and need no exception here.)
const PVALID_EXCEPTIONS = new Set([0x0f0b, 0x3007, 0x06fd, 0x06fe]);

const allowedUnicodeCp = (cp: number): boolean => {
  if (PVALID_EXCEPTIONS.has(cp)) return true;
  if (cp === 0x2d) return true; // hyphen (LDH; placement rules elsewhere)
  if (cp >= 0x30 && cp <= 0x39) return true;
  if (cp >= 0x61 && cp <= 0x7a) return true;
  if (cp < 0x80) return false; // other ASCII: uppercase, symbols, dots…
  if (CONTEXT_CPS.has(cp)) return true;
  return LETTER_DIGIT_MARK.test(String.fromCodePoint(cp));
};

// ---------------------------------------------------------------------------
// RFC 5893 (bidi) character classes, approximated from the Unicode
// Bidi_Class assignments the RFC cites. ECMA regex has no \p{Bidi_Class=},
// so the RTL classes are explicit block ranges (Hebrew, Arabic, Syriac,
// Thaana, NKo + presentation forms); EN/AN/NSM/ES/CS/ET/ON cover the
// digit/mark/neutral classes the rule distinguishes.
type BidiClass = "R" | "AL" | "AN" | "EN" | "NSM" | "L" | "N";

const R_RANGES: readonly [number, number][] = [
  [0x05be, 0x05be],
  [0x05c0, 0x05c0],
  [0x05c3, 0x05c3],
  [0x05c6, 0x05c6],
  [0x05d0, 0x05f4],
  [0x0608, 0x0608],
  [0x200f, 0x200f],
  [0xfb1d, 0xfb1d],
  [0xfb1f, 0xfb28],
  [0xfb2a, 0xfb4f],
];
const AL_RANGES: readonly [number, number][] = [
  [0x0600, 0x0605],
  [0x060b, 0x060b],
  [0x060d, 0x060d],
  [0x061b, 0x064a],
  [0x066d, 0x066f],
  [0x0671, 0x06d5],
  [0x06e5, 0x06e6],
  [0x06ee, 0x06ef],
  [0x06fa, 0x0710],
  [0x0712, 0x072f],
  [0x074d, 0x07a5],
  [0x07b1, 0x07b1],
  [0x0780, 0x07a5],
  [0xfb50, 0xfdfd],
  [0xfe70, 0xfefc],
];
const AN_RANGES: readonly [number, number][] = [
  [0x0660, 0x0669],
  [0x066b, 0x066c],
  [0x06dd, 0x06dd],
];
const inRanges = (cp: number, ranges: readonly [number, number][]): boolean =>
  ranges.some(([lo, hi]) => cp >= lo && cp <= hi);

const NSM_RE = /^\p{Mn}$/u;
const L_RE = /^[\p{L}\p{Nl}]$/u;

function bidiClass(cp: number): BidiClass {
  if (inRanges(cp, AN_RANGES)) return "AN";
  if (inRanges(cp, R_RANGES)) return "R";
  if (inRanges(cp, AL_RANGES)) return "AL";
  if (cp >= 0x30 && cp <= 0x39) return "EN";
  if (cp >= 0x06f0 && cp <= 0x06f9) return "EN"; // extended Arabic-Indic: EN
  const ch = String.fromCodePoint(cp);
  if (NSM_RE.test(ch)) return "NSM";
  if (L_RE.test(ch)) return "L";
  return "N"; // ES/CS/ET/ON/BN for the rule's purposes
}

/**
 * The RFC 5893 §2 Bidi rule for one label. Applied only when the whole
 * domain name is a "Bidi domain name" (some label contains R/AL/AN).
 */
function satisfiesBidiRule(codepoints: readonly number[]): boolean {
  const classes = codepoints.map(bidiClass);
  const first = classes[0]!;
  // Trailing NSMs attach to the preceding character (rules 3 and 6).
  let lastIdx = classes.length - 1;
  while (lastIdx > 0 && classes[lastIdx] === "NSM") lastIdx--;
  const last = classes[lastIdx]!;

  if (first === "R" || first === "AL") {
    // RTL label: rules 2-4.
    const allowed = new Set(["R", "AL", "AN", "EN", "NSM", "N"]);
    if (!classes.every((c) => allowed.has(c))) return false;
    if (!(last === "R" || last === "AL" || last === "AN" || last === "EN")) {
      return false;
    }
    const hasEN = classes.includes("EN");
    const hasAN = classes.includes("AN");
    return !(hasEN && hasAN);
  }
  if (first === "L") {
    // LTR label: rules 5-6.
    const allowed = new Set(["L", "EN", "NSM", "N"]);
    if (!classes.every((c) => allowed.has(c))) return false;
    return last === "L" || last === "EN";
  }
  return false; // rule 1: first character must be L, R, or AL
}

// ---------------------------------------------------------------------------

const LDH_ASCII = /^[a-z0-9-]+$/i;

/**
 * Validate one label; returns its A-label (ACE) octet length, or null when
 * invalid. RFC 5891 §4.2.3.1 hyphen restrictions apply to both forms.
 */
function labelAceLength(label: string): number | null {
  if (label.length === 0) return null;
  if (label.startsWith("-") || label.endsWith("-")) return null;

  // ASCII labels: plain LDH, or a full A-label when ACE-prefixed.
  // eslint-disable-next-line no-control-regex -- explicit ASCII-range test
  if (/^[\x00-\x7f]*$/u.test(label)) {
    if (!LDH_ASCII.test(label)) return null;
    if (label.length > 63) return null;
    if (/^..--/.test(label)) {
      if (!/^xn--/i.test(label)) return null; // reserved LDH label
      if (!isValidALabel(label)) return null;
      // idn-hostname additionally screens the DECODED content's code
      // points (an A-label hiding a DISALLOWED code point is invalid).
      const decoded = decodePunycode(label.slice(4).toLowerCase());
      if (!decoded?.every(allowedUnicodeCp)) return null;
      return label.length;
    }
    return label.length;
  }

  // U-label. RFC 5891 §4.2.3: NFC form required.
  if (label.normalize("NFC") !== label) return null;
  if (/^..--/u.test(label)) return null; // hyphens in positions 3-4

  // eslint-disable-next-line @typescript-eslint/no-misused-spread -- code-point iteration is the IDNA unit
  const codepoints = [...label].map((ch) => ch.codePointAt(0)!);
  if (!codepoints.every(allowedUnicodeCp)) return null;
  // Context rules + leading-mark + exceptions (RFC 5892; shared with the
  // A-label path).
  if (!isValidIdnaLabel(label, codepoints)) return null;

  const ace = encodePunycode(codepoints);
  const aceLength = ace.length + 4; // "xn--" prefix
  if (aceLength > 63) return null;
  // The canonical ACE must decode back (guards encoder edge cases).
  if (decodePunycode(ace) === undefined) return null;
  return aceLength;
}

function isIdnHostname(value: string): boolean {
  if (value.length === 0) return false;
  // IDNA label separators: the ideographic/fullwidth/halfwidth full stops
  // separate labels exactly like ".".
  const labels = value.split(/[.\u3002\uff0e\uff61]/u);
  const decodedLabels: number[][] = [];
  let total = 0;
  for (const label of labels) {
    const aceLength = labelAceLength(label);
    if (aceLength === null) return false;
    total += aceLength;
    // Bidi checking needs the Unicode form: decode A-labels.
    if (/^xn--/i.test(label)) {
      decodedLabels.push(decodePunycode(label.slice(4).toLowerCase()) ?? []);
    } else {
      // eslint-disable-next-line @typescript-eslint/no-misused-spread -- code-point iteration is the IDNA unit
      decodedLabels.push([...label].map((ch) => ch.codePointAt(0)!));
    }
  }
  if (total + labels.length - 1 > 253) return false;

  // RFC 5893 §1.4: a Bidi domain name (any RTL character anywhere) must
  // satisfy the Bidi rule in EVERY label.
  const isBidiName = decodedLabels.some((cps) =>
    cps.some((cp) => {
      const c = bidiClass(cp);
      return c === "R" || c === "AL" || c === "AN";
    }),
  );
  if (isBidiName) {
    return decodedLabels.every(
      (cps) => cps.length === 0 || satisfiesBidiRule(cps),
    );
  }
  return true;
}

export const idnHostname: FormatDefinition = {
  test: (value) => typeof value === "string" && isIdnHostname(value),
};

// ---------------------------------------------------------------------------
// idn-email (RFC 6531): RFC 5321's mailbox grammar with `atext`/`qtextSMTP`
// extended by UTF8-non-ascii — any non-ASCII code point is admitted in the
// local part; the domain side is an idn-hostname (U- or A-labels) or an
// address literal.

const ATEXT_ASCII = /^[A-Za-z0-9!#$%&'*+\-/=?^_`{|}~]$/;

const isExtendedAtext = (ch: string): boolean => {
  const cp = ch.codePointAt(0)!;
  // A lone surrogate is not a Unicode scalar value — UTF8-non-ascii can
  // never encode it (RFC 3629 forbids surrogate code points in UTF-8).
  if (cp >= 0xd800 && cp <= 0xdfff && ch.length === 1) return false;
  return ATEXT_ASCII.test(ch) || cp >= 0x80;
};

function isIdnDotString(local: string): boolean {
  if (local.length === 0) return false;
  const atoms = local.split(".");
  return atoms.every(
    (atom) =>
      // eslint-disable-next-line @typescript-eslint/no-misused-spread -- code-point iteration
      atom.length > 0 && [...atom].every(isExtendedAtext),
  );
}

function isIdnQuotedString(local: string): boolean {
  if (local.length < 2 || !local.startsWith('"') || !local.endsWith('"'))
    return false;
  const body = local.slice(1, -1);
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]!;
    if (ch === "\\") {
      // quoted-pairSMTP: "\" + printable ASCII (RFC 6531 leaves this rule).
      const next = body.charCodeAt(i + 1);
      if (Number.isNaN(next) || next < 32 || next > 126) return false;
      i++;
      continue;
    }
    const cp = ch.codePointAt(0)!;
    // qtextSMTP (32-126 minus '"' and "\") or UTF8-non-ascii.
    if (cp >= 0x80) continue;
    if (cp < 32 || cp > 126 || ch === '"') return false;
  }
  return true;
}

// Address literals ([IPv4] / [IPv6:...]) are pure ASCII plumbing shared
// with `email`; the idn-email suite exercises hostname domains, and a
// literal domain simply defers to the same bracket grammar via the plain
// email rules embedded here.
const IPV4_LITERAL =
  /^(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])(\.(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])){3}$/;

function isIdnEmail(value: string): boolean {
  let local: string;
  let domain: string;
  if (value.startsWith('"')) {
    let i = 1;
    while (i < value.length && value[i] !== '"') {
      i += value[i] === "\\" ? 2 : 1;
    }
    if (i >= value.length || value[i + 1] !== "@") return false;
    local = value.slice(0, i + 1);
    domain = value.slice(i + 2);
    if (!isIdnQuotedString(local)) return false;
  } else {
    const at = value.lastIndexOf("@");
    if (at === -1) return false;
    local = value.slice(0, at);
    domain = value.slice(at + 1);
    if (!isIdnDotString(local)) return false;
  }
  if (domain.startsWith("[") && domain.endsWith("]")) {
    const inner = domain.slice(1, -1);
    return IPV4_LITERAL.test(inner);
  }
  return isIdnHostname(domain);
}

export const idnEmail: FormatDefinition = {
  test: (value) => typeof value === "string" && isIdnEmail(value),
};
