import { describe, expect, it } from "vitest";
import {
  extractMotiveDutyRecords,
  mapMotiveDutyStatus,
  motiveAuthorizeUrl,
  motiveTokenRequest,
  normalizeMotiveCollisions,
  normalizeMotiveDriverDetails,
  normalizeMotiveDriverPerformance,
  normalizeMotiveDrivers,
  normalizeMotiveSpeedingEvents,
  normalizeMotiveDutyRecords,
  normalizeMotiveEldDevices,
  normalizeMotiveEldDisconnects,
  normalizeMotiveFaultCodes,
  normalizeMotiveTrips,
  normalizeMotiveVehicles,
  parseMotiveTokenResponse,
} from "@/lib/eld/motive";

const credentials = {
  clientId: "client-123",
  clientSecret: "secret-456",
  redirectUri: "https://app.example.com/api/eld/motive/callback",
};

describe("motiveAuthorizeUrl", () => {
  it("builds an OAuth authorize URL with the required params", () => {
    const url = new URL(motiveAuthorizeUrl({ clientId: "client-123", redirectUri: credentials.redirectUri, state: "xyz", scopes: "hos.read" }));
    expect(url.origin + url.pathname).toBe("https://gomotive.com/oauth/authorize");
    expect(url.searchParams.get("client_id")).toBe("client-123");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("redirect_uri")).toBe(credentials.redirectUri);
    expect(url.searchParams.get("state")).toBe("xyz");
    expect(url.searchParams.get("scope")).toBe("hos.read");
  });
});

describe("motiveTokenRequest", () => {
  it("builds an authorization_code exchange body", () => {
    const { url, body } = motiveTokenRequest({ grant: "authorization_code", code: "auth-code", credentials });
    expect(url).toBe("https://api.gomotive.com/oauth/token");
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code")).toBe("auth-code");
    expect(body.get("redirect_uri")).toBe(credentials.redirectUri);
    expect(body.get("client_secret")).toBe("secret-456");
  });

  it("builds a refresh_token body", () => {
    const { body } = motiveTokenRequest({ grant: "refresh_token", refreshToken: "refresh-789", credentials });
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("refresh-789");
    expect(body.get("code")).toBeNull();
  });
});

describe("parseMotiveTokenResponse", () => {
  it("reads the token fields", () => {
    expect(parseMotiveTokenResponse({ access_token: "a", refresh_token: "r", expires_in: 3600 })).toEqual({
      accessToken: "a",
      refreshToken: "r",
      expiresInSeconds: 3600,
    });
  });

  it("returns null without an access token", () => {
    expect(parseMotiveTokenResponse({ refresh_token: "r" })).toBeNull();
  });
});

describe("mapMotiveDutyStatus", () => {
  it("maps Motive duty-status codes to our model", () => {
    expect(mapMotiveDutyStatus("driving")).toBe("driving");
    expect(mapMotiveDutyStatus("SB")).toBe("sleeper_berth");
    expect(mapMotiveDutyStatus("on_duty")).toBe("on_duty");
    expect(mapMotiveDutyStatus("off")).toBe("off_duty");
    expect(mapMotiveDutyStatus("nonsense")).toBeNull();
  });
});

describe("normalizeMotiveDutyRecords", () => {
  it("keeps mappable records and drops bad ones", () => {
    const events = normalizeMotiveDutyRecords([
      { driverId: 42, status: "driving", startTime: "2026-05-01T08:00:00Z" },
      { driverId: 42, status: "bogus", startTime: "2026-05-01T09:00:00Z" },
      { driverId: null, status: "off_duty", startTime: "2026-05-01T10:00:00Z" },
    ]);
    expect(events).toEqual([
      { externalDriverId: "42", status: "driving", startedAt: "2026-05-01T08:00:00.000Z", location: null },
    ]);
  });
});

describe("extractMotiveDutyRecords", () => {
  it("walks a Motive hos_logs response into duty records", () => {
    const raw = {
      hos_logs: [
        {
          hos_log: {
            driver: { id: 7 },
            duty_status_logs: [
              { duty_status: "driving", start_time: "2026-05-01T08:00:00Z" },
              { duty_status: "off_duty", start_time: "2026-05-01T18:00:00Z" },
            ],
          },
        },
      ],
    };
    const records = extractMotiveDutyRecords(raw);
    expect(records).toHaveLength(2);
    const events = normalizeMotiveDutyRecords(records);
    expect(events.map((e) => e.status)).toEqual(["driving", "off_duty"]);
    expect(events.every((e) => e.externalDriverId === "7")).toBe(true);
  });

  it("returns nothing for an empty or malformed response", () => {
    expect(extractMotiveDutyRecords(null)).toEqual([]);
    expect(extractMotiveDutyRecords({})).toEqual([]);
  });
});

describe("normalizeMotiveDrivers", () => {
  it("reads a Motive users response into driver summaries", () => {
    const raw = {
      users: [
        { user: { id: 7, first_name: "Jordan", last_name: "Lee" } },
        { user: { id: 8, first_name: "Sam", last_name: "Roy" } },
      ],
    };
    expect(normalizeMotiveDrivers(raw)).toEqual([
      { externalId: "7", fullName: "Jordan Lee" },
      { externalId: "8", fullName: "Sam Roy" },
    ]);
  });
});

describe("normalizeMotiveVehicles", () => {
  it("maps vehicles nested under `vehicle` with number, vin, plate, and specs", () => {
    const raw = {
      vehicles: [
        {
          vehicle: {
            id: 4821,
            number: "97",
            vin: "1XKDDB9X7PJ123456",
            license_plate_number: "ABC123",
            make: "Kenworth",
            model: "T800",
            year: 2022,
          },
        },
      ],
    };
    expect(normalizeMotiveVehicles(raw)).toEqual([
      {
        externalId: "4821",
        vin: "1XKDDB9X7PJ123456",
        plate: "ABC123",
        unitNumber: "97",
        make: "Kenworth",
        model: "T800",
        year: 2022,
      },
    ]);
  });

  it("handles flat items, plate fallbacks, and string years; skips items with no id", () => {
    const raw = {
      vehicles: [
        { id: 5, name: "T-12", plate: "XYZ789", year: "2021" },
        { number: "no-id" },
      ],
    };
    expect(normalizeMotiveVehicles(raw)).toEqual([
      { externalId: "5", vin: null, plate: "XYZ789", unitNumber: "T-12", make: null, model: null, year: 2021 },
    ]);
  });

  it("returns an empty array for non-object input", () => {
    expect(normalizeMotiveVehicles(null)).toEqual([]);
    expect(normalizeMotiveVehicles("nope")).toEqual([]);
  });
});

describe("normalizeMotiveTrips", () => {
  it("reads end odometer and end time per vehicle", () => {
    const raw = {
      trips: [
        { trip: { vehicle: { id: 4821 }, end_odometer: 185200, end_time: "2026-06-01T20:00:00Z" } },
        { vehicle_id: 9, odometer: "12030.5", ended_at: "2026-06-01T18:00:00Z" },
        { trip: { start_odometer: 500 } },
      ],
    };
    expect(normalizeMotiveTrips(raw)).toEqual([
      { externalVehicleId: "4821", odometer: 185200, recordedAt: "2026-06-01T20:00:00.000Z" },
      { externalVehicleId: "9", odometer: 12030.5, recordedAt: "2026-06-01T18:00:00.000Z" },
    ]);
  });

  it("returns an empty array for non-object input", () => {
    expect(normalizeMotiveTrips(null)).toEqual([]);
  });
});

describe("normalizeMotiveEldDevices", () => {
  it("maps device identifier, model, firmware, status, and last seen per vehicle", () => {
    const raw = {
      eld_devices: [
        {
          eld_device: {
            vehicle: { id: 4821 },
            identifier: "ELD-99",
            model: "Vendor X",
            firmware_version: "3.2.1",
            status: "connected",
            last_connected_at: "2026-06-01T12:00:00Z",
          },
        },
        { device: { serial_number: "no-vehicle" } },
      ],
    };
    expect(normalizeMotiveEldDevices(raw)).toEqual([
      {
        externalVehicleId: "4821",
        identifier: "ELD-99",
        model: "Vendor X",
        firmware: "3.2.1",
        status: "connected",
        lastSeenAt: "2026-06-01T12:00:00.000Z",
      },
    ]);
  });
});

describe("normalizeMotiveEldDisconnects", () => {
  it("maps disconnects to vehicle events and drops those without a vehicle or time", () => {
    const raw = {
      eld_disconnects: [
        { id: 11, vehicle_id: 4821, start_time: "2026-06-01T09:00:00Z", reason: "power loss" },
        { id: 12, start_time: "2026-06-01T10:00:00Z" },
      ],
    };
    expect(normalizeMotiveEldDisconnects(raw)).toEqual([
      {
        externalVehicleId: "4821",
        eventType: "disconnect",
        occurredAt: "2026-06-01T09:00:00.000Z",
        externalEventId: "11",
        description: "power loss",
      },
    ]);
  });
});

describe("normalizeMotiveFaultCodes", () => {
  it("builds a code from SPN/FMI when no explicit code and keeps severity", () => {
    const raw = {
      fault_codes: [
        { id: 7, vehicle: { id: 4821 }, spn: 100, fmi: 1, description: "Oil pressure low", severity: "high", occurred_at: "2026-06-01T08:00:00Z" },
      ],
    };
    expect(normalizeMotiveFaultCodes(raw)).toEqual([
      {
        externalVehicleId: "4821",
        eventType: "fault_code",
        occurredAt: "2026-06-01T08:00:00.000Z",
        externalEventId: "7",
        code: "SPN 100 FMI 1",
        description: "Oil pressure low",
        severity: "high",
      },
    ]);
  });

  it("returns nothing for an empty response (e.g. scope not granted)", () => {
    expect(normalizeMotiveFaultCodes(null)).toEqual([]);
  });
});

describe("normalizeMotiveDriverDetails", () => {
  it("reads contact, role, status, and manager from the users response", () => {
    const raw = {
      users: [
        {
          user: {
            id: 7,
            email: "jordan@fleet.test",
            phone: "555-0100",
            role: "driver",
            status: "active",
            manager: { name: "Pat Boss", email: "pat@fleet.test" },
          },
        },
        { user: { id: 8, is_active: false } },
      ],
    };
    expect(normalizeMotiveDriverDetails(raw)).toEqual([
      {
        externalDriverId: "7",
        email: "jordan@fleet.test",
        phone: "555-0100",
        role: "driver",
        status: "active",
        managerName: "Pat Boss",
        managerEmail: "pat@fleet.test",
      },
      {
        externalDriverId: "8",
        email: null,
        phone: null,
        role: null,
        status: "deactivated",
        managerName: null,
        managerEmail: null,
      },
    ]);
  });
});

describe("normalizeMotiveSpeedingEvents", () => {
  it("maps speeding events with speed, severity, and the vehicle", () => {
    const raw = {
      speeding_events: [
        { id: 3, driver: { id: 7 }, vehicle: { id: 4821 }, start_time: "2026-06-01T08:00:00Z", max_speed: 120, severity: "high", location: "Hwy 2" },
        { id: 4, start_time: "2026-06-01T09:00:00Z" },
      ],
    };
    expect(normalizeMotiveSpeedingEvents(raw)).toEqual([
      {
        externalDriverId: "7",
        externalVehicleId: "4821",
        eventType: "speeding",
        occurredAt: "2026-06-01T08:00:00.000Z",
        externalEventId: "3",
        value: 120,
        severity: "high",
        location: "Hwy 2",
      },
    ]);
  });
});

describe("normalizeMotiveCollisions", () => {
  it("maps collisions to driver collision events", () => {
    const raw = {
      collisions: [{ id: 9, driver_id: 7, vehicle_id: 4821, occurred_at: "2026-06-01T10:00:00Z", severity: "major", description: "Rear-end" }],
    };
    expect(normalizeMotiveCollisions(raw)).toEqual([
      {
        externalDriverId: "7",
        externalVehicleId: "4821",
        eventType: "collision",
        occurredAt: "2026-06-01T10:00:00.000Z",
        externalEventId: "9",
        severity: "major",
        description: "Rear-end",
        location: null,
      },
    ]);
  });
});

describe("normalizeMotiveDriverPerformance", () => {
  it("maps a scorecard with score, counts, and period", () => {
    const raw = {
      driver_performance: [
        { driver: { id: 7 }, start_date: "2026-05-01", end_date: "2026-05-31", score: 92, speeding_count: 2, hard_brake_count: 1, hard_accel_count: 3, distance: 5400, drive_time_minutes: 6000 },
      ],
    };
    expect(normalizeMotiveDriverPerformance(raw)).toEqual([
      {
        externalDriverId: "7",
        periodStart: "2026-05-01",
        periodEnd: "2026-05-31",
        score: 92,
        totalEvents: null,
        speedingCount: 2,
        harshBrakeCount: 1,
        harshAccelCount: 3,
        distance: 5400,
        driveTimeMinutes: 6000,
      },
    ]);
  });
});
