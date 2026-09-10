// Create a document row on a contracted unit and file its scan in one step.
//
// WHY THIS EXISTS. attach-contracted-unit-proof.ts answers a row that is already there:
// the contracted load put the DATES in from the carrier's equipment sheet, and that
// script hangs the certificate off the matching row. It cannot help with paperwork the
// sheet never had a column for, and a truck's folder is full of it -- the signed haul
// contract, the Samsara ELD agreement, a meter calibration, a plate photograph, a
// decibel reading, a pressure-safety-switch test. 73 such files arrived in the September
// 2026 drop against 34 trucks. There was no row to attach them to and no script to make
// one, so they had no way into the app at all.
//
// WHAT IT WRITES. One contracted_equipment_document per manifest entry, plus the object
// behind it. Almost always doc_type 'other', which carries no compliance status by
// design: a signed contract is not evidence the truck is legal to run today, and giving
// it a badge would invent a requirement nobody set. See contractedUnitOtherDocuments.
//
// WHAT IT WILL NOT DO. It will not create a second row for a document already filed --
// same unit, same title -- so a manifest can be re-run without doubling anything. And it
// does not create the UNIT. A file for a truck the app has never heard of is refused and
// named, because inventing fleet records from a folder name is how a carrier ends up
// with a unit nobody can account for.
//
// Usage:
//   npx tsx scripts/file-contracted-unit-document.ts --manifest <file.json> [--apply]
//
// Without --apply it checks everything and writes nothing. The manifest is a JSON array:
//
//   [
//     {
//       "file": "C:/.../7718 - Signed Contract - Apr 24, 2026.pdf",
//       "unitId": "00000000-0000-0000-0000-000000000000",
//       "title": "Signed contract",
//       "docType": "other",              // optional, defaults to 'other'
//       "certificationTypeId": null,     // required with 'certification', refused otherwise
//       "issuedDate": "2026-04-24",      // optional
//       "expiryDate": null,              // optional
//       "note": "why this is what it is" // printed in the report only
//     }
//   ]

import { existsSync, readFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { buildContractedStoragePath, CONTRACTED_DOCUMENTS_BUCKET } from "../src/lib/contracted-equipment";
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

// Mirrors contracted_equipment_document_doc_type_check. Kept here so a bad manifest is
// refused with a readable message instead of a constraint violation from Postgres.
const DOC_TYPES = ["registration", "insurance", "cvip", "permit", "certification", "other"] as const;

type ContractedDocType = (typeof DOC_TYPES)[number];

function isDocType(value: string): value is ContractedDocType {
  return (DOC_TYPES as readonly string[]).includes(value);
}

type ManifestEntry = {
  file: string;
  unitId: string;
  title: string;
  docType?: string;
  certificationTypeId?: string | null;
  issuedDate?: string | null;
  expiryDate?: string | null;
  note?: string;
};

type UnitRow = {
  id: string;
  unit_number: string;
  subcontractor_id: string;
  tenant_id: string;
};

function parseArgs() {
  const argv = process.argv.slice(2);
  let manifest = "";
  let apply = false;

  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--manifest") {
      manifest = argv[i + 1] ?? "";
      i += 1;
    } else if (argv[i] === "--apply") {
      apply = true;
    }
  }

  return { manifest, apply };
}

async function main() {
  loadEnv();
  const args = parseArgs();

  if (!args.manifest) {
    console.error("Usage: npx tsx scripts/file-contracted-unit-document.ts --manifest <file.json> [--apply]");
    process.exit(1);
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.");
    process.exit(1);
  }

  const supabase = createClient<Database>(url, key, { auth: { persistSession: false } });
  const entries: ManifestEntry[] = JSON.parse(readFileSync(args.manifest, "utf8"));

  console.log(`Manifest: ${args.manifest}`);
  console.log(`Entries:  ${entries.length}`);
  console.log(`Mode:     ${args.apply ? "APPLY, writing" : "check only, nothing will be written"}`);
  console.log("");

  const planned: string[] = [];
  const problems: string[] = [];
  const stamp = Date.now();
  let created = 0;
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
      problems.push(
        `${basename(entry.file)}: ${(bytes.byteLength / 1024 / 1024).toFixed(1)} MB is over the 10 MB limit`,
      );
      continue;
    }

    const title = (entry.title ?? "").trim();

    if (!title) {
      problems.push(`${basename(entry.file)}: no title. With doc_type 'other' the title IS the record.`);
      continue;
    }

    const requestedDocType = entry.docType ?? "other";

    if (!isDocType(requestedDocType)) {
      problems.push(`${basename(entry.file)}: '${requestedDocType}' is not a document type this table accepts`);
      continue;
    }

    const docType: ContractedDocType = requestedDocType;

    // A certification row is READ through its type -- contractedUnitCertificationStatuses
    // groups on certification_type_id, and the unit page shows the type's name, not the
    // title. A row with a null type is therefore invisible where it matters while still
    // counting as filed, so it is refused here rather than written and lost. Everything
    // except 'certification' must NOT carry a type, for the same reason in reverse.
    const certificationTypeId = entry.certificationTypeId ?? null;

    if (docType === "certification" && !certificationTypeId) {
      problems.push(
        `${basename(entry.file)}: doc_type 'certification' needs a certificationTypeId; without one the row never shows on the unit`,
      );
      continue;
    }

    if (docType !== "certification" && certificationTypeId) {
      problems.push(
        `${basename(entry.file)}: certificationTypeId is only meaningful with doc_type 'certification'`,
      );
      continue;
    }

    const { data: unit } = await supabase
      .from("contracted_equipment")
      .select("id, unit_number, subcontractor_id, tenant_id")
      .eq("id", entry.unitId)
      .is("deleted_at", null)
      .maybeSingle<UnitRow>();

    if (!unit) {
      problems.push(`${basename(entry.file)}: no live contracted unit ${entry.unitId}`);
      continue;
    }

    if (certificationTypeId) {
      const { data: certType } = await supabase
        .from("equipment_certification_types")
        .select("id, name")
        .eq("id", certificationTypeId)
        .eq("tenant_id", unit.tenant_id)
        .maybeSingle<{ id: string; name: string }>();

      if (!certType) {
        problems.push(
          `${basename(entry.file)}: certification type ${certificationTypeId} does not belong to this tenant`,
        );
        continue;
      }
    }

    const label = `unit ${unit.unit_number} / ${title}`;

    // Replay safety. Same unit and same title is the same record, whatever the manifest
    // is re-run against, so a second run adds nothing rather than filing a duplicate the
    // page would show twice with no way to tell them apart.
    const { data: existing } = await supabase
      .from("contracted_equipment_document")
      .select("id, attachment_ids")
      .eq("contracted_equipment_id", unit.id)
      .eq("title", title)
      .is("deleted_at", null)
      .maybeSingle<{ id: string; attachment_ids: string[] }>();

    if (existing) {
      planned.push(`  = ${label}: already filed, left alone`);
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

    planned.push(
      `  + ${label} [${docType}]` +
        (entry.issuedDate ? `\n      dated ${entry.issuedDate}` : "") +
        (entry.expiryDate ? `\n      expires ${entry.expiryDate}` : "") +
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

    const { error } = await supabase.from("contracted_equipment_document").insert({
      tenant_id: unit.tenant_id,
      contracted_equipment_id: unit.id,
      doc_type: docType,
      certification_type_id: certificationTypeId,
      title,
      issued_date: entry.issuedDate ?? null,
      expiry_date: entry.expiryDate ?? null,
      attachment_ids: [path],
    });

    if (error) {
      // The object is up but no row points at it. Take it back down rather than leave an
      // orphan nobody can find or account for.
      await supabase.storage.from(CONTRACTED_DOCUMENTS_BUCKET).remove([path]);
      problems.push(`${label}: write failed, ${error.message}`);
      continue;
    }

    created += 1;
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

  console.log(`Created ${created} document(s).`);
  process.exit(problems.length > 0 ? 1 : 0);
}

void main();
