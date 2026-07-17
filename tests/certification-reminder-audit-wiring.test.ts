import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const certificationReminders = readFileSync(join(process.cwd(), "src/lib/certification-reminders.ts"), "utf8");
const cronRoute = readFileSync(join(process.cwd(), "src/app/api/cron/certification-reminders/route.ts"), "utf8");

describe("certification reminder audit wiring", () => {
  it("records tenant audit entries for each newly created reminder notification", () => {
    expect(certificationReminders).toContain('from "@/lib/tenant-audit"');
    expect(certificationReminders).toContain("recordTenantAuditEvent");
    expect(certificationReminders).toContain('action: "certification_reminder.notification.sent"');
    expect(certificationReminders).toContain('entityTable: "notifications"');
    expect(certificationReminders).toContain("insertedNotifications");
    expect(certificationReminders).toContain("auditError");
  });

  it("selects inserted notification IDs before writing audit entries", () => {
    expect(certificationReminders).toContain('.select("body, created_at, delivery_status, id, recipient_name, recipient_type, title, user_id")');
    expect(certificationReminders).toContain("CertificationReminderNotificationAuditRow");
    expect(certificationReminders).toContain("entityId: notification.id");
    expect(certificationReminders).toContain('source: options.auditSource ?? "page"');
  });

  it("uses the service role client for cron-created reminder audits", () => {
    expect(cronRoute).toContain("auditClient: supabase");
    expect(cronRoute).toContain('auditSource: "cron"');
    expect(cronRoute).toContain('action: "certification_reminders.send"');
  });
});
