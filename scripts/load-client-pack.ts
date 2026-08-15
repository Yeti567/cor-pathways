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
  parseUnitCertifications,
  type RawSheet,
} from "../src/lib/client-pack/parse";
import {
  countActions,
  planCertifications,
  planEmployees,
  planEquipment,
  planLocations,
  planUnitCertifications,
  type PlanItem,
  type TenantSnapshot,
} from "../src/lib/client-pack/plan";
import type { PackRowError } from "../src/lib/client-pack/schema";
import type { Database } from "../src/types/database";

type Args = { pack: string; tenant: string; apply: boolean };

function parseArgs(argv: string[]): Args {
  const get = (name: string) => {
    const index = argv.indexOf(`--${name}`);
    return index === -1 ? undefined : argv[index + 1];
  };

  const pack = get("pack");
  const tenant = get("tenant");

  if (!pack || !tenant) {
    console.error("Usage: --pack <folder> --tenant <slug|uuid> [--apply]");
    process.exit(1);
  }

  return { pack, tenant, apply: argv.includes("--apply") };
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
      grid[rowNumber - 1] = Array.isArray(values) ? values.slice(1) : [];
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
  };

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

  const planErrors = [
    ...employeePlan.errors,
    ...locationPlan.errors,
    ...equipmentPlan.errors,
    ...certificationPlan.errors,
    ...unitCertificationPlan.errors,
  ];

  reportSection("Employees", employeePlan.items);
  reportSection("Locations", locationPlan.items);
  reportSection("Equipment", equipmentPlan.items);
  reportSection("Worker tickets", certificationPlan.items);
  reportSection("Unit certificates", unitCertificationPlan.items);

  if (planErrors.length > 0) {
    reportErrors(planErrors);
    process.exit(1);
  }

  if (!args.apply) {
    console.log("\nPreview only. Nothing was written. Re-run with --apply to load this pack.");
    return;
  }

  // Employees are the only sheet whose write path is finished. Applying anyway
  // would load one sheet in five while reporting success, which is exactly the
  // half-loaded client this script exists to prevent, so it refuses instead.
  //
  // Two things to settle before the rest are written:
  //   - locations has no address or type column, but the sheet asks for both.
  //   - equipment expiry dates need to become equipment_document rows, which is
  //     also what puts them on the needs-document chase list.
  console.error(
    [
      "",
      "--apply is not available yet. Only the Employees write path is finished,",
      "and loading one sheet of five while reporting success is the half-loaded",
      "client this script exists to prevent.",
      "",
      "The preview above is complete and accurate for all five sheets, so it can",
      "still be used to check the pack with the client.",
    ].join("\n"),
  );
  process.exit(1);
}

/*
 * When the write paths are finished, employees must follow the exact sequence in
 * createWorker (src/app/admin/actions.ts): invite, read back the users row, upsert
 * it onto the right tenant, upsert worker_profiles, then DELETE the bootstrap
 * tenant the signup trigger created for that auth user. Skipping that last step
 * leaves an orphan tenant behind for every employee loaded.
 */

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
