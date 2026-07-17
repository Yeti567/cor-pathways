import { describe, expect, it } from "vitest";
import {
  ELD_PROVIDERS,
  eldProviderConfig,
  isEldProvider,
  isEldProviderConfigured,
} from "@/lib/eld/providers";
import {
  buildDutyEventInserts,
  buildEldDeviceUpserts,
  buildEldDriverEventInserts,
  buildEldDriverPerformanceUpserts,
  buildEldDriverProfileUpserts,
  buildEldMeterReadings,
  buildEldVehicleEventInserts,
  buildVehicleLinkMatches,
  dutyEventKey,
  type EldDriverDetail,
  type EldDriverPerformance,
  type EldVehicleSummary,
  type EquipmentMatchRow,
  type NormalizedDriverEvent,
  type NormalizedDutyEvent,
  type NormalizedVehicleEvent,
} from "@/lib/eld/sync";

describe("ELD provider registry", () => {
  it("lists the four prioritized Canadian providers with unique ids", () => {
    const ids = ELD_PROVIDERS.map((provider) => provider.id);
    expect(ids).toEqual(["motive", "samsara", "geotab", "isaac"]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("recognizes valid provider ids", () => {
    expect(isEldProvider("motive")).toBe(true);
    expect(isEldProvider("nope")).toBe(false);
  });

  it("reports OAuth providers as configured only when their credentials are present", () => {
    expect(isEldProviderConfigured("motive", {})).toBe(false);
    expect(isEldProviderConfigured("motive", { MOTIVE_CLIENT_ID: "x" })).toBe(false);
    expect(isEldProviderConfigured("motive", { MOTIVE_CLIENT_ID: "x", MOTIVE_CLIENT_SECRET: "y" })).toBe(true);
  });

  it("treats session providers with no app secret as ready", () => {
    expect(eldProviderConfig("geotab")?.authType).toBe("session");
    expect(isEldProviderConfigured("geotab", {})).toBe(true);
  });
});

describe("buildDutyEventInserts", () => {
  const events: NormalizedDutyEvent[] = [
    { externalDriverId: "ext-1", status: "driving", startedAt: "2026-05-01T08:00:00.000Z" },
    { externalDriverId: "ext-1", status: "off_duty", startedAt: "2026-05-01T18:00:00.000Z" },
    { externalDriverId: "ext-unmapped", status: "driving", startedAt: "2026-05-01T09:00:00.000Z" },
  ];
  const links = new Map([["ext-1", "driver-1"]]);

  it("maps matched events to eld-sourced rows and skips unmatched drivers", () => {
    const result = buildDutyEventInserts({ tenantId: "t1", events, driverIdByExternalId: links });

    expect(result.matched).toBe(2);
    expect(result.skippedUnmatched).toBe(1);
    expect(result.inserts.every((row) => row.source === "eld")).toBe(true);
    expect(result.inserts.every((row) => row.driver_id === "driver-1" && row.tenant_id === "t1")).toBe(true);
  });

  it("skips events that already exist", () => {
    const existingKeys = new Set([dutyEventKey("driver-1", "2026-05-01T08:00:00.000Z", "driving")]);
    const result = buildDutyEventInserts({ tenantId: "t1", events, driverIdByExternalId: links, existingKeys });

    expect(result.matched).toBe(1);
    expect(result.skippedDuplicate).toBe(1);
  });

  it("de-duplicates repeated events within a single batch", () => {
    const dupes: NormalizedDutyEvent[] = [events[0], events[0]];
    const result = buildDutyEventInserts({ tenantId: "t1", events: dupes, driverIdByExternalId: links });

    expect(result.matched).toBe(1);
    expect(result.skippedDuplicate).toBe(1);
  });
});

describe("buildVehicleLinkMatches", () => {
  const equipment: EquipmentMatchRow[] = [
    { id: "eq-truck", unit_number: "97", vin_or_serial: "1XKDDB9X7PJ123456", license_plate: "ABC123" },
    { id: "eq-trailer", unit_number: "T-12", vin_or_serial: "2T9TRLR000000001", license_plate: null },
  ];

  function vehicle(overrides: Partial<EldVehicleSummary>): EldVehicleSummary {
    return { externalId: "v1", vin: null, plate: null, unitNumber: null, make: null, model: null, year: null, ...overrides };
  }

  it("matches by VIN first, case-insensitively", () => {
    const matches = buildVehicleLinkMatches({
      vehicles: [vehicle({ externalId: "mv-1", vin: "1xkddb9x7pj123456", unitNumber: "nope" })],
      equipment,
    });
    expect(matches).toEqual([{ externalVehicleId: "mv-1", equipmentId: "eq-truck" }]);
  });

  it("falls back to plate, then to unit number", () => {
    const byPlate = buildVehicleLinkMatches({ vehicles: [vehicle({ externalId: "p", plate: "abc123" })], equipment });
    expect(byPlate).toEqual([{ externalVehicleId: "p", equipmentId: "eq-truck" }]);

    const byUnit = buildVehicleLinkMatches({ vehicles: [vehicle({ externalId: "u", unitNumber: "T-12" })], equipment });
    expect(byUnit).toEqual([{ externalVehicleId: "u", equipmentId: "eq-trailer" }]);
  });

  it("skips already-linked provider vehicles", () => {
    const matches = buildVehicleLinkMatches({
      vehicles: [vehicle({ externalId: "mv-1", vin: "1XKDDB9X7PJ123456" })],
      equipment,
      alreadyLinkedExternalIds: new Set(["mv-1"]),
    });
    expect(matches).toEqual([]);
  });

  it("does not match on empty identifiers and skips ambiguous duplicates", () => {
    const dupes: EquipmentMatchRow[] = [
      { id: "a", unit_number: "5", vin_or_serial: null, license_plate: null },
      { id: "b", unit_number: "5", vin_or_serial: null, license_plate: null },
    ];
    // Empty VIN/plate must not match the null-keyed units; the shared unit "5" is ambiguous.
    const matches = buildVehicleLinkMatches({ vehicles: [vehicle({ externalId: "x", unitNumber: "5" })], equipment: dupes });
    expect(matches).toEqual([]);
  });

  it("does not link two provider vehicles to the same unit in one pass", () => {
    const matches = buildVehicleLinkMatches({
      vehicles: [
        vehicle({ externalId: "first", vin: "1XKDDB9X7PJ123456" }),
        vehicle({ externalId: "second", plate: "ABC123" }),
      ],
      equipment,
    });
    expect(matches).toEqual([{ externalVehicleId: "first", equipmentId: "eq-truck" }]);
  });
});

describe("buildEldMeterReadings", () => {
  const links = new Map<string, string>([
    ["mv-truck", "eq-truck"],
    ["mv-hours", "eq-hours"],
  ]);
  const info = new Map([
    ["eq-truck", { id: "eq-truck", currentMeter: 185000, trackingMode: "mileage" }],
    ["eq-hours", { id: "eq-hours", currentMeter: 100, trackingMode: "hours" }],
  ]);

  it("advances a mileage unit to the highest trip odometer", () => {
    const { inserts, updated } = buildEldMeterReadings({
      tenantId: "t1",
      trips: [
        { externalVehicleId: "mv-truck", odometer: 185100, recordedAt: "2026-06-01T10:00:00.000Z" },
        { externalVehicleId: "mv-truck", odometer: 185300, recordedAt: "2026-06-01T20:00:00.000Z" },
      ],
      equipmentIdByExternalVehicleId: links,
      equipmentInfoById: info,
    });
    expect(updated).toBe(1);
    expect(inserts[0]).toMatchObject({
      tenant_id: "t1",
      equipment_id: "eq-truck",
      value: 185300,
      source: "eld",
      recorded_at: "2026-06-01T20:00:00.000Z",
    });
  });

  it("does not move the meter backward or sideways", () => {
    const { inserts } = buildEldMeterReadings({
      tenantId: "t1",
      trips: [{ externalVehicleId: "mv-truck", odometer: 185000, recordedAt: null }],
      equipmentIdByExternalVehicleId: links,
      equipmentInfoById: info,
    });
    expect(inserts).toEqual([]);
  });

  it("skips readings already logged from the ELD (idempotent)", () => {
    const { inserts } = buildEldMeterReadings({
      tenantId: "t1",
      trips: [{ externalVehicleId: "mv-truck", odometer: 185500, recordedAt: null }],
      equipmentIdByExternalVehicleId: links,
      equipmentInfoById: info,
      existingKeys: new Set(["eq-truck|185500"]),
    });
    expect(inserts).toEqual([]);
  });

  it("ignores hours-tracked units (trips measure distance) and unlinked vehicles", () => {
    const result = buildEldMeterReadings({
      tenantId: "t1",
      trips: [
        { externalVehicleId: "mv-hours", odometer: 9999, recordedAt: null },
        { externalVehicleId: "mv-unknown", odometer: 9999, recordedAt: null },
      ],
      equipmentIdByExternalVehicleId: links,
      equipmentInfoById: info,
    });
    expect(result.inserts).toEqual([]);
    expect(result.skippedUnlinked).toBe(1);
  });
});

describe("buildEldDeviceUpserts", () => {
  it("resolves linked vehicles to device rows and skips unlinked ones", () => {
    const rows = buildEldDeviceUpserts({
      tenantId: "t1",
      provider: "motive",
      devices: [
        { externalVehicleId: "mv-1", identifier: "ELD-9", model: "X", firmware: "1.0", status: "connected", lastSeenAt: null },
        { externalVehicleId: "mv-unknown", identifier: "ELD-0", model: null, firmware: null, status: null, lastSeenAt: null },
      ],
      equipmentIdByExternalVehicleId: new Map([["mv-1", "eq-1"]]),
    });
    expect(rows).toEqual([
      {
        tenant_id: "t1",
        provider: "motive",
        external_vehicle_id: "mv-1",
        equipment_id: "eq-1",
        identifier: "ELD-9",
        model: "X",
        firmware: "1.0",
        status: "connected",
        last_seen_at: null,
      },
    ]);
  });
});

describe("buildEldVehicleEventInserts", () => {
  const links = new Map<string, string>([["mv-1", "eq-1"]]);
  const events: NormalizedVehicleEvent[] = [
    { externalVehicleId: "mv-1", eventType: "disconnect", occurredAt: "2026-06-01T09:00:00Z", externalEventId: "11", description: "power loss" },
    { externalVehicleId: "mv-1", eventType: "fault_code", occurredAt: "2026-06-01T08:00:00Z", code: "SPN 100 FMI 1", severity: "high" },
    { externalVehicleId: "mv-unknown", eventType: "disconnect", occurredAt: "2026-06-01T07:00:00Z" },
  ];

  it("maps linked events, defaults payload, and counts unlinked", () => {
    const { inserts, skippedUnlinked } = buildEldVehicleEventInserts({
      tenantId: "t1",
      provider: "motive",
      events,
      equipmentIdByExternalVehicleId: links,
    });
    expect(skippedUnlinked).toBe(1);
    expect(inserts).toHaveLength(2);
    expect(inserts[0]).toMatchObject({
      tenant_id: "t1",
      provider: "motive",
      equipment_id: "eq-1",
      event_type: "disconnect",
      external_event_id: "11",
      occurred_at: "2026-06-01T09:00:00.000Z",
      payload: {},
    });
  });

  it("skips events already stored and repeats within the batch", () => {
    const existingKeys = new Set([
      `eq-1|disconnect|2026-06-01T09:00:00.000Z||11`,
    ]);
    const { inserts } = buildEldVehicleEventInserts({
      tenantId: "t1",
      provider: "motive",
      events: [events[0], events[0]],
      equipmentIdByExternalVehicleId: links,
      existingKeys,
    });
    expect(inserts).toEqual([]);
  });
});

describe("buildEldDriverProfileUpserts", () => {
  const details: EldDriverDetail[] = [
    { externalDriverId: "7", email: "a@b.c", phone: "555", role: "driver", status: "active", managerName: "Pat", managerEmail: null },
    { externalDriverId: "unlinked", email: "x@y.z", phone: null, role: null, status: null, managerName: null, managerEmail: null },
  ];

  it("upserts only linked drivers and stamps reported_at", () => {
    const rows = buildEldDriverProfileUpserts({
      tenantId: "t1",
      provider: "motive",
      details,
      driverIdByExternalId: new Map([["7", "driver-7"]]),
      reportedAt: "2026-06-02T00:00:00.000Z",
    });
    expect(rows).toEqual([
      {
        tenant_id: "t1",
        provider: "motive",
        external_driver_id: "7",
        driver_id: "driver-7",
        email: "a@b.c",
        phone: "555",
        role: "driver",
        status: "active",
        manager_name: "Pat",
        manager_email: null,
        reported_at: "2026-06-02T00:00:00.000Z",
      },
    ]);
  });
});

describe("buildEldDriverEventInserts", () => {
  const drivers = new Map([["7", "driver-7"]]);
  const vehicles = new Map([["4821", "eq-truck"]]);
  const events: NormalizedDriverEvent[] = [
    { externalDriverId: "7", externalVehicleId: "4821", eventType: "speeding", occurredAt: "2026-06-01T08:00:00Z", externalEventId: "3", value: 120 },
    { externalDriverId: "unlinked", eventType: "collision", occurredAt: "2026-06-01T10:00:00Z" },
  ];

  it("resolves driver and optional vehicle, defaults payload, counts unlinked", () => {
    const { inserts, skippedUnlinked } = buildEldDriverEventInserts({
      tenantId: "t1",
      provider: "motive",
      events,
      driverIdByExternalId: drivers,
      equipmentIdByExternalVehicleId: vehicles,
    });
    expect(skippedUnlinked).toBe(1);
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({
      tenant_id: "t1",
      provider: "motive",
      driver_id: "driver-7",
      equipment_id: "eq-truck",
      event_type: "speeding",
      value: 120,
      occurred_at: "2026-06-01T08:00:00.000Z",
      payload: {},
    });
  });

  it("skips events already stored", () => {
    const existingKeys = new Set(["driver-7|speeding|2026-06-01T08:00:00.000Z|3"]);
    const { inserts } = buildEldDriverEventInserts({
      tenantId: "t1",
      provider: "motive",
      events: [events[0]],
      driverIdByExternalId: drivers,
      existingKeys,
    });
    expect(inserts).toEqual([]);
  });
});

describe("buildEldDriverPerformanceUpserts", () => {
  it("upserts only linked drivers", () => {
    const performances: EldDriverPerformance[] = [
      { externalDriverId: "7", score: 92, speedingCount: 2 },
      { externalDriverId: "unlinked", score: 50 },
    ];
    const rows = buildEldDriverPerformanceUpserts({
      tenantId: "t1",
      provider: "motive",
      performances,
      driverIdByExternalId: new Map([["7", "driver-7"]]),
      reportedAt: "2026-06-02T00:00:00.000Z",
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ driver_id: "driver-7", score: 92, speeding_count: 2, reported_at: "2026-06-02T00:00:00.000Z" });
  });
});
