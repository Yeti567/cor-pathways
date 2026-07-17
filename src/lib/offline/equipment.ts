import {
  buildEquipmentActionMetadata,
  buildCompletedScheduledServiceUpdate,
  coerceEquipmentDocumentType,
  coerceEquipmentIntervalMode,
  coerceEquipmentMaintenanceType,
  coerceEquipmentServiceType,
  coerceEquipmentStatus,
  equipmentLocationForStatus,
  getEquipmentDocumentStatus,
  getEquipmentScheduleStatus,
  getEquipmentServiceIndicator,
  type EquipmentDueStatus,
} from "@/lib/equipment";
import type { Database, Json } from "@/types/database";
import { cacheRecord, queueOfflineMutation } from "./sync-queue";
import { createOfflineRecordKey, getOfflineDatabase, type CachedRecord } from "./db";

export type OfflineEquipmentSummary = {
  assignedTo: string | null;
  category: string;
  currentMeter: number | null;
  id: string;
  locationId: string | null;
  make: string | null;
  model: string | null;
  name: string | null;
  status: string;
  tenantId: string;
  trackingMode: string;
  unitNumber: string;
  updatedAt: string;
  vinOrSerial: string | null;
  year: number | null;
};

export type OfflineEquipmentServiceSummary = {
  dueDate: string | null;
  dueMeter: number | null;
  equipmentId: string;
  id: string;
  intervalMode: string;
  isActive: boolean;
  lastCompletedAt: string | null;
  lastCompletedMeter: number | null;
  recurrenceUnit: "meter" | "days" | "months" | null;
  recurrenceValue: number | null;
  serviceType: string;
  tenantId: string;
  title: string;
  updatedAt: string;
};

export type OfflineEquipmentDocumentSummary = {
  attachmentIds: string[];
  attachmentUrls: Record<string, string | null>;
  docType: string;
  equipmentId: string;
  expiryDate: string;
  id: string;
  isActive: boolean;
  reminderLeadDays: number;
  tenantId: string;
  title: string;
  updatedAt: string;
};

export type OfflineEquipmentMaintenanceSummary = {
  attachmentIds: string[];
  attachmentUrls: Record<string, string | null>;
  description: string | null;
  equipmentId: string;
  id: string;
  meterAtService: number | null;
  performedAt: string;
  tenantId: string;
  title: string;
  type: string;
  updatedAt: string;
  vendor: string | null;
};

export type OfflineEquipmentMeterSummary = {
  equipmentId: string;
  id: string;
  recordedAt: string;
  source: string;
  tenantId: string;
  updatedAt: string;
  value: number;
};

export type OfflineEquipmentSubmissionSummary = {
  equipmentId: string;
  formCode: string | null;
  formId: string | null;
  formName: string;
  formType: string | null;
  id: string;
  linkedAt: string;
  linkSource: string;
  locationName: string | null;
  submittedAt: string | null;
  submissionId: string;
  submitterName: string | null;
  tenantId: string;
  updatedAt: string;
};

export type OfflineEquipmentLinkableSubmissionSummary = {
  formCode: string | null;
  formId: string | null;
  formName: string;
  formType: string | null;
  id: string;
  locationName: string | null;
  submittedAt: string | null;
  submitterName: string | null;
  tenantId: string;
  updatedAt: string;
};

export type OfflineEquipmentLocationSummary = {
  code: string | null;
  id: string;
  name: string;
  tenantId: string;
};

export type OfflineEquipmentAssigneeSummary = {
  fullName: string;
  id: string;
  tenantId: string;
};

export type OfflineEquipmentLibrary = {
  assignees: OfflineEquipmentAssigneeSummary[];
  documents: OfflineEquipmentDocumentSummary[];
  equipment: OfflineEquipmentSummary[];
  locations: OfflineEquipmentLocationSummary[];
  maintenance: OfflineEquipmentMaintenanceSummary[];
  meterReadings: OfflineEquipmentMeterSummary[];
  linkedSubmissions: OfflineEquipmentSubmissionSummary[];
  linkableSubmissions: OfflineEquipmentLinkableSubmissionSummary[];
  services: OfflineEquipmentServiceSummary[];
};

type OfflineEquipmentRecord = OfflineEquipmentSummary & { kind: "equipment_metadata" };
type OfflineEquipmentServiceRecord = OfflineEquipmentServiceSummary & { kind: "equipment_service" };
type OfflineEquipmentDocumentRecord = OfflineEquipmentDocumentSummary & { kind: "equipment_document" };
type OfflineEquipmentMaintenanceRecord = OfflineEquipmentMaintenanceSummary & { kind: "equipment_maintenance" };
type OfflineEquipmentMeterRecord = OfflineEquipmentMeterSummary & { kind: "equipment_meter" };
type OfflineEquipmentSubmissionRecord = OfflineEquipmentSubmissionSummary & { kind: "equipment_submission" };
type OfflineEquipmentLinkableSubmissionRecord = OfflineEquipmentLinkableSubmissionSummary & { kind: "equipment_linkable_submission" };
type OfflineEquipmentLocationRecord = OfflineEquipmentLocationSummary & { kind: "equipment_location" };
type OfflineEquipmentAssigneeRecord = OfflineEquipmentAssigneeSummary & { kind: "equipment_assignee" };
type OfflineEquipmentMeterLogInsert = Database["public"]["Tables"]["equipment_meter_log"]["Insert"];
type OfflineEquipmentMaintenanceLogInsert = Database["public"]["Tables"]["equipment_maintenance_log"]["Insert"];
type OfflineEquipmentScheduledServiceUpsert = Database["public"]["Tables"]["equipment_scheduled_service"]["Insert"];
type OfflineEquipmentDocumentInsert = Database["public"]["Tables"]["equipment_document"]["Insert"];
type OfflineEquipmentSubmissionLinkInsert = Database["public"]["Tables"]["equipment_submission_link"]["Insert"];
type OfflineEquipmentUpdate = Database["public"]["Tables"]["equipment"]["Update"];

export type OfflineEquipmentDocumentAttachmentDraft = {
  contentType: string;
  dataUrl: string;
  name: string;
};

function isRecord(value: Json | undefined): value is Record<string, Json | undefined> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: Json | undefined) {
  return typeof value === "string" ? value : "";
}

function nullableStringValue(value: Json | undefined) {
  return typeof value === "string" && value.trim() ? value : null;
}

function numberValue(value: Json | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function attachmentUrlsFromPayload(value: Json | undefined) {
  if (!isRecord(value)) {
    return {};
  }

  const urls: Record<string, string | null> = {};

  for (const [path, url] of Object.entries(value)) {
    if (typeof url === "string" || url === null) {
      urls[path] = url;
    }
  }

  return urls;
}

function integerValue(value: Json | undefined) {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function booleanValue(value: Json | undefined) {
  return typeof value === "boolean" ? value : false;
}

function recurrenceUnitValue(value: Json | undefined) {
  return value === "meter" || value === "days" || value === "months" ? value : null;
}

function equipmentRecordKey(id: string) {
  return `metadata:${id}`;
}

function serviceRecordKey(id: string) {
  return `service:${id}`;
}

function documentRecordKey(id: string) {
  return `document:${id}`;
}

function maintenanceRecordKey(id: string) {
  return `maintenance:${id}`;
}

function meterRecordKey(id: string) {
  return `meter:${id}`;
}

function linkedSubmissionRecordKey(id: string) {
  return `linked-submission:${id}`;
}

function linkableSubmissionRecordKey(id: string) {
  return `equipment-linkable-submission:${id}`;
}

function locationRecordKey(id: string) {
  return `equipment-location:${id}`;
}

function assigneeRecordKey(id: string) {
  return `equipment-assignee:${id}`;
}

function nowIso() {
  return new Date().toISOString();
}

function createOfflineId(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function equipmentFromPayload(payload: Json): OfflineEquipmentSummary | null {
  if (!isRecord(payload) || payload.kind !== "equipment_metadata") {
    return null;
  }

  const id = stringValue(payload.id);
  const tenantId = stringValue(payload.tenantId);
  const unitNumber = stringValue(payload.unitNumber);

  if (!id || !tenantId || !unitNumber) {
    return null;
  }

  return {
    assignedTo: nullableStringValue(payload.assignedTo),
    category: stringValue(payload.category) || "other",
    currentMeter: numberValue(payload.currentMeter),
    id,
    locationId: nullableStringValue(payload.locationId),
    make: nullableStringValue(payload.make),
    model: nullableStringValue(payload.model),
    name: nullableStringValue(payload.name),
    status: stringValue(payload.status) || "active",
    tenantId,
    trackingMode: stringValue(payload.trackingMode) || "mileage",
    unitNumber,
    updatedAt: stringValue(payload.updatedAt),
    vinOrSerial: nullableStringValue(payload.vinOrSerial),
    year: integerValue(payload.year),
  };
}

function serviceFromPayload(payload: Json): OfflineEquipmentServiceSummary | null {
  if (!isRecord(payload) || payload.kind !== "equipment_service") {
    return null;
  }

  const id = stringValue(payload.id);
  const tenantId = stringValue(payload.tenantId);
  const equipmentId = stringValue(payload.equipmentId);
  const title = stringValue(payload.title);

  if (!id || !tenantId || !equipmentId || !title) {
    return null;
  }

  return {
    dueDate: nullableStringValue(payload.dueDate),
    dueMeter: numberValue(payload.dueMeter),
    equipmentId,
    id,
    intervalMode: stringValue(payload.intervalMode) || "by_date",
    isActive: booleanValue(payload.isActive),
    lastCompletedAt: nullableStringValue(payload.lastCompletedAt),
    lastCompletedMeter: numberValue(payload.lastCompletedMeter),
    recurrenceUnit: recurrenceUnitValue(payload.recurrenceUnit),
    recurrenceValue: integerValue(payload.recurrenceValue),
    serviceType: stringValue(payload.serviceType) || "other",
    tenantId,
    title,
    updatedAt: stringValue(payload.updatedAt),
  };
}

function documentFromPayload(payload: Json): OfflineEquipmentDocumentSummary | null {
  if (!isRecord(payload) || payload.kind !== "equipment_document") {
    return null;
  }

  const id = stringValue(payload.id);
  const tenantId = stringValue(payload.tenantId);
  const equipmentId = stringValue(payload.equipmentId);
  const title = stringValue(payload.title);
  const expiryDate = stringValue(payload.expiryDate);

  if (!id || !tenantId || !equipmentId || !title || !expiryDate) {
    return null;
  }

  return {
    attachmentIds: Array.isArray(payload.attachmentIds)
      ? payload.attachmentIds.filter((path): path is string => typeof path === "string")
      : [],
    attachmentUrls: attachmentUrlsFromPayload(payload.attachmentUrls),
    docType: stringValue(payload.docType) || "other",
    equipmentId,
    expiryDate,
    id,
    isActive: booleanValue(payload.isActive),
    reminderLeadDays: integerValue(payload.reminderLeadDays) ?? 30,
    tenantId,
    title,
    updatedAt: stringValue(payload.updatedAt),
  };
}

function maintenanceFromPayload(payload: Json): OfflineEquipmentMaintenanceSummary | null {
  if (!isRecord(payload) || payload.kind !== "equipment_maintenance") {
    return null;
  }

  const id = stringValue(payload.id);
  const tenantId = stringValue(payload.tenantId);
  const equipmentId = stringValue(payload.equipmentId);
  const title = stringValue(payload.title);
  const performedAt = stringValue(payload.performedAt);

  if (!id || !tenantId || !equipmentId || !title || !performedAt) {
    return null;
  }

  return {
    attachmentIds: Array.isArray(payload.attachmentIds)
      ? payload.attachmentIds.filter((path): path is string => typeof path === "string")
      : [],
    attachmentUrls: attachmentUrlsFromPayload(payload.attachmentUrls),
    description: nullableStringValue(payload.description),
    equipmentId,
    id,
    meterAtService: numberValue(payload.meterAtService),
    performedAt,
    tenantId,
    title,
    type: stringValue(payload.type) || "other",
    updatedAt: stringValue(payload.updatedAt),
    vendor: nullableStringValue(payload.vendor),
  };
}

function meterFromPayload(payload: Json): OfflineEquipmentMeterSummary | null {
  if (!isRecord(payload) || payload.kind !== "equipment_meter") {
    return null;
  }

  const id = stringValue(payload.id);
  const tenantId = stringValue(payload.tenantId);
  const equipmentId = stringValue(payload.equipmentId);
  const recordedAt = stringValue(payload.recordedAt);
  const value = numberValue(payload.value);

  if (!id || !tenantId || !equipmentId || !recordedAt || value === null) {
    return null;
  }

  return {
    equipmentId,
    id,
    recordedAt,
    source: stringValue(payload.source) || "manual",
    tenantId,
    updatedAt: stringValue(payload.updatedAt),
    value,
  };
}

function linkedSubmissionFromPayload(payload: Json): OfflineEquipmentSubmissionSummary | null {
  if (!isRecord(payload) || payload.kind !== "equipment_submission") {
    return null;
  }

  const id = stringValue(payload.id);
  const tenantId = stringValue(payload.tenantId);
  const equipmentId = stringValue(payload.equipmentId);
  const submissionId = stringValue(payload.submissionId);
  const linkedAt = stringValue(payload.linkedAt);

  if (!id || !tenantId || !equipmentId || !submissionId || !linkedAt) {
    return null;
  }

  return {
    equipmentId,
    formCode: nullableStringValue(payload.formCode),
    formId: nullableStringValue(payload.formId),
    formName: stringValue(payload.formName) || "Completed form",
    formType: nullableStringValue(payload.formType),
    id,
    linkedAt,
    linkSource: stringValue(payload.linkSource) || "auto",
    locationName: nullableStringValue(payload.locationName),
    submittedAt: nullableStringValue(payload.submittedAt),
    submissionId,
    submitterName: nullableStringValue(payload.submitterName),
    tenantId,
    updatedAt: stringValue(payload.updatedAt),
  };
}

function linkableSubmissionFromPayload(payload: Json): OfflineEquipmentLinkableSubmissionSummary | null {
  if (!isRecord(payload) || payload.kind !== "equipment_linkable_submission") {
    return null;
  }

  const id = stringValue(payload.id);
  const tenantId = stringValue(payload.tenantId);

  if (!id || !tenantId) {
    return null;
  }

  return {
    formCode: nullableStringValue(payload.formCode),
    formId: nullableStringValue(payload.formId),
    formName: stringValue(payload.formName) || "Completed form",
    formType: nullableStringValue(payload.formType),
    id,
    locationName: nullableStringValue(payload.locationName),
    submittedAt: nullableStringValue(payload.submittedAt),
    submitterName: nullableStringValue(payload.submitterName),
    tenantId,
    updatedAt: stringValue(payload.updatedAt),
  };
}

function locationFromPayload(payload: Json): OfflineEquipmentLocationSummary | null {
  if (!isRecord(payload) || payload.kind !== "equipment_location") {
    return null;
  }

  const id = stringValue(payload.id);
  const tenantId = stringValue(payload.tenantId);
  const name = stringValue(payload.name);

  if (!id || !tenantId || !name) {
    return null;
  }

  return {
    code: nullableStringValue(payload.code),
    id,
    name,
    tenantId,
  };
}

function assigneeFromPayload(payload: Json): OfflineEquipmentAssigneeSummary | null {
  if (!isRecord(payload) || payload.kind !== "equipment_assignee") {
    return null;
  }

  const id = stringValue(payload.id);
  const tenantId = stringValue(payload.tenantId);
  const fullName = stringValue(payload.fullName);

  if (!id || !tenantId || !fullName) {
    return null;
  }

  return {
    fullName,
    id,
    tenantId,
  };
}

function mapRecords<T>(records: CachedRecord[], mapper: (payload: Json) => T | null) {
  return records.map((record) => mapper(record.payload)).filter((item): item is T => Boolean(item));
}

export function compareOfflineEquipmentOrder(left: OfflineEquipmentSummary, right: OfflineEquipmentSummary) {
  return left.unitNumber.localeCompare(right.unitNumber, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

export function equipmentStatusRank(status: string) {
  switch (status) {
    case "down":
      return 0;
    case "active":
      return 1;
    case "retired":
      return 2;
    case "sold":
      return 3;
    default:
      return 4;
  }
}

export function compareOfflineEquipmentByAttention(
  left: { equipment: OfflineEquipmentSummary; serviceIndicator: EquipmentDueStatus },
  right: { equipment: OfflineEquipmentSummary; serviceIndicator: EquipmentDueStatus },
) {
  const statusRank = (status: EquipmentDueStatus) => {
    if (status.state === "overdue") {
      return 0;
    }

    if (status.state === "due_soon") {
      return 1;
    }

    return 2;
  };
  const rankDifference = statusRank(left.serviceIndicator) - statusRank(right.serviceIndicator);

  if (rankDifference !== 0) {
    return rankDifference;
  }

  return compareOfflineEquipmentOrder(left.equipment, right.equipment);
}

export function getOfflineEquipmentServiceIndicator(input: {
  documents: OfflineEquipmentDocumentSummary[];
  equipment: OfflineEquipmentSummary;
  services: OfflineEquipmentServiceSummary[];
}, now = new Date()) {
  return getEquipmentServiceIndicator(
    {
      currentMeter: input.equipment.currentMeter,
      documents: input.documents.map((document) => ({
        expiryDate: document.expiryDate,
        isActive: document.isActive,
        reminderLeadDays: document.reminderLeadDays,
      })),
      scheduledServices: input.services.map((service) => ({
        dueDate: service.dueDate,
        dueMeter: service.dueMeter,
        intervalMode: service.intervalMode,
        isActive: service.isActive,
      })),
    },
    now,
  );
}

export function getOfflineEquipmentNextServiceLabel(input: {
  currentMeter: number | null;
  services: OfflineEquipmentServiceSummary[];
}, now = new Date()) {
  const service = input.services
    .filter((candidate) => candidate.isActive)
    .map((candidate) => ({
      service: candidate,
      status: getEquipmentScheduleStatus(
        {
          dueDate: candidate.dueDate,
          dueMeter: candidate.dueMeter,
          intervalMode: candidate.intervalMode,
          isActive: candidate.isActive,
        },
        input.currentMeter,
        now,
      ),
    }))
    .sort((left, right) => {
      if (left.status.state !== right.status.state) {
        return left.status.state === "overdue" ? -1 : right.status.state === "overdue" ? 1 : 0;
      }

      return (left.service.dueDate ?? "9999-12-31").localeCompare(right.service.dueDate ?? "9999-12-31");
    })[0];

  if (!service) {
    return "No service scheduled";
  }

  const status = service.status;

  if (status.daysUntilDue !== null) {
    if (status.daysUntilDue < 0) {
      return `${service.service.title}: ${Math.abs(status.daysUntilDue)} days overdue`;
    }

    if (status.daysUntilDue === 0) {
      return `${service.service.title}: due today`;
    }

    return `${service.service.title}: due in ${status.daysUntilDue} days`;
  }

  if (status.meterRemaining !== null) {
    if (status.meterRemaining <= 0) {
      return `${service.service.title}: meter overdue`;
    }

    return `${service.service.title}: ${status.meterRemaining.toLocaleString("en")} remaining`;
  }

  return service.service.title;
}

export function offlineEquipmentMatchesSearch(input: {
  assigneeName: string;
  equipment: OfflineEquipmentSummary;
  locationName: string;
}, query: string) {
  const terms = query
    .trim()
    .toLowerCase()
    .split(/\s+/g)
    .filter(Boolean);

  if (terms.length === 0) {
    return true;
  }

  const searchText = [
    input.equipment.unitNumber,
    input.equipment.name,
    input.equipment.category,
    input.equipment.make,
    input.equipment.model,
    input.equipment.vinOrSerial,
    input.equipment.status,
    input.locationName,
    input.assigneeName,
  ]
    .filter((value): value is string => Boolean(value?.trim()))
    .join(" ")
    .toLowerCase();

  return terms.every((term) => searchText.includes(term));
}

export function createOfflineEquipmentMeterLogPayload(input: {
  equipment: OfflineEquipmentSummary;
  id?: string;
  recordedAt?: string;
  source?: "manual" | "inspection" | "maintenance";
  userId: string;
  value: number;
}): OfflineEquipmentMeterLogInsert {
  const recordedAt = input.recordedAt ?? nowIso();

  return {
    action_metadata: buildEquipmentActionMetadata({
      action: input.source === "maintenance" ? "equipment.meter.from_maintenance" : "equipment.meter.create",
      actorId: input.userId,
      capturedAt: recordedAt,
      details: {
        value: input.value,
      },
      source: "worker_app",
    }),
    created_at: recordedAt,
    equipment_id: input.equipment.id,
    id: input.id ?? createOfflineId("equipment-meter"),
    recorded_at: recordedAt,
    recorded_by: input.userId,
    source: input.source ?? "manual",
    tenant_id: input.equipment.tenantId,
    updated_at: recordedAt,
    value: input.value,
  };
}

export function createOfflineEquipmentAssignmentUpdatePayload(input: {
  assignedTo?: string | null;
  equipment: OfflineEquipmentSummary;
  locationId?: string | null;
  status: string;
  updatedAt?: string;
  userId?: string;
}): OfflineEquipmentUpdate & { id: string; tenant_id: string } {
  const status = coerceEquipmentStatus(input.status);
  const updatedAt = input.updatedAt ?? nowIso();
  const locationId = equipmentLocationForStatus({
    locationId: input.locationId || null,
    status,
  });

  return {
    action_metadata: buildEquipmentActionMetadata({
      action: "equipment.assignment.update",
      actorId: input.userId,
      capturedAt: updatedAt,
      details: {
        assigned_to: input.assignedTo || null,
        location_id: locationId,
        status,
      },
      source: "worker_app",
    }),
    assigned_to: input.assignedTo || null,
    id: input.equipment.id,
    location_id: locationId,
    status,
    tenant_id: input.equipment.tenantId,
    updated_at: updatedAt,
  };
}

export function createOfflineEquipmentMaintenancePayload(input: {
  attachmentIds?: string[];
  description?: string;
  equipment: OfflineEquipmentSummary;
  id?: string;
  meterAtService?: number | null;
  performedAt?: string;
  title: string;
  type?: string;
  userId: string;
}): OfflineEquipmentMaintenanceLogInsert {
  const now = nowIso();
  const performedAt = input.performedAt ?? now.slice(0, 10);

  return {
    action_metadata: buildEquipmentActionMetadata({
      action: "equipment.maintenance.create",
      actorId: input.userId,
      capturedAt: now,
      details: {
        attachment_count: input.attachmentIds?.length ?? 0,
        meter_at_service: input.meterAtService ?? null,
        type: coerceEquipmentMaintenanceType(input.type ?? "repair"),
      },
      source: "worker_app",
    }),
    attachment_ids: input.attachmentIds ?? [],
    created_at: now,
    created_by: input.userId,
    description: input.description?.trim() || null,
    equipment_id: input.equipment.id,
    id: input.id ?? createOfflineId("equipment-maintenance"),
    meter_at_service: input.meterAtService ?? null,
    performed_at: performedAt,
    performed_by: input.userId,
    tenant_id: input.equipment.tenantId,
    title: input.title.trim(),
    type: coerceEquipmentMaintenanceType(input.type ?? "repair"),
    updated_at: now,
  };
}

export function createOfflineEquipmentDocumentPayload(input: {
  attachmentIds?: string[];
  docType?: string;
  equipment: OfflineEquipmentSummary;
  expiryDate: string;
  id?: string;
  issuedDate?: string | null;
  reminderLeadDays?: number | null;
  title: string;
  userId: string;
}): OfflineEquipmentDocumentInsert {
  const now = nowIso();
  const reminderLeadDays =
    typeof input.reminderLeadDays === "number" && Number.isFinite(input.reminderLeadDays)
      ? Math.max(0, Math.trunc(input.reminderLeadDays))
      : 30;

  return {
    action_metadata: buildEquipmentActionMetadata({
      action: "equipment.document.create",
      actorId: input.userId,
      capturedAt: now,
      details: {
        attachment_count: input.attachmentIds?.length ?? 0,
        doc_type: coerceEquipmentDocumentType(input.docType ?? "other"),
        expiry_date: input.expiryDate,
      },
      source: "worker_app",
    }),
    attachment_ids: input.attachmentIds ?? [],
    created_at: now,
    created_by: input.userId,
    doc_type: coerceEquipmentDocumentType(input.docType ?? "other"),
    equipment_id: input.equipment.id,
    expiry_date: input.expiryDate,
    id: input.id ?? createOfflineId("equipment-document"),
    is_active: true,
    issued_date: input.issuedDate || null,
    reminder_lead_days: reminderLeadDays,
    tenant_id: input.equipment.tenantId,
    title: input.title.trim(),
    updated_at: now,
  };
}

export function documentSummaryFromPayload(payload: OfflineEquipmentDocumentInsert): OfflineEquipmentDocumentSummary | null {
  const id = typeof payload.id === "string" ? payload.id : "";
  const tenantId = typeof payload.tenant_id === "string" ? payload.tenant_id : "";
  const equipmentId = typeof payload.equipment_id === "string" ? payload.equipment_id : "";
  const title = typeof payload.title === "string" ? payload.title : "";
  const expiryDate = typeof payload.expiry_date === "string" ? payload.expiry_date : "";

  if (!id || !tenantId || !equipmentId || !title || !expiryDate) {
    return null;
  }

  return {
    attachmentIds: Array.isArray(payload.attachment_ids)
      ? payload.attachment_ids.filter((path): path is string => typeof path === "string")
      : [],
    attachmentUrls: {},
    docType: typeof payload.doc_type === "string" ? payload.doc_type : "other",
    equipmentId,
    expiryDate,
    id,
    isActive: typeof payload.is_active === "boolean" ? payload.is_active : true,
    reminderLeadDays: typeof payload.reminder_lead_days === "number" ? payload.reminder_lead_days : 30,
    tenantId,
    title,
    updatedAt: typeof payload.updated_at === "string" ? payload.updated_at : new Date(`${expiryDate}T12:00:00`).toISOString(),
  };
}

export function maintenanceSummaryFromPayload(
  payload: OfflineEquipmentMaintenanceLogInsert,
): OfflineEquipmentMaintenanceSummary | null {
  const id = typeof payload.id === "string" ? payload.id : "";
  const tenantId = typeof payload.tenant_id === "string" ? payload.tenant_id : "";
  const equipmentId = typeof payload.equipment_id === "string" ? payload.equipment_id : "";
  const title = typeof payload.title === "string" ? payload.title : "";
  const performedAt = typeof payload.performed_at === "string" ? payload.performed_at : "";

  if (!id || !tenantId || !equipmentId || !title || !performedAt) {
    return null;
  }

  return {
    attachmentIds: Array.isArray(payload.attachment_ids)
      ? payload.attachment_ids.filter((path): path is string => typeof path === "string")
      : [],
    attachmentUrls: {},
    description: typeof payload.description === "string" && payload.description.trim() ? payload.description : null,
    equipmentId,
    id,
    meterAtService: typeof payload.meter_at_service === "number" ? payload.meter_at_service : null,
    performedAt,
    tenantId,
    title,
    type: typeof payload.type === "string" ? payload.type : "other",
    updatedAt: typeof payload.updated_at === "string" ? payload.updated_at : new Date(`${performedAt}T12:00:00`).toISOString(),
    vendor: typeof payload.vendor === "string" && payload.vendor.trim() ? payload.vendor : null,
  };
}

export function meterSummaryFromPayload(payload: OfflineEquipmentMeterLogInsert): OfflineEquipmentMeterSummary | null {
  const id = typeof payload.id === "string" ? payload.id : "";
  const tenantId = typeof payload.tenant_id === "string" ? payload.tenant_id : "";
  const equipmentId = typeof payload.equipment_id === "string" ? payload.equipment_id : "";
  const recordedAt = typeof payload.recorded_at === "string" ? payload.recorded_at : "";
  const value = typeof payload.value === "number" ? payload.value : null;

  if (!id || !tenantId || !equipmentId || !recordedAt || value === null) {
    return null;
  }

  return {
    equipmentId,
    id,
    recordedAt,
    source: typeof payload.source === "string" ? payload.source : "manual",
    tenantId,
    updatedAt: typeof payload.updated_at === "string" ? payload.updated_at : recordedAt,
    value,
  };
}

export function applyOfflineScheduledServiceCompletion(input: {
  completedAt: string;
  completedMeter: number | null;
  service: OfflineEquipmentServiceSummary;
}): OfflineEquipmentServiceSummary {
  const update = buildCompletedScheduledServiceUpdate({
    completedAt: input.completedAt,
    completedMeter: input.completedMeter,
    dueDate: input.service.dueDate,
    dueMeter: input.service.dueMeter,
    recurrenceUnit: input.service.recurrenceUnit,
    recurrenceValue: input.service.recurrenceValue,
  });

  return {
    ...input.service,
    dueDate: update.dueDate,
    dueMeter: update.dueMeter,
    isActive: update.isActive,
    lastCompletedAt: update.lastCompletedAt,
    lastCompletedMeter: update.lastCompletedMeter,
    updatedAt: `${input.completedAt}T12:00:00.000Z`,
  };
}

export function createOfflineScheduledServiceSummary(input: {
  dueDate?: string | null;
  dueMeter?: number | null;
  equipment: OfflineEquipmentSummary;
  id?: string;
  intervalMode: string;
  recurrenceUnit?: "meter" | "days" | "months" | null;
  recurrenceValue?: number | null;
  serviceType?: string;
  title: string;
  updatedAt?: string;
}): OfflineEquipmentServiceSummary {
  const intervalMode = coerceEquipmentIntervalMode(input.intervalMode);
  const recurrenceValue =
    typeof input.recurrenceValue === "number" && Number.isInteger(input.recurrenceValue) && input.recurrenceValue > 0
      ? input.recurrenceValue
      : null;
  const recurrenceUnit =
    input.recurrenceUnit === "meter" || input.recurrenceUnit === "days" || input.recurrenceUnit === "months"
      ? input.recurrenceUnit
      : null;

  return {
    dueDate: intervalMode === "by_meter" ? null : input.dueDate || null,
    dueMeter: intervalMode === "by_date" ? null : input.dueMeter ?? null,
    equipmentId: input.equipment.id,
    id: input.id ?? createOfflineId("equipment-service"),
    intervalMode,
    isActive: true,
    lastCompletedAt: null,
    lastCompletedMeter: null,
    recurrenceUnit,
    recurrenceValue,
    serviceType: coerceEquipmentServiceType(input.serviceType ?? "other"),
    tenantId: input.equipment.tenantId,
    title: input.title.trim(),
    updatedAt: input.updatedAt ?? nowIso(),
  };
}

export function createOfflineScheduledServiceUpsertPayload(
  service: OfflineEquipmentServiceSummary,
  actionMetadata?: Json,
): OfflineEquipmentScheduledServiceUpsert {
  return {
    ...(actionMetadata ? { action_metadata: actionMetadata } : {}),
    due_date: service.dueDate,
    due_meter: service.dueMeter,
    equipment_id: service.equipmentId,
    id: service.id,
    interval_mode: service.intervalMode === "by_meter" || service.intervalMode === "both" ? service.intervalMode : "by_date",
    is_active: service.isActive,
    last_completed_at: service.lastCompletedAt,
    last_completed_meter: service.lastCompletedMeter,
    recurrence_unit: service.recurrenceUnit,
    recurrence_value: service.recurrenceValue,
    service_type:
      service.serviceType === "oil_change" ||
      service.serviceType === "inspection" ||
      service.serviceType === "certification" ||
      service.serviceType === "registration" ||
      service.serviceType === "scheduled_maintenance"
        ? service.serviceType
        : "other",
    tenant_id: service.tenantId,
    title: service.title,
    updated_at: service.updatedAt,
  };
}

export function createOfflineEquipmentSubmissionLinkSummary(input: {
  equipment: OfflineEquipmentSummary;
  id?: string;
  linkedAt?: string;
  submission: OfflineEquipmentLinkableSubmissionSummary;
}): OfflineEquipmentSubmissionSummary {
  const linkedAt = input.linkedAt ?? nowIso();

  return {
    equipmentId: input.equipment.id,
    formCode: input.submission.formCode,
    formId: input.submission.formId,
    formName: input.submission.formName,
    formType: input.submission.formType ?? input.submission.formCode,
    id: input.id ?? createOfflineId("equipment-submission-link"),
    linkedAt,
    linkSource: "manual",
    locationName: input.submission.locationName,
    submittedAt: input.submission.submittedAt,
    submissionId: input.submission.id,
    submitterName: input.submission.submitterName,
    tenantId: input.equipment.tenantId,
    updatedAt: linkedAt,
  };
}

export function createOfflineEquipmentSubmissionLinkPayload(
  linkedSubmission: OfflineEquipmentSubmissionSummary,
  input?: {
    action?: string;
    userId?: string | null;
  },
): OfflineEquipmentSubmissionLinkInsert {
  return {
    action_metadata: buildEquipmentActionMetadata({
      action: input?.action ?? "equipment.submission_link.create",
      actorId: input?.userId,
      capturedAt: linkedSubmission.linkedAt,
      details: {
        form_type: linkedSubmission.formType,
        link_source: linkedSubmission.linkSource,
        submission_id: linkedSubmission.submissionId,
      },
      source: "worker_app",
    }),
    equipment_id: linkedSubmission.equipmentId,
    form_type: linkedSubmission.formType,
    id: linkedSubmission.id,
    linked_at: linkedSubmission.linkedAt,
    link_source: linkedSubmission.linkSource === "auto" ? "auto" : "manual",
    submission_id: linkedSubmission.submissionId,
    tenant_id: linkedSubmission.tenantId,
    updated_at: linkedSubmission.updatedAt,
  };
}

export function applyOfflineEquipmentMeterReading(input: {
  equipment: OfflineEquipmentSummary;
  recordedAt?: string;
  value: number;
}) {
  return {
    ...input.equipment,
    currentMeter: input.value,
    updatedAt: input.recordedAt ?? nowIso(),
  };
}

export function applyOfflineEquipmentAssignment(input: {
  assignedTo?: string | null;
  equipment: OfflineEquipmentSummary;
  locationId?: string | null;
  status: string;
  updatedAt?: string;
}): OfflineEquipmentSummary {
  const status = coerceEquipmentStatus(input.status);
  const locationId = equipmentLocationForStatus({
    locationId: input.locationId || null,
    status,
  });

  return {
    ...input.equipment,
    assignedTo: input.assignedTo || null,
    locationId,
    status,
    updatedAt: input.updatedAt ?? nowIso(),
  };
}

export async function cacheOfflineEquipmentSummary(equipment: OfflineEquipmentSummary, expiresAt: string | null) {
  const payload: OfflineEquipmentRecord = {
    ...equipment,
    kind: "equipment_metadata",
  };

  return cacheRecord({
    expiresAt,
    id: equipmentRecordKey(equipment.id),
    payload,
    table: "equipment",
    tenantId: equipment.tenantId,
  });
}

export async function queueOfflineEquipmentAssignment(input: {
  assignedTo?: string | null;
  equipment: OfflineEquipmentSummary;
  expiresAt?: string | null;
  locationId?: string | null;
  status: string;
  userId?: string;
}) {
  const updatedAt = nowIso();
  const equipment = applyOfflineEquipmentAssignment({
    assignedTo: input.assignedTo,
    equipment: input.equipment,
    locationId: input.locationId,
    status: input.status,
    updatedAt,
  });
  const payload = createOfflineEquipmentAssignmentUpdatePayload({
    assignedTo: equipment.assignedTo,
    equipment,
    locationId: equipment.locationId,
    status: equipment.status,
    updatedAt,
    userId: input.userId,
  });

  const [mutation] = await Promise.all([
    queueOfflineMutation({
      operation: "update",
      payload,
      recordId: equipment.id,
      table: "equipment",
      tenantId: equipment.tenantId,
    }),
    cacheOfflineEquipmentSummary(equipment, input.expiresAt ?? null),
  ]);

  return {
    equipment,
    mutation,
  };
}

export async function cacheOfflineDocumentSummary(document: OfflineEquipmentDocumentSummary, expiresAt: string | null) {
  const payload: OfflineEquipmentDocumentRecord = {
    ...document,
    kind: "equipment_document",
  };

  return cacheRecord({
    expiresAt,
    id: documentRecordKey(document.id),
    payload,
    table: "equipment_document",
    tenantId: document.tenantId,
  });
}

export async function cacheOfflineScheduledServiceSummary(service: OfflineEquipmentServiceSummary, expiresAt: string | null) {
  const payload: OfflineEquipmentServiceRecord = {
    ...service,
    kind: "equipment_service",
  };

  return cacheRecord({
    expiresAt,
    id: serviceRecordKey(service.id),
    payload,
    table: "equipment_scheduled_service",
    tenantId: service.tenantId,
  });
}

export async function cacheOfflineMaintenanceSummary(maintenance: OfflineEquipmentMaintenanceSummary, expiresAt: string | null) {
  const payload: OfflineEquipmentMaintenanceRecord = {
    ...maintenance,
    kind: "equipment_maintenance",
  };

  return cacheRecord({
    expiresAt,
    id: maintenanceRecordKey(maintenance.id),
    payload,
    table: "equipment_maintenance_log",
    tenantId: maintenance.tenantId,
  });
}

export async function cacheOfflineMeterSummary(meterReading: OfflineEquipmentMeterSummary, expiresAt: string | null) {
  const payload: OfflineEquipmentMeterRecord = {
    ...meterReading,
    kind: "equipment_meter",
  };

  return cacheRecord({
    expiresAt,
    id: meterRecordKey(meterReading.id),
    payload,
    table: "equipment_meter_log",
    tenantId: meterReading.tenantId,
  });
}

export async function cacheOfflineLinkedSubmissionSummary(linkedSubmission: OfflineEquipmentSubmissionSummary, expiresAt: string | null) {
  const payload: OfflineEquipmentSubmissionRecord = {
    ...linkedSubmission,
    kind: "equipment_submission",
  };

  return cacheRecord({
    expiresAt,
    id: linkedSubmissionRecordKey(linkedSubmission.id),
    payload,
    table: "equipment_submission_link",
    tenantId: linkedSubmission.tenantId,
  });
}

export async function cacheOfflineLinkableSubmissionSummary(
  submission: OfflineEquipmentLinkableSubmissionSummary,
  expiresAt: string | null,
) {
  const payload: OfflineEquipmentLinkableSubmissionRecord = {
    ...submission,
    kind: "equipment_linkable_submission",
  };

  return cacheRecord({
    expiresAt,
    id: linkableSubmissionRecordKey(submission.id),
    payload,
    table: "submissions",
    tenantId: submission.tenantId,
  });
}

export async function queueOfflineEquipmentSubmissionLink(input: {
  equipment: OfflineEquipmentSummary;
  expiresAt?: string | null;
  linkedSubmissions?: OfflineEquipmentSubmissionSummary[];
  submission: OfflineEquipmentLinkableSubmissionSummary;
  userId?: string;
}) {
  if (input.submission.tenantId !== input.equipment.tenantId) {
    throw new Error("Choose a valid submitted form for this tenant.");
  }

  if (input.linkedSubmissions?.some((link) => link.submissionId === input.submission.id)) {
    throw new Error("That submitted form is already linked to this equipment.");
  }

  const linkedSubmission = createOfflineEquipmentSubmissionLinkSummary({
    equipment: input.equipment,
    submission: input.submission,
  });
  const payload = createOfflineEquipmentSubmissionLinkPayload(linkedSubmission, { userId: input.userId });

  const [mutation] = await Promise.all([
    queueOfflineMutation({
      operation: "upsert",
      payload,
      recordId: linkedSubmission.id,
      table: "equipment_submission_link",
      tenantId: linkedSubmission.tenantId,
    }),
    cacheOfflineLinkedSubmissionSummary(linkedSubmission, input.expiresAt ?? null),
  ]);

  return {
    linkedSubmission,
    mutation,
  };
}

export async function queueOfflineEquipmentSubmissionUnlink(input: { link: OfflineEquipmentSubmissionSummary; userId?: string }) {
  const payload = createOfflineEquipmentSubmissionLinkPayload(input.link, {
    action: "equipment.submission_link.delete",
    userId: input.userId,
  });
  const db = getOfflineDatabase();
  const [mutation] = await Promise.all([
    queueOfflineMutation({
      operation: "delete",
      payload,
      recordId: input.link.id,
      table: "equipment_submission_link",
      tenantId: input.link.tenantId,
    }),
    db.cachedRecords.delete(createOfflineRecordKey("equipment_submission_link", linkedSubmissionRecordKey(input.link.id))),
  ]);

  return {
    mutation,
  };
}

export async function queueOfflineScheduledServiceCreation(input: {
  dueDate?: string | null;
  dueMeter?: number | null;
  equipment: OfflineEquipmentSummary;
  expiresAt?: string | null;
  intervalMode: string;
  recurrenceUnit?: "meter" | "days" | "months" | null;
  recurrenceValue?: number | null;
  serviceType?: string;
  title: string;
  userId: string;
}) {
  const title = input.title.trim();
  const intervalMode = coerceEquipmentIntervalMode(input.intervalMode);
  const dueMeter = input.dueMeter ?? null;

  if (!title) {
    throw new Error("Enter scheduled service details.");
  }

  if ((intervalMode === "by_date" || intervalMode === "both") && !input.dueDate) {
    throw new Error("Enter a due date for this scheduled service.");
  }

  if ((intervalMode === "by_meter" || intervalMode === "both") && dueMeter === null) {
    throw new Error("Enter a due meter for this scheduled service.");
  }

  if (dueMeter !== null && (!Number.isFinite(dueMeter) || dueMeter < 0)) {
    throw new Error("Enter a valid due meter.");
  }

  const service = createOfflineScheduledServiceSummary({
    dueDate: input.dueDate,
    dueMeter,
    equipment: input.equipment,
    intervalMode,
    recurrenceUnit: input.recurrenceUnit,
    recurrenceValue: input.recurrenceValue,
    serviceType: input.serviceType,
    title,
  });
  const actionMetadata = buildEquipmentActionMetadata({
    action: "equipment.service.create",
    actorId: input.userId,
    capturedAt: service.updatedAt,
    details: {
      due_date: service.dueDate,
      due_meter: service.dueMeter,
      interval_mode: service.intervalMode,
      recurrence_unit: service.recurrenceUnit,
      recurrence_value: service.recurrenceValue,
    },
    source: "worker_app",
  });
  const servicePayload = {
    ...createOfflineScheduledServiceUpsertPayload(service, actionMetadata),
    created_by: input.userId,
  };

  const [mutation] = await Promise.all([
    queueOfflineMutation({
      operation: "upsert",
      payload: servicePayload,
      recordId: service.id,
      table: "equipment_scheduled_service",
      tenantId: service.tenantId,
    }),
    cacheOfflineScheduledServiceSummary(service, input.expiresAt ?? null),
  ]);

  return {
    mutation,
    service,
  };
}

export async function queueOfflineEquipmentDocument(input: {
  attachments?: OfflineEquipmentDocumentAttachmentDraft[];
  docType?: string;
  equipment: OfflineEquipmentSummary;
  expiresAt?: string | null;
  expiryDate: string;
  issuedDate?: string | null;
  reminderLeadDays?: number | null;
  title: string;
  userId: string;
}) {
  const title = input.title.trim();
  const expiryDate = input.expiryDate.trim();

  if (!title || !expiryDate) {
    throw new Error("Enter document details before saving.");
  }

  const documentPayload = createOfflineEquipmentDocumentPayload({
    docType: input.docType,
    equipment: input.equipment,
    expiryDate,
    issuedDate: input.issuedDate,
    reminderLeadDays: input.reminderLeadDays,
    title,
    userId: input.userId,
  });
  const document = documentSummaryFromPayload(documentPayload);
  const mutationPayload =
    input.attachments && input.attachments.length > 0
      ? {
          ...documentPayload,
          local_attachments: input.attachments,
        }
      : documentPayload;

  const [mutation] = await Promise.all([
    queueOfflineMutation({
      operation: "upsert",
      payload: mutationPayload,
      recordId: typeof documentPayload.id === "string" ? documentPayload.id : null,
      table: "equipment_document",
      tenantId: input.equipment.tenantId,
    }),
    document ? cacheOfflineDocumentSummary(document, input.expiresAt ?? null) : Promise.resolve(null),
  ]);

  return {
    document,
    documentPayload,
    mutation,
  };
}

export async function queueOfflineEquipmentMeterReading(input: {
  equipment: OfflineEquipmentSummary;
  expiresAt?: string | null;
  userId: string;
  value: number;
}) {
  if (!Number.isFinite(input.value) || input.value < 0) {
    throw new Error("Enter a valid meter reading.");
  }

  const recordedAt = nowIso();
  const meterLog = createOfflineEquipmentMeterLogPayload({
    equipment: input.equipment,
    recordedAt,
    userId: input.userId,
    value: input.value,
  });
  const meterReading = meterSummaryFromPayload(meterLog);
  const equipment = applyOfflineEquipmentMeterReading({
    equipment: input.equipment,
    recordedAt,
    value: input.value,
  });

  const [mutation] = await Promise.all([
    queueOfflineMutation({
      operation: "upsert",
      payload: meterLog,
      recordId: typeof meterLog.id === "string" ? meterLog.id : null,
      table: "equipment_meter_log",
      tenantId: input.equipment.tenantId,
    }),
    cacheOfflineEquipmentSummary(equipment, input.expiresAt ?? null),
    meterReading ? cacheOfflineMeterSummary(meterReading, input.expiresAt ?? null) : Promise.resolve(null),
  ]);

  return {
    equipment,
    meterLog,
    meterReading,
    mutation,
  };
}

export async function queueOfflineEquipmentMaintenanceLog(input: {
  attachments?: OfflineEquipmentDocumentAttachmentDraft[];
  description?: string;
  equipment: OfflineEquipmentSummary;
  expiresAt?: string | null;
  meterAtService?: number | null;
  title: string;
  type?: string;
  userId: string;
}) {
  const title = input.title.trim();
  const meterAtService = input.meterAtService ?? null;

  if (!title) {
    throw new Error("Enter maintenance details.");
  }

  if (meterAtService !== null && (!Number.isFinite(meterAtService) || meterAtService < 0)) {
    throw new Error("Enter a valid service meter reading.");
  }

  const recordedAt = nowIso();
  const maintenanceLog = createOfflineEquipmentMaintenancePayload({
    description: input.description,
    equipment: input.equipment,
    meterAtService,
    performedAt: recordedAt.slice(0, 10),
    title,
    type: input.type,
    userId: input.userId,
  });
  const maintenance = maintenanceSummaryFromPayload(maintenanceLog);
  const maintenancePayload =
    input.attachments && input.attachments.length > 0
      ? {
          ...maintenanceLog,
          local_attachments: input.attachments,
        }
      : maintenanceLog;
  const meterLog =
    meterAtService !== null
      ? createOfflineEquipmentMeterLogPayload({
          equipment: input.equipment,
          recordedAt,
          source: "maintenance",
          userId: input.userId,
          value: meterAtService,
        })
      : null;
  const meterReading = meterLog ? meterSummaryFromPayload(meterLog) : null;
  const equipment =
    meterAtService !== null
      ? applyOfflineEquipmentMeterReading({
          equipment: input.equipment,
          recordedAt,
          value: meterAtService,
        })
      : input.equipment;

  const maintenanceMutation = queueOfflineMutation({
    operation: "upsert",
    payload: maintenancePayload,
    recordId: typeof maintenanceLog.id === "string" ? maintenanceLog.id : null,
    table: "equipment_maintenance_log",
    tenantId: input.equipment.tenantId,
  });
  const meterMutation = meterLog
    ? queueOfflineMutation({
        operation: "upsert",
        payload: meterLog,
        recordId: typeof meterLog.id === "string" ? meterLog.id : null,
        table: "equipment_meter_log",
        tenantId: input.equipment.tenantId,
      })
    : Promise.resolve(null);
  const cachedEquipment =
    meterAtService !== null ? cacheOfflineEquipmentSummary(equipment, input.expiresAt ?? null) : Promise.resolve(null);
  const cachedMaintenance = maintenance
    ? cacheOfflineMaintenanceSummary(maintenance, input.expiresAt ?? null)
    : Promise.resolve(null);
  const cachedMeter = meterReading ? cacheOfflineMeterSummary(meterReading, input.expiresAt ?? null) : Promise.resolve(null);

  const [mutation, queuedMeterMutation] = await Promise.all([
    maintenanceMutation,
    meterMutation,
    cachedEquipment,
    cachedMaintenance,
    cachedMeter,
  ]).then(
    ([savedMaintenanceMutation, savedMeterMutation]) => [savedMaintenanceMutation, savedMeterMutation] as const,
  );

  return {
    equipment,
    maintenance,
    maintenanceLog,
    meterLog,
    meterReading,
    mutation,
    queuedMeterMutation,
  };
}

export async function queueOfflineScheduledServiceCompletion(input: {
  completedMeter?: number | null;
  equipment: OfflineEquipmentSummary;
  expiresAt?: string | null;
  service: OfflineEquipmentServiceSummary;
  userId: string;
}) {
  const completedMeter = input.completedMeter ?? null;

  if (completedMeter !== null && (!Number.isFinite(completedMeter) || completedMeter < 0)) {
    throw new Error("Enter a valid completion meter reading.");
  }

  if (input.service.recurrenceUnit === "meter" && completedMeter === null) {
    throw new Error("Enter the completion meter reading for this recurring service.");
  }

  const completedAt = nowIso().slice(0, 10);
  const recordedAt = nowIso();
  const service = applyOfflineScheduledServiceCompletion({
    completedAt,
    completedMeter,
    service: input.service,
  });
  const servicePayload = createOfflineScheduledServiceUpsertPayload(
    service,
    buildEquipmentActionMetadata({
      action: "equipment.service.complete",
      actorId: input.userId,
      capturedAt: recordedAt,
      details: {
        completed_at: completedAt,
        completed_meter: completedMeter,
        next_due_date: service.dueDate,
        next_due_meter: service.dueMeter,
      },
      source: "worker_app",
    }),
  );
  const maintenanceLog = createOfflineEquipmentMaintenancePayload({
    description: `Completed scheduled service: ${input.service.title}`,
    equipment: input.equipment,
    meterAtService: completedMeter,
    performedAt: completedAt,
    title: input.service.title,
    type: "scheduled_service",
    userId: input.userId,
  });
  const maintenance = maintenanceSummaryFromPayload(maintenanceLog);
  const meterLog =
    completedMeter !== null
      ? createOfflineEquipmentMeterLogPayload({
          equipment: input.equipment,
          recordedAt,
          source: "maintenance",
          userId: input.userId,
          value: completedMeter,
        })
      : null;
  const meterReading = meterLog ? meterSummaryFromPayload(meterLog) : null;
  const equipment =
    completedMeter !== null
      ? applyOfflineEquipmentMeterReading({
          equipment: input.equipment,
          recordedAt,
          value: completedMeter,
        })
      : input.equipment;

  const serviceMutation = queueOfflineMutation({
    operation: "upsert",
    payload: servicePayload,
    recordId: service.id,
    table: "equipment_scheduled_service",
    tenantId: service.tenantId,
  });
  const maintenanceMutation = queueOfflineMutation({
    operation: "upsert",
    payload: maintenanceLog,
    recordId: typeof maintenanceLog.id === "string" ? maintenanceLog.id : null,
    table: "equipment_maintenance_log",
    tenantId: input.equipment.tenantId,
  });
  const meterMutation = meterLog
    ? queueOfflineMutation({
        operation: "upsert",
        payload: meterLog,
        recordId: typeof meterLog.id === "string" ? meterLog.id : null,
        table: "equipment_meter_log",
        tenantId: input.equipment.tenantId,
      })
    : Promise.resolve(null);
  const cachedService = cacheOfflineScheduledServiceSummary(service, input.expiresAt ?? null);
  const cachedEquipment =
    completedMeter !== null ? cacheOfflineEquipmentSummary(equipment, input.expiresAt ?? null) : Promise.resolve(null);
  const cachedMaintenance = maintenance
    ? cacheOfflineMaintenanceSummary(maintenance, input.expiresAt ?? null)
    : Promise.resolve(null);
  const cachedMeter = meterReading ? cacheOfflineMeterSummary(meterReading, input.expiresAt ?? null) : Promise.resolve(null);

  const [queuedServiceMutation, queuedMaintenanceMutation, queuedMeterMutation] = await Promise.all([
    serviceMutation,
    maintenanceMutation,
    meterMutation,
    cachedService,
    cachedEquipment,
    cachedMaintenance,
    cachedMeter,
  ]).then(([savedServiceMutation, savedMaintenanceMutation, savedMeterMutation]) => [
    savedServiceMutation,
    savedMaintenanceMutation,
    savedMeterMutation,
  ]);

  return {
    equipment,
    maintenance,
    maintenanceLog,
    meterLog,
    meterReading,
    queuedMaintenanceMutation,
    queuedMeterMutation,
    queuedServiceMutation,
    service,
  };
}

export async function cacheOfflineEquipmentLibrary(input: OfflineEquipmentLibrary & { expiresAt: string | null }) {
  await Promise.all([
    ...input.equipment.map((equipment) => cacheOfflineEquipmentSummary(equipment, input.expiresAt)),
    ...input.services.map((service) => cacheOfflineScheduledServiceSummary(service, input.expiresAt)),
    ...input.documents.map((document) => cacheOfflineDocumentSummary(document, input.expiresAt)),
    ...input.maintenance.map((maintenance) => cacheOfflineMaintenanceSummary(maintenance, input.expiresAt)),
    ...input.meterReadings.map((meterReading) => cacheOfflineMeterSummary(meterReading, input.expiresAt)),
    ...input.linkedSubmissions.map((linkedSubmission) =>
      cacheOfflineLinkedSubmissionSummary(linkedSubmission, input.expiresAt),
    ),
    ...input.linkableSubmissions.map((submission) => cacheOfflineLinkableSubmissionSummary(submission, input.expiresAt)),
    ...input.locations.map((location) => {
      const payload: OfflineEquipmentLocationRecord = {
        ...location,
        kind: "equipment_location",
      };

      return cacheRecord({
        expiresAt: input.expiresAt,
        id: locationRecordKey(location.id),
        payload,
        table: "locations",
        tenantId: location.tenantId,
      });
    }),
    ...input.assignees.map((assignee) => {
      const payload: OfflineEquipmentAssigneeRecord = {
        ...assignee,
        kind: "equipment_assignee",
      };

      return cacheRecord({
        expiresAt: input.expiresAt,
        id: assigneeRecordKey(assignee.id),
        payload,
        table: "users",
        tenantId: assignee.tenantId,
      });
    }),
  ]);
}

export async function getCachedOfflineEquipmentLibrary(tenantId: string): Promise<OfflineEquipmentLibrary> {
  const db = getOfflineDatabase();
  const [
    equipmentRecords,
    serviceRecords,
    documentRecords,
    maintenanceRecords,
    meterRecords,
    linkedSubmissionRecords,
    linkableSubmissionRecords,
    locationRecords,
    assigneeRecords,
  ] = await Promise.all([
    db.cachedRecords.where("[table+tenantId]").equals(["equipment", tenantId]).toArray(),
    db.cachedRecords.where("[table+tenantId]").equals(["equipment_scheduled_service", tenantId]).toArray(),
    db.cachedRecords.where("[table+tenantId]").equals(["equipment_document", tenantId]).toArray(),
    db.cachedRecords.where("[table+tenantId]").equals(["equipment_maintenance_log", tenantId]).toArray(),
    db.cachedRecords.where("[table+tenantId]").equals(["equipment_meter_log", tenantId]).toArray(),
    db.cachedRecords.where("[table+tenantId]").equals(["equipment_submission_link", tenantId]).toArray(),
    db.cachedRecords.where("[table+tenantId]").equals(["submissions", tenantId]).toArray(),
    db.cachedRecords.where("[table+tenantId]").equals(["locations", tenantId]).toArray(),
    db.cachedRecords.where("[table+tenantId]").equals(["users", tenantId]).toArray(),
  ]);

  return {
    assignees: mapRecords(assigneeRecords, assigneeFromPayload).sort((left, right) =>
      left.fullName.localeCompare(right.fullName),
    ),
    documents: mapRecords(documentRecords, documentFromPayload),
    equipment: mapRecords(equipmentRecords, equipmentFromPayload).sort(compareOfflineEquipmentOrder),
    locations: mapRecords(locationRecords, locationFromPayload).sort((left, right) => left.name.localeCompare(right.name)),
    maintenance: mapRecords(maintenanceRecords, maintenanceFromPayload).sort((left, right) =>
      right.performedAt.localeCompare(left.performedAt),
    ),
    meterReadings: mapRecords(meterRecords, meterFromPayload).sort((left, right) => right.recordedAt.localeCompare(left.recordedAt)),
    linkedSubmissions: mapRecords(linkedSubmissionRecords, linkedSubmissionFromPayload).sort((left, right) =>
      right.linkedAt.localeCompare(left.linkedAt),
    ),
    linkableSubmissions: mapRecords(linkableSubmissionRecords, linkableSubmissionFromPayload).sort((left, right) =>
      (right.submittedAt ?? right.updatedAt).localeCompare(left.submittedAt ?? left.updatedAt),
    ),
    services: mapRecords(serviceRecords, serviceFromPayload),
  };
}

export function getOfflineEquipmentDocumentStatus(document: OfflineEquipmentDocumentSummary, now = new Date()) {
  return getEquipmentDocumentStatus(
    {
      expiryDate: document.expiryDate,
      isActive: document.isActive,
      reminderLeadDays: document.reminderLeadDays,
    },
    now,
  );
}
