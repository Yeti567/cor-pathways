// File a document into the medical vault, for an employee or a contracted driver.
//
// WHY THIS EXISTS. The vault is uploaded to through the browser by the one person who
// holds medical_vault_access, and that is right for a doctor's note that arrives one at a
// time. It is the wrong shape for a carrier pack: the paperwork arrives in a batch, to
// the safety mailbox, and the person who has to file it may not be the person allowed to
// read it. This runs on the service role, so it can put a file somewhere the operator
// cannot open -- which is the point, not a loophole.
//
// READ THIS BEFORE ADDING A RECORD TYPE. What belongs here is the RECORD, never the DATE.
// A drug and alcohol certification, its expiry and its reminder stay on the driver's file
// where the whole company can see them; what comes here is the collector's paperwork
// behind it, because that is a person's body chemistry. The same split as a driver's
// medical: the licence expiry proves it happened, the examiner's findings are not tracked
// at all. If a thing you are about to file would be useful to a dispatcher, it is a date
// and it does not belong in the vault.
//
// WHO CAN READ WHAT THIS WRITES. Only holders of medical_vault_access, and for an
// employee also the worker themselves. A contracted driver has no user account, so for
// them it is capability holders and nobody else. Being a super admin is not enough and
// has not been since 20260826040000. Check before you run this that the tenant has
// somebody holding the capability, or you are filing into a vault nobody can open.
//
// Usage:
//   npx tsx scripts/file-medical-vault-record.ts --manifest <file.json> [--apply]
//
// Without --apply it checks everything and writes nothing. The manifest is a JSON array:
//
//   [
//     {
//       "file": "C:/.../d-and-a-2026-07-21.pdf",
//       "contractedDriverId": "0000...",     // or "driverId" for an employee, never both
//       "recordType": "drug_alcohol",        // injury | medical | wcb | first_aid | drug_alcohol | other
//       "title": "Drug and alcohol test - 21 Jul 2026",
//       "occurredOn": "2026-07-21",
//       "notes": "kept in the vault, shown only to those who can open it",
//       "note": "printed in the run report only, never stored"
//     }
//   ]

import { existsSync, readFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
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

const BUCKET = "medical-vault";

const CONTENT_TYPES: Record<string, string> = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".heic": "image/heic",
  ".heif": "image/heif",
};

const MAX_BYTES = 25 * 1024 * 1024;

const RECORD_TYPES = ["injury", "medical", "wcb", "first_aid", "drug_alcohol", "other"] as const;

type ManifestEntry = {
  file: string;
  driverId?: string;
  contractedDriverId?: string;
  recordType: (typeof RECORD_TYPES)[number];
  title: string;
  occurredOn?: string | null;
  notes?: string | null;
  /** Printed in the run report only. Never stored. */
  note?: string;
};

function parseArgs(argv: string[]) {
  const read = (flag: string) => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : undefined;
  };

  const manifest = read("--manifest");

  if (!manifest) {
    console.error("Usage: npx tsx scripts/file-medical-vault-record.ts --manifest <file.json> [--apply]");
    process.exit(1);
  }

  return { manifest, apply: argv.includes("--apply") };
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

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
  const entries = JSON.parse(readFileSync(args.manifest, "utf8")) as ManifestEntry[];

  console.log(`Manifest: ${args.manifest}`);
  console.log(`Entries:  ${entries.length}`);
  console.log(args.apply ? "Mode:     APPLY, this will upload and write" : "Mode:     check only, nothing will be written");
  console.log("");

  const problems: string[] = [];
  const planned: string[] = [];
  let filed = 0;

  const stamp = Date.now();
  let index = 0;

  for (const entry of entries) {
    index += 1;

    if (!RECORD_TYPES.includes(entry.recordType)) {
      problems.push(`entry ${index}: recordType must be one of ${RECORD_TYPES.join(", ")}`);
      continue;
    }

    if (!entry.title?.trim()) {
      problems.push(`entry ${index}: needs a title`);
      continue;
    }

    // Exactly one subject, matching the table's own constraint. Caught here so the
    // message names the entry rather than the constraint.
    if (Boolean(entry.driverId) === Boolean(entry.contractedDriverId)) {
      problems.push(`entry ${index}: set exactly one of driverId and contractedDriverId`);
      continue;
    }

    if (entry.occurredOn && !DATE.test(entry.occurredOn)) {
      problems.push(`entry ${index}: occurredOn is not a date`);
      continue;
    }

    if (!existsSync(entry.file)) {
      problems.push(`entry ${index}: ${entry.file} not found`);
      continue;
    }

    const extension = extname(entry.file).toLowerCase();
    const contentType = CONTENT_TYPES[extension];

    if (!contentType) {
      problems.push(`entry ${index}: ${extension} is not a type this accepts`);
      continue;
    }

    const bytes = readFileSync(entry.file);

    if (bytes.byteLength > MAX_BYTES) {
      problems.push(`entry ${index}: ${(bytes.byteLength / 1024 / 1024).toFixed(1)} MB is over the limit`);
      continue;
    }

    // Resolve the subject and, with it, the tenant. Taken from the driver row rather than
    // from the manifest so a mistyped tenant cannot file one company's record under
    // another's folder, where their vault holder would be able to read it.
    let tenantId: string;
    let subjectId: string;
    let subjectName: string;

    if (entry.contractedDriverId) {
      const { data } = await supabase
        .from("contracted_driver")
        .select("id, tenant_id, full_name")
        .eq("id", entry.contractedDriverId)
        .is("deleted_at", null)
        .maybeSingle<{ id: string; tenant_id: string; full_name: string }>();

      if (!data) {
        problems.push(`entry ${index}: no live contracted driver ${entry.contractedDriverId}`);
        continue;
      }

      tenantId = data.tenant_id;
      subjectId = data.id;
      subjectName = data.full_name;
    } else {
      const { data } = await supabase
        .from("transport_driver")
        .select("id, tenant_id, full_name")
        .eq("id", entry.driverId!)
        .maybeSingle<{ id: string; tenant_id: string; full_name: string }>();

      if (!data) {
        problems.push(`entry ${index}: no driver ${entry.driverId}`);
        continue;
      }

      tenantId = data.tenant_id;
      subjectId = data.id;
      subjectName = data.full_name;
    }

    // Refuse to file into a vault nobody can open. Without this the file lands somewhere
    // correct and unreachable, and looks filed on every report that counts rows.
    const { data: holders } = await supabase
      .from("users")
      .select("id, permission_profile_id, permission_profiles(capabilities)")
      .eq("tenant_id", tenantId)
      .eq("active", true)
      .returns<{ id: string; permission_profile_id: string | null; permission_profiles: { capabilities: unknown } | null }[]>();

    const holderCount = (holders ?? []).filter((user) => {
      const capabilities = user.permission_profiles?.capabilities;

      return (
        typeof capabilities === "object" &&
        capabilities !== null &&
        !Array.isArray(capabilities) &&
        (capabilities as Record<string, unknown>).medical_vault_access === true
      );
    }).length;

    if (holderCount === 0) {
      problems.push(
        `entry ${index}: nobody in this tenant holds medical_vault_access, so this would be filed where no one can read it. Grant it to a named person first.`,
      );
      continue;
    }

    // Already filed? By subject, type, title and date. Not by storage path, which carries
    // a per-run stamp and could never match.
    const existingQuery = supabase
      .from("transport_medical_record")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("record_type", entry.recordType)
      .ilike("title", entry.title.trim())
      .is("deleted_at", null);

    const { data: existing } = await (entry.contractedDriverId
      ? existingQuery.eq("contracted_driver_id", subjectId)
      : existingQuery.eq("driver_id", subjectId)
    ).returns<{ id: string }[]>();

    if (existing && existing.length > 0) {
      planned.push(`  = ${subjectName} / ${entry.title}: already in the vault, left alone`);
      continue;
    }

    // {tenant}/{subject}/... is what the storage policy parses. Anything else is refused
    // by the bucket, whoever is asking.
    const safe = basename(entry.file).replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120);
    const storagePath = `${tenantId}/${subjectId}/${stamp}-${index}-${safe}`;

    planned.push(
      `  + ${subjectName} / ${entry.title}\n` +
        `      ${entry.recordType}${entry.occurredOn ? `, ${entry.occurredOn}` : ""}, ` +
        `readable by ${holderCount} vault holder${holderCount === 1 ? "" : "s"}` +
        (entry.note ? `\n      (${entry.note})` : ""),
    );

    if (!args.apply) {
      continue;
    }

    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(storagePath, bytes, { contentType, upsert: false });

    if (uploadError) {
      problems.push(`entry ${index}: upload failed, ${uploadError.message}`);
      continue;
    }

    const { error } = await supabase.from("transport_medical_record").insert({
      tenant_id: tenantId,
      driver_id: entry.contractedDriverId ? null : subjectId,
      contracted_driver_id: entry.contractedDriverId ? subjectId : null,
      record_type: entry.recordType,
      title: entry.title.trim(),
      storage_path: storagePath,
      occurred_on: entry.occurredOn ?? null,
      notes: entry.notes ?? null,
    });

    if (error) {
      await supabase.storage.from(BUCKET).remove([storagePath]);
      problems.push(`entry ${index}: write failed, ${error.message}`);
      continue;
    }

    filed += 1;
  }

  console.log(planned.join("\n") || "  nothing to do");
  console.log("");

  if (problems.length > 0) {
    console.log("Problems:");

    for (const problem of problems) {
      console.log(`  - ${problem}`);
    }

    console.log("");
  }

  if (!args.apply) {
    console.log("Check only. Nothing was uploaded or written. Re-run with --apply.");
    process.exit(problems.length > 0 ? 1 : 0);
  }

  console.log(`Filed ${filed} record(s) into the vault.`);
  process.exit(problems.length > 0 ? 1 : 0);
}

void main();
