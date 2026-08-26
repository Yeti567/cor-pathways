// Contracted units: the tractors hired carriers run for this company.
//
// This module is deliberately thin. Every rule about what "due soon" means, which
// files a road unit must carry, how several certificates of one type collapse to one
// line, and when green is downgraded to amber for a missing scan, already exists in
// src/lib/equipment.ts and is reused here unchanged. What lives in this file is the
// mapping from the contracted tables onto those shapes, plus the two things that are
// genuinely different: where the scans are stored, and how a whole carrier reads.
//
// Keeping the rules in one place is not tidiness. Two copies of "due soon" drift the
// first time one of them is tuned, and then the contracted board and the fleet board
// disagree about the same date in front of a client.

import {
  buildUnitCertificationStatuses,
  buildVehicleFileStatuses,
  expectedCertificationTypesForUnit,
  statusesAwaitingProof,
  unitCertificationGaps,
  vehicleFileGaps,
  type UnitCertificationStatus,
  type UnitCertificationTypeInput,
  type VehicleFileState,
  type VehicleFileStatus,
} from "@/lib/equipment";
import { sanitizeStorageFilename } from "@/lib/document-control";
import { hasAttachedProof } from "@/lib/proof-status";
import type { Database } from "@/types/database";

export type ContractedEquipmentRow = Database["public"]["Tables"]["contracted_equipment"]["Row"];
export type ContractedEquipmentDocumentRow =
  Database["public"]["Tables"]["contracted_equipment_document"]["Row"];
export type ContractedEquipmentRequirementRow =
  Database["public"]["Tables"]["contracted_equipment_certification_requirement"]["Row"];

/**
 * Storage prefix for one contracted unit's scans.
 *
 * Bucket is subcontractor-documents, not tenant-documents: this is another company's
 * paperwork and it stays out of the bucket holding this company's own confidential
 * material. The carrier id sits second on purpose, so that if the carrier portal is
 * ever switched on, can_access_subcontractor_storage_path matches a carrier to its own
 * folder and to nobody else's. See 20260826000000_contracted_equipment.sql.
 */
export const CONTRACTED_DOCUMENTS_BUCKET = "subcontractor-documents";

export const CONTRACTED_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;

export const CONTRACTED_ATTACHMENT_MIME_TYPES = [
  "application/pdf",
  "image/heic",
  "image/heif",
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export type ContractedStorageLocation = {
  tenantId: string;
  subcontractorId: string;
  /** The unit or driver the file belongs to. */
  subjectId: string;
  scope: "contracted-equipment" | "contracted-drivers";
};

/** Trailing slash included, matching equipmentAttachmentStoragePrefix. */
export function contractedStoragePrefix(input: ContractedStorageLocation) {
  return `${input.tenantId}/${input.subcontractorId}/${input.scope}/${input.subjectId}/`;
}

export function buildContractedStoragePath(
  input: ContractedStorageLocation & { fileName: string; index: number; now?: number },
) {
  const stamp = input.now ?? Date.now();

  return `${contractedStoragePrefix(input)}${stamp}-${input.index}-${sanitizeStorageFilename(input.fileName)}`;
}

/**
 * Keep only the uploaded paths that genuinely belong to this unit or driver.
 *
 * Mirrors parseUploadedEquipmentAttachmentPaths, guards included. The browser uploads
 * straight to storage and posts back only the paths, so these are caller-supplied data:
 * a forged one would file another carrier's certificate onto this record. A path counts
 * only when it sits directly inside this subject's own folder, and a name of nothing but
 * dots is still a traversal segment even though every character in it is allowed.
 */
export function parseUploadedContractedAttachmentPaths(
  values: readonly (FormDataEntryValue | string)[],
  location: ContractedStorageLocation,
) {
  const prefix = contractedStoragePrefix(location);
  const paths = values
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter((value) => value.startsWith(prefix))
    .filter((value) => {
      const fileName = value.slice(prefix.length);

      return /^[\w.-]+$/.test(fileName) && !/^\.+$/.test(fileName);
    });

  return Array.from(new Set(paths));
}

/**
 * One contracted unit's fixed files, in the same shape the fleet uses.
 *
 * A tractor is category 'vehicle', so this returns registration, insurance (the pink
 * card), CVIP and operating permits, with permits optional. That is four of the seven
 * document families their contractor sheet tracks; the other three (belly hose, product
 * hose, bypass valve) are certifications and come back from the call below, because
 * they are per-unit choices rather than files every road unit must carry.
 */
export function contractedUnitFileStatuses(
  input: {
    category: string;
    documents: readonly ContractedEquipmentDocumentRow[];
  },
  now = new Date(),
): VehicleFileStatus[] {
  return buildVehicleFileStatuses(
    {
      category: input.category,
      documents: input.documents.map((document) => ({
        docType: document.doc_type,
        expiryDate: document.expiry_date,
        isActive: document.is_active && document.deleted_at === null,
        reminderLeadDays: document.reminder_lead_days,
        hasProof: hasAttachedProof(document.attachment_ids),
      })),
    },
    now,
  );
}

/**
 * One contracted unit's certifications, held to the same three-case requirement rule
 * as the fleet: a unit outside the road categories is held to nothing, a unit with an
 * explicit tick list is held to exactly that list (an empty list being a real answer
 * that must never refill from the defaults), and a unit with no list falls back to the
 * types marked as applying by default.
 */
export function contractedUnitCertificationStatuses(
  input: {
    category: string;
    certificationTypes: readonly UnitCertificationTypeInput[];
    /** Ticked type ids for this unit, or null when nobody has chosen yet. */
    requiredTypeIds: readonly string[] | null;
    documents: readonly ContractedEquipmentDocumentRow[];
  },
  now = new Date(),
): UnitCertificationStatus[] {
  const expected = expectedCertificationTypesForUnit({
    category: input.category,
    certificationTypes: input.certificationTypes,
    requiredTypeIds: input.requiredTypeIds,
  });

  return buildUnitCertificationStatuses(
    {
      certificationTypes: expected,
      certificationTypeNames: new Map(input.certificationTypes.map((type) => [type.id, type.name])),
      documents: input.documents.map((document) => ({
        certificationTypeId: document.certification_type_id,
        docType: document.doc_type,
        expiryDate: document.expiry_date,
        isActive: document.is_active && document.deleted_at === null,
        reminderLeadDays: document.reminder_lead_days,
        title: document.title,
        hasProof: hasAttachedProof(document.attachment_ids),
      })),
    },
    now,
  );
}

/**
 * How one unit reads at a glance: its worst file or certification.
 *
 * Worst wins, in audit order. Expired outranks missing because a lapsed certificate is
 * a unit that should not be running today, where a missing one may never have applied;
 * both are deficiencies and both are red. Amber below that, green last.
 */
const STATE_SEVERITY: Record<VehicleFileState, number> = {
  expired: 5,
  missing: 4,
  due_soon: 3,
  awaiting_proof: 2,
  on_file: 1,
};

export function contractedUnitOverallState(
  statuses: readonly { state: VehicleFileState; required?: boolean; expected?: boolean }[],
): VehicleFileState {
  let worst: VehicleFileState = "on_file";

  for (const status of statuses) {
    // An optional file nobody has filed is not a deficiency. Permits are optional on a
    // road unit, and counting an unfiled one as missing would paint every tractor red
    // for a document most of them will never need.
    const optional = status.required === false || status.expected === false;

    if (optional && status.state === "missing") {
      continue;
    }

    if (STATE_SEVERITY[status.state] > STATE_SEVERITY[worst]) {
      worst = status.state;
    }
  }

  return worst;
}

export type ContractedUnitSummary = {
  fileStatuses: VehicleFileStatus[];
  certificationStatuses: UnitCertificationStatus[];
  /** Required files and expected certifications that are missing or expired. */
  gaps: (VehicleFileStatus | UnitCertificationStatus)[];
  /** Records with a date and no scan. Unfinished paperwork, not an audit deficiency. */
  awaitingProof: (VehicleFileStatus | UnitCertificationStatus)[];
  overallState: VehicleFileState;
};

export function summarizeContractedUnit(
  input: {
    category: string;
    certificationTypes: readonly UnitCertificationTypeInput[];
    requiredTypeIds: readonly string[] | null;
    documents: readonly ContractedEquipmentDocumentRow[];
  },
  now = new Date(),
): ContractedUnitSummary {
  const fileStatuses = contractedUnitFileStatuses(input, now);
  const certificationStatuses = contractedUnitCertificationStatuses(input, now);

  return {
    fileStatuses,
    certificationStatuses,
    gaps: [...vehicleFileGaps(fileStatuses), ...unitCertificationGaps(certificationStatuses)],
    awaitingProof: [
      ...statusesAwaitingProof(fileStatuses),
      ...statusesAwaitingProof(certificationStatuses),
    ],
    overallState: contractedUnitOverallState([...fileStatuses, ...certificationStatuses]),
  };
}

/**
 * How a whole carrier's fleet reads, for the per-company board.
 *
 * Counts units rather than documents. A carrier running six trucks with four problems
 * on one of them has one truck to fix, and a document count would report it as a worse
 * carrier than one with four trucks each missing something.
 */
export type ContractedFleetRollup = {
  units: number;
  deficient: number;
  awaitingProof: number;
  clean: number;
};

export function rollUpContractedFleet(
  summaries: readonly ContractedUnitSummary[],
): ContractedFleetRollup {
  let deficient = 0;
  let awaitingProof = 0;

  for (const summary of summaries) {
    if (summary.gaps.length > 0) {
      deficient += 1;
      continue;
    }

    if (summary.awaitingProof.length > 0) {
      awaitingProof += 1;
    }
  }

  return {
    units: summaries.length,
    deficient,
    awaitingProof,
    clean: summaries.length - deficient - awaitingProof,
  };
}
