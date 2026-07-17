import type { Database } from "@/types/database";

export const followUpStatusOptions = [
  { value: "open", label: "Open" },
  { value: "assigned", label: "Assigned" },
  { value: "in_progress", label: "In Progress" },
  { value: "completed", label: "Completed" },
  { value: "signed_off", label: "Signed Off" },
] as const;

export type FollowUpStatus = (typeof followUpStatusOptions)[number]["value"];
export type FollowUpNotificationInsert = Database["public"]["Tables"]["notifications"]["Insert"];

const followUpStatusValues = new Set<string>(followUpStatusOptions.map((option) => option.value));

export function coerceFollowUpStatus(value: string): FollowUpStatus {
  return followUpStatusValues.has(value) ? (value as FollowUpStatus) : "open";
}

export function formatFollowUpStatus(status: string) {
  return followUpStatusOptions.find((option) => option.value === status)?.label ?? status;
}

export function isClosedFollowUpStatus(status: string) {
  return status === "completed" || status === "signed_off";
}

export function followUpStatusClass(status: string) {
  switch (status) {
    case "signed_off":
      return "bg-emerald-50 text-[var(--success)]";
    case "completed":
      return "bg-teal-50 text-[var(--primary)]";
    case "in_progress":
      return "bg-blue-50 text-blue-700";
    case "assigned":
      return "bg-amber-50 text-[var(--warning)]";
    default:
      return "bg-[var(--surface-muted)] text-[var(--ink-muted)]";
  }
}

export function createFollowUpReadyForSignOffNotification(input: {
  createdAt: string;
  followUpTitle: string;
  parentSubmissionId: string;
  tenantId: string;
  userId: string;
}): FollowUpNotificationInsert {
  return {
    body: `${input.followUpTitle} was marked complete and is ready for sign-off.`,
    channel: "in_app",
    created_at: input.createdAt,
    delivered_at: input.createdAt,
    delivery_status: "delivered",
    recipient_type: "follow_up_flagger",
    submission_id: input.parentSubmissionId,
    tenant_id: input.tenantId,
    title: "Corrective action ready for sign-off",
    user_id: input.userId,
  };
}
