// Turning a filled-in client pack into typed rows, or into errors worth sending back.
//
// Every sheet is parsed the same way: find the header row, map each accepted
// spelling onto a field, then coerce and validate each data row. Errors carry the
// sheet name and the Excel row number so a problem reads as "Employees, row 14,
// Permission Level" and can be forwarded to the client as-is.
//
// The rule that matters most: a row either parses completely or it fails. There
// is no partial row. A half-parsed employee with a name and no email is the kind
// of record that looks fine on a list and breaks at login.

import {
  EQUIPMENT_TYPES,
  METER_TYPES,
  PERMISSION_LEVELS,
  booleanValue,
  dateValue,
  isBlankRow,
  isExampleRow,
  normalizeHeader,
  numberValue,
  optionValue,
  textValue,
  type PackRowError,
  type PackSheet,
} from "./schema";

export type EmployeeRow = {
  rowNumber: number;
  fullName: string;
  email: string;
  jobTitle: string | null;
  phone: string | null;
  powerLevel: "super_admin" | "admin" | "manager" | "supervisor" | "worker";
};

// No address, and no type. A yard is called whatever the crew calls it, often the
// customer plus a street ("McKinley Bayfront"), which is not an address and does
// not want to be turned into one. Neither field has anywhere to be stored, and
// asking a client to fill in a column we then discard is worse than not asking.
//
// That also makes the NAME a weak key: an arbitrary nickname comes back spelled
// differently on the next pack. The code is the stable identifier, so matching
// leans on it first.
export type LocationRow = {
  rowNumber: number;
  /**
   * Null when the client did not give the site a number, which is the normal
   * case: the packs already in clients' hands have no code column. The planner
   * assigns one on load rather than asking, so the dropdown every worker picks
   * from still gets a short stable label.
   */
  code: string | null;
  name: string;
  active: boolean;
};

export type EquipmentRow = {
  rowNumber: number;
  unitNumber: string;
  category: "vehicle" | "trailer" | "mobile_equipment" | "other";
  year: number | null;
  make: string | null;
  model: string | null;
  vin: string | null;
  plate: string | null;
  trackingMode: "mileage" | "hours" | null;
  meterReading: number | null;
  cvipExpiry: string | null;
  registrationExpiry: string | null;
  insuranceExpiry: string | null;
  isCommercial: boolean;
};

export type CertificationRow = {
  rowNumber: number;
  workerEmail: string;
  workerName: string | null;
  certificationType: string;
  issuedOn: string | null;
  expiresOn: string | null;
};

export type UnitCertificationRow = {
  rowNumber: number;
  unitNumber: string;
  certificationType: string;
  issuedOn: string | null;
  expiresOn: string | null;
};

export type ParseResult<T> = {
  rows: T[];
  errors: PackRowError[];
  /** Rows dropped as the shipped example or as blank. Reported so a pack that is
   *  entirely example rows does not read as an empty but valid file. */
  skipped: number;
};

/** A sheet as it comes off the spreadsheet reader: a header row then data rows. */
export type RawSheet = {
  /** 1-based Excel row number of the header, so data row numbers stay truthful. */
  headerRowNumber: number;
  header: unknown[];
  rows: unknown[][];
};

/**
 * Accepted spellings per field.
 *
 * The first entry is what we shipped; the rest are what comes back. Matching is
 * on the normalized form, so case, spacing and punctuation are already handled
 * and these only need to cover genuinely different wording.
 */
const COLUMN_ALIASES: Record<PackSheet, Record<string, readonly string[]>> = {
  employees: {
    fullName: ["Full Name", "name", "employee", "worker"],
    email: ["Work Email (becomes their login)", "email", "work email", "login"],
    jobTitle: ["Job Title", "title", "position"],
    phone: ["Mobile Phone (optional)", "phone", "mobile", "cell"],
    powerLevel: ["Permission Level", "permission", "role", "access level"],
  },
  locations: {
    name: ["name", "location", "site name"],
    code: ["code", "short code"],
    active: ["active", "in use"],
  },
  equipment: {
    unitNumber: ["unit_number", "unit", "unit no", "unit number"],
    type: ["type", "equipment type", "category"],
    year: ["year"],
    make: ["make"],
    model: ["model"],
    vin: ["vin", "serial", "vin or serial"],
    plate: ["plate", "licence plate", "license plate"],
    meterType: ["meter_type", "meter", "meter type"],
    meterReading: ["meter_reading", "odometer", "hours", "meter reading"],
    cvipExpiry: ["cvip_expiry", "cvip"],
    registrationExpiry: ["registration_expiry", "registration"],
    insuranceExpiry: ["insurance_expiry", "insurance"],
    commercial: ["commercial", "nsc", "is commercial"],
  },
  certifications: {
    workerEmail: ["worker_email", "email", "worker email"],
    workerName: ["worker_name", "name", "worker"],
    certificationType: ["certification_type", "certification", "ticket", "type"],
    issuedOn: ["issued_on", "issued", "issue date"],
    expiresOn: ["expires_on", "expires", "expiry", "expiry date"],
  },
  unitCertifications: {
    unitNumber: ["unit_number", "unit", "unit no", "unit number"],
    certificationType: ["certification_type", "certification", "type"],
    issuedOn: ["issued_on", "issued", "issue date"],
    expiresOn: ["expires_on", "expires", "expiry", "expiry date"],
  },
};

type ColumnIndex = Record<string, number>;

/**
 * Map field names to column positions.
 *
 * Unrecognised columns are ignored rather than rejected: clients add a "notes"
 * column or leave a stray total on the end, and refusing the file over that would
 * be pedantic. A REQUIRED field with no column is a different matter and is
 * caught by the caller.
 */
export function indexColumns(sheet: PackSheet, header: readonly unknown[]): ColumnIndex {
  const aliases = COLUMN_ALIASES[sheet];
  const index: ColumnIndex = {};

  header.forEach((cell, position) => {
    const key = normalizeHeader(cell);

    if (!key) {
      return;
    }

    for (const [field, spellings] of Object.entries(aliases)) {
      if (field in index) {
        continue;
      }

      if (spellings.some((spelling) => normalizeHeader(spelling) === key)) {
        index[field] = position;
      }
    }
  });

  return index;
}

function cell(row: readonly unknown[], index: ColumnIndex, field: string): unknown {
  const position = index[field];
  return position === undefined ? "" : row[position];
}

function missingColumns(sheet: PackSheet, index: ColumnIndex, required: readonly string[]): PackRowError[] {
  return required
    .filter((field) => index[field] === undefined)
    .map((field) => ({
      sheet,
      row: 0,
      column: COLUMN_ALIASES[sheet][field][0],
      message: `The "${COLUMN_ALIASES[sheet][field][0]}" column is missing from the sheet.`,
    }));
}

/** Shared shell: header check, then row-by-row parse with example and blank rows dropped. */
function parseSheet<T>(
  sheet: PackSheet,
  raw: RawSheet,
  required: readonly string[],
  parseRow: (row: readonly unknown[], index: ColumnIndex, rowNumber: number, fail: Fail) => T | null,
): ParseResult<T> {
  const index = indexColumns(sheet, raw.header);
  const errors = missingColumns(sheet, index, required);

  if (errors.length > 0) {
    return { rows: [], errors, skipped: 0 };
  }

  const rows: T[] = [];
  let skipped = 0;

  raw.rows.forEach((row, offset) => {
    const rowNumber = raw.headerRowNumber + 1 + offset;

    if (isBlankRow(row) || isExampleRow(row)) {
      skipped += 1;
      return;
    }

    let failed = false;
    const fail: Fail = (column, message) => {
      failed = true;
      errors.push({ sheet, row: rowNumber, column, message });
    };

    const parsed = parseRow(row, index, rowNumber, fail);

    // A row that raised an error is never kept, even if the parser returned
    // something. Half a compliance record is worse than none.
    if (parsed !== null && !failed) {
      rows.push(parsed);
    }
  });

  return { rows, errors, skipped };
}

type Fail = (column: string, message: string) => void;

function requiredText(value: unknown, column: string, fail: Fail): string {
  const text = textValue(value);

  if (!text) {
    fail(column, `${column} is required.`);
  }

  return text;
}

function optionalDate(value: unknown, column: string, fail: Fail): string | null {
  const parsed = dateValue(value);

  if (parsed === undefined) {
    fail(
      column,
      `"${textValue(value)}" is not a date we can read. Use YYYY-MM-DD, for example 2027-05-01.`,
    );
    return null;
  }

  return parsed;
}

export function parseEmployees(raw: RawSheet): ParseResult<EmployeeRow> {
  return parseSheet<EmployeeRow>("employees", raw, ["fullName", "email", "powerLevel"], (row, index, rowNumber, fail) => {
    const email = textValue(cell(row, index, "email")).toLowerCase();

    if (!email) {
      fail("Work Email", "A work email is required, because it becomes their login.");
    } else if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      fail("Work Email", `"${email}" is not a valid email address.`);
    }

    const powerLevel = optionValue(cell(row, index, "powerLevel"), PERMISSION_LEVELS);

    if (!powerLevel) {
      fail(
        "Permission Level",
        `"${textValue(cell(row, index, "powerLevel"))}" is not one of Super Admin, Admin, Manager, Supervisor or Worker.`,
      );
    }

    return {
      rowNumber,
      fullName: requiredText(cell(row, index, "fullName"), "Full Name", fail),
      email,
      jobTitle: textValue(cell(row, index, "jobTitle")) || null,
      phone: textValue(cell(row, index, "phone")) || null,
      powerLevel: powerLevel ?? "worker",
    };
  });
}

export function parseLocations(raw: RawSheet): ParseResult<LocationRow> {
  return parseSheet<LocationRow>("locations", raw, ["name"], (row, index, rowNumber, fail) => {
    const active = booleanValue(cell(row, index, "active"));

    return {
      rowNumber,
      code: textValue(cell(row, index, "code")) || null,
      name: requiredText(cell(row, index, "name"), "name", fail),
      // Blank means in use. A client leaving the column empty is saying nothing,
      // and defaulting to inactive would quietly hide every one of their sites.
      active: active ?? true,
    };
  });
}

export function parseEquipment(raw: RawSheet): ParseResult<EquipmentRow> {
  return parseSheet<EquipmentRow>("equipment", raw, ["unitNumber"], (row, index, rowNumber, fail) => {
    const category = optionValue(cell(row, index, "type"), EQUIPMENT_TYPES);
    const rawType = textValue(cell(row, index, "type"));

    if (rawType && !category) {
      fail("type", `"${rawType}" is not a unit type we recognise.`);
    }

    const meterTypeText = textValue(cell(row, index, "meterType")).toLowerCase();
    const trackingMode = meterTypeText === "none" ? null : optionValue(cell(row, index, "meterType"), METER_TYPES);

    if (meterTypeText && meterTypeText !== "none" && !trackingMode) {
      fail("meter_type", `"${meterTypeText}" is not km, hours or none.`);
    }

    const meterReading = numberValue(cell(row, index, "meterReading"));

    if (meterReading === undefined) {
      fail("meter_reading", `"${textValue(cell(row, index, "meterReading"))}" is not a number.`);
    }

    const year = numberValue(cell(row, index, "year"));

    if (year === undefined) {
      fail("year", `"${textValue(cell(row, index, "year"))}" is not a year.`);
    }

    return {
      rowNumber,
      unitNumber: requiredText(cell(row, index, "unitNumber"), "unit_number", fail),
      // Default to vehicle rather than other: an unknown road unit that reads as
      // "other" drops out of the NSC requirement model silently, and a truck the
      // app forgets to ask about is the dangerous direction.
      category: category ?? "vehicle",
      year: year ?? null,
      make: textValue(cell(row, index, "make")) || null,
      model: textValue(cell(row, index, "model")) || null,
      vin: textValue(cell(row, index, "vin")) || null,
      plate: textValue(cell(row, index, "plate")) || null,
      trackingMode: trackingMode ?? null,
      meterReading: meterReading ?? null,
      cvipExpiry: optionalDate(cell(row, index, "cvipExpiry"), "cvip_expiry", fail),
      registrationExpiry: optionalDate(cell(row, index, "registrationExpiry"), "registration_expiry", fail),
      insuranceExpiry: optionalDate(cell(row, index, "insuranceExpiry"), "insurance_expiry", fail),
      // Same reasoning as the category default. An over-marked pickup is visible
      // on a compliance screen and easy to correct; an unmarked truck is not.
      isCommercial: booleanValue(cell(row, index, "commercial")) ?? true,
    };
  });
}

export function parseCertifications(raw: RawSheet): ParseResult<CertificationRow> {
  return parseSheet<CertificationRow>(
    "certifications",
    raw,
    ["workerEmail", "certificationType"],
    (row, index, rowNumber, fail) => ({
      rowNumber,
      workerEmail: requiredText(cell(row, index, "workerEmail"), "worker_email", fail).toLowerCase(),
      workerName: textValue(cell(row, index, "workerName")) || null,
      certificationType: requiredText(cell(row, index, "certificationType"), "certification_type", fail),
      issuedOn: optionalDate(cell(row, index, "issuedOn"), "issued_on", fail),
      expiresOn: optionalDate(cell(row, index, "expiresOn"), "expires_on", fail),
    }),
  );
}

export function parseUnitCertifications(raw: RawSheet): ParseResult<UnitCertificationRow> {
  return parseSheet<UnitCertificationRow>(
    "unitCertifications",
    raw,
    ["unitNumber", "certificationType"],
    (row, index, rowNumber, fail) => ({
      rowNumber,
      unitNumber: requiredText(cell(row, index, "unitNumber"), "unit_number", fail),
      certificationType: requiredText(cell(row, index, "certificationType"), "certification_type", fail),
      issuedOn: optionalDate(cell(row, index, "issuedOn"), "issued_on", fail),
      expiresOn: optionalDate(cell(row, index, "expiresOn"), "expires_on", fail),
    }),
  );
}
