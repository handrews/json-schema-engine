// @jse/formats: format implementations for the format-assertion vocabulary
// and the assertFormats configuration (M7). Implemented from the defining
// RFCs and the JSON Schema specs only (DESIGN.md D15) — no format/IDNA
// library is consulted.
//
// Every definition is type-scoped through FormatDefinition.types (default
// ["string"]): the KEYWORD treats instances outside a format's types as
// vacuously valid, per spec. The shape deliberately admits non-string
// formats (the OpenAPI format registry's number-scoped entries are a
// planned future table).

import type { FormatDefinition, FormatTable } from "@jse/core";

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

/**
 * The draft 2020-12 format table. 2019-09 shares it; draft-07/06 subsets
 * are derived below. Entries land format-by-format during M7 — each with
 * its optional-suite file green before the next begins.
 */
export const FORMATS_2020_12: FormatTable = {
  uuid,
  ipv6,
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
