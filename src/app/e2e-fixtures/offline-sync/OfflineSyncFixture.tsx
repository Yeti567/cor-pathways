"use client";

import { useState } from "react";
import { OfflineStatus } from "@/app/web/_components/OfflineStatus";
import { createOfflineQueueFlushMessage, registerOfflineQueueSync } from "@/lib/offline/background-sync";
import { getOfflineDatabase } from "@/lib/offline/db";
import { flushQueuedMutations } from "@/lib/offline/sync";
import {
  createOfflineSubmissionMutationPayload,
  queueOfflineMutation,
  upsertDraftSubmission,
} from "@/lib/offline/sync-queue";
import type { Json } from "@/types/database";

type OfflineSyncFixtureProps = {
  runId: string;
};

const issuedAt = "2026-05-24T10:00:00.000Z";

function submissionPayload(input: {
  formId: string;
  submissionId: string;
  tenantId: string;
  userId: string;
}) {
  return {
    created_at: issuedAt,
    form_id: input.formId,
    id: input.submissionId,
    source_device_id: "e2e-offline-sync",
    status: "submitted",
    submitted_at: issuedAt,
    submitted_by: input.userId,
    sync_state: "pending",
    tenant_id: input.tenantId,
    updated_at: issuedAt,
  };
}

function submissionValue(input: { formItemId: string; submissionId: string; tenantId: string; value: Json }) {
  return {
    created_at: issuedAt,
    form_item_id: input.formItemId,
    submission_id: input.submissionId,
    tenant_id: input.tenantId,
    updated_at: issuedAt,
    value: input.value,
  };
}

export function OfflineSyncFixture({ runId }: OfflineSyncFixtureProps) {
  const tenantId = `tenant-${runId}`;
  const userId = `worker-${runId}`;
  const [fixtureStatus, setFixtureStatus] = useState("Ready");
  const [backgroundSyncStatus, setBackgroundSyncStatus] = useState("Not checked");

  async function resetOfflineStore() {
    const db = getOfflineDatabase();
    await Promise.all([
      db.cachedRecords.clear(),
      db.draftSubmissions.clear(),
      db.queuedMutations.clear(),
      db.syncMeta.clear(),
    ]);
  }

  async function queueFailedSubmission(input: {
    formCode: string;
    formId: string;
    formItemId: string;
    formName: string;
    localAttachment: "photo" | "signature";
    submissionId: string;
  }) {
    const mutation = await queueOfflineMutation({
      operation: "upsert",
      recordId: input.submissionId,
      table: "submissions",
      tenantId,
      payload: createOfflineSubmissionMutationPayload({
        photos:
          input.localAttachment === "photo"
            ? [
                {
                  caption: "Unsupported photo upload",
                  captured_at: issuedAt,
                  created_at: issuedAt,
                  form_item_id: input.formItemId,
                  id: `photo-${input.submissionId}`,
                  local_dexie_id: `local-photo-${input.submissionId}`,
                  storage_path: "data:application/pdf;base64,JVBERi0xLjQ=",
                  submission_id: input.submissionId,
                  tenant_id: tenantId,
                  updated_at: issuedAt,
                },
              ]
            : [],
        signatures:
          input.localAttachment === "signature"
            ? [
                {
                  created_at: issuedAt,
                  id: `signature-${input.submissionId}`,
                  signature_path: "data:text/plain;base64,U0lHTkFUVVJF",
                  signed_at: issuedAt,
                  signer_name: "Blake Cowan",
                  signer_user_id: userId,
                  submission_id: input.submissionId,
                  tenant_id: tenantId,
                },
              ]
            : [],
        submission: submissionPayload({
          formId: input.formId,
          submissionId: input.submissionId,
          tenantId,
          userId,
        }),
        values: [
          submissionValue({
            formItemId: input.formItemId,
            submissionId: input.submissionId,
            tenantId,
            value:
              input.localAttachment === "signature"
                ? { dataUrl: "data:text/plain;base64,U0lHTkFUVVJF", type: "signature" }
                : { dataUrl: "data:application/pdf;base64,JVBERi0xLjQ=", type: "photo" },
          }),
        ],
      }),
    });

    await upsertDraftSubmission({
      createdAt: issuedAt,
      formCode: input.formCode,
      formId: input.formId,
      formName: input.formName,
      id: input.submissionId,
      lastError: null,
      locationId: null,
      queuedMutationId: mutation.id,
      status: "queued",
      tenantId,
      updatedAt: issuedAt,
      userId,
      values: {},
    });
  }

  async function seedUploadFailures() {
    setFixtureStatus("Seeding upload failures...");
    await resetOfflineStore();
    await queueFailedSubmission({
      formCode: "SIG",
      formId: `form-signature-${runId}`,
      formItemId: `item-signature-${runId}`,
      formName: "Signature Upload Check",
      localAttachment: "signature",
      submissionId: `submission-signature-${runId}`,
    });
    await queueFailedSubmission({
      formCode: "PHOTO",
      formId: `form-photo-${runId}`,
      formItemId: `item-photo-${runId}`,
      formName: "Photo Upload Check",
      localAttachment: "photo",
      submissionId: `submission-photo-${runId}`,
    });
    await flushQueuedMutations();
    setFixtureStatus("Upload failures seeded");
  }

  async function checkBackgroundSync() {
    try {
      if (!("serviceWorker" in navigator)) {
        setBackgroundSyncStatus("Background sync unavailable");
        return;
      }

      await navigator.serviceWorker.register("/sw.js");
      const result = await registerOfflineQueueSync();
      navigator.serviceWorker.controller?.postMessage(createOfflineQueueFlushMessage());
      setBackgroundSyncStatus(result === "registered" ? "Background sync registered" : "Background sync unavailable");
    } catch {
      setBackgroundSyncStatus("Background sync unavailable");
    }
  }

  return (
    <main className="min-h-screen bg-[var(--background)] p-4">
      <section className="mx-auto grid max-w-2xl gap-4">
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
          <h1 className="text-xl font-bold text-[var(--ink)]">Offline Sync Fixture</h1>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">{fixtureStatus}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              className="inline-flex h-10 items-center justify-center rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-white transition hover:bg-[var(--primary-dark)]"
              onClick={() => seedUploadFailures().catch((error) => setFixtureStatus(error instanceof Error ? error.message : "Seed failed"))}
              type="button"
            >
              Seed upload failures
            </button>
            <button
              className="inline-flex h-10 items-center justify-center rounded-md border border-[var(--border)] bg-white px-4 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)]"
              onClick={() => checkBackgroundSync().catch(() => setBackgroundSyncStatus("Background sync unavailable"))}
              type="button"
            >
              Check background sync
            </button>
          </div>
          <p className="mt-3 text-sm font-semibold text-[var(--ink)]">{backgroundSyncStatus}</p>
        </div>
        <OfflineStatus
          fullName="Blake Cowan"
          offlineSyncDays={14}
          tenantId={tenantId}
          tenantName="E2E Tenant"
          userId={userId}
        />
      </section>
    </main>
  );
}
