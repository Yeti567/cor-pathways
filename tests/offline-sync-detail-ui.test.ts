import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const offlineStatus = readFileSync(join(process.cwd(), "src/app/web/_components/OfflineStatus.tsx"), "utf8");
const syncQueue = readFileSync(join(process.cwd(), "src/lib/offline/sync-queue.ts"), "utf8");

describe("offline sync detail UI wiring", () => {
  it("lists failed sync records with record-specific controls", () => {
    expect(offlineStatus).toContain("listFailedSyncDetails");
    expect(offlineStatus).toContain("retryFailedQueuedMutation");
    expect(offlineStatus).toContain("removeFailedQueuedMutation");
    expect(offlineStatus).toContain("Failed sync details");
    expect(offlineStatus).toContain("Attempts: {item.attempts}");
  });

  it("supports retrying or removing one failed mutation at a time", () => {
    expect(syncQueue).toContain("export async function retryFailedQueuedMutation");
    expect(syncQueue).toContain("export async function removeFailedQueuedMutation");
    expect(syncQueue).toContain("createFailedSyncDetail");
    expect(syncQueue).toContain('db.queuedMutations.delete(mutation.id)');
    expect(syncQueue).toContain('draft.status === "failed"');
  });
});
