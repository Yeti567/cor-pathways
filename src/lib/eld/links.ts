// Shared ELD link reconciliation.
//
// Matching a provider's drivers and vehicles onto our records is identical for
// every ELD: the only difference is which provider column the links are stored
// under. Keeping one copy here means a fix to the matching rules (name
// normalization, VIN/plate/unit precedence) lands for every provider at once,
// instead of being fixed in one connector and quietly missed in the others.
//
// A link resolves to one of TWO kinds of record. The telematics device is in a truck,
// and that truck is either this company's own or a hired carrier's, so every link, event
// and profile carries exactly one target. See 20260826020000 for why: a fleet that owns
// only trailers and contracts every power unit had nothing for the old single target to
// match, because a trailer carries no ELD.
//
// CONTRACTED IS TRIED FIRST. Where a fleet runs both, the hired tractors outnumber the
// owned ones and the owned list is often trailers, which can never be the answer. Trying
// contracted first also means a unit number reused across the two lists resolves to the
// truck actually carrying the device rather than to a same-numbered trailer.

import { buildVehicleLinkMatches, type EldVehicleSummary, type EquipmentMatchRow } from "@/lib/eld/sync";
import {
  driverTargetColumns,
  readDriverTarget,
  readVehicleTarget,
  vehicleTargetColumns,
  type EldTarget,
} from "@/lib/eld/targets";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { Database, EldProvider } from "@/types/database";

type AdminClient = NonNullable<ReturnType<typeof createSupabaseAdminClient>>;
type DbDriver = { id: string; full_name: string };

export type { EldTarget, EldTargetKind } from "@/lib/eld/targets";

/**
 * Ensure every provider driver we can match by name has an eld_driver_link, and
 * return the external-id -> target map for all current links.
 */
export async function reconcileEldDriverLinks(input: {
  admin: AdminClient;
  tenantId: string;
  provider: EldProvider;
  drivers: { externalId: string; fullName: string }[];
}): Promise<Map<string, EldTarget>> {
  const { admin, tenantId, provider, drivers: providerDrivers } = input;

  const { data: links } = await admin
    .from("eld_driver_link")
    .select("external_driver_id, driver_id, contracted_driver_id")
    .eq("tenant_id", tenantId)
    .eq("provider", provider)
    .returns<{ external_driver_id: string; driver_id: string | null; contracted_driver_id: string | null }[]>();

  const map = new Map<string, EldTarget>();

  for (const link of links ?? []) {
    const target = readDriverTarget(link);

    if (target) {
      map.set(link.external_driver_id, target);
    }
  }

  const unlinked = providerDrivers.filter((driver) => !map.has(driver.externalId));
  if (unlinked.length === 0) {
    return map;
  }

  const [{ data: contractedDrivers }, { data: ownDrivers }] = await Promise.all([
    admin
      .from("contracted_driver")
      .select("id, full_name")
      .eq("tenant_id", tenantId)
      .is("deleted_at", null)
      .returns<DbDriver[]>(),
    admin
      .from("transport_driver")
      .select("id, full_name")
      .eq("tenant_id", tenantId)
      .is("deleted_at", null)
      .returns<DbDriver[]>(),
  ]);

  // Own drivers laid down first, contracted second, so contracted wins a name collision.
  // A person who is genuinely on both lists is a data problem to fix on the roster, not
  // something to resolve differently on each sync.
  const targetByName = new Map<string, EldTarget>();

  for (const driver of ownDrivers ?? []) {
    targetByName.set(driver.full_name.trim().toLowerCase(), { kind: "own", id: driver.id });
  }

  for (const driver of contractedDrivers ?? []) {
    targetByName.set(driver.full_name.trim().toLowerCase(), { kind: "contracted", id: driver.id });
  }

  const newLinks: Database["public"]["Tables"]["eld_driver_link"]["Insert"][] = [];

  for (const providerDriver of unlinked) {
    const target = targetByName.get(providerDriver.fullName.trim().toLowerCase());

    if (target) {
      map.set(providerDriver.externalId, target);
      newLinks.push({
        tenant_id: tenantId,
        provider,
        external_driver_id: providerDriver.externalId,
        ...driverTargetColumns(target),
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
 * an eld_vehicle_link, and return the external-vehicle-id -> target map for all
 * current links.
 */
export async function reconcileEldVehicleLinks(input: {
  admin: AdminClient;
  tenantId: string;
  provider: EldProvider;
  vehicles: EldVehicleSummary[];
}): Promise<Map<string, EldTarget>> {
  const { admin, tenantId, provider, vehicles } = input;

  const { data: links } = await admin
    .from("eld_vehicle_link")
    .select("external_vehicle_id, equipment_id, contracted_equipment_id")
    .eq("tenant_id", tenantId)
    .eq("provider", provider)
    .returns<
      { external_vehicle_id: string; equipment_id: string | null; contracted_equipment_id: string | null }[]
    >();

  const map = new Map<string, EldTarget>();

  for (const link of links ?? []) {
    const target = readVehicleTarget(link);

    if (target) {
      map.set(link.external_vehicle_id, target);
    }
  }

  const unlinked = vehicles.filter((vehicle) => !map.has(vehicle.externalId));

  if (unlinked.length === 0) {
    return map;
  }

  const [{ data: contracted }, { data: own }] = await Promise.all([
    admin
      .from("contracted_equipment")
      .select("id, unit_number, vin_or_serial, license_plate")
      .eq("tenant_id", tenantId)
      .is("deleted_at", null)
      .returns<EquipmentMatchRow[]>(),
    admin
      .from("equipment")
      .select("id, unit_number, vin_or_serial, license_plate")
      .eq("tenant_id", tenantId)
      .is("deleted_at", null)
      .returns<EquipmentMatchRow[]>(),
  ]);

  const alreadyLinked = new Set(map.keys());

  // Contracted first: the hired tractors are what carry the devices, and a fleet whose
  // own list is all trailers has no candidate there at all. Anything still unmatched then
  // gets a second pass against the own fleet.
  const contractedMatches = buildVehicleLinkMatches({
    vehicles,
    equipment: contracted ?? [],
    alreadyLinkedExternalIds: alreadyLinked,
  });

  const resolved = new Set([...alreadyLinked, ...contractedMatches.map((match) => match.externalVehicleId)]);

  const ownMatches = buildVehicleLinkMatches({
    vehicles,
    equipment: own ?? [],
    alreadyLinkedExternalIds: resolved,
  });

  const matches: { externalVehicleId: string; target: EldTarget }[] = [
    ...contractedMatches.map((match) => ({
      externalVehicleId: match.externalVehicleId,
      target: { kind: "contracted" as const, id: match.equipmentId },
    })),
    ...ownMatches.map((match) => ({
      externalVehicleId: match.externalVehicleId,
      target: { kind: "own" as const, id: match.equipmentId },
    })),
  ];

  if (matches.length > 0) {
    const newLinks: Database["public"]["Tables"]["eld_vehicle_link"]["Insert"][] = matches.map((match) => ({
      tenant_id: tenantId,
      provider,
      external_vehicle_id: match.externalVehicleId,
      ...vehicleTargetColumns(match.target),
    }));
    await admin.from("eld_vehicle_link").upsert(newLinks, { onConflict: "tenant_id,provider,external_vehicle_id" });
    for (const match of matches) {
      map.set(match.externalVehicleId, match.target);
    }
  }

  return map;
}
