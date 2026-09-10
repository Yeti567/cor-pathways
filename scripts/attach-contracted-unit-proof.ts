// Attach scans to a contracted unit's document rows.
//
// WHY THIS EXISTS. Same reason as attach-contracted-driver-proof, one level up: the
// contracted load put the DATES in from the carrier's equipment sheet, so a unit's CVIP,
// registration, hose tests and valve certificates all read amber "no document" until a
// scan hangs off them. A date with nothing behind it is not something you can hand an
// auditor, and a carrier's truck folder is a dozen uploads through the browser with no
// record of what went where.
//
// WHY IT IS NOT THE SAME SCRIPT AS THE DRIVER ONE. A driver certification points at its
// proof through a single attachment_path. A unit document instead holds attachment_ids,
// an ARRAY of storage paths, because one inspection can arrive as several sheets. So this
// appends rather than sets, and a second scan added later joins the first instead of
// replacing it.
//
// WHAT IT DOES NOT DO. It does not read the documents and it does not decide which scan
// proves which record. That mapping is in the manifest, made by a person who has read
// them. A filename is not evidence.
//
// Usage:
//   npx tsx scripts/attach-contracted-unit-proof.ts --manifest <file.json> [--apply]
//
// Without --apply it checks everything and writes nothing. The manifest is a JSON array:
//
//   [
//     {
//       "file": "C:/.../7703 - Inspection - CVIP - Exp May 31, 2027.pdf",
//       "documentId": "00000000-0000-0000-0000-000000000000",
//       "issuedDate": "2026-05-28",   // optional; only fills a blank, never overwrites
//       "expiryDate": "2027-05-31",   // optional; refused if it disagrees with the row
//       "note": "why this is what it is"   // printed in the report only
//     }
//   ]
//
// issuedDate only ever FILLS A BLANK. expiryDate is a check, not a correction: pass what
// the document says and the script confirms the row agrees, or refuses the entry and says
// so. That asymmetry is deliberate. The expiry is what the compliance light reads, it
// came from the carrier's own sheet, and a pack reload would overwrite anything written
// here - so a disagreement has to be fixed at the sheet or it silently comes back. What
// this script must never do is quietly make the two agree.

import { existsSync, readFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { buildContractedStoragePath, CONTRACTED_DOCUMENTS_BUCKET } from "../src/lib/contracted-equipment";
import { sanitizeStorageFilename } from "../src/lib/document-control";
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
  documentId: string;
  issuedDate?: string | null;
  expiryDate?: string | null;
  /** Printed in the run report only. Not stored. */
  note?: string;
};

type DocumentRow = {
  id: string;
  tenant_id: string;
  contracted_equipment_id: string;
  title: string;
  doc_type: string;
  issued_date: string | null;
  expiry_date: string | null;
  attachment_ids: string[];
};

type UnitRow = { id: string; unit_number: string; subcontractor_id: string; tenant_id: string };

function parseArgs(argv: string[]) {
  const read = (flag: string) => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : undefined;
  };

  const manifest = read("--manifest");

  if (!manifest) {
    console.error("Usage: npx tsx scripts/attach-contracted-unit-proof.ts --manifest <file.json> [--apply]");
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
  console.log(args.apply ? "Mode:     APPLY, this will upload and write" : "Mode:     check only, nothing will be written");
  console.log("");

  const problems: string[] = [];
  const planned: string[] = [];
  let uploaded = 0;
  let dated = 0;

  // One stamp per run, so a batch lands as one set of names and a re-run is visibly a
  // different batch.
  const stamp = Date.now();
  let index = 0;

  for (const entry of entries) {
    index += 1;

    if (!existsSync(entry.file)) {
      problems.push(`${entry.file}: file not found`);
      continue;
    }

    const extension = extname(entry.file).toLowerCase();
    const contentType = CONTENT_TYPES[extension];

    if (!contentType) {
      problems.push(`${basename(entry.file)}: ${extension} is not a type the bucket accepts`);
      continue;
    }

    const bytes = readFileSync(entry.file);

    if (bytes.byteLength > MAX_BYTES) {
      problems.push(`${basename(entry.file)}: ${(bytes.byteLength / 1024 / 1024).toFixed(1)} MB is over the 10 MB limit`);
      continue;
    }

    const { data: document } = await supabase
      .from("contracted_equipment_document")
      .select("id, tenant_id, contracted_equipment_id, title, doc_type, issued_date, expiry_date, attachment_ids")
      .eq("id", entry.documentId)
      .is("deleted_at", null)
      .maybeSingle<DocumentRow>();

    if (!document) {
      problems.push(`${basename(entry.file)}: no live document ${entry.documentId}`);
      continue;
    }

    const { data: unit } = await supabase
      .from("contracted_equipment")
      .select("id, unit_number, subcontractor_id, tenant_id")
      .eq("id", document.contracted_equipment_id)
      .is("deleted_at", null)
      .maybeSingle<UnitRow>();

    if (!unit) {
      problems.push(`${basename(entry.file)}: no live unit behind document ${entry.documentId}`);
      continue;
    }

    const label = `unit ${unit.unit_number} / ${document.title}`;

    // A disagreement is reported, never resolved. See the header.
    if (entry.expiryDate && document.expiry_date && entry.expiryDate !== document.expiry_date) {
      problems.push(
        `${label}: the document says ${entry.expiryDate}, the record says ${document.expiry_date}. ` +
          `Fix the carrier's sheet and reload; this script will not overwrite it.`,
      );
      continue;
    }

    // Is THIS file already on the row, or merely some file?
    //
    // The guard here used to be "the row has at least one scan, leave it alone". That
    // made the script replay-safe and it also made it wrong: a row can legitimately need
    // several objects -- the front and back of one extinguisher tag, the two test sheets
    // behind a bypass valve certificate -- and under the old rule whichever file the
    // manifest happened to list first claimed the row and the rest were dropped in
    // silence. On the September 2026 truck load that cost six files, and put a licence
    // plate photograph on one unit's registration row while the registration
    // certificate itself went nowhere.
    //
    // Matching on the sanitised FILE NAME keeps the replay safety that mattered -- the
    // same manifest run twice still uploads nothing the second time, because the name is
    // already there -- while letting a genuine second page through. The stored path is
    // <stamp>-<index>-<sanitised name>, so the name is the part after the index and the
    // timestamp cannot be compared.
    const sanitizedName = sanitizeStorageFilename(basename(entry.file));
    const alreadyAttached = document.attachment_ids.some((existing) =>
      existing.endsWith(`-${sanitizedName}`),
    );

    if (alreadyAttached) {
      planned.push(`  = ${label}: ${basename(entry.file)} is already filed here, left alone`);
      continue;
    }

    const path = buildContractedStoragePath({
      tenantId: unit.tenant_id,
      subcontractorId: unit.subcontractor_id,
      subjectId: unit.id,
      scope: "contracted-equipment",
      fileName: basename(entry.file),
      index,
      now: stamp,
    });

    const fillsIssued = Boolean(entry.issuedDate) && document.issued_date === null;

    planned.push(
      `  + ${label}${fillsIssued ? `\n      issued none -> ${entry.issuedDate}` : ""}` +
        (entry.note ? `\n      (${entry.note})` : ""),
    );

    if (!args.apply) {
      continue;
    }

    const { error: uploadError } = await supabase.storage
      .from(CONTRACTED_DOCUMENTS_BUCKET)
      .upload(path, bytes, { contentType, upsert: false });

    if (uploadError) {
      problems.push(`${basename(entry.file)}: upload failed, ${uploadError.message}`);
      continue;
    }

    uploaded += 1;

    const { error } = await supabase
      .from("contracted_equipment_document")
      .update({
        attachment_ids: [...new Set([...document.attachment_ids, path])],
        issued_date: fillsIssued ? entry.issuedDate! : document.issued_date,
      })
      .eq("id", document.id);

    if (error) {
      // The object is up but the row does not point at it. Take it back down so a failed
      // run does not leave an orphan nobody can find or account for.
      await supabase.storage.from(CONTRACTED_DOCUMENTS_BUCKET).remove([path]);
      problems.push(`${label}: write failed, ${error.message}`);
      continue;
    }

    if (fillsIssued) {
      dated += 1;
    }
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

  console.log(`Uploaded ${uploaded} file(s), filled ${dated} blank issue date(s).`);
  process.exit(problems.length > 0 ? 1 : 0);
}

void main();
