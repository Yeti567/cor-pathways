import { describe, expect, it } from "vitest";
import { buildDailyInspectionReminders } from "@/lib/daily-inspection-reminders";

const NOW = new Date("2026-06-05T20:00:00.000Z");
const CREATED_AT = NOW.toISOString();

type User = Parameters<typeof buildDailyInspectionReminders>[0]["users"][number];

const manager: User = {
  id: "mgr",
  full_name: "Mary Manager",
  email: "mary@co.test",
  active: true,
  power_level: "manager",
  app_access: "admin_access",
};
const driver: User = {
  id: "drv",
  full_name: "Dave Driver",
  email: "dave@co.test",
  active: true,
  power_level: "worker",
  app_access: "app_access",
};

function build(vehicles: Parameters<typeof buildDailyInspectionReminders>[0]["vehicles"], inspections: Parameters<typeof buildDailyInspectionReminders>[0]["inspections"]) {
  return buildDailyInspectionReminders({
    createdAt: CREATED_AT,
    inspections,
    now: NOW,
    tenantId: "t1",
    users: [manager, driver],
    vehicles,
  });
}

describe("buildDailyInspectionReminders", () => {
  it("nudges the manager and assigned driver when a vehicle is due", () => {
    const notes = build([{ id: "v1", unit_number: "12", name: "Dodge", assigned_to: "drv" }], []);
    expect(notes.length).toBe(2);
    expect(notes.every((n) => n.title === "Trip inspection due: 12 - Dodge")).toBe(true);
    const recipients = notes.map((n) => n.recipient_type).sort();
    expect(recipients).toEqual(["daily_inspection_driver", "daily_inspection_manager"]);
    expect(notes[0].body).toContain("required every 24 hours");
  });

  it("says nothing for a vehicle with a current valid inspection", () => {
    const notes = build(
      [{ id: "v1", unit_number: "12", name: null, assigned_to: null }],
      [
        {
          id: "i1",
          equipment_id: "v1",
          completed_at: "2026-06-05T12:00:00.000Z",
          valid_until: "2026-06-06T12:00:00.000Z",
          out_of_service: false,
          out_of_service_cleared_at: null,
        },
      ],
    );
    expect(notes).toEqual([]);
  });

  it("flags an out-of-service vehicle distinctly", () => {
    const notes = build(
      [{ id: "v1", unit_number: "97", name: "Kenworth", assigned_to: null }],
      [
        {
          id: "i1",
          equipment_id: "v1",
          completed_at: "2026-06-05T12:00:00.000Z",
          valid_until: "2026-06-06T12:00:00.000Z",
          out_of_service: true,
          out_of_service_cleared_at: null,
        },
      ],
    );
    // No assigned driver, so just the manager.
    expect(notes.length).toBe(1);
    expect(notes[0].title).toBe("Vehicle out of service: 97 - Kenworth");
    expect(notes[0].body).toContain("must not be driven");
  });

  it("embeds the date so the same due vehicle produces a fresh nudge each day", () => {
    const day1 = build([{ id: "v1", unit_number: "12", name: null, assigned_to: null }], []);
    const day2 = buildDailyInspectionReminders({
      createdAt: "2026-06-06T20:00:00.000Z",
      inspections: [],
      now: new Date("2026-06-06T20:00:00.000Z"),
      tenantId: "t1",
      users: [manager],
      vehicles: [{ id: "v1", unit_number: "12", name: null, assigned_to: null }],
    });
    expect(day1[0].body).not.toBe(day2[0].body);
  });
});
