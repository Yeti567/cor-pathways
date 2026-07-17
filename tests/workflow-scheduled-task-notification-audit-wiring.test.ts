import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const adminActions = readFileSync(join(process.cwd(), "src/app/admin/actions.ts"), "utf8");

describe("workflow scheduled task notification audit wiring", () => {
  it("audits first scheduled task assignment notifications", () => {
    expect(adminActions).toContain('recipient_type: "schedule_assignee"');
    expect(adminActions).toContain(
      '.select("body, created_at, delivery_status, id, recipient_name, recipient_type, submission_id, title, user_id")',
    );
    expect(adminActions).toContain('action: "workflow.scheduled_task.notification.sent"');
    expect(adminActions).toContain('source: "schedule_create"');
    expect(adminActions).toContain("task_id: task.id");
    expect(adminActions).toContain("schedule_id: schedule.id");
  });

  it("audits recurring scheduled task assignment notifications", () => {
    expect(adminActions).toContain("recurrenceNotificationCreatedAt");
    expect(adminActions).toContain('source: "recurrence"');
    expect(adminActions).toContain("task_id: nextTask.id");
    expect(adminActions).toContain("due_at: nextDueAt");
  });
});
