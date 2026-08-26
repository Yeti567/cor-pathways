/**
 * Load a filled-in client pack into a tenant.
 *
 *   npx tsx scripts/load-client-pack.ts --pack "<folder>" --tenant <slug|uuid>
 *   npx tsx scripts/load-client-pack.ts --pack "<folder>" --tenant <slug|uuid> --apply
 *
 * Without --apply it prints what would happen and writes nothing. That is the
 * default on purpose: the preview is the deliverable, and applying is the
 * exception you opt into once you have read it.
 *
 * The preview is produced by the same planner that performs the load, so it is
 * the plan itself rather than a description of it. Everything the planner decides
 * runs through the app's own duplicate-check rules, which means a corrected pack
 * sent a second time updates the records it created the first time instead of
 * laying a second copy beside them.
 *
 * One error anywhere stops the entire pack. A half-loaded client is worse than a
 * rejected file, because nobody can tell which half arrived.
 *
 * Reads SUPABASE_SERVICE_ROLE_KEY and NEXT_PUBLIC_SUPABASE_URL from .env.local.
 * Neither is ever printed.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import ExcelJS from "exceljs";
import { createClient } from "@supabase/supabase-js";
import {
  parseCertifications,
  parseEmployees,
  parseEquipment,
  parseLocations,
  parseContractedCompanies,
  parseContractedCompanyDocuments,
  parseContractedDriverCertifications,
  parseContractedDrivers,
  parseContractedEquipment,
  parseContractedEquipmentCertifications,
  parseUnitCertifications,
  type RawSheet,
} from "../src/lib/client-pack/parse";
import {
  countActions,
  planCertifications,
  planEmployees,
  planEquipment,
  planLocations,
  planContractedCompanies,
  planContractedCompanyDocuments,
  planContractedDriverCertifications,
  planContractedDrivers,
  planContractedEquipment,
  planContractedEquipmentCertifications,
  planUnitCertifications,
  type PlanItem,
  type TenantSnapshot,
} from "../src/lib/client-pack/plan";
import { unitCertificationTitle } from "../src/lib/client-pack/schema";
import {
  buildSubcontractorDocumentWrite,
  getSubcontractorSlot,
} from "../src/lib/subcontractor-requirements";
import type { PackRowError } from "../src/lib/client-pack/schema";
import type { CertificationCategory, Database } from "../src/types/database";

type Args = { pack: string; tenant: string; apply: boolean; includeExpired: boolean; createTypes: boolean };

function parseArgs(argv: string[]): Args {
  const get = (name: string) => {
    const index = argv.indexOf(`--${name}`);
    return index === -1 ? undefined : argv[index + 1];
  };

  const pack = get("pack");
  const tenant = get("tenant");

  if (!pack || !tenant) {
    console.error("Usage: --pack <folder> --tenant <slug|uuid> [--apply] [--include-expired]");
    process.exit(1);
  }

  return {
    pack,
    tenant,
    apply: argv.includes("--apply"),
    includeExpired: argv.includes("--include-expired"),
    // Off by default: a certification type list is tenant-wide policy, and a typo in
    // one row must not quietly become a type that then reads as missing on everybody.
    createTypes: argv.includes("--create-types"),
  };
}

/**
 * Minimal .env.local reader.
 *
 * Deliberately not a dependency, and deliberately never echoes a value. The only
 * thing this script says about a secret is whether it was found.
 */
function loadEnv(): void {
  const path = join(process.cwd(), ".env.local");

  if (!existsSync(path)) {
    return;
  }

  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);

    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
    }
  }
}

// The workbook we send, and the tab inside it that holds the table. Every pack
// leads with a Read Me tab, so the data sheet is never the first worksheet.
const SHEET_FILES = {
  employees: { file: "Employees.xlsx", tab: "Employees" },
  locations: { file: "Locations.xlsx", tab: "Locations" },
  equipment: { file: "Equipment.xlsx", tab: "Equipment" },
  certifications: { file: "Certifications.xlsx", tab: "Certifications" },
  unitCertifications: { file: "Unit Certifications.xlsx", tab: "Unit Certifications" },
  contractedCompanies: { file: "Contracted Companies.xlsx", tab: "Contracted Companies" },
  contractedCompanyDocuments: {
    file: "Contracted Company Documents.xlsx",
    tab: "Contracted Company Documents",
  },
  contractedEquipment: { file: "Contracted Equipment.xlsx", tab: "Contracted Equipment" },
  contractedEquipmentCertifications: {
    file: "Contracted Equipment Certifications.xlsx",
    tab: "Contracted Equipment Certs",
  },
  contractedDrivers: { file: "Contracted Drivers.xlsx", tab: "Contracted Drivers" },
  contractedDriverCertifications: {
    file: "Contracted Driver Certifications.xlsx",
    tab: "Contracted Driver Certs",
  },
} as const;

type SheetRead =
  | { kind: "missing" }
  | { kind: "unreadable"; reason: string }
  | { kind: "ok"; sheet: RawSheet };

/**
 * Read the data tab of a workbook into a header row plus data rows.
 *
 * Named tab first, because every pack leads with a Read Me tab and taking
 * worksheet zero silently reads the instructions instead of the table. If the tab
 * was renamed, fall back to the first worksheet that actually looks like a table,
 * which is the first row holding more than one filled cell. A file that is
 * present but yields no table is reported, not skipped: a client who filled in a
 * sheet deserves to know it could not be read.
 */
/**
 * The plain value of a cell, whatever exceljs wrapped it in.
 *
 * Excel silently converts a typed email address into a hyperlink, and a typed
 * formula into a formula cell, and exceljs faithfully returns those as objects. The
 * parser then stringifies them, so a whole roster fails with
 * `"[object Object]" is not a valid email address` and the person who filled the
 * sheet in correctly is told their data is wrong. That happened to all eleven rows
 * of one client's office staff pack, and a fleet sheet full of linked serial
 * numbers would fail the same way.
 *
 * Unwrap to the text the person actually typed. `text` is what Excel displays;
 * `result` is a cached formula answer; `richText` is a run-formatted string that has
 * to be reassembled from its runs.
 */
function flattenCell(value: unknown): unknown {
  if (value === null || typeof value !== "object") {
    return value;
  }

  if (value instanceof Date) {
    return value;
  }

  const cell = value as {
    text?: unknown;
    hyperlink?: unknown;
    result?: unknown;
    richText?: { text?: unknown }[];
  };

  if (Array.isArray(cell.richText)) {
    return cell.richText.map((run) => String(run?.text ?? "")).join("");
  }

  if (typeof cell.text === "string") {
    return cell.text;
  }

  if (cell.result !== undefined) {
    return flattenCell(cell.result);
  }

  // A hyperlink with no display text at all: the target is the only thing the
  // person can have meant, and "mailto:sam@..." still beats "[object Object]".
  if (typeof cell.hyperlink === "string") {
    return cell.hyperlink.replace(/^mailto:/i, "");
  }

  return value;
}

async function readSheet(path: string, tab: string): Promise<SheetRead> {
  if (!existsSync(path)) {
    return { kind: "missing" };
  }

  const workbook = new ExcelJS.Workbook();

  try {
    await workbook.xlsx.readFile(path);
  } catch (error) {
    return { kind: "unreadable", reason: error instanceof Error ? error.message : "could not be opened" };
  }

  const candidates = [
    ...workbook.worksheets.filter((worksheet) => worksheet.name.trim().toLowerCase() === tab.toLowerCase()),
    ...workbook.worksheets.filter((worksheet) => worksheet.name.trim().toLowerCase() !== tab.toLowerCase()),
  ];

  for (const worksheet of candidates) {
    const grid: unknown[][] = [];
    worksheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
      const values = row.values as unknown[];
      // exceljs pads index 0, so drop it and keep the sheet's own column order.
      grid[rowNumber - 1] = Array.isArray(values) ? values.slice(1).map(flattenCell) : [];
    });

    const headerIndex = grid.findIndex(
      (row) => (row ?? []).filter((cell) => String(cell ?? "").trim()).length > 1,
    );

    if (headerIndex === -1) {
      continue;
    }

    return {
      kind: "ok",
      sheet: {
        headerRowNumber: headerIndex + 1,
        header: grid[headerIndex] ?? [],
        rows: grid.slice(headerIndex + 1).map((row) => row ?? []),
      },
    };
  }

  return { kind: "unreadable", reason: `no table found; expected a tab called "${tab}"` };
}

function reportErrors(errors: readonly PackRowError[]): void {
  console.log("\nProblems that must be fixed before this pack can be loaded:\n");

  for (const error of errors) {
    const where = error.row > 0 ? `row ${error.row}` : "the sheet";
    console.log(`  ${error.sheet} / ${where} / ${error.column}`);
    console.log(`    ${error.message}`);
  }

  console.log(
    `\n${errors.length} problem${errors.length === 1 ? "" : "s"}. Nothing was written. Send these back to the client, or correct the pack and run again.`,
  );
}

function reportSection(title: string, items: readonly PlanItem<unknown>[]): void {
  const counts = countActions(items);

  console.log(`\n${title}: ${counts.create} to create, ${counts.update} to update`);

  for (const item of items) {
    console.log(`  ${item.action === "create" ? "+" : "~"} ${item.detail}`);
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  loadEnv();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    console.error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local. Neither value is printed by this script.",
    );
    process.exit(1);
  }

  const supabase = createClient<Database>(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // --- Resolve the tenant -------------------------------------------------
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(args.tenant);
  const { data: tenant } = await supabase
    .from("tenants")
    .select("id, name, slug")
    .eq(isUuid ? "id" : "slug", args.tenant)
    .maybeSingle<{ id: string; name: string; slug: string }>();

  if (!tenant) {
    console.error(`No tenant matching "${args.tenant}".`);
    process.exit(1);
  }

  console.log(`Tenant: ${tenant.name} (${tenant.slug})`);
  console.log(`Pack:   ${args.pack}`);
  console.log(args.apply ? "Mode:   APPLY, this will write" : "Mode:   preview only, nothing will be written");

  // --- Read and parse -----------------------------------------------------
  const reads = {
    employees: await readSheet(join(args.pack, SHEET_FILES.employees.file), SHEET_FILES.employees.tab),
    locations: await readSheet(join(args.pack, SHEET_FILES.locations.file), SHEET_FILES.locations.tab),
    equipment: await readSheet(join(args.pack, SHEET_FILES.equipment.file), SHEET_FILES.equipment.tab),
    certifications: await readSheet(join(args.pack, SHEET_FILES.certifications.file), SHEET_FILES.certifications.tab),
    contractedCompanies: await readSheet(
      join(args.pack, SHEET_FILES.contractedCompanies.file),
      SHEET_FILES.contractedCompanies.tab,
    ),
    contractedCompanyDocuments: await readSheet(
      join(args.pack, SHEET_FILES.contractedCompanyDocuments.file),
      SHEET_FILES.contractedCompanyDocuments.tab,
    ),
    contractedEquipment: await readSheet(
      join(args.pack, SHEET_FILES.contractedEquipment.file),
      SHEET_FILES.contractedEquipment.tab,
    ),
    contractedEquipmentCertifications: await readSheet(
      join(args.pack, SHEET_FILES.contractedEquipmentCertifications.file),
      SHEET_FILES.contractedEquipmentCertifications.tab,
    ),
    contractedDrivers: await readSheet(
      join(args.pack, SHEET_FILES.contractedDrivers.file),
      SHEET_FILES.contractedDrivers.tab,
    ),
    contractedDriverCertifications: await readSheet(
      join(args.pack, SHEET_FILES.contractedDriverCertifications.file),
      SHEET_FILES.contractedDriverCertifications.tab,
    ),
    unitCertifications: await readSheet(
      join(args.pack, SHEET_FILES.unitCertifications.file),
      SHEET_FILES.unitCertifications.tab,
    ),
  };

  // A sheet the client did not send is fine: a company with no trailers has no
  // unit certificates, and rejecting the pack over that would be wrong. A sheet
  // that is THERE and cannot be read is not fine, because the client believes
  // they sent it.
  const notSupplied: string[] = [];
  const unreadable: PackRowError[] = [];

  for (const [name, read] of Object.entries(reads) as [keyof typeof reads, SheetRead][]) {
    if (read.kind === "missing") {
      notSupplied.push(SHEET_FILES[name].file);
    } else if (read.kind === "unreadable") {
      unreadable.push({
        sheet: name,
        row: 0,
        column: SHEET_FILES[name].file,
        message: `${SHEET_FILES[name].file} is there but could not be read: ${read.reason}.`,
      });
    }
  }

  if (notSupplied.length > 0) {
    console.log(`
Not supplied, so skipped: ${notSupplied.join(", ")}`);
  }

  if (unreadable.length > 0) {
    reportErrors(unreadable);
    process.exit(1);
  }

  // Only sheets that were actually supplied are parsed. Parsing an absent sheet
  // as empty would report every one of its required columns as missing, which is
  // how a legitimate pack ends up rejected for what it correctly left out.
  const sheetOf = (read: SheetRead): RawSheet | null => (read.kind === "ok" ? read.sheet : null);
  const none = { rows: [], errors: [], skipped: 0 };

  const employeeSheet = sheetOf(reads.employees);
  const locationSheet = sheetOf(reads.locations);
  const equipmentSheet = sheetOf(reads.equipment);
  const certificationSheet = sheetOf(reads.certifications);
  const unitCertificationSheet = sheetOf(reads.unitCertifications);
  const contractedCompanySheet = sheetOf(reads.contractedCompanies);
  const contractedCompanyDocSheet = sheetOf(reads.contractedCompanyDocuments);
  const contractedEquipmentSheet = sheetOf(reads.contractedEquipment);
  const contractedEquipmentCertSheet = sheetOf(reads.contractedEquipmentCertifications);
  const contractedDriverSheet = sheetOf(reads.contractedDrivers);
  const contractedDriverCertSheet = sheetOf(reads.contractedDriverCertifications);

  const parsed = {
    employees: employeeSheet ? parseEmployees(employeeSheet) : { ...none, rows: [] as ReturnType<typeof parseEmployees>["rows"] },
    locations: locationSheet ? parseLocations(locationSheet) : { ...none, rows: [] as ReturnType<typeof parseLocations>["rows"] },
    equipment: equipmentSheet ? parseEquipment(equipmentSheet) : { ...none, rows: [] as ReturnType<typeof parseEquipment>["rows"] },
    certifications: certificationSheet
      ? parseCertifications(certificationSheet)
      : { ...none, rows: [] as ReturnType<typeof parseCertifications>["rows"] },
    unitCertifications: unitCertificationSheet
      ? parseUnitCertifications(unitCertificationSheet)
      : { ...none, rows: [] as ReturnType<typeof parseUnitCertifications>["rows"] },
    contractedCompanies: contractedCompanySheet
      ? parseContractedCompanies(contractedCompanySheet)
      : { ...none, rows: [] as ReturnType<typeof parseContractedCompanies>["rows"] },
    contractedCompanyDocuments: contractedCompanyDocSheet
      ? parseContractedCompanyDocuments(contractedCompanyDocSheet)
      : { ...none, rows: [] as ReturnType<typeof parseContractedCompanyDocuments>["rows"] },
    contractedEquipment: contractedEquipmentSheet
      ? parseContractedEquipment(contractedEquipmentSheet)
      : { ...none, rows: [] as ReturnType<typeof parseContractedEquipment>["rows"] },
    contractedEquipmentCertifications: contractedEquipmentCertSheet
      ? parseContractedEquipmentCertifications(contractedEquipmentCertSheet)
      : { ...none, rows: [] as ReturnType<typeof parseContractedEquipmentCertifications>["rows"] },
    contractedDrivers: contractedDriverSheet
      ? parseContractedDrivers(contractedDriverSheet)
      : { ...none, rows: [] as ReturnType<typeof parseContractedDrivers>["rows"] },
    contractedDriverCertifications: contractedDriverCertSheet
      ? parseContractedDriverCertifications(contractedDriverCertSheet)
      : { ...none, rows: [] as ReturnType<typeof parseContractedDriverCertifications>["rows"] },
  };

  // Certificates that have already lapsed stay on paper.
  //
  // The rollout draws a line: everything up to the cutover lives in the client's
  // filing cabinet, everything after it lives here, and a COR auditor is told exactly
  // that. Loading a dead certificate blurs the line and buys nothing -- it cannot
  // prove compliance, and it lands on the dashboard as an overdue item for a renewal
  // that was very likely done on paper months ago.
  //
  // Dropped loudly rather than silently: a row the client typed and we ignored has to
  // be visible, or the next question is why the app is missing an inspection.
  const today = new Date().toISOString().slice(0, 10);
  const expiredRows = parsed.unitCertifications.rows.filter(
    (row) => row.expiresOn !== null && row.expiresOn < today,
  );
  const expiredTickets = parsed.certifications.rows.filter(
    (row) => row.expiresOn !== null && row.expiresOn < today,
  );
  const expiredContractedUnitCerts = parsed.contractedEquipmentCertifications.rows.filter(
    (row) => row.expiresOn !== null && row.expiresOn < today,
  );
  const expiredContractedTickets = parsed.contractedDriverCertifications.rows.filter(
    (row) => row.expiresOn !== null && row.expiresOn < today,
  );

  if (
    !args.includeExpired &&
    (expiredRows.length > 0 ||
      expiredTickets.length > 0 ||
      expiredContractedUnitCerts.length > 0 ||
      expiredContractedTickets.length > 0)
  ) {
    console.log(
      `
Already expired, so NOT loaded (${
          expiredRows.length +
          expiredTickets.length +
          expiredContractedUnitCerts.length +
          expiredContractedTickets.length
        }). ` +
        "These stay in the paper file. Re-run with --include-expired to load them anyway:",
    );

    for (const row of expiredRows) {
      console.log(`  - row ${row.rowNumber}: ${row.unitNumber} ${row.certificationType}, expired ${row.expiresOn}`);
    }

    for (const row of expiredTickets) {
      console.log(`  - row ${row.rowNumber}: ${row.workerEmail} ${row.certificationType}, expired ${row.expiresOn}`);
    }

    parsed.unitCertifications.rows = parsed.unitCertifications.rows.filter(
      (row) => !(row.expiresOn !== null && row.expiresOn < today),
    );
    for (const row of expiredContractedUnitCerts) {
      console.log(
        `  - row ${row.rowNumber}: contracted unit ${row.unitNumber} ${row.certificationType}, expired ${row.expiresOn}`,
      );
    }

    for (const row of expiredContractedTickets) {
      console.log(
        `  - row ${row.rowNumber}: ${row.driverName} (${row.company}) ${row.certificationType}, expired ${row.expiresOn}`,
      );
    }

    parsed.certifications.rows = parsed.certifications.rows.filter(
      (row) => !(row.expiresOn !== null && row.expiresOn < today),
    );
    parsed.contractedEquipmentCertifications.rows = parsed.contractedEquipmentCertifications.rows.filter(
      (row) => !(row.expiresOn !== null && row.expiresOn < today),
    );
    parsed.contractedDriverCertifications.rows = parsed.contractedDriverCertifications.rows.filter(
      (row) => !(row.expiresOn !== null && row.expiresOn < today),
    );
  }

  const parseErrors = Object.values(parsed).flatMap((result) => result.errors);

  if (parseErrors.length > 0) {
    reportErrors(parseErrors);
    process.exit(1);
  }

  const skipped = Object.values(parsed).reduce((total, result) => total + result.skipped, 0);

  if (skipped > 0) {
    console.log(`
Skipped ${skipped} example or blank row${skipped === 1 ? "" : "s"}.`);
  }

  // --- Snapshot what the tenant already holds -----------------------------
  const [{ data: users }, { data: locations }, { data: equipment }, { data: certifications }, { data: unitDocs }, { data: profiles }] =
    await Promise.all([
      supabase.from("users").select("id, email, full_name").eq("tenant_id", tenant.id),
      supabase.from("locations").select("id, name, code").eq("tenant_id", tenant.id),
      supabase
        .from("equipment")
        .select("id, unit_number, vin_or_serial, license_plate, status")
        .eq("tenant_id", tenant.id)
        .is("deleted_at", null),
      supabase.from("certifications").select("id, name, worker_profile_id").eq("tenant_id", tenant.id),
      supabase
        .from("equipment_document")
        .select("id, equipment_id, title, doc_type")
        .eq("tenant_id", tenant.id)
        .eq("doc_type", "certification")
        .is("deleted_at", null),
      supabase.from("worker_profiles").select("id, user_id").eq("tenant_id", tenant.id),
    ]);

  const [
    { data: carriers },
    { data: contractedUnits },
    { data: contractedDriverRows },
    { data: contractedUnitDocs },
    { data: contractedTickets },
    { data: carrierDocs },
  ] = await Promise.all([
    supabase.from("subcontractor").select("id, legal_name").eq("tenant_id", tenant.id).is("deleted_at", null),
    supabase
      .from("contracted_equipment")
      .select("id, unit_number, subcontractor_id")
      .eq("tenant_id", tenant.id)
      .is("deleted_at", null),
    supabase
      .from("contracted_driver")
      .select("id, full_name, subcontractor_id")
      .eq("tenant_id", tenant.id)
      .is("deleted_at", null),
    supabase
      .from("contracted_equipment_document")
      .select("id, contracted_equipment_id, title, doc_type")
      .eq("tenant_id", tenant.id)
      .eq("doc_type", "certification")
      .is("deleted_at", null),
    supabase
      .from("contracted_driver_certification")
      .select("id, contracted_driver_id, name")
      .eq("tenant_id", tenant.id),
    supabase
      .from("subcontractor_document")
      .select("id, subcontractor_id, slot_key")
      .eq("tenant_id", tenant.id)
      .is("deleted_at", null),
  ]);

  const userIdByProfileId = new Map((profiles ?? []).map((profile) => [profile.id, profile.user_id]));

  const snapshot: TenantSnapshot = {
    users: users ?? [],
    locations: locations ?? [],
    equipment: equipment ?? [],
    certifications: (certifications ?? []).map((certification) => ({
      id: certification.id,
      userId: userIdByProfileId.get(certification.worker_profile_id) ?? "",
      name: certification.name,
    })),
    unitCertifications: (unitDocs ?? []).map((document) => ({
      id: document.id,
      equipmentId: document.equipment_id,
      label: document.title ?? "",
    })),
    subcontractors: (carriers ?? []).map((carrier) => ({ id: carrier.id, legalName: carrier.legal_name })),
    contractedCompanyDocuments: (carrierDocs ?? []).map((document) => ({
      id: document.id,
      subcontractorId: document.subcontractor_id,
      slotKey: document.slot_key,
    })),
    contractedEquipment: (contractedUnits ?? []).map((unit) => ({
      id: unit.id,
      unitNumber: unit.unit_number,
      subcontractorId: unit.subcontractor_id,
    })),
    contractedDrivers: (contractedDriverRows ?? []).map((driver) => ({
      id: driver.id,
      fullName: driver.full_name,
      subcontractorId: driver.subcontractor_id,
    })),
    contractedEquipmentCertifications: (contractedUnitDocs ?? []).map((document) => ({
      id: document.id,
      contractedEquipmentId: document.contracted_equipment_id,
      label: document.title ?? "",
    })),
    contractedDriverCertifications: (contractedTickets ?? []).map((ticket) => ({
      id: ticket.id,
      contractedDriverId: ticket.contracted_driver_id,
      label: ticket.name ?? "",
    })),
  };

  // --- Plan ----------------------------------------------------------------
  const employeePlan = planEmployees(parsed.employees.rows, snapshot);
  const locationPlan = planLocations(parsed.locations.rows, snapshot);
  const equipmentPlan = planEquipment(parsed.equipment.rows, snapshot);
  const certificationPlan = planCertifications(parsed.certifications.rows, snapshot, parsed.employees.rows);
  const unitCertificationPlan = planUnitCertifications(
    parsed.unitCertifications.rows,
    snapshot,
    parsed.equipment.rows,
  );

  const contractedCompanyPlan = planContractedCompanies(parsed.contractedCompanies.rows, snapshot);
  const contractedCompanyDocPlan = planContractedCompanyDocuments(
    parsed.contractedCompanyDocuments.rows,
    snapshot,
    parsed.contractedCompanies.rows,
  );
  const contractedEquipmentPlan = planContractedEquipment(
    parsed.contractedEquipment.rows,
    snapshot,
    parsed.contractedCompanies.rows,
  );
  const contractedEquipmentCertPlan = planContractedEquipmentCertifications(
    parsed.contractedEquipmentCertifications.rows,
    snapshot,
    parsed.contractedEquipment.rows,
  );
  const contractedDriverPlan = planContractedDrivers(
    parsed.contractedDrivers.rows,
    snapshot,
    parsed.contractedCompanies.rows,
  );
  const contractedDriverCertPlan = planContractedDriverCertifications(
    parsed.contractedDriverCertifications.rows,
    snapshot,
    parsed.contractedDrivers.rows,
  );

  const planErrors = [
    ...employeePlan.errors,
    ...locationPlan.errors,
    ...equipmentPlan.errors,
    ...certificationPlan.errors,
    ...unitCertificationPlan.errors,
    ...contractedCompanyPlan.errors,
    ...contractedCompanyDocPlan.errors,
    ...contractedEquipmentPlan.errors,
    ...contractedEquipmentCertPlan.errors,
    ...contractedDriverPlan.errors,
    ...contractedDriverCertPlan.errors,
  ];

  reportSection("Employees", employeePlan.items);
  reportSection("Locations", locationPlan.items);
  reportSection("Equipment", equipmentPlan.items);
  reportSection("Worker tickets", certificationPlan.items);
  reportSection("Unit certificates", unitCertificationPlan.items);
  reportSection("Contracted carriers", contractedCompanyPlan.items);
  reportSection("Contracted carrier documents", contractedCompanyDocPlan.items);
  reportSection("Contracted equipment", contractedEquipmentPlan.items);
  reportSection("Contracted unit certificates", contractedEquipmentCertPlan.items);
  reportSection("Contracted drivers", contractedDriverPlan.items);
  reportSection("Contracted driver tickets", contractedDriverCertPlan.items);

  if (planErrors.length > 0) {
    reportErrors(planErrors);
    process.exit(1);
  }

  if (!args.apply) {
    console.log("\nPreview only. Nothing was written. Re-run with --apply to load this pack.");
    return;
  }

  console.log("\nApplying...\n");

  // Order matters. People and units first, because tickets hang off them and a
  // ticket resolved against something created moments ago needs it to exist.
  const failures: string[] = [];
  // Accounts that exist but were never emailed. Tracked separately from failures
  // because the row DID load: the person is in the system and simply cannot get
  // in, which is the quiet version of a failure and the one that embarrasses us.

  const note = (line: string) => console.log(`  ${line}`);
  const fail = (what: string, message: string) => {
    failures.push(`${what}: ${message}`);
    console.error(`  ! ${what}: ${message}`);
  };

  const userIdByEmail = new Map(
    snapshot.users.filter((user) => user.email).map((user) => [user.email!.toLowerCase(), user.id] as const),
  );

  for (const item of employeePlan.items) {
    const result = await upsertEmployee(supabase, tenant, item);

    if (result.error) {
      fail(item.row.email, result.error);
      continue;
    }

    userIdByEmail.set(item.row.email, result.userId!);
    note(`${item.action === "create" ? "created" : "updated"} ${item.row.fullName}`);
  }

  for (const item of locationPlan.items) {
    const payload = {
      code: item.row.code,
      name: item.row.name,
      tenant_id: tenant.id,
      // The nearest thing the schema has to the sheet's active column.
      visibility_rule: item.row.active ? "all_workers" : "inactive",
    };

    const { error } = item.existingId
      ? await supabase.from("locations").update(payload).eq("id", item.existingId)
      : await supabase.from("locations").insert(payload);

    if (error) {
      fail(item.row.name, error.message);
      continue;
    }

    note(`${item.action === "create" ? "created" : "updated"} ${item.row.name}`);
  }

  const equipmentIdByUnit = new Map(
    snapshot.equipment.map((unit) => [unitKey(unit.unit_number), unit.id] as const),
  );

  for (const item of equipmentPlan.items) {
    const payload = {
      category: item.row.category,
      current_meter: item.row.meterReading,
      is_commercial: item.row.isCommercial,
      is_insulated: item.row.isInsulated,
      license_plate: item.row.plate,
      make: item.row.make,
      model: item.row.model,
      tank_spec: item.row.tankSpec,
      tenant_id: tenant.id,
      tracking_mode: item.row.trackingMode ?? "mileage",
      unit_number: item.row.unitNumber,
      vin_or_serial: item.row.vin,
      year: item.row.year,
    };

    const { data, error } = item.existingId
      ? await supabase.from("equipment").update(payload).eq("id", item.existingId).select("id").maybeSingle()
      : await supabase.from("equipment").insert(payload).select("id").maybeSingle();

    if (error || !data?.id) {
      fail(item.row.unitNumber, error?.message ?? "no row was written");
      continue;
    }

    equipmentIdByUnit.set(unitKey(item.row.unitNumber), data.id);

    // The unit's inspection list, when the sheet named one. A blank column is left
    // alone rather than written as an empty list: "nobody filled this in" has to keep
    // falling back to the tenant's defaults, or every pack that predates this column
    // would silently strip every unit down to no inspections at all.
    if (item.row.inspections.length > 0) {
      const requirementError = await setUnitRequirements(supabase, {
        tenantId: tenant.id,
        equipmentId: data.id,
        inspectionNames: item.row.inspections,
      });

      if (requirementError) {
        fail(item.row.unitNumber, requirementError);
      }
    }

    // The three fixed compliance files, written as equipment_document rows so
    // they age, warn and reach the needs-document chase list exactly like one
    // entered by hand. They arrive as dates with no scan, which is precisely the
    // amber "No document" state the watcher exists to surface.
    for (const [docType, expiry] of [
      ["cvip", item.row.cvipExpiry],
      ["registration", item.row.registrationExpiry],
      ["insurance", item.row.insuranceExpiry],
    ] as const) {
      if (!expiry) {
        continue;
      }

      const documentError = await upsertEquipmentDocument(supabase, {
        tenantId: tenant.id,
        equipmentId: data.id,
        docType,
        title: null,
        expiryDate: expiry,
      });

      if (documentError) {
        fail(`${item.row.unitNumber} ${docType}`, documentError);
      }
    }

    note(`${item.action === "create" ? "created" : "updated"} ${item.row.unitNumber}`);
  }

  const { data: refreshedProfiles } = await supabase
    .from("worker_profiles")
    .select("id, user_id")
    .eq("tenant_id", tenant.id);
  const profileIdByUserId = new Map((refreshedProfiles ?? []).map((profile) => [profile.user_id, profile.id] as const));

  for (const item of certificationPlan.items) {
    const userId = item.row.workerId || userIdByEmail.get(item.row.workerEmail);
    const profileId = userId ? profileIdByUserId.get(userId) : undefined;

    if (!profileId) {
      fail(item.row.certificationType, `no worker profile for ${item.row.workerEmail}`);
      continue;
    }

    const payload = {
      expires_on: item.row.expiresOn,
      issued_on: item.row.issuedOn,
      name: item.row.certificationType,
      tenant_id: tenant.id,
      worker_profile_id: profileId,
    };

    const { error } = item.existingId
      ? await supabase.from("certifications").update(payload).eq("id", item.existingId)
      : await supabase.from("certifications").insert(payload);

    if (error) {
      fail(`${item.row.workerEmail} ${item.row.certificationType}`, error.message);
      continue;
    }

    note(`${item.action === "create" ? "created" : "updated"} ${item.row.certificationType} for ${item.row.workerEmail}`);
  }

  // Unit certificates are matched against the tenant's certification type list,
  // never added to it. Every type on that list is expected on EVERY vehicle and
  // trailer, so adding one because a single trailer carries it would report the
  // whole fleet deficient for a certificate most of it will never need. Anything
  // unmatched is filed as free text, which still shows on the unit and still ages.
  const { data: types } = await supabase
    .from("equipment_certification_types")
    .select("id, name")
    .eq("tenant_id", tenant.id);
  const typeIdByName = new Map((types ?? []).map((type) => [unitKey(type.name), type.id] as const));

  for (const item of unitCertificationPlan.items) {
    const equipmentId = item.row.equipmentId || equipmentIdByUnit.get(unitKey(item.row.unitNumber));

    if (!equipmentId) {
      fail(item.row.certificationType, `no unit called ${item.row.unitNumber}`);
      continue;
    }

    // A tank trailer carries four product hoses, each with its own serial and its
    // own annual expiry. The title is what both the planner and upsertEquipmentDocument
    // match on, so without the serial in it all four collapse into one row and three
    // expiries are lost. Shared with the planner so the two cannot drift apart.
    const title = unitCertificationTitle(item.row.certificationType, item.row.componentId);

    const documentError = await upsertEquipmentDocument(supabase, {
      tenantId: tenant.id,
      equipmentId,
      docType: "certification",
      title,
      expiryDate: item.row.expiresOn,
      issuedDate: item.row.issuedOn,
      certificationTypeId: typeIdByName.get(unitKey(item.row.certificationType)) ?? null,
      existingId: item.existingId,
    });

    if (documentError) {
      fail(`${item.row.unitNumber} ${item.row.certificationType}`, documentError);
      continue;
    }

    note(`${item.action === "create" ? "created" : "updated"} ${title} on ${item.row.unitNumber}`);
  }

  // --- The contracted side -------------------------------------------------
  //
  // Carriers first, then their units and drivers, then the certificates that hang off
  // those. Same ordering rule as the fleet: a record resolved against something created
  // moments ago needs it to exist by then.

  const carrierIdByName = new Map(
    snapshot.subcontractors.map((carrier) => [unitKey(carrier.legalName), carrier.id] as const),
  );

  for (const item of contractedCompanyPlan.items) {
    const payload = {
      tenant_id: tenant.id,
      legal_name: item.row.legalName,
      operating_name: item.row.operatingName,
      contact_name: item.row.contactName,
      contact_email: item.row.contactEmail,
      contact_phone: item.row.contactPhone,
      nsc_number: item.row.nscNumber,
      wcb_account_number: item.row.wcbAccountNumber,
      cra_business_number: item.row.craBusinessNumber,
      notes: item.row.notes,
    };

    const { data, error } = item.existingId
      ? await supabase.from("subcontractor").update(payload).eq("id", item.existingId).select("id").maybeSingle()
      : await supabase.from("subcontractor").insert(payload).select("id").maybeSingle();

    if (error || !data) {
      fail(item.row.legalName, error?.message ?? "carrier was not saved");
      continue;
    }

    carrierIdByName.set(unitKey(item.row.legalName), data.id);
    note(`${item.action === "create" ? "created" : "updated"} carrier ${item.row.legalName}`);
  }

  for (const item of contractedCompanyDocPlan.items) {
    const carrierId = item.row.subcontractorId || carrierIdByName.get(unitKey(item.row.company));

    if (!carrierId) {
      fail(item.row.slotKey, `no carrier called ${item.row.company}`);
      continue;
    }

    const slot = getSubcontractorSlot(item.row.slotKey);

    // The slot list is owned by code, so an unknown key is a converter bug rather
    // than a client typo, and filing it anyway would create a document no screen
    // renders.
    if (!slot) {
      fail(`${item.row.company} ${item.row.slotKey}`, "not a known requirement slot");
      continue;
    }

    const write = buildSubcontractorDocumentWrite(slot, {
      additionalInsured: null,
      coverageAmount: null,
      deductibleAmount: null,
      documentNumber: item.row.documentNumber,
      expiryDate: item.row.expiresOn,
      fields: {},
      insurer: null,
      issuedDate: item.row.issuedOn,
      reminderLeadDays: null,
      storagePath: null,
      title: null,
    });

    const payload = {
      ...write,
      tenant_id: tenant.id,
      subcontractor_id: carrierId,
      // Loaded from the client's own tracking sheet, which is where these dates were
      // already being kept, so they are taken as reviewed rather than left pending
      // for somebody to approve a second time.
      review_status: "approved" as const,
    };

    const { error } = item.existingId
      ? await supabase.from("subcontractor_document").update(payload).eq("id", item.existingId)
      : await supabase.from("subcontractor_document").insert(payload);

    if (error) {
      fail(`${item.row.company} ${item.row.slotKey}`, error.message);
      continue;
    }

    note(`${item.action === "create" ? "created" : "updated"} ${slot.label} for ${item.row.company}`);
  }

  const contractedIdByUnit = new Map(
    snapshot.contractedEquipment.map((unit) => [unitKey(unit.unitNumber), unit.id] as const),
  );

  for (const item of contractedEquipmentPlan.items) {
    const carrierId = item.row.subcontractorId || carrierIdByName.get(unitKey(item.row.company));

    if (!carrierId) {
      fail(item.row.unitNumber, `no carrier called ${item.row.company}`);
      continue;
    }

    const payload = {
      tenant_id: tenant.id,
      subcontractor_id: carrierId,
      unit_number: item.row.unitNumber,
      // Contracted units are tractors in this phase. The column exists for trailers
      // later, but nothing in these sheets is one.
      category: "vehicle" as const,
      owner_name: item.row.ownerName,
      year: item.row.year,
      make: item.row.make,
      model_or_colour: item.row.modelOrColour,
      vin_or_serial: item.row.vin,
      license_plate: item.row.plate,
      registration_province: item.row.registrationProvince,
      status: item.row.status,
      notes: item.row.notes,
    };

    const { data, error } = item.existingId
      ? await supabase
          .from("contracted_equipment")
          .update(payload)
          .eq("id", item.existingId)
          .select("id")
          .maybeSingle()
      : await supabase.from("contracted_equipment").insert(payload).select("id").maybeSingle();

    if (error || !data) {
      fail(item.row.unitNumber, error?.message ?? "unit was not saved");
      continue;
    }

    contractedIdByUnit.set(unitKey(item.row.unitNumber), data.id);

    // The three fixed files, written straight from the columns, exactly as the fleet
    // loader does. A null expiry is stored as null rather than skipped: the contracted
    // document table allows it, and "on file, no expiry tracked" is a real answer.
    for (const [docType, expiry] of [
      ["cvip", item.row.cvipExpiry],
      ["registration", item.row.registrationExpiry],
      ["insurance", item.row.insuranceExpiry],
    ] as const) {
      if (!expiry) {
        continue;
      }

      const documentError = await upsertContractedDocument(supabase, {
        tenantId: tenant.id,
        contractedEquipmentId: data.id,
        docType,
        title: null,
        expiryDate: expiry,
      });

      if (documentError) {
        fail(`${item.row.unitNumber} ${docType}`, documentError);
      }
    }

    if (item.row.inspections.length > 0) {
      const requirementError = await setContractedUnitRequirements(supabase, {
        tenantId: tenant.id,
        contractedEquipmentId: data.id,
        inspectionNames: item.row.inspections,
      });

      if (requirementError) {
        fail(`${item.row.unitNumber} inspections`, requirementError);
      }
    }

    note(`${item.action === "create" ? "created" : "updated"} contracted unit ${item.row.unitNumber}`);
  }

  for (const item of contractedEquipmentCertPlan.items) {
    const unitId = item.row.contractedEquipmentId || contractedIdByUnit.get(unitKey(item.row.unitNumber));

    if (!unitId) {
      fail(item.row.certificationType, `no contracted unit called ${item.row.unitNumber}`);
      continue;
    }

    // Same title rule as the fleet: a tractor carries a primary and a spare product
    // hose, and two extinguishers of different sizes, and the component is what stops
    // the second overwriting the first.
    const certTitle = unitCertificationTitle(item.row.certificationType, item.row.componentId);

    const documentError = await upsertContractedDocument(supabase, {
      tenantId: tenant.id,
      contractedEquipmentId: unitId,
      docType: "certification",
      title: certTitle,
      expiryDate: item.row.expiresOn,
      issuedDate: item.row.issuedOn,
      certificationTypeId: typeIdByName.get(unitKey(item.row.certificationType)) ?? null,
      existingId: item.existingId,
    });

    if (documentError) {
      fail(`${item.row.unitNumber} ${item.row.certificationType}`, documentError);
      continue;
    }

    note(`${item.action === "create" ? "created" : "updated"} ${certTitle} on ${item.row.unitNumber}`);
  }

  const contractedDriverIdByKey = new Map(
    snapshot.contractedDrivers.map(
      (driver) => [`${driver.subcontractorId}|${unitKey(driver.fullName)}`, driver.id] as const,
    ),
  );

  for (const item of contractedDriverPlan.items) {
    const carrierId = item.row.subcontractorId || carrierIdByName.get(unitKey(item.row.company));

    if (!carrierId) {
      fail(item.row.fullName, `no carrier called ${item.row.company}`);
      continue;
    }

    // The truck they are in, if the sheet named one and it belongs to this carrier.
    // A unit that belongs to somebody else is left unassigned rather than linked, and
    // said so, because parking a driver in another company's truck is worse than
    // leaving the field blank.
    let unitId: string | null = null;

    if (item.row.unitNumber) {
      const candidate = contractedIdByUnit.get(unitKey(item.row.unitNumber));

      if (candidate) {
        const { data: owned } = await supabase
          .from("contracted_equipment")
          .select("id")
          .eq("id", candidate)
          .eq("subcontractor_id", carrierId)
          .maybeSingle();

        unitId = owned?.id ?? null;

        if (!unitId) {
          note(`  ${item.row.fullName}: unit ${item.row.unitNumber} belongs to another carrier, left unassigned`);
        }
      } else {
        note(`  ${item.row.fullName}: no contracted unit ${item.row.unitNumber}, left unassigned`);
      }
    }

    const payload = {
      tenant_id: tenant.id,
      subcontractor_id: carrierId,
      full_name: item.row.fullName,
      contracted_equipment_id: unitId,
      license_province: item.row.licenseProvince,
      license_expiry: item.row.licenseExpiry,
      abstract_issued: item.row.abstractIssued,
      abstract_expiry: item.row.abstractExpiry,
      cso_completed: item.row.csoCompleted,
      driver_type: item.row.driverType,
      status: item.row.status,
      notes: item.row.notes,
    };

    const { data, error } = item.existingId
      ? await supabase.from("contracted_driver").update(payload).eq("id", item.existingId).select("id").maybeSingle()
      : await supabase.from("contracted_driver").insert(payload).select("id").maybeSingle();

    if (error || !data) {
      fail(item.row.fullName, error?.message ?? "driver was not saved");
      continue;
    }

    contractedDriverIdByKey.set(`${carrierId}|${unitKey(item.row.fullName)}`, data.id);
    note(`${item.action === "create" ? "created" : "updated"} contracted driver ${item.row.fullName}`);
  }

  // Driver ticket, orientation and badge types come from the tenant's shared list.
  // Unknown names are refused unless --create-types is passed, for the same reason the
  // fleet refuses them: a typo in one row of a hundred quietly becomes a type that then
  // reads as missing on everybody else.
  const { data: driverTypes } = await supabase
    .from("certification_types")
    .select("id, name, category")
    .eq("tenant_id", tenant.id);
  const driverTypeIdByName = new Map((driverTypes ?? []).map((type) => [unitKey(type.name), type.id] as const));

  const unknownDriverTypes = new Map<string, { name: string; category: CertificationCategory }>();

  for (const item of contractedDriverCertPlan.items) {
    const key = unitKey(item.row.certificationType);

    if (!driverTypeIdByName.has(key)) {
      unknownDriverTypes.set(key, { name: item.row.certificationType, category: item.row.category });
    }
  }

  if (unknownDriverTypes.size > 0) {
    if (!args.createTypes) {
      console.error(
        `\n! ${unknownDriverTypes.size} certification type${unknownDriverTypes.size === 1 ? " is" : "s are"} not on the tenant's list:`,
      );

      for (const entry of unknownDriverTypes.values()) {
        console.error(`  - ${entry.name} (${entry.category})`);
      }

      console.error(
        "\nAdd them under Admin > Certification Types, or re-run with --create-types to add them as they load.",
      );
      process.exit(1);
    }

    const { data: created, error: createError } = await supabase
      .from("certification_types")
      .insert(
        [...unknownDriverTypes.values()].map((entry) => ({
          tenant_id: tenant.id,
          name: entry.name,
          category: entry.category,
          expires: true,
        })),
      )
      .select("id, name");

    if (createError) {
      fail("certification types", createError.message);
    }

    for (const type of created ?? []) {
      driverTypeIdByName.set(unitKey(type.name), type.id);
      note(`created certification type ${type.name}`);
    }
  }

  for (const item of contractedDriverCertPlan.items) {
    const carrierId = carrierIdByName.get(unitKey(item.row.company));
    const driverId =
      item.row.contractedDriverId ||
      (carrierId ? contractedDriverIdByKey.get(`${carrierId}|${unitKey(item.row.driverName)}`) : undefined);

    if (!driverId) {
      fail(item.row.certificationType, `no driver called ${item.row.driverName} at ${item.row.company}`);
      continue;
    }

    const payload = {
      tenant_id: tenant.id,
      contracted_driver_id: driverId,
      certification_type_id: driverTypeIdByName.get(unitKey(item.row.certificationType)) ?? null,
      name: item.row.certificationType,
      issued_on: item.row.issuedOn,
      expires_on: item.row.expiresOn,
      issuing_company: item.row.issuingCompany,
      detail: item.row.detail,
    };

    const { error } = item.existingId
      ? await supabase.from("contracted_driver_certification").update(payload).eq("id", item.existingId)
      : await supabase.from("contracted_driver_certification").insert(payload);

    if (error) {
      fail(`${item.row.driverName} ${item.row.certificationType}`, error.message);
      continue;
    }

    note(
      `${item.action === "create" ? "created" : "updated"} ${item.row.certificationType} for ${item.row.driverName}`,
    );
  }

  console.log(
    failures.length === 0
      ? "\nLoaded. Re-run without --apply at any time to see the pack against the tenant."
      : `\nLoaded with ${failures.length} failure${failures.length === 1 ? "" : "s"}. Fix and run again; re-running updates rather than duplicating.`,
  );

  // Said every run, because it is the difference between this load and the ones
  // before it. Nobody has been emailed and nobody can sign in yet, and that is
  // now the intended end state rather than a fault to chase.
  if (employeePlan.items.length > 0) {
    console.log(
      "\nNo invitations were sent. Everyone loaded here has an account and cannot sign in yet. " +
        'When the company is ready for them, tick the workers in Admin > Workers and press "Send invitations".',
    );
  }

  if (failures.length > 0) {
    process.exitCode = 1;
  }
}

type SupabaseAdmin = ReturnType<typeof createClient<Database>>;

/** The same loose matching the duplicate check uses, so keys agree across the app. */
/**
 * Replace the inspections one unit is held to, by name.
 *
 * Names are matched against the tenant's certification type list and never added to
 * it, the same rule the certificate loader follows: the type list is fleet-wide
 * policy, and a typo in one row of a hundred and fifty must not quietly become a new
 * inspection that then reads as missing on every other unit. An unmatched name is
 * reported so somebody fixes either the sheet or the list.
 */
async function setUnitRequirements(
  supabase: SupabaseAdmin,
  input: { tenantId: string; equipmentId: string; inspectionNames: readonly string[] },
): Promise<string | null> {
  const { data: types, error: typesError } = await supabase
    .from("equipment_certification_types")
    .select("id, name")
    .eq("tenant_id", input.tenantId);

  if (typesError) {
    return typesError.message;
  }

  const idByName = new Map((types ?? []).map((type) => [unitKey(type.name), type.id] as const));
  const wanted: string[] = [];
  const unknown: string[] = [];

  for (const name of input.inspectionNames) {
    const id = idByName.get(unitKey(name));

    if (id) {
      wanted.push(id);
      continue;
    }

    unknown.push(name);
  }

  if (unknown.length > 0) {
    return `not on the certification type list: ${unknown.join(", ")}. Add them in Admin > Equipment > Vehicle Certification Types, or correct the spelling in the sheet.`;
  }

  const { error: clearError } = await supabase
    .from("equipment_certification_requirement")
    .delete()
    .eq("tenant_id", input.tenantId)
    .eq("equipment_id", input.equipmentId);

  if (clearError) {
    return clearError.message;
  }

  const unique = [...new Set(wanted)];

  if (unique.length === 0) {
    return null;
  }

  const { error: insertError } = await supabase.from("equipment_certification_requirement").insert(
    unique.map((certificationTypeId) => ({
      certification_type_id: certificationTypeId,
      equipment_id: input.equipmentId,
      tenant_id: input.tenantId,
    })),
  );

  return insertError?.message ?? null;
}

function unitKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * One compliance document on a unit, matched on its type so a re-run renews it
 * rather than stacking a second copy beside it.
 */
async function upsertEquipmentDocument(
  supabase: SupabaseAdmin,
  input: {
    tenantId: string;
    equipmentId: string;
    docType: "cvip" | "registration" | "insurance" | "certification";
    title: string | null;
    expiryDate: string | null;
    issuedDate?: string | null;
    certificationTypeId?: string | null;
    existingId?: string;
  },
): Promise<string | null> {
  // Titles are required, and rightly so: an untitled document renders as
  // "Equipment document" everywhere it appears. The fixed files get the name a
  // driver would call them by.
  const FIXED_TITLES = {
    cvip: "CVIP inspection",
    registration: "Registration",
    insurance: "Insurance",
    certification: "Certification",
  } as const;

  // The generated insert types treat these as omit-or-value rather than
  // nullable, so a blank cell has to become an absent key, not an explicit null.
  const payload = {
    doc_type: input.docType,
    equipment_id: input.equipmentId,
    is_active: true,
    tenant_id: input.tenantId,
    title: input.title ?? FIXED_TITLES[input.docType],
    ...(input.expiryDate ? { expiry_date: input.expiryDate } : {}),
    ...(input.issuedDate ? { issued_date: input.issuedDate } : {}),
    ...(input.certificationTypeId ? { certification_type_id: input.certificationTypeId } : {}),
  };

  let targetId = input.existingId;

  if (!targetId) {
    // The fixed files are one per unit, so an existing row of the same type is
    // the one being renewed rather than a second document.
    const query = supabase
      .from("equipment_document")
      .select("id")
      .eq("tenant_id", input.tenantId)
      .eq("equipment_id", input.equipmentId)
      .eq("doc_type", input.docType)
      .is("deleted_at", null);

    const { data } = input.title ? await query.eq("title", input.title).maybeSingle() : await query.maybeSingle();
    targetId = data?.id;
  }

  if (targetId) {
    const { error } = await supabase.from("equipment_document").update(payload).eq("id", targetId);
    return error?.message ?? null;
  }

  // equipment_document.expiry_date is nullable in the schema but the generated
  // Insert type marks it required, so an insert has to name it explicitly. Some
  // certificates genuinely never expire, and null is the honest value for those:
  // inventing a date would create a compliance record that lies.
  const { error } = await supabase
    .from("equipment_document")
    .insert({ ...payload, expiry_date: input.expiryDate } as never);

  return error?.message ?? null;
}

/**
 * Create or update one employee.
 *
 * Follows the exact sequence createWorker uses in src/app/admin/actions.ts,
 * because creating an auth user fires the signup trigger, which provisions its
 * own bootstrap tenant for that user. That tenant has to be deleted afterwards
 * or every employee loaded leaves an orphan behind.
 */
async function upsertEmployee(
  supabase: SupabaseAdmin,
  tenant: { id: string; name: string },
  item: PlanItem<{
    fullName: string;
    email: string;
    jobTitle: string | null;
    phone: string | null;
    powerLevel: Database["public"]["Enums"]["power_level"];
  }>,
): Promise<{ userId?: string; error?: string }> {
  const { createWorkerAccount } = await import("../src/lib/worker-invite");

  let userId = item.existingId;

  if (!userId) {
    // Accounts only, no email. A pack load creates more people at once, and
    // further ahead of anyone being ready to use the app, than anything else in
    // this system, so it is the last place that should be putting invitations in
    // inboxes. The company sends them from the workers list when the time comes.
    const account = await createWorkerAccount(supabase, {
      companyName: tenant.name,
      email: item.row.email,
      fullName: item.row.fullName,
      tenantId: tenant.id,
    });

    if (!account.ok) {
      return { error: account.error };
    }

    userId = account.user.id;
  }

  const { data: bootstrap } = await supabase
    .from("users")
    .select("tenant_id")
    .eq("id", userId)
    .maybeSingle<{ tenant_id: string }>();

  const { error: userError } = await supabase.from("users").upsert(
    {
      app_access: item.row.powerLevel === "worker" ? "app_access" : "admin_access",
      email: item.row.email,
      full_name: item.row.fullName,
      id: userId,
      power_level: item.row.powerLevel,
      tenant_id: tenant.id,
    },
    { onConflict: "id" },
  );

  if (userError) {
    return { error: userError.message };
  }

  const { error: profileError } = await supabase.from("worker_profiles").upsert(
    { phone: item.row.phone, tenant_id: tenant.id, title: item.row.jobTitle, user_id: userId },
    { onConflict: "tenant_id,user_id" },
  );

  if (profileError) {
    return { error: profileError.message };
  }

  if (bootstrap?.tenant_id && bootstrap.tenant_id !== tenant.id) {
    await supabase.from("tenants").delete().eq("id", bootstrap.tenant_id);
  }

  return { userId };
}

/**
 * Replace the inspections one CONTRACTED unit is held to, by name.
 *
 * Same rule as the fleet's own units: names are matched against the tenant's list and
 * never added to it. The list is fleet-wide policy, and a typo in one row of seventy
 * must not become a new inspection that then reads as missing on every other unit.
 */
async function setContractedUnitRequirements(
  supabase: SupabaseAdmin,
  input: { tenantId: string; contractedEquipmentId: string; inspectionNames: readonly string[] },
): Promise<string | null> {
  const { data: types, error: typesError } = await supabase
    .from("equipment_certification_types")
    .select("id, name")
    .eq("tenant_id", input.tenantId);

  if (typesError) {
    return typesError.message;
  }

  const idByName = new Map((types ?? []).map((type) => [unitKey(type.name), type.id] as const));
  const wanted: string[] = [];
  const unknown: string[] = [];

  for (const name of input.inspectionNames) {
    const id = idByName.get(unitKey(name));

    if (id) {
      wanted.push(id);
      continue;
    }

    unknown.push(name);
  }

  if (unknown.length > 0) {
    return `not on the certification type list: ${unknown.join(", ")}. Add them in Admin > Equipment > Vehicle Certification Types, or correct the spelling in the sheet.`;
  }

  const { error: clearError } = await supabase
    .from("contracted_equipment_certification_requirement")
    .delete()
    .eq("tenant_id", input.tenantId)
    .eq("contracted_equipment_id", input.contractedEquipmentId);

  if (clearError) {
    return clearError.message;
  }

  const unique = [...new Set(wanted)];

  if (unique.length === 0) {
    return null;
  }

  const { error: insertError } = await supabase
    .from("contracted_equipment_certification_requirement")
    .insert(
      unique.map((certificationTypeId) => ({
        certification_type_id: certificationTypeId,
        contracted_equipment_id: input.contractedEquipmentId,
        tenant_id: input.tenantId,
      })),
    );

  return insertError?.message ?? null;
}

/**
 * One compliance document on a contracted unit, matched on its title so a re-run renews
 * it rather than stacking a second copy beside it.
 *
 * Unlike the fleet's version, a null expiry is stored rather than refused. The
 * contracted document table allows it deliberately: a fire extinguisher tag carrying a
 * serial and no printed date is a real certificate, and the fleet's not-null column
 * silently rejected 52 of them.
 */
async function upsertContractedDocument(
  supabase: SupabaseAdmin,
  input: {
    tenantId: string;
    contractedEquipmentId: string;
    docType: "cvip" | "registration" | "insurance" | "certification";
    title: string | null;
    expiryDate: string | null;
    issuedDate?: string | null;
    certificationTypeId?: string | null;
    existingId?: string;
  },
): Promise<string | null> {
  const FIXED_TITLES = {
    cvip: "CVIP inspection",
    registration: "Registration",
    insurance: "Insurance",
    certification: "Certification",
  } as const;

  const title = input.title?.trim() || FIXED_TITLES[input.docType];

  const payload = {
    tenant_id: input.tenantId,
    contracted_equipment_id: input.contractedEquipmentId,
    doc_type: input.docType,
    title,
    expiry_date: input.expiryDate,
    issued_date: input.issuedDate ?? null,
    certification_type_id: input.certificationTypeId ?? null,
  };

  if (input.existingId) {
    const { error } = await supabase
      .from("contracted_equipment_document")
      .update(payload)
      .eq("id", input.existingId);

    return error?.message ?? null;
  }

  // Match on title within the unit, which is what the planner matched on too. Two
  // copies of one certificate is the failure this prevents.
  const { data: existing } = await supabase
    .from("contracted_equipment_document")
    .select("id")
    .eq("tenant_id", input.tenantId)
    .eq("contracted_equipment_id", input.contractedEquipmentId)
    .eq("doc_type", input.docType)
    .eq("title", title)
    .is("deleted_at", null)
    .maybeSingle();

  const { error } = existing
    ? await supabase.from("contracted_equipment_document").update(payload).eq("id", existing.id)
    : await supabase.from("contracted_equipment_document").insert(payload);

  return error?.message ?? null;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
