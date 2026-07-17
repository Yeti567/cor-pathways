import {
  appAccessOptions,
  offlineSyncOptions,
  powerLevelOptions,
  type AppAccessLevel,
  type PowerLevel,
} from "@/lib/access-control";
import { normalizePhone } from "@/lib/workers";

export type WorkerImportRow = {
  appAccess: AppAccessLevel;
  email: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  emergencyContactRelationship: string;
  employeeNumber: string | null;
  fullName: string;
  hiredOn: string | null;
  locationKeys: string[];
  offlineSyncDays: number;
  permissionProfile: string | null;
  phone: string | null;
  powerLevel: PowerLevel;
  rowNumber: number;
  title: string | null;
};

export type WorkerImportParseResult = {
  errors: string[];
  rows: WorkerImportRow[];
};

type WorkerImportKey =
  | "appAccess"
  | "email"
  | "emergencyContactName"
  | "emergencyContactPhone"
  | "emergencyContactRelationship"
  | "employeeNumber"
  | "firstName"
  | "fullName"
  | "hiredOn"
  | "lastName"
  | "locationKeys"
  | "offlineSyncDays"
  | "permissionProfile"
  | "phone"
  | "powerLevel"
  | "title";

export const workerImportTemplateFilename = "worker-import-template.csv";

export const workerImportTemplateHeaders = [
  "email",
  "full_name",
  "title",
  "phone",
  "role",
  "app_access",
  "permission_profile",
  "location_codes",
  "employee_number",
  "hired_on",
  "offline_sync_days",
  "emergency_contact_name",
  "emergency_contact_phone",
  "emergency_contact_relationship",
] as const;

const headerAliases: Record<WorkerImportKey, string[]> = {
  appAccess: ["app_access", "access", "access_level", "app_access_level"],
  email: ["email", "email_address", "work_email"],
  emergencyContactName: ["emergency_contact_name", "emergency_name"],
  emergencyContactPhone: ["emergency_contact_phone", "emergency_phone"],
  emergencyContactRelationship: ["emergency_contact_relationship", "emergency_relationship"],
  employeeNumber: ["employee_number", "employee_id", "employee_no", "staff_number", "staff_id"],
  firstName: ["first_name", "given_name"],
  fullName: ["full_name", "name", "employee_name", "worker_name"],
  hiredOn: ["hired_on", "date_hired", "hire_date", "start_date"],
  lastName: ["last_name", "surname", "family_name"],
  locationKeys: ["location_codes", "locations", "current_locations", "location_names", "assigned_locations"],
  offlineSyncDays: ["offline_sync_days", "sync_days", "offline_sync", "offline_sync_duration"],
  permissionProfile: ["permission_profile", "profile", "app_permission", "permission_profile_id"],
  phone: ["phone", "mobile", "mobile_number", "cell", "cell_phone", "phone_number"],
  powerLevel: ["power_level", "role", "access_tier"],
  title: ["title", "position", "job_title", "role_title"],
};

const powerLevelValues = new Map(
  powerLevelOptions.flatMap((option) => [
    [lookupValue(option.value), option.value],
    [lookupValue(option.label), option.value],
  ]),
);
const appAccessValues = new Map(
  appAccessOptions.flatMap((option) => [
    [lookupValue(option.value), option.value],
    [lookupValue(option.label), option.value],
  ]),
);
const syncDayValues = new Map(
  offlineSyncOptions.flatMap((option) => [
    [String(option.value), option.value],
    [lookupValue(option.label), option.value],
    [`${option.value}days`, option.value],
  ]),
);

for (const [alias, value] of [
  ["superadministrator", "super_admin"],
  ["administrator", "admin"],
  ["foreman", "supervisor"],
  ["lead", "supervisor"],
  ["employee", "worker"],
  ["staff", "worker"],
  ["laborer", "worker"],
  ["labourer", "worker"],
] as const) {
  powerLevelValues.set(alias, value);
}

for (const [alias, value] of [
  ["none", "no_access"],
  ["no", "no_access"],
  ["noapp", "no_access"],
  ["mobile", "app_access"],
  ["web", "app_access"],
  ["worker", "app_access"],
  ["admin", "admin_access"],
  ["superadmin", "super_admin_access"],
] as const) {
  appAccessValues.set(alias, value);
}

for (const [alias, value] of [
  ["week", 7],
  ["1week", 7],
  ["month", 30],
  ["1month", 30],
  ["3month", 90],
  ["3months", 90],
  ["year", 365],
  ["1year", 365],
] as const) {
  syncDayValues.set(alias, value);
}

function lookupValue(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function compactValue(value: string | undefined) {
  return (value ?? "").trim();
}

function csvCell(value: string) {
  if (!/[",\r\n]/.test(value)) {
    return value;
  }

  return `"${value.replaceAll("\"", "\"\"")}"`;
}

export function buildWorkerImportTemplateCsv() {
  return `${workerImportTemplateHeaders.map(csvCell).join(",")}\n`;
}

export function normalizeImportHeader(header: string) {
  return header
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function parseCsv(text: string) {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (inQuotes) {
      if (char === "\"") {
        if (text[index + 1] === "\"") {
          field += "\"";
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === "\"") {
      inQuotes = true;
      continue;
    }

    if (char === ",") {
      row.push(field);
      field = "";
      continue;
    }

    if (char === "\r" || char === "\n") {
      if (char === "\r" && text[index + 1] === "\n") {
        index += 1;
      }

      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      continue;
    }

    field += char;
  }

  row.push(field);
  rows.push(row);

  return rows.filter((cells) => cells.some((cell) => cell.trim()));
}

export function splitImportList(value: string) {
  return value
    .split(/[;,|\n]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function coerceImportPowerLevel(value: string) {
  const token = lookupValue(value);

  if (!token) {
    return "worker" as PowerLevel;
  }

  return powerLevelValues.get(token) ?? null;
}

export function coerceImportAccessLevel(value: string) {
  const token = lookupValue(value);

  if (!token) {
    return "app_access" as AppAccessLevel;
  }

  return appAccessValues.get(token) ?? null;
}

export function coerceImportSyncDays(value: string) {
  const token = lookupValue(value);

  if (!token) {
    return 30;
  }

  return syncDayValues.get(token) ?? null;
}

function coerceDateOnly(value: string) {
  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (isoMatch) {
    return isValidDateParts(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3])) ? trimmed : null;
  }

  const slashMatch = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(trimmed);
  if (!slashMatch) {
    return null;
  }

  const month = Number(slashMatch[1]);
  const day = Number(slashMatch[2]);
  const year = Number(slashMatch[3]);

  if (!isValidDateParts(year, month, day)) {
    return null;
  }

  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function isValidDateParts(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function readValue(row: string[], headerMap: Map<string, number>, key: WorkerImportKey) {
  for (const alias of headerAliases[key]) {
    const index = headerMap.get(alias);

    if (index !== undefined) {
      return compactValue(row[index]);
    }
  }

  return "";
}

function buildHeaderMap(headers: string[]) {
  const headerMap = new Map<string, number>();

  headers.forEach((header, index) => {
    const normalized = normalizeImportHeader(header);

    if (normalized && !headerMap.has(normalized)) {
      headerMap.set(normalized, index);
    }
  });

  return headerMap;
}

function hasHeader(headerMap: Map<string, number>, key: WorkerImportKey) {
  return headerAliases[key].some((alias) => headerMap.has(alias));
}

export function parseWorkerImportCsv(text: string): WorkerImportParseResult {
  const csvRows = parseCsv(text);
  const errors: string[] = [];
  const rows: WorkerImportRow[] = [];

  if (csvRows.length < 2) {
    return { errors: ["CSV needs a header row and at least one worker."], rows };
  }

  const headerMap = buildHeaderMap(csvRows[0]);

  if (!hasHeader(headerMap, "email")) {
    errors.push("CSV needs an email column.");
  }

  if (!hasHeader(headerMap, "fullName") && (!hasHeader(headerMap, "firstName") || !hasHeader(headerMap, "lastName"))) {
    errors.push("CSV needs full_name, or first_name and last_name columns.");
  }

  for (let index = 1; index < csvRows.length; index += 1) {
    const csvRow = csvRows[index];
    const rowNumber = index + 1;
    const email = readValue(csvRow, headerMap, "email").toLowerCase();
    const firstName = readValue(csvRow, headerMap, "firstName");
    const lastName = readValue(csvRow, headerMap, "lastName");
    const fullName = readValue(csvRow, headerMap, "fullName") || [firstName, lastName].filter(Boolean).join(" ");
    const powerLevel = coerceImportPowerLevel(readValue(csvRow, headerMap, "powerLevel"));
    const appAccess = coerceImportAccessLevel(readValue(csvRow, headerMap, "appAccess"));
    const offlineSyncDays = coerceImportSyncDays(readValue(csvRow, headerMap, "offlineSyncDays"));
    const hiredOnValue = readValue(csvRow, headerMap, "hiredOn");
    const hiredOn = coerceDateOnly(hiredOnValue);

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.push(`Row ${rowNumber} needs a valid email.`);
    }

    if (!fullName) {
      errors.push(`Row ${rowNumber} needs a full name.`);
    }

    if (!powerLevel) {
      errors.push(`Row ${rowNumber} has an unknown role.`);
    }

    if (!appAccess) {
      errors.push(`Row ${rowNumber} has an unknown app access value.`);
    }

    if (!offlineSyncDays) {
      errors.push(`Row ${rowNumber} has an unknown offline sync value.`);
    }

    if (hiredOnValue && !hiredOn) {
      errors.push(`Row ${rowNumber} has an invalid date hired.`);
    }

    if (!email || !fullName || !powerLevel || !appAccess || !offlineSyncDays || (hiredOnValue && !hiredOn)) {
      continue;
    }

    rows.push({
      appAccess,
      email,
      emergencyContactName: readValue(csvRow, headerMap, "emergencyContactName"),
      emergencyContactPhone: normalizePhone(readValue(csvRow, headerMap, "emergencyContactPhone")),
      emergencyContactRelationship: readValue(csvRow, headerMap, "emergencyContactRelationship"),
      employeeNumber: readValue(csvRow, headerMap, "employeeNumber") || null,
      fullName,
      hiredOn,
      locationKeys: splitImportList(readValue(csvRow, headerMap, "locationKeys")),
      offlineSyncDays,
      permissionProfile: readValue(csvRow, headerMap, "permissionProfile") || null,
      phone: normalizePhone(readValue(csvRow, headerMap, "phone")) || null,
      powerLevel,
      rowNumber,
      title: readValue(csvRow, headerMap, "title") || null,
    });
  }

  return { errors, rows };
}
