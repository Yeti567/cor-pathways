// Duplicate detection for hand-entered records.
//
// Nothing in the database stops a second copy: there is no unique index on
// equipment.unit_number, on transport_driver.full_name, or on users.email. So a
// tired dispatcher entering "T-014" twice, or re-adding a driver who is already
// on file, silently creates a second record. That is worse than an annoying
// error, because the fleet board then shows one truck twice, service intervals
// split across two rows, and an ELD sync links to only one of them.
//
// Matching is deliberately AGGRESSIVE on identifiers and CONSERVATIVE on people:
//   - unit numbers, VINs and plates are compared with all punctuation, spacing
//     and casing stripped, so "T-014", "t 014" and "T014" are one unit.
//   - people are compared on collapsed, case-insensitive names, which flags a
//     likely duplicate but is allowed to be overridden, because two real humans
//     genuinely can share a name.
//
// Pure and unit-tested; the actions call it before inserting.

/** Strip everything that is not a letter or digit, for identifier comparison. */
export function normalizeIdentifier(value: string | null | undefined): string {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Collapse whitespace and casing for name comparison, keeping word boundaries. */
export function normalizePersonName(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeEmail(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

export type EquipmentDuplicateRow = {
  id: string;
  unit_number: string;
  vin_or_serial: string | null;
  license_plate: string | null;
  status?: string | null;
};

export type DuplicateMatch = {
  id: string;
  /** Which field collided, for a message that says what to fix. */
  field: "unit number" | "VIN" | "licence plate" | "name" | "email";
  /** Human label of the existing record. */
  label: string;
  status?: string | null;
};

/**
 * Find an existing unit that collides with the one being entered.
 *
 * Checked in order of how conclusive the collision is: VIN (a VIN is unique to a
 * vehicle worldwide), then unit number (how the yard refers to it), then plate.
 * `excludeId` lets a rename check itself without matching the row being edited.
 */
export function findEquipmentDuplicate(
  input: { unitNumber?: string | null; vin?: string | null; plate?: string | null; excludeId?: string | null },
  existing: EquipmentDuplicateRow[],
): DuplicateMatch | null {
  const unitKey = normalizeIdentifier(input.unitNumber);
  const vinKey = normalizeIdentifier(input.vin);
  const plateKey = normalizeIdentifier(input.plate);

  for (const row of existing) {
    if (input.excludeId && row.id === input.excludeId) {
      continue;
    }

    if (vinKey && normalizeIdentifier(row.vin_or_serial) === vinKey) {
      return { id: row.id, field: "VIN", label: row.unit_number, status: row.status ?? null };
    }
  }

  for (const row of existing) {
    if (input.excludeId && row.id === input.excludeId) {
      continue;
    }

    if (unitKey && normalizeIdentifier(row.unit_number) === unitKey) {
      return { id: row.id, field: "unit number", label: row.unit_number, status: row.status ?? null };
    }
  }

  for (const row of existing) {
    if (input.excludeId && row.id === input.excludeId) {
      continue;
    }

    if (plateKey && normalizeIdentifier(row.license_plate) === plateKey) {
      return { id: row.id, field: "licence plate", label: row.unit_number, status: row.status ?? null };
    }
  }

  return null;
}

export type PersonDuplicateRow = { id: string; full_name: string };

/** Find an existing person with effectively the same name. */
export function findPersonNameDuplicate(
  input: { fullName: string; excludeId?: string | null },
  existing: PersonDuplicateRow[],
): DuplicateMatch | null {
  const key = normalizePersonName(input.fullName);

  if (!key) {
    return null;
  }

  for (const row of existing) {
    if (input.excludeId && row.id === input.excludeId) {
      continue;
    }

    if (normalizePersonName(row.full_name) === key) {
      return { id: row.id, field: "name", label: row.full_name };
    }
  }

  return null;
}

export type EmailDuplicateRow = { id: string; email: string | null; full_name?: string | null };

/** Find an existing user with the same email. Email is the login, so this is conclusive. */
export function findEmailDuplicate(
  input: { email: string; excludeId?: string | null },
  existing: EmailDuplicateRow[],
): DuplicateMatch | null {
  const key = normalizeEmail(input.email);

  if (!key) {
    return null;
  }

  for (const row of existing) {
    if (input.excludeId && row.id === input.excludeId) {
      continue;
    }

    if (normalizeEmail(row.email) === key) {
      return { id: row.id, field: "email", label: row.full_name || key };
    }
  }

  return null;
}

/** One consistent sentence for every duplicate, so the fix is obvious. */
export function duplicateMessage(match: DuplicateMatch, noun: string): string {
  const status = match.status && match.status !== "active" ? ` (${match.status})` : "";
  return `That ${match.field} is already used by ${noun} "${match.label}"${status}. Open that record instead of creating a second one.`;
}
