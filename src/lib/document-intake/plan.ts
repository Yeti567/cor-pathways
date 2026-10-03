// Given what was read and which unit it matched, what would filing do, and is it safe
// to offer as one click?
//
// "Ready" is a claim about the file, not about the reader's mood: the read was confident
// and legible, exactly one unit fits on a strong identifier, the document is not expired,
// and it lands on a clear target. Anything short of that is "needs review" with the reason
// written out, because a reviewer who is told why decides in seconds and one who is not
// has to re-read the document.
//
// The target rule follows how onboarding actually runs. Dates arrive first in the client's
// spreadsheet as rows with no scan, and the scans arrive second (see proof-status.ts). So
// a document should land on the row that is waiting for it, not add a second row that
// leaves the first one amber. A unit with no such row simply gets a new one; a unit that
// already has a documented row of that type is a renewal, and renewals are left to a
// person in this phase.
//
// Pure and unit-tested.

import type { IntakeExtraction, IntakeDocumentKind } from "./schema";
import type { GroundingResult } from "./ground";
import type { UnitMatch } from "./match";

export type EquipmentDocType = "registration" | "insurance" | "cvip" | "permit" | "certification" | "other";

export type FilingAction = "attach_to_existing" | "create_new" | "none";

export type FilingProposal = {
  action: FilingAction;
  docType: EquipmentDocType | null;
  certificationTypeId: string | null;
  /** The waiting row the scan would land on, when action is attach_to_existing. */
  targetDocumentId: string | null;
  title: string;
  issuedDate: string | null;
  expiryDate: string | null;
};

export type PlanUnitDocument = {
  id: string;
  doc_type: string;
  certification_type_id: string | null;
  title: string;
  issued_date: string | null;
  expiry_date: string | null;
  attachment_ids: readonly (string | null)[] | null;
  is_active: boolean;
};

export type PlanInput = {
  extraction: IntakeExtraction;
  match: UnitMatch;
  unitDocuments: readonly PlanUnitDocument[];
  certificationTypes: readonly { id: string; name: string }[];
  /**
   * The result of looking each value up in the PDF's own text, when it had one. Null or
   * unchecked means there was nothing to check against, which blocks nothing.
   */
  grounding?: GroundingResult | null;
  /** YYYY-MM-DD, passed in so the function stays pure. */
  today: string;
  minConfidence?: number;
};

export type PlanResult = {
  proposal: FilingProposal;
  ready: boolean;
  /** Why a person has to look. Empty when ready. */
  reasons: string[];
  /** Things worth showing that do not block, such as a date the document corrects. */
  notes: string[];
};

export const DEFAULT_MIN_CONFIDENCE = 0.85;

const DOC_TYPE_BY_KIND: Partial<Record<IntakeDocumentKind, EquipmentDocType>> = {
  certification: "certification",
  cvip: "cvip",
  insurance: "insurance",
  other_vehicle: "other",
  permit: "permit",
  registration: "registration",
};

const TITLE_BY_DOC_TYPE: Record<EquipmentDocType, string> = {
  certification: "Certification",
  cvip: "CVIP inspection",
  insurance: "Insurance",
  other: "Other document",
  permit: "Permit",
  registration: "Registration",
};

const REFUSED_KIND_REASON: Partial<Record<IntakeDocumentKind, string>> = {
  driver_personal: "This looks like a driver's personal paperwork. Driver files are not loaded this way yet, so it was left alone.",
  medical: "This looks like a medical record. Those are never read or filed automatically.",
  not_a_vehicle_document: "This does not look like a vehicle document.",
  unreadable: "The file could not be read. Rescan it or file it by hand.",
};

function words(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Which of the tenant's certification types does this document record?
 *
 * Exact name first, then one name containing the other. Returns null on no match or on
 * more than one, because guessing which of "Product hose" and "Load/vent hose" a scan
 * belongs to would silently satisfy the wrong requirement.
 */
export function matchCertificationType(
  name: string | null,
  types: readonly { id: string; name: string }[],
): { id: string; name: string } | null {
  const wanted = words(name ?? "");

  if (!wanted) {
    return null;
  }

  const exact = types.filter((type) => words(type.name) === wanted);

  if (exact.length === 1) {
    return exact[0];
  }

  if (exact.length > 1) {
    return null;
  }

  const partial = types.filter((type) => {
    const candidate = words(type.name);
    return candidate.length >= 4 && (wanted.includes(candidate) || candidate.includes(wanted));
  });

  return partial.length === 1 ? partial[0] : null;
}

function hasProof(document: PlanUnitDocument) {
  return (document.attachment_ids ?? []).some((entry) => typeof entry === "string" && entry.trim().length > 0);
}

/**
 * The expiry of an annual commercial vehicle inspection worked out from its inspection date:
 * the end of the same month, one year on.
 *
 * Alberta prints the inspection date and leaves the expiry to regulation, so a certificate
 * with no expiry on it is not a certificate with no expiry. (Saskatchewan prints both dates,
 * and a printed expiry always wins over this.) Derived here, in code, because the reader is
 * told never to calculate a date.
 */
export function cvipExpiryFromInspection(inspectionDate: string): string | null {
  const match = inspectionDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (!match) {
    return null;
  }

  const year = Number(match[1]) + 1;
  const month = Number(match[2]);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();

  return `${year}-${match[2]}-${String(lastDay).padStart(2, "0")}`;
}

export function planFiling(input: PlanInput): PlanResult {
  const minConfidence = input.minConfidence ?? DEFAULT_MIN_CONFIDENCE;
  const { match } = input;
  const reasons: string[] = [];
  const notes: string[] = [];

  // From here on the expiry is the printed one, or for a CVIP with only an inspection date
  // the one the provincial rule gives. The derived case is always said out loud.
  let extraction = input.extraction;

  if (!extraction.expiry_date && extraction.document_kind === "cvip" && extraction.issued_date) {
    const derived = cvipExpiryFromInspection(extraction.issued_date);

    if (derived) {
      extraction = { ...extraction, expiry_date: derived };
      notes.push(
        `Expiry ${derived} is worked out from the inspection date (a CVIP runs to the end of that month, one year on). It is not printed on the document.`,
      );
    }
  }

  const empty: FilingProposal = {
    action: "none",
    certificationTypeId: null,
    docType: null,
    expiryDate: null,
    issuedDate: null,
    targetDocumentId: null,
    title: "",
  };

  const docType = DOC_TYPE_BY_KIND[extraction.document_kind];

  if (!docType) {
    return {
      notes,
      proposal: empty,
      ready: false,
      reasons: [REFUSED_KIND_REASON[extraction.document_kind] ?? "This file could not be classified."],
    };
  }

  // Why a person has to look, in the order they would check it.
  if (match.status === "none") {
    reasons.push(...match.reasons);
  } else if (match.status === "ambiguous") {
    reasons.push(...match.reasons);
  } else if (match.strength === "weak") {
    reasons.push(...match.reasons);
  }

  if (extraction.all_vins.length > 1) {
    reasons.push(
      `This document lists ${extraction.all_vins.length} vehicles. A fleet certificate covers several units and has to be filed on each by hand.`,
    );
  }

  if (extraction.legibility !== "clear") {
    reasons.push(
      extraction.legibility === "poor"
        ? "The scan is hard to read, so nothing read off it can be relied on."
        : "Part of the scan is hard to read.",
    );
  }

  if (extraction.confidence < minConfidence) {
    reasons.push(`The reader was only ${Math.round(extraction.confidence * 100)}% sure of this one.`);
  }

  reasons.push(...extraction.date_issues);

  // A value the reader gave that the PDF's own text does not contain may be a misread
  // character, and it is exactly the kind of error that still reads green once filed.
  for (const miss of input.grounding?.ungrounded ?? []) {
    reasons.push(`The ${miss.label} the reader gave (${miss.value}) does not appear in the PDF's own text, so it may be misread.`);
  }

  if (extraction.expiry_date && extraction.expiry_date < input.today) {
    reasons.push(`The document expired on ${extraction.expiry_date}.`);
  }

  // Certification type: only a certification names one.
  let certificationTypeId: string | null = null;
  let certificationTypeName: string | null = null;

  if (docType === "certification") {
    const type = matchCertificationType(extraction.certification_name, input.certificationTypes);

    if (type) {
      certificationTypeId = type.id;
      certificationTypeName = type.name;
    } else {
      reasons.push(
        extraction.certification_name
          ? `Could not tell which certification type "${extraction.certification_name}" is.`
          : "This is a certification but it does not say which one.",
      );
    }
  }

  if (docType === "other") {
    reasons.push("Documents that are not a registration, insurance, CVIP, permit or certification are filed by a person.");
  }

  // Without a unit there is nothing to attach to. Stop here with the proposal that the
  // reviewer will complete.
  // A suggested unit still gets a proposal (so the reviewer sees the row it would fill) but
  // never reaches ready: its weak strength has already put the reason on the list.
  if ((match.status !== "matched" && match.status !== "suggested") || !match.equipmentId) {
    return {
      notes,
      proposal: {
        ...empty,
        action: "create_new",
        certificationTypeId,
        docType,
        expiryDate: extraction.expiry_date,
        issuedDate: extraction.issued_date,
        title: certificationTypeName ?? extraction.certification_name ?? TITLE_BY_DOC_TYPE[docType],
      },
      ready: false,
      reasons,
    };
  }

  const sameKind = input.unitDocuments.filter(
    (document) =>
      document.is_active &&
      document.doc_type === docType &&
      (docType !== "certification" || document.certification_type_id === certificationTypeId),
  );
  const waiting = sameKind.filter((document) => !hasProof(document));
  const documented = sameKind.filter(hasProof);

  let proposal: FilingProposal;

  if (waiting.length === 1) {
    const row = waiting[0];
    proposal = {
      action: "attach_to_existing",
      certificationTypeId: row.certification_type_id ?? certificationTypeId,
      docType,
      expiryDate: extraction.expiry_date ?? row.expiry_date,
      issuedDate: extraction.issued_date ?? row.issued_date,
      targetDocumentId: row.id,
      title: row.title,
    };

    // The spreadsheet's placeholder dates are the weaker source; the document in front of
    // us wins. Say so rather than change a date quietly.
    if (extraction.expiry_date && row.expiry_date && extraction.expiry_date !== row.expiry_date) {
      notes.push(`Expiry will change from ${row.expiry_date} (on file) to ${extraction.expiry_date} (on the document).`);
    }

    if (extraction.issued_date && row.issued_date && extraction.issued_date !== row.issued_date) {
      notes.push(`Issue date will change from ${row.issued_date} (on file) to ${extraction.issued_date} (on the document).`);
    }
  } else if (waiting.length > 1) {
    reasons.push(
      `This unit has ${waiting.length} ${TITLE_BY_DOC_TYPE[docType].toLowerCase()} rows waiting for a document. Choose which one this is.`,
    );
    proposal = {
      ...empty,
      action: "create_new",
      certificationTypeId,
      docType,
      expiryDate: extraction.expiry_date,
      issuedDate: extraction.issued_date,
      title: certificationTypeName ?? extraction.certification_name ?? TITLE_BY_DOC_TYPE[docType],
    };
  } else {
    if (documented.length > 0) {
      reasons.push(
        `This unit already has a ${TITLE_BY_DOC_TYPE[docType].toLowerCase()} on file with its document. This may be a renewal, which is left to a person.`,
      );
    }

    if (!extraction.expiry_date && !extraction.issued_date) {
      reasons.push("No dates could be read off this document.");
    } else if (!extraction.expiry_date && docType !== "registration") {
      // Nothing is waiting for this scan, and it prints no due date, so filing it would add a
      // certificate the compliance light can never act on. A registration may legitimately be
      // continuous; nothing else here may.
      reasons.push(
        "This document prints no expiry date and no row on the unit is waiting for it, so adding it would record a document with no due date.",
      );
    }

    proposal = {
      ...empty,
      action: "create_new",
      certificationTypeId,
      docType,
      expiryDate: extraction.expiry_date,
      issuedDate: extraction.issued_date,
      title: certificationTypeName ?? extraction.certification_name ?? TITLE_BY_DOC_TYPE[docType],
    };
  }

  return { notes, proposal, ready: reasons.length === 0, reasons };
}
