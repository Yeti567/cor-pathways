import { describe, expect, it } from "vitest";
import {
  coerceFollowUpStatus,
  createFollowUpReadyForSignOffNotification,
  followUpStatusClass,
  formatFollowUpStatus,
  isClosedFollowUpStatus,
} from "@/lib/follow-ups";

describe("follow-up helpers", () => {
  it("coerces follow-up statuses", () => {
    expect(coerceFollowUpStatus("completed")).toBe("completed");
    expect(coerceFollowUpStatus("not-real")).toBe("open");
  });

  it("formats follow-up statuses for desktop views", () => {
    expect(formatFollowUpStatus("in_progress")).toBe("In Progress");
    expect(formatFollowUpStatus("custom")).toBe("custom");
  });

  it("returns stable classes for status chips", () => {
    expect(followUpStatusClass("assigned")).toContain("warning");
  });

  it("identifies closed follow-up statuses", () => {
    expect(isClosedFollowUpStatus("completed")).toBe(true);
    expect(isClosedFollowUpStatus("signed_off")).toBe(true);
    expect(isClosedFollowUpStatus("in_progress")).toBe(false);
  });

  it("builds ready-for-sign-off notifications for flaggers", () => {
    expect(
      createFollowUpReadyForSignOffNotification({
        createdAt: "2026-05-23T08:00:00.000Z",
        followUpTitle: "Corrective action: Guard condition",
        parentSubmissionId: "submission-1",
        tenantId: "tenant-1",
        userId: "flagger-1",
      }),
    ).toEqual({
      body: "Corrective action: Guard condition was marked complete and is ready for sign-off.",
      channel: "in_app",
      created_at: "2026-05-23T08:00:00.000Z",
      delivered_at: "2026-05-23T08:00:00.000Z",
      delivery_status: "delivered",
      recipient_type: "follow_up_flagger",
      submission_id: "submission-1",
      tenant_id: "tenant-1",
      title: "Corrective action ready for sign-off",
      user_id: "flagger-1",
    });
  });
});
