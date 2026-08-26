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
  CERTIFICATION_CATEGORIES,
  CONTRACTED_DRIVER_TYPES,
  CONTRACTED_STATUSES,
  EQUIPMENT_TYPES,
  METER_TYPES,
  PERMISSION_LEVELS,
  TANK_SPECS,
  booleanValue,
  dateValue,
  isBlankRow,
  isExampleRow,
  listValue,
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
// customer plus a street ("Riverbend Yard"), which is not an address and does
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
  tankSpec: "tc406" | "tc407" | null;
  isInsulated: boolean | null;
  /**
   * The inspections this unit is held to, by name, as written in the sheet.
   *
   * Empty means the column was blank, which is not the same as "held to nothing":
   * the loader leaves such a unit on the tenant's default list rather than clearing
   * it, so a pack that never fills this column behaves exactly as packs did before
   * the column existed.
   */
  inspections: string[];
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
  /**
   * Which physical part this certificate covers, when one unit has several.
   *
   * A tank trailer carries four product hoses, each with its own serial number and
   * its own annual expiry. Without this they collide into a single "Product hose"
   * record per unit and three of the four expiries are lost.
   */
  componentId: string | null;
};

// --- The contracted side ----------------------------------------------------
//
// Every contracted record hangs off a carrier, and the carrier is identified by its
// legal name as written on the sheet. That is deliberately a NAME rather than an id:
// these sheets are maintained by the client in Excel, and asking them to carry a uuid
// around would guarantee it goes stale. The planner resolves the name once and reports
// any that do not match a carrier, which is the failure a person can actually fix.

export type ContractedCompanyRow = {
  rowNumber: number;
  legalName: string;
  operatingName: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  nscNumber: string | null;
  wcbAccountNumber: string | null;
  craBusinessNumber: string | null;
  notes: string | null;
};

export type ContractedCompanyDocumentRow = {
  rowNumber: number;
  company: string;
  /**
   * Which requirement this satisfies, as a slot key from
   * src/lib/subcontractor-requirements.ts. The converter maps the client's column
   * headings onto these, so a sheet never has to carry an internal key by hand.
   */
  slotKey: string;
  issuedOn: string | null;
  expiresOn: string | null;
  documentNumber: string | null;
  notes: string | null;
};

export type ContractedEquipmentRow = {
  rowNumber: number;
  unitNumber: string;
  /** The carrier's legal name, matched against the companies sheet and the database. */
  company: string;
  ownerName: string | null;
  year: number | null;
  make: string | null;
  modelOrColour: string | null;
  vin: string | null;
  plate: string | null;
  registrationProvince: string | null;
  status: "active" | "inactive" | "terminated";
  notes: string | null;
  /**
   * The fixed files. Two, not the fleet's three: insurance is a carrier-level document
   * for a hired carrier, filed once against the company rather than against each truck,
   * so a Pink Card column on the sheet is read past rather than loaded.
   */
  cvipExpiry: string | null;
  registrationExpiry: string | null;
  /** Inspections this unit is held to, by name. Empty leaves it on the defaults. */
  inspections: string[];
};

export type ContractedEquipmentCertificationRow = {
  rowNumber: number;
  unitNumber: string;
  certificationType: string;
  issuedOn: string | null;
  expiresOn: string | null;
  /**
   * Which physical part this covers, when a unit has more than one of a type.
   *
   * A tractor carries a primary and a spare product hose, and two fire extinguishers of
   * different sizes. Without this they collapse into one record per type and the second
   * expiry is lost.
   */
  componentId: string | null;
};

export type ContractedDriverRow = {
  rowNumber: number;
  fullName: string;
  company: string;
  /** The truck they are in, matched by unit number. Blank is normal. */
  unitNumber: string | null;
  licenseProvince: string | null;
  licenseExpiry: string | null;
  abstractIssued: string | null;
  abstractExpiry: string | null;
  csoCompleted: string | null;
  driverType: "contracted" | "casual";
  status: "active" | "inactive" | "terminated";
  notes: string | null;
  // No emergency contact and no medical column, deliberately. Those stay with dispatch;
  // see the table comment in 20260826010000.
};

export type ContractedDriverCertificationRow = {
  rowNumber: number;
  driverName: string;
  /** Needed as well as the name: two carriers can each employ a John Smith. */
  company: string;
  certificationType: string;
  category: "ticket" | "orientation" | "site_access";
  issuedOn: string | null;
  expiresOn: string | null;
  issuingCompany: string | null;
  /** Badge number, gate PIN or key fob. */
  detail: string | null;
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
    tankSpec: ["tank_spec", "tank", "tank spec", "specification", "tc spec"],
    insulated: ["insulated", "is insulated", "insulation"],
    inspections: ["inspections", "inspection_list", "required inspections", "certifications"],
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
    componentId: ["serial", "component", "hose_serial", "hose serial", "serial number", "component id"],
  },
  contractedCompanies: {
    legalName: ["legal_name", "company", "company name", "carrier", "legal name"],
    operatingName: ["operating_name", "operating as", "trade name", "dba"],
    contactName: ["contact_name", "contact"],
    contactEmail: ["contact_email", "email"],
    contactPhone: ["contact_phone", "phone"],
    nscNumber: ["nsc_number", "nsc", "safety fitness certificate"],
    wcbAccountNumber: ["wcb_account", "wcb", "wcb number", "wcb account"],
    craBusinessNumber: ["cra_business_number", "cra", "business number", "cra business"],
    notes: ["notes", "comments"],
  },
  contractedCompanyDocuments: {
    company: ["company", "company name", "carrier", "legal_name"],
    slotKey: ["slot_key", "slot", "document", "requirement", "document type"],
    issuedOn: ["issued_on", "issued", "issue date"],
    expiresOn: ["expires_on", "expires", "expiry", "expiry date"],
    documentNumber: ["document_number", "number", "policy_number", "policy number"],
    notes: ["notes", "comments"],
  },
  contractedEquipment: {
    unitNumber: ["unit_number", "unit", "unit no", "unit number"],
    company: ["company", "company name", "carrier", "legal_name"],
    ownerName: ["owner", "owner_name"],
    year: ["year"],
    make: ["make"],
    modelOrColour: ["model", "model_or_colour", "make and colour", "truck make color", "colour", "color"],
    vin: ["vin", "serial", "vin or serial"],
    plate: ["plate", "licence plate", "license plate", "tractor license plate"],
    registrationProvince: ["registration_province", "reg prov", "reg province", "registered in"],
    status: ["status"],
    notes: ["notes", "comments"],
    cvipExpiry: ["cvip_expiry", "cvip", "inspection"],
    registrationExpiry: ["registration_expiry", "registration"],
    // No insuranceExpiry alias. Their truck sheet has a Pink Card column and it stays
    // there; it simply has nowhere to land now that insurance is held on the carrier.
    inspections: ["inspections", "inspection_list", "required inspections", "certifications"],
  },
  contractedEquipmentCertifications: {
    unitNumber: ["unit_number", "unit", "unit no", "unit number"],
    certificationType: ["certification_type", "certification", "type"],
    issuedOn: ["issued_on", "issued", "issue date"],
    expiresOn: ["expires_on", "expires", "expiry", "expiry date"],
    componentId: ["serial", "component", "component id", "serial number", "position"],
  },
  contractedDrivers: {
    fullName: ["full_name", "name", "driver", "drivers"],
    company: ["company", "company name", "carrier", "legal_name"],
    unitNumber: ["unit_number", "unit", "unit no", "unit number"],
    licenseProvince: ["license_province", "licence province", "drivers licence province", "prov"],
    licenseExpiry: ["license_expiry", "licence expiry", "drivers licence", "drivers license"],
    abstractIssued: ["abstract_issued", "abstract issue date", "drivers abstract issue date"],
    abstractExpiry: ["abstract_expiry", "abstract expiry", "driver abstract expiry date"],
    csoCompleted: ["cso_completed", "cso", "common safety orientation"],
    driverType: ["driver_type", "type"],
    status: ["status"],
    notes: ["notes", "comments"],
  },
  contractedDriverCertifications: {
    driverName: ["driver_name", "name", "driver", "drivers"],
    company: ["company", "company name", "carrier", "legal_name"],
    certificationType: ["certification_type", "certification", "type", "ticket"],
    category: ["category", "kind"],
    issuedOn: ["issued_on", "issued", "issue date"],
    expiresOn: ["expires_on", "expires", "expiry", "expiry date"],
    issuingCompany: ["issuing_company", "issued by", "provider", "training company"],
    detail: ["detail", "badge", "pin", "fob", "badge number"],
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

    const tankSpecText = textValue(cell(row, index, "tankSpec"));
    const tankSpec = optionValue(cell(row, index, "tankSpec"), TANK_SPECS);

    if (tankSpecText && !tankSpec) {
      fail("tank_spec", `"${tankSpecText}" is not a tank specification we recognise. Use 406 or 407.`);
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
      tankSpec: tankSpec ?? null,
      // Null, not false. False would claim we know this is a non-insulated tank,
      // which is a different statement from "nobody said" and from "not a tank".
      isInsulated: booleanValue(cell(row, index, "insulated")) ?? null,
      inspections: listValue(cell(row, index, "inspections")),
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
      componentId: textValue(cell(row, index, "componentId")) || null,
    }),
  );
}

// --- The contracted side ----------------------------------------------------

export function parseContractedCompanies(raw: RawSheet): ParseResult<ContractedCompanyRow> {
  return parseSheet<ContractedCompanyRow>(
    "contractedCompanies",
    raw,
    ["legalName"],
    (row, index, rowNumber, fail) => ({
      rowNumber,
      legalName: requiredText(cell(row, index, "legalName"), "legal_name", fail),
      operatingName: textValue(cell(row, index, "operatingName")) || null,
      contactName: textValue(cell(row, index, "contactName")) || null,
      contactEmail: textValue(cell(row, index, "contactEmail")).toLowerCase() || null,
      contactPhone: textValue(cell(row, index, "contactPhone")) || null,
      nscNumber: textValue(cell(row, index, "nscNumber")) || null,
      wcbAccountNumber: textValue(cell(row, index, "wcbAccountNumber")) || null,
      craBusinessNumber: textValue(cell(row, index, "craBusinessNumber")) || null,
      notes: textValue(cell(row, index, "notes")) || null,
    }),
  );
}

export function parseContractedEquipment(raw: RawSheet): ParseResult<ContractedEquipmentRow> {
  return parseSheet<ContractedEquipmentRow>(
    "contractedEquipment",
    raw,
    ["unitNumber", "company"],
    (row, index, rowNumber, fail) => {
      const year = numberValue(cell(row, index, "year"));

      if (year === undefined) {
        fail("year", `"${textValue(cell(row, index, "year"))}" is not a year we can read.`);
      }

      return {
        rowNumber,
        unitNumber: requiredText(cell(row, index, "unitNumber"), "unit_number", fail),
        company: requiredText(cell(row, index, "company"), "company", fail),
        ownerName: textValue(cell(row, index, "ownerName")) || null,
        year: year ?? null,
        make: textValue(cell(row, index, "make")) || null,
        modelOrColour: textValue(cell(row, index, "modelOrColour")) || null,
        vin: textValue(cell(row, index, "vin")) || null,
        plate: textValue(cell(row, index, "plate")) || null,
        registrationProvince: textValue(cell(row, index, "registrationProvince")) || null,
        status: optionValue(cell(row, index, "status"), CONTRACTED_STATUSES) ?? "active",
        notes: textValue(cell(row, index, "notes")) || null,
        cvipExpiry: optionalDate(cell(row, index, "cvipExpiry"), "cvip_expiry", fail),
        registrationExpiry: optionalDate(cell(row, index, "registrationExpiry"), "registration_expiry", fail),
        inspections: listValue(cell(row, index, "inspections")),
      };
    },
  );
}

export function parseContractedEquipmentCertifications(
  raw: RawSheet,
): ParseResult<ContractedEquipmentCertificationRow> {
  return parseSheet<ContractedEquipmentCertificationRow>(
    "contractedEquipmentCertifications",
    raw,
    ["unitNumber", "certificationType"],
    (row, index, rowNumber, fail) => ({
      rowNumber,
      unitNumber: requiredText(cell(row, index, "unitNumber"), "unit_number", fail),
      certificationType: requiredText(cell(row, index, "certificationType"), "certification_type", fail),
      issuedOn: optionalDate(cell(row, index, "issuedOn"), "issued_on", fail),
      expiresOn: optionalDate(cell(row, index, "expiresOn"), "expires_on", fail),
      componentId: textValue(cell(row, index, "componentId")) || null,
    }),
  );
}

export function parseContractedDrivers(raw: RawSheet): ParseResult<ContractedDriverRow> {
  return parseSheet<ContractedDriverRow>(
    "contractedDrivers",
    raw,
    ["fullName", "company"],
    (row, index, rowNumber, fail) => ({
      rowNumber,
      fullName: requiredText(cell(row, index, "fullName"), "full_name", fail),
      company: requiredText(cell(row, index, "company"), "company", fail),
      unitNumber: textValue(cell(row, index, "unitNumber")) || null,
      licenseProvince: textValue(cell(row, index, "licenseProvince")) || null,
      licenseExpiry: optionalDate(cell(row, index, "licenseExpiry"), "license_expiry", fail),
      abstractIssued: optionalDate(cell(row, index, "abstractIssued"), "abstract_issued", fail),
      abstractExpiry: optionalDate(cell(row, index, "abstractExpiry"), "abstract_expiry", fail),
      csoCompleted: optionalDate(cell(row, index, "csoCompleted"), "cso_completed", fail),
      driverType: optionValue(cell(row, index, "driverType"), CONTRACTED_DRIVER_TYPES) ?? "contracted",
      status: optionValue(cell(row, index, "status"), CONTRACTED_STATUSES) ?? "active",
      notes: textValue(cell(row, index, "notes")) || null,
    }),
  );
}

export function parseContractedDriverCertifications(
  raw: RawSheet,
): ParseResult<ContractedDriverCertificationRow> {
  return parseSheet<ContractedDriverCertificationRow>(
    "contractedDriverCertifications",
    raw,
    ["driverName", "company", "certificationType"],
    (row, index, rowNumber, fail) => ({
      rowNumber,
      driverName: requiredText(cell(row, index, "driverName"), "driver_name", fail),
      company: requiredText(cell(row, index, "company"), "company", fail),
      certificationType: requiredText(cell(row, index, "certificationType"), "certification_type", fail),
      // An unlabelled row is a ticket, which is what most of them are. A wrong guess
      // here only decides which list it appears in, never whether it is loaded.
      category: optionValue(cell(row, index, "category"), CERTIFICATION_CATEGORIES) ?? "ticket",
      issuedOn: optionalDate(cell(row, index, "issuedOn"), "issued_on", fail),
      expiresOn: optionalDate(cell(row, index, "expiresOn"), "expires_on", fail),
      issuingCompany: textValue(cell(row, index, "issuingCompany")) || null,
      detail: textValue(cell(row, index, "detail")) || null,
    }),
  );
}

export function parseContractedCompanyDocuments(raw: RawSheet): ParseResult<ContractedCompanyDocumentRow> {
  return parseSheet<ContractedCompanyDocumentRow>(
    "contractedCompanyDocuments",
    raw,
    ["company", "slotKey"],
    (row, index, rowNumber, fail) => ({
      rowNumber,
      company: requiredText(cell(row, index, "company"), "company", fail),
      slotKey: requiredText(cell(row, index, "slotKey"), "slot_key", fail),
      issuedOn: optionalDate(cell(row, index, "issuedOn"), "issued_on", fail),
      expiresOn: optionalDate(cell(row, index, "expiresOn"), "expires_on", fail),
      documentNumber: textValue(cell(row, index, "documentNumber")) || null,
      notes: textValue(cell(row, index, "notes")) || null,
    }),
  );
}
