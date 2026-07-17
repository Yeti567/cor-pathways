import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const adminActions = readFileSync(join(process.cwd(), "src/app/admin/actions.ts"), "utf8");

describe("document control notification audit wiring", () => {
  it("records tenant audit entries for each document approval notification", () => {
    expect(adminActions).toContain("DocumentApprovalNotificationAuditRow");
    expect(adminActions).toContain("documentControlRegisterId: register.id");
    expect(adminActions).toContain('recipient_type: "document_approver"');
    expect(adminActions).toContain(
      '.select("body, created_at, delivery_status, id, recipient_type, title, user_id")',
    );
    expect(adminActions).toContain('action: "document_control.approval_notification.sent"');
    expect(adminActions).toContain("entityId: notification.id");
    expect(adminActions).toContain('entityTable: "notifications"');
    expect(adminActions).toContain("document_control_register_id: input.documentControlRegisterId");
  });

  it("preserves the register audit entry with document source metadata", () => {
    expect(adminActions).toContain('action: "document_control.register"');
    expect(adminActions).toContain('entityTable: "document_control_register"');
    expect(adminActions).toContain("source_id: input.sourceId");
    expect(adminActions).toContain("source_table: input.sourceTable");
  });
});
