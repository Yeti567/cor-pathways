// Getting a unit to green, one unit at a time.
//
// WHY THIS EXISTS. After a fleet load the dashboard said 141 of 154 units were red, and
// the client had no way to tell what any one unit still needed without opening it and
// reading every row. Fifty-two of those units were one document away from green. A
// person who knows nothing about the app needs to be told "unit 905A needs its CVIP,
// upload it here", see the unit turn green, and be handed the next one. Progress they
// can see is what keeps them going.
//
// SO IT DECIDES NOTHING ITSELF. What a unit needs comes from the same functions the
// dashboard uses (buildVehicleFileStatuses, buildUnitCertificationStatuses,
// stateOfStatus), so this list and the dashboard colour can never disagree. The only
// thing added here is the answer to "what do I do about it", and which document row a
// scan belongs on.

import {
  buildUnitCertificationStatuses,
  buildVehicleFileStatuses,
  expectedCertificationTypesForUnit,
  type UnitCertificationTypeInput,
  type VehicleFileState,
} from "@/lib/equipment";
import { stateOfStatus } from "@/lib/fleet-compliance";
import { hasAttachedProof } from "@/lib/proof-status";

export type FinishUnitRow = {
  id: string;
  unit_number: string;
  name: string | null;
  category: string;
  is_commercial: boolean;
};

export type FinishDocumentRow = {
  id: string;
  equipment_id: string;
  doc_type: string;
  certification_type_id: string | null;
  expiry_date: string | null;
  issued_date: string | null;
  is_active: boolean;
  reminder_lead_days: number | null;
  title: string | null;
  attachment_ids: string[] | null;
};

export type FinishTask = {
  /** Stable per unit: "file:cvip" or "cert:<type id>". */
  key: string;
  kind: "file" | "certification";
  docType: string;
  certificationTypeId: string | null;
  label: string;
  state: VehicleFileState;
  expiryDate: string | null;
  daysUntilExpiry: number | null;
  /**
   * attach: the unit already holds this document as a date with no scan, so the scan
   * goes on that row. new: nothing current is on file (missing, expired, or a renewal),
   * so a new document is filed and the old one stays as history.
   */
  mode: "attach" | "new";
  /** The row a scan is filed onto, for mode attach. */
  documentId: string | null;
  /** Dates to start the form with, for mode attach. */
  issuedDate: string | null;
  /**
   * Nothing to do yet: the current copy is on file and its renewal window has opened.
   * Shown so it is not a surprise, but it does not hold the unit up.
   */
  canWait: boolean;
  /** Only an optional inspection can be marked as not applying. Registration and CVIP never can. */
  waivable: boolean;
};

export type UnitFinish = {
  unit: FinishUnitRow;
  tasks: FinishTask[];
  /** Tasks that can be done now. Zero means the unit is finished for now. */
  open: number;
  /** Red items: missing or expired. */
  red: number;
};

/** The row a status is read from: furthest expiry wins (no expiry is furthest), a scan breaks a tie. */
function governingRow(rows: readonly FinishDocumentRow[]): FinishDocumentRow | null {
  const ranked = [...rows].sort((a, b) => {
    const ae = a.expiry_date ?? "9999-12-31";
    const be = b.expiry_date ?? "9999-12-31";

    if (ae !== be) {
      return be.localeCompare(ae);
    }

    return Number(hasAttachedProof(b.attachment_ids)) - Number(hasAttachedProof(a.attachment_ids));
  });

  return ranked[0] ?? null;
}

function toTask(input: {
  certificationTypeId: string | null;
  daysUntilExpiry: number | null;
  docType: string;
  expiryDate: string | null;
  hasProof: boolean;
  key: string;
  kind: FinishTask["kind"];
  label: string;
  rows: readonly FinishDocumentRow[];
  state: VehicleFileState;
}): FinishTask {
  const row = governingRow(input.rows);
  // A date with no scan behind it, still current or in its window: the scan goes on that row.
  const attach = row !== null && !input.hasProof && (input.state === "awaiting_proof" || input.state === "due_soon");

  return {
    certificationTypeId: input.certificationTypeId,
    canWait: input.state === "due_soon" && input.hasProof,
    daysUntilExpiry: input.daysUntilExpiry,
    docType: input.docType,
    documentId: attach ? row.id : null,
    expiryDate: input.expiryDate,
    issuedDate: attach ? row.issued_date : null,
    key: input.key,
    kind: input.kind,
    label: input.label,
    mode: attach ? "attach" : "new",
    state: input.state,
    waivable: input.kind === "certification",
  };
}

export function buildUnitFinish(
  input: {
    unit: FinishUnitRow;
    documents: readonly FinishDocumentRow[];
    certificationTypes: readonly UnitCertificationTypeInput[];
    /** The unit's ticked list, or null when it has never been set (defaults apply). */
    requiredTypeIds: readonly string[] | null;
    certificationTypeNames?: ReadonlyMap<string, string>;
  },
  now = new Date(),
): UnitFinish {
  const active = input.documents.filter((document) => document.is_active);
  const tasks: FinishTask[] = [];

  if (input.unit.is_commercial) {
    const files = buildVehicleFileStatuses(
      {
        category: input.unit.category,
        documents: active.map((document) => ({
          docType: document.doc_type,
          expiryDate: document.expiry_date,
          hasProof: hasAttachedProof(document.attachment_ids),
          isActive: document.is_active,
          reminderLeadDays: document.reminder_lead_days,
        })),
      },
      now,
    );

    for (const status of files) {
      if (stateOfStatus(status) === "compliant") {
        continue;
      }

      tasks.push(
        toTask({
          ...status,
          certificationTypeId: null,
          key: `file:${status.docType}`,
          kind: "file",
          rows: active.filter((document) => document.doc_type === status.docType),
        }),
      );
    }
  }

  const certifications = buildUnitCertificationStatuses(
    {
      certificationTypeNames: input.certificationTypeNames,
      certificationTypes: expectedCertificationTypesForUnit({
        category: input.unit.category,
        certificationTypes: input.certificationTypes,
        requiredTypeIds: input.requiredTypeIds,
      }),
      documents: active.map((document) => ({
        certificationTypeId: document.certification_type_id,
        docType: document.doc_type,
        expiryDate: document.expiry_date,
        hasProof: hasAttachedProof(document.attachment_ids),
        isActive: document.is_active,
        reminderLeadDays: document.reminder_lead_days,
        title: document.title,
      })),
    },
    now,
  );

  for (const status of certifications) {
    // An inspection the unit is not held to is shown on the unit page, never asked for here.
    if (!status.expected || !status.certificationTypeId || stateOfStatus(status) === "compliant") {
      continue;
    }

    const typeId = status.certificationTypeId;

    tasks.push(
      toTask({
        ...status,
        certificationTypeId: typeId,
        docType: "certification",
        key: `cert:${typeId}`,
        kind: "certification",
        rows: active.filter(
          (document) => document.doc_type === "certification" && document.certification_type_id === typeId,
        ),
      }),
    );
  }

  // Red first, then a scan to file, then a renewal that can wait; by name within each.
  const weight = (task: FinishTask) =>
    task.state === "missing" || task.state === "expired" ? 0 : task.canWait ? 2 : 1;
  tasks.sort((a, b) => weight(a) - weight(b) || a.label.localeCompare(b.label));

  return {
    open: tasks.filter((task) => !task.canWait).length,
    red: tasks.filter((task) => task.state === "missing" || task.state === "expired").length,
    tasks,
    unit: input.unit,
  };
}

function compareUnitNumbers(a: string, b: string) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

/**
 * The order to work through the fleet: the unit closest to finished first.
 *
 * Quick wins first is the point. A unit one upload from green, done, is visible
 * progress; starting on the unit with six things missing is how somebody gives up.
 */
export function finishQueue(units: readonly UnitFinish[]): UnitFinish[] {
  return units
    .filter((unit) => unit.open > 0)
    .sort((a, b) => a.open - b.open || compareUnitNumbers(a.unit.unit_number, b.unit.unit_number));
}

/** The plain sentence under each item. Written for someone who has never seen the app. */
export function describeTask(task: FinishTask, formatDate: (value: string) => string): string {
  const when = task.expiryDate ? formatDate(task.expiryDate) : null;

  switch (task.state) {
    case "missing":
      return "Not on file yet. Upload a copy and put in its dates.";
    case "expired":
      return `Expired${when ? ` on ${when}` : ""}. Upload the new one.`;
    case "awaiting_proof":
      return when
        ? `We have the date (good until ${when}) but not the document. Upload a copy.`
        : "We know about it but don't have the document. Upload a copy.";
    case "due_soon":
      return task.canWait
        ? `On file. It needs renewing by ${when ?? "soon"}; upload the new one when you have it.`
        : `Needs renewing by ${when ?? "soon"}, and we don't have the current one. Upload it.`;
    default:
      return "";
  }
}
