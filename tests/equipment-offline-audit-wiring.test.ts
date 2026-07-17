import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const auditRoute = readFileSync(join(process.cwd(), "src/app/api/audit/equipment-actions/route.ts"), "utf8");
const offlineSync = readFileSync(join(process.cwd(), "src/lib/offline/sync.ts"), "utf8");

describe("offline equipment audit wiring", () => {
  it("records tenant audit events for synced worker equipment actions", () => {
    expect(auditRoute).toContain('from "@/lib/tenant-audit"');
    expect(auditRoute).toContain("recordTenantAuditEvent");
    expect(auditRoute).toContain('entityTable: "equipment"');
    expect(auditRoute).toContain('entityTable: "equipment_meter_log"');
    expect(auditRoute).toContain('entityTable: "equipment_maintenance_log"');
    expect(auditRoute).toContain('entityTable: "equipment_scheduled_service"');
    expect(auditRoute).toContain('entityTable: "equipment_document"');
    expect(auditRoute).toContain('entityTable: "equipment_submission_link"');
    expect(auditRoute).toContain('sync_source: "offline_sync"');
    expect(auditRoute).toContain("actionFromMetadata");
  });

  it("calls the server audit route after offline sync writes equipment rows", () => {
    expect(offlineSync).toContain('fetch("/api/audit/equipment-actions"');
    expect(offlineSync).toContain("recordEquipmentAuditEvents");
    expect(offlineSync).toContain("equipmentIds");
    expect(offlineSync).toContain("meterLogIds");
    expect(offlineSync).toContain("maintenanceLogIds");
    expect(offlineSync).toContain("scheduledServiceIds");
    expect(offlineSync).toContain("documentIds");
    expect(offlineSync).toContain("submissionLinkIds");
    expect(offlineSync).toContain("deletedSubmissionLinks");
  });

  it("selects synced row IDs before recording audits", () => {
    expect(offlineSync).toContain('.select("id")');
    expect(offlineSync).toContain(".single<EquipmentAuditIdRow>()");
    expect(offlineSync).toContain(".returns<EquipmentAuditIdRow[]>()");
  });
});
