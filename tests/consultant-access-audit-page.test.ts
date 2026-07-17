import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const consultantAccessPage = readFileSync(join(process.cwd(), "src/app/admin/consultant-access/page.tsx"), "utf8");

describe("consultant access audit page", () => {
  it("surfaces consultant-specific tenant audit events with filtering", () => {
    expect(consultantAccessPage).toContain('from("tenant_audit_log")');
    expect(consultantAccessPage).toContain("consultantAuditActionOptions");
    expect(consultantAccessPage).toContain('name="audit"');
    expect(consultantAccessPage).toContain("Consultant Audit");
    expect(consultantAccessPage).toContain("consultant.login");
    expect(consultantAccessPage).toContain("consultant_access.revocation_update");
    expect(consultantAccessPage).toContain("consultant_access.override_requested");
  });
});
