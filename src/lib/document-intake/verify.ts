// A second reading, before anything is offered as one click.
//
// The same scan read twice by the same model can come back different. In testing, one
// trailer registration's VIN came back three ways over three runs (a character dropped, two
// characters off, and exactly right), even at temperature 0. A misread usually lands on a
// VIN that matches no unit and is caught as a near miss; the dangerous case is the quiet
// one, where a misread still looks plausible. So a file about to be offered as ready is read
// once more, and it stays ready only if the two readings agree on everything that decides
// where it is filed: the kind of document, the identifiers and both dates.
//
// This costs one extra read, and only for files that would otherwise be one click, which is
// a small share of the pile and the share where being wrong is quietest. PDFs whose values
// were already found in their own text layer skip it: that is a stronger check than a
// second opinion from the same reader.
//
// Pure comparison plus a thin wrapper, both unit-tested.

import { normalizeIdentifier } from "@/lib/duplicate-check";
import { normalizeVin } from "./match";
import type { IntakeExtraction } from "./schema";
import type { ReadOutcome } from "./extract";

function same(a: string | null, b: string | null, normalize: (value: string | null) => string) {
  return normalize(a) === normalize(b);
}

const plain = (value: string | null) => (value ?? "").trim().toLowerCase();

/**
 * What the two readings disagree on, in plain words. Empty means they agree.
 *
 * A value one reading found and the other did not counts as a disagreement: "the plate is
 * 517XKL" and "there is no plate" are not the same reading.
 */
export function readingDisagreements(first: IntakeExtraction, second: IntakeExtraction): string[] {
  const issues: string[] = [];

  if (first.document_kind !== second.document_kind) {
    issues.push("the kind of document");
  }

  if (!same(first.vin, second.vin, normalizeVin)) {
    issues.push("the VIN");
  }

  if (!same(first.license_plate, second.license_plate, normalizeIdentifier)) {
    issues.push("the plate");
  }

  if (!same(first.unit_number, second.unit_number, normalizeIdentifier)) {
    issues.push("the unit number");
  }

  if (!same(first.issued_date, second.issued_date, plain)) {
    issues.push("the issue date");
  }

  if (!same(first.expiry_date, second.expiry_date, plain)) {
    issues.push("the expiry date");
  }

  return issues;
}

export type SecondOpinion = { agrees: true } | { agrees: false; reason: string };

/** Reads the file again and reports whether the two readings agree. Never throws. */
export async function secondOpinion(input: {
  first: IntakeExtraction;
  read: () => Promise<ReadOutcome>;
}): Promise<SecondOpinion> {
  let outcome: ReadOutcome;

  try {
    outcome = await input.read();
  } catch {
    return { agrees: false, reason: "A second reading could not be completed, so the first could not be confirmed." };
  }

  if (!outcome.ok) {
    return { agrees: false, reason: "A second reading could not be completed, so the first could not be confirmed." };
  }

  const issues = readingDisagreements(input.first, outcome.extraction);

  return issues.length === 0
    ? { agrees: true }
    : { agrees: false, reason: `Two readings of this file disagreed on ${issues.join(", ")}.` };
}
