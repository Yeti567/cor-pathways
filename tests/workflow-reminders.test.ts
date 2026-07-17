import { describe, expect, it } from "vitest";
import { createOverdueWorkflowStepReminderNotification } from "@/lib/workflow-reminders";

describe("workflow reminders", () => {
  it("builds overdue workflow step notifications with form and location context", () => {
    expect(
      createOverdueWorkflowStepReminderNotification({
        assigneeEmail: "worker@example.com",
        assigneeName: "Will Worker",
        createdAt: "2026-05-23T08:00:00.000Z",
        dueAt: "2026-05-22T10:00:00.000Z",
        formName: "Incident Investigation",
        locationName: "North Yard",
        tenantId: "tenant-1",
        userId: "user-1",
        workflowName: "Incident workflow",
      }),
    ).toMatchObject({
      body: "Incident workflow step was due May 22, 2026 for Incident Investigation at North Yard.",
      channel: "in_app",
      delivered_at: "2026-05-23T08:00:00.000Z",
      delivery_status: "delivered",
      recipient_contact: "worker@example.com",
      recipient_name: "Will Worker",
      recipient_type: "workflow_step_assignee",
      tenant_id: "tenant-1",
      title: "Overdue workflow step: Incident workflow",
      user_id: "user-1",
    });
  });
});
