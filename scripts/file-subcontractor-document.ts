// File a carrier's company paperwork into its document slots.
//
// WHY THIS EXISTS. A carrier pack arrives as a folder: articles, carrier profile, safety
// fitness certificate, certificate of insurance, the signed agreement. The contracted
// load put the DATES in from the carrier sheet, so every slot on the subcontractor page
// carries an expiry with no paper behind it. Filing them one at a time through the
// browser is the only alternative, and one carrier is a dozen uploads with no record of
// what went where.
//
// It mirrors fileSubcontractorDocument in src/app/admin/subcontractors/actions.ts, and
// deliberately reuses that module's own helpers rather than restating them:
//
//   - getSubcontractorSlot decides what a slot is allowed to hold
//   - buildSubcontractorDocumentWrite derives due_date and drops fields the slot does
//     not capture, so a limit typed against a WCB clearance is not silently persisted
//   - filing supersedes whatever was live in that slot, so a slot reads as one current
//     document with history behind it rather than a pile of equally current copies
//
// WHAT IT DOES NOT DO. It does not read the documents. The manifest is made by a person
// who has read them, because a filename is not evidence: in the first contracted batch a
// file named "...Issued April 9, 2025" was a report generated 09 Apr 2024.
//
// Usage:
//   npx tsx scripts/file-subcontractor-document.ts --manifest <file.json> [--apply]
//
// Without --apply it checks everything and writes nothing. The manifest is a JSON array,
// filed in order, so an older document listed before a newer one becomes its history:
//
//   [
//     {
//       "file": "C:/.../COI - Exp Jul 12, 2027.pdf",
//       "subcontractorId": "00000000-0000-0000-0000-000000000000",
//       "slotKey": "fleet_insurance",
//       "title": "Certificate of insurance - automobile liability",
//       "issuedDate": "2026-07-08",
//       "expiryDate": "2027-07-12",
//       "documentNumber": "123456789",
//       "insurer": "Example Insurance Co.",
//       "coverageAmount": 5000000,
//       "additionalInsured": true,
//       "note": "why this is what it is"        // printed in the report only
//     },
//     {
//       "reuseFileOf": 1,                        // 1-based entry number in this manifest
//       "subcontractorId": "...",
//       "slotKey": "general_liability",
//       ...                                      // its own dates and limits
//     }
//   ]
//
// reuseFileOf exists because a broker issues one certificate covering automobile, general
// liability and cargo on a single PDF, each line with its own limit. Storing that file
// three times would be three copies of one document that can drift apart; the second and
// third slots point at the object the first one uploaded, exactly as the browser form's
// "reuse a file already uploaded" path does.

import { existsSync, readFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  buildSubcontractorDocumentWrite,
  getSubcontractorSlot,
  slotCaptures,
  type SubcontractorCapture,
} from "../src/lib/subcontractor-requirements";
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

// Matches the bucket's own allow-list. A type the bucket rejects fails the upload, so it
// is caught here where the message is readable.
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
  file?: string;
  /** 1-based index of an earlier entry whose uploaded object this one should point at. */
  reuseFileOf?: number;
  subcontractorId: string;
  slotKey: string;
  title?: string;
  issuedDate?: string | null;
  expiryDate?: string | null;
  documentNumber?: string | null;
  insurer?: string | null;
  coverageAmount?: number | null;
  deductibleAmount?: number | null;
  additionalInsured?: boolean | null;
  /** Slot captures: safety_rating, monitoring_status, wcb_account, employer_rate, industry_rate. */
  fields?: Record<string, string | null>;
  /** Overrides the slot's default interval. Only meaningful on an interval slot. */
  intervalMonths?: number | null;
  /** Printed in the run report only. Not stored. */
  note?: string;
};

type CarrierRow = { id: string; tenant_id: string; legal_name: string };

/**
 * The same path shape the browser form writes.
 *
 * Tenant id leads so the bucket's folder-scoped policy applies; the carrier id sits
 * second so that if the carrier portal is switched on,
 * can_access_subcontractor_storage_path matches a carrier to its own folder and to
 * nobody else's. A file filed under the wrong carrier would be visible to the wrong
 * company, so this is not cosmetic.
 */
function storagePath(input: { tenantId: string; subcontractorId: string; slotKey: string; fileName: string; stamp: number }) {
  const safe = input.fileName.replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120);

  return `${input.tenantId}/${input.subcontractorId}/${input.slotKey}/${input.stamp}-${safe}`;
}

function parseArgs(argv: string[]) {
  const read = (flag: string) => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : undefined;
  };

  const manifest = read("--manifest");

  if (!manifest) {
    console.error("Usage: npx tsx scripts/file-subcontractor-document.ts --manifest <file.json> [--apply]");
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
  /** Path uploaded per 1-based entry number, so reuseFileOf can find it. */
  const pathByEntry = new Map<number, string>();
  let filed = 0;
  let uploaded = 0;

  // One stamp per run, so a batch lands as one set of names and a re-run is visibly a
  // different batch.
  const stamp = Date.now();
  let index = 0;

  for (const entry of entries) {
    index += 1;

    const slot = getSubcontractorSlot(entry.slotKey);

    if (!slot) {
      problems.push(`entry ${index}: ${entry.slotKey} is not a document slot`);
      continue;
    }

    const { data: carrier } = await supabase
      .from("subcontractor")
      .select("id, tenant_id, legal_name")
      .eq("id", entry.subcontractorId)
      .is("deleted_at", null)
      .maybeSingle<CarrierRow>();

    if (!carrier) {
      problems.push(`entry ${index}: no live subcontractor ${entry.subcontractorId}`);
      continue;
    }

    const title = entry.title?.trim() || slot.label;
    const issuedDate = entry.issuedDate ?? null;
    const expiryDate = entry.expiryDate ?? null;

    // The same two rules the form enforces, so a batch cannot file something the browser
    // would have refused: a slot that warns on an expiry needs one, and a slot that falls
    // due on an interval needs the date it was issued or nothing can compute the interval.
    if (slot.dueMode === "expiry" && !expiryDate) {
      problems.push(`entry ${index}: ${slot.label} needs an expiry date, or nothing can warn you before it lapses`);
      continue;
    }

    if (slot.dueMode === "interval" && !issuedDate) {
      problems.push(`entry ${index}: ${slot.label} falls due on an interval, so it needs the date it was issued`);
      continue;
    }

    // Already filed? Identified by carrier, slot, title and dates - not by storage path,
    // which carries a per-run stamp and could never match. This is what makes a corrected
    // manifest safe to replay: the entries already done are left alone.
    const { data: existing } = await supabase
      .from("subcontractor_document")
      .select("id, title, issued_date, expiry_date, storage_path, superseded_by_id")
      .eq("subcontractor_id", carrier.id)
      .eq("slot_key", slot.key)
      .is("deleted_at", null)
      .returns<
        {
          id: string;
          title: string;
          issued_date: string | null;
          expiry_date: string | null;
          storage_path: string | null;
          superseded_by_id: string | null;
        }[]
      >();

    const duplicate = existing?.find(
      (row) =>
        row.storage_path !== null &&
        row.title.trim().toLowerCase() === title.toLowerCase() &&
        row.issued_date === issuedDate &&
        row.expiry_date === (slot.dueMode === "expiry" ? expiryDate : null),
    );

    if (duplicate) {
      planned.push(`  = ${carrier.legal_name} / ${slot.label}: already filed, left alone`);
      continue;
    }

    let path: string | null = null;
    let bytes: Buffer | null = null;
    let contentType = "";

    if (entry.reuseFileOf !== undefined) {
      const reused = pathByEntry.get(entry.reuseFileOf);

      if (!reused && args.apply) {
        problems.push(`entry ${index}: reuseFileOf ${entry.reuseFileOf} has no uploaded file`);
        continue;
      }

      if (!reused && !args.apply) {
        // Nothing is uploaded on a dry run, so there is no path to point at yet. Check
        // only that the entry it names exists and comes first.
        if (entry.reuseFileOf < 1 || entry.reuseFileOf >= index || !entries[entry.reuseFileOf - 1]?.file) {
          problems.push(`entry ${index}: reuseFileOf must name an earlier entry that has a file`);
          continue;
        }
      }

      path = reused ?? "(the file from entry " + entry.reuseFileOf + ")";
    } else if (entry.file) {
      if (!existsSync(entry.file)) {
        problems.push(`entry ${index}: ${entry.file} not found`);
        continue;
      }

      const extension = extname(entry.file).toLowerCase();
      contentType = CONTENT_TYPES[extension] ?? "";

      if (!contentType) {
        problems.push(`entry ${index}: ${extension} is not a type the bucket accepts`);
        continue;
      }

      bytes = readFileSync(entry.file);

      if (bytes.byteLength > MAX_BYTES) {
        problems.push(`entry ${index}: ${(bytes.byteLength / 1024 / 1024).toFixed(1)} MB is over the 10 MB limit`);
        continue;
      }

      path = storagePath({
        tenantId: carrier.tenant_id,
        subcontractorId: carrier.id,
        slotKey: slot.key,
        fileName: basename(entry.file),
        stamp,
      });
    } else {
      problems.push(`entry ${index}: needs either file or reuseFileOf`);
      continue;
    }

    const write = buildSubcontractorDocumentWrite(
      slot,
      {
        additionalInsured: entry.additionalInsured ?? null,
        coverageAmount: entry.coverageAmount ?? null,
        deductibleAmount: entry.deductibleAmount ?? null,
        documentNumber: entry.documentNumber ?? null,
        expiryDate,
        fields: entry.fields ?? {},
        insurer: entry.insurer ?? null,
        issuedDate,
        reminderLeadDays: null,
        storagePath: path,
        title,
      },
      { intervalMonths: entry.intervalMonths ?? null },
    );

    const supersedes = existing?.filter((row) => row.superseded_by_id === null).length ?? 0;

    planned.push(
      `  + ${carrier.legal_name} / ${slot.label}: ${title}\n` +
        `      due ${write.due_date ?? "n/a"}${issuedDate ? `, issued ${issuedDate}` : ""}${
          write.expiry_date ? `, expires ${write.expiry_date}` : ""
        }${supersedes > 0 ? `, supersedes ${supersedes}` : ""}` +
        (entry.note ? `\n      (${entry.note})` : ""),
    );

    if (!args.apply) {
      continue;
    }

    if (bytes) {
      const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path!, bytes, { contentType, upsert: false });

      if (uploadError) {
        problems.push(`entry ${index}: upload failed, ${uploadError.message}`);
        continue;
      }

      uploaded += 1;
      pathByEntry.set(index, path!);
    }

    const now = new Date().toISOString();
    const { data: inserted, error } = await supabase
      .from("subcontractor_document")
      .insert({
        ...write,
        // Filed by the hiring company itself from a certificate it already accepted, so
        // there is no third party left to review it. Same reasoning as the browser form.
        review_status: "approved",
        reviewed_at: now,
        subcontractor_id: carrier.id,
        tenant_id: carrier.tenant_id,
      })
      .select("id")
      .single();

    if (error || !inserted) {
      if (bytes && path) {
        // The object is up but no row points at it. Take it back down so storage does not
        // drift from the table.
        await supabase.storage.from(BUCKET).remove([path]);
        pathByEntry.delete(index);
      }

      problems.push(`entry ${index}: write failed, ${error?.message ?? "no row returned"}`);
      continue;
    }

    filed += 1;

    // Supersede whatever this replaces, so the slot reads as one live document with a
    // history behind it rather than a pile of equally current copies.
    await supabase
      .from("subcontractor_document")
      .update({ superseded_by_id: inserted.id })
      .eq("subcontractor_id", carrier.id)
      .eq("tenant_id", carrier.tenant_id)
      .eq("slot_key", slot.key)
      .neq("id", inserted.id)
      .is("superseded_by_id", null)
      .is("deleted_at", null);

    // The captures that live on the carrier itself rather than on the document, matching
    // parentPatchFromCaptures in the server action.
    const patch: Database["public"]["Tables"]["subcontractor"]["Update"] = {};
    const captures = (capture: SubcontractorCapture) => slotCaptures(slot, capture);
    const fields = entry.fields ?? {};

    if (captures("safety_rating") && fields.safety_rating) {
      patch.safety_rating = fields.safety_rating;
    }

    if (captures("monitoring_status") && fields.monitoring_status) {
      patch.monitoring_status = fields.monitoring_status;
    }

    if (captures("wcb_account") && fields.wcb_account) {
      patch.wcb_account_number = fields.wcb_account;
    }

    if (Object.keys(patch).length > 0) {
      await supabase.from("subcontractor").update(patch).eq("id", carrier.id).eq("tenant_id", carrier.tenant_id);
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

  console.log(`Uploaded ${uploaded} file(s), filed ${filed} document(s).`);
  process.exit(problems.length > 0 ? 1 : 0);
}

void main();
