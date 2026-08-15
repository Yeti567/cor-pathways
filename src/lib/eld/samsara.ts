// Samsara connector.
//
// Pure building blocks for the Samsara REST API and the transforms that map its
// responses into the framework's normalized shapes. Server orchestration (HTTP,
// paging, DB writes) lives in samsara-sync.ts; everything here is pure and
// unit-tested so the mapping is verifiable without live credentials.
//
// AUTH DIFFERS FROM MOTIVE, ON PURPOSE. Motive is an OAuth app, so its client id
// and secret are app-level env vars shared by every tenant. Samsara authenticates
// with an API token generated inside the customer's own Samsara dashboard
// (developers.samsara.com/docs/authentication), and OAuth is reserved for listed
// Samsara Marketplace apps. Every client runs their own deployment and their own
// Samsara organization, so the token is per-connection data, not deployment
// config: it is stored in eld_connection_secret.api_key and never in an env var
// or in git. That also means Samsara needs no app registration to go live for a
// new client, which is what makes this repeatable.

import type { DutyStatus } from "@/lib/hos-rules";
import type {
  EldDriverDetail,
  EldDriverSummary,
  EldTripReading,
  EldVehicleSummary,
  NormalizedDriverEvent,
  NormalizedDutyEvent,
} from "@/lib/eld/sync";

// Samsara serves the EU from a separate host; Canadian and US orgs use the
// default. Overridable so an EU client is a config change, not a code change.
export const SAMSARA_API_BASE = process.env.SAMSARA_API_BASE?.trim() || "https://api.samsara.com";

// Max page size Samsara accepts is 512.
export const SAMSARA_PAGE_LIMIT = 512;

export function samsaraAuthHeaders(apiToken: string): Record<string, string> {
  return { authorization: `Bearer ${apiToken}`, accept: "application/json" };
}

/** Build a paged Samsara URL, carrying the cursor when continuing a page walk. */
export function samsaraUrl(input: {
  path: string;
  query?: Record<string, string | undefined>;
  cursor?: string | null;
  base?: string;
}): string {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(input.query ?? {})) {
    if (value != null && value !== "") {
      params.set(key, value);
    }
  }

  params.set("limit", String(SAMSARA_PAGE_LIMIT));

  if (input.cursor) {
    params.set("after", input.cursor);
  }

  const base = input.base ?? SAMSARA_API_BASE;
  return `${base}${input.path}?${params.toString()}`;
}

/**
 * Cursor for the next page, or null when the walk is done. Samsara returns
 * `pagination: { endCursor, hasNextPage }`; a page may be sparse while later
 * pages still hold data, so paging is driven by hasNextPage, never by whether
 * the current page was empty.
 */
export function samsaraNextCursor(raw: unknown): string | null {
  const pagination = record(record(raw).pagination);

  if (pagination.hasNextPage !== true) {
    return null;
  }

  const cursor = pagination.endCursor;
  return typeof cursor === "string" && cursor.trim() ? cursor : null;
}

// ---------------------------------------------------------------------------
// shared helpers
// ---------------------------------------------------------------------------

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function items(raw: unknown): Record<string, unknown>[] {
  const data = record(raw).data;
  return Array.isArray(data) ? data.map(record) : [];
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function num(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

function iso(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

function id(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

// ---------------------------------------------------------------------------
// duty status / HOS
// ---------------------------------------------------------------------------

// Samsara's six hosStatusType values, mapped onto our four-state model.
//
// The two that need a judgement call:
//   yardMove           -> on_duty  (moving in a yard is on-duty not driving)
//   personalConveyance -> off_duty (PC is authorized personal use, off-duty)
// Both match how the status is treated for hours-of-service accumulation.
const SAMSARA_DUTY_STATUS: Record<string, DutyStatus> = {
  offduty: "off_duty",
  sleeperbed: "sleeper_berth",
  sleeperberth: "sleeper_berth",
  sleeper: "sleeper_berth",
  driving: "driving",
  onduty: "on_duty",
  yardmove: "on_duty",
  personalconveyance: "off_duty",
};

export function mapSamsaraDutyStatus(value: string | null | undefined): DutyStatus | null {
  if (!value) {
    return null;
  }

  return SAMSARA_DUTY_STATUS[value.trim().toLowerCase().replace(/[\s_-]/g, "")] ?? null;
}

/**
 * Pull duty records out of a GET /fleet/hos/logs response.
 *
 * Shape: data[] is one HosLogsForDriver per driver, carrying `driver: {id, name}`
 * and that driver's logs. The log array key is accepted as `logs` or `hosLogs`
 * so a naming difference between API versions cannot silently drop every event.
 */
export type SamsaraDutyRecord = {
  driverId: string | null;
  status: string | null;
  startTime: string | null;
  location?: string | null;
};

export function extractSamsaraDutyRecords(raw: unknown): SamsaraDutyRecord[] {
  const records: SamsaraDutyRecord[] = [];

  for (const entry of items(raw)) {
    const driver = record(entry.driver);
    const driverId = id(driver.id) ?? id(entry.driverId);

    const logs = Array.isArray(entry.logs)
      ? entry.logs
      : Array.isArray(entry.hosLogs)
        ? entry.hosLogs
        : [];

    for (const logEntry of logs) {
      const log = record(logEntry);
      const location = record(log.logRecordedLocation);
      const lat = num(location.latitude);
      const lon = num(location.longitude);

      records.push({
        driverId,
        status: str(log.hosStatusType),
        startTime: str(log.logStartTime),
        location:
          str(location.formattedLocation) ??
          (lat != null && lon != null ? `${lat.toFixed(5)}, ${lon.toFixed(5)}` : null),
      });
    }
  }

  return records;
}

export function normalizeSamsaraDutyRecords(records: SamsaraDutyRecord[]): NormalizedDutyEvent[] {
  const events: NormalizedDutyEvent[] = [];

  for (const item of records) {
    const status = mapSamsaraDutyStatus(item.status);
    const startedAt = iso(item.startTime);

    if (!status || !item.driverId || !startedAt) {
      continue;
    }

    events.push({
      externalDriverId: item.driverId,
      status,
      startedAt,
      location: item.location ?? null,
    });
  }

  return events;
}

// ---------------------------------------------------------------------------
// drivers
// ---------------------------------------------------------------------------

/** Map GET /fleet/drivers to normalized driver summaries. */
export function normalizeSamsaraDrivers(raw: unknown): EldDriverSummary[] {
  const drivers: EldDriverSummary[] = [];

  for (const entry of items(raw)) {
    const externalId = id(entry.id);

    if (!externalId) {
      continue;
    }

    drivers.push({
      externalId,
      fullName: str(entry.name) ?? str(entry.username) ?? `Driver ${externalId}`,
    });
  }

  return drivers;
}

/**
 * Read the same drivers response for contact and status detail.
 *
 * Samsara has no manager relationship on a driver, so managerName/managerEmail
 * stay null rather than being invented. driverActivationStatus is "active" or
 * "deactivated".
 */
export function normalizeSamsaraDriverDetails(raw: unknown): EldDriverDetail[] {
  const details: EldDriverDetail[] = [];

  for (const entry of items(raw)) {
    const externalDriverId = id(entry.id);

    if (!externalDriverId) {
      continue;
    }

    details.push({
      externalDriverId,
      email: str(entry.email),
      phone: str(entry.phone),
      role: null,
      status: str(entry.driverActivationStatus),
      managerName: null,
      managerEmail: null,
    });
  }

  return details;
}

// ---------------------------------------------------------------------------
// vehicles
// ---------------------------------------------------------------------------

/**
 * Map GET /fleet/vehicles to normalized summaries. `name` is Samsara's unit
 * label, which is what fleets put their unit number in, so it feeds the
 * unit-number match alongside VIN and plate.
 */
export function normalizeSamsaraVehicles(raw: unknown): EldVehicleSummary[] {
  const vehicles: EldVehicleSummary[] = [];

  for (const entry of items(raw)) {
    const externalId = id(entry.id);

    if (!externalId) {
      continue;
    }

    vehicles.push({
      externalId,
      vin: str(entry.vin),
      plate: str(entry.licensePlate),
      unitNumber: str(entry.name),
      make: str(entry.make),
      model: str(entry.model),
      year: num(entry.year),
    });
  }

  return vehicles;
}

// ---------------------------------------------------------------------------
// odometer
// ---------------------------------------------------------------------------

/** Metres to kilometres, rounded to whole km to match how meters are entered. */
export function metresToKm(metres: number): number {
  return Math.round(metres / 1000);
}

/**
 * Map GET /fleet/vehicles/stats?types=obdOdometerMeters,gpsOdometerMeters to
 * odometer readings.
 *
 * UNITS MATTER HERE. Samsara reports odometer in METRES; equipment meters in the
 * app are kilometres, so every reading is converted. Sending the raw value would
 * read as ~1000x the real distance and would instantly mark every unit overdue
 * for service. OBD is preferred over GPS because it is the truck's own reading;
 * GPS is the fallback for units with no engine connection.
 */
export function normalizeSamsaraVehicleStats(raw: unknown): EldTripReading[] {
  const readings: EldTripReading[] = [];

  for (const entry of items(raw)) {
    const externalVehicleId = id(entry.id);

    if (!externalVehicleId) {
      continue;
    }

    const obd = record(entry.obdOdometerMeters);
    const gps = record(entry.gpsOdometerMeters);
    const metres = num(obd.value) ?? num(gps.value);

    if (metres == null) {
      continue;
    }

    readings.push({
      externalVehicleId,
      odometer: metresToKm(metres),
      recordedAt: iso(obd.time) ?? iso(gps.time),
    });
  }

  return readings;
}

// ---------------------------------------------------------------------------
// safety events
// ---------------------------------------------------------------------------

const SAMSARA_BEHAVIOUR: { match: RegExp; type: NormalizedDriverEvent["eventType"] }[] = [
  { match: /speed/i, type: "speeding" },
  { match: /brak/i, type: "harsh_brake" },
  { match: /accel/i, type: "harsh_accel" },
  { match: /crash|collision/i, type: "collision" },
];

export function mapSamsaraBehaviour(label: string | null | undefined): NormalizedDriverEvent["eventType"] {
  if (!label) {
    return "other";
  }

  return SAMSARA_BEHAVIOUR.find((entry) => entry.match.test(label))?.type ?? "other";
}

/**
 * Map GET /fleet/safety-events to normalized driver events.
 *
 * A Samsara safety event can carry several behaviourLabels (a hard brake and a
 * crash on one event); each becomes its own row so the driver file shows what
 * actually happened. The event id is suffixed per behaviour to keep the
 * de-duplication key unique.
 */
export function normalizeSamsaraSafetyEvents(raw: unknown): NormalizedDriverEvent[] {
  const events: NormalizedDriverEvent[] = [];

  for (const entry of items(raw)) {
    const driver = record(entry.driver);
    const externalDriverId = id(driver.id) ?? id(entry.driverId);
    const occurredAt = iso(entry.time) ?? iso(entry.eventTime);

    if (!externalDriverId || !occurredAt) {
      continue;
    }

    const vehicle = record(entry.vehicle);
    const externalVehicleId = id(vehicle.id) ?? id(entry.vehicleId);
    const eventId = id(entry.id);

    const labels = Array.isArray(entry.behaviorLabels)
      ? entry.behaviorLabels.map((label) => str(record(label).label) ?? str(record(label).name)).filter(Boolean)
      : [];

    const fallback = str(entry.harshAccelerationType);
    const behaviours = labels.length > 0 ? labels : [fallback];

    for (const behaviour of behaviours) {
      // A "notDetected" harsh-acceleration type means Samsara logged the event
      // without classifying it; keep it as `other` rather than dropping it.
      const eventType = mapSamsaraBehaviour(behaviour);

      events.push({
        externalDriverId,
        externalVehicleId,
        eventType,
        occurredAt,
        externalEventId: eventId ? (behaviour ? `${eventId}:${eventType}` : eventId) : null,
        value: num(entry.maxSpeedKilometersPerHour) ?? num(entry.speedKilometersPerHour),
        severity: null,
        description: behaviour ?? null,
        location: str(record(entry.location).formattedLocation) ?? str(entry.location),
      });
    }
  }

  return events;
}
