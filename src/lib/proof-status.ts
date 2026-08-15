// "The document is the proof."
//
// A compliance record carries two independent facts: a DATE, which says when the
// thing expires, and a DOCUMENT, which is the only thing that proves the date is
// real. An auditor asked to see a driver's medical does not accept a row in a
// database; they accept the certificate. So a record holding a date and nothing
// else is not compliant, it is a claim.
//
// Onboarding makes this routine rather than exceptional. Dates get loaded in bulk
// from the client's spreadsheet in one pass and the scans get attached in a second
// pass, which means that between the two passes every record in the system would
// otherwise read green while not one of them could be produced at an audit. This
// module is what stops that: green is gated on the document being attached, and a
// dated record without one reads amber until the scan lands.
//
// Amber, not red, and this is the distinction the whole feature turns on. Red means
// a deficiency: expired, or never filed at all. Amber means we believe the record
// and we cannot yet prove it. Those are different problems with different fixes,
// and collapsing them would either cry wolf during onboarding or hide a genuine
// gap behind a colour that says "in progress".
//
// Pure, so every domain (worker tickets, unit files, driver DQ files) shares one
// definition of "has a document" rather than three near-copies that drift.

/**
 * The attachment shapes the app actually stores.
 *
 * Worker certifications keep a single `attachment_path`; equipment and transport
 * documents keep an `attachment_ids` array. Both are nullable, and an array can
 * hold nulls once a file is removed, so every shape has to be tolerated here
 * rather than at each call site.
 */
export type ProofSource = string | null | undefined | readonly (string | null | undefined)[];

/**
 * Whether an actual document is attached.
 *
 * Whitespace does not count. An empty string in the column reads as "someone
 * cleared this", not as proof, and a record that claims a file it does not have is
 * worse than one that admits it has none.
 */
export function hasAttachedProof(source: ProofSource): boolean {
  if (typeof source === "string") {
    return source.trim().length > 0;
  }

  if (Array.isArray(source)) {
    return (source as readonly (string | null | undefined)[]).some(
      (entry) => typeof entry === "string" && entry.trim().length > 0,
    );
  }

  return false;
}

/**
 * The badge a dated-but-unproven record carries.
 *
 * Deliberately not "Unverified", which reads as a judgement on the person who
 * entered it. "No document" states the fact and implies the fix.
 */
export const AWAITING_PROOF_LABEL = "No document";

export const AWAITING_PROOF_DESCRIPTION =
  "The date is on file but the document itself has not been uploaded, so there is nothing to show an auditor.";

/** Amber. Attention, not failure. See the note at the top of this file. */
export const AWAITING_PROOF_CLASS = "border-[var(--warning)] bg-amber-50 text-[var(--warning)]";

/** Where a record awaiting its document lives, for the one chase list that spans all three. */
export type ProofSubject = "worker" | "unit" | "driver";

export type ProofGap = {
  subject: ProofSubject;
  /** The person or unit the record belongs to, as it reads on screen. */
  subjectName: string;
  /** The record itself: "Medical fitness verification", "CVIP inspection", "H2S Alive". */
  label: string;
  /** Null when the record tracks no expiry, which is common for DQ file slots. */
  expiryDate: string | null;
  /** Deep link straight to the place the document gets attached. */
  href: string;
};

/**
 * Chase order: soonest expiry first, because an unproven record that lapses next
 * week is the one that will be asked for. Records with no expiry sort last, then
 * alphabetically so the list is stable between loads.
 */
export function sortProofGaps(gaps: readonly ProofGap[]): ProofGap[] {
  return [...gaps].sort(
    (left, right) =>
      (left.expiryDate ?? "9999-12-31").localeCompare(right.expiryDate ?? "9999-12-31") ||
      left.subjectName.localeCompare(right.subjectName) ||
      left.label.localeCompare(right.label),
  );
}
