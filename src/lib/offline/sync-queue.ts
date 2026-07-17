import type { Database, Json } from "@/types/database";
import {
  createOfflineRecordKey,
  getOfflineDatabase,
  type CachedRecord,
  type OfflineDraftSubmission,
  type OfflineRecordTable,
  type OfflineSubmissionSourceAssignment,
  type QueuedMutation,
  type QueuedMutationOperation,
} from "./db";

export type SyncSummary = {
  pending: number;
  failed: number;
  lastSyncedAt: string | null;
};

export type FailedSyncDetail = {
  id: string;
  recordId: string | null;
  title: string;
  context: string;
  lastError: string;
  attempts: number;
  updatedAt: string;
};

export const syncQueueChangedEvent = "core-pathways-sync-queue-changed";

export type OfflineEquipmentStatusUpdate = {
  equipmentId: string;
  reason: string;
  status: string;
};

export type OfflineSubmissionMutationPayload = {
  equipmentLinks: Database["public"]["Tables"]["equipment_submission_link"]["Insert"][];
  equipmentMeterLogs: Database["public"]["Tables"]["equipment_meter_log"]["Insert"][];
  equipmentStatusUpdates: OfflineEquipmentStatusUpdate[];
  followUps: Database["public"]["Tables"]["follow_ups"]["Insert"][];
  photos: Database["public"]["Tables"]["submission_photos"]["Insert"][];
  signatures: Database["public"]["Tables"]["signatures"]["Insert"][];
  sourceAssignment?: OfflineSubmissionSourceAssignment | null;
  submission: Database["public"]["Tables"]["submissions"]["Insert"];
  values: Database["public"]["Tables"]["submission_values"]["Insert"][];
};

function nowIso() {
  return new Date().toISOString();
}

function getMutationId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `mutation-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function emitSyncQueueChanged() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(syncQueueChangedEvent));
  }
}

function isRecord(value: Json | undefined): value is Record<string, Json | undefined> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringFromPayload(payload: Json, keys: string[]) {
  if (!isRecord(payload)) {
    return "";
  }

  for (const key of keys) {
    const value = payload[key];

    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return "";
}

function mutationContextLabel(mutation: Pick<QueuedMutation, "operation" | "table">) {
  const tableLabels: Partial<Record<OfflineRecordTable, string>> = {
    equipment: "Equipment update",
    equipment_document: "Equipment document",
    equipment_maintenance_log: "Equipment maintenance",
    equipment_meter_log: "Equipment meter reading",
    equipment_scheduled_service: "Scheduled service",
    equipment_submission_link: "Equipment form link",
    submissions: "Form submission",
  };

  return tableLabels[mutation.table] ?? `${mutation.table.replace(/_/g, " ")} ${mutation.operation}`;
}

function mutationPayloadTitle(mutation: Pick<QueuedMutation, "payload" | "recordId">) {
  const unitNumber = stringFromPayload(mutation.payload, ["unit_number", "unitNumber"]);
  const name = stringFromPayload(mutation.payload, ["name", "equipment_name", "equipmentName"]);

  if (unitNumber && name) {
    return `${unitNumber} - ${name}`;
  }

  return stringFromPayload(mutation.payload, ["title", "form_name", "formName", "label", "caption", "document_title"]) || mutation.recordId || "";
}

export function createFailedSyncDetail(
  mutation: Pick<QueuedMutation, "attempts" | "id" | "lastError" | "operation" | "payload" | "recordId" | "table" | "updatedAt">,
  draft?: Pick<OfflineDraftSubmission, "formCode" | "formName"> | null,
): FailedSyncDetail {
  const context = mutationContextLabel(mutation);
  const draftTitle = draft?.formName ? `${draft.formName}${draft.formCode ? ` (${draft.formCode})` : ""}` : "";
  const title = draftTitle || mutationPayloadTitle(mutation) || context;

  return {
    id: mutation.id,
    recordId: mutation.recordId,
    title,
    context,
    lastError: mutation.lastError?.trim() || "Sync failed. Try again when you are back online.",
    attempts: mutation.attempts,
    updatedAt: mutation.updatedAt,
  };
}

export function createOfflineSubmissionPayload(input: {
  id: string;
  tenantId: string;
  formId: string;
  userId: string;
  deviceId: string;
  createdAt: string;
  locationId?: string | null;
}) {
  return {
    id: input.id,
    tenant_id: input.tenantId,
    form_id: input.formId,
    ...(input.locationId ? { location_id: input.locationId } : {}),
    submitted_by: input.userId,
    status: "submitted",
    source_device_id: input.deviceId,
    sync_state: "pending",
    submitted_at: input.createdAt,
    created_at: input.createdAt,
    updated_at: input.createdAt,
  };
}

function shouldSyncValue(value: Json | undefined) {
  if (value === undefined || value === null) {
    return false;
  }

  if (typeof value === "string") {
    return value.trim().length > 0;
  }

  if (Array.isArray(value)) {
    return value.length > 0;
  }

  return true;
}

export function createOfflineSubmissionValuePayloads(input: {
  tenantId: string;
  submissionId: string;
  values: Record<string, Json>;
  createdAt: string;
}): Database["public"]["Tables"]["submission_values"]["Insert"][] {
  return Object.entries(input.values)
    .filter(([, value]) => shouldSyncValue(value))
    .map(([formItemId, value]) => ({
      created_at: input.createdAt,
      form_item_id: formItemId,
      submission_id: input.submissionId,
      tenant_id: input.tenantId,
      updated_at: input.createdAt,
      value,
    }));
}

export function createOfflineSubmissionMutationPayload(input: {
  equipmentLinks?: Database["public"]["Tables"]["equipment_submission_link"]["Insert"][];
  equipmentMeterLogs?: Database["public"]["Tables"]["equipment_meter_log"]["Insert"][];
  equipmentStatusUpdates?: OfflineEquipmentStatusUpdate[];
  followUps?: Database["public"]["Tables"]["follow_ups"]["Insert"][];
  photos?: Database["public"]["Tables"]["submission_photos"]["Insert"][];
  signatures?: Database["public"]["Tables"]["signatures"]["Insert"][];
  sourceAssignment?: OfflineSubmissionSourceAssignment | null;
  submission: Database["public"]["Tables"]["submissions"]["Insert"];
  values: Database["public"]["Tables"]["submission_values"]["Insert"][];
}): OfflineSubmissionMutationPayload {
  return {
    equipmentLinks: input.equipmentLinks ?? [],
    equipmentMeterLogs: input.equipmentMeterLogs ?? [],
    equipmentStatusUpdates: input.equipmentStatusUpdates ?? [],
    followUps: input.followUps ?? [],
    photos: input.photos ?? [],
    signatures: input.signatures ?? [],
    ...(input.sourceAssignment ? { sourceAssignment: input.sourceAssignment } : {}),
    submission: input.submission,
    values: input.values,
  };
}

export async function warmOfflineStore() {
  const db = getOfflineDatabase();
  const now = nowIso();

  await db.syncMeta.put({
    key: "offline_store_ready",
    value: true,
    updatedAt: now,
  });
}

export async function cacheRecord(input: {
  table: OfflineRecordTable;
  id: string;
  tenantId?: string | null;
  payload: Json;
  expiresAt?: string | null;
}) {
  const db = getOfflineDatabase();
  const record: CachedRecord = {
    key: createOfflineRecordKey(input.table, input.id),
    table: input.table,
    id: input.id,
    tenantId: input.tenantId ?? null,
    payload: input.payload,
    updatedAt: nowIso(),
    expiresAt: input.expiresAt ?? null,
  };

  await db.cachedRecords.put(record);
  return record;
}

export async function queueOfflineMutation(input: {
  table: OfflineRecordTable;
  operation: QueuedMutationOperation;
  tenantId?: string | null;
  recordId?: string | null;
  payload?: Json;
}) {
  const db = getOfflineDatabase();
  const now = nowIso();
  const mutation: QueuedMutation = {
    id: getMutationId(),
    table: input.table,
    operation: input.operation,
    tenantId: input.tenantId ?? null,
    recordId: input.recordId ?? null,
    payload: input.payload ?? null,
    status: "pending",
    attempts: 0,
    createdAt: now,
    updatedAt: now,
    nextAttemptAt: null,
    lastError: null,
  };

  await db.queuedMutations.add(mutation);
  await db.syncMeta.put({ key: "last_queue_change_at", value: now, updatedAt: now });
  emitSyncQueueChanged();
  return mutation;
}

export async function getSyncSummary(): Promise<SyncSummary> {
  const db = getOfflineDatabase();
  const [pending, failed, lastSynced] = await Promise.all([
    db.queuedMutations.where("status").anyOf(["pending", "syncing"]).count(),
    db.queuedMutations.where("status").equals("failed").count(),
    db.syncMeta.get("last_synced_at"),
  ]);

  return {
    pending,
    failed,
    lastSyncedAt: typeof lastSynced?.value === "string" ? lastSynced.value : null,
  };
}

export async function listFailedSyncDetails(input: { tenantId: string; userId: string }) {
  const db = getOfflineDatabase();
  const [failedMutations, drafts] = await Promise.all([
    db.queuedMutations.where("status").equals("failed").toArray(),
    db.draftSubmissions.where("[tenantId+userId]").equals([input.tenantId, input.userId]).toArray(),
  ]);
  const draftsByMutationId = new Map(drafts.flatMap((draft) => (draft.queuedMutationId ? [[draft.queuedMutationId, draft]] : [])));
  const draftsById = new Map(drafts.map((draft) => [draft.id, draft]));

  return failedMutations
    .filter((mutation) => mutation.tenantId === input.tenantId || draftsByMutationId.has(mutation.id))
    .map((mutation) =>
      createFailedSyncDetail(
        mutation,
        draftsByMutationId.get(mutation.id) ?? (mutation.recordId ? draftsById.get(mutation.recordId) : null),
      ),
    )
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export async function markOfflineSyncComplete() {
  const db = getOfflineDatabase();
  const now = nowIso();
  await db.syncMeta.put({ key: "last_synced_at", value: now, updatedAt: now });
  emitSyncQueueChanged();
}

export function createRetryQueuedMutationUpdate(updatedAt = nowIso()) {
  return {
    status: "pending" as const,
    updatedAt,
    nextAttemptAt: null,
    lastError: null,
  };
}

async function updateDraftForRetriedMutation(mutation: QueuedMutation, updatedAt: string) {
  if (!mutation.recordId) {
    return;
  }

  const db = getOfflineDatabase();
  const draft = await db.draftSubmissions.get(mutation.recordId);

  if (!draft || draft.queuedMutationId !== mutation.id) {
    return;
  }

  await db.draftSubmissions.update(draft.id, {
    status: "queued",
    updatedAt,
    lastError: null,
  });
}

export async function retryFailedQueuedMutation(mutationId: string) {
  const db = getOfflineDatabase();
  const mutation = await db.queuedMutations.get(mutationId);

  if (!mutation || mutation.status !== "failed") {
    return getSyncSummary();
  }

  const now = nowIso();
  await db.queuedMutations.update(mutation.id, createRetryQueuedMutationUpdate(now));
  await updateDraftForRetriedMutation(mutation, now);
  await db.syncMeta.put({ key: "last_queue_retry_at", value: now, updatedAt: now });
  emitSyncQueueChanged();

  return getSyncSummary();
}

export async function retryFailedQueuedMutations() {
  const db = getOfflineDatabase();
  const failedMutations = await db.queuedMutations.where("status").equals("failed").toArray();
  const now = nowIso();

  await Promise.all(
    failedMutations.map(async (mutation) => {
      await db.queuedMutations.update(mutation.id, createRetryQueuedMutationUpdate(now));
      await updateDraftForRetriedMutation(mutation, now);
    }),
  );

  if (failedMutations.length > 0) {
    await db.syncMeta.put({ key: "last_queue_retry_at", value: now, updatedAt: now });
    emitSyncQueueChanged();
  }

  return getSyncSummary();
}

export async function removeFailedQueuedMutation(mutationId: string) {
  const db = getOfflineDatabase();
  const mutation = await db.queuedMutations.get(mutationId);

  if (!mutation || mutation.status !== "failed") {
    return getSyncSummary();
  }

  const now = nowIso();
  await db.queuedMutations.delete(mutation.id);

  if (mutation.recordId) {
    const draft = await db.draftSubmissions.get(mutation.recordId);

    if (draft?.queuedMutationId === mutation.id && draft.status === "failed") {
      await db.draftSubmissions.delete(draft.id);
    }
  }

  await db.syncMeta.put({ key: "last_queue_remove_at", value: now, updatedAt: now });
  emitSyncQueueChanged();

  return getSyncSummary();
}

export async function upsertDraftSubmission(draft: OfflineDraftSubmission) {
  const db = getOfflineDatabase();
  await db.draftSubmissions.put(draft);
  emitSyncQueueChanged();
  return draft;
}

export async function listDraftSubmissions(input: { tenantId: string; userId: string }) {
  const db = getOfflineDatabase();
  const drafts = await db.draftSubmissions.where("[tenantId+userId]").equals([input.tenantId, input.userId]).toArray();

  return drafts.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}
