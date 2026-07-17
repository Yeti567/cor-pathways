import type { Database } from "@/types/database";

export type ReminderNotificationInsert = Database["public"]["Tables"]["notifications"]["Insert"];

function formatReminderDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

export function createOverdueWorkflowStepReminderNotification(input: {
  assigneeEmail: string | null;
  assigneeName: string;
  createdAt: string;
  dueAt: string;
  formName?: string | null;
  locationName?: string | null;
  tenantId: string;
  userId: string;
  workflowName: string;
}): ReminderNotificationInsert {
  const formPart = input.formName ? ` for ${input.formName}` : "";
  const locationPart = input.locationName ? ` at ${input.locationName}` : "";

  return {
    body: `${input.workflowName} step was due ${formatReminderDate(input.dueAt)}${formPart}${locationPart}.`,
    channel: "in_app",
    created_at: input.createdAt,
    delivered_at: input.createdAt,
    delivery_status: "delivered",
    recipient_contact: input.assigneeEmail,
    recipient_name: input.assigneeName,
    recipient_type: "workflow_step_assignee",
    tenant_id: input.tenantId,
    title: `Overdue workflow step: ${input.workflowName}`,
    user_id: input.userId,
  };
}
