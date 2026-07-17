import { describe, expect, it } from "vitest";
import {
  createOfflineQueueFlushMessage,
  isOfflineQueueFlushMessage,
  offlineQueueFlushMessageType,
  offlineQueueSyncTag,
} from "@/lib/offline/background-sync";

describe("offline background sync helpers", () => {
  it("creates the service worker flush message", () => {
    expect(createOfflineQueueFlushMessage()).toEqual({
      tag: offlineQueueSyncTag,
      type: offlineQueueFlushMessageType,
    });
  });

  it("recognizes only offline queue flush messages", () => {
    expect(isOfflineQueueFlushMessage(createOfflineQueueFlushMessage())).toBe(true);
    expect(isOfflineQueueFlushMessage({ tag: offlineQueueSyncTag, type: "OTHER" })).toBe(false);
    expect(isOfflineQueueFlushMessage({ tag: "other", type: offlineQueueFlushMessageType })).toBe(false);
    expect(isOfflineQueueFlushMessage(null)).toBe(false);
  });
});
