import { describe, expect, it } from "vitest";
import {
  buildTenantAuditEvent,
  resolveConsultantLoginTenantIds,
  recordTenantAuditEvent,
  type TenantAuditEventInsert,
} from "@/lib/tenant-audit";

describe("tenant audit helpers", () => {
  it("builds a compact tenant audit payload", () => {
    expect(
      buildTenantAuditEvent({
        action: " equipment.update ",
        actorRole: "admin",
        actorUserId: " user-1 ",
        entityId: " 11111111-1111-4111-8111-111111111111 ",
        entityTable: " equipment ",
        metadata: {
          ignored: undefined,
          status: "down",
        },
        tenantId: " tenant-1 ",
      }),
    ).toEqual({
      action: "equipment.update",
      actor_role: "admin",
      actor_user_id: "user-1",
      entity_id: "11111111-1111-4111-8111-111111111111",
      entity_table: "equipment",
      metadata: {
        status: "down",
      },
      tenant_id: "tenant-1",
    });
  });

  it("fails fast when required audit fields are missing", () => {
    expect(() => buildTenantAuditEvent({ action: "form.publish", tenantId: "" })).toThrow("tenant id");
    expect(() => buildTenantAuditEvent({ action: " ", tenantId: "tenant-1" })).toThrow("audit action");
  });

  it("preserves non-object audit metadata", () => {
    expect(
      buildTenantAuditEvent({
        action: "system.note",
        metadata: ["queued", "delivered"],
        tenantId: "tenant-1",
      }).metadata,
    ).toEqual(["queued", "delivered"]);
  });

  it("resolves tenant-visible consultant login audit targets", () => {
    expect(
      resolveConsultantLoginTenantIds({
        accessRows: [
          {
            allowed: true,
            override_condition: "court_order",
            override_expires_at: "2026-01-02T00:00:00.000Z",
            tenant_id: "tenant-revoked-override",
          },
          {
            allowed: true,
            override_condition: "ministry_order",
            override_expires_at: "2025-12-31T00:00:00.000Z",
            tenant_id: "tenant-expired",
          },
          {
            allowed: false,
            override_condition: "ninety_day_dormancy",
            override_expires_at: null,
            tenant_id: "tenant-denied",
          },
        ],
        now: new Date("2026-01-01T00:00:00.000Z"),
        tenants: [
          {
            consultant_access_revoked: false,
            id: "tenant-open",
          },
          {
            consultant_access_revoked: true,
            id: "tenant-revoked-override",
          },
        ],
      }),
    ).toEqual(["tenant-open", "tenant-revoked-override"]);
  });

  it("inserts through the provided server-side client", async () => {
    const inserts: TenantAuditEventInsert[] = [];
    const supabase = {
      from(table: string) {
        expect(table).toBe("tenant_audit_log");

        return {
          insert(payload: TenantAuditEventInsert) {
            inserts.push(payload);
            return Promise.resolve({ error: null });
          },
        };
      },
    };

    await recordTenantAuditEvent(
      {
        action: "consultant.override",
        actorRole: "consultant",
        actorUserId: "consultant-1",
        tenantId: "tenant-1",
      },
      supabase as never,
    );

    expect(inserts).toEqual([
      {
        action: "consultant.override",
        actor_role: "consultant",
        actor_user_id: "consultant-1",
        entity_id: null,
        entity_table: null,
        metadata: {},
        tenant_id: "tenant-1",
      },
    ]);
  });
});
