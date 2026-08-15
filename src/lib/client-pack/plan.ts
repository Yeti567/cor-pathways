// Deciding what a filled-in pack would actually do to a tenant, before it does it.
//
// Pure. Given the parsed rows and a snapshot of what the tenant already holds,
// this produces one decision per row: create, update, or skip. Nothing here
// touches a database, which is what makes the preview trustworthy: the plan you
// read is computed by the same code that later executes it, not by a separate
// description of it.
//
// Two properties matter more than anything else here.
//
// RE-RUNNABLE. Clients send corrections as a whole new file, usually more than
// once. Loading a corrected pack has to update the records it already created
// rather than lay a second copy beside them. Matching therefore uses the same
// duplicate-check rules the manual entry forms use, so "already there" means the
// same thing everywhere in the app.
//
// ALL OR NOTHING. A pack with an error anywhere produces no writes at all. A
// half-loaded client is worse than a rejected file, because nobody can tell which
// half arrived, and the natural next move is to load it again, which is how you
// end up with duplicates on top of a mess.

import {
  findEquipmentDuplicate,
  normalizeEmail,
  normalizeIdentifier,
  type EquipmentDuplicateRow,
} from "@/lib/duplicate-check";
import type {
  CertificationRow,
  EmployeeRow,
  EquipmentRow,
  LocationRow,
  UnitCertificationRow,
} from "./parse";
import type { PackRowError, PackSheet } from "./schema";

export type PlanAction = "create" | "update" | "skip";

export type PlanItem<T> = {
  action: PlanAction;
  row: T;
  /** Id of the existing record, when this updates one. */
  existingId?: string;
  /** One line for the preview, saying what will happen and why. */
  detail: string;
};

export type PackPlan = {
  employees: PlanItem<EmployeeRow>[];
  locations: PlanItem<LocationRow>[];
  equipment: PlanItem<EquipmentRow>[];
  certifications: PlanItem<CertificationRow & { workerId: string }>[];
  unitCertifications: PlanItem<UnitCertificationRow & { equipmentId: string }>[];
  errors: PackRowError[];
};

/** What the tenant already holds, as the planner needs to see it. */
export type TenantSnapshot = {
  users: { id: string; email: string | null; full_name: string }[];
  locations: { id: string; name: string; code: string | null }[];
  equipment: EquipmentDuplicateRow[];
  /** Worker certifications, already joined to the owning user. */
  certifications: { id: string; userId: string; name: string }[];
  /** Unit certifications filed as equipment_document rows of type certification. */
  unitCertifications: { id: string; equipmentId: string; label: string }[];
};

function error(sheet: PackSheet, row: number, column: string, message: string): PackRowError {
  return { sheet, row, column, message };
}

/**
 * Catch a pack that contradicts itself before comparing it to the database.
 *
 * Two rows claiming the same login is not something the planner can resolve: last
 * one wins would silently discard a real person, and first one wins would do the
 * same. It has to go back to the client.
 */
function findInternalDuplicates<T>(
  sheet: PackSheet,
  rows: readonly T[],
  keyOf: (row: T) => string,
  rowNumberOf: (row: T) => number,
  column: string,
  label: string,
): PackRowError[] {
  const seen = new Map<string, number>();
  const errors: PackRowError[] = [];

  for (const row of rows) {
    const key = keyOf(row);

    if (!key) {
      continue;
    }

    const first = seen.get(key);

    if (first !== undefined) {
      errors.push(
        error(
          sheet,
          rowNumberOf(row),
          column,
          `${label} also appears on row ${first}. Every row must be a different one, so please merge or remove the duplicate.`,
        ),
      );
      continue;
    }

    seen.set(key, rowNumberOf(row));
  }

  return errors;
}

/**
 * Compare location codes the way a person would.
 *
 * The pack asks clients to "just number them", so "1", "01" and "001" all turn
 * up meaning the same yard. Comparing them as raw text would let an assigned
 * "01" sit alongside a client's "1" as two different sites.
 */
function codeKey(code: string): string {
  const digits = code.trim();

  return /^\d+$/.test(digits) ? String(Number(digits)) : normalizeIdentifier(code);
}

/** The lowest number not already in use. */
function nextFreeCode(used: ReadonlySet<string>): string {
  for (let candidate = 1; candidate < 1000; candidate += 1) {
    if (!used.has(codeKey(String(candidate)))) {
      return String(candidate).padStart(2, "0");
    }
  }

  return String(used.size + 1);
}

export function planEmployees(rows: readonly EmployeeRow[], snapshot: TenantSnapshot): {
  items: PlanItem<EmployeeRow>[];
  errors: PackRowError[];
} {
  const errors = findInternalDuplicates(
    "employees",
    rows,
    (row) => normalizeEmail(row.email),
    (row) => row.rowNumber,
    "Work Email",
    "That email",
  );

  const byEmail = new Map(
    snapshot.users
      .filter((user) => user.email)
      .map((user) => [normalizeEmail(user.email), user] as const),
  );

  const items = rows.map((row) => {
    const existing = byEmail.get(normalizeEmail(row.email));

    if (existing) {
      return {
        action: "update" as const,
        row,
        existingId: existing.id,
        detail: `${row.fullName} already has a login. Their name, title, phone and permission level will be updated.`,
      };
    }

    return {
      action: "create" as const,
      row,
      detail: `${row.fullName} will be created as ${row.powerLevel.replace("_", " ")} and invited at ${row.email}.`,
    };
  });

  return { items, errors };
}

export function planLocations(rows: readonly LocationRow[], snapshot: TenantSnapshot): {
  items: PlanItem<LocationRow>[];
  errors: PackRowError[];
} {
  const errors = [
    // Only the codes a client actually supplied. A reused number means every
    // later pack would update the wrong site.
    ...findInternalDuplicates(
      "locations",
      rows.filter((row) => row.code),
      (row) => codeKey(row.code ?? ""),
      (row) => row.rowNumber,
      "code",
      "That location code",
    ),
    ...findInternalDuplicates(
      "locations",
      rows,
      (row) => normalizeIdentifier(row.name),
      (row) => row.rowNumber,
      "name",
      "That location name",
    ),
  ];

  const byName = new Map(snapshot.locations.map((location) => [normalizeIdentifier(location.name), location] as const));
  const byCode = new Map(
    snapshot.locations
      .filter((location) => location.code)
      .map((location) => [codeKey(location.code!), location] as const),
  );

  // Codes already spoken for, so an assigned number never collides with one the
  // tenant holds or with one assigned earlier in this same pack.
  const usedCodes = new Set(
    [
      ...snapshot.locations.map((location) => location.code),
      ...rows.map((row) => row.code),
    ]
      .filter((code): code is string => Boolean(code))
      .map(codeKey),
  );

  const items = rows.map((row) => {
    // Code first, name second. A yard's name is whatever the crew calls it,
    // usually a customer and a street, so it comes back spelled differently on
    // the next pack. The code is the half that stays put, and matching on the
    // name first would create a second copy of a site that was only renamed.
    const existing =
      (row.code ? byCode.get(codeKey(row.code)) : undefined) ?? byName.get(normalizeIdentifier(row.name));

    if (existing) {
      const renamed = normalizeIdentifier(existing.name) !== normalizeIdentifier(row.name);

      return {
        action: "update" as const,
        row,
        existingId: existing.id,
        detail: renamed
          ? `${existing.name} will be renamed to ${row.name}, matched on its code.`
          : `${row.name} already exists and will be updated.`,
      };
    }

    // The client did not number their sites, because the pack never asked. Give
    // the site the next free number rather than sending the pack back over it:
    // the number exists to label the dropdown and to survive a respelled
    // nickname, and neither of those needs the client's involvement.
    const assigned = row.code ?? nextFreeCode(usedCodes);
    usedCodes.add(codeKey(assigned));

    return {
      action: "create" as const,
      row: { ...row, code: assigned },
      detail: row.code
        ? `${row.name} will be created as ${assigned}.`
        : `${row.name} will be created and numbered ${assigned}.`,
    };
  });

  return { items, errors };
}

export function planEquipment(rows: readonly EquipmentRow[], snapshot: TenantSnapshot): {
  items: PlanItem<EquipmentRow>[];
  errors: PackRowError[];
} {
  const errors = [
    ...findInternalDuplicates(
      "equipment",
      rows,
      (row) => normalizeIdentifier(row.unitNumber),
      (row) => row.rowNumber,
      "unit_number",
      "That unit number",
    ),
    ...findInternalDuplicates(
      "equipment",
      rows.filter((row) => row.vin),
      (row) => normalizeIdentifier(row.vin),
      (row) => row.rowNumber,
      "vin",
      "That VIN",
    ),
  ];

  const items = rows.map((row) => {
    // The same rules the Add Equipment form uses, so "already there" means the
    // same thing whether a unit arrives by spreadsheet or by hand.
    const match = findEquipmentDuplicate(
      { unitNumber: row.unitNumber, vin: row.vin, plate: row.plate },
      snapshot.equipment,
    );

    if (match) {
      return {
        action: "update" as const,
        row,
        existingId: match.id,
        detail: `${row.unitNumber} matches unit ${match.label} on ${match.field}. Its details and expiry dates will be updated.`,
      };
    }

    return {
      action: "create" as const,
      row,
      detail: `${row.unitNumber}${row.make ? ` (${row.make}${row.model ? ` ${row.model}` : ""})` : ""} will be created.`,
    };
  });

  return { items, errors };
}

/**
 * Worker tickets, which only mean anything once they are attached to a person.
 *
 * The email has to resolve to somebody, either already in the tenant or arriving
 * on the Employees sheet in the same pack. A ticket whose owner cannot be found
 * is not skipped quietly: a missing ticket is a missing qualification, and the
 * client needs to be told which row it was.
 */
export function planCertifications(
  rows: readonly CertificationRow[],
  snapshot: TenantSnapshot,
  employeesInPack: readonly EmployeeRow[],
): { items: PlanItem<CertificationRow & { workerId: string }>[]; errors: PackRowError[] } {
  const errors: PackRowError[] = [];
  const byEmail = new Map(
    snapshot.users
      .filter((user) => user.email)
      .map((user) => [normalizeEmail(user.email), user.id] as const),
  );
  const arrivingEmails = new Set(employeesInPack.map((employee) => normalizeEmail(employee.email)));

  const existingByWorkerAndName = new Map(
    snapshot.certifications.map(
      (certification) => [`${certification.userId}|${normalizeIdentifier(certification.name)}`, certification] as const,
    ),
  );

  const items: PlanItem<CertificationRow & { workerId: string }>[] = [];

  for (const row of rows) {
    const key = normalizeEmail(row.workerEmail);
    const workerId = byEmail.get(key);

    if (!workerId) {
      if (arrivingEmails.has(key)) {
        // The person is being created by this same pack, so the ticket is fine.
        // It cannot be matched against anything yet, so it is always a create.
        items.push({
          action: "create",
          row: { ...row, workerId: "" },
          detail: `${row.certificationType} will be added for ${row.workerName ?? row.workerEmail}, who is being created by this pack.`,
        });
        continue;
      }

      errors.push(
        error(
          "certifications",
          row.rowNumber,
          "worker_email",
          `No employee with the email ${row.workerEmail}. Add them to the Employees sheet or correct the address.`,
        ),
      );
      continue;
    }

    const existing = existingByWorkerAndName.get(`${workerId}|${normalizeIdentifier(row.certificationType)}`);

    if (existing) {
      items.push({
        action: "update",
        row: { ...row, workerId },
        existingId: existing.id,
        detail: `${row.certificationType} is already on file for ${row.workerName ?? row.workerEmail}. Its dates will be updated.`,
      });
      continue;
    }

    items.push({
      action: "create",
      row: { ...row, workerId },
      detail: `${row.certificationType} will be added for ${row.workerName ?? row.workerEmail}.`,
    });
  }

  return { items, errors };
}

/** The same shape for unit tickets, resolved against unit numbers instead of emails. */
export function planUnitCertifications(
  rows: readonly UnitCertificationRow[],
  snapshot: TenantSnapshot,
  equipmentInPack: readonly EquipmentRow[],
): { items: PlanItem<UnitCertificationRow & { equipmentId: string }>[]; errors: PackRowError[] } {
  const errors: PackRowError[] = [];
  const byUnit = new Map(
    snapshot.equipment.map((unit) => [normalizeIdentifier(unit.unit_number), unit.id] as const),
  );
  const arrivingUnits = new Set(equipmentInPack.map((unit) => normalizeIdentifier(unit.unitNumber)));

  const existingByUnitAndLabel = new Map(
    snapshot.unitCertifications.map(
      (certification) =>
        [`${certification.equipmentId}|${normalizeIdentifier(certification.label)}`, certification] as const,
    ),
  );

  const items: PlanItem<UnitCertificationRow & { equipmentId: string }>[] = [];

  for (const row of rows) {
    const key = normalizeIdentifier(row.unitNumber);
    const equipmentId = byUnit.get(key);

    if (!equipmentId) {
      if (arrivingUnits.has(key)) {
        items.push({
          action: "create",
          row: { ...row, equipmentId: "" },
          detail: `${row.certificationType} will be added to ${row.unitNumber}, which is being created by this pack.`,
        });
        continue;
      }

      errors.push(
        error(
          "unitCertifications",
          row.rowNumber,
          "unit_number",
          `No unit called ${row.unitNumber}. Add it to the Equipment sheet or correct the unit number.`,
        ),
      );
      continue;
    }

    const existing = existingByUnitAndLabel.get(`${equipmentId}|${normalizeIdentifier(row.certificationType)}`);

    if (existing) {
      items.push({
        action: "update",
        row: { ...row, equipmentId },
        existingId: existing.id,
        detail: `${row.certificationType} is already on ${row.unitNumber}. Its dates will be updated.`,
      });
      continue;
    }

    items.push({
      action: "create",
      row: { ...row, equipmentId },
      detail: `${row.certificationType} will be added to ${row.unitNumber}.`,
    });
  }

  return { items, errors };
}

export type PlanCounts = { create: number; update: number; skip: number };

export function countActions(items: readonly PlanItem<unknown>[]): PlanCounts {
  return items.reduce<PlanCounts>(
    (counts, item) => ({ ...counts, [item.action]: counts[item.action] + 1 }),
    { create: 0, update: 0, skip: 0 },
  );
}

/**
 * Whether this plan may be applied.
 *
 * One error anywhere stops the whole pack, across every sheet. See the note at the
 * top: a partially loaded client is the worse outcome.
 */
export function planIsApplicable(plan: PackPlan): boolean {
  return plan.errors.length === 0;
}
