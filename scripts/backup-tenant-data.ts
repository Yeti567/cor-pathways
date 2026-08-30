// A restore point for one tenant's data, written to a local file.
//
// WHY THIS EXISTS. A Supabase project on the free plan has no daily backups and no
// point-in-time recovery. A client whose whole compliance record lives in one such
// project has no restore path at all: a bad migration, a dropped table or a deleted
// project takes it with nothing to go back to.
//
// WHAT THIS DOES AND DOES NOT COVER. The SCHEMA is already safe -- it lives in
// supabase/migrations and is committed to git. What has no copy is the DATA, so that is
// what this exports: every row of every tenant-scoped table, as JSON, one file per table.
// Restoring means re-running the migrations and then re-inserting these rows.
//
// This is a stopgap, not a backup strategy. It runs when somebody runs it, it lands on
// one machine, and that machine is itself unbacked. It protects against an accident
// inside the database, which is the likeliest way this data disappears. It does not
// protect against losing the laptop. The real fix is the Pro plan.
//
// THE OUTPUT IS PII. Employee and contractor names, licence expiries, tickets. It must
// stay in a local folder outside the repo, never OneDrive, never a cloud folder, and it
// should be deleted once a real backup exists. The default is ~/tenant-backups.
//
// Usage:
//   npx tsx scripts/backup-tenant-data.ts --tenant <uuid> [--out <folder>]

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../src/types/database";

/**
 * Minimal .env.local reader, matching load-client-pack.ts.
 *
 * Deliberately not a dependency, and deliberately never echoes a value. The only thing
 * this script says about a secret is whether it was found.
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

type Args = { tenant: string; out: string };

function parseArgs(argv: string[]): Args {
  const read = (flag: string) => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : undefined;
  };

  const tenant = read("--tenant");

  if (!tenant) {
    console.error("Usage: npx tsx scripts/backup-tenant-data.ts --tenant <uuid> [--out <folder>]");
    process.exit(1);
  }

  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");

  return { tenant, out: read("--out") ?? join(homedir(), "tenant-backups", `tenant-${stamp}`) };
}

/**
 * Read every row, not the first thousand.
 *
 * PostgREST caps a select at 1000 rows and returns that page with no error. A backup that
 * silently stops at a thousand rows is worse than no backup, because it looks like one.
 */
async function readAll(
  supabase: ReturnType<typeof createClient<Database>>,
  table: string,
  tenantId: string,
): Promise<Record<string, unknown>[]> {
  const PAGE = 1000;
  const rows: Record<string, unknown>[] = [];

  for (let page = 0; ; page += 1) {
    const from = page * PAGE;
    const { data, error } = await supabase
      .from(table as never)
      .select("*")
      .eq("tenant_id", tenantId)
      .range(from, from + PAGE - 1);

    if (error) {
      throw new Error(`${table}: ${error.message}`);
    }

    const batch = (data ?? []) as Record<string, unknown>[];
    rows.push(...batch);

    if (batch.length < PAGE) {
      return rows;
    }
  }
}

async function main(): Promise<void> {
  loadEnv();

  const args = parseArgs(process.argv.slice(2));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be in .env.local.");
    process.exit(1);
  }

  const supabase = createClient<Database>(url, key, { auth: { persistSession: false } });

  const { data: tenant } = await supabase
    .from("tenants")
    .select("id, name")
    .eq("id", args.tenant)
    .maybeSingle<{ id: string; name: string }>();

  if (!tenant) {
    console.error(`No tenant ${args.tenant}.`);
    process.exit(1);
  }

  // information_schema is not exposed through PostgREST, so the table list is declared
  // below rather than discovered. A table added later has to be added there too; the
  // manifest records exactly what was read so a gap is visible rather than assumed away.
  const tableNames = [...new Set(TENANT_TABLES)].sort();

  mkdirSync(args.out, { recursive: true });

  console.log(`Tenant: ${tenant.name}`);
  console.log(`Out:    ${args.out}`);
  console.log(`Tables: ${tableNames.length}\n`);

  const manifest: Record<string, number> = {};
  const failures: string[] = [];
  let total = 0;

  for (const table of tableNames) {
    try {
      const rows = await readAll(supabase, table, tenant.id);

      if (rows.length > 0) {
        writeFileSync(join(args.out, `${table}.json`), JSON.stringify(rows, null, 2), "utf8");
      }

      manifest[table] = rows.length;
      total += rows.length;

      if (rows.length > 0) {
        console.log(`  ${String(rows.length).padStart(6)}  ${table}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(message);
      console.error(`  FAILED  ${table}: ${message}`);
    }
  }

  writeFileSync(
    join(args.out, "manifest.json"),
    JSON.stringify(
      {
        tenantId: tenant.id,
        tenantName: tenant.name,
        takenAt: new Date().toISOString(),
        totalRows: total,
        tables: manifest,
        failures,
        note:
          "Data only. The schema lives in supabase/migrations and is in git. To restore: run the " +
          "migrations against an empty project, then insert these rows in dependency order.",
      },
      null,
      2,
    ),
    "utf8",
  );

  console.log(`\n${total} rows across ${Object.values(manifest).filter((n) => n > 0).length} tables.`);
  console.log(`Manifest: ${join(args.out, "manifest.json")}`);

  if (failures.length > 0) {
    console.error(`\n${failures.length} table(s) failed. This backup is INCOMPLETE.`);
    process.exitCode = 1;
    return;
  }

  console.log("\nThis is a local, unencrypted copy of the tenant's data, including personal");
  console.log("information. Keep it off any synced or cloud folder and delete it once the project");
  console.log("has real backups (Supabase Pro: daily backups and point-in-time recovery).");
}

/**
 * Every table carrying a tenant_id, taken from information_schema.
 *
 * eld_connection_secret is deliberately left out. It holds provider API tokens, and a
 * plaintext file on a laptop is not where a credential belongs; it is also the one thing
 * here that can be reissued rather than restored.
 *
 * Keep in step with new migrations. The manifest records exactly what was read, so a
 * table added later and forgotten shows up as absent rather than as empty.
 */
const TENANT_TABLES = [
  "app_error", "app_error_signature", "auto_share_recipients", "certification_types",
  "certifications", "change_order", "change_order_approval", "change_order_attachment",
  "change_order_line", "change_order_markup", "co_project", "company_settings",
  "consultant_access", "consultant_audit_log", "contracted_driver",
  "contracted_driver_certification", "contracted_driver_document", "contracted_equipment",
  "contracted_equipment_certification_requirement", "contracted_equipment_document",
  "document_control_register", "dti_inspection", "dti_inspection_item", "eld_connection",
  "eld_device", "eld_driver_event", "eld_driver_link", "eld_driver_performance",
  "eld_driver_profile", "eld_vehicle_event", "eld_vehicle_link", "equipment",
  "equipment_certification_requirement", "equipment_certification_types", "equipment_document",
  "equipment_maintenance_log", "equipment_meter_log", "equipment_scheduled_service",
  "equipment_submission_link", "field_ticket", "follow_ups", "form_items", "form_sections",
  "forms", "gc_rfi", "inventory_balance", "inventory_category", "inventory_count",
  "inventory_item", "inventory_location", "inventory_movement", "inventory_transfer",
  "list_items", "lists", "locations", "notifications", "permission_profiles", "print_settings",
  "resource_sections", "resources", "scheduled_tasks", "schedules", "signatures",
  "subcontractor", "subcontractor_audit_log", "subcontractor_document",
  "subcontractor_requirement_setting", "subcontractor_user_access", "submission_photos",
  "submission_values", "submissions", "tenant_audit_log", "trade_checklist_template",
  "trade_checklist_template_item", "trade_customer", "trade_customer_equipment",
  "trade_invoice", "trade_invoice_line", "trade_price_book_item", "trade_service_address",
  "trade_service_agreement", "trade_work_order", "trade_work_order_field_log",
  "trade_work_order_line", "trade_work_order_material", "trade_work_order_note",
  "trade_work_order_task", "trade_work_order_time", "transport_document", "transport_driver",
  "transport_duty_status_event", "transport_medical_record", "user_locations", "users",
  "visitors", "worker_profiles", "worker_time_cards", "workflow_conditions",
  "workflow_run_steps", "workflow_runs", "workflow_steps", "workflows"
];

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
