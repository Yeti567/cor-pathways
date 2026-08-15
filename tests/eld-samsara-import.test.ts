import { describe, expect, it } from "vitest";
import {
  buildSamsaraImportPlan,
  isSamsaraImportPlanEmpty,
  type ExistingDriverRow,
} from "@/lib/eld/samsara-import";
import type { EldDriverSummary, EldVehicleSummary, EquipmentMatchRow } from "@/lib/eld/sync";

const noDrivers: ExistingDriverRow[] = [];
const noEquipment: EquipmentMatchRow[] = [];

function plan(input: {
  drivers?: EldDriverSummary[];
  vehicles?: EldVehicleSummary[];
  existingDrivers?: ExistingDriverRow[];
  existingEquipment?: EquipmentMatchRow[];
  linkedDriverExternalIds?: Set<string>;
  linkedVehicleExternalIds?: Set<string>;
}) {
  return buildSamsaraImportPlan({
    drivers: input.drivers ?? [],
    vehicles: input.vehicles ?? [],
    existingDrivers: input.existingDrivers ?? noDrivers,
    existingEquipment: input.existingEquipment ?? noEquipment,
    linkedDriverExternalIds: input.linkedDriverExternalIds,
    linkedVehicleExternalIds: input.linkedVehicleExternalIds,
  });
}

describe("buildSamsaraImportPlan: drivers", () => {
  it("plans a driver using Samsara's exact spelling", () => {
    const result = plan({ drivers: [{ externalId: "1", fullName: "Dale Chase" }] });
    expect(result.driversToCreate).toEqual([{ externalId: "1", fullName: "Dale Chase" }]);
  });

  it("does not re-create a driver we already have, whatever the casing or padding", () => {
    const result = plan({
      drivers: [{ externalId: "1", fullName: "Dale Chase" }],
      existingDrivers: [{ id: "d1", full_name: "  dale chase " }],
    });
    expect(result.driversToCreate).toEqual([]);
    expect(result.driversAlreadyPresent).toBe(1);
  });

  it("does not re-create a driver that is already linked, even under a different name", () => {
    const result = plan({
      drivers: [{ externalId: "1", fullName: "D. Chase" }],
      existingDrivers: [{ id: "d1", full_name: "Dale Chase" }],
      linkedDriverExternalIds: new Set(["1"]),
    });
    expect(result.driversToCreate).toEqual([]);
    expect(result.driversAlreadyPresent).toBe(1);
  });

  it("creates only one file when Samsara lists the same name twice", () => {
    const result = plan({
      drivers: [
        { externalId: "1", fullName: "Dale Chase" },
        { externalId: "2", fullName: "dale chase" },
      ],
    });
    expect(result.driversToCreate).toHaveLength(1);
    expect(result.driversSkipped).toHaveLength(1);
    expect(result.driversSkipped[0].reason).toMatch(/duplicate file/i);
  });

  it("skips a nameless Samsara driver instead of inventing a name", () => {
    const result = plan({ drivers: [{ externalId: "9", fullName: "   " }] });
    expect(result.driversToCreate).toEqual([]);
    expect(result.driversSkipped[0].reason).toMatch(/no name/i);
  });
});

describe("buildSamsaraImportPlan: vehicles", () => {
  const truck: EldVehicleSummary = {
    externalId: "v1",
    vin: "1XKYDP9X5KJ123456",
    plate: "ABC1234",
    unitNumber: "T-014",
    make: "Kenworth",
    model: "T880",
    year: 2019,
  };

  it("plans a unit carrying Samsara's identifiers through", () => {
    const result = plan({ vehicles: [truck] });
    expect(result.vehiclesToCreate).toEqual([
      {
        externalId: "v1",
        unitNumber: "T-014",
        vin: "1XKYDP9X5KJ123456",
        plate: "ABC1234",
        make: "Kenworth",
        model: "T880",
        year: 2019,
      },
    ]);
  });

  it("does not re-create a unit we already have by VIN", () => {
    const result = plan({
      vehicles: [truck],
      existingEquipment: [
        { id: "e1", unit_number: "OLD-NAME", vin_or_serial: "1xkydp9x5kj123456", license_plate: null },
      ],
    });
    expect(result.vehiclesToCreate).toEqual([]);
    expect(result.vehiclesAlreadyPresent).toBe(1);
  });

  it("does not re-create a unit we already have by unit number", () => {
    const result = plan({
      vehicles: [truck],
      existingEquipment: [{ id: "e1", unit_number: "t-014", vin_or_serial: null, license_plate: null }],
    });
    expect(result.vehiclesToCreate).toEqual([]);
    expect(result.vehiclesAlreadyPresent).toBe(1);
  });

  it("skips a Samsara vehicle with no unit name rather than guessing one", () => {
    const result = plan({ vehicles: [{ ...truck, externalId: "v2", unitNumber: null }] });
    expect(result.vehiclesToCreate).toEqual([]);
    expect(result.vehiclesSkipped[0].reason).toMatch(/no unit name/i);
    // The VIN is still shown so the operator can find the truck in Samsara.
    expect(result.vehiclesSkipped[0].label).toBe("1XKYDP9X5KJ123456");
  });

  it("creates one unit when Samsara lists the same unit name twice", () => {
    const result = plan({
      vehicles: [truck, { ...truck, externalId: "v2", vin: null }],
    });
    expect(result.vehiclesToCreate).toHaveLength(1);
    expect(result.vehiclesSkipped[0].reason).toMatch(/duplicate unit/i);
  });

  it("creates one unit when two Samsara vehicles share a VIN under different names", () => {
    const result = plan({
      vehicles: [truck, { ...truck, externalId: "v2", unitNumber: "T-014-SPARE" }],
    });
    expect(result.vehiclesToCreate).toHaveLength(1);
    expect(result.vehiclesSkipped[0].reason).toMatch(/same VIN/i);
  });
});

describe("isSamsaraImportPlanEmpty", () => {
  it("is empty only when nothing would be created", () => {
    expect(isSamsaraImportPlanEmpty(plan({}))).toBe(true);
    expect(isSamsaraImportPlanEmpty(plan({ drivers: [{ externalId: "1", fullName: "A" }] }))).toBe(false);
  });

  it("is still empty when everything already exists, so a re-run creates nothing", () => {
    const result = plan({
      drivers: [{ externalId: "1", fullName: "Dale Chase" }],
      vehicles: [{ externalId: "v1", vin: null, plate: null, unitNumber: "T-014", make: null, model: null, year: null }],
      existingDrivers: [{ id: "d1", full_name: "Dale Chase" }],
      existingEquipment: [{ id: "e1", unit_number: "T-014", vin_or_serial: null, license_plate: null }],
    });
    expect(isSamsaraImportPlanEmpty(result)).toBe(true);
    expect(result.driversAlreadyPresent).toBe(1);
    expect(result.vehiclesAlreadyPresent).toBe(1);
  });
});
