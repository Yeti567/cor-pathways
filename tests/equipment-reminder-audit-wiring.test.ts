import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const equipmentReminders = readFileSync(join(process.cwd(), "src/lib/equipment-reminders.ts"), "utf8");

describe("equipment reminder audit wiring", () => {
  it("records tenant audit entries for each newly created reminder notification", () => {
    expect(equipmentReminders).toContain('from "@/lib/tenant-audit"');
    expect(equipmentReminders).toContain("recordTenantAuditEvent");
    expect(equipmentReminders).toContain('action: "equipment_reminder.notification.sent"');
    expect(equipmentReminders).toContain('entityTable: "notifications"');
    expect(equipmentReminders).toContain("insertedNotifications");
    expect(equipmentReminders).toContain("auditError");
  });

  it("selects inserted notification IDs before writing audit entries", () => {
    expect(equipmentReminders).toContain(
      '.select("body, created_at, delivery_status, id, recipient_name, recipient_type, title, user_id")',
    );
    expect(equipmentReminders).toContain("EquipmentReminderNotificationAuditRow");
    expect(equipmentReminders).toContain("entityId: notification.id");
    expect(equipmentReminders).toContain('source: options.auditSource ?? "page"');
  });
});
