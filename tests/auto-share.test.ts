import { describe, expect, it } from "vitest";
import {
  autoShareRecipientContactError,
  autoShareNotificationAuditAction,
  buildAutoShareDeliveryAttemptUpdate,
  coerceAutoShareRecipientType,
  coerceAutoShareDeliveryStatusFilter,
  canRetryAutoShareNotification,
  createAutoShareNotificationPayloads,
  deliveryStatusForChannel,
  matchesAutoShareScope,
  phoneOnlyAutoShareRecipientMessage,
  type AutoShareRecipientRow,
} from "@/lib/auto-share";

const baseRecipient: AutoShareRecipientRow = {
  active: true,
  created_at: "2026-05-22T07:00:00.000Z",
  email: null,
  id: "recipient-1",
  location_id: null,
  name: "Nora Super",
  phone: null,
  recipient_type: "supervisor",
  tenant_id: "tenant-1",
  updated_at: "2026-05-22T07:00:00.000Z",
};

describe("auto-share helpers", () => {
  it("coerces recipient types", () => {
    expect(coerceAutoShareRecipientType("client_contact")).toBe("client_contact");
    expect(coerceAutoShareRecipientType("not-real")).toBe("other");
  });

  it("coerces delivery status filters", () => {
    expect(coerceAutoShareDeliveryStatusFilter("failed")).toBe("failed");
    expect(coerceAutoShareDeliveryStatusFilter("not-real")).toBe("all");
    expect(coerceAutoShareDeliveryStatusFilter(undefined)).toBe("all");
  });

  it("matches all-location and location-specific recipients", () => {
    expect(matchesAutoShareScope(baseRecipient, "location-1")).toBe(true);
    expect(matchesAutoShareScope({ ...baseRecipient, location_id: "location-1" }, "location-1")).toBe(true);
    expect(matchesAutoShareScope({ ...baseRecipient, location_id: "location-2" }, "location-1")).toBe(false);
    expect(matchesAutoShareScope({ ...baseRecipient, active: false }, "location-1")).toBe(false);
  });

  it("marks in-app delivered, email queued, and unsupported channels skipped", () => {
    expect(deliveryStatusForChannel("in_app")).toBe("delivered");
    expect(deliveryStatusForChannel("email")).toBe("queued");
    expect(deliveryStatusForChannel("sms")).toBe("skipped");
  });

  it("rejects phone-only recipients while SMS delivery is unavailable", () => {
    expect(autoShareRecipientContactError({ email: null, phone: "555-0101" })).toBe(phoneOnlyAutoShareRecipientMessage);
    expect(autoShareRecipientContactError({ email: "client@example.com", phone: "555-0101" })).toBeNull();
    expect(autoShareRecipientContactError({ email: null, phone: null })).toBeNull();
  });

  it("identifies retryable email notifications", () => {
    expect(canRetryAutoShareNotification({ channel: "email", delivery_status: "queued" })).toBe(true);
    expect(canRetryAutoShareNotification({ channel: "email", delivery_status: "failed" })).toBe(true);
    expect(canRetryAutoShareNotification({ channel: "sms", delivery_status: "skipped" })).toBe(false);
    expect(canRetryAutoShareNotification({ channel: "email", delivery_status: "delivered" })).toBe(false);
  });

  it("maps created notification statuses to audit actions", () => {
    expect(autoShareNotificationAuditAction("queued")).toBe("auto_share.notification.queued");
    expect(autoShareNotificationAuditAction("skipped")).toBe("auto_share.notification.skipped");
    expect(autoShareNotificationAuditAction("delivered")).toBe("auto_share.notification.delivered");
    expect(autoShareNotificationAuditAction("failed")).toBe("auto_share.notification.failed");
    expect(autoShareNotificationAuditAction("unknown")).toBe("auto_share.notification.recorded");
  });

  it("builds delivery attempt updates with retry history", () => {
    expect(
      buildAutoShareDeliveryAttemptUpdate({
        attemptedAt: "2026-05-25T12:00:00.000Z",
        notification: { delivery_attempts: 1 },
        result: { ok: true },
      }),
    ).toEqual({
      delivered_at: "2026-05-25T12:00:00.000Z",
      delivery_attempts: 2,
      delivery_error: null,
      delivery_status: "delivered",
      failed_at: null,
      last_delivery_attempt_at: "2026-05-25T12:00:00.000Z",
    });

    expect(
      buildAutoShareDeliveryAttemptUpdate({
        attemptedAt: "2026-05-25T12:05:00.000Z",
        notification: { delivery_attempts: 2 },
        result: { error: "Provider timeout", ok: false },
      }),
    ).toEqual({
      delivered_at: null,
      delivery_attempts: 3,
      delivery_error: "Provider timeout",
      delivery_status: "failed",
      failed_at: "2026-05-25T12:05:00.000Z",
      last_delivery_attempt_at: "2026-05-25T12:05:00.000Z",
    });
  });

  it("creates in-app notifications for matched users and email records for external recipients", () => {
    const payloads = createAutoShareNotificationPayloads({
      createdAt: "2026-05-22T08:00:00.000Z",
      formCode: "DFR",
      formName: "Daily Field Report",
      locationName: "Riverside Project",
      recipients: [
        baseRecipient,
        {
          ...baseRecipient,
          email: "client@example.com",
          id: "recipient-2",
          name: "Client Inbox",
          recipient_type: "client_contact",
        },
        {
          ...baseRecipient,
          id: "recipient-3",
          location_id: "other-location",
          name: "Other Location",
        },
        {
          ...baseRecipient,
          id: "recipient-4",
          name: "Safety Phone",
          phone: "555-0101",
          recipient_type: "other",
        },
      ],
      submittedByName: "Will Worker",
      submission: {
        created_at: "2026-05-22T08:00:00.000Z",
        form_id: "form-1",
        id: "submission-1",
        location_id: "location-1",
        submitted_by: "user-1",
        tenant_id: "tenant-1",
      },
      users: [{ email: "nora@example.com", full_name: "Nora Super", id: "user-2" }],
    });

    expect(payloads).toHaveLength(3);
    expect(payloads[0]).toMatchObject({
      channel: "in_app",
      delivered_at: "2026-05-22T08:00:00.000Z",
      delivery_status: "delivered",
      recipient_name: "Nora Super",
      recipient_type: "supervisor",
      submission_id: "submission-1",
      tenant_id: "tenant-1",
      title: "Auto-share: Daily Field Report",
      user_id: "user-2",
    });
    expect(payloads[1]).toMatchObject({
      channel: "email",
      delivered_at: null,
      delivery_status: "queued",
      recipient_contact: "client@example.com",
      recipient_name: "Client Inbox",
      recipient_type: "client_contact",
      submission_id: "submission-1",
      user_id: null,
    });
    expect(payloads[2]).toMatchObject({
      channel: "sms",
      delivery_error: "SMS delivery is not configured.",
      delivery_status: "skipped",
      recipient_contact: "555-0101",
      recipient_name: "Safety Phone",
      recipient_type: "other",
      submission_id: "submission-1",
    });
  });
});
