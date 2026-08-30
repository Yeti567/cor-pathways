// File a contracted driver's licence, abstract or CSO scan.
//
// WHY THIS EXISTS, and why it is not the same script as attach-contracted-driver-proof.
// That one attaches a scan to a certification ROW that already exists and is reading
// amber for want of proof. These three documents have no such row: the licence, the
// abstract and the CSO are COLUMNS on contracted_driver, and until
// 20260829032818_contracted_driver_documents there was nowhere to put the paper at all.
// Seven documents from the 2026-08-26 batch sat undeliverable for that reason. This
// script files them into the new table.
//
// WHAT IT DOES NOT DO. It does not touch the driver's own date columns. Those are what
// the roster light, the reminder job and the site qualification grid read, and they are
// corrected under Driver details by a person, not by a batch. What this writes is the
// dates AS PRINTED ON THE DOCUMENT, kept beside the tracked ones so the app can show a
// disagreement rather than silently resolving it. One of the documents in the first batch
// disagrees with the carrier's sheet by ten days, and that is worth seeing.
//
// As with its sibling: the manifest is made by a person who has READ the documents. A
// filename is not evidence. In the first batch a file named "...Issued April 9, 2025" was
// a report generated 09 Apr 2024.
//
// Usage:
//   npx tsx scripts/attach-contracted-driver-document.ts --manifest <file.json> [--apply]
//
// Without --apply it checks everything and writes nothing. The manifest is a JSON array:
//
//   [
//     {
//       "file": "C:/.../driver-licence-exp-2028-06-30.pdf",
//       "driverId": "00000000-0000-0000-0000-000000000000",
//       "docType": "license",
//       "title": "Saskatchewan Class 1 licence",
//       "expiryDate": "2028-06-30",
//       "note": "why this is what it is"      // optional, printed in the report only
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

const BUCKET = "subcontractor-documents";

const DOC_TYPES = ["license", "abstract", "cso"] as const;
type DocType = (typeof DOC_TYPES)[number];

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
  driverId: string;
  docType: DocType;
  title: string;
  issuedDate?: string | null;
  expiryDate?: string | null;
  /** Printed in the run report only. Not stored. */
  note?: string;
};

type DriverRow = { id: string; full_name: string; subcontractor_id: string };

type DocumentRow = {
  id: string;
  doc_type: string;
  title: string;
  issued_date: string | null;
  expiry_date: string | null;
};

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
    console.error(
      "Usage: npx tsx scripts/attach-contracted-driver-document.ts --manifest <file.json> [--apply]",
    );
    process.exit(1);
  }

  return { manifest, apply: argv.includes("--apply") };
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
  console.log(
    args.apply ? "Mode:     APPLY, this will upload and write" : "Mode:     check only, nothing will be written",
  );
  console.log("");

  const problems: string[] = [];
  const planned: string[] = [];
  let uploaded = 0;

  // A stamp per run rather than per file, so one batch lands as one set of names and a
  // re-run is visibly a different batch.
  const stamp = Date.now();
  let index = 0;

  for (const entry of entries) {
    index += 1;

    if (!existsSync(entry.file)) {
      problems.push(`${entry.file}: file not found`);
      continue;
    }

    if (!DOC_TYPES.includes(entry.docType)) {
      problems.push(`${basename(entry.file)}: docType must be one of ${DOC_TYPES.join(", ")}`);
      continue;
    }

    if (!entry.title?.trim()) {
      problems.push(`${basename(entry.file)}: needs a title`);
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
      problems.push(
        `${basename(entry.file)}: ${(bytes.byteLength / 1024 / 1024).toFixed(1)} MB is over the 10 MB limit`,
      );
      continue;
    }

    const { data: driver } = await supabase
      .from("contracted_driver")
      .select("id, full_name, subcontractor_id")
      .eq("id", entry.driverId)
      .is("deleted_at", null)
      .maybeSingle<DriverRow>();

    if (!driver) {
      problems.push(`${basename(entry.file)}: no live driver ${entry.driverId}`);
      continue;
    }

    // Is this document already filed?
    //
    // The storage path carries a per-run stamp, so it can never match on a re-run and is
    // no use as an identity. What identifies a filed document is the driver, what kind it
    // is, what it is called and the dates on its face. Matching on those makes a repeat
    // run a no-op, which is what stops a corrected manifest being replayed into a pile of
    // duplicates -- the failure mode that once produced 460 duplicate driver records.
    const { data: existing } = await supabase
      .from("contracted_driver_document")
      .select("id, doc_type, title, issued_date, expiry_date")
      .eq("contracted_driver_id", driver.id)
      .eq("doc_type", entry.docType)
      .returns<DocumentRow[]>();

    const duplicate = existing?.find(
      (row) =>
        row.title.trim().toLowerCase() === entry.title.trim().toLowerCase() &&
        (row.issued_date ?? null) === (entry.issuedDate ?? null) &&
        (row.expiry_date ?? null) === (entry.expiryDate ?? null),
    );

    if (duplicate) {
      planned.push(`  = ${driver.full_name} / ${entry.title}: already filed, left alone`);
      continue;
    }

    const tenantId = await tenantOf(supabase, driver.subcontractor_id);

    if (!tenantId) {
      problems.push(`${basename(entry.file)}: carrier ${driver.subcontractor_id} has no tenant`);
      continue;
    }

    const dates = [
      entry.issuedDate ? `dated ${entry.issuedDate}` : null,
      entry.expiryDate ? `expires ${entry.expiryDate}` : null,
    ]
      .filter(Boolean)
      .join(", ");

    planned.push(
      `  + ${driver.full_name} / ${entry.docType}: ${entry.title}` +
        (dates ? `\n      ${dates}` : "") +
        (entry.note ? `\n      (${entry.note})` : "") +
        (existing && existing.length > 0
          ? `\n      ${existing.length} earlier ${entry.docType} document(s) kept as history`
          : ""),
    );

    if (!args.apply) {
      continue;
    }

    const path = storagePath({
      tenantId,
      subcontractorId: driver.subcontractor_id,
      driverId: driver.id,
      fileName: basename(entry.file),
      stamp,
      index,
    });

    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(path, bytes, { contentType, upsert: false });

    if (uploadError) {
      problems.push(`${basename(entry.file)}: upload failed, ${uploadError.message}`);
      continue;
    }

    uploaded += 1;

    const { error } = await supabase.from("contracted_driver_document").insert({
      tenant_id: tenantId,
      contracted_driver_id: driver.id,
      doc_type: entry.docType,
      title: entry.title.trim(),
      issued_date: entry.issuedDate ?? null,
      expiry_date: entry.expiryDate ?? null,
      attachment_path: path,
    });

    if (error) {
      // The file is up but no row points at it. Take it back down so a failed run does
      // not leave an orphan nobody can find or account for.
      await supabase.storage.from(BUCKET).remove([path]);
      uploaded -= 1;
      problems.push(`${driver.full_name} / ${entry.title}: row not written, ${error.message}. Upload rolled back.`);
    }
  }

  console.log(planned.join("\n"));
  console.log("");

  if (args.apply) {
    console.log(`Filed ${uploaded} document(s).`);
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
