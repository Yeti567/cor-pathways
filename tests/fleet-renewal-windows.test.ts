import { describe, expect, it } from "vitest";
import { buildFleetRenewalWindows } from "@/lib/equipment";

const NOW = new Date("2026-08-19T12:00:00Z");

function unit(id: string, overrides: Record<string, unknown> = {}) {
  return {
    assigned_to: null,
    category: "trailer" as const,
    current_meter: null,
    deleted_at: null,
    id,
    location_id: null,
    make: "Columbia",
    model: null,
    name: null,
    status: "active" as const,
    tracking_mode: "mileage" as const,
    unit_number: id,
    vin_or_serial: null,
    ...overrides,
  };
}

function doc(equipmentId: string, expiryDate: string | null, overrides: Record<string, unknown> = {}) {
  return {
    equipment_id: equipmentId,
    expiryDate,
    isActive: true,
    reminderLeadDays: 30,
    title: "CVIP inspection",
    ...overrides,
  };
}

describe("what is coming due across the fleet", () => {
  it("counts each window cumulatively, so 30 days includes the 15 day ones", () => {
    const windows = buildFleetRenewalWindows({
      documents: [
        doc("e1", "2026-08-30"), // 11 days
        doc("e1", "2026-09-10"), // 22 days
        doc("e1", "2026-09-25"), // 37 days
        doc("e1", "2026-10-10"), // 52 days
        doc("e1", "2026-12-01"), // beyond 60
      ],
      equipment: [unit("e1")],
      now: NOW,
    });

    expect(windows.within15.documents).toBe(1);
    expect(windows.within30.documents).toBe(2);
    expect(windows.within45.documents).toBe(3);
    expect(windows.within60.documents).toBe(4);
  });

  it("counts units as well as documents, because one truck can carry six renewals", () => {
    const windows = buildFleetRenewalWindows({
      documents: [
        doc("e1", "2026-08-31", { title: "CVIP inspection" }),
        doc("e1", "2026-08-31", { title: "External visual and leak (VK)" }),
        doc("e1", "2026-08-31", { title: "Product hose - 1" }),
        doc("e2", "2026-08-31", { title: "CVIP inspection" }),
      ],
      equipment: [unit("e1"), unit("e2")],
      now: NOW,
    });

    expect(windows.within15.documents).toBe(4);
    expect(windows.within15.units).toBe(2);
  });

  // An expired CVIP is not a job to schedule, it is a unit that should not be on the
  // road. Folding it into "due in 15 days" would hide the thing that must be seen first.
  it("keeps expired separate from the planning windows", () => {
    const windows = buildFleetRenewalWindows({
      documents: [doc("e1", "2026-08-01"), doc("e1", "2026-08-25")],
      equipment: [unit("e1")],
      now: NOW,
    });

    expect(windows.expired.documents).toBe(1);
    expect(windows.expired.units).toBe(1);
    expect(windows.within15.documents).toBe(1);
    expect(windows.within60.documents).toBe(1);
  });

  // The trap this is guarding: a superseded certificate is kept for history with
  // isActive false and a date in the past. Counting it would mean that filing a
  // renewal ADDS an overdue item instead of clearing one.
  it("ignores a superseded certificate kept only as history", () => {
    const windows = buildFleetRenewalWindows({
      documents: [
        doc("e1", "2026-02-19", { isActive: false, title: "Upper coupler (UC)" }),
        doc("e1", "2027-03-10", { title: "Upper coupler (UC) - 2022-03-11" }),
      ],
      equipment: [unit("e1")],
      now: NOW,
    });

    expect(windows.expired.documents).toBe(0);
    expect(windows.within60.documents).toBe(0);
  });

  it("ignores documents belonging to a deleted unit", () => {
    const windows = buildFleetRenewalWindows({
      documents: [doc("gone", "2026-08-25"), doc("e1", "2026-08-25")],
      equipment: [unit("e1"), unit("gone", { deleted_at: "2026-08-01T00:00:00Z" })],
      now: NOW,
    });

    expect(windows.within15.documents).toBe(1);
    expect(windows.within15.units).toBe(1);
  });

  it("counts something expiring today as due, not as expired", () => {
    const windows = buildFleetRenewalWindows({
      documents: [doc("e1", "2026-08-19")],
      equipment: [unit("e1")],
      now: NOW,
    });

    expect(windows.expired.documents).toBe(0);
    expect(windows.within15.documents).toBe(1);
  });

  it("says nothing is due when a fleet is clean", () => {
    const windows = buildFleetRenewalWindows({
      documents: [doc("e1", "2027-06-01"), doc("e1", null)],
      equipment: [unit("e1")],
      now: NOW,
    });

    expect(windows.expired.documents).toBe(0);
    expect(windows.within60.documents).toBe(0);
    expect(windows.within60.units).toBe(0);
  });
});
