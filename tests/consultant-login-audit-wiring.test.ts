import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const authConfirmRoute = readFileSync(join(process.cwd(), "src/app/auth/confirm/route.ts"), "utf8");
const loginActions = readFileSync(join(process.cwd(), "src/app/login/actions.ts"), "utf8");
const tenantAudit = readFileSync(join(process.cwd(), "src/lib/tenant-audit.ts"), "utf8");

describe("consultant login audit wiring", () => {
  it("records consultant password and SSO logins in the tenant audit log", () => {
    expect(loginActions).toContain("recordConsultantLoginAuditEventsForSession");
    expect(loginActions).toContain('method: "password"');
    expect(authConfirmRoute).toContain("recordConsultantLoginAuditEventsForSession");
    expect(authConfirmRoute).toContain('method: "sso"');
  });

  it("writes consultant login entries as tenant audit events", () => {
    expect(tenantAudit).toContain("recordConsultantLoginAuditEventsForSession");
    expect(tenantAudit).toContain('action: "consultant.login"');
    expect(tenantAudit).toContain('entityTable: "consultants"');
    expect(tenantAudit).toContain('actorRole: "consultant"');
    expect(tenantAudit).toContain('from("tenant_audit_log").insert(payloads)');
  });
});
