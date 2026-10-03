// Did the reader actually see that, or did it make it up?
//
// A vision model reads a page as a picture and reports what it saw. The way that fails is
// quietly: one wrong character in a VIN, a 3 for an 8 in a date, or a plausible value that
// is not on the page at all. A PDF that carries its own text layer gives an independent
// copy of what the page says, so every identifier and date the reader returned can be
// looked up in it. A value that is not there is not necessarily wrong (a text layer can be
// noisy), but it is exactly the value a person should look at before it is filed, so it
// stops the file being offered as one click.
//
// This is the same idea as the earlier fleet loads, which checked every VIN read off a scan
// against the VIN the fleet already held. Here the check is against the document's own text.
//
// What it cannot do: a scan or a photo has no text layer, so those files are not checked,
// and say so. Pure and unit-tested; the caller supplies the text.

import { normalizeIdentifier } from "@/lib/duplicate-check";
import { normalizeVin } from "./match";
import type { IntakeExtraction } from "./schema";

/** Fewer characters than this is a scan with a stray label, not a document with a text layer. */
export const MIN_TEXT_LAYER_CHARS = 40;

// A normalised identifier shorter than this matches too much text to prove anything.
const MIN_CHECKABLE_LENGTH = 4;

export type GroundingMiss = { field: string; label: string; value: string };

export type GroundingResult = {
  /** False when there was no text layer to check against (a scan, a photo, a failed read). */
  checked: boolean;
  /** Values the reader gave that do not appear in the text. */
  ungrounded: GroundingMiss[];
  /** How many values were actually looked up. Zero means nothing was checkable. */
  lookedUp: number;
};

const MONTH_PATTERNS = [
  "jan(?:uary)?",
  "feb(?:ruary)?",
  "mar(?:ch)?",
  "apr(?:il)?",
  "may",
  "jun(?:e)?",
  "jul(?:y)?",
  "aug(?:ust)?",
  "sep(?:t(?:ember)?)?",
  "oct(?:ober)?",
  "nov(?:ember)?",
  "dec(?:ember)?",
];

const SEP = "[\\s/.\\-,]*";
const BEFORE = "(?<![0-9a-z])";
const AFTER = "(?![0-9])";

/**
 * Every way a date is commonly printed on this paperwork, as patterns.
 *
 * Covers 2027/03/31, 31/03/27, 03/31/2027, 31MAR27, 31 March 2027, March 31st, 2027 and
 * 2027 Mar 31, with or without separators and with or without leading zeros. A date written
 * as 04/05/27 matches both readings of day and month, which is the right answer here: the
 * check proves the digits are on the page, and the reader is already told to return null
 * for a date whose order the page does not settle.
 */
function dateVariants(iso: string): RegExp[] | null {
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (!match) {
    return null;
  }

  const [year, month, day] = [match[1], Number(match[2]), Number(match[3])];
  const mm = `0?${month}`;
  const dd = `0?${day}(?:st|nd|rd|th)?`;
  const yearEither = `(?:${year.slice(0, 2)})?${year.slice(2)}`;
  const monthName = `${MONTH_PATTERNS[month - 1]}\\.?`;

  const sources = [
    `${year}${SEP}${mm}${SEP}${dd}`,
    `${dd}${SEP}${mm}${SEP}${yearEither}`,
    `${mm}${SEP}${dd}${SEP}${yearEither}`,
    `${dd}${SEP}${monthName}${SEP}${yearEither}`,
    `${monthName}${SEP}${dd}${SEP}${yearEither}`,
    `${year}${SEP}${monthName}${SEP}${dd}`,
  ];

  return sources.map((source) => new RegExp(`${BEFORE}${source}${AFTER}`, "i"));
}

/** Whether an ISO date is printed anywhere in the text, in any common layout. */
export function dateAppearsIn(iso: string, text: string): boolean {
  const variants = dateVariants(iso);

  if (!variants) {
    return false;
  }

  const haystack = text.toLowerCase();
  return variants.some((pattern) => pattern.test(haystack));
}

function identifierAppearsIn(value: string, text: string, kind: "vin" | "plain"): boolean | null {
  const normalize = kind === "vin" ? normalizeVin : normalizeIdentifier;
  const needle = normalize(value);

  // Too short to prove anything: a unit number of "14" is in almost any text.
  if (needle.length < MIN_CHECKABLE_LENGTH) {
    return null;
  }

  return normalize(text).includes(needle);
}

export function groundExtraction(
  extraction: Pick<IntakeExtraction, "all_vins" | "expiry_date" | "issued_date" | "license_plate" | "unit_number" | "vin">,
  text: string | null | undefined,
): GroundingResult {
  if (!text || text.trim().length < MIN_TEXT_LAYER_CHARS) {
    return { checked: false, lookedUp: 0, ungrounded: [] };
  }

  const ungrounded: GroundingMiss[] = [];
  let lookedUp = 0;

  function checkIdentifier(field: string, label: string, value: string | null, kind: "vin" | "plain") {
    if (!value) {
      return;
    }

    const found = identifierAppearsIn(value, text as string, kind);

    if (found === null) {
      return;
    }

    lookedUp += 1;

    if (!found) {
      ungrounded.push({ field, label, value });
    }
  }

  function checkDate(field: string, label: string, value: string | null) {
    if (!value) {
      return;
    }

    lookedUp += 1;

    if (!dateAppearsIn(value, text as string)) {
      ungrounded.push({ field, label, value });
    }
  }

  const vins = new Set([extraction.vin, ...extraction.all_vins].filter((vin): vin is string => Boolean(vin)));

  for (const vin of vins) {
    checkIdentifier("vin", "VIN", vin, "vin");
  }

  checkIdentifier("license_plate", "plate", extraction.license_plate, "plain");
  checkIdentifier("unit_number", "unit number", extraction.unit_number, "plain");
  checkDate("issued_date", "issue date", extraction.issued_date);
  checkDate("expiry_date", "expiry date", extraction.expiry_date);

  return { checked: true, lookedUp, ungrounded };
}
