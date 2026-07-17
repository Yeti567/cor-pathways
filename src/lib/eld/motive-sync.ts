// Motive server orchestration: token exchange/refresh and the fleet sync.
//
// Uses the service-role client so it can read the deny-all secret table and
// write duty-status events. The pure transforms it relies on (URL/token builders
// and response normalizers) are unit-tested in motive.ts; this module is the thin
// IO layer that ties them to Motive's API and the database.

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
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
  eldDriverEventKey,
  eldMeterKey,
  eldVehicleEventKey,
  type EldVehicleSummary,
  type EquipmentMatchRow,
  type EquipmentMeterInfo,
  type NormalizedDriverEvent,
  type NormalizedDutyEvent,
  type NormalizedVehicleEvent,
} from "@/lib/eld/sync";
import {
  MOTIVE_API_BASE,
  extractMotiveDutyRecords,
  motiveTokenRequest,
  normalizeMotiveCollisions,
  normalizeMotiveDriverDetails,
  normalizeMotiveDriverPerformance,
  normalizeMotiveDrivers,
  normalizeMotiveDutyRecords,
  normalizeMotiveEldDevices,
  normalizeMotiveEldDisconnects,
  normalizeMotiveFaultCodes,
  normalizeMotiveSpeedingEvents,
  normalizeMotiveTrips,
  normalizeMotiveVehicles,
  parseMotiveTokenResponse,
  type MotiveCredentials,
  type MotiveTokenResponse,
} from "@/lib/eld/motive";
import type { Database } from "@/types/database";

const MOTIVE_DRIVERS_PATH = process.env.MOTIVE_DRIVERS_PATH?.trim() || "/v1/users";
const MOTIVE_HOS_PATH = process.env.MOTIVE_HOS_PATH?.trim() || "/v1/hos_logs";
const MOTIVE_VEHICLES_PATH = process.env.MOTIVE_VEHICLES_PATH?.trim() || "/v1/vehicles";
const MOTIVE_TRIPS_PATH = process.env.MOTIVE_TRIPS_PATH?.trim() || "/v1/trips";
const MOTIVE_ELDS_PATH = process.env.MOTIVE_ELDS_PATH?.trim() || "/v1/eld_devices";
const MOTIVE_ELD_DISCONNECTS_PATH = process.env.MOTIVE_ELD_DISCONNECTS_PATH?.trim() || "/v1/eld_disconnects";
const MOTIVE_FAULT_CODES_PATH = process.env.MOTIVE_FAULT_CODES_PATH?.trim() || "/v1/fault_codes";
const MOTIVE_SPEEDING_PATH = process.env.MOTIVE_SPEEDING_PATH?.trim() || "/v1/speeding_events";
const MOTIVE_COLLISIONS_PATH = process.env.MOTIVE_COLLISIONS_PATH?.trim() || "/v1/collisions";
const MOTIVE_PERFORMANCE_PATH = process.env.MOTIVE_PERFORMANCE_PATH?.trim() || "/v1/driver_performance";
const SYNC_WINDOW_DAYS = 15;

type AdminClient = NonNullable<ReturnType<typeof createSupabaseAdminClient>>;
type SyncResult =
  | {
      ok: true;
      created: number;
      matchedDrivers: number;
      matchedVehicles: number;
      metersUpdated: number;
      devices: number;
      vehicleEvents: number;
      driverProfiles: number;
      safetyEvents: number;
      performanceRecords: number;
      skippedUnmatched: number;
    }
  | { ok: false; error: string };

export function getMotiveCredentials(): MotiveCredentials | null {
  const clientId = process.env.MOTIVE_CLIENT_ID?.trim();
  const clientSecret = process.env.MOTIVE_CLIENT_SECRET?.trim();

  if (!clientId || !clientSecret) {
    return null;
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim() ?? "";
  const redirectUri = process.env.MOTIVE_REDIRECT_URI?.trim() || `${appUrl}/api/eld/motive/callback`;

  return { clientId, clientSecret, redirectUri };
}

async function requestMotiveToken(
  request: { grant: "authorization_code"; code: string } | { grant: "refresh_token"; refreshToken: string },
  credentials: MotiveCredentials,
  fetchImpl: typeof fetch,
): Promise<{ ok: true; tokens: MotiveTokenResponse } | { ok: false; error: string }> {
  const { url, body } =
    request.grant === "authorization_code"
      ? motiveTokenRequest({ grant: "authorization_code", code: request.code, credentials })
      : motiveTokenRequest({ grant: "refresh_token", refreshToken: request.refreshToken, credentials });

  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    const json = (await response.json().catch(() => null)) as unknown;

    if (!response.ok) {
      return { ok: false, error: `Motive token request failed (HTTP ${response.status}).` };
    }

    const tokens = parseMotiveTokenResponse(json);
    return tokens ? { ok: true, tokens } : { ok: false, error: "Motive token response had no access token." };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Motive token request error." };
  }
}

export async function exchangeMotiveCode(
  code: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: true; tokens: MotiveTokenResponse } | { ok: false; error: string }> {
  const credentials = getMotiveCredentials();

  if (!credentials) {
    return { ok: false, error: "Motive credentials are not configured." };
  }

  return requestMotiveToken({ grant: "authorization_code", code }, credentials, fetchImpl);
}

function expiresAtIso(now: Date, expiresInSeconds: number | null): string | null {
  if (expiresInSeconds == null) {
    return null;
  }

  return new Date(now.getTime() + expiresInSeconds * 1000).toISOString();
}

/** Persist a connection's tokens to the deny-all secret table (service role). */
export async function storeMotiveTokens(input: {
  admin: AdminClient;
  connectionId: string;
  tenantId: string;
  tokens: MotiveTokenResponse;
  now: Date;
}) {
  await input.admin.from("eld_connection_secret").upsert(
    {
      connection_id: input.connectionId,
      tenant_id: input.tenantId,
      access_token: input.tokens.accessToken,
      refresh_token: input.tokens.refreshToken,
      token_expires_at: expiresAtIso(input.now, input.tokens.expiresInSeconds),
    },
    { onConflict: "connection_id" },
  );
}

async function motiveGet(path: string, accessToken: string, fetchImpl: typeof fetch): Promise<unknown> {
  const response = await fetchImpl(`${MOTIVE_API_BASE}${path}`, {
    headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(`Motive API ${path} failed (HTTP ${response.status}).`);
  }

  return response.json();
}

/**
 * Best-effort GET for optional enrichment endpoints: returns null instead of
 * throwing, so a scope the customer has not granted (e.g. fault codes) never fails
 * the core driver/HOS/trip sync.
 */
async function motiveGetSafe(path: string, accessToken: string, fetchImpl: typeof fetch): Promise<unknown> {
  try {
    return await motiveGet(path, accessToken, fetchImpl);
  } catch {
    return null;
  }
}

/**
 * Sync one tenant's Motive connection: refresh the token if needed, match the
 * fleet's drivers to our driver records, and pull recent duty-status events onto
 * those driver files. Connection status and last error are updated either way.
 */
export async function syncMotiveConnection(
  tenantId: string,
  now: Date = new Date(),
  fetchImpl: typeof fetch = fetch,
): Promise<SyncResult> {
  const admin = createSupabaseAdminClient();

  if (!admin) {
    return { ok: false, error: "Service role key is not configured." };
  }

  const credentials = getMotiveCredentials();

  if (!credentials) {
    return { ok: false, error: "Motive credentials are not configured." };
  }

  const { data: connection } = await admin
    .from("eld_connection")
    .select("id, status")
    .eq("tenant_id", tenantId)
    .eq("provider", "motive")
    .maybeSingle<{ id: string; status: string }>();

  if (!connection) {
    return { ok: false, error: "No Motive connection for this tenant." };
  }

  const fail = async (error: string): Promise<SyncResult> => {
    await admin.from("eld_connection").update({ status: "error", last_error: error }).eq("id", connection.id);
    return { ok: false, error };
  };

  const { data: secret } = await admin
    .from("eld_connection_secret")
    .select("access_token, refresh_token, token_expires_at")
    .eq("connection_id", connection.id)
    .maybeSingle<{ access_token: string | null; refresh_token: string | null; token_expires_at: string | null }>();

  if (!secret?.access_token) {
    return fail("Motive is not authorized yet. Connect the account first.");
  }

  // Refresh the access token if it is expired (or expiring within a minute).
  let accessToken = secret.access_token;
  const expiresAt = secret.token_expires_at ? Date.parse(secret.token_expires_at) : Number.NaN;
  if (secret.refresh_token && Number.isFinite(expiresAt) && expiresAt - now.getTime() < 60_000) {
    const refreshed = await requestMotiveToken({ grant: "refresh_token", refreshToken: secret.refresh_token }, credentials, fetchImpl);
    if (!refreshed.ok) {
      return fail(refreshed.error);
    }
    await storeMotiveTokens({ admin, connectionId: connection.id, tenantId, tokens: refreshed.tokens, now });
    accessToken = refreshed.tokens.accessToken;
  }

  let driverIdByExternalId: Map<string, string>;
  let matchedVehicles = 0;
  let metersUpdated = 0;
  let devices = 0;
  let vehicleEvents = 0;
  let driverProfiles = 0;
  let safetyEvents = 0;
  let performanceRecords = 0;
  let dutyEvents: NormalizedDutyEvent[];

  try {
    // Match the fleet's drivers to our records by name, creating links.
    const driversRaw = await motiveGet(`${MOTIVE_DRIVERS_PATH}?per_page=100`, accessToken, fetchImpl);
    const motiveDrivers = normalizeMotiveDrivers(driversRaw);
    driverIdByExternalId = await reconcileDriverLinks({ admin, tenantId, motiveDrivers });

    // Enrich linked drivers with contact, role, status, and manager from the same
    // users response (no extra request). HOS clocks/violations are computed on the
    // driver file from duty events, so they are not duplicated here.
    const profileUpserts = buildEldDriverProfileUpserts({
      tenantId,
      provider: "motive",
      details: normalizeMotiveDriverDetails(driversRaw),
      driverIdByExternalId,
      reportedAt: now.toISOString(),
    });
    if (profileUpserts.length > 0) {
      await admin.from("eld_driver_profile").upsert(profileUpserts, { onConflict: "tenant_id,provider,driver_id" });
    }
    driverProfiles = profileUpserts.length;

    // Match the fleet's vehicles to our equipment by VIN/plate/unit, creating links.
    const vehiclesRaw = await motiveGet(`${MOTIVE_VEHICLES_PATH}?per_page=100`, accessToken, fetchImpl);
    const motiveVehicles = normalizeMotiveVehicles(vehiclesRaw);
    const equipmentIdByExternalVehicleId = await reconcileVehicleLinks({ admin, tenantId, motiveVehicles });
    matchedVehicles = equipmentIdByExternalVehicleId.size;

    // Advance the linked units' odometers from their trips.
    metersUpdated = await syncTripOdometers({ admin, tenantId, equipmentIdByExternalVehicleId, accessToken, fetchImpl });

    // Best-effort device state + disconnect/fault-code events on the truck files.
    const telematics = await syncVehicleTelematics({ admin, tenantId, equipmentIdByExternalVehicleId, accessToken, fetchImpl });
    devices = telematics.devices;
    vehicleEvents = telematics.vehicleEvents;

    // Best-effort driver safety: speeding, collisions, and the performance scorecard.
    const safety = await syncDriverSafety({
      admin,
      tenantId,
      driverIdByExternalId,
      equipmentIdByExternalVehicleId,
      accessToken,
      fetchImpl,
      now,
    });
    safetyEvents = safety.safetyEvents;
    performanceRecords = safety.performanceRecords;

    const windowStart = new Date(now.getTime() - SYNC_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const start = windowStart.toISOString().slice(0, 10);
    const end = now.toISOString().slice(0, 10);
    const hosRaw = await motiveGet(`${MOTIVE_HOS_PATH}?start_date=${start}&end_date=${end}&per_page=100`, accessToken, fetchImpl);
    dutyEvents = normalizeMotiveDutyRecords(extractMotiveDutyRecords(hosRaw));
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Motive sync failed.");
  }

  // Skip events we already have for these drivers in the window.
  const linkedDriverIds = Array.from(new Set(driverIdByExternalId.values()));
  const existingKeys = new Set<string>();
  if (linkedDriverIds.length > 0) {
    const windowStartIso = new Date(now.getTime() - SYNC_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const { data: existing } = await admin
      .from("transport_duty_status_event")
      .select("driver_id, status, started_at")
      .eq("tenant_id", tenantId)
      .in("driver_id", linkedDriverIds)
      .gte("started_at", windowStartIso)
      .returns<{ driver_id: string; status: NormalizedDutyEvent["status"]; started_at: string }[]>();

    for (const row of existing ?? []) {
      existingKeys.add(dutyEventKey(row.driver_id, row.started_at, row.status));
    }
  }

  const { inserts, matched, skippedUnmatched } = buildDutyEventInserts({
    tenantId,
    events: dutyEvents,
    driverIdByExternalId,
    existingKeys,
  });

  if (inserts.length > 0) {
    const { error: insertError } = await admin.from("transport_duty_status_event").insert(inserts);
    if (insertError) {
      return fail(insertError.message);
    }
  }

  await admin
    .from("eld_connection")
    .update({ status: "connected", last_error: null, last_synced_at: now.toISOString() })
    .eq("id", connection.id);

  return {
    ok: true,
    created: matched,
    matchedDrivers: driverIdByExternalId.size,
    matchedVehicles,
    metersUpdated,
    devices,
    vehicleEvents,
    driverProfiles,
    safetyEvents,
    performanceRecords,
    skippedUnmatched,
  };
}

type DbDriver = Pick<Database["public"]["Tables"]["transport_driver"]["Row"], "id" | "full_name">;

/**
 * Ensure every Motive driver we can match by name has an eld_driver_link, and
 * return the external-id -> our-driver-id map for all current links.
 */
async function reconcileDriverLinks(input: {
  admin: AdminClient;
  tenantId: string;
  motiveDrivers: { externalId: string; fullName: string }[];
}): Promise<Map<string, string>> {
  const { admin, tenantId, motiveDrivers } = input;

  const { data: links } = await admin
    .from("eld_driver_link")
    .select("external_driver_id, driver_id")
    .eq("tenant_id", tenantId)
    .eq("provider", "motive")
    .returns<{ external_driver_id: string; driver_id: string }[]>();

  const map = new Map<string, string>((links ?? []).map((link) => [link.external_driver_id, link.driver_id]));

  const unlinked = motiveDrivers.filter((driver) => !map.has(driver.externalId));
  if (unlinked.length === 0) {
    return map;
  }

  const { data: drivers } = await admin
    .from("transport_driver")
    .select("id, full_name")
    .eq("tenant_id", tenantId)
    .is("deleted_at", null)
    .returns<DbDriver[]>();

  const driverIdByName = new Map<string, string>((drivers ?? []).map((driver) => [driver.full_name.trim().toLowerCase(), driver.id]));
  const newLinks: Database["public"]["Tables"]["eld_driver_link"]["Insert"][] = [];

  for (const motiveDriver of unlinked) {
    const driverId = driverIdByName.get(motiveDriver.fullName.trim().toLowerCase());
    if (driverId) {
      map.set(motiveDriver.externalId, driverId);
      newLinks.push({
        tenant_id: tenantId,
        provider: "motive",
        external_driver_id: motiveDriver.externalId,
        driver_id: driverId,
      });
    }
  }

  if (newLinks.length > 0) {
    await admin.from("eld_driver_link").upsert(newLinks, { onConflict: "tenant_id,provider,external_driver_id" });
  }

  return map;
}

/**
 * Ensure every Motive vehicle we can match (by VIN, plate, or unit number) has an
 * eld_vehicle_link to our equipment, and return the external-vehicle-id -> our
 * equipment-id map for all current links.
 */
async function reconcileVehicleLinks(input: {
  admin: AdminClient;
  tenantId: string;
  motiveVehicles: EldVehicleSummary[];
}): Promise<Map<string, string>> {
  const { admin, tenantId, motiveVehicles } = input;

  const { data: links } = await admin
    .from("eld_vehicle_link")
    .select("external_vehicle_id, equipment_id")
    .eq("tenant_id", tenantId)
    .eq("provider", "motive")
    .returns<{ external_vehicle_id: string; equipment_id: string }[]>();

  const map = new Map<string, string>((links ?? []).map((link) => [link.external_vehicle_id, link.equipment_id]));
  const unlinked = motiveVehicles.filter((vehicle) => !map.has(vehicle.externalId));

  if (unlinked.length === 0) {
    return map;
  }

  const { data: equipment } = await admin
    .from("equipment")
    .select("id, unit_number, vin_or_serial, license_plate")
    .eq("tenant_id", tenantId)
    .is("deleted_at", null)
    .returns<EquipmentMatchRow[]>();

  const matches = buildVehicleLinkMatches({
    vehicles: motiveVehicles,
    equipment: equipment ?? [],
    alreadyLinkedExternalIds: new Set(map.keys()),
  });

  if (matches.length > 0) {
    const newLinks: Database["public"]["Tables"]["eld_vehicle_link"]["Insert"][] = matches.map((match) => ({
      tenant_id: tenantId,
      provider: "motive",
      external_vehicle_id: match.externalVehicleId,
      equipment_id: match.equipmentId,
    }));
    await admin.from("eld_vehicle_link").upsert(newLinks, { onConflict: "tenant_id,provider,external_vehicle_id" });
    for (const match of matches) {
      map.set(match.externalVehicleId, match.equipmentId);
    }
  }

  return map;
}

/**
 * Advance each linked unit's odometer from its Motive trips. Reads the highest trip
 * odometer per unit and logs it as an `eld` meter reading when it moves the meter
 * forward, which the meter trigger rolls into equipment.current_meter. Idempotent:
 * already-logged ELD readings are skipped. Returns the number of units advanced.
 */
async function syncTripOdometers(input: {
  admin: AdminClient;
  tenantId: string;
  equipmentIdByExternalVehicleId: Map<string, string>;
  accessToken: string;
  fetchImpl: typeof fetch;
}): Promise<number> {
  const { admin, tenantId, equipmentIdByExternalVehicleId, accessToken, fetchImpl } = input;
  const equipmentIds = Array.from(new Set(equipmentIdByExternalVehicleId.values()));

  if (equipmentIds.length === 0) {
    return 0;
  }

  const tripsRaw = await motiveGet(`${MOTIVE_TRIPS_PATH}?per_page=100`, accessToken, fetchImpl);
  const trips = normalizeMotiveTrips(tripsRaw);

  const { data: equipmentRows } = await admin
    .from("equipment")
    .select("id, current_meter, tracking_mode")
    .eq("tenant_id", tenantId)
    .in("id", equipmentIds)
    .returns<{ id: string; current_meter: number | null; tracking_mode: string }[]>();

  const equipmentInfoById = new Map<string, EquipmentMeterInfo>(
    (equipmentRows ?? []).map((row) => [row.id, { id: row.id, currentMeter: row.current_meter, trackingMode: row.tracking_mode }]),
  );

  const { data: existingEld } = await admin
    .from("equipment_meter_log")
    .select("equipment_id, value")
    .eq("tenant_id", tenantId)
    .eq("source", "eld")
    .in("equipment_id", equipmentIds)
    .returns<{ equipment_id: string; value: number }[]>();

  const existingKeys = new Set<string>((existingEld ?? []).map((row) => eldMeterKey(row.equipment_id, row.value)));

  const { inserts } = buildEldMeterReadings({
    tenantId,
    trips,
    equipmentIdByExternalVehicleId,
    equipmentInfoById,
    existingKeys,
  });

  if (inserts.length > 0) {
    await admin.from("equipment_meter_log").insert(inserts);
  }

  return inserts.length;
}

/**
 * Best-effort telematics enrichment for linked vehicles: the ELD device state
 * (upserted), plus disconnect and fault-code events (deduped). Each fetch is
 * isolated so a missing scope returns nothing rather than failing the sync.
 */
async function syncVehicleTelematics(input: {
  admin: AdminClient;
  tenantId: string;
  equipmentIdByExternalVehicleId: Map<string, string>;
  accessToken: string;
  fetchImpl: typeof fetch;
}): Promise<{ devices: number; vehicleEvents: number }> {
  const { admin, tenantId, equipmentIdByExternalVehicleId, accessToken, fetchImpl } = input;
  const equipmentIds = Array.from(new Set(equipmentIdByExternalVehicleId.values()));

  if (equipmentIds.length === 0) {
    return { devices: 0, vehicleEvents: 0 };
  }

  // ELD device state (upsert one row per linked vehicle).
  const devicesRaw = await motiveGetSafe(`${MOTIVE_ELDS_PATH}?per_page=100`, accessToken, fetchImpl);
  const deviceUpserts = buildEldDeviceUpserts({
    tenantId,
    provider: "motive",
    devices: normalizeMotiveEldDevices(devicesRaw),
    equipmentIdByExternalVehicleId,
  });
  if (deviceUpserts.length > 0) {
    await admin.from("eld_device").upsert(deviceUpserts, { onConflict: "tenant_id,provider,external_vehicle_id" });
  }

  // Disconnect + fault-code events (deduped against what we already have).
  const [disconnectsRaw, faultsRaw] = await Promise.all([
    motiveGetSafe(`${MOTIVE_ELD_DISCONNECTS_PATH}?per_page=100`, accessToken, fetchImpl),
    motiveGetSafe(`${MOTIVE_FAULT_CODES_PATH}?per_page=100`, accessToken, fetchImpl),
  ]);
  const events: NormalizedVehicleEvent[] = [
    ...normalizeMotiveEldDisconnects(disconnectsRaw),
    ...normalizeMotiveFaultCodes(faultsRaw),
  ];

  const { data: existing } = await admin
    .from("eld_vehicle_event")
    .select("equipment_id, event_type, occurred_at, code, external_event_id")
    .eq("tenant_id", tenantId)
    .in("equipment_id", equipmentIds)
    .returns<
      { equipment_id: string; event_type: "disconnect" | "fault_code"; occurred_at: string; code: string | null; external_event_id: string | null }[]
    >();

  const existingKeys = new Set<string>(
    (existing ?? []).map((row) => eldVehicleEventKey(row.equipment_id, row.event_type, row.occurred_at, row.code, row.external_event_id)),
  );

  const { inserts } = buildEldVehicleEventInserts({
    tenantId,
    provider: "motive",
    events,
    equipmentIdByExternalVehicleId,
    existingKeys,
  });
  if (inserts.length > 0) {
    await admin.from("eld_vehicle_event").insert(inserts);
  }

  return { devices: deviceUpserts.length, vehicleEvents: inserts.length };
}

/**
 * Best-effort driver safety enrichment for linked drivers: speeding and collision
 * events (deduped) plus the performance scorecard (upserted). Each fetch is
 * isolated so a missing scope returns nothing rather than failing the sync.
 */
async function syncDriverSafety(input: {
  admin: AdminClient;
  tenantId: string;
  driverIdByExternalId: Map<string, string>;
  equipmentIdByExternalVehicleId: Map<string, string>;
  accessToken: string;
  fetchImpl: typeof fetch;
  now: Date;
}): Promise<{ safetyEvents: number; performanceRecords: number }> {
  const { admin, tenantId, driverIdByExternalId, equipmentIdByExternalVehicleId, accessToken, fetchImpl, now } = input;
  const driverIds = Array.from(new Set(driverIdByExternalId.values()));

  if (driverIds.length === 0) {
    return { safetyEvents: 0, performanceRecords: 0 };
  }

  const [speedingRaw, collisionsRaw, performanceRaw] = await Promise.all([
    motiveGetSafe(`${MOTIVE_SPEEDING_PATH}?per_page=100`, accessToken, fetchImpl),
    motiveGetSafe(`${MOTIVE_COLLISIONS_PATH}?per_page=100`, accessToken, fetchImpl),
    motiveGetSafe(`${MOTIVE_PERFORMANCE_PATH}?per_page=100`, accessToken, fetchImpl),
  ]);

  const events: NormalizedDriverEvent[] = [
    ...normalizeMotiveSpeedingEvents(speedingRaw),
    ...normalizeMotiveCollisions(collisionsRaw),
  ];

  const { data: existing } = await admin
    .from("eld_driver_event")
    .select("driver_id, event_type, occurred_at, external_event_id, value")
    .eq("tenant_id", tenantId)
    .in("driver_id", driverIds)
    .returns<
      { driver_id: string; event_type: NormalizedDriverEvent["eventType"]; occurred_at: string; external_event_id: string | null; value: number | null }[]
    >();

  const existingKeys = new Set<string>(
    (existing ?? []).map((row) => eldDriverEventKey(row.driver_id, row.event_type, row.occurred_at, row.external_event_id, row.value)),
  );

  const { inserts } = buildEldDriverEventInserts({
    tenantId,
    provider: "motive",
    events,
    driverIdByExternalId,
    equipmentIdByExternalVehicleId,
    existingKeys,
  });
  if (inserts.length > 0) {
    await admin.from("eld_driver_event").insert(inserts);
  }

  const performanceUpserts = buildEldDriverPerformanceUpserts({
    tenantId,
    provider: "motive",
    performances: normalizeMotiveDriverPerformance(performanceRaw),
    driverIdByExternalId,
    reportedAt: now.toISOString(),
  });
  if (performanceUpserts.length > 0) {
    await admin.from("eld_driver_performance").upsert(performanceUpserts, { onConflict: "tenant_id,provider,driver_id" });
  }

  return { safetyEvents: inserts.length, performanceRecords: performanceUpserts.length };
}
