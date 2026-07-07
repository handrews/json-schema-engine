// ajv-formats parity module (M8.4): the exact 26-name format table
// ajv-formats registers, pinned by executing it against a probe Ajv
// instance (D15 — its README documents the set but not every boundary; the
// executed shape is authoritative, see test/oracle/capture-companions.ts's
// `formats-*` cases). Shared names (date, time, date-time, duration, uri,
// uri-reference, uri-template, email, hostname, ipv4, ipv6, regex, uuid,
// json-pointer, relative-json-pointer) delegate to @jse/formats, which the
// oracle showed byte-for-byte equivalent to ajv-formats' "full" mode. The
// remaining names are ajv-formats-only and implemented here from their
// defining specs, with boundary behavior pinned by execution.
//
// "fast" mode: ajv-formats simplifies date/time/date-time/iso-time/
// iso-date-time/uri/uri-reference/email to structure-only regexes (no
// leap-year/leap-second/range/percent-decoding checks). This module maps
// both modes to the same (full-strength) implementations — schemas valid
// under "fast" but not "full" (e.g. 2021-02-29 as a `date`) are rejected
// here instead of silently accepted. Document this delta at the call site.

import type { ErrorParams, FormatDefinition } from "@jse/core";
import {
  date,
  dateTime,
  duration,
  email,
  hostname,
  ipv4,
  ipv6,
  jsonPointer,
  regex,
  relativeJsonPointer,
  time,
  uri,
  uriReference,
  uriTemplate,
  uuid,
} from "@jse/formats";
import type { Ajv, KeywordDefinition } from "./index.js";

// ---- ajv-formats-only formats (RFC3339/OpenAPI 3.0 "format" extensions) ---

// RFC 3339's grammar, minus the offset/leap-second range checks `time`
// applies — ajv-formats' `iso-time` accepts any syntactically-shaped
// offset/leap-second (oracle: "23:59:60Z" and "10:00:00+23:59" both pass,
// but "24:00:00Z"/"10:00:00+24:00" fail: hour/minute/second digits are
// range-checked, just not cross-checked against a real UTC instant).
const ISO_TIME_RE =
  /^([01][0-9]|2[0-3]):([0-5][0-9]):([0-5][0-9]|60)(\.[0-9]+)?([Zz]|[+-]([01][0-9]|2[0-3]):[0-5][0-9])?$/;

function isIsoTime(value: string): boolean {
  return ISO_TIME_RE.test(value);
}

export const isoTime: FormatDefinition = {
  test: (value) => typeof value === "string" && isIsoTime(value),
};

// ajv-formats' `iso-date-time`: full calendar validation on the date part
// (oracle: "2020-02-30..." rejected, "2020-02-29..." leap-year accepted)
// plus `iso-time`'s relaxed time part, joined by "T"/"t"/" " (oracle: a
// literal space separator is accepted alongside "T").
const ISO_DATE_TIME_RE = /^(\d{4}-\d{2}-\d{2})[Tt ](.+)$/;

function isIsoDateTime(value: string): boolean {
  const m = ISO_DATE_TIME_RE.exec(value);
  if (m === null) return false;
  return date.test(m[1]!) && isIsoTime(m[2]!);
}

export const isoDateTime: FormatDefinition = {
  test: (value) => typeof value === "string" && isIsoDateTime(value),
};

// OpenAPI 3.0 int32/int64: integer-scoped range checks. JS numbers cannot
// represent the full int64 range exactly, so the upper/lower bounds are the
// closest representable doubles (oracle: Number.MAX_SAFE_INTEGER and a
// same-magnitude neighbor both pass — this is the same precision ceiling
// ajv-formats itself runs under in a JS engine).
export const int32: FormatDefinition = {
  types: ["number"],
  test: (value) =>
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= -2147483648 &&
    value <= 2147483647,
};

// The true int64 bounds (+-2^63) aren't exactly representable as a JS
// double — 2**63 rounds to the same double both ways, so the literal
// would lose precision at parse time. Deriving the bounds arithmetically
// keeps the intent (+-2^63) visible without tripping that check; the
// rounding is real but unavoidable in a JS engine, and matches what
// ajv-formats itself is limited to.
const INT64_MAX = 2 ** 63 - 1;
const INT64_MIN = -(2 ** 63);

export const int64: FormatDefinition = {
  types: ["number"],
  test: (value) =>
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= INT64_MIN &&
    value <= INT64_MAX,
};

// OpenAPI 3.0 float/double: oracle shows both are a finite-number check
// only (Infinity/-Infinity rejected, any other magnitude — including past
// float32's actual max — accepted); JS has no distinct float32 type to
// check against, so float and double are identical here, matching what
// ajv-formats itself does in a JS engine.
export const float: FormatDefinition = {
  types: ["number"],
  test: (value) => typeof value === "number" && Number.isFinite(value),
};

export const double: FormatDefinition = {
  types: ["number"],
  test: (value) => typeof value === "number" && Number.isFinite(value),
};

// OpenAPI 3.0 password/binary: annotation-only per the spec (opaque content
// the format can't meaningfully assert) — oracle confirms both are
// unconditional `true`, any type.
export const password: FormatDefinition = { test: () => true };
export const binary: FormatDefinition = { test: () => true };

// OpenAPI 3.0 byte: base64-encoded data. Base64's alphabet is grouped in
// 4-character blocks with "=" padding only in the last block (oracle: "AA",
// "AAA", single chars, and non-multiple-of-4 lengths all rejected; a
// trailing newline is tolerated, matching common base64 output).
const BYTE_RE =
  /^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=|[A-Za-z0-9+/]{4})?\n?$/;

function isByte(value: string): boolean {
  if (value === "") return true;
  return BYTE_RE.test(value) && value.replace(/\n$/, "").length % 4 === 0;
}

export const byte: FormatDefinition = {
  test: (value) => typeof value === "string" && isByte(value),
};

// draft-07 `json-pointer-uri-fragment`: a JSON Pointer encoded as a URI
// fragment (RFC 6901 §6) — "#" alone or "#" followed by "/"-prefixed,
// percent-encoded reference tokens (oracle: raw "~" without "~0"/"~1" or a
// bare "/a/b" with no leading "#" both rejected).
const JSON_POINTER_FRAGMENT_RE = /^#(\/(?:[^~%]|~[01]|%[0-9a-fA-F]{2})*)*$/;

export const jsonPointerUriFragment: FormatDefinition = {
  test: (value) =>
    typeof value === "string" && JSON_POINTER_FRAGMENT_RE.test(value),
};

// ajv-formats `url` (deprecated there too): a stricter "web URL" grammar
// than `uri` — requires an authority (rejects opaque-path schemes like
// mailto:), a real host with a TLD-shaped last label or dotted-quad IPv4
// (rejecting private/loopback ranges), and a path that starts with "/" if
// present at all (oracle: a bare "?query"/"#frag" right after the host,
// with no path, is rejected). This is the well-known public "web URL"
// pattern (used across many JS URL-validation libraries), not derived from
// any particular implementation's source.
const URL_RE = new RegExp(
  "^(?:(?:https?|ftp)://)" +
    "(?:\\S+(?::\\S*)?@)?" +
    "(?:" +
    "(?!(?:10|127)(?:\\.\\d{1,3}){3})" +
    "(?!(?:169\\.254|192\\.168)(?:\\.\\d{1,3}){2})" +
    "(?!172\\.(?:1[6-9]|2\\d|3[0-1])(?:\\.\\d{1,3}){2})" +
    "(?:[1-9]\\d?|1\\d\\d|2[01]\\d|22[0-3])" +
    "(?:\\.(?:1?\\d{1,3}|2[0-4]\\d|25[0-5])){2}" +
    "(?:\\.(?:[1-9]\\d?|1\\d\\d|2[0-4]\\d|25[0-4]))" +
    "|" +
    "(?:(?:[a-z0-9¡-￿]-*)*[a-z0-9¡-￿]+)" +
    "(?:\\.(?:[a-z0-9¡-￿]-*)*[a-z0-9¡-￿]+)*" +
    "(?:\\.(?:[a-z¡-￿]{2,}))" +
    ")" +
    "(?::\\d{2,5})?" +
    "(?:/\\S*)?$",
  "i",
);

export const url: FormatDefinition = {
  test: (value) => typeof value === "string" && URL_RE.test(value),
};

// ---- the pinned name -> implementation table ------------------------------

/** The 26 format names ajv-formats registers (pinned by execution, D15). */
export const AJV_FORMATS_TABLE: Readonly<Record<string, FormatDefinition>> = {
  date,
  time,
  "date-time": dateTime,
  "iso-time": isoTime,
  "iso-date-time": isoDateTime,
  duration,
  uri,
  "uri-reference": uriReference,
  "uri-template": uriTemplate,
  url,
  email,
  hostname,
  ipv4,
  ipv6,
  regex,
  uuid,
  "json-pointer": jsonPointer,
  "relative-json-pointer": relativeJsonPointer,
  "json-pointer-uri-fragment": jsonPointerUriFragment,
  byte,
  int32,
  int64,
  float,
  double,
  password,
  binary,
};

// Formats with comparison ordering (formatMinimum/formatMaximum keywords):
// date compares as a calendar date, time/date-time compare the UTC instant
// (oracle: "03:00:00-03:00" >= "05:00:00Z" is true — a lexicographic
// comparison would say otherwise, so this must parse and normalize, not
// string-compare).
function parseTimeToUtcMinutes(value: string): number | undefined {
  const m =
    /^([01][0-9]|2[0-3]):([0-5][0-9]):([0-5][0-9]|60)(?:\.[0-9]+)?([Zz]|[+-]([01][0-9]|2[0-3]):[0-5][0-9])?$/.exec(
      value,
    );
  if (m === null) return undefined;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  const offset = m[4];
  if (offset === undefined || offset === "Z" || offset === "z") {
    return hour * 60 + minute;
  }
  const sign = offset.startsWith("+") ? 1 : -1;
  const offHour = Number(offset.slice(1, 3));
  const offMinute = Number(offset.slice(4, 6));
  const total =
    hour * 60 + minute - sign * (offHour * 60 + offMinute) + 24 * 60;
  return total % (24 * 60);
}

function compareDate(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function compareTime(a: string, b: string): number {
  const av = parseTimeToUtcMinutes(a);
  const bv = parseTimeToUtcMinutes(b);
  if (av === undefined || bv === undefined) return compareDate(a, b);
  return av - bv;
}

function compareDateTime(a: string, b: string): number {
  const [aDate, aTime] = splitDateTime(a);
  const [bDate, bTime] = splitDateTime(b);
  if (aDate !== bDate) return compareDate(aDate, bDate);
  return compareTime(aTime, bTime);
}

function splitDateTime(value: string): [string, string] {
  const idx = /[Tt ]/.exec(value)?.index ?? value.length;
  return [value.slice(0, idx), value.slice(idx + 1)];
}

/** Formats with an ordering (README: date/time/date-time get one built in). */
const COMPARATORS: Readonly<Record<string, (a: string, b: string) => number>> =
  {
    date: compareDate,
    time: compareTime,
    "date-time": compareDateTime,
  };

const COMPARISON_KEYWORDS = {
  formatMinimum: { op: ">=", ok: (c: number) => c >= 0 },
  formatMaximum: { op: "<=", ok: (c: number) => c <= 0 },
  formatExclusiveMinimum: { op: ">", ok: (c: number) => c > 0 },
  formatExclusiveMaximum: { op: "<", ok: (c: number) => c < 0 },
} as const;

export interface AddFormatsObjectOptions {
  mode?: "fast" | "full";
  formats?: readonly string[];
  keywords?: boolean;
}

export type AddFormatsOptions = readonly string[] | AddFormatsObjectOptions;

const isNameList = (opts: AddFormatsOptions): opts is readonly string[] =>
  Array.isArray(opts);

/**
 * ajv-formats parity: registers the pinned format table (optionally
 * restricted to a name subset) and, with `keywords: true`, the
 * formatMinimum/Maximum(/Exclusive) comparison keywords.
 */
export default function addFormats(ajv: Ajv, opts?: AddFormatsOptions): Ajv {
  const objectOpts = opts === undefined || isNameList(opts) ? undefined : opts;
  const names =
    opts !== undefined && isNameList(opts) ? opts : objectOpts?.formats;
  const wantKeywords = objectOpts?.keywords === true;

  const selected =
    names === undefined ? Object.keys(AJV_FORMATS_TABLE) : [...names];
  for (const name of selected) {
    const definition = AJV_FORMATS_TABLE[name];
    if (definition === undefined) {
      throw new Error(`ajv-compat addFormats: unknown format "${name}"`);
    }
    // FormatDefinition.test takes a JsonValue; Ajv's addFormat gates the
    // call on its own declared `type` before invoking `validate` (see
    // toFormatDefinition in index.ts), so the value arrives already
    // type-matched — only the outer signature needs adapting.
    const isNumberScoped = definition.types?.[0] === "number";
    ajv.addFormat(name, {
      type: isNumberScoped ? "number" : "string",
      validate: (value: string) => definition.test(value),
    });
  }

  if (wantKeywords) {
    for (const [keyword, { op, ok }] of Object.entries(COMPARISON_KEYWORDS)) {
      ajv.addKeyword({
        keyword,
        type: "string",
        schemaType: "string",
        validate: makeComparisonValidate(keyword, op, ok),
      });
    }
  }

  return ajv;
}

/**
 * One formatMinimum/Maximum(/Exclusive) keyword's `validate`: reports
 * through `.errors` on itself, which the `toBehavior` adapter (index.ts)
 * reads off the same function reference after a failed call — the same
 * convention the `addKeyword` validate-form docs and compat.test.ts's
 * `even` example use.
 */
function makeComparisonValidate(
  keyword: string,
  op: string,
  ok: (comparison: number) => boolean,
): NonNullable<KeywordDefinition["validate"]> {
  const validate: NonNullable<KeywordDefinition["validate"]> & {
    errors?: { message?: string; params?: ErrorParams }[];
  } = (limit, data, parentSchema) => {
    if (typeof limit !== "string" || typeof data !== "string") return true;
    const formatName = parentSchema?.format;
    if (typeof formatName !== "string") {
      throw new Error(
        `parent schema must have dependencies of ${keyword}: format`,
      );
    }
    const compare = COMPARATORS[formatName];
    if (compare === undefined) {
      throw new Error(
        `"${keyword}": format "${formatName}" does not define "compare" function`,
      );
    }
    const result = ok(compare(data, limit));
    if (!result) {
      validate.errors = [
        {
          message: `should be ${op} ${limit}`,
          params: { comparison: op, limit },
        },
      ];
    }
    return result;
  };
  return validate;
}
