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
import {
  certificationStatus,
  type CertificationStatus,
  type CertificationStatusTone,
} from "@/lib/workers";
import {
  CONTRACTED_DRIVER_GENERAL_DOCUMENT_LABELS,
  CONTRACTED_DRIVER_GENERAL_DOCUMENT_TYPES,
} from "@/types/database";
import type {
  CertificationCategory,
  ContractedDriverGeneralDocumentType,
  ContractedDriverIdentityDocumentType,
  ContractedDriverObservationOutcome,
  ContractedDriverObservationType,
  ContractedDriverSiteAccess,
  Database,
} from "@/types/database";

export type ContractedDriverRow = Database["public"]["Tables"]["contracted_driver"]["Row"];
export type ContractedDriverCertificationRow =
  Database["public"]["Tables"]["contracted_driver_certification"]["Row"];
export type ContractedDriverDocumentRow =
  Database["public"]["Tables"]["contracted_driver_document"]["Row"];
export type ContractedDriverObservationRow =
  Database["public"]["Tables"]["contracted_driver_observation"]["Row"];

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
  key: ContractedDriverIdentityDocumentType;
  label: string;
  description: string;
  date: string | null;
  /** Whether the date is an expiry. The CSO and the abstract issue date are not. */
  tracksExpiry: boolean;
  status: CertificationStatus;
  /**
   * The filed scans of this document, newest first. The first is the live one and the
   * rest are history, exactly as a renewed ticket's earlier records are.
   */
  documents: readonly ContractedDriverDocumentRow[];
  /**
   * Set when the newest filed document prints a different date from the one the driver
   * row carries.
   *
   * Shown rather than resolved, because the app cannot know which is right: a carrier's
   * sheet can be mistyped, and so can a hand-entered document date. What it must not do
   * is display a record beside a scan that contradicts it and say nothing -- that reads
   * as an app that has not noticed, which is worse than either version being wrong.
   */
  mismatch: { tracked: string; onDocument: string } | null;
};

/** Which of the document's own dates is the one to compare against the driver row. */
function governingDocumentDate(
  key: ContractedDriverIdentityDocumentType,
  document: ContractedDriverDocumentRow,
): string | null {
  // A licence is identified by when it runs out; an abstract and a CSO by when they were
  // produced. An abstract carries no expiry at all, so comparing one would compare null.
  return key === "license" ? document.expiry_date : document.issued_date;
}

/**
 * Newest first: by whichever date the document type is governed by, then by when the row
 * was created so two documents dated the same day still order predictably.
 */
function sortDocumentsNewestFirst(
  key: ContractedDriverIdentityDocumentType,
  documents: readonly ContractedDriverDocumentRow[],
): ContractedDriverDocumentRow[] {
  return [...documents].sort((a, b) => {
    const left = governingDocumentDate(key, a) ?? "";
    const right = governingDocumentDate(key, b) ?? "";

    if (left !== right) {
      return left < right ? 1 : -1;
    }

    return a.created_at < b.created_at ? 1 : -1;
  });
}

export function contractedDriverIdentityRecords(
  driver: Pick<
    ContractedDriverRow,
    "license_expiry" | "license_province" | "abstract_expiry" | "abstract_issued" | "cso_completed"
  >,
  now = new Date(),
  // Third rather than second so every existing caller and test keeps working unchanged.
  // A caller that only needs the status -- the roster, which shows a light per driver --
  // passes nothing and gets exactly what it got before.
  documents: readonly ContractedDriverDocumentRow[] = [],
): ContractedDriverIdentityRecord[] {
  const records: Omit<ContractedDriverIdentityRecord, "documents" | "mismatch">[] = [
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

  const filed = records.map((record) => {
    const forKey = sortDocumentsNewestFirst(
      record.key,
      documents.filter((document) => document.doc_type === record.key),
    );
    const newest = forKey[0];
    const onDocument = newest ? governingDocumentDate(record.key, newest) : null;

    // The licence row compares against its expiry; the abstract and CSO rows are keyed
    // off when they were produced, so those compare against the driver's issue dates
    // rather than against whatever the record happens to be displaying.
    const tracked =
      record.key === "license"
        ? driver.license_expiry
        : record.key === "abstract"
          ? driver.abstract_issued
          : driver.cso_completed;

    return {
      ...record,
      documents: forKey,
      mismatch:
        tracked && onDocument && tracked !== onDocument ? { tracked, onDocument } : null,
    };
  });

  // A scan whose driver column is empty would otherwise be invisible: the abstract and
  // CSO rows are only built when the driver carries that date. Surface it rather than
  // filing a document into a row that is never drawn.
  const shown = new Set(filed.map((record) => record.key));

  for (const key of ["abstract", "cso"] as const) {
    const orphaned = documents.filter((document) => document.doc_type === key);

    if (orphaned.length > 0 && !shown.has(key)) {
      filed.push({
        key,
        label: key === "abstract" ? "Commercial driver abstract" : "Common Safety Orientation",
        description: "Filed, but no date is recorded against the driver. Add it below.",
        date: null,
        tracksExpiry: false,
        status: { label: "On file", tone: "neutral" },
        documents: sortDocumentsNewestFirst(key, orphaned),
        mismatch: null,
      });
    }
  }

  return filed;
}

/**
 * One group of a driver's general documents: the ones that pair with no date column.
 *
 * Kept apart from the identity records on purpose. contractedDriverIdentityRecords builds
 * a row per tracked date and hangs the scans off it, and everything downstream reads those
 * rows for a status. A hiring form or a fob photo has no date to track and proves nothing,
 * so putting it through the same shape would lend it a status vocabulary it has no right
 * to: an "On file" tick beside a licence expiry reads as compliance.
 */
export type ContractedDriverGeneralDocumentGroup = {
  key: ContractedDriverGeneralDocumentType;
  label: string;
  description: string;
  /** Newest first by whatever date the document carries, then by when it was filed. */
  documents: readonly ContractedDriverDocumentRow[];
};

/**
 * The driver's documents that are not one of the three identity types, grouped by kind.
 *
 * Only groups that hold something are returned: an empty shelf is not worth a heading.
 */
export function contractedDriverGeneralDocuments(
  documents: readonly ContractedDriverDocumentRow[] = [],
): ContractedDriverGeneralDocumentGroup[] {
  return CONTRACTED_DRIVER_GENERAL_DOCUMENT_TYPES.flatMap((key) => {
    const forKey = documents.filter((document) => document.doc_type === key);

    if (forKey.length === 0) {
      return [];
    }

    const sorted = [...forKey].sort((a, b) => {
      // No governing date here, so whichever date the document carries orders it, and the
      // day it was filed breaks the tie.
      const left = a.expiry_date ?? a.issued_date ?? "";
      const right = b.expiry_date ?? b.issued_date ?? "";

      if (left !== right) {
        return left < right ? 1 : -1;
      }

      return a.created_at < b.created_at ? 1 : -1;
    });

    return [
      {
        key,
        label: CONTRACTED_DRIVER_GENERAL_DOCUMENT_LABELS[key].label,
        description: CONTRACTED_DRIVER_GENERAL_DOCUMENT_LABELS[key].description,
        documents: sorted,
      },
    ];
  });
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

// --- What a client saw the driver do ----------------------------------------
//
// Audits and evaluations. Read the migration before changing anything here: these are
// HISTORY, not compliance. Nothing in this section may be wired into
// contractedDriverOverallTone, and a newer observation never supersedes an older one --
// that supersession rule belongs to certifications and would erase the record here.

export const CONTRACTED_OBSERVATION_TYPE_LABELS: Record<ContractedDriverObservationType, string> = {
  evaluation: "Evaluations and site access",
  audit: "Observations and audits",
};

export const CONTRACTED_OBSERVATION_TYPE_DESCRIPTIONS: Record<ContractedDriverObservationType, string> = {
  evaluation:
    "A formal assessment by a client of whether the driver may work on their site.",
  audit:
    "Somebody watched a task and wrote it up. It records coaching and good work, and it never counts against the driver's compliance -- though a site observer can and does restrict access from one.",
};

export const CONTRACTED_SITE_ACCESS_LABELS: Record<ContractedDriverSiteAccess, string> = {
  unlimited: "Unlimited access",
  limited: "Limited access",
  suspended: "Access suspended",
};

/**
 * How a site standing reads at a glance.
 *
 * Presentation only, like observationBadge. Limited access is amber rather than red
 * because it is a real working arrangement -- the driver can still load, under
 * supervision -- and colouring it as a failure would misdescribe it.
 */
export const CONTRACTED_SITE_ACCESS_TONES: Record<ContractedDriverSiteAccess, CertificationStatusTone> = {
  unlimited: "success",
  limited: "warning",
  suspended: "danger",
};

/**
 * How one observation reads.
 *
 * Called a badge and not a status on purpose. It is presentation: a colour beside a row
 * so the eye finds the write-ups in a long list. It is not a compliance state, nothing
 * aggregates it, and it must never be passed to contractedDriverOverallTone.
 */
function observationBadge(
  type: ContractedDriverObservationType,
  outcome: ContractedDriverObservationOutcome,
): CertificationStatus {
  if (outcome === "failed") {
    return { label: "Not passed", tone: "danger" };
  }

  if (outcome === "deficiencies") {
    // Amber, not red. Something was written up and usually closed on the spot; calling it
    // a deficiency in the compliance sense would be a different and wrong claim.
    return { label: "Deficiencies noted", tone: "warning" };
  }

  return { label: type === "evaluation" ? "Passed" : "Clear", tone: "success" };
}

export type ContractedDriverObservationRecord = {
  id: string;
  type: ContractedDriverObservationType;
  title: string;
  observedOn: string;
  reportedOn: string | null;
  issuingCompany: string | null;
  observer: string | null;
  location: string | null;
  outcome: ContractedDriverObservationOutcome;
  siteAccess: ContractedDriverSiteAccess | null;
  findings: string | null;
  actionTaken: string | null;
  hasProof: boolean;
  attachmentPath: string | null;
  badge: CertificationStatus;
};

/**
 * One driver's observations, most recent work first.
 *
 * Ordered by the day the work was watched rather than by when the report arrived or when
 * the row was created: a report emailed two days late still describes the day it
 * describes, and a batch loaded in one afternoon would otherwise come out in file order.
 */
export function contractedDriverObservations(
  rows: readonly ContractedDriverObservationRow[],
): ContractedDriverObservationRecord[] {
  return [...rows]
    .filter((row) => row.deleted_at === null)
    .sort((left, right) => {
      if (left.observed_on !== right.observed_on) {
        return left.observed_on < right.observed_on ? 1 : -1;
      }

      return left.created_at < right.created_at ? 1 : -1;
    })
    .map((row) => ({
      id: row.id,
      type: row.observation_type,
      title: row.title,
      observedOn: row.observed_on,
      reportedOn: row.reported_on,
      issuingCompany: row.issuing_company,
      observer: row.observer,
      location: row.location,
      outcome: row.outcome,
      siteAccess: row.site_access,
      findings: row.findings,
      actionTaken: row.action_taken,
      hasProof: hasAttachedProof(row.attachment_path),
      attachmentPath: row.attachment_path,
      badge: observationBadge(row.observation_type, row.outcome),
    }));
}

export function groupContractedDriverObservations(
  records: readonly ContractedDriverObservationRecord[],
): Record<ContractedDriverObservationType, ContractedDriverObservationRecord[]> {
  return {
    evaluation: records.filter((record) => record.type === "evaluation"),
    audit: records.filter((record) => record.type === "audit"),
  };
}

export type ContractedDriverSiteStanding = {
  company: string;
  access: ContractedDriverSiteAccess;
  /** The day the evaluation that set this standing was carried out. */
  since: string;
  title: string;
  observationId: string;
  /**
   * Observations at the same company written up AFTER the report that set the standing.
   *
   * Shown as a caveat rather than folded into the standing. A write-up that says nothing
   * about access has not changed it -- but reading "unlimited since June" with no hint
   * that there is a deficiency from August would be the app telling half the story.
   */
  deficienciesSince: number;
  latestDeficiencyOn: string | null;
};

/**
 * Where the driver stands at each client site today.
 *
 * The newest observation per issuing company that STATES an access level, whatever kind
 * of report it was. This is the question the company was answering out of a mailbox
 * before this table existed: one client's March email said a driver had to redo his
 * training loads, and a June evaluation restored his unlimited access.
 *
 * Not evaluations only, and that was a correction. The first batch held a PPE audit that
 * limited a driver to 8am-4pm on the spot, three days after an evaluation had granted him
 * unlimited access. Reading only evaluations would have shown "unlimited" beside a report
 * saying otherwise. See migration 20260829200000.
 *
 * Only the newest speaks, because that is genuinely how site access works: unlike a
 * ticket, an older decision is not history that still counts, it is a decision that has
 * been replaced.
 *
 * Observations with no issuing company are skipped: a standing has to be at somewhere.
 */
export function contractedDriverSiteStandings(
  records: readonly ContractedDriverObservationRecord[],
): ContractedDriverSiteStanding[] {
  const standings = new Map<string, ContractedDriverSiteStanding>();

  // records arrive newest first, so the first access-stating report seen for a company
  // is its current one.
  for (const record of records) {
    if (!record.issuingCompany || !record.siteAccess) {
      continue;
    }

    const key = record.issuingCompany.trim().toLowerCase();

    if (standings.has(key)) {
      continue;
    }

    standings.set(key, {
      company: record.issuingCompany,
      access: record.siteAccess,
      since: record.observedOn,
      title: record.title,
      observationId: record.id,
      deficienciesSince: 0,
      latestDeficiencyOn: null,
    });
  }

  for (const record of records) {
    if (record.outcome === "clear" || !record.issuingCompany) {
      continue;
    }

    const standing = standings.get(record.issuingCompany.trim().toLowerCase());

    // Strictly after: the report that set the standing does not count against itself,
    // even when it was the thing that recorded the deficiency -- and one of them was.
    if (!standing || record.observedOn <= standing.since) {
      continue;
    }

    standing.deficienciesSince += 1;
    standing.latestDeficiencyOn =
      standing.latestDeficiencyOn && standing.latestDeficiencyOn > record.observedOn
        ? standing.latestDeficiencyOn
        : record.observedOn;
  }

  return [...standings.values()].sort((left, right) => left.company.localeCompare(right.company));
}
