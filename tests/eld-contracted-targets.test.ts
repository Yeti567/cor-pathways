import { describe, expect, it } from "vitest";
import {
  buildDutyEventInserts,
  buildEldDeviceUpserts,
  buildEldDriverProfileUpserts,
  buildEldMeterReadings,
  type EquipmentMeterInfo,
} from "@/lib/eld/sync";
import {
  driverTargetColumns,
  readDriverTarget,
  readVehicleTarget,
  splitEldTargets,
  vehicleTargetColumns,
  type EldTarget,
} from "@/lib/eld/targets";

const OWN: EldTarget = { kind: "own", id: "own-1" };
const CONTRACTED: EldTarget = { kind: "contracted", id: "sub-1" };

describe("target columns", () => {
  // The whole point of routing through these helpers: a contracted id written into the
  // own-fleet column would pass the type checker, break a foreign key it does not belong
  // to, and surface as a mysterious sync error rather than as the wiring bug it is.
  it("puts a contracted driver in the contracted column and nothing in the other", () => {
    expect(driverTargetColumns(CONTRACTED)).toEqual({ driver_id: null, contracted_driver_id: "sub-1" });
  });

  it("puts an own driver in the own column", () => {
    expect(driverTargetColumns(OWN)).toEqual({ driver_id: "own-1", contracted_driver_id: null });
  });

  it("leaves both vehicle columns null when there is no target", () => {
    expect(vehicleTargetColumns(null)).toEqual({ equipment_id: null, contracted_equipment_id: null });
  });

  it("reads a stored row back to the target it was written from", () => {
    expect(readDriverTarget(driverTargetColumns(CONTRACTED))).toEqual(CONTRACTED);
    expect(readDriverTarget(driverTargetColumns(OWN))).toEqual(OWN);
    expect(readVehicleTarget(vehicleTargetColumns(CONTRACTED))).toEqual(CONTRACTED);
    expect(readVehicleTarget(vehicleTargetColumns(OWN))).toEqual(OWN);
  });

  it("reads a row with neither column set as no target", () => {
    expect(readDriverTarget({ driver_id: null, contracted_driver_id: null })).toBeNull();
    expect(readVehicleTarget({})).toBeNull();
  });
});

describe("splitEldTargets", () => {
  // The de-duplication queries filter one column at a time. Getting this split wrong does
  // not error: it finds nothing for the other kind and re-inserts the whole sync window
  // on every run.
  it("separates the two kinds and de-duplicates each", () => {
    expect(
      splitEldTargets([
        OWN,
        CONTRACTED,
        { kind: "contracted", id: "sub-1" },
        { kind: "contracted", id: "sub-2" },
      ]),
    ).toEqual({ own: ["own-1"], contracted: ["sub-1", "sub-2"] });
  });

  it("returns empty lists for no targets", () => {
    expect(splitEldTargets([])).toEqual({ own: [], contracted: [] });
  });
});

describe("duty events for a contracted driver", () => {
  it("files against the contracted column", () => {
    const { inserts, matched } = buildDutyEventInserts({
      tenantId: "t1",
      events: [
        {
          externalDriverId: "ext-1",
          status: "driving",
          startedAt: "2026-08-26T12:00:00.000Z",
          location: null,
        },
      ],
      driverIdByExternalId: new Map<string, EldTarget>([["ext-1", CONTRACTED]]),
    });

    expect(matched).toBe(1);
    expect(inserts[0].driver_id).toBeNull();
    expect(inserts[0].contracted_driver_id).toBe("sub-1");
    expect(inserts[0].source).toBe("eld");
  });
});

describe("driver profiles for a contracted driver", () => {
  it("files against the contracted column", () => {
    const rows = buildEldDriverProfileUpserts({
      tenantId: "t1",
      provider: "samsara",
      details: [
        {
          externalDriverId: "ext-1",
          email: "a@b.c",
          phone: null,
          role: null,
          status: null,
          managerName: null,
          managerEmail: null,
        },
      ],
      driverIdByExternalId: new Map<string, EldTarget>([["ext-1", CONTRACTED]]),
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].driver_id).toBeNull();
    expect(rows[0].contracted_driver_id).toBe("sub-1");
  });
});

describe("devices on a contracted unit", () => {
  it("files against the contracted column", () => {
    const rows = buildEldDeviceUpserts({
      tenantId: "t1",
      provider: "samsara",
      devices: [
        {
          externalVehicleId: "veh-1",
          identifier: "ELD-1",
          model: null,
          firmware: null,
          status: null,
          lastSeenAt: null,
        },
      ],
      equipmentIdByExternalVehicleId: new Map<string, EldTarget>([["veh-1", CONTRACTED]]),
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].equipment_id).toBeNull();
    expect(rows[0].contracted_equipment_id).toBe("sub-1");
  });
});

describe("odometer readings", () => {
  const info = new Map<string, EquipmentMeterInfo>([
    ["own-1", { id: "own-1", currentMeter: 1000, trackingMode: "mileage" }],
  ]);

  it("advances an own-fleet unit", () => {
    const { inserts, skippedUnlinked } = buildEldMeterReadings({
      tenantId: "t1",
      trips: [{ externalVehicleId: "veh-1", odometer: 2000, recordedAt: null }],
      equipmentIdByExternalVehicleId: new Map<string, EldTarget>([["veh-1", OWN]]),
      equipmentInfoById: info,
    });

    expect(skippedUnlinked).toBe(0);
    expect(inserts).toHaveLength(1);
    expect(inserts[0].equipment_id).toBe("own-1");
  });

  it("skips a contracted unit rather than inventing a meter log for it", () => {
    // equipment_meter_log belongs to a unit this company services. A contracted unit has
    // no meter history, scheduled service or maintenance log here, so a reading for one
    // is reported as unlinked instead of being given a home it does not have.
    const { inserts, skippedUnlinked } = buildEldMeterReadings({
      tenantId: "t1",
      trips: [{ externalVehicleId: "veh-1", odometer: 2000, recordedAt: null }],
      equipmentIdByExternalVehicleId: new Map<string, EldTarget>([["veh-1", CONTRACTED]]),
      equipmentInfoById: info,
    });

    expect(inserts).toHaveLength(0);
    expect(skippedUnlinked).toBe(1);
  });
});
