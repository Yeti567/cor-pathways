// Reading the spreadsheets a client fills in and sends back.
//
// This is the first place a client's real data meets the system, and it is the
// place where a bad load is cheapest to stop. Everything here is pure: given the
// raw cell values off a sheet, it produces either a clean typed row or an error
// that names the sheet and the row number, so a problem can be sent back to the
// client as "row 14, the expiry date" rather than "the file didn't work".
//
// Three assumptions about real filled-in packs drive the design:
//
//  1. HEADERS GET EDITED. People rename columns, add a space, capitalise
//     differently, or paste the table into a new sheet. Matching on an exact
//     string would fail on a file that is otherwise perfect, so every field has
//     a set of accepted spellings and matching ignores case and punctuation.
//
//  2. THE EXAMPLE ROW SURVIVES. Every pack ships with a filled-in example. Two
//     of them (Employees, Certifications) use a realistic-looking person rather
//     than a shouty "DELETE THIS ROW" marker, so a client can easily leave it in
//     without noticing. Loading it would create a fake employee with a working
//     login. That is a data-integrity bug and a security one, so example rows are
//     detected and dropped rather than trusted to have been deleted.
//
//  3. PACKS COME BACK MORE THAN ONCE. Corrections arrive as a whole new file, so
//     parsing has to be stable and the planner above it has to update rather than
//     duplicate.

export type PackSheet = "employees" | "locations" | "equipment" | "certifications" | "unitCertifications";

export type PackRowError = {
  sheet: PackSheet;
  /** 1-based row number as it appears in Excel, so it can be quoted to the client. */
  row: number;
  column: string;
  message: string;
};

/** Strip case and punctuation so a renamed or re-spaced header still matches. */
export function normalizeHeader(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/**
 * The example row every pack ships with, in both the styles we generated.
 *
 * The obvious marker catches Locations, Equipment and Unit Certifications. The
 * placeholder email catches Employees and Certifications, whose examples look
 * like a real person on purpose so the client can see the expected shape. Both
 * checks are needed; neither alone covers all five sheets.
 */
export function isExampleRow(values: readonly unknown[]): boolean {
  const joined = values.map((value) => String(value ?? "")).join(" ").toLowerCase();

  return (
    joined.includes("example row") ||
    joined.includes("delete this row") ||
    // The domain we used in every sample address. A real client address will not
    // be @yourcompany.ca, and if one ever is, it is still safer to reject it and
    // ask than to create a login nobody recognises.
    joined.includes("@yourcompany.ca") ||
    joined.includes("yourcompany.ca")
  );
}

export function isBlankRow(values: readonly unknown[]): boolean {
  return values.every((value) => String(value ?? "").trim() === "");
}

// --- Field coercion ---------------------------------------------------------

export function textValue(value: unknown): string {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

/**
 * Dates as they actually arrive from a spreadsheet.
 *
 * Excel hands back a Date for a real date cell, but the packs format every column
 * as Text so that VINs and phone numbers survive, which means dates usually come
 * back as strings. Clients also type them the way they speak them. Accepting only
 * ISO would reject most real files, so the common Canadian orderings are handled,
 * and anything genuinely ambiguous is refused rather than guessed.
 *
 * Returns null for an empty cell and undefined for an unparseable one, so the
 * caller can tell "not supplied" from "supplied and wrong".
 */
export function dateValue(value: unknown): string | null | undefined {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }

  const text = String(value ?? "").trim();

  if (!text) {
    return null;
  }

  const iso = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);

  if (iso) {
    return isoDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  }

  // DD/MM/YYYY and MM/DD/YYYY are indistinguishable for the first twelve days of
  // a month, and a wrong expiry date is a compliance record that lies. Only take
  // it when the day is unambiguous, i.e. greater than 12.
  const slashed = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);

  if (slashed) {
    const first = Number(slashed[1]);
    const second = Number(slashed[2]);
    const year = Number(slashed[3]);

    if (first > 12 && second <= 12) {
      return isoDate(year, second, first);
    }

    if (second > 12 && first <= 12) {
      return isoDate(year, first, second);
    }

    return undefined;
  }

  // "01 Jun 2027" and "June 1, 2027".
  const parsed = Date.parse(`${text} UTC`);

  if (!Number.isNaN(parsed) && /[a-z]{3}/i.test(text)) {
    return new Date(parsed).toISOString().slice(0, 10);
  }

  return undefined;
}

function isoDate(year: number, month: number, day: number): string | undefined {
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return undefined;
  }

  const stamp = Date.UTC(year, month - 1, day);
  const check = new Date(stamp);

  // Rejects the 31st of a 30-day month, which Date.UTC would silently roll over.
  if (check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
    return undefined;
  }

  return check.toISOString().slice(0, 10);
}

/** yes/no columns, as forgiving as people actually are. */
export function booleanValue(value: unknown): boolean | undefined {
  const text = String(value ?? "").trim().toLowerCase();

  if (!text) {
    return undefined;
  }

  if (["yes", "y", "true", "1", "x"].includes(text)) {
    return true;
  }

  if (["no", "n", "false", "0"].includes(text)) {
    return false;
  }

  return undefined;
}

export function numberValue(value: unknown): number | null | undefined {
  const text = String(value ?? "").trim().replace(/[,\s]/g, "");

  if (!text) {
    return null;
  }

  const parsed = Number(text);

  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * Map an option the client picked from a dropdown onto the value the app stores.
 *
 * The dropdowns constrain what a client can choose, but a pack that has been
 * copied into a fresh sheet loses its validation, so free text arrives anyway.
 */
export function optionValue<T extends string>(
  value: unknown,
  options: Readonly<Record<string, T>>,
): T | undefined {
  const key = normalizeHeader(value);

  return key ? options[key] : undefined;
}

export const PERMISSION_LEVELS: Readonly<Record<string, "super_admin" | "admin" | "manager" | "supervisor" | "worker">> = {
  superadmin: "super_admin",
  admin: "admin",
  manager: "manager",
  supervisor: "supervisor",
  worker: "worker",
};

// The client picks the word they use for the unit; the app stores a category.
// Everything with an odometer or an hour meter that drives on a highway is a
// vehicle, a trailer is a trailer, and a picker or crane is still a vehicle
// because it is a truck with a boom on it, not a yard machine.
export const EQUIPMENT_TYPES: Readonly<Record<string, "vehicle" | "trailer" | "mobile_equipment" | "other">> = {
  truck: "vehicle",
  tractor: "vehicle",
  pickup: "vehicle",
  pickertruck: "vehicle",
  picker: "vehicle",
  crane: "vehicle",
  trailer: "trailer",
  other: "other",
};

export const METER_TYPES: Readonly<Record<string, "mileage" | "hours">> = {
  km: "mileage",
  kms: "mileage",
  kilometres: "mileage",
  kilometers: "mileage",
  miles: "mileage",
  mileage: "mileage",
  odometer: "mileage",
  hours: "hours",
  hrs: "hours",
};

// No location type list, and no address. A site is called whatever the crew calls
// it, usually a customer plus a street ("McKinley Bayfront"), which is neither an
// address nor a category. The locations table can store neither, and asking a
// client to fill in a column we then discard is worse than not asking.
//
// A code IS asked for, and required. Locations are set up once and then picked
// from a dropdown by every worker after that, so the number is the short stable
// label on the list, and it stops a corrected pack creating a second copy of a
// site whose nickname was respelled.
