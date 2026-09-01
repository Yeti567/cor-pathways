// Dump every contracted driver and the records hanging off them, as one JSON file.
//
// Used when preparing a batch of scans: matching 657 files to the records they prove is
// offline work, and doing it against a snapshot beats issuing a query per driver.
//
// Usage:
//   npx tsx scripts/dump-contracted-driver-state.ts --tenant <uuid> --out <file.json>

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../src/types/database";

/** Minimal .env.local reader, matching load-client-pack.ts. Never echoes a value. */
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

/**
 * Read a whole table, a page at a time.
 *
 * PostgREST caps a response at 1000 rows and says nothing about it, so a plain select
 * of this tenant's 1439 certifications comes back looking complete at 1000. A snapshot
 * that is quietly missing a third of the records is worse than no snapshot, because
 * every scan matched against it would read as "no such record".
 */
async function readAll<T>(
  build: () => { range: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }> },
): Promise<T[]> {
  const PAGE = 1000;
  const rows: T[] = [];

  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1);

    if (error) {
      throw new Error(typeof error === "object" && error && "message" in error ? String(error.message) : String(error));
    }

    rows.push(...(data ?? []));

    if (!data || data.length < PAGE) {
      return rows;
    }
  }
}

function parseArgs(argv: string[]) {
  const read = (flag: string) => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : undefined;
  };

  const tenant = read("--tenant");
  const out = read("--out");

  if (!tenant || !out) {
    console.error("Usage: npx tsx scripts/dump-contracted-driver-state.ts --tenant <uuid> --out <file.json>");
    process.exit(1);
  }

  return { tenant, out };
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

  const carriers = await readAll(() =>
    supabase
      .from("subcontractor")
      .select("id, legal_name, operating_name")
      .eq("tenant_id", args.tenant)
      .is("deleted_at", null),
  );

  const drivers = await readAll(() =>
    supabase
      .from("contracted_driver")
      .select("id, full_name, subcontractor_id, license_province, license_expiry, abstract_issued, abstract_expiry, cso_completed, driver_type, status")
      .eq("tenant_id", args.tenant)
      .is("deleted_at", null),
  );

  const certifications = await readAll(() =>
    supabase
      .from("contracted_driver_certification")
      .select("id, contracted_driver_id, certification_type_id, name, issued_on, expires_on, issuing_company, detail, attachment_path")
      .eq("tenant_id", args.tenant)
      .order("id"),
  );

  const documents = await readAll(() =>
    supabase
      .from("contracted_driver_document")
      .select("id, contracted_driver_id, doc_type, title, issued_date, expiry_date, attachment_path")
      .eq("tenant_id", args.tenant)
      .order("id"),
  );

  const observations = await readAll(() =>
    supabase
      .from("contracted_driver_observation")
      .select("id, contracted_driver_id, observation_type, title, observed_on, reported_on, issuing_company, observer, location, outcome, site_access, findings, action_taken, attachment_path")
      .eq("tenant_id", args.tenant)
      .is("deleted_at", null)
      .order("id"),
  );

  const types = await readAll(() =>
    supabase
      .from("certification_types")
      .select("id, name, category, expires, is_mandatory")
      .eq("tenant_id", args.tenant),
  );

  writeFileSync(
    args.out,
    JSON.stringify({ carriers, drivers, certifications, documents, observations, types }, null, 1),
  );

  console.log(
    `${carriers.length} carriers, ${drivers.length} drivers, ` +
      `${certifications.length} certifications, ${documents.length} documents, ` +
      `${observations.length} observations, ${types.length} types -> ${args.out}`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
