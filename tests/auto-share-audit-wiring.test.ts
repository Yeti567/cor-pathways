import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const auditRoute = readFileSync(
  join(process.cwd(), "src/app/api/audit/auto-share-notifications/route.ts"),
  "utf8",
);
const offlineSync = readFileSync(join(process.cwd(), "src/lib/offline/sync.ts"), "utf8");

describe("auto-share notification audit wiring", () => {
  it("records audit events for created queued, skipped, delivered, and failed Auto-share notifications", () => {
    expect(auditRoute).toContain('from "@/lib/tenant-audit"');
    expect(auditRoute).toContain("recordTenantAuditEvent");
    expect(auditRoute).toContain("autoShareNotificationAuditAction(notification.delivery_status)");
    expect(auditRoute).toContain('entityTable: "notifications"');
    expect(auditRoute).toContain('source: "offline_sync"');
  });

  it("calls the server audit route after offline sync creates Auto-share notification rows", () => {
    expect(offlineSync).toContain('fetch("/api/audit/auto-share-notifications"');
    expect(offlineSync).toContain("recordAutoShareNotificationAuditEvents");
    expect(offlineSync).toContain('.select("id")');
    expect(offlineSync).toContain("notificationIds");
  });
});
