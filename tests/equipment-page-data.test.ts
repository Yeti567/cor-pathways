import { describe, expect, it } from "vitest";
import { buildEquipmentInventoryRows, coerceEquipmentTab } from "@/lib/equipment";

const baseEquipment = [
  {
    assigned_to: "user-1",
    category: "vehicle",
    current_meter: "980",
    deleted_at: null,
    id: "equipment-1",
    license_plate: "7AB 461",
    location_id: "location-1",
    make: "Ford",
    model: "F-550",
    name: "Service truck",
    status: "active",
    tracking_mode: "mileage",
    unit_number: "47",
    vin_or_serial: "VIN47",
  },
  {
    assigned_to: null,
    category: "generator",
    current_meter: 120,
    deleted_at: null,
    id: "equipment-2",
    license_plate: "7EF9-38",
    location_id: null,
    make: "Cat",
    model: "XQ",
    name: "Backup generator",
    status: "down",
    tracking_mode: "hours",
    unit_number: "GEN-2",
    vin_or_serial: "SER2",
  },
];

describe("equipment page data helpers", () => {
  it("filters equipment inventory by query, status, and category", () => {
    const rows = buildEquipmentInventoryRows({
      category: "vehicle",
      documents: [],
      equipment: baseEquipment,
      locations: [{ code: "YARD", id: "location-1", name: "Main Yard" }],
      query: "service",
      scheduledServices: [],
      status: "active",
      users: [{ full_name: "Blake Cowan", id: "user-1" }],
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].equipment.unit_number).toBe("47");
    expect(rows[0].locationName).toBe("Main Yard (YARD)");
    expect(rows[0].assigneeName).toBe("Blake Cowan");
  });

  // The plate is what a roadside call or a violation notice leads with, and the
  // plates in the source sheets are written three different ways, so searching
  // one has to survive the separators landing somewhere else.
  it("finds a unit by its licence plate, however the separators are typed", () => {
    const find = (query: string) =>
      buildEquipmentInventoryRows({
        documents: [],
        equipment: baseEquipment,
        locations: [],
        query,
        scheduledServices: [],
        users: [],
      }).map((row) => row.equipment.unit_number);

    // As stored.
    expect(find("7AB 461")).toEqual(["47"]);
    expect(find("7EF9-38")).toEqual(["GEN-2"]);
    // Separator dropped by the searcher.
    expect(find("7AB461")).toEqual(["47"]);
    expect(find("7EF938")).toEqual(["GEN-2"]);
    // Separator typed differently from the way it was stored.
    expect(find("7EF9 38")).toEqual(["GEN-2"]);
    // Case does not matter.
    expect(find("7ab 461")).toEqual(["47"]);
    // A plate belonging to nothing still finds nothing.
    expect(find("6ZZ 999")).toEqual([]);
    // The guarded second pass must not let a query run across word boundaries.
    expect(find("truckvehicle")).toEqual([]);
  });

  it("filters equipment inventory by assigned worker and unassigned units", () => {
    const assignedRows = buildEquipmentInventoryRows({
      assignedTo: "user-1",
      documents: [],
      equipment: baseEquipment,
      locations: [],
      scheduledServices: [],
      users: [{ full_name: "Blake Cowan", id: "user-1" }],
    });

    expect(assignedRows.map((row) => row.equipment.id)).toEqual(["equipment-1"]);

    const unassignedRows = buildEquipmentInventoryRows({
      assignedTo: "unassigned",
      documents: [],
      equipment: baseEquipment,
      locations: [],
      scheduledServices: [],
      users: [{ full_name: "Blake Cowan", id: "user-1" }],
    });

    expect(unassignedRows.map((row) => row.equipment.id)).toEqual(["equipment-2"]);
  });

  it("sorts equipment with overdue service first", () => {
    const rows = buildEquipmentInventoryRows({
      documents: [],
      equipment: baseEquipment,
      locations: [],
      now: new Date("2026-05-24T12:00:00Z"),
      scheduledServices: [
        {
          dueDate: null,
          dueMeter: 100,
          equipment_id: "equipment-2",
          intervalMode: "by_meter",
          isActive: true,
        },
      ],
      sort: "service",
      users: [],
    });

    expect(rows.map((row) => row.equipment.unit_number)).toEqual(["GEN-2", "47"]);
    expect(rows[0].serviceIndicator.state).toBe("overdue");
  });

  it("sorts service due rows by the nearest due value and exposes due detail", () => {
    const rows = buildEquipmentInventoryRows({
      documents: [],
      equipment: [
        { ...baseEquipment[0], current_meter: 900, id: "equipment-1", unit_number: "47" },
        { ...baseEquipment[1], current_meter: 950, id: "equipment-2", status: "active", unit_number: "GEN-2" },
      ],
      locations: [],
      now: new Date("2026-05-24T12:00:00Z"),
      scheduledServices: [
        {
          dueDate: null,
          dueMeter: 1000,
          equipment_id: "equipment-1",
          intervalMode: "by_meter",
          isActive: true,
        },
        {
          dueDate: null,
          dueMeter: 975,
          equipment_id: "equipment-2",
          intervalMode: "by_meter",
          isActive: true,
        },
      ],
      sort: "service",
      users: [],
    });

    expect(rows.map((row) => row.equipment.unit_number)).toEqual(["GEN-2", "47"]);
    expect(rows[0].serviceDetail).toBe("25 remaining");
    expect(rows[1].serviceDetail).toBe("100 remaining");
  });

  it("coerces detail tabs to overview when unknown", () => {
    expect(coerceEquipmentTab("documents")).toBe("documents");
    expect(coerceEquipmentTab("bad-tab")).toBe("overview");
    expect(coerceEquipmentTab(undefined)).toBe("overview");
  });
});
