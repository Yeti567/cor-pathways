import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const adminActions = readFileSync(join(process.cwd(), "src/app/admin/actions.ts"), "utf8");

describe("workflow overdue reminder audit wiring", () => {
  it("records tenant audit entries for each newly created overdue reminder notification", () => {
    expect(adminActions).toContain("ReminderNotificationAuditRow");
    expect(adminActions).toContain("insertedNotifications");
    expect(adminActions).toContain(
      '.select("body, created_at, delivery_status, id, recipient_name, recipient_type, submission_id, title, user_id")',
    );
    expect(adminActions).toContain('action: "workflow.overdue_reminder.notification.sent"');
    expect(adminActions).toContain("entityId: notification.id");
    expect(adminActions).toContain('entityTable: "notifications"');
    expect(adminActions).toContain('source: "admin_overdue_reminders"');
  });

  it("keeps the summary audit event for the reminder send operation", () => {
    expect(adminActions).toContain('action: "workflow.overdue_reminders.send"');
    expect(adminActions).toContain("notification_count: newNotifications.length");
    expect(adminActions).toContain("workflow_run_step_count: overdueWorkflowRunSteps.length");
  });
});
