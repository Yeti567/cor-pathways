// Attach scanned tickets to contracted drivers' certification records.
//
// WHY THIS EXISTS. A carrier's tickets arrive as a folder of scans, not as a spreadsheet.
// The dates are already in the app from their expiry sheet, so what is missing is the
// PROOF: every one of those records reads amber "No document" until a scan hangs off it,
// because a date with nothing behind it is not something you can hand an auditor.
// Uploading them one at a time through the browser is the only alternative, and a batch
// of thirty is an afternoon of clicking with no record of what went where.
//
// WHAT IT DOES NOT DO. It does not decide which scan proves which record. That mapping is
// in the manifest, made by a person who has READ the documents, because a filename is not
// evidence: in the first batch a file named "...Issued April 9, 2025" was a report
// generated 09 Apr 2024, and two files had their dates swapped between them. Trusting the
// names would have written three wrong dates into a compliance record.
//
// Usage:
//   npx tsx scripts/attach-contracted-driver-proof.ts --manifest <file.json> [--apply]
//
// Without --apply it checks everything and writes nothing. The manifest is a JSON array:
//
//   [
//     {
//       "file": "C:/.../Jared Hein - H2S - Exp April 24, 2028.pdf",
//       "certificationId": "08286572-6770-47fe-b90c-b0474adfc88f",
//       "expiresOn": "2028-04-24",   // optional; corrects the record from the document
//       "issuedOn": "2025-04-24",    // optional
//       "note": "why this date changed"   // optional, printed in the report
//     },
//     {
//       "file": "C:/.../James Ruud - H2S - Exp. Jan 10, 2028.pdf",
//       "createFor": { "driverId": "96d7...", "name": "H2S Alive", "expiresOn": "2028-01-10" }
//     }
//   ]
//
// One file may appear more than once: a single card showing both TDG and WHMIS proves two
// records, and both should point at it.

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

const BUCKET = "subcontractor-documents";

// Matches CONTRACTED_ATTACHMENT_MIME_TYPES and the bucket's own allow-list. A type the
// bucket rejects fails the upload, so it is caught here where the message is readable.
const CONTENT_TYPES: Record<string, string> = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".heic": "image/heic",
  ".heif": "image/heif",
};

const MAX_BYTES = 10 * 1024 * 1024;

type ManifestEntry = {
  file: string;
  certificationId?: string;
  createFor?: { driverId: string; name: string; expiresOn?: string | null; issuedOn?: string | null };
  expiresOn?: string | null;
  issuedOn?: string | null;
  note?: string;
};

type CertificationRow = {
  id: string;
  contracted_driver_id: string;
  name: string;
  issued_on: string | null;
  expires_on: string | null;
  attachment_path: string | null;
};

type DriverRow = { id: string; full_name: string; subcontractor_id: string };

/**
 * The same path shape the app writes, from buildContractedStoragePath.
 *
 * The carrier id sits second on purpose: if the carrier portal is ever switched on,
 * can_access_subcontractor_storage_path matches a carrier to its own folder and to
 * nobody else's. A file filed under the wrong carrier would be visible to the wrong
 * company, so this is not cosmetic.
 */
function storagePath(input: {
  tenantId: string;
  subcontractorId: string;
  driverId: string;
  fileName: string;
  stamp: number;
  index: number;
}) {
  const safe = input.fileName.replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120);

  return `${input.tenantId}/${input.subcontractorId}/contracted-drivers/${input.driverId}/${input.stamp}-${input.index}-${safe}`;
}

function parseArgs(argv: string[]) {
  const read = (flag: string) => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : undefined;
  };

  const manifest = read("--manifest");

  if (!manifest) {
    console.error("Usage: npx tsx scripts/attach-contracted-driver-proof.ts --manifest <file.json> [--apply] [--replace]");
    process.exit(1);
  }

  return {
    manifest,
    apply: argv.includes("--apply"),
    // A record that already has a scan is left alone unless this is passed. Silently
    // overwriting proof is how the wrong certificate ends up on a record with nobody
    // able to say when it changed.
    replace: argv.includes("--replace"),
  };
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
  const entries = JSON.parse(readFileSync(args.manifest, "utf8")) as ManifestEntry[];

  console.log(`Manifest: ${args.manifest}`);
  console.log(`Entries:  ${entries.length}`);
  console.log(args.apply ? "Mode:     APPLY, this will upload and write" : "Mode:     check only, nothing will be written");
  console.log("");

  const problems: string[] = [];
  const planned: string[] = [];
  let uploaded = 0;
  let created = 0;
  let corrected = 0;

  // A stamp per run rather than per file, so one batch lands as one set of names and a
  // re-run is visibly a different batch.
  const stamp = Date.now();
  let index = 0;

  for (let entry of entries) {
    index += 1;

    if (!existsSync(entry.file)) {
      problems.push(`${entry.file}: file not found`);
      continue;
    }

    const bytes = readFileSync(entry.file);
    const extension = extname(entry.file).toLowerCase();
    const contentType = CONTENT_TYPES[extension];

    if (!contentType) {
      problems.push(`${basename(entry.file)}: ${extension} is not a type the bucket accepts`);
      continue;
    }

    if (bytes.byteLength > MAX_BYTES) {
      problems.push(`${basename(entry.file)}: ${(bytes.byteLength / 1024 / 1024).toFixed(1)} MB is over the 10 MB limit`);
      continue;
    }

    let certification: CertificationRow | null = null;
    let driverId: string;

    if (entry.certificationId) {
      const { data } = await supabase
        .from("contracted_driver_certification")
        .select("id, contracted_driver_id, name, issued_on, expires_on, attachment_path")
        .eq("id", entry.certificationId)
        .maybeSingle<CertificationRow>();

      if (!data) {
        problems.push(`${basename(entry.file)}: no certification ${entry.certificationId}`);
        continue;
      }

      certification = data;
      driverId = data.contracted_driver_id;
    } else if (entry.createFor) {
      driverId = entry.createFor.driverId;

      // Does this driver already hold a record of that name?
      //
      // Without this check a second --apply of the same manifest creates the record
      // again, and again, because nothing about a createFor entry says it has been
      // done. That is how a re-run of an identical pack once produced 460 duplicate
      // driver records. Falling through to the update path instead makes a repeat run
      // a no-op and lets a manifest be corrected and replayed safely.
      const { data: existing } = await supabase
        .from("contracted_driver_certification")
        .select("id, contracted_driver_id, name, issued_on, expires_on, attachment_path")
        .eq("contracted_driver_id", driverId)
        .returns<CertificationRow[]>();

      const wanted = entry.createFor.name.trim().toLowerCase();
      const match = existing?.find((row) => row.name.trim().toLowerCase() === wanted);

      if (match) {
        certification = match;
        entry = { ...entry, expiresOn: entry.expiresOn ?? entry.createFor.expiresOn };
      }
    } else {
      problems.push(`${basename(entry.file)}: needs either certificationId or createFor`);
      continue;
    }

    const { data: driver } = await supabase
      .from("contracted_driver")
      .select("id, full_name, subcontractor_id")
      .eq("id", driverId)
      .is("deleted_at", null)
      .maybeSingle<DriverRow>();

    if (!driver) {
      problems.push(`${basename(entry.file)}: no live driver ${driverId}`);
      continue;
    }

    if (certification?.attachment_path && !args.replace) {
      planned.push(`  = ${driver.full_name} / ${certification.name}: already proven, left alone`);
      continue;
    }

    const path = storagePath({
      tenantId: (await tenantOf(supabase, driver.subcontractor_id)) ?? "",
      subcontractorId: driver.subcontractor_id,
      driverId: driver.id,
      fileName: basename(entry.file),
      stamp,
      index,
    });

    const label = certification
      ? `${driver.full_name} / ${certification.name}`
      : `${driver.full_name} / ${entry.createFor!.name} (new record)`;

    const changes: string[] = [];

    if (certification) {
      if (entry.expiresOn && entry.expiresOn !== certification.expires_on) {
        changes.push(`expiry ${certification.expires_on ?? "none"} -> ${entry.expiresOn}`);
      }

      if (entry.issuedOn && entry.issuedOn !== certification.issued_on) {
        changes.push(`issued ${certification.issued_on ?? "none"} -> ${entry.issuedOn}`);
      }
    }

    planned.push(
      `  ${certification ? "+" : "*"} ${label}` +
        (changes.length > 0 ? `\n      ${changes.join(", ")}${entry.note ? ` (${entry.note})` : ""}` : ""),
    );

    if (!args.apply) {
      continue;
    }

    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(path, bytes, { contentType, upsert: false });

    if (uploadError) {
      problems.push(`${basename(entry.file)}: upload failed, ${uploadError.message}`);
      continue;
    }

    uploaded += 1;

    if (certification) {
      const { error } = await supabase
        .from("contracted_driver_certification")
        .update({
          attachment_path: path,
          expires_on: entry.expiresOn ?? certification.expires_on,
          issued_on: entry.issuedOn ?? certification.issued_on,
        })
        .eq("id", certification.id);

      if (error) {
        // The file is up but the row does not point at it. Take the file back down so a
        // failed run does not leave an orphan nobody can find or account for.
        await supabase.storage.from(BUCKET).remove([path]);
        uploaded -= 1;
        problems.push(`${label}: row not updated, ${error.message}. The upload was rolled back.`);
        continue;
      }

      if (changes.length > 0) {
        corrected += 1;
      }
    } else {
      const create = entry.createFor!;
      const tenantId = (await tenantOf(supabase, driver.subcontractor_id))!;

      // Link the shared certification type, matched on name.
      //
      // Not cosmetic: the type is what carries the category, and a record with no type
      // has no category, so contractedDriverOverallTone skips it. An untyped H2S Alive
      // sits on the page looking filed while counting for nothing, which is the worst of
      // both worlds. Left null only when no type matches, and reported when that happens.
      const typeId = await certificationTypeIdByName(supabase, tenantId, create.name);

      if (!typeId) {
        problems.push(
          `${label}: no certification type named "${create.name}", so the record was created untyped and will not count towards the driver's status. Add the type, then set it on the record.`,
        );
      }

      const { error } = await supabase.from("contracted_driver_certification").insert({
        tenant_id: tenantId,
        contracted_driver_id: driver.id,
        certification_type_id: typeId,
        name: create.name,
        issued_on: create.issuedOn ?? null,
        expires_on: create.expiresOn ?? null,
        attachment_path: path,
      });

      if (error) {
        await supabase.storage.from(BUCKET).remove([path]);
        uploaded -= 1;
        problems.push(`${label}: record not created, ${error.message}. The upload was rolled back.`);
        continue;
      }

      created += 1;
    }
  }

  console.log(planned.join("\n"));
  console.log("");

  if (args.apply) {
    console.log(`Uploaded ${uploaded}, created ${created} new record(s), corrected ${corrected} date set(s).`);
  } else {
    console.log("Check only. Nothing was uploaded or written. Re-run with --apply.");
  }

  if (problems.length > 0) {
    console.error(`\n${problems.length} problem(s):`);
    for (const problem of problems) {
      console.error(`  ! ${problem}`);
    }
    process.exitCode = 1;
  }
}

/** The shared certification type with this name, or null when there is no such type. */
async function certificationTypeIdByName(
  supabase: ReturnType<typeof createClient<Database>>,
  tenantId: string,
  name: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("certification_types")
    .select("id, name")
    .eq("tenant_id", tenantId)
    .returns<{ id: string; name: string }[]>();

  const wanted = name.trim().toLowerCase();

  return data?.find((type) => type.name.trim().toLowerCase() === wanted)?.id ?? null;
}

/** Tenant a carrier belongs to. Cached: a batch is nearly always one carrier. */
const tenantCache = new Map<string, string | null>();

async function tenantOf(
  supabase: ReturnType<typeof createClient<Database>>,
  subcontractorId: string,
): Promise<string | null> {
  if (tenantCache.has(subcontractorId)) {
    return tenantCache.get(subcontractorId)!;
  }

  const { data } = await supabase
    .from("subcontractor")
    .select("tenant_id")
    .eq("id", subcontractorId)
    .maybeSingle<{ tenant_id: string }>();

  const tenantId = data?.tenant_id ?? null;
  tenantCache.set(subcontractorId, tenantId);

  return tenantId;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
