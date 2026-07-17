// Motive (formerly KeepTruckin) connector.
//
// Pure building blocks for the Motive OAuth 2.0 flow and the transforms that map
// Motive's API responses into the framework's normalized shapes. The server
// orchestration (token exchange, DB writes) lives in motive-sync.ts; everything
// here is pure and unit-tested so the OAuth URL, token request, and response
// mapping are verifiable without live credentials.
//
// Base URLs and scopes are overridable via env so they can be corrected against
// the Motive developer portal when the app is registered, without code changes.

import type { DutyStatus } from "@/lib/hos-rules";
import type {
  EldDeviceSummary,
  EldDriverDetail,
  EldDriverPerformance,
  EldDriverSummary,
  EldTripReading,
  EldVehicleSummary,
  NormalizedDriverEvent,
  NormalizedDutyEvent,
  NormalizedVehicleEvent,
} from "@/lib/eld/sync";

export const MOTIVE_AUTHORIZE_URL = process.env.MOTIVE_AUTHORIZE_URL?.trim() || "https://gomotive.com/oauth/authorize";
export const MOTIVE_TOKEN_URL = process.env.MOTIVE_TOKEN_URL?.trim() || "https://api.gomotive.com/oauth/token";
export const MOTIVE_API_BASE = process.env.MOTIVE_API_BASE?.trim() || "https://api.gomotive.com";

// Read scopes for the data we ingest: drivers/HOS plus the vehicle telematics
// (vehicles, trips for odometer, ELD devices/disconnects, and engine fault codes).
// Motive defines the actual permissions on the app in the portal; the exact scope
// identifiers are overridable via MOTIVE_SCOPES and should be confirmed there.
export const MOTIVE_SCOPES =
  process.env.MOTIVE_SCOPES?.trim() ||
  "users.read vehicles.read hos.read trips.read eld_devices.read fault_codes.read";

export type MotiveCredentials = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

export function motiveAuthorizeUrl(input: {
  clientId: string;
  redirectUri: string;
  state: string;
  scopes?: string;
}): string {
  const params = new URLSearchParams({
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    response_type: "code",
    state: input.state,
  });

  const scopes = input.scopes ?? MOTIVE_SCOPES;
  if (scopes) {
    params.set("scope", scopes);
  }

  return `${MOTIVE_AUTHORIZE_URL}?${params.toString()}`;
}

/** Build the token-endpoint request for exchanging an auth code or refreshing. */
export function motiveTokenRequest(
  input:
    | { grant: "authorization_code"; code: string; credentials: MotiveCredentials }
    | { grant: "refresh_token"; refreshToken: string; credentials: MotiveCredentials },
): { url: string; body: URLSearchParams } {
  const body = new URLSearchParams({
    client_id: input.credentials.clientId,
    client_secret: input.credentials.clientSecret,
    grant_type: input.grant,
  });

  if (input.grant === "authorization_code") {
    body.set("code", input.code);
    body.set("redirect_uri", input.credentials.redirectUri);
  } else {
    body.set("refresh_token", input.refreshToken);
  }

  return { url: MOTIVE_TOKEN_URL, body };
}

export type MotiveTokenResponse = {
  accessToken: string;
  refreshToken: string | null;
  expiresInSeconds: number | null;
};

export function parseMotiveTokenResponse(raw: unknown): MotiveTokenResponse | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const record = raw as Record<string, unknown>;
  const accessToken = typeof record.access_token === "string" ? record.access_token : null;

  if (!accessToken) {
    return null;
  }

  return {
    accessToken,
    refreshToken: typeof record.refresh_token === "string" ? record.refresh_token : null,
    expiresInSeconds: typeof record.expires_in === "number" ? record.expires_in : null,
  };
}

// Map Motive duty-status codes to our model. Motive uses both long and short
// forms across endpoints; accept the common variants.
const MOTIVE_DUTY_STATUS: Record<string, DutyStatus> = {
  off_duty: "off_duty",
  off: "off_duty",
  sleeper: "sleeper_berth",
  sleeper_berth: "sleeper_berth",
  sb: "sleeper_berth",
  driving: "driving",
  d: "driving",
  on_duty: "on_duty",
  on_duty_not_driving: "on_duty",
  on: "on_duty",
};

export function mapMotiveDutyStatus(value: string | null | undefined): DutyStatus | null {
  if (!value) {
    return null;
  }

  return MOTIVE_DUTY_STATUS[value.trim().toLowerCase()] ?? null;
}

// Intermediate shape extracted from a Motive HOS-logs response. Kept separate
// from the deep response walk so the mapping is easy to verify and adjust.
export type MotiveDutyRecord = {
  driverId: string | number | null | undefined;
  status: string | null | undefined;
  startTime: string | null | undefined;
  location?: string | null;
};

export function normalizeMotiveDutyRecords(records: MotiveDutyRecord[]): NormalizedDutyEvent[] {
  const events: NormalizedDutyEvent[] = [];

  for (const record of records) {
    const status = mapMotiveDutyStatus(record.status);
    const externalDriverId = record.driverId == null ? "" : String(record.driverId);
    const startedAtMs = record.startTime ? Date.parse(record.startTime) : Number.NaN;

    if (!status || !externalDriverId || Number.isNaN(startedAtMs)) {
      continue;
    }

    events.push({
      externalDriverId,
      status,
      startedAt: new Date(startedAtMs).toISOString(),
      location: record.location ?? null,
    });
  }

  return events;
}

/**
 * Pull duty-status records out of a Motive HOS-logs API response.
 *
 * NOTE: validate the exact nesting against the first real Motive response when
 * credentials are live. Motive paginates `hos_logs`, each carrying a driver and
 * the day's duty-status events. This walk is defensive about field names that
 * vary across Motive endpoints (driver id, status, start time).
 */
export function extractMotiveDutyRecords(raw: unknown): MotiveDutyRecord[] {
  if (!raw || typeof raw !== "object") {
    return [];
  }

  const root = raw as Record<string, unknown>;
  const logs = Array.isArray(root.hos_logs) ? root.hos_logs : Array.isArray(root.logs) ? root.logs : [];
  const records: MotiveDutyRecord[] = [];

  for (const entry of logs) {
    const log = (entry && typeof entry === "object" ? (entry as Record<string, unknown>) : {}) as Record<string, unknown>;
    const wrapped = (log.hos_log && typeof log.hos_log === "object" ? (log.hos_log as Record<string, unknown>) : log) as Record<string, unknown>;

    const driver = wrapped.driver && typeof wrapped.driver === "object" ? (wrapped.driver as Record<string, unknown>) : null;
    const driverId = driver?.id ?? wrapped.driver_id;

    const eventList = Array.isArray(wrapped.duty_status_logs)
      ? wrapped.duty_status_logs
      : Array.isArray(wrapped.events)
        ? wrapped.events
        : [];

    for (const eventEntry of eventList) {
      const event = (eventEntry && typeof eventEntry === "object" ? (eventEntry as Record<string, unknown>) : {}) as Record<string, unknown>;
      records.push({
        driverId: (driverId as string | number | undefined) ?? null,
        status: (event.duty_status ?? event.type ?? event.status) as string | undefined,
        startTime: (event.start_time ?? event.time ?? event.logged_at) as string | undefined,
        location: (event.location as string | undefined) ?? null,
      });
    }
  }

  return records;
}

export function normalizeMotiveDrivers(raw: unknown): EldDriverSummary[] {
  if (!raw || typeof raw !== "object") {
    return [];
  }

  const root = raw as Record<string, unknown>;
  const list = Array.isArray(root.users) ? root.users : Array.isArray(root.drivers) ? root.drivers : [];
  const drivers: EldDriverSummary[] = [];

  for (const entry of list) {
    const wrapper = (entry && typeof entry === "object" ? (entry as Record<string, unknown>) : {}) as Record<string, unknown>;
    const user = (wrapper.user && typeof wrapper.user === "object" ? (wrapper.user as Record<string, unknown>) : wrapper) as Record<string, unknown>;
    const id = user.id;

    if (id == null) {
      continue;
    }

    const first = typeof user.first_name === "string" ? user.first_name : "";
    const last = typeof user.last_name === "string" ? user.last_name : "";
    const fullName = `${first} ${last}`.trim() || (typeof user.name === "string" ? user.name : "") || `Driver ${String(id)}`;

    drivers.push({ externalId: String(id), fullName });
  }

  return drivers;
}

/**
 * Read the same Motive users response for contact, role, status, and manager
 * details (the Driver Details + Drivers and Fleet Managers scopes). NOTE: validate
 * field names against the first real response; manager linkage may be absent.
 */
export function normalizeMotiveDriverDetails(raw: unknown): EldDriverDetail[] {
  if (!raw || typeof raw !== "object") {
    return [];
  }

  const root = raw as Record<string, unknown>;
  const list = Array.isArray(root.users) ? root.users : Array.isArray(root.drivers) ? root.drivers : [];
  const details: EldDriverDetail[] = [];

  const str = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.trim() : null);

  for (const entry of list) {
    const wrapper = (entry && typeof entry === "object" ? (entry as Record<string, unknown>) : {}) as Record<string, unknown>;
    const user = (wrapper.user && typeof wrapper.user === "object" ? (wrapper.user as Record<string, unknown>) : wrapper) as Record<string, unknown>;
    const id = user.id;

    if (id == null) {
      continue;
    }

    const manager = user.manager && typeof user.manager === "object" ? (user.manager as Record<string, unknown>) : null;

    details.push({
      externalDriverId: String(id),
      email: str(user.email),
      phone: str(user.phone) ?? str(user.phone_number),
      role: str(user.role),
      status: str(user.status) ?? (user.is_active === false ? "deactivated" : user.is_active === true ? "active" : null),
      managerName: str(manager?.name) ?? str(user.manager_name),
      managerEmail: str(manager?.email) ?? str(user.manager_email),
    });
  }

  return details;
}

/**
 * Map a Motive vehicles API response (`/v1/vehicles`) to normalized summaries.
 *
 * NOTE: validate the exact field names against the first real Motive response.
 * Motive nests each item under `vehicle` and exposes `number` (unit), `vin`,
 * `license_plate_number`, `make`, `model`, `year`. The walk is defensive about the
 * common variants so reconciliation can match by VIN, plate, or unit number.
 */
export function normalizeMotiveVehicles(raw: unknown): EldVehicleSummary[] {
  if (!raw || typeof raw !== "object") {
    return [];
  }

  const root = raw as Record<string, unknown>;
  const list = Array.isArray(root.vehicles) ? root.vehicles : Array.isArray(root.data) ? root.data : [];
  const vehicles: EldVehicleSummary[] = [];

  const str = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.trim() : null);
  const num = (value: unknown): number | null => {
    if (typeof value === "number") {
      return Number.isFinite(value) ? value : null;
    }
    if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
      return Number(value);
    }
    return null;
  };

  for (const entry of list) {
    const wrapper = (entry && typeof entry === "object" ? (entry as Record<string, unknown>) : {}) as Record<string, unknown>;
    const vehicle = (wrapper.vehicle && typeof wrapper.vehicle === "object" ? (wrapper.vehicle as Record<string, unknown>) : wrapper) as Record<string, unknown>;
    const id = vehicle.id;

    if (id == null) {
      continue;
    }

    vehicles.push({
      externalId: String(id),
      vin: str(vehicle.vin),
      plate: str(vehicle.license_plate_number) ?? str(vehicle.license_plate) ?? str(vehicle.plate),
      unitNumber: str(vehicle.number) ?? str(vehicle.name) ?? str(vehicle.unit),
      make: str(vehicle.make),
      model: str(vehicle.model),
      year: num(vehicle.year),
    });
  }

  return vehicles;
}

/**
 * Map a Motive trips API response (`/v1/trips`) to odometer readings per vehicle.
 *
 * NOTE: validate against the first real Motive response. Trips nest under `trip`
 * and carry the vehicle, an end odometer, and an end time. Odometer units follow
 * the Motive account setting (km or miles), so confirm the unit matches the unit
 * tracking_mode before relying on it. The walk is defensive about field names.
 */
export function normalizeMotiveTrips(raw: unknown): EldTripReading[] {
  if (!raw || typeof raw !== "object") {
    return [];
  }

  const root = raw as Record<string, unknown>;
  const list = Array.isArray(root.trips) ? root.trips : Array.isArray(root.data) ? root.data : [];
  const readings: EldTripReading[] = [];

  const num = (value: unknown): number | null => {
    if (typeof value === "number") {
      return Number.isFinite(value) ? value : null;
    }
    if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
      return Number(value);
    }
    return null;
  };
  const iso = (value: unknown): string | null => {
    if (typeof value !== "string" || !value.trim()) {
      return null;
    }
    const ms = Date.parse(value);
    return Number.isNaN(ms) ? null : new Date(ms).toISOString();
  };

  for (const entry of list) {
    const wrapper = (entry && typeof entry === "object" ? (entry as Record<string, unknown>) : {}) as Record<string, unknown>;
    const trip = (wrapper.trip && typeof wrapper.trip === "object" ? (wrapper.trip as Record<string, unknown>) : wrapper) as Record<string, unknown>;

    const vehicle = trip.vehicle && typeof trip.vehicle === "object" ? (trip.vehicle as Record<string, unknown>) : null;
    const vehicleId = vehicle?.id ?? trip.vehicle_id;

    if (vehicleId == null) {
      continue;
    }

    readings.push({
      externalVehicleId: String(vehicleId),
      odometer: num(trip.end_odometer) ?? num(trip.odometer) ?? num(trip.start_odometer),
      recordedAt: iso(trip.end_time) ?? iso(trip.ended_at) ?? iso(trip.end_at),
    });
  }

  return readings;
}

// Shared helpers for the telematics normalizers below.
function motiveString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function motiveIso(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

function motiveRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function motiveItems(raw: unknown, ...keys: string[]): Record<string, unknown>[] {
  const root = motiveRecord(raw);
  for (const key of keys) {
    if (Array.isArray(root[key])) {
      return (root[key] as unknown[]).map(motiveRecord);
    }
  }
  return Array.isArray(root.data) ? (root.data as unknown[]).map(motiveRecord) : [];
}

function motiveVehicleId(record: Record<string, unknown>): string | null {
  const vehicle = motiveRecord(record.vehicle);
  const id = vehicle.id ?? record.vehicle_id ?? record.vehicle_external_id;
  return id == null ? null : String(id);
}

function motiveDriverId(record: Record<string, unknown>): string | null {
  const driver = motiveRecord(record.driver);
  const id = driver.id ?? record.driver_id ?? record.user_id;
  return id == null ? null : String(id);
}

function motiveNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

function motiveDateOnly(value: unknown): string | null {
  const iso = motiveIso(value);
  return iso ? iso.slice(0, 10) : null;
}

/**
 * Map a Motive ELD-devices response to per-vehicle device summaries (current
 * state). NOTE: validate field names against the first real Motive response;
 * the walk is defensive about identifier/model/firmware/status nesting.
 */
export function normalizeMotiveEldDevices(raw: unknown): EldDeviceSummary[] {
  const devices: EldDeviceSummary[] = [];

  for (const entry of motiveItems(raw, "eld_devices", "devices", "elds")) {
    const device = motiveRecord(entry.eld_device ?? entry.device ?? entry);
    const externalVehicleId = motiveVehicleId(device);

    if (!externalVehicleId) {
      continue;
    }

    devices.push({
      externalVehicleId,
      identifier: motiveString(device.identifier) ?? motiveString(device.serial_number) ?? motiveString(device.esn),
      model: motiveString(device.model),
      firmware: motiveString(device.firmware_version) ?? motiveString(device.firmware),
      status: motiveString(device.status) ?? motiveString(device.connection_status),
      lastSeenAt: motiveIso(device.last_connected_at) ?? motiveIso(device.last_seen_at),
    });
  }

  return devices;
}

/**
 * Map a Motive ELD-disconnects response to normalized vehicle events. NOTE:
 * validate field names against the first real Motive response.
 */
export function normalizeMotiveEldDisconnects(raw: unknown): NormalizedVehicleEvent[] {
  const events: NormalizedVehicleEvent[] = [];

  for (const entry of motiveItems(raw, "eld_disconnects", "disconnects", "events")) {
    const item = motiveRecord(entry.eld_disconnect ?? entry.disconnect ?? entry);
    const externalVehicleId = motiveVehicleId(item);
    const occurredAt = motiveIso(item.start_time) ?? motiveIso(item.occurred_at) ?? motiveIso(item.disconnected_at);

    if (!externalVehicleId || !occurredAt) {
      continue;
    }

    events.push({
      externalVehicleId,
      eventType: "disconnect",
      occurredAt,
      externalEventId: item.id == null ? null : String(item.id),
      description: motiveString(item.reason) ?? motiveString(item.description),
    });
  }

  return events;
}

/**
 * Map a Motive fault-codes response to normalized vehicle events. NOTE: requires
 * the Fault Codes scope enabled on the Motive app; validate field names against
 * the first real response.
 */
export function normalizeMotiveFaultCodes(raw: unknown): NormalizedVehicleEvent[] {
  const events: NormalizedVehicleEvent[] = [];

  for (const entry of motiveItems(raw, "fault_codes", "faults", "events")) {
    const item = motiveRecord(entry.fault_code ?? entry.fault ?? entry);
    const externalVehicleId = motiveVehicleId(item);
    const occurredAt = motiveIso(item.occurred_at) ?? motiveIso(item.detected_at) ?? motiveIso(item.start_time);

    if (!externalVehicleId || !occurredAt) {
      continue;
    }

    const spn = item.spn == null ? null : String(item.spn);
    const fmi = item.fmi == null ? null : String(item.fmi);
    const code =
      motiveString(item.code) ?? (spn || fmi ? [spn ? `SPN ${spn}` : null, fmi ? `FMI ${fmi}` : null].filter(Boolean).join(" ") : null);

    events.push({
      externalVehicleId,
      eventType: "fault_code",
      occurredAt,
      externalEventId: item.id == null ? null : String(item.id),
      code,
      description: motiveString(item.description) ?? motiveString(item.message),
      severity: motiveString(item.severity),
    });
  }

  return events;
}

/**
 * Map a Motive speeding-events response to driver safety events. NOTE: validate
 * field names against the first real response.
 */
export function normalizeMotiveSpeedingEvents(raw: unknown): NormalizedDriverEvent[] {
  const events: NormalizedDriverEvent[] = [];

  for (const entry of motiveItems(raw, "speeding_events", "speedings", "events")) {
    const item = motiveRecord(entry.speeding_event ?? entry.event ?? entry);
    const externalDriverId = motiveDriverId(item);
    const occurredAt = motiveIso(item.start_time) ?? motiveIso(item.occurred_at) ?? motiveIso(item.time);

    if (!externalDriverId || !occurredAt) {
      continue;
    }

    events.push({
      externalDriverId,
      externalVehicleId: motiveVehicleId(item),
      eventType: "speeding",
      occurredAt,
      externalEventId: item.id == null ? null : String(item.id),
      value: motiveNumber(item.max_speed) ?? motiveNumber(item.speed),
      severity: motiveString(item.severity),
      location: motiveString(item.location),
    });
  }

  return events;
}

/**
 * Map a Motive collision/incident response to driver safety events. NOTE: validate
 * field names against the first real response; collisions may also warrant a full
 * record in the Incidents module (future).
 */
export function normalizeMotiveCollisions(raw: unknown): NormalizedDriverEvent[] {
  const events: NormalizedDriverEvent[] = [];

  for (const entry of motiveItems(raw, "collisions", "collision_reports", "events")) {
    const item = motiveRecord(entry.collision ?? entry.collision_report ?? entry);
    const externalDriverId = motiveDriverId(item);
    const occurredAt = motiveIso(item.occurred_at) ?? motiveIso(item.time) ?? motiveIso(item.start_time);

    if (!externalDriverId || !occurredAt) {
      continue;
    }

    events.push({
      externalDriverId,
      externalVehicleId: motiveVehicleId(item),
      eventType: "collision",
      occurredAt,
      externalEventId: item.id == null ? null : String(item.id),
      severity: motiveString(item.severity),
      description: motiveString(item.description) ?? motiveString(item.summary),
      location: motiveString(item.location),
    });
  }

  return events;
}

/**
 * Map a Motive driver-performance / scorecard response to per-driver snapshots.
 * NOTE: validate field names against the first real response.
 */
export function normalizeMotiveDriverPerformance(raw: unknown): EldDriverPerformance[] {
  const performances: EldDriverPerformance[] = [];

  for (const entry of motiveItems(raw, "driver_performance", "scorecards", "performance")) {
    const item = motiveRecord(entry.driver_performance ?? entry.scorecard ?? entry.performance ?? entry);
    const externalDriverId = motiveDriverId(item);

    if (!externalDriverId) {
      continue;
    }

    performances.push({
      externalDriverId,
      periodStart: motiveDateOnly(item.start_date) ?? motiveDateOnly(item.period_start),
      periodEnd: motiveDateOnly(item.end_date) ?? motiveDateOnly(item.period_end),
      score: motiveNumber(item.score) ?? motiveNumber(item.safety_score),
      totalEvents: motiveNumber(item.total_events),
      speedingCount: motiveNumber(item.speeding_count) ?? motiveNumber(item.speeding_events_count),
      harshBrakeCount: motiveNumber(item.hard_brake_count) ?? motiveNumber(item.harsh_brake_count),
      harshAccelCount: motiveNumber(item.hard_accel_count) ?? motiveNumber(item.harsh_accel_count),
      distance: motiveNumber(item.distance) ?? motiveNumber(item.total_distance),
      driveTimeMinutes: motiveNumber(item.drive_time_minutes) ?? motiveNumber(item.driving_minutes),
    });
  }

  return performances;
}
