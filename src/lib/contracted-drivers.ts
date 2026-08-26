// Contracted drivers: the people who drive for the hired carriers.
//
// Same discipline as contracted-equipment.ts. The ageing rules come from
// src/lib/workers.ts, which is what every employee ticket is already read through, so
// an H2S Alive certificate expiring in three weeks reads identically whether it belongs
// to an employee or to a contractor's driver. What is genuinely different lives here:
// the licence and abstract, which are columns on the driver rather than filed tickets,
// and the split between tickets, client site orientations, and site access badges.

import type { ContractedStorageLocation } from "@/lib/contracted-equipment";
import { hasAttachedProof } from "@/lib/proof-status";
import { certificationStatus, type CertificationStatus } from "@/lib/workers";
import type { CertificationCategory, Database } from "@/types/database";

export type ContractedDriverRow = Database["public"]["Tables"]["contracted_driver"]["Row"];
export type ContractedDriverCertificationRow =
  Database["public"]["Tables"]["contracted_driver_certification"]["Row"];

export const CONTRACTED_DRIVER_CATEGORY_LABELS: Record<CertificationCategory, string> = {
  ticket: "Tickets and certifications",
  orientation: "Client site orientations",
  site_access: "Site access and badges",
};

export const CONTRACTED_DRIVER_CATEGORY_DESCRIPTIONS: Record<CertificationCategory, string> = {
  ticket:
    "Qualifications the driver carries anywhere: H2S Alive, First Aid, TDG, WHMIS, drug and alcohol testing.",
  orientation:
    "One client site's induction. It proves nothing at any other site, so a driver is only short of one if they run to that site.",
  site_access: "Badges, gate PINs and key fobs. Access to a specific facility.",
};

/**
 * Where a driver's ticket scans live. Same bucket and layout as the contracted units;
 * see the storage note in src/lib/contracted-equipment.ts.
 */
export function contractedDriverStorageLocation(input: {
  tenantId: string;
  subcontractorId: string;
  driverId: string;
}): ContractedStorageLocation {
  return {
    tenantId: input.tenantId,
    subcontractorId: input.subcontractorId,
    subjectId: input.driverId,
    scope: "contracted-drivers",
  };
}

/**
 * One licence, abstract, or CSO date rendered the way a filed ticket is.
 *
 * These are columns on the driver rather than rows in the certification table, because
 * every driver has exactly one licence and the sheets treat them as identity rather than
 * as paperwork. Presenting them through the same status vocabulary means the driver file
 * reads as one list instead of two that age by different rules.
 */
export type ContractedDriverIdentityRecord = {
  key: "license" | "abstract" | "cso";
  label: string;
  description: string;
  date: string | null;
  /** Whether the date is an expiry. The CSO and the abstract issue date are not. */
  tracksExpiry: boolean;
  status: CertificationStatus;
};

export function contractedDriverIdentityRecords(
  driver: Pick<
    ContractedDriverRow,
    "license_expiry" | "license_province" | "abstract_expiry" | "abstract_issued" | "cso_completed"
  >,
  now = new Date(),
): ContractedDriverIdentityRecord[] {
  const records: ContractedDriverIdentityRecord[] = [
    {
      key: "license",
      label: driver.license_province
        ? `Driver's licence (${driver.license_province})`
        : "Driver's licence",
      description: "The licence itself. Expiry as printed on the card.",
      date: driver.license_expiry,
      tracksExpiry: true,
      // No proof gating: the licence is a column, so there is no scan slot behind it to
      // be missing. Passing undefined keeps it out of the chase list rather than
      // reporting every driver as unproven.
      status: certificationStatus(driver.license_expiry, now),
    },
  ];

  // Carriers disagree about which abstract date they keep: some record when it expires,
  // some record when it was pulled. Show whichever one this driver actually has, and say
  // which it is. An issue date is not an expiry: an abstract does not lapse, it goes
  // stale, and calling a stale one "Deficiency" would be wrong.
  if (driver.abstract_expiry) {
    records.push({
      key: "abstract",
      label: "Commercial driver abstract",
      description: "Their on-road record. Expiry as tracked on the carrier's sheet.",
      date: driver.abstract_expiry,
      tracksExpiry: true,
      status: certificationStatus(driver.abstract_expiry, now),
    });
  } else if (driver.abstract_issued) {
    records.push({
      key: "abstract",
      label: "Commercial driver abstract (pulled)",
      description: "When the abstract was last pulled. It does not expire, it goes stale.",
      date: driver.abstract_issued,
      tracksExpiry: false,
      status: { label: "On file", tone: "neutral" },
    });
  }

  if (driver.cso_completed) {
    records.push({
      key: "cso",
      label: "Common Safety Orientation",
      description: "Completed. The CSO carries no expiry date.",
      date: driver.cso_completed,
      tracksExpiry: false,
      status: { label: "Completed", tone: "neutral" },
    });
  }

  return records;
}

export type ContractedDriverCertificationStatus = {
  id: string;
  label: string;
  category: CertificationCategory;
  issuedOn: string | null;
  expiresOn: string | null;
  issuingCompany: string | null;
  detail: string | null;
  hasProof: boolean;
  status: CertificationStatus;
  /**
   * Whether every driver is expected to hold this. True only for mandatory tickets;
   * an orientation is never expected, because a driver who does not run to that client's
   * site is not short of anything.
   */
  expected: boolean;
  /**
   * A record of the same kind that a newer one has replaced.
   *
   * History, and nothing more. It is shown so the file explains itself, but it never
   * decides the driver's colour, never counts as a deficiency and never raises a
   * reminder. A ticket renewed three times must read as current, not as three failures.
   */
  superseded: boolean;
};

export type ContractedDriverCertificationInput = ContractedDriverCertificationRow & {
  /** Resolved from the shared certification_types list. */
  typeCategory?: CertificationCategory | null;
  typeName?: string | null;
};

export function contractedDriverCertificationStatuses(
  input: {
    certifications: readonly ContractedDriverCertificationInput[];
    /** Mandatory ticket type ids, from the tenant's shared certification type list. */
    mandatoryTicketTypeIds?: readonly string[];
  },
  now = new Date(),
): ContractedDriverCertificationStatus[] {
  const mandatory = new Set(input.mandatoryTicketTypeIds ?? []);

  const built = input.certifications.map((certification) => {
    const hasProof = hasAttachedProof(certification.attachment_path);
    const category: CertificationCategory = certification.typeCategory ?? "ticket";

    return {
      id: certification.id,
      label: certification.typeName?.trim() || certification.name,
      category,
      issuedOn: certification.issued_on,
      expiresOn: certification.expires_on,
      issuingCompany: certification.issuing_company,
      detail: certification.detail,
      hasProof,
      status: certificationStatus(certification.expires_on, now, hasProof),
      expected:
        category === "ticket" &&
        certification.certification_type_id !== null &&
        mandatory.has(certification.certification_type_id),
      superseded: false,
    };
  });

  // Only the newest record of each kind speaks for the driver; the rest are history.
  //
  // This is the same rule freshestDocumentState applies to a unit's documents, and it is
  // what makes loading a driver's whole renewal history safe. Without it a ticket renewed
  // three times reads as one current certificate and two deficiencies, the driver goes
  // red on a roster they belong at the top of, and the reminder job chases certificates
  // that were replaced years ago.
  //
  // Grouped by the type where there is one, and by the label otherwise, so a record filed
  // as free text still supersedes its own earlier copies. A record with no expiry never
  // displaces one that has a date: an undated acknowledgement says nothing about when the
  // dated certificate beside it runs out.
  const groups = new Map<string, typeof built>();

  for (const status of built) {
    const key = `${status.category}|${status.label.trim().toLowerCase()}`;
    const existing = groups.get(key);

    if (existing) {
      existing.push(status);
    } else {
      groups.set(key, [status]);
    }
  }

  for (const group of groups.values()) {
    if (group.length < 2) {
      continue;
    }

    const ranked = [...group].sort((left, right) => {
      const byExpiry = (right.expiresOn ?? "").localeCompare(left.expiresOn ?? "");

      if (byExpiry !== 0) {
        return byExpiry;
      }

      // Same expiry, or none on either: the one carrying the scan speaks for the record,
      // then the one issued most recently.
      return (
        Number(right.hasProof) - Number(left.hasProof) ||
        (right.issuedOn ?? "").localeCompare(left.issuedOn ?? "")
      );
    });

    for (const status of ranked.slice(1)) {
      status.superseded = true;
      // History carries no colour of its own. Saying "Deficiency" beside a certificate
      // that was replaced is the exact noise this rule exists to remove.
      status.status = { label: "Superseded", tone: "neutral" };
    }
  }

  return built.sort(
    (left, right) =>
      Number(left.superseded) - Number(right.superseded) || left.label.localeCompare(right.label),
  );
}

/** The records that speak for the driver today, with history dropped. */
export function currentContractedDriverCertifications(
  statuses: readonly ContractedDriverCertificationStatus[],
): ContractedDriverCertificationStatus[] {
  return statuses.filter((status) => !status.superseded);
}

export function groupContractedDriverCertifications(
  statuses: readonly ContractedDriverCertificationStatus[],
): Record<CertificationCategory, ContractedDriverCertificationStatus[]> {
  return {
    ticket: statuses.filter((status) => status.category === "ticket"),
    orientation: statuses.filter((status) => status.category === "orientation"),
    site_access: statuses.filter((status) => status.category === "site_access"),
  };
}

/**
 * Mandatory tickets this driver does not hold at all.
 *
 * Only mandatory ones, and only tickets. A driver missing an orientation for a client
 * they never visit is not a finding, and treating it as one would bury the driver who
 * genuinely has no H2S.
 */
export function contractedDriverMissingTickets(input: {
  certifications: readonly ContractedDriverCertificationInput[];
  mandatoryTickets: readonly { id: string; name: string }[];
}): { id: string; name: string }[] {
  const held = new Set(
    input.certifications
      .map((certification) => certification.certification_type_id)
      .filter((id): id is string => id !== null),
  );

  return input.mandatoryTickets.filter((ticket) => !held.has(ticket.id));
}

export type ContractedDriverTone = "danger" | "warning" | "unproven" | "success" | "neutral";

/**
 * How one driver reads at a glance.
 *
 * An expired mandatory ticket or a lapsed licence is red. Anything renewing soon, or a
 * record with a date and no scan, is amber. A missing mandatory ticket is red too: a
 * driver with no H2S on file is not a paperwork problem, they are a driver who should
 * not be at a sour site.
 */
export function contractedDriverOverallTone(input: {
  identity: readonly ContractedDriverIdentityRecord[];
  certifications: readonly ContractedDriverCertificationStatus[];
  missingMandatory: readonly { id: string }[];
}): ContractedDriverTone {
  if (input.missingMandatory.length > 0) {
    return "danger";
  }

  const tones = [
    ...input.identity.map((record) => record.status.tone),
    // Orientations and badges age like everything else and show their own colour on the
    // page, but only tickets and the licence decide the driver's overall reading. A
    // lapsed site orientation stops the driver at one gate, it does not make them unfit
    // to drive, and rolling every client's induction up here would make the roster
    // unreadable on a fleet that runs to a dozen sites.
    ...input.certifications
      .filter((certification) => certification.category === "ticket" && !certification.superseded)
      .map((certification) => certification.status.tone),
  ];

  if (tones.includes("danger")) {
    return "danger";
  }

  if (tones.includes("warning")) {
    return "warning";
  }

  if (tones.includes("unproven")) {
    return "unproven";
  }

  return tones.length > 0 ? "success" : "neutral";
}
