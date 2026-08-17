import { describe, expect, it } from "vitest";
import {
  SAMSARA_PAGE_LIMIT,
  extractSamsaraDutyRecords,
  mapSamsaraBehaviour,
  mapSamsaraDutyStatus,
  metresToKm,
  normalizeSamsaraDriverDetails,
  normalizeSamsaraDrivers,
  normalizeSamsaraDutyRecords,
  normalizeSamsaraSafetyEvents,
  normalizeSamsaraVehicleStats,
  normalizeSamsaraVehicles,
  samsaraAuthHeaders,
  samsaraNextCursor,
  samsaraUrl,
} from "@/lib/eld/samsara";
import { eldProviderConfig, isEldProviderConfigured } from "@/lib/eld/providers";

describe("samsara provider registration", () => {
  it("authorizes with a per-connection API token, not app-level env vars", () => {
    const provider = eldProviderConfig("samsara");
    expect(provider?.authType).toBe("api_key");
    // No app registration required, so a new client can connect on day one.
    expect(provider?.credentialEnvVars).toEqual([]);
    expect(isEldProviderConfigured("samsara", {})).toBe(true);
  });
});

describe("samsaraAuthHeaders", () => {
  it("sends the token as a bearer credential", () => {
    expect(samsaraAuthHeaders("tok_123")).toEqual({
      authorization: "Bearer tok_123",
      accept: "application/json",
    });
  });
});

describe("samsaraUrl", () => {
  it("always requests the max page size and drops empty query values", () => {
    const url = new URL(samsaraUrl({ path: "/fleet/drivers", query: { startTime: "", types: "a" } }));
    expect(url.pathname).toBe("/fleet/drivers");
    expect(url.searchParams.get("limit")).toBe(String(SAMSARA_PAGE_LIMIT));
    expect(url.searchParams.get("types")).toBe("a");
    expect(url.searchParams.has("startTime")).toBe(false);
  });

  it("passes the cursor as `after` when continuing a page walk", () => {
    const url = new URL(samsaraUrl({ path: "/fleet/vehicles", cursor: "abc123" }));
    expect(url.searchParams.get("after")).toBe("abc123");
  });
});

describe("samsaraNextCursor", () => {
  it("returns the cursor only while hasNextPage is true", () => {
    expect(samsaraNextCursor({ pagination: { endCursor: "c1", hasNextPage: true } })).toBe("c1");
    expect(samsaraNextCursor({ pagination: { endCursor: "c1", hasNextPage: false } })).toBeNull();
    expect(samsaraNextCursor({})).toBeNull();
    expect(samsaraNextCursor(null)).toBeNull();
  });

  it("keeps paging on a sparse page, which Samsara documents as possible", () => {
    expect(samsaraNextCursor({ data: [], pagination: { endCursor: "c2", hasNextPage: true } })).toBe("c2");
  });
});

describe("mapSamsaraDutyStatus", () => {
  it("maps all six Samsara statuses onto the four-state model", () => {
    expect(mapSamsaraDutyStatus("offDuty")).toBe("off_duty");
    expect(mapSamsaraDutyStatus("sleeperBed")).toBe("sleeper_berth");
    expect(mapSamsaraDutyStatus("driving")).toBe("driving");
    expect(mapSamsaraDutyStatus("onDuty")).toBe("on_duty");
    // Yard move is on-duty movement, not driving time.
    expect(mapSamsaraDutyStatus("yardMove")).toBe("on_duty");
    // Personal conveyance is authorized personal use, which is off-duty.
    expect(mapSamsaraDutyStatus("personalConveyance")).toBe("off_duty");
  });

  it("is tolerant of casing and separators, and rejects unknowns", () => {
    expect(mapSamsaraDutyStatus("OFF_DUTY")).toBe("off_duty");
    expect(mapSamsaraDutyStatus("sleeper bed")).toBe("sleeper_berth");
    expect(mapSamsaraDutyStatus("teleporting")).toBeNull();
    expect(mapSamsaraDutyStatus(null)).toBeNull();
  });
});

describe("samsara HOS logs", () => {
  const response = {
    data: [
      {
        driver: { id: "4321", name: "Sam Rivera" },
        logs: [
          {
            logStartTime: "2026-08-01T14:00:00Z",
            hosStatusType: "driving",
            logRecordedLocation: { latitude: 53.27, longitude: -110.005 },
          },
          {
            logStartTime: "2026-08-01T22:30:00Z",
            hosStatusType: "offDuty",
          },
        ],
      },
    ],
    pagination: { endCursor: "", hasNextPage: false },
  };

  it("pulls each driver's duty records out of the nested response", () => {
    const records = extractSamsaraDutyRecords(response);
    expect(records).toHaveLength(2);
    expect(records[0].driverId).toBe("4321");
    expect(records[0].status).toBe("driving");
    expect(records[0].location).toBe("53.27000, -110.00500");
    expect(records[1].location).toBeNull();
  });

  it("also accepts the hosLogs key so a naming change cannot silently drop events", () => {
    const alt = { data: [{ driver: { id: "9" }, hosLogs: [{ logStartTime: "2026-08-01T00:00:00Z", hosStatusType: "onDuty" }] }] };
    expect(extractSamsaraDutyRecords(alt)).toHaveLength(1);
  });

  it("normalizes to duty events with ISO timestamps", () => {
    const events = normalizeSamsaraDutyRecords(extractSamsaraDutyRecords(response));
    expect(events).toEqual([
      {
        externalDriverId: "4321",
        status: "driving",
        startedAt: "2026-08-01T14:00:00.000Z",
        location: "53.27000, -110.00500",
      },
      {
        externalDriverId: "4321",
        status: "off_duty",
        startedAt: "2026-08-01T22:30:00.000Z",
        location: null,
      },
    ]);
  });

  it("drops records missing a driver, a status, or a usable time", () => {
    const events = normalizeSamsaraDutyRecords([
      { driverId: null, status: "driving", startTime: "2026-08-01T00:00:00Z" },
      { driverId: "1", status: "nonsense", startTime: "2026-08-01T00:00:00Z" },
      { driverId: "1", status: "driving", startTime: "not-a-date" },
    ]);
    expect(events).toEqual([]);
  });
});

describe("normalizeSamsaraDrivers", () => {
  const response = {
    data: [
      { id: "111", name: "Sam Rivera", email: "sam@example.com", phone: "780-555-0100", driverActivationStatus: "active" },
      { id: "222", username: "jdoe", driverActivationStatus: "deactivated" },
      { name: "No id, skipped" },
    ],
  };

  it("maps id and name, falling back to username", () => {
    expect(normalizeSamsaraDrivers(response)).toEqual([
      { externalId: "111", fullName: "Sam Rivera" },
      { externalId: "222", fullName: "jdoe" },
    ]);
  });

  it("reads contact and activation status, leaving manager fields null", () => {
    const details = normalizeSamsaraDriverDetails(response);
    expect(details[0]).toEqual({
      externalDriverId: "111",
      email: "sam@example.com",
      phone: "780-555-0100",
      role: null,
      status: "active",
      managerName: null,
      managerEmail: null,
    });
    expect(details[1].status).toBe("deactivated");
  });
});

describe("normalizeSamsaraVehicles", () => {
  it("maps the Samsara vehicle name onto our unit number for matching", () => {
    const vehicles = normalizeSamsaraVehicles({
      data: [
        {
          id: "777",
          name: "T-014",
          vin: "1XKYDP9X5KJ123456",
          licensePlate: "ABC1234",
          make: "Kenworth",
          model: "T880",
          year: 2019,
        },
      ],
    });

    expect(vehicles).toEqual([
      {
        externalId: "777",
        vin: "1XKYDP9X5KJ123456",
        plate: "ABC1234",
        unitNumber: "T-014",
        make: "Kenworth",
        model: "T880",
        year: 2019,
      },
    ]);
  });
});

describe("samsara odometer units", () => {
  it("converts metres to whole kilometres", () => {
    expect(metresToKm(145_000_000)).toBe(145_000);
    expect(metresToKm(1_499)).toBe(1);
  });

  it("reports odometer in kilometres, not the raw metres Samsara returns", () => {
    const readings = normalizeSamsaraVehicleStats({
      data: [
        {
          id: "777",
          obdOdometerMeters: { time: "2026-08-13T18:00:00Z", value: 145_000_000 },
        },
      ],
    });

    // 145,000,000 m is 145,000 km. Passing the raw value through would read as
    // 145 million km and mark every unit wildly overdue for service.
    expect(readings).toEqual([
      { externalVehicleId: "777", odometer: 145_000, recordedAt: "2026-08-13T18:00:00.000Z" },
    ]);
  });

  it("falls back to the GPS odometer when the truck has no engine connection", () => {
    const readings = normalizeSamsaraVehicleStats({
      data: [{ id: "888", gpsOdometerMeters: { time: "2026-08-13T18:00:00Z", value: 90_500_000 } }],
    });
    expect(readings[0].odometer).toBe(90_500);
  });

  it("prefers the OBD reading over GPS when both are present", () => {
    const readings = normalizeSamsaraVehicleStats({
      data: [
        {
          id: "999",
          obdOdometerMeters: { time: "2026-08-13T18:00:00Z", value: 10_000_000 },
          gpsOdometerMeters: { time: "2026-08-13T18:00:00Z", value: 12_000_000 },
        },
      ],
    });
    expect(readings[0].odometer).toBe(10_000);
  });

  it("skips vehicles reporting no odometer at all", () => {
    expect(normalizeSamsaraVehicleStats({ data: [{ id: "1" }] })).toEqual([]);
  });
});

describe("mapSamsaraBehaviour", () => {
  it("maps Samsara behaviour labels to our event types", () => {
    expect(mapSamsaraBehaviour("Speeding")).toBe("speeding");
    expect(mapSamsaraBehaviour("Harsh Brake")).toBe("harsh_brake");
    expect(mapSamsaraBehaviour("Harsh Acceleration")).toBe("harsh_accel");
    expect(mapSamsaraBehaviour("Crash")).toBe("collision");
    expect(mapSamsaraBehaviour("Rolling Stop")).toBe("other");
    expect(mapSamsaraBehaviour(null)).toBe("other");
  });
});

describe("normalizeSamsaraSafetyEvents", () => {
  it("emits one row per behaviour with a unique de-duplication id", () => {
    const events = normalizeSamsaraSafetyEvents({
      data: [
        {
          id: "evt-1",
          time: "2026-08-10T15:04:05Z",
          driver: { id: "111" },
          vehicle: { id: "777" },
          behaviorLabels: [{ label: "Harsh Brake" }, { label: "Crash" }],
        },
      ],
    });

    expect(events).toHaveLength(2);
    expect(events.map((event) => event.eventType)).toEqual(["harsh_brake", "collision"]);
    expect(events.map((event) => event.externalEventId)).toEqual(["evt-1:harsh_brake", "evt-1:collision"]);
    expect(events[0].externalDriverId).toBe("111");
    expect(events[0].externalVehicleId).toBe("777");
    expect(events[0].occurredAt).toBe("2026-08-10T15:04:05.000Z");
  });

  it("falls back to the harsh-acceleration type when no labels are present", () => {
    const events = normalizeSamsaraSafetyEvents({
      data: [{ id: "evt-2", time: "2026-08-10T15:04:05Z", driver: { id: "111" }, harshAccelerationType: "harshTurn" }],
    });
    expect(events).toHaveLength(1);
    expect(events[0].eventType).toBe("other");
    expect(events[0].description).toBe("harshTurn");
  });

  it("drops events with no driver or no usable time", () => {
    expect(
      normalizeSamsaraSafetyEvents({
        data: [
          { id: "a", time: "2026-08-10T15:04:05Z" },
          { id: "b", driver: { id: "111" } },
        ],
      }),
    ).toEqual([]);
  });
});
