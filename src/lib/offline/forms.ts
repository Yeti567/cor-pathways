import { buildEquipmentActionMetadata } from "@/lib/equipment";
import type { Database, Json } from "@/types/database";
import {
  createInspectionDefectFollowUps,
  createOfflineFollowUpPayloads,
  type OfflineCorrectiveActionDrafts,
  type OfflineEvidencePhotos,
} from "./follow-ups";
import type { OfflineFormItem, OfflineFormSection, OfflineFormSummary } from "./form-model";
import {
  cacheRecord,
  createOfflineSubmissionMutationPayload,
  createOfflineSubmissionPayload,
  createOfflineSubmissionValuePayloads,
  queueOfflineMutation,
  upsertDraftSubmission,
} from "./sync-queue";
import { getOfflineDatabase, type OfflineDraftSubmission, type OfflineSubmissionSourceAssignment } from "./db";

function getDraftId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `draft-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function getDeviceId() {
  const db = getOfflineDatabase();
  const existing = await db.syncMeta.get("device_id");

  if (typeof existing?.value === "string") {
    return existing.value;
  }

  const deviceId = getDraftId();
  const now = new Date().toISOString();
  await db.syncMeta.put({ key: "device_id", value: deviceId, updatedAt: now });
  return deviceId;
}

function isOfflineFormItem(value: Json): value is OfflineFormItem {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Record<string, Json | undefined>;

  return (
    typeof candidate.id === "string" &&
    typeof candidate.label === "string" &&
    typeof candidate.fieldType === "string" &&
    typeof candidate.required === "boolean" &&
    typeof candidate.flaggable === "boolean" &&
    typeof candidate.sortOrder === "number"
  );
}

function isOfflineFormSection(value: Json): value is OfflineFormSection {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Record<string, Json | undefined>;

  return (
    typeof candidate.id === "string" &&
    typeof candidate.title === "string" &&
    typeof candidate.sortOrder === "number" &&
    typeof candidate.collapsible === "boolean" &&
    typeof candidate.repeatable === "boolean" &&
    Array.isArray(candidate.items) &&
    candidate.items.every(isOfflineFormItem)
  );
}

function isRecord(value: Json | undefined): value is Record<string, Json | undefined> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function valueRecords(value: Json | undefined) {
  if (isRecord(value)) {
    return [value];
  }

  if (Array.isArray(value)) {
    return value.filter(isRecord);
  }

  return [];
}

function numericValue(value: Json | undefined) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

export function createOfflineEquipmentSubmissionPayloads(input: {
  createdAt: string;
  form: OfflineFormSummary;
  idFactory?: () => string;
  submissionId: string;
  tenantId: string;
  userId: string;
  values: Record<string, Json>;
}) {
  const idFactory = input.idFactory ?? getDraftId;
  const equipmentLinksByEquipmentId = new Map<string, Database["public"]["Tables"]["equipment_submission_link"]["Insert"]>();
  const meterLogs: Database["public"]["Tables"]["equipment_meter_log"]["Insert"][] = [];
  const equipmentItems = input.form.sections.flatMap((section) =>
    section.items.filter((item) => item.fieldType === "equipment_select"),
  );

  for (const item of equipmentItems) {
    for (const value of valueRecords(input.values[item.id])) {
      if (value.type !== "equipment" || typeof value.equipmentId !== "string" || !value.equipmentId.trim()) {
        continue;
      }

      const equipmentId = value.equipmentId.trim();

      if (!equipmentLinksByEquipmentId.has(equipmentId)) {
        equipmentLinksByEquipmentId.set(equipmentId, {
          action_metadata: buildEquipmentActionMetadata({
            action: "equipment.submission_link.auto",
            actorId: input.userId,
            capturedAt: input.createdAt,
            details: {
              form_code: input.form.code,
              form_id: input.form.id,
              field_id: item.id,
              submission_id: input.submissionId,
            },
            source: "worker_app",
          }),
          created_by: input.userId,
          equipment_id: equipmentId,
          form_type: input.form.code,
          id: idFactory(),
          link_source: "auto",
          linked_at: input.createdAt,
          submission_id: input.submissionId,
          tenant_id: input.tenantId,
        });
      }

      const meterReading = numericValue(value.meterReading);

      if (meterReading !== null) {
        meterLogs.push({
          action_metadata: buildEquipmentActionMetadata({
            action: "equipment.meter.from_inspection",
            actorId: input.userId,
            capturedAt: typeof value.meterRecordedAt === "string" ? value.meterRecordedAt : input.createdAt,
            details: {
              field_id: item.id,
              source_submission_id: input.submissionId,
              value: meterReading,
            },
            source: "worker_app",
          }),
          equipment_id: equipmentId,
          id: idFactory(),
          recorded_at: typeof value.meterRecordedAt === "string" ? value.meterRecordedAt : input.createdAt,
          recorded_by: input.userId,
          source: "inspection",
          source_submission_id: input.submissionId,
          tenant_id: input.tenantId,
          value: meterReading,
        });
      }
    }
  }

  return {
    equipmentLinks: Array.from(equipmentLinksByEquipmentId.values()),
    equipmentMeterLogs: meterLogs,
  };
}

function createOfflineSignaturePayloads(input: {
  createdAt: string;
  idFactory?: () => string;
  submissionId: string;
  tenantId: string;
  userId: string;
  values: Record<string, Json>;
}) {
  const idFactory = input.idFactory ?? getDraftId;

  return Object.values(input.values)
    .flatMap(valueRecords)
    .filter((value) => value.type === "signature" && typeof value.dataUrl === "string" && value.dataUrl.startsWith("data:image/"))
    .map((value) => ({
      created_at: input.createdAt,
      id: idFactory(),
      signed_at: typeof value.signedAt === "string" ? value.signedAt : input.createdAt,
      signer_name:
        typeof value.signerName === "string" && value.signerName.trim()
          ? value.signerName.trim()
          : "Worker signature",
      signer_user_id: input.userId,
      signature_path: String(value.dataUrl),
      submission_id: input.submissionId,
      tenant_id: input.tenantId,
    }));
}

function createOfflinePhotoPayloads(input: {
  createdAt: string;
  idFactory?: () => string;
  submissionId: string;
  tenantId: string;
  values: Record<string, Json>;
}) {
  const idFactory = input.idFactory ?? getDraftId;
  const photos: Database["public"]["Tables"]["submission_photos"]["Insert"][] = [];

  for (const [formItemId, value] of Object.entries(input.values)) {
    const records = Array.isArray(value)
      ? Array.from(value, (entry, index) => ({ index, value: entry }))
      : [{ index: null, value }];

    for (const record of records) {
      if (!isRecord(record.value)) {
        continue;
      }

      if (
        record.value.type !== "photo" ||
        typeof record.value.dataUrl !== "string" ||
        !record.value.dataUrl.startsWith("data:image/")
      ) {
        continue;
      }

      photos.push({
        caption: typeof record.value.caption === "string" && record.value.caption.trim() ? record.value.caption.trim() : null,
        captured_at: typeof record.value.capturedAt === "string" ? record.value.capturedAt : input.createdAt,
        created_at: input.createdAt,
        form_item_id: formItemId,
        id: idFactory(),
        local_dexie_id:
          record.index === null ? `${input.submissionId}:${formItemId}` : `${input.submissionId}:${formItemId}:${record.index}`,
        storage_path: String(record.value.dataUrl),
        submission_id: input.submissionId,
        tenant_id: input.tenantId,
        updated_at: input.createdAt,
      });
    }
  }

  return photos;
}

function createOfflineEvidencePhotoPayloads(input: {
  createdAt: string;
  evidencePhotos: OfflineEvidencePhotos;
  idFactory?: () => string;
  submissionId: string;
  tenantId: string;
}) {
  const idFactory = input.idFactory ?? getDraftId;
  const photos: Database["public"]["Tables"]["submission_photos"]["Insert"][] = [];

  for (const [key, evidence] of Object.entries(input.evidencePhotos)) {
    if (!evidence?.dataUrl?.startsWith("data:image/")) {
      continue;
    }

    const separator = key.indexOf(":");
    const formItemId = separator >= 0 ? key.slice(0, separator) : key;
    const repeatSegment = separator >= 0 ? key.slice(separator + 1) : null;

    photos.push({
      caption: typeof evidence.caption === "string" && evidence.caption.trim() ? evidence.caption.trim() : null,
      captured_at: evidence.capturedAt || input.createdAt,
      created_at: input.createdAt,
      form_item_id: formItemId,
      id: idFactory(),
      local_dexie_id: repeatSegment
        ? `${input.submissionId}:evidence:${formItemId}:${repeatSegment}`
        : `${input.submissionId}:evidence:${formItemId}`,
      storage_path: evidence.dataUrl,
      submission_id: input.submissionId,
      tenant_id: input.tenantId,
      updated_at: input.createdAt,
    });
  }

  return photos;
}

export async function cacheOfflineForms(forms: OfflineFormSummary[], expiresAt: string | null) {
  await Promise.all(
    forms.map((form) =>
      cacheRecord({
        table: "forms",
        id: form.id,
        tenantId: form.tenantId,
        expiresAt,
        payload: form,
      }),
    ),
  );
}

export async function getCachedOfflineForms(tenantId: string) {
  const db = getOfflineDatabase();
  const records = await db.cachedRecords.where("[table+tenantId]").equals(["forms", tenantId]).toArray();

  return records
    .map((record) => record.payload)
    .filter((payload): payload is OfflineFormSummary => {
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        return false;
      }

      const candidate = payload as Record<string, Json | undefined>;
      return (
        typeof candidate.id === "string" &&
        typeof candidate.tenantId === "string" &&
        typeof candidate.name === "string" &&
        typeof candidate.code === "string" &&
        typeof candidate.status === "string" &&
        (candidate.sections === undefined ||
          (Array.isArray(candidate.sections) && candidate.sections.every(isOfflineFormSection)))
      );
    })
    .map((form) => ({
      ...form,
      sections: form.sections ?? [],
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export async function createDraftSubmission(input: {
  correctiveActions?: OfflineCorrectiveActionDrafts;
  defectAssigneeUserId?: string | null;
  defectSeverities?: Record<string, string>;
  draftId?: string | null;
  evidencePhotos?: OfflineEvidencePhotos;
  form: OfflineFormSummary;
  locationId?: string | null;
  sourceAssignment?: OfflineSubmissionSourceAssignment | null;
  userId: string;
  values?: Record<string, Json>;
}) {
  const now = new Date().toISOString();
  const draftId = input.draftId ?? getDraftId();
  const deviceId = await getDeviceId();
  const payload = createOfflineSubmissionPayload({
    id: draftId,
    tenantId: input.form.tenantId,
    formId: input.form.id,
    userId: input.userId,
    deviceId,
    createdAt: now,
    locationId: input.locationId,
  });
  const values = createOfflineSubmissionValuePayloads({
    createdAt: now,
    submissionId: draftId,
    tenantId: input.form.tenantId,
    values: input.values ?? {},
  });
  const signatures = createOfflineSignaturePayloads({
    createdAt: now,
    submissionId: draftId,
    tenantId: input.form.tenantId,
    userId: input.userId,
    values: input.values ?? {},
  });
  const valuePhotos = createOfflinePhotoPayloads({
    createdAt: now,
    submissionId: draftId,
    tenantId: input.form.tenantId,
    values: input.values ?? {},
  });
  const evidencePhotos = createOfflineEvidencePhotoPayloads({
    createdAt: now,
    evidencePhotos: input.evidencePhotos ?? {},
    submissionId: draftId,
    tenantId: input.form.tenantId,
  });
  const photos = [...valuePhotos, ...evidencePhotos];
  const manualFollowUps = createOfflineFollowUpPayloads({
    assignedTo: input.userId,
    correctiveActions: input.correctiveActions ?? {},
    createdAt: now,
    form: input.form,
    submissionId: draftId,
    tenantId: input.form.tenantId,
  });
  const equipmentPayloads = createOfflineEquipmentSubmissionPayloads({
    createdAt: now,
    form: input.form,
    submissionId: draftId,
    tenantId: input.form.tenantId,
    userId: input.userId,
    values: input.values ?? {},
  });

  // Auto-create a corrective action for every failed pass/fail inspection item,
  // pinned to the inspected unit and routed to the maintenance owner. A worker
  // who already opened a manual corrective action on an item is left alone so we
  // do not duplicate it. Only worker-classified major defects pull the unit.
  const manualActionItemIds = new Set(
    Object.entries(input.correctiveActions ?? {})
      .filter(([, action]) => action.enabled)
      .map(([actionKey]) => {
        const separatorIndex = actionKey.indexOf(":");
        return separatorIndex >= 0 ? actionKey.slice(0, separatorIndex) : actionKey;
      }),
  );
  const inspectedEquipmentId = equipmentPayloads.equipmentLinks[0]?.equipment_id ?? null;
  const defectFollowUps = createInspectionDefectFollowUps({
    assignedTo: input.defectAssigneeUserId ?? input.userId,
    chosenSeverities: input.defectSeverities ?? {},
    createdAt: now,
    equipmentId: inspectedEquipmentId,
    excludeItemIds: manualActionItemIds,
    form: input.form,
    submissionId: draftId,
    tenantId: input.form.tenantId,
    values: input.values ?? {},
  });
  const followUps = [...manualFollowUps, ...defectFollowUps.followUps];
  const equipmentStatusUpdates = defectFollowUps.outOfServiceEquipmentIds.map((equipmentId) => ({
    equipmentId,
    reason: `Major defect found on ${input.form.name}`,
    status: "down",
  }));

  const mutation = await queueOfflineMutation({
    table: "submissions",
    operation: "upsert",
    tenantId: input.form.tenantId,
    recordId: draftId,
    payload: createOfflineSubmissionMutationPayload({
      equipmentLinks: equipmentPayloads.equipmentLinks,
      equipmentMeterLogs: equipmentPayloads.equipmentMeterLogs,
      equipmentStatusUpdates,
      followUps,
      photos,
      signatures,
      sourceAssignment: input.sourceAssignment,
      submission: payload,
      values,
    }),
  });

  const draft: OfflineDraftSubmission = {
    id: draftId,
    tenantId: input.form.tenantId,
    userId: input.userId,
    formId: input.form.id,
    formName: input.form.name,
    formCode: input.form.code,
    locationId: input.locationId ?? null,
    status: "queued",
    values: input.values ?? {},
    correctiveActions: input.correctiveActions ?? {},
    defectSeverities: input.defectSeverities ?? {},
    evidencePhotos: input.evidencePhotos ?? {},
    ...(input.sourceAssignment ? { sourceAssignment: input.sourceAssignment } : {}),
    queuedMutationId: mutation.id,
    createdAt: now,
    updatedAt: now,
    lastError: null,
  };

  await upsertDraftSubmission(draft);
  return draft;
}

export function createOfflineDraftSubmissionRecord(input: {
  correctiveActions?: OfflineCorrectiveActionDrafts;
  createdAt?: string;
  defectSeverities?: Record<string, string>;
  draftId: string;
  evidencePhotos?: OfflineEvidencePhotos;
  existingCreatedAt?: string | null;
  form: OfflineFormSummary;
  locationId?: string | null;
  sourceAssignment?: OfflineSubmissionSourceAssignment | null;
  userId: string;
  values?: Record<string, Json>;
}): OfflineDraftSubmission {
  const now = input.createdAt ?? new Date().toISOString();

  return {
    id: input.draftId,
    tenantId: input.form.tenantId,
    userId: input.userId,
    formId: input.form.id,
    formName: input.form.name,
    formCode: input.form.code,
    locationId: input.locationId ?? null,
    status: "draft",
    values: input.values ?? {},
    correctiveActions: input.correctiveActions ?? {},
    defectSeverities: input.defectSeverities ?? {},
    evidencePhotos: input.evidencePhotos ?? {},
    ...(input.sourceAssignment ? { sourceAssignment: input.sourceAssignment } : {}),
    queuedMutationId: null,
    createdAt: input.existingCreatedAt ?? now,
    updatedAt: now,
    lastError: null,
  };
}

export async function saveOfflineDraftSubmission(input: {
  correctiveActions?: OfflineCorrectiveActionDrafts;
  defectSeverities?: Record<string, string>;
  draftId?: string | null;
  evidencePhotos?: OfflineEvidencePhotos;
  form: OfflineFormSummary;
  locationId?: string | null;
  sourceAssignment?: OfflineSubmissionSourceAssignment | null;
  userId: string;
  values?: Record<string, Json>;
}) {
  const db = getOfflineDatabase();
  const draftId = input.draftId ?? getDraftId();
  const existing = input.draftId ? await db.draftSubmissions.get(input.draftId) : null;
  const draft = createOfflineDraftSubmissionRecord({
    correctiveActions: input.correctiveActions,
    defectSeverities: input.defectSeverities,
    draftId,
    evidencePhotos: input.evidencePhotos,
    existingCreatedAt: existing?.createdAt,
    form: input.form,
    locationId: input.locationId,
    sourceAssignment: input.sourceAssignment,
    userId: input.userId,
    values: input.values,
  });

  await upsertDraftSubmission(draft);
  return draft;
}
