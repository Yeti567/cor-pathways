// Shared ELD link reconciliation.
//
// Matching a provider's drivers and vehicles onto our records is identical for
// every ELD: the only difference is which provider column the links are stored
// under. Keeping one copy here means a fix to the matching rules (name
// normalization, VIN/plate/unit precedence) lands for every provider at once,
// instead of being fixed in one connector and quietly missed in the others.

import { buildVehicleLinkMatches, type EldVehicleSummary, type EquipmentMatchRow } from "@/lib/eld/sync";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { Database, EldProvider } from "@/types/database";

type AdminClient = NonNullable<ReturnType<typeof createSupabaseAdminClient>>;
type DbDriver = Pick<Database["public"]["Tables"]["transport_driver"]["Row"], "id" | "full_name">;

/**
 * Ensure every provider driver we can match by name has an eld_driver_link, and
 * return the external-id -> our-driver-id map for all current links.
 */
export async function reconcileEldDriverLinks(input: {
  admin: AdminClient;
  tenantId: string;
  provider: EldProvider;
  drivers: { externalId: string; fullName: string }[];
}): Promise<Map<string, string>> {
  const { admin, tenantId, provider, drivers: providerDrivers } = input;

  const { data: links } = await admin
    .from("eld_driver_link")
    .select("external_driver_id, driver_id")
    .eq("tenant_id", tenantId)
    .eq("provider", provider)
    .returns<{ external_driver_id: string; driver_id: string }[]>();

  const map = new Map<string, string>((links ?? []).map((link) => [link.external_driver_id, link.driver_id]));

  const unlinked = providerDrivers.filter((driver) => !map.has(driver.externalId));
  if (unlinked.length === 0) {
    return map;
  }

  const { data: drivers } = await admin
    .from("transport_driver")
    .select("id, full_name")
    .eq("tenant_id", tenantId)
    .is("deleted_at", null)
    .returns<DbDriver[]>();

  const driverIdByName = new Map<string, string>(
    (drivers ?? []).map((driver) => [driver.full_name.trim().toLowerCase(), driver.id]),
  );
  const newLinks: Database["public"]["Tables"]["eld_driver_link"]["Insert"][] = [];

  for (const providerDriver of unlinked) {
    const driverId = driverIdByName.get(providerDriver.fullName.trim().toLowerCase());
    if (driverId) {
      map.set(providerDriver.externalId, driverId);
      newLinks.push({
        tenant_id: tenantId,
        provider,
        external_driver_id: providerDriver.externalId,
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
 * Ensure every provider vehicle we can match (by VIN, plate, or unit number) has
 * an eld_vehicle_link to our equipment, and return the external-vehicle-id -> our
 * equipment-id map for all current links.
 */
export async function reconcileEldVehicleLinks(input: {
  admin: AdminClient;
  tenantId: string;
  provider: EldProvider;
  vehicles: EldVehicleSummary[];
}): Promise<Map<string, string>> {
  const { admin, tenantId, provider, vehicles } = input;

  const { data: links } = await admin
    .from("eld_vehicle_link")
    .select("external_vehicle_id, equipment_id")
    .eq("tenant_id", tenantId)
    .eq("provider", provider)
    .returns<{ external_vehicle_id: string; equipment_id: string }[]>();

  const map = new Map<string, string>((links ?? []).map((link) => [link.external_vehicle_id, link.equipment_id]));
  const unlinked = vehicles.filter((vehicle) => !map.has(vehicle.externalId));

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
    vehicles,
    equipment: equipment ?? [],
    alreadyLinkedExternalIds: new Set(map.keys()),
  });

  if (matches.length > 0) {
    const newLinks: Database["public"]["Tables"]["eld_vehicle_link"]["Insert"][] = matches.map((match) => ({
      tenant_id: tenantId,
      provider,
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
