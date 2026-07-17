import { describe, expect, it } from "vitest";
import {
  buildTransportExpiryNotifications,
  daysUntilExpiry,
  transportExpiryStage,
} from "@/lib/transport-reminders";

const now = new Date("2026-05-29T12:00:00.000Z");

const users = [
  { id: "mgr-1", full_name: "Morgan Manager", email: "m@co.test", active: true, power_level: "manager", app_access: "admin_access" },
  { id: "wrk-1", full_name: "Dana Driver", email: "d@co.test", active: true, power_level: "worker", app_access: "app_access" },
] as const;

function build(overrides: {
  drivers?: Parameters<typeof buildTransportExpiryNotifications>[0]["drivers"];
  documents?: Parameters<typeof buildTransportExpiryNotifications>[0]["documents"];
  safetyFitnessExpiresOn?: string | null;
}) {
  return buildTransportExpiryNotifications({
    createdAt: now.toISOString(),
    documents: overrides.documents ?? [],
    drivers: overrides.drivers ?? [],
    now,
    safetyFitnessExpiresOn: overrides.safetyFitnessExpiresOn ?? null,
    tenantId: "tenant-1",
    users: [...users],
  });
}

describe("transport expiry reminders", () => {
  it("classifies expiry against a lead window", () => {
    expect(transportExpiryStage(null, 45, now)).toBe("current");
    expect(transportExpiryStage("2026-12-31", 45, now)).toBe("current");
    expect(transportExpiryStage("2026-06-30", 45, now)).toBe("due_soon");
    expect(transportExpiryStage("2026-05-29", 45, now)).toBe("due_soon");
    expect(transportExpiryStage("2026-05-01", 45, now)).toBe("expired");
  });

  it("computes days until expiry, negative when past", () => {
    expect(daysUntilExpiry(null, now)).toBeNull();
    expect(daysUntilExpiry("2026-05-30", now)).toBe(1);
    expect(daysUntilExpiry("2026-05-28", now)).toBe(-1);
  });

  it("notifies managers and the linked driver user when a licence is expiring", () => {
    const notifications = build({
      drivers: [{ id: "driver-1", full_name: "Dana Driver", user_id: "wrk-1", license_expiry: "2026-06-10" }],
    });

    expect(notifications).toHaveLength(2);
    expect(notifications.map((n) => n.recipient_type).sort()).toEqual(["transport_driver", "transport_manager"]);
    expect(notifications.every((n) => n.title === "Driver licence expiring: Dana Driver")).toBe(true);
  });

  it("flags an expired licence", () => {
    const notifications = build({
      drivers: [{ id: "driver-1", full_name: "Dana Driver", user_id: null, license_expiry: "2026-01-01" }],
    });

    // No linked user, so only the manager is notified.
    expect(notifications).toHaveLength(1);
    expect(notifications[0].recipient_type).toBe("transport_manager");
    expect(notifications[0].title).toBe("Driver licence expired: Dana Driver");
  });

  it("warns on an expiry-tracked document but ignores non-tracked and archived ones", () => {
    const drivers = [{ id: "driver-1", full_name: "Dana Driver", user_id: null, license_expiry: null }];
    const notifications = build({
      drivers,
      documents: [
        // Abstract (tracked) expiring soon -> notify.
        { id: "doc-1", registry_key: "dq", slot_key: "annual_abstract", subject_id: "driver-1", title: "Abstract", expiry_date: "2026-06-15", status: "active" },
        // Application (not tracked) with an expiry set -> ignored.
        { id: "doc-2", registry_key: "dq", slot_key: "application", subject_id: "driver-1", title: "Application", expiry_date: "2026-06-01", status: "active" },
        // Archived abstract -> ignored.
        { id: "doc-3", registry_key: "dq", slot_key: "annual_abstract", subject_id: "driver-1", title: "Old abstract", expiry_date: "2026-06-01", status: "archived" },
      ],
    });

    expect(notifications).toHaveLength(1);
    expect(notifications[0].title).toBe("Driver document expiring: Dana Driver, Abstract");
    expect(notifications[0].recipient_type).toBe("transport_manager");
  });

  it("warns managers (not drivers) when the Safety Fitness Certificate is expiring", () => {
    const notifications = build({ safetyFitnessExpiresOn: "2026-06-20" });

    expect(notifications).toHaveLength(1);
    expect(notifications[0].recipient_type).toBe("transport_manager");
    expect(notifications[0].title).toBe("Safety Fitness Certificate expiring");
  });

  it("flags an expired Safety Fitness Certificate", () => {
    const notifications = build({ safetyFitnessExpiresOn: "2026-01-01" });

    expect(notifications).toHaveLength(1);
    expect(notifications[0].title).toBe("Safety Fitness Certificate expired");
  });

  it("does not notify when nothing is near expiry", () => {
    const notifications = build({
      drivers: [{ id: "driver-1", full_name: "Dana Driver", user_id: "wrk-1", license_expiry: "2027-01-01" }],
      documents: [
        { id: "doc-1", registry_key: "dq", slot_key: "medical", subject_id: "driver-1", title: "Medical", expiry_date: "2027-01-01", status: "active" },
      ],
    });

    expect(notifications).toHaveLength(0);
  });
});
