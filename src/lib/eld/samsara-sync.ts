// Samsara server orchestration: token check and the fleet sync.
//
// Uses the service-role client so it can read the deny-all secret table and
// write duty-status events. The pure transforms it relies on (URL building,
// cursor paging, response normalizers) are unit-tested in samsara.ts; this
// module is the thin IO layer that ties them to Samsara's API and the database.
//
// Unlike Motive there is no OAuth dance and no token refresh: the customer
// pastes an API token generated in their own Samsara dashboard, and it stays
// valid until they revoke it. See the auth note at the top of samsara.ts.

import { reconcileEldDriverLinks, reconcileEldVehicleLinks } from "@/lib/eld/links";
import {
  buildSamsaraImportPlan,
  type ExistingDriverRow,
  type SamsaraImportPlan,
} from "@/lib/eld/samsara-import";
import {
  SAMSARA_API_BASE,
  extractSamsaraDutyRecords,
  normalizeSamsaraDrivers,
  normalizeSamsaraDriverDetails,
  normalizeSamsaraDutyRecords,
  normalizeSamsaraSafetyEvents,
  normalizeSamsaraVehicleStats,
  normalizeSamsaraVehicles,
  samsaraAuthHeaders,
  samsaraNextCursor,
  samsaraUrl,
} from "@/lib/eld/samsara";
import {
  buildDutyEventInserts,
  buildEldDriverEventInserts,
  buildEldDriverProfileUpserts,
  buildEldMeterReadings,
  dutyEventKey,
  eldDriverEventKey,
  eldMeterKey,
  type EldDriverEventType,
  type EquipmentMatchRow,
  type EquipmentMeterInfo,
  type NormalizedDutyEvent,
} from "@/lib/eld/sync";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const SAMSARA_DRIVERS_PATH = process.env.SAMSARA_DRIVERS_PATH?.trim() || "/fleet/drivers";
const SAMSARA_VEHICLES_PATH = process.env.SAMSARA_VEHICLES_PATH?.trim() || "/fleet/vehicles";
const SAMSARA_VEHICLE_STATS_PATH = process.env.SAMSARA_VEHICLE_STATS_PATH?.trim() || "/fleet/vehicles/stats";
const SAMSARA_HOS_PATH = process.env.SAMSARA_HOS_PATH?.trim() || "/fleet/hos/logs";
const SAMSARA_SAFETY_EVENTS_PATH = process.env.SAMSARA_SAFETY_EVENTS_PATH?.trim() || "/fleet/safety-events";

// How far back each sync reaches for duty events and safety events. Matches the
// Motive window so the two providers behave the same on the driver file.
const SYNC_WINDOW_DAYS = 15;

// Hard stop on page walking, so a bad cursor or an enormous fleet can never spin
// the cron forever. 40 pages x 512 rows is far beyond any real Canadian fleet.
const MAX_PAGES = 40;

type AdminClient = NonNullable<ReturnType<typeof createSupabaseAdminClient>>;

type SamsaraSyncResult =
  | {
      ok: true;
      created: number;
      matchedDrivers: number;
      matchedVehicles: number;
      metersUpdated: number;
      driverProfiles: number;
      safetyEvents: number;
      skippedUnmatched: number;
    }
  | { ok: false; error: string };

/** Resolve a tenant's Samsara connection and token in one step. */
async function resolveSamsaraAccess(
  admin: AdminClient,
  tenantId: string,
): Promise<{ ok: true; connectionId: string; apiToken: string } | { ok: false; error: string }> {
  const { data: connection } = await admin
    .from("eld_connection")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("provider", "samsara")
    .maybeSingle<{ id: string }>();

  if (!connection) {
    return { ok: false, error: "No Samsara connection for this tenant." };
  }

  const apiToken = await getSamsaraToken(admin, connection.id);

  if (!apiToken) {
    return { ok: false, error: "Samsara is not authorized yet. Add the API token first." };
  }

  return { ok: true, connectionId: connection.id, apiToken };
}

/** Read one tenant's stored Samsara API token from the deny-all secret table. */
export async function getSamsaraToken(admin: AdminClient, connectionId: string): Promise<string | null> {
  const { data } = await admin
    .from("eld_connection_secret")
    .select("api_key")
    .eq("connection_id", connectionId)
    .maybeSingle<{ api_key: string | null }>();

  return data?.api_key?.trim() || null;
}

/** Persist a connection's API token (service role; the table is deny-all to clients). */
export async function storeSamsaraToken(input: {
  admin: AdminClient;
  connectionId: string;
  tenantId: string;
  apiToken: string;
}) {
  await input.admin.from("eld_connection_secret").upsert(
    {
      connection_id: input.connectionId,
      tenant_id: input.tenantId,
      api_key: input.apiToken,
    },
    { onConflict: "connection_id" },
  );
}

async function samsaraGet(input: {
  path: string;
  apiToken: string;
  query?: Record<string, string | undefined>;
  cursor?: string | null;
  fetchImpl: typeof fetch;
}): Promise<unknown> {
  const url = samsaraUrl({ path: input.path, query: input.query, cursor: input.cursor, base: SAMSARA_API_BASE });
  const response = await input.fetchImpl(url, { headers: samsaraAuthHeaders(input.apiToken) });

  if (!response.ok) {
    // 401/403 are the everyday failure: a revoked token or a token whose role is
    // missing a scope. Say which, because "HTTP 403" alone sends people hunting
    // in the wrong place.
    if (response.status === 401) {
      throw new Error("Samsara rejected the API token (HTTP 401). Generate a new token and reconnect.");
    }
    if (response.status === 403) {
      throw new Error(
        `Samsara denied access to ${input.path} (HTTP 403). The token's role is missing a required read scope.`,
      );
    }
    throw new Error(`Samsara API ${input.path} failed (HTTP ${response.status}).`);
  }

  return response.json();
}

/**
 * Walk every page of a Samsara list endpoint, collecting the raw pages. Paging
 * is driven by hasNextPage (a sparse page can still be followed by full ones).
 */
async function samsaraGetAllPages(input: {
  path: string;
  apiToken: string;
  query?: Record<string, string | undefined>;
  fetchImpl: typeof fetch;
}): Promise<unknown[]> {
  const pages: unknown[] = [];
  let cursor: string | null = null;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const raw: unknown = await samsaraGet({
      path: input.path,
      apiToken: input.apiToken,
      query: input.query,
      cursor,
      fetchImpl: input.fetchImpl,
    });
    pages.push(raw);

    cursor = samsaraNextCursor(raw);
    if (!cursor) {
      break;
    }
  }

  return pages;
}

/**
 * Best-effort page walk for optional data: returns an empty list instead of
 * throwing, so a scope the customer did not grant on their token (safety events
 * in particular) never fails the core driver/HOS/odometer sync.
 */
async function samsaraGetAllPagesSafe(input: {
  path: string;
  apiToken: string;
  query?: Record<string, string | undefined>;
  fetchImpl: typeof fetch;
}): Promise<unknown[]> {
  try {
    return await samsaraGetAllPages(input);
  } catch {
    return [];
  }
}

/**
 * Sync one tenant's Samsara connection: match the fleet's drivers and vehicles to
 * our records, pull recent duty-status events onto the driver files, advance each
 * linked unit's odometer, and record driver safety events. Connection status and
 * last error are updated either way.
 */
export async function syncSamsaraConnection(
  tenantId: string,
  now: Date = new Date(),
  fetchImpl: typeof fetch = fetch,
): Promise<SamsaraSyncResult> {
  const admin = createSupabaseAdminClient();

  if (!admin) {
    return { ok: false, error: "Service role key is not configured." };
  }

  const { data: connection } = await admin
    .from("eld_connection")
    .select("id, status")
    .eq("tenant_id", tenantId)
    .eq("provider", "samsara")
    .maybeSingle<{ id: string; status: string }>();

  if (!connection) {
    return { ok: false, error: "No Samsara connection for this tenant." };
  }

  const fail = async (error: string): Promise<SamsaraSyncResult> => {
    await admin.from("eld_connection").update({ status: "error", last_error: error }).eq("id", connection.id);
    return { ok: false, error };
  };

  const apiToken = await getSamsaraToken(admin, connection.id);

  if (!apiToken) {
    return fail("Samsara is not authorized yet. Add the API token first.");
  }

  const windowStart = new Date(now.getTime() - SYNC_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  let driverIdByExternalId: Map<string, string>;
  let equipmentIdByExternalVehicleId: Map<string, string>;
  let dutyEvents: NormalizedDutyEvent[];
  let metersUpdated = 0;
  let driverProfiles = 0;
  let safetyEvents = 0;

  try {
    // Drivers: match to our records by name, creating links.
    const driverPages = await samsaraGetAllPages({ path: SAMSARA_DRIVERS_PATH, apiToken, fetchImpl });
    const samsaraDrivers = driverPages.flatMap((page) => normalizeSamsaraDrivers(page));
    driverIdByExternalId = await reconcileEldDriverLinks({
      admin,
      tenantId,
      provider: "samsara",
      drivers: samsaraDrivers,
    });

    // Enrich linked drivers with contact and status from the same response.
    const profileUpserts = buildEldDriverProfileUpserts({
      tenantId,
      provider: "samsara",
      details: driverPages.flatMap((page) => normalizeSamsaraDriverDetails(page)),
      driverIdByExternalId,
      reportedAt: now.toISOString(),
    });
    if (profileUpserts.length > 0) {
      await admin.from("eld_driver_profile").upsert(profileUpserts, { onConflict: "tenant_id,provider,driver_id" });
    }
    driverProfiles = profileUpserts.length;

    // Vehicles: match to our equipment by VIN/plate/unit, creating links.
    const vehiclePages = await samsaraGetAllPages({ path: SAMSARA_VEHICLES_PATH, apiToken, fetchImpl });
    const samsaraVehicles = vehiclePages.flatMap((page) => normalizeSamsaraVehicles(page));
    equipmentIdByExternalVehicleId = await reconcileEldVehicleLinks({
      admin,
      tenantId,
      provider: "samsara",
      vehicles: samsaraVehicles,
    });

    // Odometer: advance the linked units' meters from current vehicle stats.
    metersUpdated = await syncSamsaraOdometers({
      admin,
      tenantId,
      equipmentIdByExternalVehicleId,
      apiToken,
      fetchImpl,
    });

    // Safety events are optional: a token without that scope must not fail HOS.
    safetyEvents = await syncSamsaraSafetyEvents({
      admin,
      tenantId,
      driverIdByExternalId,
      equipmentIdByExternalVehicleId,
      apiToken,
      fetchImpl,
      windowStart,
      now,
    });

    // Hours of service for the window.
    const hosPages = await samsaraGetAllPages({
      path: SAMSARA_HOS_PATH,
      apiToken,
      query: { startTime: windowStart.toISOString(), endTime: now.toISOString() },
      fetchImpl,
    });
    dutyEvents = hosPages.flatMap((page) => normalizeSamsaraDutyRecords(extractSamsaraDutyRecords(page)));
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Samsara sync failed.");
  }

  // Skip duty events we already have for these drivers in the window.
  const linkedDriverIds = Array.from(new Set(driverIdByExternalId.values()));
  const existingKeys = new Set<string>();
  if (linkedDriverIds.length > 0) {
    const { data: existing } = await admin
      .from("transport_duty_status_event")
      .select("driver_id, status, started_at")
      .eq("tenant_id", tenantId)
      .in("driver_id", linkedDriverIds)
      .gte("started_at", windowStart.toISOString())
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
    matchedVehicles: equipmentIdByExternalVehicleId.size,
    metersUpdated,
    driverProfiles,
    safetyEvents,
    skippedUnmatched,
  };
}

/** Fetch the whole fleet list (drivers + vehicles) from Samsara. */
async function fetchSamsaraFleet(input: { apiToken: string; fetchImpl: typeof fetch }) {
  const driverPages = await samsaraGetAllPages({ path: SAMSARA_DRIVERS_PATH, ...input });
  const vehiclePages = await samsaraGetAllPages({ path: SAMSARA_VEHICLES_PATH, ...input });

  return {
    drivers: driverPages.flatMap((page) => normalizeSamsaraDrivers(page)),
    vehicles: vehiclePages.flatMap((page) => normalizeSamsaraVehicles(page)),
  };
}

/**
 * Read the tenant's current drivers, equipment, and existing links, then work out
 * what a Samsara import would create. Shared by the preview page and the apply
 * action so the operator can never approve one plan and have another one run.
 */
async function computeSamsaraImportPlan(input: {
  admin: AdminClient;
  tenantId: string;
  apiToken: string;
  fetchImpl: typeof fetch;
}): Promise<SamsaraImportPlan> {
  const { admin, tenantId } = input;
  const fleet = await fetchSamsaraFleet({ apiToken: input.apiToken, fetchImpl: input.fetchImpl });

  const [{ data: drivers }, { data: equipment }, { data: driverLinks }, { data: vehicleLinks }] = await Promise.all([
    admin
      .from("transport_driver")
      .select("id, full_name")
      .eq("tenant_id", tenantId)
      .is("deleted_at", null)
      .returns<ExistingDriverRow[]>(),
    admin
      .from("equipment")
      .select("id, unit_number, vin_or_serial, license_plate")
      .eq("tenant_id", tenantId)
      .is("deleted_at", null)
      .returns<EquipmentMatchRow[]>(),
    admin
      .from("eld_driver_link")
      .select("external_driver_id")
      .eq("tenant_id", tenantId)
      .eq("provider", "samsara")
      .returns<{ external_driver_id: string }[]>(),
    admin
      .from("eld_vehicle_link")
      .select("external_vehicle_id")
      .eq("tenant_id", tenantId)
      .eq("provider", "samsara")
      .returns<{ external_vehicle_id: string }[]>(),
  ]);

  return buildSamsaraImportPlan({
    drivers: fleet.drivers,
    vehicles: fleet.vehicles,
    existingDrivers: drivers ?? [],
    existingEquipment: equipment ?? [],
    linkedDriverExternalIds: new Set((driverLinks ?? []).map((link) => link.external_driver_id)),
    linkedVehicleExternalIds: new Set((vehicleLinks ?? []).map((link) => link.external_vehicle_id)),
  });
}

/** Preview what importing this tenant's Samsara fleet would create. Writes nothing. */
export async function planSamsaraImport(
  tenantId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: true; plan: SamsaraImportPlan } | { ok: false; error: string }> {
  const admin = createSupabaseAdminClient();

  if (!admin) {
    return { ok: false, error: "Service role key is not configured." };
  }

  const access = await resolveSamsaraAccess(admin, tenantId);

  if (!access.ok) {
    return access;
  }

  try {
    const plan = await computeSamsaraImportPlan({ admin, tenantId, apiToken: access.apiToken, fetchImpl });
    return { ok: true, plan };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not read the Samsara fleet." };
  }
}

/**
 * Create the driver files and equipment that Samsara knows about and we do not,
 * then run a sync so the new records are linked and their data lands immediately.
 *
 * The plan is recomputed here rather than trusted from the form, so a stale
 * preview (or a tampered payload) can never create something the operator did not
 * see. Re-running is safe: anything that now exists is treated as already present.
 */
export async function applySamsaraImport(
  tenantId: string,
  now: Date = new Date(),
  fetchImpl: typeof fetch = fetch,
): Promise<
  { ok: true; driversCreated: number; vehiclesCreated: number; synced: boolean } | { ok: false; error: string }
> {
  const admin = createSupabaseAdminClient();

  if (!admin) {
    return { ok: false, error: "Service role key is not configured." };
  }

  const access = await resolveSamsaraAccess(admin, tenantId);

  if (!access.ok) {
    return access;
  }

  let plan: SamsaraImportPlan;

  try {
    plan = await computeSamsaraImportPlan({ admin, tenantId, apiToken: access.apiToken, fetchImpl });
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not read the Samsara fleet." };
  }

  if (plan.driversToCreate.length > 0) {
    const { error } = await admin.from("transport_driver").insert(
      plan.driversToCreate.map((driver) => ({
        tenant_id: tenantId,
        full_name: driver.fullName,
      })),
    );

    if (error) {
      return { ok: false, error: `Could not create drivers: ${error.message}` };
    }
  }

  if (plan.vehiclesToCreate.length > 0) {
    const { error } = await admin.from("equipment").insert(
      plan.vehiclesToCreate.map((vehicle) => ({
        tenant_id: tenantId,
        unit_number: vehicle.unitNumber,
        vin_or_serial: vehicle.vin,
        license_plate: vehicle.plate,
        make: vehicle.make,
        model: vehicle.model,
        year: vehicle.year,
        // Samsara's /fleet/vehicles is powered units, and they report an odometer,
        // so mileage tracking is the right meter for them. Trailers live on a
        // separate Samsara endpoint we do not import.
        category: "vehicle",
        tracking_mode: "mileage",
        // A vehicle carrying an ELD is a commercial motor vehicle subject to hours
        // of service, so it belongs in the NSC vehicle files. Marking it false
        // would hide a real truck from compliance views, which is the more
        // dangerous mistake; an over-marked pickup is visible and easy to correct.
        is_commercial: true,
      })),
    );

    if (error) {
      return { ok: false, error: `Could not create units: ${error.message}` };
    }
  }

  // Link the new records and pull their data in the same breath, so the operator
  // sees hours and odometer immediately rather than waiting for the cron.
  const sync = await syncSamsaraConnection(tenantId, now, fetchImpl);

  return {
    ok: true,
    driversCreated: plan.driversToCreate.length,
    vehiclesCreated: plan.vehiclesToCreate.length,
    synced: sync.ok,
  };
}

/**
 * Advance each linked unit's odometer from Samsara's current vehicle stats. The
 * reading is logged as an `eld` meter reading when it moves the meter forward,
 * which the meter trigger rolls into equipment.current_meter and so drives the
 * service-interval warnings. Idempotent: an already-logged reading is skipped.
 */
async function syncSamsaraOdometers(input: {
  admin: AdminClient;
  tenantId: string;
  equipmentIdByExternalVehicleId: Map<string, string>;
  apiToken: string;
  fetchImpl: typeof fetch;
}): Promise<number> {
  const { admin, tenantId, equipmentIdByExternalVehicleId, apiToken, fetchImpl } = input;

  if (equipmentIdByExternalVehicleId.size === 0) {
    return 0;
  }

  const pages = await samsaraGetAllPagesSafe({
    path: SAMSARA_VEHICLE_STATS_PATH,
    apiToken,
    query: { types: "obdOdometerMeters,gpsOdometerMeters" },
    fetchImpl,
  });

  const readings = pages.flatMap((page) => normalizeSamsaraVehicleStats(page));

  if (readings.length === 0) {
    return 0;
  }

  const equipmentIds = Array.from(new Set(equipmentIdByExternalVehicleId.values()));

  const { data: equipmentRows } = await admin
    .from("equipment")
    .select("id, current_meter, tracking_mode")
    .eq("tenant_id", tenantId)
    .in("id", equipmentIds)
    .returns<{ id: string; current_meter: number | null; tracking_mode: string }[]>();

  const equipmentInfoById = new Map<string, EquipmentMeterInfo>(
    (equipmentRows ?? []).map((row) => [
      row.id,
      { id: row.id, currentMeter: row.current_meter, trackingMode: row.tracking_mode },
    ]),
  );

  const { data: loggedRows } = await admin
    .from("equipment_meter_log")
    .select("equipment_id, value")
    .eq("tenant_id", tenantId)
    .eq("source", "eld")
    .in("equipment_id", equipmentIds)
    .returns<{ equipment_id: string; value: number }[]>();

  const existingKeys = new Set((loggedRows ?? []).map((row) => eldMeterKey(row.equipment_id, row.value)));

  const { inserts } = buildEldMeterReadings({
    tenantId,
    trips: readings,
    equipmentIdByExternalVehicleId,
    equipmentInfoById,
    existingKeys,
  });

  if (inserts.length === 0) {
    return 0;
  }

  const { error } = await admin.from("equipment_meter_log").insert(inserts);

  return error ? 0 : inserts.length;
}

/** Record Samsara driver safety events on the linked driver files. */
async function syncSamsaraSafetyEvents(input: {
  admin: AdminClient;
  tenantId: string;
  driverIdByExternalId: Map<string, string>;
  equipmentIdByExternalVehicleId: Map<string, string>;
  apiToken: string;
  fetchImpl: typeof fetch;
  windowStart: Date;
  now: Date;
}): Promise<number> {
  const { admin, tenantId, driverIdByExternalId, equipmentIdByExternalVehicleId, apiToken, fetchImpl } = input;

  if (driverIdByExternalId.size === 0) {
    return 0;
  }

  const pages = await samsaraGetAllPagesSafe({
    path: SAMSARA_SAFETY_EVENTS_PATH,
    apiToken,
    query: { startTime: input.windowStart.toISOString(), endTime: input.now.toISOString() },
    fetchImpl,
  });

  const events = pages.flatMap((page) => normalizeSamsaraSafetyEvents(page));

  if (events.length === 0) {
    return 0;
  }

  const linkedDriverIds = Array.from(new Set(driverIdByExternalId.values()));
  const { data: existing } = await admin
    .from("eld_driver_event")
    .select("driver_id, event_type, occurred_at, external_event_id, value")
    .eq("tenant_id", tenantId)
    .in("driver_id", linkedDriverIds)
    .gte("occurred_at", input.windowStart.toISOString())
    .returns<
      {
        driver_id: string;
        event_type: EldDriverEventType;
        occurred_at: string;
        external_event_id: string | null;
        value: number | null;
      }[]
    >();

  const existingKeys = new Set(
    (existing ?? []).map((row) =>
      eldDriverEventKey(row.driver_id, row.event_type, row.occurred_at, row.external_event_id, row.value),
    ),
  );

  const { inserts } = buildEldDriverEventInserts({
    tenantId,
    provider: "samsara",
    events,
    driverIdByExternalId,
    equipmentIdByExternalVehicleId,
    existingKeys,
  });

  if (inserts.length === 0) {
    return 0;
  }

  const { error } = await admin.from("eld_driver_event").insert(inserts);

  return error ? 0 : inserts.length;
}
