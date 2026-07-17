import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const appActions = readFileSync(join(process.cwd(), "src/app/actions.ts"), "utf8");

describe("follow-up notification audit wiring", () => {
  it("records tenant audit entries for ready-for-signoff worker notifications", () => {
    expect(appActions).toContain("FollowUpNotificationAuditRow");
    expect(appActions).toContain("createFollowUpReadyForSignOffNotification");
    expect(appActions).toContain(
      '.select("body, created_at, delivery_status, id, recipient_type, submission_id, title, user_id")',
    );
    expect(appActions).toContain('action: "follow_up.notification.ready_for_signoff.sent"');
    expect(appActions).toContain("follow_up_id: updatedFollowUp.id");
    expect(appActions).toContain('entityTable: "notifications"');
  });

  it("records tenant audit entries for signoff completion notifications", () => {
    expect(appActions).toContain('title: "Corrective action signed off"');
    expect(appActions).toContain('action: "follow_up.notification.signoff.sent"');
    expect(appActions).toContain("follow_up_id: signedOffFollowUp.id");
    expect(appActions).toContain("entityId: notification.id");
    expect(appActions).toContain('source: "worker_app"');
  });
});
