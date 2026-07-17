import type { Database, Json } from "@/types/database";
import { createAutoShareNotificationPayloads, type AutoShareRecipientRow, type AutoShareUser } from "@/lib/auto-share";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import {
  computeNextDueAt,
  computeWorkflowAssignmentDueAt,
  findScheduledTaskForSubmission,
  findWorkflowRunStepForSubmission,
  resolveNextWorkflowStepIds,
} from "@/lib/workflow-station";
import { getOfflineDatabase, type OfflineSubmissionSourceAssignment, type QueuedMutation } from "./db";
import { getSyncSummary, markOfflineSyncComplete } from "./sync-queue";

type BrowserSupabaseClient = ReturnType<typeof createSupabaseBrowserClient>;
type WorkflowRow = Database["public"]["Tables"]["workflows"]["Row"];
type WorkflowStepRow = Database["public"]["Tables"]["workflow_steps"]["Row"];
type WorkflowConditionRow = Database["public"]["Tables"]["workflow_conditions"]["Row"];
type WorkflowRunRow = Database["public"]["Tables"]["workflow_runs"]["Row"];
type WorkflowRunStepRow = Database["public"]["Tables"]["workflow_run_steps"]["Row"];
type SubmissionInsert = Database["public"]["Tables"]["submissions"]["Insert"];
type SubmissionValueInsert = Database["public"]["Tables"]["submission_values"]["Insert"];
type SignatureInsert = Database["public"]["Tables"]["signatures"]["Insert"];
type SubmissionPhotoInsert = Database["public"]["Tables"]["submission_photos"]["Insert"];
type FollowUpInsert = Database["public"]["Tables"]["follow_ups"]["Insert"];
type ScheduleRow = Database["public"]["Tables"]["schedules"]["Row"];
type ScheduledTaskRow = Database["public"]["Tables"]["scheduled_tasks"]["Row"];
type EquipmentSubmissionLinkInsert = Database["public"]["Tables"]["equipment_submission_link"]["Insert"];
type EquipmentMeterLogInsert = Database["public"]["Tables"]["equipment_meter_log"]["Insert"];
type EquipmentMaintenanceLogInsert = Database["public"]["Tables"]["equipment_maintenance_log"]["Insert"];
type EquipmentScheduledServiceUpsert = Database["public"]["Tables"]["equipment_scheduled_service"]["Insert"];
type EquipmentDocumentInsert = Database["public"]["Tables"]["equipment_document"]["Insert"];
type EquipmentUpdate = Database["public"]["Tables"]["equipment"]["Update"];
type NotificationAuditInsertRow = Pick<Database["public"]["Tables"]["notifications"]["Row"], "id">;
type EquipmentAuditIdRow = { id: string };
type DeletedEquipmentSubmissionLinkAudit = {
  equipmentId: string;
  id?: string | null;
  submissionId: string;
};
type EquipmentAuditPayload = {
  deletedSubmissionLinks?: DeletedEquipmentSubmissionLinkAudit[];
  documentIds?: string[];
  equipmentIds?: string[];
  maintenanceLogIds?: string[];
  meterLogIds?: string[];
  scheduledServiceIds?: string[];
  submissionLinkIds?: string[];
};
type WorkflowExecutionAuditIdRow = { id: string };
type WorkflowExecutionAuditPayload = {
  assignedRunStepIds?: string[];
  completedRunIds?: string[];
  completedRunStepIds?: string[];
  completedScheduledTaskIds?: string[];
  createdScheduledTaskIds?: string[];
  startedRunIds?: string[];
};
type EquipmentLocalAttachment = {
  contentType: string;
  dataUrl: string;
  name: string;
};

const submissionAttachmentBucket = "tenant-documents";

function isRecord(value: unknown): value is Record<string, Json | undefined> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function actionMetadataFromPayload(value: Json | undefined): Json {
  return isRecord(value) ? value : {};
}

function isDataUrl(value: unknown): value is string {
  return typeof value === "string" && value.startsWith("data:");
}

function extensionForAttachmentMimeType(mimeType: string) {
  switch (mimeType.toLowerCase()) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    default:
      return null;
  }
}

function extensionForEquipmentAttachmentMimeType(mimeType: string) {
  switch (mimeType.toLowerCase()) {
    case "application/pdf":
      return "pdf";
    case "image/heic":
      return "heic";
    case "image/heif":
      return "heif";
    default:
      return extensionForAttachmentMimeType(mimeType);
  }
}

function sanitizeStorageFilename(value: string) {
  const name = value
    .trim()
    .replace(/[/\\?%*:|"<>]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 120);

  return name || "attachment";
}

export function createSubmissionAttachmentStoragePath(input: {
  attachmentId: string;
  contentType: string;
  kind: "photos" | "signatures";
  submissionId: string;
  tenantId: string;
}) {
  const extension = extensionForAttachmentMimeType(input.contentType) ?? "bin";
  return `${input.tenantId}/submissions/${input.submissionId}/${input.kind}/${input.attachmentId}.${extension}`;
}

function dataUrlToBlob(dataUrl: string) {
  const match = dataUrl.match(/^data:([^;,]+)(;base64)?,([\s\S]*)$/);

  if (!match) {
    return null;
  }

  const contentType = match[1].toLowerCase();
  const extension = extensionForAttachmentMimeType(contentType);

  if (!extension) {
    return null;
  }

  const rawData = match[3];
  const binary = match[2] ? atob(rawData) : decodeURIComponent(rawData);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return {
    blob: new Blob([bytes], { type: contentType }),
    contentType,
  };
}

function equipmentAttachmentDataUrlToBlob(dataUrl: string) {
  const match = dataUrl.match(/^data:([^;,]+)(;base64)?,([\s\S]*)$/);

  if (!match) {
    return null;
  }

  const contentType = match[1].toLowerCase();
  const extension = extensionForEquipmentAttachmentMimeType(contentType);

  if (!extension) {
    return null;
  }

  const rawData = match[3];
  const binary = match[2] ? atob(rawData) : decodeURIComponent(rawData);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return {
    blob: new Blob([bytes], { type: contentType }),
    contentType,
    extension,
  };
}

async function uploadSubmissionAttachment(
  getSupabase: () => BrowserSupabaseClient,
  input: {
    attachmentId: string;
    dataUrl: string;
    kind: "photos" | "signatures";
    submissionId: string;
    tenantId: string;
  },
) {
  const upload = dataUrlToBlob(input.dataUrl);

  if (!upload) {
    return { error: "Queued attachment is not a supported PNG, JPEG, or WebP image.", path: null };
  }

  const path = createSubmissionAttachmentStoragePath({
    attachmentId: input.attachmentId,
    contentType: upload.contentType,
    kind: input.kind,
    submissionId: input.submissionId,
    tenantId: input.tenantId,
  });
  const { error } = await getSupabase().storage.from(submissionAttachmentBucket).upload(path, upload.blob, {
    contentType: upload.contentType,
    upsert: true,
  });

  return {
    error: error?.message ?? null,
    path,
  };
}

async function uploadEquipmentAttachments(
  supabase: BrowserSupabaseClient,
  input: {
    attachments: EquipmentLocalAttachment[];
    equipmentId: string;
    folder: "documents" | "maintenance";
    recordId: string;
    tenantId: string;
  },
) {
  const paths: string[] = [];

  for (const [index, attachment] of input.attachments.entries()) {
    const upload = equipmentAttachmentDataUrlToBlob(attachment.dataUrl);

    if (!upload) {
      return { error: "Queued equipment attachment is not a supported PDF, PNG, JPEG, WebP, HEIC, or HEIF file.", paths };
    }

    const filename = sanitizeStorageFilename(attachment.name);
    const path = [
      input.tenantId,
      "equipment",
      input.equipmentId,
      input.folder,
      `${input.recordId}-${index}-${filename}`,
    ].join("/");

    const { error } = await supabase.storage.from(submissionAttachmentBucket).upload(path, upload.blob, {
      contentType: upload.contentType,
      upsert: true,
    });

    if (error) {
      return { error: error.message, paths };
    }

    paths.push(path);
  }

  return {
    error: null,
    paths,
  };
}

export function scrubSubmissionValueLocalFiles(value: Json): Json {
  if (Array.isArray(value)) {
    return value.map((entry) => scrubSubmissionValueLocalFiles(entry));
  }

  if (!isRecord(value)) {
    return value;
  }

  if ((value.type === "photo" || value.type === "signature") && typeof value.dataUrl === "string") {
    const next = { ...value };
    delete next.dataUrl;
    return next;
  }

  return value;
}

function scrubSubmissionValuesLocalFiles(values: SubmissionValueInsert[]) {
  return values.map((value) => ({
    ...value,
    value: scrubSubmissionValueLocalFiles(value.value),
  }));
}

function normalizeSourceAssignment(value: Json | undefined): OfflineSubmissionSourceAssignment | null {
  if (!isRecord(value)) {
    return null;
  }

  if ((value.source === "scheduled" || value.source === "workflow") && typeof value.sourceId === "string") {
    return {
      source: value.source,
      sourceId: value.sourceId,
    };
  }

  return null;
}

function normalizeSubmissionMutationPayload(payload: Json) {
  if (!isRecord(payload)) {
    return null;
  }

  if (isRecord(payload.submission)) {
    return {
      submission: payload.submission as Database["public"]["Tables"]["submissions"]["Insert"],
      equipmentLinks: Array.isArray(payload.equipmentLinks)
        ? (payload.equipmentLinks.filter(isRecord) as EquipmentSubmissionLinkInsert[])
        : [],
      equipmentMeterLogs: Array.isArray(payload.equipmentMeterLogs)
        ? (payload.equipmentMeterLogs.filter(isRecord) as EquipmentMeterLogInsert[])
        : [],
      equipmentStatusUpdates: Array.isArray(payload.equipmentStatusUpdates)
        ? payload.equipmentStatusUpdates
            .filter(isRecord)
            .map((entry) => ({
              equipmentId: typeof entry.equipmentId === "string" ? entry.equipmentId : "",
              reason: typeof entry.reason === "string" ? entry.reason : "",
              status: typeof entry.status === "string" ? entry.status : "down",
            }))
            .filter((entry) => entry.equipmentId)
        : [],
      followUps: Array.isArray(payload.followUps)
        ? (payload.followUps.filter(isRecord) as Database["public"]["Tables"]["follow_ups"]["Insert"][])
        : [],
      photos: Array.isArray(payload.photos)
        ? (payload.photos.filter(isRecord) as Database["public"]["Tables"]["submission_photos"]["Insert"][])
        : [],
      signatures: Array.isArray(payload.signatures)
        ? (payload.signatures.filter(isRecord) as Database["public"]["Tables"]["signatures"]["Insert"][])
        : [],
      sourceAssignment: normalizeSourceAssignment(payload.sourceAssignment),
      values: Array.isArray(payload.values)
        ? (payload.values.filter(isRecord) as Database["public"]["Tables"]["submission_values"]["Insert"][])
        : [],
    };
  }

  return {
    equipmentLinks: [],
    equipmentMeterLogs: [],
    equipmentStatusUpdates: [],
    followUps: [],
    photos: [],
    signatures: [],
    sourceAssignment: null,
    submission: payload as Database["public"]["Tables"]["submissions"]["Insert"],
    values: [],
  };
}

function normalizeEquipmentSubmissionLinkMutationPayload(payload: Json): EquipmentSubmissionLinkInsert | null {
  if (!isRecord(payload)) {
    return null;
  }

  const tenantId = typeof payload.tenant_id === "string" ? payload.tenant_id : "";
  const equipmentId = typeof payload.equipment_id === "string" ? payload.equipment_id : "";
  const submissionId = typeof payload.submission_id === "string" ? payload.submission_id : "";

  if (!tenantId || !equipmentId || !submissionId) {
    return null;
  }

  const linkedAt = typeof payload.linked_at === "string" && payload.linked_at ? payload.linked_at : new Date().toISOString();
  const linkSource = payload.link_source === "auto" ? "auto" : "manual";

  return {
    ...(typeof payload.id === "string" && payload.id ? { id: payload.id } : {}),
    ...(typeof payload.form_type === "string" && payload.form_type.trim() ? { form_type: payload.form_type.trim() } : {}),
    action_metadata: actionMetadataFromPayload(payload.action_metadata),
    equipment_id: equipmentId,
    linked_at: linkedAt,
    link_source: linkSource,
    submission_id: submissionId,
    tenant_id: tenantId,
    updated_at: typeof payload.updated_at === "string" && payload.updated_at ? payload.updated_at : linkedAt,
  };
}

function normalizeEquipmentMeterLogMutationPayload(payload: Json): EquipmentMeterLogInsert | null {
  if (!isRecord(payload)) {
    return null;
  }

  const tenantId = typeof payload.tenant_id === "string" ? payload.tenant_id : "";
  const equipmentId = typeof payload.equipment_id === "string" ? payload.equipment_id : "";
  const value = typeof payload.value === "number" && Number.isFinite(payload.value) ? payload.value : null;

  if (!tenantId || !equipmentId || value === null || value < 0) {
    return null;
  }

  const recordedAt = typeof payload.recorded_at === "string" && payload.recorded_at ? payload.recorded_at : new Date().toISOString();
  const createdAt = typeof payload.created_at === "string" && payload.created_at ? payload.created_at : recordedAt;
  const updatedAt = typeof payload.updated_at === "string" && payload.updated_at ? payload.updated_at : recordedAt;
  const source = payload.source === "inspection" || payload.source === "maintenance" ? payload.source : "manual";

  return {
    ...(typeof payload.id === "string" && payload.id ? { id: payload.id } : {}),
    ...(typeof payload.recorded_by === "string" && payload.recorded_by ? { recorded_by: payload.recorded_by } : {}),
    ...(typeof payload.source_submission_id === "string" && payload.source_submission_id
      ? { source_submission_id: payload.source_submission_id }
      : {}),
    action_metadata: actionMetadataFromPayload(payload.action_metadata),
    created_at: createdAt,
    equipment_id: equipmentId,
    recorded_at: recordedAt,
    source,
    tenant_id: tenantId,
    updated_at: updatedAt,
    value,
  };
}

function normalizeEquipmentMaintenanceLogMutationPayload(payload: Json) {
  if (!isRecord(payload)) {
    return null;
  }

  const tenantId = typeof payload.tenant_id === "string" ? payload.tenant_id : "";
  const equipmentId = typeof payload.equipment_id === "string" ? payload.equipment_id : "";
  const title = typeof payload.title === "string" ? payload.title.trim() : "";

  if (!tenantId || !equipmentId || !title) {
    return null;
  }

  const now = new Date().toISOString();
  const performedAt = typeof payload.performed_at === "string" && payload.performed_at ? payload.performed_at.slice(0, 10) : now.slice(0, 10);
  const createdAt = typeof payload.created_at === "string" && payload.created_at ? payload.created_at : now;
  const updatedAt = typeof payload.updated_at === "string" && payload.updated_at ? payload.updated_at : now;
  const meterAtService =
    typeof payload.meter_at_service === "number" && Number.isFinite(payload.meter_at_service) && payload.meter_at_service >= 0
      ? payload.meter_at_service
      : null;
  const cost = typeof payload.cost === "number" && Number.isFinite(payload.cost) && payload.cost >= 0 ? payload.cost : null;
  const maintenanceTypes = new Set<NonNullable<EquipmentMaintenanceLogInsert["type"]>>([
    "oil_change",
    "repair",
    "inspection_service",
    "tire",
    "scheduled_service",
    "unscheduled_repair",
    "other",
  ]);
  const type: NonNullable<EquipmentMaintenanceLogInsert["type"]> =
    typeof payload.type === "string" && maintenanceTypes.has(payload.type as NonNullable<EquipmentMaintenanceLogInsert["type"]>)
      ? (payload.type as NonNullable<EquipmentMaintenanceLogInsert["type"]>)
      : "other";
  const attachmentIds = Array.isArray(payload.attachment_ids)
    ? payload.attachment_ids.filter((path): path is string => typeof path === "string" && Boolean(path.trim()))
    : [];

  const maintenance: EquipmentMaintenanceLogInsert = {
    ...(typeof payload.id === "string" && payload.id ? { id: payload.id } : {}),
    ...(typeof payload.created_by === "string" && payload.created_by ? { created_by: payload.created_by } : {}),
    ...(typeof payload.description === "string" && payload.description.trim() ? { description: payload.description.trim() } : {}),
    action_metadata: actionMetadataFromPayload(payload.action_metadata),
    attachment_ids: attachmentIds,
    ...(meterAtService !== null ? { meter_at_service: meterAtService } : {}),
    ...(cost !== null ? { cost } : {}),
    ...(typeof payload.performed_by === "string" && payload.performed_by ? { performed_by: payload.performed_by } : {}),
    ...(typeof payload.vendor === "string" && payload.vendor.trim() ? { vendor: payload.vendor.trim() } : {}),
    created_at: createdAt,
    equipment_id: equipmentId,
    performed_at: performedAt,
    tenant_id: tenantId,
    title,
    type,
    updated_at: updatedAt,
  };

  return {
    localAttachments: normalizeEquipmentLocalAttachments(payload.local_attachments),
    maintenance,
  };
}

function normalizeEquipmentScheduledServiceMutationPayload(payload: Json): EquipmentScheduledServiceUpsert | null {
  if (!isRecord(payload)) {
    return null;
  }

  const tenantId = typeof payload.tenant_id === "string" ? payload.tenant_id : "";
  const equipmentId = typeof payload.equipment_id === "string" ? payload.equipment_id : "";
  const title = typeof payload.title === "string" ? payload.title.trim() : "";

  if (!tenantId || !equipmentId || !title) {
    return null;
  }

  const intervalModes = new Set<NonNullable<EquipmentScheduledServiceUpsert["interval_mode"]>>(["by_date", "by_meter", "both"]);
  const serviceTypes = new Set<NonNullable<EquipmentScheduledServiceUpsert["service_type"]>>([
    "oil_change",
    "inspection",
    "certification",
    "registration",
    "scheduled_maintenance",
    "other",
  ]);
  const recurrenceUnits = new Set<NonNullable<EquipmentScheduledServiceUpsert["recurrence_unit"]>>(["meter", "days", "months"]);
  const intervalMode: NonNullable<EquipmentScheduledServiceUpsert["interval_mode"]> =
    typeof payload.interval_mode === "string" &&
    intervalModes.has(payload.interval_mode as NonNullable<EquipmentScheduledServiceUpsert["interval_mode"]>)
      ? (payload.interval_mode as NonNullable<EquipmentScheduledServiceUpsert["interval_mode"]>)
      : "by_date";
  const serviceType: NonNullable<EquipmentScheduledServiceUpsert["service_type"]> =
    typeof payload.service_type === "string" &&
    serviceTypes.has(payload.service_type as NonNullable<EquipmentScheduledServiceUpsert["service_type"]>)
      ? (payload.service_type as NonNullable<EquipmentScheduledServiceUpsert["service_type"]>)
      : "other";
  const recurrenceUnit =
    typeof payload.recurrence_unit === "string" &&
    recurrenceUnits.has(payload.recurrence_unit as NonNullable<EquipmentScheduledServiceUpsert["recurrence_unit"]>)
      ? (payload.recurrence_unit as NonNullable<EquipmentScheduledServiceUpsert["recurrence_unit"]>)
      : null;
  const dueDate = typeof payload.due_date === "string" && payload.due_date ? payload.due_date.slice(0, 10) : null;
  const dueMeter = typeof payload.due_meter === "number" && Number.isFinite(payload.due_meter) && payload.due_meter >= 0 ? payload.due_meter : null;
  const recurrenceValue =
    typeof payload.recurrence_value === "number" && Number.isInteger(payload.recurrence_value) && payload.recurrence_value > 0
      ? payload.recurrence_value
      : null;
  const lastCompletedAt =
    typeof payload.last_completed_at === "string" && payload.last_completed_at ? payload.last_completed_at.slice(0, 10) : null;
  const lastCompletedMeter =
    typeof payload.last_completed_meter === "number" &&
    Number.isFinite(payload.last_completed_meter) &&
    payload.last_completed_meter >= 0
      ? payload.last_completed_meter
      : null;

  return {
    ...(typeof payload.id === "string" && payload.id ? { id: payload.id } : {}),
    ...(typeof payload.created_by === "string" && payload.created_by ? { created_by: payload.created_by } : {}),
    action_metadata: actionMetadataFromPayload(payload.action_metadata),
    due_date: dueDate,
    due_meter: dueMeter,
    equipment_id: equipmentId,
    interval_mode: intervalMode,
    is_active: typeof payload.is_active === "boolean" ? payload.is_active : true,
    last_completed_at: lastCompletedAt,
    last_completed_meter: lastCompletedMeter,
    recurrence_unit: recurrenceUnit,
    recurrence_value: recurrenceValue,
    service_type: serviceType,
    tenant_id: tenantId,
    title,
    updated_at: typeof payload.updated_at === "string" && payload.updated_at ? payload.updated_at : new Date().toISOString(),
  };
}

function normalizeEquipmentLocalAttachments(payload: Json | undefined) {
  if (!Array.isArray(payload)) {
    return [];
  }

  return payload
    .filter(isRecord)
    .map((attachment) => ({
      contentType: typeof attachment.contentType === "string" ? attachment.contentType : "",
      dataUrl: typeof attachment.dataUrl === "string" ? attachment.dataUrl : "",
      name: typeof attachment.name === "string" ? attachment.name : "attachment",
    }))
    .filter((attachment): attachment is EquipmentLocalAttachment =>
      Boolean(attachment.contentType && attachment.dataUrl && attachment.name),
    );
}

function normalizeEquipmentDocumentMutationPayload(payload: Json) {
  if (!isRecord(payload)) {
    return null;
  }

  const tenantId = typeof payload.tenant_id === "string" ? payload.tenant_id : "";
  const equipmentId = typeof payload.equipment_id === "string" ? payload.equipment_id : "";
  const title = typeof payload.title === "string" ? payload.title.trim() : "";
  const expiryDate = typeof payload.expiry_date === "string" && payload.expiry_date ? payload.expiry_date.slice(0, 10) : "";

  if (!tenantId || !equipmentId || !title || !expiryDate) {
    return null;
  }

  const now = new Date().toISOString();
  const documentTypes = new Set<NonNullable<EquipmentDocumentInsert["doc_type"]>>([
    "registration",
    "insurance",
    "permit",
    "certification",
    "other",
  ]);
  const docType: NonNullable<EquipmentDocumentInsert["doc_type"]> =
    typeof payload.doc_type === "string" && documentTypes.has(payload.doc_type as NonNullable<EquipmentDocumentInsert["doc_type"]>)
      ? (payload.doc_type as NonNullable<EquipmentDocumentInsert["doc_type"]>)
      : "other";
  const issuedDate = typeof payload.issued_date === "string" && payload.issued_date ? payload.issued_date.slice(0, 10) : null;
  const reminderLeadDays =
    typeof payload.reminder_lead_days === "number" && Number.isInteger(payload.reminder_lead_days) && payload.reminder_lead_days >= 0
      ? payload.reminder_lead_days
      : 30;
  const attachmentIds = Array.isArray(payload.attachment_ids)
    ? payload.attachment_ids.filter((path): path is string => typeof path === "string" && Boolean(path.trim()))
    : [];

  const document: EquipmentDocumentInsert = {
    ...(typeof payload.id === "string" && payload.id ? { id: payload.id } : {}),
    ...(typeof payload.created_by === "string" && payload.created_by ? { created_by: payload.created_by } : {}),
    action_metadata: actionMetadataFromPayload(payload.action_metadata),
    attachment_ids: attachmentIds,
    created_at: typeof payload.created_at === "string" && payload.created_at ? payload.created_at : now,
    doc_type: docType,
    equipment_id: equipmentId,
    expiry_date: expiryDate,
    is_active: typeof payload.is_active === "boolean" ? payload.is_active : true,
    issued_date: issuedDate,
    reminder_lead_days: reminderLeadDays,
    tenant_id: tenantId,
    title,
    updated_at: typeof payload.updated_at === "string" && payload.updated_at ? payload.updated_at : now,
  };

  return {
    document,
    localAttachments: normalizeEquipmentLocalAttachments(payload.local_attachments),
  };
}

function normalizeEquipmentUpdateMutationPayload(payload: Json) {
  if (!isRecord(payload)) {
    return null;
  }

  const id = typeof payload.id === "string" ? payload.id : "";
  const tenantId = typeof payload.tenant_id === "string" ? payload.tenant_id : "";

  if (!id || !tenantId) {
    return null;
  }

  const statuses = new Set<NonNullable<EquipmentUpdate["status"]>>(["active", "down", "retired", "sold"]);
  const status: NonNullable<EquipmentUpdate["status"]> =
    typeof payload.status === "string" && statuses.has(payload.status as NonNullable<EquipmentUpdate["status"]>)
      ? (payload.status as NonNullable<EquipmentUpdate["status"]>)
      : "active";
  const locationId =
    status === "down" ? null : typeof payload.location_id === "string" && payload.location_id ? payload.location_id : null;

  return {
    action_metadata: actionMetadataFromPayload(payload.action_metadata),
    assigned_to: typeof payload.assigned_to === "string" && payload.assigned_to ? payload.assigned_to : null,
    id,
    location_id: locationId,
    status,
    tenant_id: tenantId,
    updated_at: typeof payload.updated_at === "string" && payload.updated_at ? payload.updated_at : new Date().toISOString(),
  } satisfies EquipmentUpdate & { id: string; tenant_id: string };
}

async function markMutationFailed(mutation: QueuedMutation, errorMessage: string) {
  const db = getOfflineDatabase();
  const now = new Date().toISOString();

  await db.queuedMutations.update(mutation.id, {
    status: "failed",
    attempts: mutation.attempts + 1,
    updatedAt: now,
    nextAttemptAt: null,
    lastError: errorMessage,
  });

  if (mutation.recordId) {
    await db.draftSubmissions.update(mutation.recordId, {
      status: "failed",
      updatedAt: now,
      lastError: errorMessage,
    });
  }
}

async function recordAutoShareNotificationAuditEvents(notificationIds: string[]) {
  if (notificationIds.length === 0) {
    return null;
  }

  try {
    const response = await fetch("/api/audit/auto-share-notifications", {
      body: JSON.stringify({ notificationIds }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });

    if (response.ok) {
      return null;
    }

    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    return body?.error ?? "Auto-share notification audit was not recorded.";
  } catch (error) {
    return error instanceof Error ? error.message : "Auto-share notification audit was not recorded.";
  }
}

function compactAuditIds(ids: string[] | undefined) {
  return Array.from(new Set((ids ?? []).filter(Boolean))).slice(0, 100);
}

async function recordWorkflowExecutionAuditEvents(input: WorkflowExecutionAuditPayload) {
  const payload: WorkflowExecutionAuditPayload = {
    assignedRunStepIds: compactAuditIds(input.assignedRunStepIds),
    completedRunIds: compactAuditIds(input.completedRunIds),
    completedRunStepIds: compactAuditIds(input.completedRunStepIds),
    completedScheduledTaskIds: compactAuditIds(input.completedScheduledTaskIds),
    createdScheduledTaskIds: compactAuditIds(input.createdScheduledTaskIds),
    startedRunIds: compactAuditIds(input.startedRunIds),
  };
  const hasIds = Object.values(payload).some((ids) => Array.isArray(ids) && ids.length > 0);

  if (!hasIds) {
    return null;
  }

  try {
    const response = await fetch("/api/audit/workflow-execution", {
      body: JSON.stringify(payload),
      headers: { "content-type": "application/json" },
      method: "POST",
    });

    if (response.ok) {
      return null;
    }

    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    return body?.error ?? "Workflow execution audit was not recorded.";
  } catch (error) {
    return error instanceof Error ? error.message : "Workflow execution audit was not recorded.";
  }
}

async function recordEquipmentAuditEvents(input: EquipmentAuditPayload) {
  const payload: EquipmentAuditPayload = {
    deletedSubmissionLinks: input.deletedSubmissionLinks ?? [],
    documentIds: compactAuditIds(input.documentIds),
    equipmentIds: compactAuditIds(input.equipmentIds),
    maintenanceLogIds: compactAuditIds(input.maintenanceLogIds),
    meterLogIds: compactAuditIds(input.meterLogIds),
    scheduledServiceIds: compactAuditIds(input.scheduledServiceIds),
    submissionLinkIds: compactAuditIds(input.submissionLinkIds),
  };
  const hasIds = Object.values(payload).some((value) => Array.isArray(value) && value.length > 0);

  if (!hasIds) {
    return null;
  }

  try {
    const response = await fetch("/api/audit/equipment-actions", {
      body: JSON.stringify(payload),
      headers: { "content-type": "application/json" },
      method: "POST",
    });

    if (response.ok) {
      return null;
    }

    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    return body?.error ?? "Equipment audit was not recorded.";
  } catch (error) {
    return error instanceof Error ? error.message : "Equipment audit was not recorded.";
  }
}

async function deliverAutoShareNotifications(supabase: BrowserSupabaseClient, submission: SubmissionInsert) {
  if (
    typeof submission.id !== "string" ||
    typeof submission.tenant_id !== "string" ||
    typeof submission.form_id !== "string"
  ) {
    return "Queued submission is missing details for auto-share.";
  }

  const { data: recipients, error: recipientsError } = await supabase
    .from("auto_share_recipients")
    .select("*")
    .eq("tenant_id", submission.tenant_id)
    .eq("active", true)
    .returns<AutoShareRecipientRow[]>();

  if (recipientsError) {
    return recipientsError.message;
  }

  if (!recipients || recipients.length === 0) {
    return null;
  }

  const { data: form, error: formError } = await supabase
    .from("forms")
    .select("id, name, code")
    .eq("tenant_id", submission.tenant_id)
    .eq("id", submission.form_id)
    .maybeSingle<{ id: string; name: string; code: string }>();

  if (formError) {
    return formError.message;
  }

  const { data: users, error: usersError } = await supabase
    .from("users")
    .select("id, full_name, email")
    .eq("tenant_id", submission.tenant_id)
    .eq("active", true)
    .returns<AutoShareUser[]>();

  if (usersError) {
    return usersError.message;
  }

  const submittedBy = typeof submission.submitted_by === "string" ? submission.submitted_by : null;
  const { data: submitter, error: submitterError } = submittedBy
    ? await supabase
        .from("users")
        .select("id, full_name")
        .eq("tenant_id", submission.tenant_id)
        .eq("id", submittedBy)
        .maybeSingle<{ id: string; full_name: string }>()
    : { data: null, error: null };

  if (submitterError) {
    return submitterError.message;
  }

  const locationId = typeof submission.location_id === "string" ? submission.location_id : null;
  const { data: location, error: locationError } = locationId
    ? await supabase
        .from("locations")
        .select("id, name")
        .eq("tenant_id", submission.tenant_id)
        .eq("id", locationId)
        .maybeSingle<{ id: string; name: string }>()
    : { data: null, error: null };

  if (locationError) {
    return locationError.message;
  }

  const notificationPayloads = createAutoShareNotificationPayloads({
    createdAt: new Date().toISOString(),
    formCode: form?.code ?? submission.form_id,
    formName: form?.name ?? "Submitted Form",
    locationName: location?.name ?? null,
    recipients,
    submittedByName: submitter?.full_name ?? null,
    submission: {
      created_at: typeof submission.created_at === "string" ? submission.created_at : new Date().toISOString(),
      form_id: submission.form_id,
      id: submission.id,
      location_id: locationId,
      submitted_by: submittedBy,
      tenant_id: submission.tenant_id,
    },
    users: users ?? [],
  });

  if (notificationPayloads.length === 0) {
    return null;
  }

  const { data: insertedNotifications, error } = await supabase
    .from("notifications")
    .insert(notificationPayloads)
    .select("id")
    .returns<NotificationAuditInsertRow[]>();

  if (error) {
    return error.message;
  }

  return recordAutoShareNotificationAuditEvents((insertedNotifications ?? []).map((notification) => notification.id));
}

function submittedValuesByItem(values: SubmissionValueInsert[]) {
  const mappedValues: Record<string, Json> = {};

  for (const value of values) {
    if (typeof value.form_item_id === "string") {
      mappedValues[value.form_item_id] = value.value;
    }
  }

  return mappedValues;
}

function resolveWorkflowAssignee(step: WorkflowStepRow, submittedBy: string | null) {
  if (step.assignee_user_id) {
    return step.assignee_user_id;
  }

  return submittedBy;
}

async function insertWorkflowAssignments({
  completedStep,
  conditions,
  formById,
  runId,
  steps,
  submittedBy,
  supabase,
  tenantId,
  values,
  workflow,
}: {
  completedStep: WorkflowStepRow;
  conditions: WorkflowConditionRow[];
  formById: Map<string, { code: string; id: string; name: string }>;
  runId: string;
  steps: WorkflowStepRow[];
  submittedBy: string | null;
  supabase: BrowserSupabaseClient;
  tenantId: string;
  values: Record<string, Json>;
  workflow: WorkflowRow;
}) {
  const nextStepIds = resolveNextWorkflowStepIds({
    completedStep,
    conditions,
    steps,
    values,
  });

  if (nextStepIds.length === 0) {
    const { error } = await supabase
      .from("workflow_runs")
      .update({ completed_at: new Date().toISOString(), status: "completed" })
      .eq("id", runId)
      .eq("tenant_id", tenantId);

    if (error) {
      return error.message;
    }

    return recordWorkflowExecutionAuditEvents({ completedRunIds: [runId] });
  }

  const { data: existingPending, error: pendingError } = await supabase
    .from("workflow_run_steps")
    .select("id, workflow_step_id")
    .eq("tenant_id", tenantId)
    .eq("workflow_run_id", runId)
    .eq("status", "pending")
    .in("workflow_step_id", nextStepIds)
    .returns<Pick<WorkflowRunStepRow, "id" | "workflow_step_id">[]>();

  if (pendingError) {
    return pendingError.message;
  }

  const existingStepIds = new Set((existingPending ?? []).map((runStep) => runStep.workflow_step_id));
  const nextSteps = nextStepIds
    .filter((stepId) => !existingStepIds.has(stepId))
    .map((stepId) => steps.find((step) => step.id === stepId))
    .filter((step): step is WorkflowStepRow => Boolean(step));

  if (nextSteps.length === 0) {
    return null;
  }

  const now = new Date().toISOString();
  const dueAt = computeWorkflowAssignmentDueAt(now);
  const runStepPayloads = nextSteps.map((step) => ({
    assigned_to: resolveWorkflowAssignee(step, submittedBy),
    due_at: dueAt,
    status: "pending",
    tenant_id: tenantId,
    workflow_run_id: runId,
    workflow_step_id: step.id,
  }));
  const { data: insertedRunSteps, error: runStepError } = await supabase
    .from("workflow_run_steps")
    .insert(runStepPayloads)
    .select("id")
    .returns<WorkflowExecutionAuditIdRow[]>();

  if (runStepError) {
    return runStepError.message;
  }

  const assignmentAuditError = await recordWorkflowExecutionAuditEvents({
    assignedRunStepIds: (insertedRunSteps ?? []).map((runStep) => runStep.id),
  });

  if (assignmentAuditError) {
    return assignmentAuditError;
  }

  const notifications: Database["public"]["Tables"]["notifications"]["Insert"][] = [];

  for (const step of nextSteps) {
    const assignedTo = resolveWorkflowAssignee(step, submittedBy);
    const form = step.form_id ? formById.get(step.form_id) : null;

    if (assignedTo) {
      notifications.push({
        body: `${workflow.name} advanced to ${form?.name ?? "the next form"}. Due ${new Date(dueAt).toLocaleDateString("en")}.`,
        created_at: now,
        tenant_id: tenantId,
        title: `Workflow assignment: ${form?.code ?? workflow.name}`,
        user_id: assignedTo,
      });
    }
  }

  if (notifications.length > 0) {
    const { error } = await supabase.from("notifications").insert(notifications);
    return error?.message ?? null;
  }

  return null;
}

async function deliverWorkflowAssignments(
  supabase: BrowserSupabaseClient,
  submission: SubmissionInsert,
  values: SubmissionValueInsert[],
  sourceAssignment?: OfflineSubmissionSourceAssignment | null,
) {
  if (
    typeof submission.id !== "string" ||
    typeof submission.tenant_id !== "string" ||
    typeof submission.form_id !== "string"
  ) {
    return "Queued submission is missing workflow details.";
  }

  const tenantId = submission.tenant_id;
  const submittedBy = typeof submission.submitted_by === "string" ? submission.submitted_by : null;
  const valueMap = submittedValuesByItem(values);
  const { data: workflows, error: workflowError } = await supabase
    .from("workflows")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("enabled", true)
    .returns<WorkflowRow[]>();

  if (workflowError) {
    return workflowError.message;
  }

  if (!workflows || workflows.length === 0) {
    return null;
  }

  const workflowIds = workflows.map((workflow) => workflow.id);
  const { data: steps, error: stepsError } = await supabase
    .from("workflow_steps")
    .select("*")
    .eq("tenant_id", tenantId)
    .in("workflow_id", workflowIds)
    .order("sort_order", { ascending: true })
    .returns<WorkflowStepRow[]>();

  if (stepsError) {
    return stepsError.message;
  }

  const stepRows = steps ?? [];

  if (stepRows.length === 0) {
    return null;
  }

  const stepIds = stepRows.map((step) => step.id);
  const formIds = Array.from(new Set(stepRows.map((step) => step.form_id).filter((formId): formId is string => Boolean(formId))));
  const [{ data: conditions, error: conditionsError }, { data: forms, error: formsError }] = await Promise.all([
    supabase
      .from("workflow_conditions")
      .select("*")
      .eq("tenant_id", tenantId)
      .in("workflow_step_id", stepIds)
      .returns<WorkflowConditionRow[]>(),
    formIds.length > 0
      ? supabase
          .from("forms")
          .select("id, name, code")
          .eq("tenant_id", tenantId)
          .in("id", formIds)
          .returns<{ code: string; id: string; name: string }[]>()
      : Promise.resolve({ data: [] as { code: string; id: string; name: string }[], error: null }),
  ]);

  if (conditionsError) {
    return conditionsError.message;
  }

  if (formsError) {
    return formsError.message;
  }

  const conditionRows = conditions ?? [];
  const workflowById = new Map(workflows.map((workflow) => [workflow.id, workflow]));
  const formById = new Map((forms ?? []).map((form) => [form.id, form]));
  const stepById = new Map(stepRows.map((step) => [step.id, step]));
  const stepsByWorkflow = new Map<string, WorkflowStepRow[]>();

  for (const step of stepRows) {
    const workflowSteps = stepsByWorkflow.get(step.workflow_id) ?? [];
    workflowSteps.push(step);
    stepsByWorkflow.set(step.workflow_id, workflowSteps);
  }

  const { data: pendingRunSteps, error: pendingError } = await supabase
    .from("workflow_run_steps")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("status", "pending")
    .returns<WorkflowRunStepRow[]>();

  if (pendingError) {
    return pendingError.message;
  }

  const pendingRunIds = Array.from(new Set((pendingRunSteps ?? []).map((runStep) => runStep.workflow_run_id)));
  const { data: pendingRuns, error: pendingRunsError } =
    pendingRunIds.length > 0
      ? await supabase
          .from("workflow_runs")
          .select("*")
          .eq("tenant_id", tenantId)
          .in("id", pendingRunIds)
          .returns<WorkflowRunRow[]>()
      : { data: [] as WorkflowRunRow[], error: null };

  if (pendingRunsError) {
    return pendingRunsError.message;
  }

  const matchingPendingStep = findWorkflowRunStepForSubmission({
    requestedRunStepId: sourceAssignment?.source === "workflow" ? sourceAssignment.sourceId : null,
    runs: pendingRuns ?? [],
    runSteps: pendingRunSteps ?? [],
    steps: stepRows,
    submission: {
      form_id: submission.form_id,
      id: submission.id,
      location_id: typeof submission.location_id === "string" ? submission.location_id : null,
      submitted_by: submittedBy,
    },
  });
  const matchingPendingSteps = matchingPendingStep ? [matchingPendingStep.runStep] : [];

  for (const runStep of matchingPendingSteps) {
    const completedStep = stepById.get(runStep.workflow_step_id);
    const workflow = completedStep ? workflowById.get(completedStep.workflow_id) : null;

    if (!completedStep || !workflow) {
      continue;
    }

    const now = new Date().toISOString();
    const { error: updateError } = await supabase
      .from("workflow_run_steps")
      .update({
        completed_at: now,
        status: "completed",
        submission_id: submission.id,
      })
      .eq("id", runStep.id)
      .eq("tenant_id", tenantId);

    if (updateError) {
      return updateError.message;
    }

    const completionAuditError = await recordWorkflowExecutionAuditEvents({ completedRunStepIds: [runStep.id] });

    if (completionAuditError) {
      return completionAuditError;
    }

    const workflowSteps = stepsByWorkflow.get(workflow.id) ?? [];
    const advanceError = await insertWorkflowAssignments({
      completedStep,
      conditions: conditionRows,
      formById,
      runId: runStep.workflow_run_id,
      steps: workflowSteps,
      submittedBy,
      supabase,
      tenantId,
      values: valueMap,
      workflow,
    });

    if (advanceError) {
      return advanceError;
    }
  }

  if (matchingPendingSteps.length > 0) {
    return null;
  }

  for (const workflow of workflows) {
    const workflowSteps = stepsByWorkflow.get(workflow.id) ?? [];
    const firstStep = workflowSteps[0];

    if (!firstStep || firstStep.form_id !== submission.form_id) {
      continue;
    }

    const { data: run, error: runError } = await supabase
      .from("workflow_runs")
      .insert({
        location_id: typeof submission.location_id === "string" ? submission.location_id : null,
        started_by: submittedBy,
        status: "open",
        tenant_id: tenantId,
        workflow_id: workflow.id,
      })
      .select("id")
      .single<{ id: string }>();

    if (runError || !run) {
      return runError?.message ?? "Workflow run was not created.";
    }

    const now = new Date().toISOString();
    const { data: firstRunStep, error: firstStepError } = await supabase
      .from("workflow_run_steps")
      .insert({
        completed_at: now,
        status: "completed",
        submission_id: submission.id,
        tenant_id: tenantId,
        workflow_run_id: run.id,
        workflow_step_id: firstStep.id,
      })
      .select("id")
      .single<WorkflowExecutionAuditIdRow>();

    if (firstStepError || !firstRunStep) {
      return firstStepError?.message ?? "Workflow run step was not created.";
    }

    const startAuditError = await recordWorkflowExecutionAuditEvents({
      completedRunStepIds: [firstRunStep.id],
      startedRunIds: [run.id],
    });

    if (startAuditError) {
      return startAuditError;
    }

    const advanceError = await insertWorkflowAssignments({
      completedStep: firstStep,
      conditions: conditionRows,
      formById,
      runId: run.id,
      steps: workflowSteps,
      submittedBy,
      supabase,
      tenantId,
      values: valueMap,
      workflow,
    });

    if (advanceError) {
      return advanceError;
    }
  }

  return null;
}

async function completeMatchingScheduledTask(
  supabase: BrowserSupabaseClient,
  submission: SubmissionInsert,
  sourceAssignment?: OfflineSubmissionSourceAssignment | null,
) {
  if (
    typeof submission.id !== "string" ||
    typeof submission.tenant_id !== "string" ||
    typeof submission.form_id !== "string"
  ) {
    return "Queued submission is missing scheduled task details.";
  }

  const tenantId = submission.tenant_id;
  const submittedBy = typeof submission.submitted_by === "string" ? submission.submitted_by : null;
  const locationId = typeof submission.location_id === "string" ? submission.location_id : null;
  const requestedTaskId = sourceAssignment?.source === "scheduled" ? sourceAssignment.sourceId : null;
  const { data: schedules, error: scheduleError } = await supabase
    .from("schedules")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("active", true)
    .eq("form_id", submission.form_id)
    .returns<ScheduleRow[]>();

  if (scheduleError) {
    return scheduleError.message;
  }

  const scheduleRows = schedules ?? [];

  if (scheduleRows.length === 0) {
    return null;
  }

  const scheduleIds = scheduleRows.map((schedule) => schedule.id);
  let taskQuery = supabase
    .from("scheduled_tasks")
    .select("*")
    .eq("tenant_id", tenantId)
    .is("completed_submission_id", null)
    .in("schedule_id", scheduleIds);

  taskQuery = requestedTaskId ? taskQuery.eq("id", requestedTaskId) : taskQuery.order("due_at", { ascending: true }).limit(100);

  const { data: tasks, error: taskError } = await taskQuery.returns<ScheduledTaskRow[]>();

  if (taskError) {
    return taskError.message;
  }

  const match = findScheduledTaskForSubmission({
    requestedTaskId,
    schedules: scheduleRows,
    submission: {
      form_id: submission.form_id,
      id: submission.id,
      location_id: locationId,
      submitted_by: submittedBy,
    },
    tasks: tasks ?? [],
  });

  if (!match) {
    return null;
  }

  const now = new Date().toISOString();
  const { error: updateTaskError } = await supabase
    .from("scheduled_tasks")
    .update({
      completed_submission_id: submission.id,
      status: "done",
    })
    .eq("id", match.task.id)
    .eq("tenant_id", tenantId)
    .is("completed_submission_id", null);

  if (updateTaskError) {
    return updateTaskError.message;
  }

  const taskCompletionAuditError = await recordWorkflowExecutionAuditEvents({
    completedScheduledTaskIds: [match.task.id],
  });

  if (taskCompletionAuditError) {
    return taskCompletionAuditError;
  }

  const scheduleName = match.schedule.name ?? "Scheduled task";
  const nextDueAt = computeNextDueAt(match.task.due_at, match.schedule.recurrence_rule ?? "monthly");
  const nextAssignee = match.schedule.assignee_id ?? match.task.assigned_to;
  const { data: existingNextTask, error: existingNextTaskError } = await supabase
    .from("scheduled_tasks")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("schedule_id", match.schedule.id)
    .eq("due_at", nextDueAt)
    .maybeSingle<{ id: string }>();

  if (existingNextTaskError) {
    return existingNextTaskError.message;
  }

  if (!existingNextTask) {
    const { data: nextTask, error: nextTaskError } = await supabase
      .from("scheduled_tasks")
      .insert({
        assigned_to: nextAssignee,
        due_at: nextDueAt,
        schedule_id: match.schedule.id,
        status: "due",
        tenant_id: tenantId,
      })
      .select("id")
      .single<WorkflowExecutionAuditIdRow>();

    if (nextTaskError || !nextTask) {
      return nextTaskError?.message ?? "Next scheduled task was not created.";
    }

    const nextTaskAuditError = await recordWorkflowExecutionAuditEvents({
      createdScheduledTaskIds: [nextTask.id],
    });

    if (nextTaskAuditError) {
      return nextTaskAuditError;
    }

    if (nextAssignee) {
      const { error: notificationError } = await supabase.from("notifications").insert({
        body: `${scheduleName} is due again on ${new Date(nextDueAt).toLocaleDateString("en")}.`,
        channel: "in_app",
        created_at: now,
        delivered_at: now,
        delivery_status: "delivered",
        recipient_type: "schedule_assignee",
        tenant_id: tenantId,
        title: `Scheduled task: ${scheduleName}`,
        user_id: nextAssignee,
      });

      if (notificationError) {
        return notificationError.message;
      }
    }
  }

  const { error: scheduleUpdateError } = await supabase
    .from("schedules")
    .update({ next_due_at: nextDueAt })
    .eq("id", match.schedule.id)
    .eq("tenant_id", tenantId);

  return scheduleUpdateError?.message ?? null;
}

async function uploadQueuedSubmissionAttachments(input: {
  followUps: FollowUpInsert[];
  getSupabase: () => BrowserSupabaseClient;
  photos: SubmissionPhotoInsert[];
  signatures: SignatureInsert[];
  submissionId: string;
  tenantId: string;
}) {
  const signatures: SignatureInsert[] = [];
  const photos: SubmissionPhotoInsert[] = [];
  const followUps: FollowUpInsert[] = [];

  for (const signature of input.signatures) {
    const signatureId = typeof signature.id === "string" ? signature.id : crypto.randomUUID();

    if (isDataUrl(signature.signature_path)) {
      const upload = await uploadSubmissionAttachment(input.getSupabase, {
        attachmentId: signatureId,
        dataUrl: signature.signature_path,
        kind: "signatures",
        submissionId: input.submissionId,
        tenantId: input.tenantId,
      });

      if (upload.error || !upload.path) {
        return { error: upload.error ?? "Signature upload failed.", followUps: [], photos: [], signatures: [] };
      }

      signatures.push({
        ...signature,
        id: signatureId,
        signature_path: upload.path,
      });
    } else {
      signatures.push({
        ...signature,
        id: signatureId,
      });
    }
  }

  for (const photo of input.photos) {
    const photoId = typeof photo.id === "string" ? photo.id : crypto.randomUUID();

    if (isDataUrl(photo.storage_path)) {
      const upload = await uploadSubmissionAttachment(input.getSupabase, {
        attachmentId: photoId,
        dataUrl: photo.storage_path,
        kind: "photos",
        submissionId: input.submissionId,
        tenantId: input.tenantId,
      });

      if (upload.error || !upload.path) {
        return { error: upload.error ?? "Photo upload failed.", followUps: [], photos: [], signatures: [] };
      }

      photos.push({
        ...photo,
        id: photoId,
        storage_path: upload.path,
      });
    } else {
      photos.push({
        ...photo,
        id: photoId,
      });
    }
  }

  for (const followUp of input.followUps) {
    const followUpId = typeof followUp.id === "string" ? followUp.id : crypto.randomUUID();

    if (isDataUrl(followUp.photo_path)) {
      const upload = await uploadSubmissionAttachment(input.getSupabase, {
        attachmentId: `follow-up-${followUpId}`,
        dataUrl: followUp.photo_path,
        kind: "photos",
        submissionId: input.submissionId,
        tenantId: input.tenantId,
      });

      if (upload.error || !upload.path) {
        return { error: upload.error ?? "Corrective action photo upload failed.", followUps: [], photos: [], signatures: [] };
      }

      followUps.push({
        ...followUp,
        id: followUpId,
        photo_path: upload.path,
      });
    } else {
      followUps.push({
        ...followUp,
        id: followUpId,
      });
    }
  }

  return {
    error: null,
    followUps,
    photos,
    signatures,
  };
}

async function flushSubmissionMutation(mutation: QueuedMutation) {
  const normalizedPayload = normalizeSubmissionMutationPayload(mutation.payload);

  if (!normalizedPayload) {
    await markMutationFailed(mutation, "Queued submission payload is invalid.");
    return;
  }

  const db = getOfflineDatabase();
  const now = new Date().toISOString();
  let supabase: BrowserSupabaseClient | null = null;
  const getSupabase = () => {
    supabase ??= createSupabaseBrowserClient();
    return supabase;
  };

  await db.queuedMutations.update(mutation.id, {
    status: "syncing",
    updatedAt: now,
  });

  if (mutation.recordId) {
    await db.draftSubmissions.update(mutation.recordId, {
      status: "syncing",
      updatedAt: now,
      lastError: null,
    });
  }

  const {
    equipmentLinks,
    equipmentMeterLogs,
    equipmentStatusUpdates,
    followUps,
    photos,
    signatures,
    sourceAssignment,
    submission,
    values,
  } = normalizedPayload;

  if (typeof submission.id !== "string" || typeof submission.tenant_id !== "string") {
    await markMutationFailed(mutation, "Queued submission is missing its id or tenant.");
    return;
  }

  const uploadedAttachments = await uploadQueuedSubmissionAttachments({
    followUps,
    getSupabase,
    photos,
    signatures,
    submissionId: submission.id,
    tenantId: submission.tenant_id,
  });

  if (uploadedAttachments.error) {
    await markMutationFailed(mutation, uploadedAttachments.error);
    return;
  }

  const supabaseClient = getSupabase();
  const syncedValues = scrubSubmissionValuesLocalFiles(values);

  const { error } = await supabaseClient.from("submissions").upsert(submission);

  if (error) {
    await markMutationFailed(mutation, error.message);
    return;
  }

  const { error: deleteValuesError } = await supabaseClient
    .from("submission_values")
    .delete()
    .eq("tenant_id", submission.tenant_id)
    .eq("submission_id", submission.id);

  if (deleteValuesError) {
    await markMutationFailed(mutation, deleteValuesError.message);
    return;
  }

  if (syncedValues.length > 0) {
    const { error: valueError } = await supabaseClient.from("submission_values").insert(syncedValues);

    if (valueError) {
      await markMutationFailed(mutation, valueError.message);
      return;
    }
  }

  const { error: deleteSignaturesError } = await supabaseClient
    .from("signatures")
    .delete()
    .eq("tenant_id", submission.tenant_id)
    .eq("submission_id", submission.id);

  if (deleteSignaturesError) {
    await markMutationFailed(mutation, deleteSignaturesError.message);
    return;
  }

  if (uploadedAttachments.signatures.length > 0) {
    const { error: signatureError } = await supabaseClient.from("signatures").insert(uploadedAttachments.signatures);

    if (signatureError) {
      await markMutationFailed(mutation, signatureError.message);
      return;
    }
  }

  const { error: deletePhotosError } = await supabaseClient
    .from("submission_photos")
    .delete()
    .eq("tenant_id", submission.tenant_id)
    .eq("submission_id", submission.id);

  if (deletePhotosError) {
    await markMutationFailed(mutation, deletePhotosError.message);
    return;
  }

  if (uploadedAttachments.photos.length > 0) {
    const { error: photoError } = await supabaseClient.from("submission_photos").insert(uploadedAttachments.photos);

    if (photoError) {
      await markMutationFailed(mutation, photoError.message);
      return;
    }
  }

  if (equipmentLinks.length > 0) {
    const { data: insertedEquipmentLinks, error: equipmentLinkError } = await supabaseClient
      .from("equipment_submission_link")
      .upsert(equipmentLinks, { onConflict: "tenant_id,equipment_id,submission_id" })
      .select("id")
      .returns<EquipmentAuditIdRow[]>();

    if (equipmentLinkError) {
      await markMutationFailed(mutation, equipmentLinkError.message);
      return;
    }

    const equipmentLinkAuditError = await recordEquipmentAuditEvents({
      submissionLinkIds: (insertedEquipmentLinks ?? []).map((link) => link.id),
    });

    if (equipmentLinkAuditError) {
      await markMutationFailed(mutation, equipmentLinkAuditError);
      return;
    }
  }

  // Take units with a worker-confirmed major defect out of service. Only flip an
  // active unit to down so we never clobber a unit that is already retired/sold or
  // intentionally parked; the maintenance owner reactivates once the repair is
  // verified. Each failed item already has its own corrective action (above).
  if (equipmentStatusUpdates.length > 0) {
    const downedEquipmentIds: string[] = [];

    for (const update of equipmentStatusUpdates) {
      if (update.status !== "down") {
        continue;
      }

      const { data: downedEquipment, error: equipmentStatusError } = await supabaseClient
        .from("equipment")
        .update({
          action_metadata: actionMetadataFromPayload({
            action: "equipment.out_of_service.from_inspection",
            reason: update.reason,
            submission_id: submission.id,
          }),
          status: "down",
          updated_at: now,
        })
        .eq("tenant_id", submission.tenant_id)
        .eq("id", update.equipmentId)
        .eq("status", "active")
        .select("id")
        .returns<EquipmentAuditIdRow[]>();

      if (equipmentStatusError) {
        await markMutationFailed(mutation, equipmentStatusError.message);
        return;
      }

      for (const equipment of downedEquipment ?? []) {
        downedEquipmentIds.push(equipment.id);
      }
    }

    if (downedEquipmentIds.length > 0) {
      const equipmentStatusAuditError = await recordEquipmentAuditEvents({ equipmentIds: downedEquipmentIds });

      if (equipmentStatusAuditError) {
        await markMutationFailed(mutation, equipmentStatusAuditError);
        return;
      }
    }
  }

  if (equipmentMeterLogs.length > 0) {
    const { data: insertedEquipmentMeterLogs, error: equipmentMeterError } = await supabaseClient
      .from("equipment_meter_log")
      .upsert(equipmentMeterLogs)
      .select("id")
      .returns<EquipmentAuditIdRow[]>();

    if (equipmentMeterError) {
      await markMutationFailed(mutation, equipmentMeterError.message);
      return;
    }

    const equipmentMeterAuditError = await recordEquipmentAuditEvents({
      meterLogIds: (insertedEquipmentMeterLogs ?? []).map((meterLog) => meterLog.id),
    });

    if (equipmentMeterAuditError) {
      await markMutationFailed(mutation, equipmentMeterAuditError);
      return;
    }
  }

  if (uploadedAttachments.followUps.length > 0) {
    const { error: followUpError } = await supabaseClient.from("follow_ups").upsert(uploadedAttachments.followUps);

    if (followUpError) {
      await markMutationFailed(mutation, followUpError.message);
      return;
    }

    const followUpNotifications = uploadedAttachments.followUps
      .filter((followUp): followUp is FollowUpInsert & { assigned_to: string; title: string } =>
        Boolean(followUp.assigned_to && followUp.title),
      )
      .map((followUp) => ({
        body: `${followUp.title} was assigned from a submitted form.`,
        channel: "in_app",
        created_at: now,
        delivered_at: now,
        delivery_status: "delivered",
        recipient_type: "follow_up_assignee",
        submission_id: typeof followUp.parent_submission_id === "string" ? followUp.parent_submission_id : submission.id,
        tenant_id: submission.tenant_id,
        title: "Corrective action assigned",
        user_id: followUp.assigned_to,
      }));

    if (followUpNotifications.length > 0) {
      const { error: notificationError } = await supabaseClient.from("notifications").insert(followUpNotifications);

      if (notificationError) {
        await markMutationFailed(mutation, notificationError.message);
        return;
      }
    }
  }

  const autoShareError = await deliverAutoShareNotifications(supabaseClient, submission);

  if (autoShareError) {
    await markMutationFailed(mutation, autoShareError);
    return;
  }

  const workflowError = await deliverWorkflowAssignments(supabaseClient, submission, syncedValues, sourceAssignment);

  if (workflowError) {
    await markMutationFailed(mutation, workflowError);
    return;
  }

  const scheduledTaskError = await completeMatchingScheduledTask(supabaseClient, submission, sourceAssignment);

  if (scheduledTaskError) {
    await markMutationFailed(mutation, scheduledTaskError);
    return;
  }

  await db.queuedMutations.delete(mutation.id);

  if (mutation.recordId) {
    await db.draftSubmissions.update(mutation.recordId, {
      status: "synced",
      updatedAt: new Date().toISOString(),
      queuedMutationId: null,
      lastError: null,
    });
  }
}

async function flushEquipmentMeterLogMutation(mutation: QueuedMutation) {
  const payload = normalizeEquipmentMeterLogMutationPayload(mutation.payload);

  if (!payload) {
    await markMutationFailed(mutation, "Queued equipment meter reading is invalid.");
    return;
  }

  const db = getOfflineDatabase();
  const supabase = createSupabaseBrowserClient();

  await db.queuedMutations.update(mutation.id, {
    status: "syncing",
    updatedAt: new Date().toISOString(),
  });

  const { data: meterLog, error } = await supabase
    .from("equipment_meter_log")
    .upsert(payload)
    .select("id")
    .single<EquipmentAuditIdRow>();

  if (error || !meterLog) {
    await markMutationFailed(mutation, error?.message ?? "Queued equipment meter reading was not synced.");
    return;
  }

  const auditError = await recordEquipmentAuditEvents({ meterLogIds: [meterLog.id] });

  if (auditError) {
    await markMutationFailed(mutation, auditError);
    return;
  }

  await db.queuedMutations.delete(mutation.id);
}

async function flushEquipmentSubmissionLinkMutation(mutation: QueuedMutation) {
  const payload = normalizeEquipmentSubmissionLinkMutationPayload(mutation.payload);

  if (!payload) {
    await markMutationFailed(mutation, "Queued equipment form link is invalid.");
    return;
  }

  const db = getOfflineDatabase();
  const supabase = createSupabaseBrowserClient();

  await db.queuedMutations.update(mutation.id, {
    status: "syncing",
    updatedAt: new Date().toISOString(),
  });

  if (mutation.operation === "delete") {
    const deleteQuery = supabase
      .from("equipment_submission_link")
      .delete()
      .eq("tenant_id", payload.tenant_id)
      .eq("equipment_id", payload.equipment_id)
      .eq("submission_id", payload.submission_id);

    const { error } = payload.id ? await deleteQuery.eq("id", payload.id) : await deleteQuery;

    if (error) {
      await markMutationFailed(mutation, error.message);
      return;
    }

    const auditError = await recordEquipmentAuditEvents({
      deletedSubmissionLinks: [
        {
          equipmentId: payload.equipment_id,
          id: typeof payload.id === "string" ? payload.id : null,
          submissionId: payload.submission_id,
        },
      ],
    });

    if (auditError) {
      await markMutationFailed(mutation, auditError);
      return;
    }

    await db.queuedMutations.delete(mutation.id);
    return;
  }

  const { data: submissionLink, error } = await supabase
    .from("equipment_submission_link")
    .upsert(payload, {
      onConflict: "tenant_id,equipment_id,submission_id",
    })
    .select("id")
    .single<EquipmentAuditIdRow>();

  if (error || !submissionLink) {
    await markMutationFailed(mutation, error?.message ?? "Queued equipment form link was not synced.");
    return;
  }

  const auditError = await recordEquipmentAuditEvents({ submissionLinkIds: [submissionLink.id] });

  if (auditError) {
    await markMutationFailed(mutation, auditError);
    return;
  }

  await db.queuedMutations.delete(mutation.id);
}

async function flushEquipmentUpdateMutation(mutation: QueuedMutation) {
  const payload = normalizeEquipmentUpdateMutationPayload(mutation.payload);

  if (!payload) {
    await markMutationFailed(mutation, "Queued equipment update is invalid.");
    return;
  }

  const db = getOfflineDatabase();
  const supabase = createSupabaseBrowserClient();

  await db.queuedMutations.update(mutation.id, {
    status: "syncing",
    updatedAt: new Date().toISOString(),
  });

  const { id, tenant_id: tenantId, ...update } = payload;
  const { data: equipment, error } = await supabase
    .from("equipment")
    .update(update)
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .select("id")
    .single<EquipmentAuditIdRow>();

  if (error || !equipment) {
    await markMutationFailed(mutation, error?.message ?? "Queued equipment update was not synced.");
    return;
  }

  const auditError = await recordEquipmentAuditEvents({ equipmentIds: [equipment.id] });

  if (auditError) {
    await markMutationFailed(mutation, auditError);
    return;
  }

  await db.queuedMutations.delete(mutation.id);
}

async function flushEquipmentMaintenanceLogMutation(mutation: QueuedMutation) {
  const payload = normalizeEquipmentMaintenanceLogMutationPayload(mutation.payload);

  if (!payload) {
    await markMutationFailed(mutation, "Queued equipment maintenance log is invalid.");
    return;
  }

  const db = getOfflineDatabase();
  const supabase = createSupabaseBrowserClient();

  await db.queuedMutations.update(mutation.id, {
    status: "syncing",
    updatedAt: new Date().toISOString(),
  });

  const maintenanceId = typeof payload.maintenance.id === "string" ? payload.maintenance.id : mutation.recordId;
  const attachmentIds = [...(payload.maintenance.attachment_ids ?? [])];

  if (payload.localAttachments.length > 0) {
    if (!maintenanceId) {
      await markMutationFailed(mutation, "Queued equipment maintenance log is missing its id for attachment upload.");
      return;
    }

    const uploadedAttachments = await uploadEquipmentAttachments(supabase, {
      attachments: payload.localAttachments,
      equipmentId: payload.maintenance.equipment_id,
      folder: "maintenance",
      recordId: maintenanceId,
      tenantId: payload.maintenance.tenant_id,
    });

    if (uploadedAttachments.error) {
      await markMutationFailed(mutation, uploadedAttachments.error);
      return;
    }

    attachmentIds.push(...uploadedAttachments.paths);
  }

  const { data: maintenanceLog, error } = await supabase
    .from("equipment_maintenance_log")
    .upsert({
      ...payload.maintenance,
      attachment_ids: Array.from(new Set(attachmentIds)),
    })
    .select("id")
    .single<EquipmentAuditIdRow>();

  if (error || !maintenanceLog) {
    await markMutationFailed(mutation, error?.message ?? "Queued equipment maintenance log was not synced.");
    return;
  }

  const auditError = await recordEquipmentAuditEvents({ maintenanceLogIds: [maintenanceLog.id] });

  if (auditError) {
    await markMutationFailed(mutation, auditError);
    return;
  }

  await db.queuedMutations.delete(mutation.id);
}

async function flushEquipmentScheduledServiceMutation(mutation: QueuedMutation) {
  const payload = normalizeEquipmentScheduledServiceMutationPayload(mutation.payload);

  if (!payload) {
    await markMutationFailed(mutation, "Queued equipment scheduled service update is invalid.");
    return;
  }

  const db = getOfflineDatabase();
  const supabase = createSupabaseBrowserClient();

  await db.queuedMutations.update(mutation.id, {
    status: "syncing",
    updatedAt: new Date().toISOString(),
  });

  const { data: scheduledService, error } = await supabase
    .from("equipment_scheduled_service")
    .upsert(payload)
    .select("id")
    .single<EquipmentAuditIdRow>();

  if (error || !scheduledService) {
    await markMutationFailed(mutation, error?.message ?? "Queued equipment scheduled service was not synced.");
    return;
  }

  const auditError = await recordEquipmentAuditEvents({ scheduledServiceIds: [scheduledService.id] });

  if (auditError) {
    await markMutationFailed(mutation, auditError);
    return;
  }

  await db.queuedMutations.delete(mutation.id);
}

async function flushEquipmentDocumentMutation(mutation: QueuedMutation) {
  const payload = normalizeEquipmentDocumentMutationPayload(mutation.payload);

  if (!payload) {
    await markMutationFailed(mutation, "Queued equipment document is invalid.");
    return;
  }

  const db = getOfflineDatabase();
  const supabase = createSupabaseBrowserClient();

  await db.queuedMutations.update(mutation.id, {
    status: "syncing",
    updatedAt: new Date().toISOString(),
  });

  const documentId = typeof payload.document.id === "string" ? payload.document.id : mutation.recordId;
  const attachmentIds = [...(payload.document.attachment_ids ?? [])];

  if (payload.localAttachments.length > 0) {
    if (!documentId) {
      await markMutationFailed(mutation, "Queued equipment document is missing its id for attachment upload.");
      return;
    }

    const uploadedAttachments = await uploadEquipmentAttachments(supabase, {
      attachments: payload.localAttachments,
      equipmentId: payload.document.equipment_id,
      folder: "documents",
      recordId: documentId,
      tenantId: payload.document.tenant_id,
    });

    if (uploadedAttachments.error) {
      await markMutationFailed(mutation, uploadedAttachments.error);
      return;
    }

    attachmentIds.push(...uploadedAttachments.paths);
  }

  const { data: document, error } = await supabase
    .from("equipment_document")
    .upsert({
      ...payload.document,
      attachment_ids: Array.from(new Set(attachmentIds)),
    })
    .select("id")
    .single<EquipmentAuditIdRow>();

  if (error || !document) {
    await markMutationFailed(mutation, error?.message ?? "Queued equipment document was not synced.");
    return;
  }

  const auditError = await recordEquipmentAuditEvents({ documentIds: [document.id] });

  if (auditError) {
    await markMutationFailed(mutation, auditError);
    return;
  }

  await db.queuedMutations.delete(mutation.id);
}

export async function flushQueuedMutations() {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return getSyncSummary();
  }

  const db = getOfflineDatabase();
  const pending = await db.queuedMutations.where("status").equals("pending").toArray();

  for (const mutation of pending) {
    if (mutation.table === "submissions" && mutation.operation === "upsert") {
      await flushSubmissionMutation(mutation);
    } else if (mutation.table === "equipment" && mutation.operation === "update") {
      await flushEquipmentUpdateMutation(mutation);
    } else if (
      mutation.table === "equipment_submission_link" &&
      (mutation.operation === "upsert" || mutation.operation === "delete")
    ) {
      await flushEquipmentSubmissionLinkMutation(mutation);
    } else if (mutation.table === "equipment_meter_log" && mutation.operation === "upsert") {
      await flushEquipmentMeterLogMutation(mutation);
    } else if (mutation.table === "equipment_maintenance_log" && mutation.operation === "upsert") {
      await flushEquipmentMaintenanceLogMutation(mutation);
    } else if (mutation.table === "equipment_scheduled_service" && mutation.operation === "upsert") {
      await flushEquipmentScheduledServiceMutation(mutation);
    } else if (mutation.table === "equipment_document" && mutation.operation === "upsert") {
      await flushEquipmentDocumentMutation(mutation);
    } else {
      await markMutationFailed(mutation, `Unsupported offline mutation: ${mutation.table} ${mutation.operation}.`);
    }
  }

  await markOfflineSyncComplete();

  return getSyncSummary();
}
