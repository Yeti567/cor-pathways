import type { Database, Json } from "@/types/database";
import type { OfflineFormSummary } from "./form-model";

export type OfflineCorrectiveActionDraft = {
  assignedTo?: string;
  description: string;
  enabled: boolean;
  photo?: {
    capturedAt: string;
    caption?: string;
    dataUrl: string;
    fileName?: string;
    mimeType?: string;
    size?: number;
    type: "photo";
  };
};

export type OfflineCorrectiveActionDrafts = Record<string, OfflineCorrectiveActionDraft>;

export type OfflineEvidencePhoto = {
  capturedAt: string;
  caption?: string;
  dataUrl: string;
  fileName?: string;
  mimeType?: string;
  size?: number;
};

export type OfflineEvidencePhotos = Record<string, OfflineEvidencePhoto>;

type FollowUpInsert = Database["public"]["Tables"]["follow_ups"]["Insert"];

function defaultIdFactory() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `follow-up-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function createOfflineFollowUpPayloads({
  assignedTo,
  correctiveActions,
  createdAt,
  form,
  idFactory = defaultIdFactory,
  submissionId,
  tenantId,
}: {
  assignedTo: string;
  correctiveActions: OfflineCorrectiveActionDrafts;
  createdAt: string;
  form: OfflineFormSummary;
  idFactory?: () => string;
  submissionId: string;
  tenantId: string;
}): FollowUpInsert[] {
  const items = new Map(form.sections.flatMap((section) => section.items).map((item) => [item.id, item]));

  return Object.entries(correctiveActions)
    .flatMap(([actionKey, action]) => {
      if (!action.enabled) {
        return [];
      }

      const separatorIndex = actionKey.indexOf(":");
      const itemId = separatorIndex >= 0 ? actionKey.slice(0, separatorIndex) : actionKey;
      const repeatIndex = separatorIndex >= 0 ? Number(actionKey.slice(separatorIndex + 1)) : null;
      const item = items.get(itemId);

      if (!item?.flaggable) {
        return [];
      }

      const description = (action.description ?? "").trim();
      const repeatLabel = typeof repeatIndex === "number" && Number.isFinite(repeatIndex) ? ` (Entry ${repeatIndex + 1})` : "";
      const photoPath = action.photo?.dataUrl?.startsWith("data:image/") ? action.photo.dataUrl : null;
      const actionAssignedTo = action.assignedTo || assignedTo;

      return [
        {
          assigned_to: actionAssignedTo,
          created_at: createdAt,
          description: description || `Flagged during ${form.name}.`,
          due_at: null,
          form_item_id: item.id,
          id: idFactory(),
          parent_submission_id: submissionId,
          ...(photoPath ? { photo_path: photoPath } : {}),
          status: "open",
          tenant_id: tenantId,
          title: `Corrective action: ${item.label}${repeatLabel}`,
          updated_at: createdAt,
        },
      ];
    });
}

export type InspectionDefectSeverity = "major" | "minor";

export type InspectionDefectFollowUpResult = {
  followUps: FollowUpInsert[];
  // Equipment that hit a major defect and should be taken out of service.
  outOfServiceEquipmentIds: string[];
};

function isPassFailFail(value: Json | undefined): boolean {
  if (value === "fail") {
    return true;
  }

  if (value && typeof value === "object" && !Array.isArray(value)) {
    return (value as Record<string, Json | undefined>).value === "fail";
  }

  return false;
}

// The corrective action's title is the only durable record of the severity the
// worker actually chose: the submission value only says "fail", and the item's
// own tag is just the default that was offered. Built and read through this one
// pair so the compliance module can recover the worker's choice server-side
// without matching on a string literal that lives in two places.
export function inspectionDefectFollowUpTitle(severity: InspectionDefectSeverity, itemLabel: string) {
  return `${severity === "major" ? "Major" : "Minor"} vehicle defect: ${itemLabel}`;
}

export function severityFromInspectionDefectTitle(title: string): InspectionDefectSeverity | null {
  if (title.startsWith("Major vehicle defect:")) {
    return "major";
  }

  if (title.startsWith("Minor vehicle defect:")) {
    return "minor";
  }

  return null;
}

function defectSeverity(settings: Json, maintenanceEnabled: boolean): InspectionDefectSeverity {
  if (settings && typeof settings === "object" && !Array.isArray(settings)) {
    const record = settings as Record<string, Json | undefined>;
    const tagged = record.defect_severity;
    if (tagged === "major") {
      return "major";
    }

    // The maintenance module's own scale (settings.severity: critical, major, minor). Only
    // read when the module is on, so a tenant without it keeps exactly the behaviour it
    // has always had. A critical item keeps the out-of-service behaviour a major defect
    // has; major and minor raise work orders at their own priority instead (the database
    // trigger create_inspection_work_order does that once the action syncs).
    if (maintenanceEnabled && record.severity === "critical") {
      return "major";
    }
  }

  return "minor";
}

// The maintenance module's per-item scale, when the form carries one.
function itemSeverityTag(settings: Json): "critical" | "major" | "minor" | null {
  if (settings && typeof settings === "object" && !Array.isArray(settings)) {
    const value = (settings as Record<string, Json | undefined>).severity;
    if (value === "critical" || value === "major" || value === "minor") {
      return value;
    }
  }

  return null;
}

// Turn failed pass/fail inspection items into corrective actions automatically,
// so a deficiency can never be recorded with no owner. Each action is pinned to
// the inspected unit (equipment_id) and routed to a maintenance owner rather than
// the driver. Only a defect the worker classified as major (NSC Standard 13
// Schedule 1) takes the unit out of service, because the same system can be a
// minor or major defect depending on the actual condition; the item's tag is only
// the default severity offered to the worker. Items the worker already raised a
// manual corrective action for are skipped so we do not double up.
export function createInspectionDefectFollowUps({
  assignedTo,
  chosenSeverities = {},
  createdAt,
  equipmentId,
  excludeItemIds = new Set<string>(),
  form,
  idFactory = defaultIdFactory,
  maintenanceEnabled = false,
  submissionId,
  tenantId,
  values,
}: {
  assignedTo: string | null;
  chosenSeverities?: Record<string, string | undefined>;
  createdAt: string;
  equipmentId: string | null;
  excludeItemIds?: Set<string>;
  form: OfflineFormSummary;
  idFactory?: () => string;
  // The tenant has the maintenance module on. Off (the default) leaves every output
  // exactly as it was before the module existed.
  maintenanceEnabled?: boolean;
  submissionId: string;
  tenantId: string;
  values: Record<string, Json>;
}): InspectionDefectFollowUpResult {
  const followUps: FollowUpInsert[] = [];
  const outOfServiceEquipmentIds = new Set<string>();

  for (const section of form.sections) {
    for (const item of section.items) {
      if (item.fieldType !== "pass_fail_na") {
        continue;
      }

      if (excludeItemIds.has(item.id) || !isPassFailFail(values[item.id])) {
        continue;
      }

      // The worker's explicit choice wins; the Schedule 1 tag is only the default.
      const severity: InspectionDefectSeverity =
        chosenSeverities[item.id] === "major"
          ? "major"
          : chosenSeverities[item.id] === "minor"
            ? "minor"
            : defectSeverity(item.settings, maintenanceEnabled);
      const isMajor = severity === "major";

      if (isMajor && equipmentId) {
        outOfServiceEquipmentIds.add(equipmentId);
      }

      // A municipal form carries its own severity scale; quoting the trucking rule (NSC
      // Schedule 1) on a wheel loader or a playground would be wrong. Without the module,
      // or on a form with no severity, the wording stays exactly as it was.
      const formSeverity = maintenanceEnabled ? itemSeverityTag(item.settings) : null;
      const severityNote = formSeverity
        ? formSeverity === "critical"
          ? " Critical defect; the unit is taken out of service until the repair is verified."
          : ` ${formSeverity === "major" ? "Major" : "Minor"} defect; a work order has been raised for the repair.`
        : isMajor
          ? " Major defect under NSC Schedule 1; the unit is taken out of service until the repair is verified."
          : " Minor defect; repair within the allowed window.";
      // "Heavy equipment pre-use inspection inspection" reads badly; most form names already say it.
      const formLabel = /\binspection$/i.test(form.name.trim()) ? form.name.trim() : `${form.name} inspection`;

      followUps.push({
        assigned_to: assignedTo,
        created_at: createdAt,
        description: `${item.label} failed the ${formLabel}.${severityNote}`,
        due_at: null,
        ...(equipmentId ? { equipment_id: equipmentId } : {}),
        form_item_id: item.id,
        id: idFactory(),
        parent_submission_id: submissionId,
        status: "open",
        tenant_id: tenantId,
        title: inspectionDefectFollowUpTitle(severity, item.label),
        updated_at: createdAt,
      });
    }
  }

  return {
    followUps,
    outOfServiceEquipmentIds: Array.from(outOfServiceEquipmentIds),
  };
}
