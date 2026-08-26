import { describe, expect, it } from "vitest";
import { buildContractedAttentionNotifications } from "@/lib/contracted-reminders";

const NOW = new Date("2026-08-26T00:00:00.000Z");
const TENANT = "11111111-1111-1111-1111-111111111111";
const CARRIER = "22222222-2222-2222-2222-222222222222";
const UNIT = "33333333-3333-3333-3333-333333333333";
const DRIVER = "44444444-4444-4444-4444-444444444444";

const BASE = {
  carriers: [{ id: CARRIER, legal_name: "Alpha Hauling Ltd." }],
  createdAt: "2026-08-26T00:00:00.000Z",
  now: NOW,
  tenantId: TENANT,
  units: [{ id: UNIT, subcontractor_id: CARRIER, unit_number: "2504", status: "active" as const }],
  drivers: [
    {
      id: DRIVER,
      subcontractor_id: CARRIER,
      full_name: "John Smith",
      license_expiry: "2030-01-01",
      status: "active" as const,
    },
  ],
  users: [
    {
      id: "u1",
      full_name: "Manager",
      email: "m@x.test",
      active: true,
      power_level: "manager" as never,
      app_access: "admin_access" as never,
    },
  ],
};

function unitDoc(id: string, expiry: string | null, title = "Product hose") {
  return {
    id,
    contracted_equipment_id: UNIT,
    title,
    expiry_date: expiry,
    reminder_lead_days: 30,
    is_active: true,
  };
}

function ticket(id: string, expires: string | null, name = "H2S Alive") {
  return { id, contracted_driver_id: DRIVER, name, expires_on: expires };
}

describe("reminders and renewal history", () => {
  it("says nothing about a unit certificate that has been renewed", () => {
    const notifications = buildContractedAttentionNotifications({
      ...BASE,
      documents: [unitDoc("old", "2023-01-01"), unitDoc("current", "2030-01-01")],
      certifications: [],
    });

    expect(notifications).toEqual([]);
  });

  it("still chases the newest one when it has itself expired", () => {
    const notifications = buildContractedAttentionNotifications({
      ...BASE,
      documents: [unitDoc("old", "2023-01-01"), unitDoc("newest", "2026-01-01")],
      certifications: [],
    });

    expect(notifications).toHaveLength(1);
    expect(notifications[0].title).toContain("Expired");
  });

  it("says nothing about a driver ticket that has been renewed", () => {
    const notifications = buildContractedAttentionNotifications({
      ...BASE,
      documents: [],
      certifications: [ticket("old", "2022-01-01"), ticket("current", "2030-01-01")],
    });

    expect(notifications).toEqual([]);
  });

  it("keeps a primary and a spare apart, so a current spare cannot silence an overdue primary", () => {
    const notifications = buildContractedAttentionNotifications({
      ...BASE,
      documents: [
        unitDoc("primary", "2026-01-01", "Product hose - primary"),
        unitDoc("spare", "2030-01-01", "Product hose - spare"),
      ],
      certifications: [],
    });

    expect(notifications).toHaveLength(1);
    expect(notifications[0].body).toContain("Product hose - primary");
  });

  it("never chases a record with no expiry date", () => {
    const notifications = buildContractedAttentionNotifications({
      ...BASE,
      documents: [unitDoc("undated", null)],
      certifications: [ticket("undated", null)],
    });

    expect(notifications).toEqual([]);
  });
});
