import type { Database } from "@/types/database";

export const autoShareRecipientTypeOptions = [
  { value: "company_contact", label: "Company Contact" },
  { value: "client_contact", label: "Client Contact" },
  { value: "supervisor", label: "Supervisor" },
  { value: "regulator", label: "Regulator" },
  { value: "external_email", label: "External Email" },
  { value: "other", label: "Other" },
] as const;

export const autoShareDeliveryStatusOptions = [
  { value: "all", label: "All" },
  { value: "queued", label: "Queued" },
  { value: "delivered", label: "Delivered" },
  { value: "failed", label: "Failed" },
  { value: "skipped", label: "Skipped" },
] as const;

export type AutoShareRecipientType = (typeof autoShareRecipientTypeOptions)[number]["value"];
export type AutoShareDeliveryStatusFilter = (typeof autoShareDeliveryStatusOptions)[number]["value"];
export type AutoShareRecipientRow = Database["public"]["Tables"]["auto_share_recipients"]["Row"];
export type AutoShareNotificationInsert = Database["public"]["Tables"]["notifications"]["Insert"];
export type AutoShareDeliveryAttemptResult = { error: string; ok: false } | { ok: true };

export type AutoShareUser = {
  id: string;
  email: string;
  full_name: string;
};

export type AutoShareSubmission = Pick<
  Database["public"]["Tables"]["submissions"]["Row"],
  "created_at" | "form_id" | "id" | "location_id" | "submitted_by" | "tenant_id"
>;
export type AutoShareDeliveryStatus = "queued" | "delivered" | "skipped" | "failed";

export const smsDeliveryUnavailableMessage = "SMS delivery is not configured.";
export const phoneOnlyAutoShareRecipientMessage =
  "SMS delivery is not configured. Add an email address or leave phone blank for in-app matching.";

const recipientTypeValues = new Set<string>(autoShareRecipientTypeOptions.map((option) => option.value));
const deliveryStatusFilterValues = new Set<string>(autoShareDeliveryStatusOptions.map((option) => option.value));

function normalizeComparable(value: string | null | undefined) {
  return value?.trim().toLowerCase() ?? "";
}

export function coerceAutoShareRecipientType(value: string): AutoShareRecipientType {
  return recipientTypeValues.has(value) ? (value as AutoShareRecipientType) : "other";
}

export function coerceAutoShareDeliveryStatusFilter(value: string | undefined): AutoShareDeliveryStatusFilter {
  return value && deliveryStatusFilterValues.has(value) ? (value as AutoShareDeliveryStatusFilter) : "all";
}

export function formatAutoShareRecipientType(value: string) {
  return autoShareRecipientTypeOptions.find((option) => option.value === value)?.label ?? value;
}

export function formatAutoShareDeliveryStatus(value: string) {
  return autoShareDeliveryStatusOptions.find((option) => option.value === value)?.label ?? value;
}

export function matchesAutoShareScope(recipient: Pick<AutoShareRecipientRow, "active" | "location_id">, locationId: string | null) {
  return recipient.active && (!recipient.location_id || recipient.location_id === locationId);
}

export function findRecipientUser(recipient: Pick<AutoShareRecipientRow, "email" | "name">, users: AutoShareUser[]) {
  const email = normalizeComparable(recipient.email);
  const name = normalizeComparable(recipient.name);

  return users.find((user) => {
    return normalizeComparable(user.email) === email || normalizeComparable(user.full_name) === name;
  });
}

export function autoShareRecipientContactError(input: { email?: string | null; phone?: string | null }) {
  const email = normalizeComparable(input.email);
  const phone = normalizeComparable(input.phone);

  return phone && !email ? phoneOnlyAutoShareRecipientMessage : null;
}

export function deliveryStatusForChannel(channel: string): AutoShareDeliveryStatus {
  if (channel === "in_app") {
    return "delivered";
  }

  if (channel === "email") {
    return "queued";
  }

  return "skipped";
}

export function deliveryErrorForChannel(channel: string, status = deliveryStatusForChannel(channel)) {
  return status === "skipped" && channel === "sms" ? smsDeliveryUnavailableMessage : null;
}

export function canRetryAutoShareNotification(notification: Pick<AutoShareNotificationInsert, "channel" | "delivery_status">) {
  return notification.channel === "email" && (notification.delivery_status === "queued" || notification.delivery_status === "failed");
}

export function autoShareNotificationAuditAction(deliveryStatus: string) {
  switch (deliveryStatus) {
    case "delivered":
      return "auto_share.notification.delivered";
    case "failed":
      return "auto_share.notification.failed";
    case "queued":
      return "auto_share.notification.queued";
    case "skipped":
      return "auto_share.notification.skipped";
    default:
      return "auto_share.notification.recorded";
  }
}

export function nextAutoShareDeliveryAttempt(notification: Pick<AutoShareNotificationInsert, "delivery_attempts">) {
  const currentAttempts = Number(notification.delivery_attempts ?? 0);
  return Number.isFinite(currentAttempts) ? Math.max(0, Math.trunc(currentAttempts)) + 1 : 1;
}

export function buildAutoShareDeliveryAttemptUpdate({
  attemptedAt,
  notification,
  result,
}: {
  attemptedAt: string;
  notification: Pick<AutoShareNotificationInsert, "delivery_attempts">;
  result: AutoShareDeliveryAttemptResult;
}) {
  const deliveryAttempts = nextAutoShareDeliveryAttempt(notification);

  if (result.ok) {
    return {
      delivered_at: attemptedAt,
      delivery_attempts: deliveryAttempts,
      delivery_error: null,
      delivery_status: "delivered" as const,
      failed_at: null,
      last_delivery_attempt_at: attemptedAt,
    };
  }

  return {
    delivered_at: null,
    delivery_attempts: deliveryAttempts,
    delivery_error: result.error,
    delivery_status: "failed" as const,
    failed_at: attemptedAt,
    last_delivery_attempt_at: attemptedAt,
  };
}

export function createAutoShareNotificationPayloads({
  createdAt,
  formCode,
  formName,
  locationName,
  recipients,
  submittedByName,
  submission,
  users,
}: {
  createdAt: string;
  formCode: string;
  formName: string;
  locationName?: string | null;
  recipients: AutoShareRecipientRow[];
  submittedByName?: string | null;
  submission: AutoShareSubmission;
  users: AutoShareUser[];
}): AutoShareNotificationInsert[] {
  const matchingRecipients = recipients.filter((recipient) => matchesAutoShareScope(recipient, submission.location_id));
  const submittedBy = submittedByName?.trim() || "A worker";
  const locationText = locationName ? ` at ${locationName}` : "";

  return matchingRecipients.map((recipient) => {
    const user = findRecipientUser(recipient, users);
    const channel = user ? "in_app" : recipient.email ? "email" : recipient.phone ? "sms" : "in_app";
    const deliveryStatus = deliveryStatusForChannel(channel);
    const recipientType = formatAutoShareRecipientType(recipient.recipient_type);

    return {
      body: `${formName} (${formCode}) was submitted by ${submittedBy}${locationText}. Recipient: ${recipient.name} (${recipientType}).`,
      channel,
      created_at: createdAt,
      delivered_at: deliveryStatus === "delivered" ? createdAt : null,
      delivery_error: deliveryErrorForChannel(channel, deliveryStatus),
      delivery_status: deliveryStatus,
      recipient_contact: recipient.email ?? recipient.phone ?? user?.email ?? null,
      recipient_name: recipient.name,
      recipient_type: recipient.recipient_type,
      submission_id: submission.id,
      tenant_id: submission.tenant_id,
      title: `Auto-share: ${formName}`,
      user_id: user?.id ?? null,
    };
  });
}
