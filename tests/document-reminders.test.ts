import { describe, expect, it } from "vitest";
import { buildDocumentReviewNotifications, getResourceReviewStatus } from "@/lib/document-reminders";

const NOW = new Date("2026-06-02T12:00:00");

describe("getResourceReviewStatus", () => {
  it("returns none when there is no review date", () => {
    expect(getResourceReviewStatus({ reminderLeadDays: 30, reviewDate: null }, NOW)).toBe("none");
  });

  it("is current when the review is beyond the reminder window", () => {
    expect(getResourceReviewStatus({ reminderLeadDays: 30, reviewDate: "2026-09-01" }, NOW)).toBe("current");
  });

  it("is due_soon inside the reminder window", () => {
    expect(getResourceReviewStatus({ reminderLeadDays: 30, reviewDate: "2026-06-20" }, NOW)).toBe("due_soon");
  });

  it("is overdue once the date has passed", () => {
    expect(getResourceReviewStatus({ reminderLeadDays: 30, reviewDate: "2026-05-01" }, NOW)).toBe("overdue");
  });
});

const ADMIN = { id: "admin-1", full_name: "Avery Admin", email: "a@x.com", active: true, power_level: "super_admin", app_access: "super_admin_access" } as const;
const WORKER = { id: "worker-1", full_name: "Wendy Worker", email: "w@x.com", active: true, power_level: "worker", app_access: "app_access" } as const;
const INACTIVE = { id: "admin-2", full_name: "Old Admin", email: "o@x.com", active: false, power_level: "super_admin", app_access: "super_admin_access" } as const;

describe("buildDocumentReviewNotifications", () => {
  it("notifies only managers/admins, only for documents that need review", () => {
    const notifications = buildDocumentReviewNotifications({
      createdAt: NOW.toISOString(),
      now: NOW,
      tenantId: "tenant-1",
      users: [ADMIN, WORKER, INACTIVE],
      resources: [
        { id: "r1", name: "SDS - Acetone", review_date: "2026-06-20", reminder_lead_days: 30 },
        { id: "r2", name: "Fall Protection Policy", review_date: "2030-01-01", reminder_lead_days: 30 },
      ],
    });

    // Only the SDS is due, and only the active admin is a recipient.
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({
      user_id: "admin-1",
      recipient_type: "document_review_manager",
      title: "Document expiry due: SDS - Acetone",
    });
  });

  it("flags overdue documents distinctly", () => {
    const notifications = buildDocumentReviewNotifications({
      createdAt: NOW.toISOString(),
      now: NOW,
      tenantId: "tenant-1",
      users: [ADMIN],
      resources: [{ id: "r1", name: "WHMIS Policy", review_date: "2026-04-01", reminder_lead_days: 30 }],
    });

    expect(notifications[0].title).toBe("Document expired: WHMIS Policy");
    expect(notifications[0].body).toContain("expired on");
  });
});
