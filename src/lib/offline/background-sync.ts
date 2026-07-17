export const offlineQueueSyncTag = "core-pathways-sync-queue";
export const offlineQueueFlushMessageType = "CORE_PATHWAYS_FLUSH_QUEUE";

type ServiceWorkerRegistrationWithSync = ServiceWorkerRegistration & {
  sync?: {
    register: (tag: string) => Promise<void>;
  };
};

export type OfflineQueueFlushMessage = {
  tag: typeof offlineQueueSyncTag;
  type: typeof offlineQueueFlushMessageType;
};

export function createOfflineQueueFlushMessage(): OfflineQueueFlushMessage {
  return {
    tag: offlineQueueSyncTag,
    type: offlineQueueFlushMessageType,
  };
}

export function isOfflineQueueFlushMessage(value: unknown): value is OfflineQueueFlushMessage {
  if (!value || typeof value !== "object") {
    return false;
  }

  const message = value as Record<string, unknown>;
  return message.type === offlineQueueFlushMessageType && message.tag === offlineQueueSyncTag;
}

export function backgroundSyncSupported() {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "SyncManager" in window
  );
}

export async function registerOfflineQueueSync() {
  if (!backgroundSyncSupported()) {
    return "unavailable" as const;
  }

  const registration = (await navigator.serviceWorker.ready) as ServiceWorkerRegistrationWithSync;

  if (!registration.sync) {
    return "unavailable" as const;
  }

  await registration.sync.register(offlineQueueSyncTag);
  return "registered" as const;
}
