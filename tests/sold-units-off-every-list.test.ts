import { describe, expect, it } from "vitest";
import {
  buildEquipmentAttentionItems,
  buildEquipmentDashboardCounts,
  buildEquipmentInventoryRows,
  buildFleetRenewalWindows,
  isUnitInService,
} from "@/lib/equipment";

const NOW = new Date("2026-09-22T12:00:00Z");

function unit(id: string, status: "active" | "down" | "retired" | "sold" = "active") {
  return {
    assigned_to: null,
    category: "trailer" as const,
    current_meter: null,
    deleted_at: null,
    id,
    location_id: null,
    make: null,
    model: null,
    name: null,
    status,
    tracking_mode: "mileage" as const,
    unit_number: id,
    vin_or_serial: null,
  };
}

// Every unit carries one lapsed CVIP.
const documents = ["on-road", "sold", "retired"].map((id) => ({
  equipment_id: id,
  expiryDate: "2025-12-31",
  isActive: true,
  reminderLeadDays: 30,
  title: "CVIP inspection",
}));
const equipment = [unit("on-road"), unit("sold", "sold"), unit("retired", "retired")];

describe("a sold or retired unit drops off every compliance list", () => {
  it("is not in service", () => {
    expect(isUnitInService(unit("a"))).toBe(true);
    expect(isUnitInService(unit("a", "down"))).toBe(true);
    expect(isUnitInService(unit("a", "sold"))).toBe(false);
    expect(isUnitInService(unit("a", "retired"))).toBe(false);
    expect(isUnitInService({ ...unit("a"), deleted_at: "2026-01-01" })).toBe(false);
  });

  it("is left out of the dashboard attention list", () => {
    const items = buildEquipmentAttentionItems({ documents, equipment, now: NOW, scheduledServices: [] });
    expect(items.map((item) => item.equipment.id)).toEqual(["on-road"]);
  });

  it("is left out of the renewal chart", () => {
    const windows = buildFleetRenewalWindows({ documents, equipment, now: NOW });
    expect(windows.expired).toEqual({ documents: 1, units: 1 });
  });

  it("is left out of the dashboard counts", () => {
    const counts = buildEquipmentDashboardCounts({ documents, equipment, now: NOW, scheduledServices: [] });
    expect(counts.expiringDocuments).toBe(1);
  });

  it("stays in the register with its badge but carries no due indicator", () => {
    const rows = buildEquipmentInventoryRows({ documents, equipment, locations: [], now: NOW, scheduledServices: [], users: [] });
    expect(rows).toHaveLength(3);
    const state = Object.fromEntries(rows.map((row) => [row.equipment.id, row.serviceIndicator.state]));
    expect(state).toEqual({ "on-road": "overdue", retired: "current", sold: "current" });
  });
});
