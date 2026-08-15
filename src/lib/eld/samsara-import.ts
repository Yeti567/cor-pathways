// Samsara fleet import planner.
//
// Turns "what Samsara knows" into "what we would create", without touching the
// database, so the operator can see the exact list before anything is written.
//
// WHY IMPORT INSTEAD OF TYPING IT IN. The sync links a Samsara driver to our
// driver file by NAME, and a Samsara vehicle to our equipment by VIN, plate, or
// unit number. Anything typed by hand is a chance for "Bill Cordell" vs "William
// Cordell", or unit "T-014" vs "T014", and every one of those is a record that
// silently never syncs. Creating the records FROM Samsara makes Samsara's own
// spelling the spelling, so the identifiers match by construction.
//
// WHAT THIS DOES NOT DO. It creates driver files and equipment, not app logins.
// Who can sign in, and at what permission level, stays a deliberate human
// decision made through the worker invite flow.
//
// There is no unique constraint on equipment.unit_number or on
// transport_driver.full_name, so nothing in the database stops a second copy
// being created. The de-duplication below is the only guard, which is why it is
// pure and heavily tested rather than inlined in an action.

import { buildVehicleLinkMatches, type EldDriverSummary, type EldVehicleSummary, type EquipmentMatchRow } from "@/lib/eld/sync";

export type ExistingDriverRow = { id: string; full_name: string };

export type PlannedDriver = { externalId: string; fullName: string };

export type PlannedVehicle = {
  externalId: string;
  unitNumber: string;
  vin: string | null;
  plate: string | null;
  make: string | null;
  model: string | null;
  year: number | null;
};

export type SkippedItem = { externalId: string; label: string; reason: string };

export type SamsaraImportPlan = {
  driversToCreate: PlannedDriver[];
  driversAlreadyPresent: number;
  driversSkipped: SkippedItem[];
  vehiclesToCreate: PlannedVehicle[];
  vehiclesAlreadyPresent: number;
  vehiclesSkipped: SkippedItem[];
};

/** Same normalization the link matcher uses, so plan and sync agree. */
function normalizeKey(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

export function isSamsaraImportPlanEmpty(plan: SamsaraImportPlan): boolean {
  return plan.driversToCreate.length === 0 && plan.vehiclesToCreate.length === 0;
}

/**
 * Decide what would be created from a Samsara fleet, given what we already have.
 *
 * A record is only ever created when nothing already matches it, both in our
 * database and within the Samsara payload itself (Samsara can carry two vehicles
 * with the same name, and importing both would be two units for one truck).
 */
export function buildSamsaraImportPlan(input: {
  drivers: EldDriverSummary[];
  vehicles: EldVehicleSummary[];
  existingDrivers: ExistingDriverRow[];
  existingEquipment: EquipmentMatchRow[];
  linkedDriverExternalIds?: Set<string>;
  linkedVehicleExternalIds?: Set<string>;
}): SamsaraImportPlan {
  const linkedDrivers = input.linkedDriverExternalIds ?? new Set<string>();
  const linkedVehicles = input.linkedVehicleExternalIds ?? new Set<string>();

  // ---- drivers: matched by name ----
  const existingDriverNames = new Set(input.existingDrivers.map((driver) => normalizeKey(driver.full_name)));
  const driversToCreate: PlannedDriver[] = [];
  const driversSkipped: SkippedItem[] = [];
  const plannedDriverNames = new Set<string>();
  let driversAlreadyPresent = 0;

  for (const driver of input.drivers) {
    const name = driver.fullName.trim();
    const key = normalizeKey(name);

    if (!key) {
      driversSkipped.push({
        externalId: driver.externalId,
        label: `Samsara driver ${driver.externalId}`,
        reason: "No name in Samsara, so there is nothing to match on.",
      });
      continue;
    }

    if (linkedDrivers.has(driver.externalId) || existingDriverNames.has(key)) {
      driversAlreadyPresent += 1;
      continue;
    }

    if (plannedDriverNames.has(key)) {
      driversSkipped.push({
        externalId: driver.externalId,
        label: name,
        reason: "Another Samsara driver has the same name; importing both would create a duplicate file.",
      });
      continue;
    }

    plannedDriverNames.add(key);
    driversToCreate.push({ externalId: driver.externalId, fullName: name });
  }

  // ---- vehicles: matched by VIN, then plate, then unit number ----
  // Reuse the sync's own matcher so "already present" here means exactly what
  // "will link" means there.
  const matched = buildVehicleLinkMatches({
    vehicles: input.vehicles,
    equipment: input.existingEquipment,
    alreadyLinkedExternalIds: linkedVehicles,
  });
  const matchedExternalIds = new Set(matched.map((match) => match.externalVehicleId));

  const vehiclesToCreate: PlannedVehicle[] = [];
  const vehiclesSkipped: SkippedItem[] = [];
  const plannedUnitNumbers = new Set<string>();
  const plannedVins = new Set<string>();
  let vehiclesAlreadyPresent = 0;

  for (const vehicle of input.vehicles) {
    if (linkedVehicles.has(vehicle.externalId) || matchedExternalIds.has(vehicle.externalId)) {
      vehiclesAlreadyPresent += 1;
      continue;
    }

    const unitNumber = (vehicle.unitNumber ?? "").trim();
    const label = unitNumber || vehicle.vin || `Samsara vehicle ${vehicle.externalId}`;

    // equipment.unit_number is NOT NULL and it is how people find a truck, so a
    // nameless Samsara vehicle is reported rather than invented a name for.
    if (!unitNumber) {
      vehiclesSkipped.push({
        externalId: vehicle.externalId,
        label,
        reason: "No unit name in Samsara. Name the vehicle in Samsara, then import again.",
      });
      continue;
    }

    const unitKey = normalizeKey(unitNumber);
    const vinKey = normalizeKey(vehicle.vin);

    if (plannedUnitNumbers.has(unitKey)) {
      vehiclesSkipped.push({
        externalId: vehicle.externalId,
        label,
        reason: "Another Samsara vehicle has the same unit name; importing both would create a duplicate unit.",
      });
      continue;
    }

    if (vinKey && plannedVins.has(vinKey)) {
      vehiclesSkipped.push({
        externalId: vehicle.externalId,
        label,
        reason: "Another Samsara vehicle has the same VIN; importing both would create a duplicate unit.",
      });
      continue;
    }

    plannedUnitNumbers.add(unitKey);
    if (vinKey) {
      plannedVins.add(vinKey);
    }

    vehiclesToCreate.push({
      externalId: vehicle.externalId,
      unitNumber,
      vin: vehicle.vin,
      plate: vehicle.plate,
      make: vehicle.make,
      model: vehicle.model,
      year: vehicle.year,
    });
  }

  return {
    driversToCreate,
    driversAlreadyPresent,
    driversSkipped,
    vehiclesToCreate,
    vehiclesAlreadyPresent,
    vehiclesSkipped,
  };
}
