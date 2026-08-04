import Dexie, { type Table } from "dexie";
import type { Json, TenantScopedTable } from "@/types/database";
import type { OfflineCorrectiveActionDrafts, OfflineEvidencePhotos } from "./follow-ups";

export type OfflineRecordTable = TenantScopedTable | "tenants" | "consultants";
export type QueuedMutationStatus = "pending" | "syncing" | "failed";
export type QueuedMutationOperation = "insert" | "update" | "delete" | "upsert";
export type OfflineSubmissionSourceAssignment = {
  source: "scheduled" | "workflow";
  sourceId: string;
};

export type CachedRecord = {
  key: string;
  table: OfflineRecordTable;
  id: string;
  tenantId: string | null;
  payload: Json;
  updatedAt: string;
  expiresAt: string | null;
};

export type QueuedMutation = {
  id: string;
  table: OfflineRecordTable;
  operation: QueuedMutationOperation;
  tenantId: string | null;
  recordId: string | null;
  payload: Json;
  status: QueuedMutationStatus;
  attempts: number;
  createdAt: string;
  updatedAt: string;
  nextAttemptAt: string | null;
  lastError: string | null;
};

export type OfflineDraftSubmission = {
  id: string;
  tenantId: string;
  userId: string;
  formId: string;
  formName: string;
  formCode: string;
  locationId: string | null;
  status: "draft" | "queued" | "syncing" | "failed" | "synced";
  values: Record<string, Json>;
  correctiveActions?: OfflineCorrectiveActionDrafts;
  defectSeverities?: Record<string, string>;
  evidencePhotos?: OfflineEvidencePhotos;
  sourceAssignment?: OfflineSubmissionSourceAssignment | null;
  queuedMutationId: string | null;
  createdAt: string;
  updatedAt: string;
  lastError: string | null;
};

export type SyncMeta = {
  key: string;
  value: Json;
  updatedAt: string;
};

class CorPathwaysOfflineDatabase extends Dexie {
  cachedRecords!: Table<CachedRecord, string>;
  queuedMutations!: Table<QueuedMutation, string>;
  draftSubmissions!: Table<OfflineDraftSubmission, string>;
  syncMeta!: Table<SyncMeta, string>;

  constructor() {
    /*
      DO NOT RENAME THIS STRING, despite the "core" spelling being wrong everywhere
      else. It is the IndexedDB database name on every device that has ever run this
      app. Changing it does not rename the existing database, it creates a new empty
      one, orphaning every cached record and every queued mutation still waiting to
      sync. On an offline first app used by crews with no signal, that is unsynced
      field paperwork silently disappearing.

      If it ever genuinely needs to change, it needs a migration that opens the old
      database, copies the tables across and then deletes it, not an edit here.
    */
    super("core-pathways-offline");

    this.version(1).stores({
      cachedRecords: "&key, table, tenantId, updatedAt, expiresAt",
      queuedMutations: "&id, status, table, tenantId, createdAt, nextAttemptAt",
      syncMeta: "&key, updatedAt",
    });

    this.version(2).stores({
      cachedRecords: "&key, table, tenantId, [table+tenantId], updatedAt, expiresAt",
      queuedMutations: "&id, status, table, tenantId, createdAt, nextAttemptAt",
      draftSubmissions: "&id, tenantId, userId, [tenantId+userId], formId, status, updatedAt",
      syncMeta: "&key, updatedAt",
    });
  }
}

let offlineDatabase: CorPathwaysOfflineDatabase | null = null;

export function getOfflineDatabase() {
  if (typeof window === "undefined") {
    throw new Error("Offline database is only available in the browser.");
  }

  offlineDatabase ??= new CorPathwaysOfflineDatabase();
  return offlineDatabase;
}

export function createOfflineRecordKey(table: OfflineRecordTable, id: string) {
  return `${table}:${id}`;
}
