// ELD sync: turn a provider's normalized duty-status events into rows on the
// driver files.
//
// Every connector returns the same NormalizedDutyEvent shape regardless of the
// underlying ELD brand, so this mapping is provider-agnostic and pure. Events
// are matched to our drivers through eld_driver_link (provider driver id -> our
// driver); events for an unmatched provider driver are skipped and counted so
// the UI can prompt the operator to map them.

import { driverTargetColumns, vehicleTargetColumns, type EldTarget } from "@/lib/eld/targets";
import type { DutyStatus } from "@/lib/hos-rules";
import type { Database, EldProvider, Json } from "@/types/database";

export type NormalizedDutyEvent = {
  externalDriverId: string;
  status: DutyStatus;
  startedAt: string; // ISO 8601
  location?: string | null;
};

export type EldDriverSummary = {
  externalId: string;
  fullName: string;
};

export type EldVehicleSummary = {
  externalId: string;
  vin: string | null;
  plate: string | null;
  unitNumber: string | null;
  make: string | null;
  model: string | null;
  year: number | null;
};

export type EquipmentMatchRow = {
  id: string;
  unit_number: string;
  vin_or_serial: string | null;
  license_plate: string | null;
};

export type EldTripReading = {
  externalVehicleId: string;
  odometer: number | null;
  recordedAt: string | null; // ISO 8601, when the odometer was read
};

export type EquipmentMeterInfo = {
  id: string;
  currentMeter: number | null;
  trackingMode: string;
};

type MeterLogInsert = Database["public"]["Tables"]["equipment_meter_log"]["Insert"];

/** Stable key for de-duplicating an ELD odometer reading for one unit. */
export function eldMeterKey(equipmentId: string, value: number): string {
  return `${equipmentId}|${value}`;
}

/**
 * Turn provider trips into meter-log inserts that advance each linked unit's
 * odometer. Trips are reduced to the highest odometer per unit; a reading is only
 * emitted when it moves the meter forward (greater than the current reading), the
 * unit tracks by mileage (trips measure distance, not engine hours), and we have
 * not already logged that exact ELD reading. Pure, so it is unit-tested.
 */
export function buildEldMeterReadings(input: {
  tenantId: string;
  trips: EldTripReading[];
  equipmentIdByExternalVehicleId: Map<string, EldTarget>;
  equipmentInfoById: Map<string, EquipmentMeterInfo>;
  existingKeys?: Set<string>;
}): { inserts: MeterLogInsert[]; updated: number; skippedUnlinked: number } {
  const bestByEquipment = new Map<string, { value: number; recordedAt: string | null }>();
  let skippedUnlinked = 0;

  for (const trip of input.trips) {
    const target = input.equipmentIdByExternalVehicleId.get(trip.externalVehicleId);

    // Own-fleet units only. equipment_meter_log belongs to a unit this company services,
    // and a contracted unit has no meter history, scheduled service or maintenance log
    // here, so a reading for one is counted as unlinked rather than given a home it does
    // not have. See the closing note in 20260826020000.
    if (!target || target.kind !== "own") {
      skippedUnlinked += 1;
      continue;
    }

    const equipmentId = target.id;

    if (typeof trip.odometer !== "number" || !Number.isFinite(trip.odometer)) {
      continue;
    }

    const best = bestByEquipment.get(equipmentId);
    if (!best || trip.odometer > best.value) {
      bestByEquipment.set(equipmentId, { value: trip.odometer, recordedAt: trip.recordedAt });
    }
  }

  const existing = input.existingKeys ?? new Set<string>();
  const inserts: MeterLogInsert[] = [];

  for (const [equipmentId, best] of bestByEquipment) {
    const info = input.equipmentInfoById.get(equipmentId);

    if (!info || info.trackingMode !== "mileage") {
      continue;
    }

    const current = info.currentMeter ?? 0;
    if (best.value <= current || existing.has(eldMeterKey(equipmentId, best.value))) {
      continue;
    }

    const row: MeterLogInsert = {
      tenant_id: input.tenantId,
      equipment_id: equipmentId,
      value: best.value,
      source: "eld",
    };
    if (best.recordedAt) {
      row.recorded_at = best.recordedAt;
    }
    inserts.push(row);
  }

  return { inserts, updated: inserts.length, skippedUnlinked };
}

export type EldDeviceSummary = {
  externalVehicleId: string;
  identifier: string | null;
  model: string | null;
  firmware: string | null;
  status: string | null;
  lastSeenAt: string | null;
};

export type EldDriverDetail = {
  externalDriverId: string;
  email: string | null;
  phone: string | null;
  role: string | null;
  status: string | null;
  managerName: string | null;
  managerEmail: string | null;
};

type EldDriverProfileInsert = Database["public"]["Tables"]["eld_driver_profile"]["Insert"];

/** Resolve provider driver details to profile upsert rows for linked drivers only. */
export function buildEldDriverProfileUpserts(input: {
  tenantId: string;
  provider: EldProvider;
  details: EldDriverDetail[];
  driverIdByExternalId: Map<string, EldTarget>;
  reportedAt?: string | null;
}): EldDriverProfileInsert[] {
  const rows: EldDriverProfileInsert[] = [];

  for (const detail of input.details) {
    const target = input.driverIdByExternalId.get(detail.externalDriverId);

    if (!target) {
      continue;
    }

    rows.push({
      tenant_id: input.tenantId,
      provider: input.provider,
      external_driver_id: detail.externalDriverId,
      ...driverTargetColumns(target),
      email: detail.email,
      phone: detail.phone,
      role: detail.role,
      status: detail.status,
      manager_name: detail.managerName,
      manager_email: detail.managerEmail,
      reported_at: input.reportedAt ?? null,
    });
  }

  return rows;
}

export type EldDriverEventType = "speeding" | "harsh_brake" | "harsh_accel" | "collision" | "other";

export type NormalizedDriverEvent = {
  externalDriverId: string;
  eventType: EldDriverEventType;
  occurredAt: string;
  externalVehicleId?: string | null;
  externalEventId?: string | null;
  severity?: string | null;
  value?: number | null;
  label?: string | null;
  description?: string | null;
  location?: string | null;
  payload?: Json;
};

export type EldDriverPerformance = {
  externalDriverId: string;
  periodStart?: string | null;
  periodEnd?: string | null;
  score?: number | null;
  totalEvents?: number | null;
  speedingCount?: number | null;
  harshBrakeCount?: number | null;
  harshAccelCount?: number | null;
  distance?: number | null;
  driveTimeMinutes?: number | null;
  payload?: Json;
};

type EldDriverEventInsert = Database["public"]["Tables"]["eld_driver_event"]["Insert"];
type EldDriverPerformanceInsert = Database["public"]["Tables"]["eld_driver_performance"]["Insert"];

/** Stable key for de-duplicating a driver event. */
export function eldDriverEventKey(
  driverId: string,
  eventType: EldDriverEventType,
  occurredAt: string,
  externalEventId: string | null,
  value: number | null,
): string {
  return `${driverId}|${eventType}|${new Date(occurredAt).toISOString()}|${externalEventId ?? (value == null ? "" : String(value))}`;
}

/**
 * Map normalized driver safety events (speeding, harsh events, collisions) to
 * insert rows, resolving the driver (required) and optionally the vehicle, and
 * dropping events whose driver is not linked or that already exist / repeat.
 * Pure, so it is unit-tested.
 */
export function buildEldDriverEventInserts(input: {
  tenantId: string;
  provider: EldProvider;
  events: NormalizedDriverEvent[];
  driverIdByExternalId: Map<string, EldTarget>;
  equipmentIdByExternalVehicleId?: Map<string, EldTarget>;
  existingKeys?: Set<string>;
}): { inserts: EldDriverEventInsert[]; skippedUnlinked: number } {
  const existing = input.existingKeys ?? new Set<string>();
  const vehicleLinks = input.equipmentIdByExternalVehicleId ?? new Map<string, EldTarget>();
  const seen = new Set<string>();
  const inserts: EldDriverEventInsert[] = [];
  let skippedUnlinked = 0;

  for (const event of input.events) {
    const target = input.driverIdByExternalId.get(event.externalDriverId);

    if (!target) {
      skippedUnlinked += 1;
      continue;
    }

    // Own and contracted ids are both uuids from different tables, so they can never
    // collide; the id alone is a safe de-duplication key.
    const driverId = target.id;

    const occurredMs = Date.parse(event.occurredAt);
    if (Number.isNaN(occurredMs)) {
      continue;
    }
    const occurredIso = new Date(occurredMs).toISOString();
    const key = eldDriverEventKey(driverId, event.eventType, occurredIso, event.externalEventId ?? null, event.value ?? null);

    if (existing.has(key) || seen.has(key)) {
      continue;
    }
    seen.add(key);

    inserts.push({
      tenant_id: input.tenantId,
      provider: input.provider,
      ...driverTargetColumns(target),
      ...vehicleTargetColumns(event.externalVehicleId ? vehicleLinks.get(event.externalVehicleId) : null),
      event_type: event.eventType,
      external_event_id: event.externalEventId ?? null,
      occurred_at: occurredIso,
      severity: event.severity ?? null,
      value: event.value ?? null,
      label: event.label ?? null,
      description: event.description ?? null,
      location: event.location ?? null,
      payload: event.payload ?? {},
    });
  }

  return { inserts, skippedUnlinked };
}

/** Resolve provider performance scorecards to upsert rows for linked drivers. */
export function buildEldDriverPerformanceUpserts(input: {
  tenantId: string;
  provider: EldProvider;
  performances: EldDriverPerformance[];
  driverIdByExternalId: Map<string, EldTarget>;
  reportedAt?: string | null;
}): EldDriverPerformanceInsert[] {
  const rows: EldDriverPerformanceInsert[] = [];

  for (const performance of input.performances) {
    const target = input.driverIdByExternalId.get(performance.externalDriverId);

    if (!target) {
      continue;
    }

    rows.push({
      tenant_id: input.tenantId,
      provider: input.provider,
      external_driver_id: performance.externalDriverId,
      ...driverTargetColumns(target),
      period_start: performance.periodStart ?? null,
      period_end: performance.periodEnd ?? null,
      score: performance.score ?? null,
      total_events: performance.totalEvents ?? null,
      speeding_count: performance.speedingCount ?? null,
      harsh_brake_count: performance.harshBrakeCount ?? null,
      harsh_accel_count: performance.harshAccelCount ?? null,
      distance: performance.distance ?? null,
      drive_time_minutes: performance.driveTimeMinutes ?? null,
      reported_at: input.reportedAt ?? null,
      payload: performance.payload ?? {},
    });
  }

  return rows;
}

export type EldVehicleEventType = "disconnect" | "fault_code";

export type NormalizedVehicleEvent = {
  externalVehicleId: string;
  eventType: EldVehicleEventType;
  occurredAt: string;
  externalEventId?: string | null;
  code?: string | null;
  label?: string | null;
  description?: string | null;
  severity?: string | null;
  payload?: Json;
};

type EldDeviceInsert = Database["public"]["Tables"]["eld_device"]["Insert"];
type EldVehicleEventInsert = Database["public"]["Tables"]["eld_vehicle_event"]["Insert"];

/** Resolve provider device summaries to upsert rows for linked vehicles only. */
export function buildEldDeviceUpserts(input: {
  tenantId: string;
  provider: EldProvider;
  devices: EldDeviceSummary[];
  equipmentIdByExternalVehicleId: Map<string, EldTarget>;
}): EldDeviceInsert[] {
  const rows: EldDeviceInsert[] = [];

  for (const device of input.devices) {
    const target = input.equipmentIdByExternalVehicleId.get(device.externalVehicleId);

    if (!target) {
      continue;
    }

    rows.push({
      tenant_id: input.tenantId,
      provider: input.provider,
      external_vehicle_id: device.externalVehicleId,
      ...vehicleTargetColumns(target),
      identifier: device.identifier,
      model: device.model,
      firmware: device.firmware,
      status: device.status,
      last_seen_at: device.lastSeenAt,
    });
  }

  return rows;
}

/** Stable key for de-duplicating a vehicle event. */
export function eldVehicleEventKey(
  equipmentId: string,
  eventType: EldVehicleEventType,
  occurredAt: string,
  code: string | null,
  externalEventId: string | null,
): string {
  return `${equipmentId}|${eventType}|${new Date(occurredAt).toISOString()}|${code ?? ""}|${externalEventId ?? ""}`;
}

/**
 * Map normalized vehicle events (disconnects, fault codes) to insert rows for
 * linked vehicles, dropping events whose vehicle is not linked or that already
 * exist (by existingKeys) or repeat within the batch. Pure, so it is unit-tested.
 */
export function buildEldVehicleEventInserts(input: {
  tenantId: string;
  provider: EldProvider;
  events: NormalizedVehicleEvent[];
  equipmentIdByExternalVehicleId: Map<string, EldTarget>;
  existingKeys?: Set<string>;
}): { inserts: EldVehicleEventInsert[]; skippedUnlinked: number } {
  const existing = input.existingKeys ?? new Set<string>();
  const seen = new Set<string>();
  const inserts: EldVehicleEventInsert[] = [];
  let skippedUnlinked = 0;

  for (const event of input.events) {
    const target = input.equipmentIdByExternalVehicleId.get(event.externalVehicleId);

    if (!target) {
      skippedUnlinked += 1;
      continue;
    }

    const equipmentId = target.id;

    const occurredMs = Date.parse(event.occurredAt);
    if (Number.isNaN(occurredMs)) {
      continue;
    }
    const occurredIso = new Date(occurredMs).toISOString();
    const key = eldVehicleEventKey(equipmentId, event.eventType, occurredIso, event.code ?? null, event.externalEventId ?? null);

    if (existing.has(key) || seen.has(key)) {
      continue;
    }
    seen.add(key);

    inserts.push({
      tenant_id: input.tenantId,
      provider: input.provider,
      ...vehicleTargetColumns(target),
      event_type: event.eventType,
      external_event_id: event.externalEventId ?? null,
      code: event.code ?? null,
      label: event.label ?? null,
      description: event.description ?? null,
      severity: event.severity ?? null,
      occurred_at: occurredIso,
      payload: event.payload ?? {},
    });
  }

  return { inserts, skippedUnlinked };
}

function normalizeKey(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function uniqueMatch(ids: string[] | undefined): string | null {
  return ids && ids.length === 1 ? ids[0] : null;
}

/**
 * Match a provider's vehicles to our equipment by VIN, then licence plate, then
 * unit number. Only a single, unambiguous candidate is linked (a key shared by two
 * units is skipped), and no equipment is linked to two provider vehicles in one
 * pass. Already-linked provider vehicles are skipped. Pure, so it is unit-tested.
 */
export function buildVehicleLinkMatches(input: {
  vehicles: EldVehicleSummary[];
  equipment: EquipmentMatchRow[];
  alreadyLinkedExternalIds?: Set<string>;
}): { externalVehicleId: string; equipmentId: string }[] {
  const byVin = new Map<string, string[]>();
  const byPlate = new Map<string, string[]>();
  const byUnit = new Map<string, string[]>();

  const push = (map: Map<string, string[]>, key: string, id: string) => {
    if (!key) {
      return;
    }
    map.set(key, [...(map.get(key) ?? []), id]);
  };

  for (const unit of input.equipment) {
    push(byVin, normalizeKey(unit.vin_or_serial), unit.id);
    push(byPlate, normalizeKey(unit.license_plate), unit.id);
    push(byUnit, normalizeKey(unit.unit_number), unit.id);
  }

  const already = input.alreadyLinkedExternalIds ?? new Set<string>();
  const usedEquipment = new Set<string>();
  const matches: { externalVehicleId: string; equipmentId: string }[] = [];

  for (const vehicle of input.vehicles) {
    if (already.has(vehicle.externalId)) {
      continue;
    }

    const equipmentId =
      uniqueMatch(byVin.get(normalizeKey(vehicle.vin))) ??
      uniqueMatch(byPlate.get(normalizeKey(vehicle.plate))) ??
      uniqueMatch(byUnit.get(normalizeKey(vehicle.unitNumber)));

    if (equipmentId && !usedEquipment.has(equipmentId)) {
      usedEquipment.add(equipmentId);
      matches.push({ externalVehicleId: vehicle.externalId, equipmentId });
    }
  }

  return matches;
}

/** Each provider module implements this against its own API. */
export interface EldConnector {
  readonly provider: EldProvider;
  listDrivers(): Promise<EldDriverSummary[]>;
  fetchDutyEvents(input: { since: Date }): Promise<NormalizedDutyEvent[]>;
}

type DutyStatusInsert = Database["public"]["Tables"]["transport_duty_status_event"]["Insert"];

/** Stable key for de-duplicating duty-status events for one driver. */
export function dutyEventKey(driverId: string, startedAt: string, status: DutyStatus): string {
  return `${driverId}|${new Date(startedAt).toISOString()}|${status}`;
}

/**
 * Map normalized provider events to duty-status insert rows, resolving the
 * provider driver id to our driver via the link map and dropping events whose
 * driver is not yet linked or that already exist (by existingKeys).
 */
export function buildDutyEventInserts(input: {
  tenantId: string;
  events: NormalizedDutyEvent[];
  driverIdByExternalId: Map<string, EldTarget>;
  existingKeys?: Set<string>;
}): { inserts: DutyStatusInsert[]; matched: number; skippedUnmatched: number; skippedDuplicate: number } {
  const existing = input.existingKeys ?? new Set<string>();
  const seen = new Set<string>();
  const inserts: DutyStatusInsert[] = [];
  let skippedUnmatched = 0;
  let skippedDuplicate = 0;

  for (const event of input.events) {
    const target = input.driverIdByExternalId.get(event.externalDriverId);

    if (!target) {
      skippedUnmatched += 1;
      continue;
    }

    const driverId = target.id;
    const key = dutyEventKey(driverId, event.startedAt, event.status);

    if (existing.has(key) || seen.has(key)) {
      skippedDuplicate += 1;
      continue;
    }
    seen.add(key);

    inserts.push({
      tenant_id: input.tenantId,
      ...driverTargetColumns(target),
      status: event.status,
      started_at: new Date(event.startedAt).toISOString(),
      source: "eld",
      location: event.location ?? null,
    });
  }

  return { inserts, matched: inserts.length, skippedUnmatched, skippedDuplicate };
}
