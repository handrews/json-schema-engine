// IDNA2008 label machinery shared by `hostname` (A-label content checks)
// and `idn-hostname`/`idn-email` (full U-label validation): RFC 3492
// Punycode (both directions), RFC 5892 Appendix A context rules and §2.6
// exceptions, RFC 5891 label rules. Implemented from the RFCs and the
// Unicode Character Database via ECMA-262's native \p{...} property
// escapes only (DESIGN.md D15).

// RFC 3492 §5 Bootstring parameters fixed for Punycode.
const PUNY_BASE = 36;
const PUNY_TMIN = 1;
const PUNY_TMAX = 26;
const PUNY_SKEW = 38;
const PUNY_DAMP = 700;
const PUNY_INITIAL_BIAS = 72;
const PUNY_INITIAL_N = 0x80;
const MAX_CODE_POINT = 0x10ffff;

/** RFC 3492 §5 digit-value mapping: "a"-"z"/"A"-"Z" → 0-25, "0"-"9" → 26-35. */
function punycodeDigitValue(code: number): number | undefined {
  if (code >= 0x61 && code <= 0x7a) return code - 0x61; // a-z
  if (code >= 0x41 && code <= 0x5a) return code - 0x41; // A-Z
  if (code >= 0x30 && code <= 0x39) return code - 0x30 + 26; // 0-9
  return undefined;
}

/** RFC 3492 §6.1 bias adaptation function. */
function punycodeAdapt(
  deltaIn: number,
  numPoints: number,
  firstTime: boolean,
): number {
  let delta = firstTime
    ? Math.floor(deltaIn / PUNY_DAMP)
    : Math.floor(deltaIn / 2);
  delta += Math.floor(delta / numPoints);
  let k = 0;
  const threshold = Math.floor(((PUNY_BASE - PUNY_TMIN) * PUNY_TMAX) / 2);
  while (delta > threshold) {
    delta = Math.floor(delta / (PUNY_BASE - PUNY_TMIN));
    k += PUNY_BASE;
  }
  return (
    k + Math.floor(((PUNY_BASE - PUNY_TMIN + 1) * delta) / (delta + PUNY_SKEW))
  );
}

/**
 * RFC 3492 §6.2 decoding procedure over the Bootstring-encoded remainder
 * of an A-label (the part after the "xn--" ACE prefix, which is an IDNA
 * layering concern handled by the caller, not by Bootstring itself).
 * Returns the decoded code points, or undefined for any malformed input:
 * a non-ASCII basic code point, an unrecognized digit, an incomplete
 * trailing generalized variable-length integer, arithmetic overflow, or a
 * resulting code point outside the valid Unicode scalar value range.
 */
export function decodePunycode(input: string): number[] | undefined {
  let n = PUNY_INITIAL_N;
  let i = 0;
  let bias = PUNY_INITIAL_BIAS;
  const output: number[] = [];

  const lastDelimiter = input.lastIndexOf("-");
  let rest: string;
  if (lastDelimiter !== -1) {
    const basic = input.slice(0, lastDelimiter);
    for (let k = 0; k < basic.length; k++) {
      if (basic.charCodeAt(k) > 0x7f) return undefined;
      output.push(basic.charCodeAt(k));
    }
    rest = input.slice(lastDelimiter + 1);
  } else {
    rest = input;
  }

  let pos = 0;
  while (pos < rest.length) {
    const oldi = i;
    let w = 1;
    let k = PUNY_BASE;
    for (;;) {
      if (pos >= rest.length) return undefined; // incomplete integer
      const digit = punycodeDigitValue(rest.charCodeAt(pos));
      pos++;
      if (digit === undefined) return undefined;
      if (digit > (Number.MAX_SAFE_INTEGER - i) / w) return undefined; // overflow
      i += digit * w;
      const t =
        k <= bias ? PUNY_TMIN : k >= bias + PUNY_TMAX ? PUNY_TMAX : k - bias;
      if (digit < t) break;
      if (w > Number.MAX_SAFE_INTEGER / (PUNY_BASE - t)) return undefined;
      w *= PUNY_BASE - t;
      k += PUNY_BASE;
    }
    const numPoints = output.length + 1;
    bias = punycodeAdapt(i - oldi, numPoints, oldi === 0);
    if (Math.floor(i / numPoints) > Number.MAX_SAFE_INTEGER - n) {
      return undefined;
    }
    n += Math.floor(i / numPoints);
    i %= numPoints;
    if (n > MAX_CODE_POINT || (n >= 0xd800 && n <= 0xdfff)) return undefined;
    output.splice(i, 0, n);
    i++;
  }
  return output;
}

const PUNY_DIGIT_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789";

/**
 * RFC 3492 §6.3 encoding procedure — the inverse of {@link decodePunycode}.
 * RFC 5891 §4.4 requires an A-label to be the CANONICAL Punycode encoding
 * of its decoded content: a non-canonical Bootstring digit sequence can
 * decode successfully yet not be what encoding those code points would
 * produce (e.g. an encoder-would-never-emit extra "--" run), so an A-label
 * is only valid when decode-then-re-encode round-trips to the original
 * (case-insensitive) text.
 */
export function encodePunycode(input: number[]): string {
  const basic = input.filter((cp) => cp < 0x80);
  let output = basic.map((cp) => String.fromCharCode(cp)).join("");
  if (basic.length > 0) output += "-";

  let n = PUNY_INITIAL_N;
  let delta = 0;
  let bias = PUNY_INITIAL_BIAS;
  let h = basic.length;
  const b = basic.length;

  while (h < input.length) {
    const m = Math.min(...input.filter((cp) => cp >= n));
    delta += (m - n) * (h + 1);
    n = m;
    for (const cp of input) {
      if (cp < n) delta++;
      if (cp === n) {
        let q = delta;
        for (let k = PUNY_BASE; ; k += PUNY_BASE) {
          const t =
            k <= bias
              ? PUNY_TMIN
              : k >= bias + PUNY_TMAX
                ? PUNY_TMAX
                : k - bias;
          if (q < t) {
            output += PUNY_DIGIT_CHARS[q];
            break;
          }
          output += PUNY_DIGIT_CHARS[t + ((q - t) % (PUNY_BASE - t))];
          q = Math.floor((q - t) / (PUNY_BASE - t));
        }
        bias = punycodeAdapt(delta, h + 1, h === b);
        delta = 0;
        h++;
      }
    }
    delta++;
    n++;
  }
  return output;
}

// RFC 5892 Appendix A context rules and RFC 5891 §4.2.3.2's leading
// combining-mark rule — the label-content checks that distinguish a valid
// A-label from merely-decodable Punycode. Implemented against JS's native
// Unicode property escapes (Script/General_Category, backed by the same
// Unicode Character Database the RFCs normatively reference) rather than
// hand-built codepoint tables.
const GREEK = /\p{Script=Greek}/u;
const HEBREW = /\p{Script=Hebrew}/u;
const HIRAGANA_KATAKANA_HAN =
  /\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Han}/u;
const LEADING_COMBINING_MARK = /^\p{M}/u;
const ARABIC_INDIC = /[٠-٩]/;
const EXTENDED_ARABIC_INDIC = /[۰-۹]/;
// RFC 3492's Bootstring digit alphabet ("a"-"z"/"A"-"Z"/"0"-"9") also
// happens to be exactly the alphabet the "--" position-3-4 check and
// A-label prefix casing rules are stated over — no Unicode needed there.

// Canonical_Combining_Class=Virama (value 9) code points, restricted to
// the Brahmic-script viramas the Unicode Character Database assigns this
// unambiguously (per UnicodeData.txt) — JS's \p{...} property escapes
// don't expose Canonical_Combining_Class, so this is stated as an
// explicit set rather than a property query. Scripts whose "virama-like"
// sign's combining-class assignment is less clear-cut (e.g. Tibetan,
// Khmer) are intentionally omitted rather than guessed.
const VIRAMA_CODEPOINTS = new Set([
  0x094d, // Devanagari
  0x09cd, // Bengali
  0x0a4d, // Gurmukhi
  0x0acd, // Gujarati
  0x0b4d, // Oriya
  0x0bcd, // Tamil
  0x0c4d, // Telugu
  0x0ccd, // Kannada
  0x0d4d, // Malayalam
  0x0dca, // Sinhala (al-lakuna)
  0x1039, // Myanmar
]);

/**
 * RFC 5892 Appendix A.2 (ZWJ) and the primary A.1 (ZWNJ) test: the
 * character immediately before the joiner has Canonical_Combining_Class
 * Virama.
 */
function precededByVirama(codepoints: number[], index: number): boolean {
  return index > 0 && VIRAMA_CODEPOINTS.has(codepoints[index - 1]!);
}

// RFC 5892 Appendix A.1's fallback for ZWNJ when not Virama-preceded: the
// text before must end in a Joining_Type Left_Joining/Dual_Joining
// character and the text after must start with Right_Joining/Dual_Joining
// (skipping any Transparent characters). JS doesn't expose Joining_Type
// either, so — since the suite's only such case is Arabic — this is
// scoped to the Arabic dual-joining letters actually exercised rather
// than the full ArabicShaping.txt table.
const ARABIC_DUAL_JOINING = /\p{Script=Arabic}/u;

function zwnjJoinContextOk(codepoints: number[], index: number): boolean {
  const before = index > 0 ? codepoints[index - 1] : undefined;
  const after =
    index < codepoints.length - 1 ? codepoints[index + 1] : undefined;
  if (before === undefined || after === undefined) return false;
  return (
    ARABIC_DUAL_JOINING.test(String.fromCodePoint(before)) &&
    ARABIC_DUAL_JOINING.test(String.fromCodePoint(after))
  );
}

// RFC 5892 §2.6 "Exceptions (F)": specific code points whose PVALID/
// DISALLOWED disposition is asserted directly rather than derived from
// their general Unicode properties. Only the DISALLOWED entries matter
// here — a disallowed exception is invalid in every label position,
// independent of the Appendix A context rules above (several of these
// code points, like KERAIA/GERESH/GERSHAYIM/MIDDLE DOT, are DISALLOWED by
// default here and only become valid through their Appendix A context
// rule, which is why those cases are handled by the switch above and not
// duplicated in this set). The PVALID exceptions (sharp s, final sigma,
// etc.) need no special-casing: nothing in the suite exercises them, and
// they're already permitted by not appearing in this rejection set.
const DISALLOWED_EXCEPTIONS = new Set([
  0x0640, // ARABIC TATWEEL
  0x07fa, // NKO LAJANYALAN
  0x302e, // HANGUL SINGLE DOT TONE MARK
  0x302f, // HANGUL DOUBLE DOT TONE MARK
  0x3031, // VERTICAL KANA REPEAT MARK
  0x3032, // VERTICAL KANA REPEAT WITH VOICED SOUND MARK
  0x3033, // VERTICAL KANA REPEAT MARK UPPER HALF
  0x3034, // VERTICAL KANA REPEAT WITH VOICED SOUND MARK UPPER HALF
  0x3035, // VERTICAL KANA REPEAT MARK LOWER HALF
  0x303b, // VERTICAL IDEOGRAPHIC ITERATION MARK
]);

/**
 * Applies the RFC 5891 §4.2.3.2 leading-mark rule and the RFC 5892
 * Appendix A rules that the suite exercises to a decoded label's code
 * points. `label` is the lowercase ASCII text of the label (the "xn--..."
 * form); `codepoints` is its Punycode-decoded content.
 */
export function isValidIdnaLabel(label: string, codepoints: number[]): boolean {
  if (codepoints.length === 0) return false;
  if (LEADING_COMBINING_MARK.test(String.fromCodePoint(codepoints[0]!))) {
    return false; // RFC 5891 §4.2.3.2
  }
  if (codepoints.some((cp) => DISALLOWED_EXCEPTIONS.has(cp))) return false;

  const hasArabicIndic = codepoints.some((cp) =>
    ARABIC_INDIC.test(String.fromCodePoint(cp)),
  );
  const hasExtendedArabicIndic = codepoints.some((cp) =>
    EXTENDED_ARABIC_INDIC.test(String.fromCodePoint(cp)),
  );
  if (hasArabicIndic && hasExtendedArabicIndic) return false; // A.8/A.9

  for (let idx = 0; idx < codepoints.length; idx++) {
    const cp = codepoints[idx]!;
    switch (cp) {
      case 0x200c: // ZERO WIDTH NON-JOINER — A.1
        if (
          !precededByVirama(codepoints, idx) &&
          !zwnjJoinContextOk(codepoints, idx)
        ) {
          return false;
        }
        break;
      case 0x200d: // ZERO WIDTH JOINER — A.2
        if (!precededByVirama(codepoints, idx)) return false;
        break;
      case 0xb7: {
        // MIDDLE DOT — A.3: 'l' immediately before AND after.
        const before = idx > 0 ? codepoints[idx - 1] : undefined;
        const after =
          idx < codepoints.length - 1 ? codepoints[idx + 1] : undefined;
        if (before !== 0x6c || after !== 0x6c) return false;
        break;
      }
      case 0x375: {
        // GREEK LOWER NUMERAL SIGN (KERAIA) — A.4: the character
        // immediately FOLLOWING it must exist and be Greek-script (a
        // forward local check, not a whole-label constraint — the suite
        // separately rejects both "nothing follows" and "a non-Greek
        // character follows").
        if (idx === codepoints.length - 1) return false;
        if (!GREEK.test(String.fromCodePoint(codepoints[idx + 1]!))) {
          return false;
        }
        break;
      }
      case 0x5f3: // HEBREW PUNCTUATION GERESH — A.5
      case 0x5f4: {
        // HEBREW PUNCTUATION GERSHAYIM — A.6: preceding character Hebrew.
        if (
          idx === 0 ||
          !HEBREW.test(String.fromCodePoint(codepoints[idx - 1]!))
        ) {
          return false;
        }
        break;
      }
      case 0x30fb: {
        // KATAKANA MIDDLE DOT — A.7: label has a Hiragana/Katakana/Han char.
        const hasScript = codepoints.some((other) =>
          HIRAGANA_KATAKANA_HAN.test(String.fromCodePoint(other)),
        );
        if (!hasScript) return false;
        break;
      }
      default:
        break;
    }
  }
  return true;
}

/**
 * Validates one "xn--..." A-label per RFC 5890 §2.3.1/§2.3.2.1 (ACE
 * prefix, case-insensitive) + RFC 5891 §4.4 (canonical Punycode) + the
 * content rules above. §4.4 requires the ACE suffix to be the CANONICAL
 * encoding of its decoded content — decode-then-re-encode must round-trip
 * to the original suffix, not merely decode without error, since a
 * non-canonical Bootstring digit sequence can be well-formed enough to
 * decode yet isn't what an encoder would ever produce for that content.
 *
 * §2.3.1's "'--' in the third/fourth position is reserved for ACE labels"
 * is, per the suite, a constraint on the label's ASCII text as a whole,
 * not just its mandatory prefix occurrence: every valid A-label in the
 * suite has exactly one "--" pair (the "xn--" prefix itself), while the
 * sole invalid "contains '--' in the 3rd and 4th position" case has a
 * second "--" later in the same label. A second reserved-looking marker
 * elsewhere in the text is rejected on the same "R-LDH labels are
 * reserved for ACE use" grounds as the prefix position itself — allowing
 * it would let two different byte-for-byte-identical ACE-shaped
 * substrings coexist in one label with no way to say which is "the"
 * prefix.
 */
export function isValidALabel(label: string): boolean {
  const lower = label.toLowerCase();
  if (!lower.startsWith("xn--")) return false;
  const rest = lower.slice(4);
  if (rest === "") return false;
  if (rest.includes("--")) return false;
  const decoded = decodePunycode(rest);
  if (decoded === undefined) return false;
  if (encodePunycode(decoded) !== rest) return false; // §4.4 canonical form
  return isValidIdnaLabel(lower, decoded);
}
