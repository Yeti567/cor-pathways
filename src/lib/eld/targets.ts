// What an ELD record points at.
//
// A telematics device sits in one truck, and that truck is either this company's own or a
// hired carrier's. Every link, device, event and profile therefore carries exactly one of
// two targets, and the database enforces it (see 20260826020000).
//
// This module holds nothing but the type and the column mapping, so both the matcher
// (links.ts) and the row builders (sync.ts) can use it without importing each other.

/** Which table a resolved link points at. */
export type EldTargetKind = "own" | "contracted";

export type EldTarget = { kind: EldTargetKind; id: string };

/**
 * The columns for a driver target.
 *
 * Kept in one place so a connector cannot write a contracted id into the own-fleet
 * column. That mistake would pass the type checker, fail the foreign key it does not
 * belong to, and read as a mysterious sync error rather than as the wiring bug it is.
 */
export function driverTargetColumns(target: EldTarget): {
  driver_id: string | null;
  contracted_driver_id: string | null;
} {
  return target.kind === "contracted"
    ? { driver_id: null, contracted_driver_id: target.id }
    : { driver_id: target.id, contracted_driver_id: null };
}

/** The columns for a vehicle target. Null target means neither column is set. */
export function vehicleTargetColumns(target: EldTarget | null | undefined): {
  equipment_id: string | null;
  contracted_equipment_id: string | null;
} {
  if (!target) {
    return { equipment_id: null, contracted_equipment_id: null };
  }

  return target.kind === "contracted"
    ? { equipment_id: null, contracted_equipment_id: target.id }
    : { equipment_id: target.id, contracted_equipment_id: null };
}

/**
 * Split resolved targets into the two id lists a query has to filter on separately.
 *
 * Every de-duplication query in the connectors reads "which of these do we already have",
 * and a target's id lives in one of two columns. Filtering only one column finds nothing
 * for the other kind, which does not error: it silently reports every event as new and
 * re-inserts the whole sync window each run. This helper exists so that failure has one
 * shape and one fix.
 */
export function splitEldTargets(targets: Iterable<EldTarget>): { own: string[]; contracted: string[] } {
  const own = new Set<string>();
  const contracted = new Set<string>();

  for (const target of targets) {
    (target.kind === "contracted" ? contracted : own).add(target.id);
  }

  return { own: [...own], contracted: [...contracted] };
}

/** Read a driver target back off a stored row, whichever column it landed in. */
export function readDriverTarget(row: {
  driver_id?: string | null;
  contracted_driver_id?: string | null;
}): EldTarget | null {
  if (row.contracted_driver_id) {
    return { kind: "contracted", id: row.contracted_driver_id };
  }

  return row.driver_id ? { kind: "own", id: row.driver_id } : null;
}

/** Read a vehicle target back off a stored row. */
export function readVehicleTarget(row: {
  equipment_id?: string | null;
  contracted_equipment_id?: string | null;
}): EldTarget | null {
  if (row.contracted_equipment_id) {
    return { kind: "contracted", id: row.contracted_equipment_id };
  }

  return row.equipment_id ? { kind: "own", id: row.equipment_id } : null;
}
