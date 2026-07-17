"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { AlertTriangle, CheckCircle2, CloudOff, RefreshCw, Trash2, Wifi } from "lucide-react";
import { isOfflineQueueFlushMessage, registerOfflineQueueSync } from "@/lib/offline/background-sync";
import { flushQueuedMutations } from "@/lib/offline/sync";
import {
  cacheRecord,
  listFailedSyncDetails,
  removeFailedQueuedMutation,
  getSyncSummary,
  retryFailedQueuedMutation,
  retryFailedQueuedMutations,
  syncQueueChangedEvent,
  type FailedSyncDetail,
  type SyncSummary,
} from "@/lib/offline/sync-queue";

type OfflineStatusProps = {
  userId: string;
  tenantId: string;
  tenantName: string;
  fullName: string;
  offlineSyncDays: number;
};

function addDays(date: Date, days: number) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function subscribeOnlineStatus(onStoreChange: () => void) {
  window.addEventListener("online", onStoreChange);
  window.addEventListener("offline", onStoreChange);

  return () => {
    window.removeEventListener("online", onStoreChange);
    window.removeEventListener("offline", onStoreChange);
  };
}

function getOnlineStatusSnapshot() {
  return navigator.onLine;
}

function getServerOnlineStatusSnapshot() {
  return true;
}

export function OfflineStatus({
  userId,
  tenantId,
  tenantName,
  fullName,
  offlineSyncDays,
}: OfflineStatusProps) {
  const isOnline = useSyncExternalStore(
    subscribeOnlineStatus,
    getOnlineStatusSnapshot,
    getServerOnlineStatusSnapshot,
  );
  const [isRetrying, setIsRetrying] = useState(false);
  const [busyMutationId, setBusyMutationId] = useState<string | null>(null);
  const [failedDetails, setFailedDetails] = useState<FailedSyncDetail[]>([]);
  const [summary, setSummary] = useState<SyncSummary>({ pending: 0, failed: 0, lastSyncedAt: null });

  const expiresAt = useMemo(() => addDays(new Date(), offlineSyncDays).toISOString(), [offlineSyncDays]);

  useEffect(() => {
    let active = true;

    async function refreshSummary() {
      const [nextSummary, nextFailedDetails] = await Promise.all([
        getSyncSummary(),
        listFailedSyncDetails({ tenantId, userId }),
      ]);

      if (nextSummary.pending > 0) {
        await registerOfflineQueueSync().catch(() => undefined);
      }

      if (active) {
        setSummary(nextSummary);
        setFailedDetails(nextFailedDetails);
      }
    }

    async function flushAndRefresh() {
      const nextSummary = await flushQueuedMutations();
      const nextFailedDetails = await listFailedSyncDetails({ tenantId, userId });

      if (active) {
        setSummary(nextSummary);
        setFailedDetails(nextFailedDetails);
      }
    }

    async function handleOnline() {
      await flushAndRefresh();
    }

    const handleOffline = () => {
      refreshSummary().catch(() => undefined);
    };

    const handleServiceWorkerMessage = (event: MessageEvent) => {
      if (!isOfflineQueueFlushMessage(event.data)) {
        return;
      }

      flushAndRefresh().catch(() => undefined);
    };

    refreshSummary().catch(() => undefined);

    if (navigator.onLine) {
      flushAndRefresh().catch(() => undefined);
    }

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    window.addEventListener(syncQueueChangedEvent, refreshSummary);
    navigator.serviceWorker?.addEventListener("message", handleServiceWorkerMessage);

    return () => {
      active = false;
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener(syncQueueChangedEvent, refreshSummary);
      navigator.serviceWorker?.removeEventListener("message", handleServiceWorkerMessage);
    };
  }, [tenantId, userId]);

  useEffect(() => {
    let active = true;

    async function primeOfflineProfile() {
      await Promise.all([
        cacheRecord({
          table: "users",
          id: userId,
          tenantId,
          expiresAt,
          payload: {
            id: userId,
            tenant_id: tenantId,
            full_name: fullName,
            offline_sync_days: offlineSyncDays,
          },
        }),
        cacheRecord({
          table: "tenants",
          id: tenantId,
          tenantId,
          expiresAt,
          payload: {
            id: tenantId,
            name: tenantName,
          },
        }),
      ]);

      const [nextSummary, nextFailedDetails] = await Promise.all([
        getSyncSummary(),
        listFailedSyncDetails({ tenantId, userId }),
      ]);

      if (active) {
        setSummary(nextSummary);
        setFailedDetails(nextFailedDetails);
      }
    }

    primeOfflineProfile().catch(() => undefined);

    return () => {
      active = false;
    };
  }, [expiresAt, fullName, offlineSyncDays, tenantId, tenantName, userId]);

  async function retryFailedSync() {
    if (!isOnline || isRetrying) {
      return;
    }

    setIsRetrying(true);

    try {
      await retryFailedQueuedMutations();
      const nextSummary = await flushQueuedMutations();
      const nextFailedDetails = await listFailedSyncDetails({ tenantId, userId });
      setSummary(nextSummary);
      setFailedDetails(nextFailedDetails);
    } finally {
      setIsRetrying(false);
    }
  }

  async function retryFailedRecord(mutationId: string) {
    if (!isOnline || busyMutationId) {
      return;
    }

    setBusyMutationId(mutationId);

    try {
      await retryFailedQueuedMutation(mutationId);
      const nextSummary = await flushQueuedMutations();
      const nextFailedDetails = await listFailedSyncDetails({ tenantId, userId });
      setSummary(nextSummary);
      setFailedDetails(nextFailedDetails);
    } finally {
      setBusyMutationId(null);
    }
  }

  async function removeFailedRecord(mutationId: string) {
    if (busyMutationId) {
      return;
    }

    setBusyMutationId(mutationId);

    try {
      const nextSummary = await removeFailedQueuedMutation(mutationId);
      const nextFailedDetails = await listFailedSyncDetails({ tenantId, userId });
      setSummary(nextSummary);
      setFailedDetails(nextFailedDetails);
    } finally {
      setBusyMutationId(null);
    }
  }

  const StatusIcon = isOnline ? Wifi : CloudOff;
  const statusText = isOnline ? "Online" : "Offline";
  const queueText =
    summary.failed > 0 ? `${summary.failed} failed` : summary.pending > 0 ? `${summary.pending} queued` : "Synced";

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div
            className={
              isOnline
                ? "flex h-10 w-10 items-center justify-center rounded-md bg-[var(--surface-muted)] text-[var(--primary)]"
                : "flex h-10 w-10 items-center justify-center rounded-md bg-orange-50 text-[var(--warning)]"
            }
          >
            <StatusIcon className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <p className="text-sm font-semibold text-[var(--ink)]">{statusText}</p>
            <p className="text-xs text-[var(--ink-muted)]">Device cache active</p>
          </div>
        </div>
        {summary.failed > 0 ? (
          <button
            className="inline-flex h-8 items-center gap-2 rounded-md border border-[var(--border)] px-2 text-xs font-semibold text-[var(--warning)] transition hover:bg-[var(--surface-muted)] disabled:cursor-not-allowed disabled:opacity-60"
            disabled={!isOnline || isRetrying}
            onClick={retryFailedSync}
            type="button"
          >
            <RefreshCw className={isRetrying ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} aria-hidden="true" />
            Retry {summary.failed}
          </button>
        ) : (
          <span className="inline-flex h-8 items-center gap-2 rounded-md border border-[var(--border)] px-2 text-xs font-semibold text-[var(--ink-muted)]">
            {summary.pending ? (
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <CheckCircle2 className="h-3.5 w-3.5 text-[var(--success)]" aria-hidden="true" />
            )}
            {queueText}
          </span>
        )}
      </div>
      {failedDetails.length > 0 ? (
        <div className="mt-4 grid gap-2 rounded-md border border-orange-200 bg-orange-50 p-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-[var(--warning)]">
            <AlertTriangle className="h-4 w-4" aria-hidden="true" />
            Failed sync details
          </div>
          {failedDetails.map((item) => {
            const isBusy = busyMutationId === item.id;

            return (
              <article
                aria-label={`Failed sync ${item.title}`}
                className="rounded-md border border-orange-200 bg-white p-3"
                key={item.id}
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-[var(--ink)]">{item.title}</p>
                    <p className="text-xs font-semibold uppercase text-[var(--ink-muted)]">{item.context}</p>
                    <p className="mt-1 text-sm text-[var(--danger)]">{item.lastError}</p>
                    <p className="mt-1 text-xs text-[var(--ink-muted)]">Attempts: {item.attempts}</p>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    <button
                      className="inline-flex h-8 items-center justify-center gap-2 rounded-md border border-[var(--border)] bg-white px-2 text-xs font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)] disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={!isOnline || Boolean(busyMutationId)}
                      onClick={() => retryFailedRecord(item.id)}
                      type="button"
                    >
                      <RefreshCw className={isBusy ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} aria-hidden="true" />
                      Retry
                    </button>
                    <button
                      className="inline-flex h-8 items-center justify-center gap-2 rounded-md border border-[var(--danger)] bg-white px-2 text-xs font-semibold text-[var(--danger)] transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={Boolean(busyMutationId)}
                      onClick={() => removeFailedRecord(item.id)}
                      type="button"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      Remove
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
