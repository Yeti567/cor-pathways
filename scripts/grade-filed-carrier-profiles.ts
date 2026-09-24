// Grade the carrier profiles that were filed before the app read them.
//
// WHY THIS EXISTS. Until 2026-09-24 filing a carrier profile stored the PDF and nothing
// else unless somebody picked a rating from a dropdown, so profiles on file were never
// graded and the carriers' NSC numbers were never recorded. Uploads now read the
// profile; this does the same for what is already there.
//
// Same rule as the upload and every pack loader: fill a blank, only REPORT a conflict.
// It never changes a date, a rating or an NSC number that is already set.
//
// Usage:
//   npx tsx scripts/grade-filed-carrier-profiles.ts --tenant <uuid> [--apply] [--regrade]
//
// Without --apply it reads every profile and writes nothing. --regrade also re-reads
// profiles that already carry a grade.

import { readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  carrierProfileNamesCarrier,
  mergeCarrierProfileRead,
  readCarrierProfileFile,
} from "@/lib/carrier-profile-read";
import type { Database } from "@/types/database";

const BUCKET = "subcontractor-documents";

function loadEnv(): void {
  for (const name of [".env.local", ".env"]) {
    let text: string;

    try {
      text = readFileSync(path.join(process.cwd(), name), "utf8");
    } catch {
      continue;
    }

    for (const line of text.split(/\r?\n/)) {
      const match = /^([A-Z0-9_]+)=(.*)$/.exec(line);

      if (match && !process.env[match[1]]) {
        process.env[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
      }
    }
  }
}

function arg(name: string) {
  const index = process.argv.indexOf(name);

  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

async function main() {
  loadEnv();

  const tenantId = arg("--tenant");
  const apply = process.argv.includes("--apply");
  const regrade = process.argv.includes("--regrade");

  if (!tenantId) {
    throw new Error("Pass --tenant <uuid>.");
  }

  const supabase = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

  const { data: documents, error } = await supabase
    .from("subcontractor_document")
    .select("id, subcontractor_id, storage_path, issued_date, document_number, fields, subcontractor:subcontractor_id(legal_name, nsc_number, safety_rating, monitoring_status)")
    .eq("tenant_id", tenantId)
    .eq("slot_key", "carrier_profile")
    .is("superseded_by_id", null)
    .is("deleted_at", null)
    .not("storage_path", "is", null);

  if (error) {
    throw error;
  }

  const today = new Date().toISOString().slice(0, 10);
  console.log(`${documents.length} live carrier profiles with a file. ${apply ? "APPLYING" : "Dry run, nothing written."}\n`);

  for (const document of documents) {
    const carrier = document.subcontractor as unknown as {
      legal_name: string;
      nsc_number: string | null;
      safety_rating: string | null;
      monitoring_status: string | null;
    };
    const fields = (document.fields ?? {}) as Record<string, string | null>;

    if (fields.profile_grade && !regrade) {
      console.log(`- ${carrier.legal_name}: already graded (${fields.profile_grade}), skipped`);
      continue;
    }

    const { data: blob, error: downloadError } = await supabase.storage.from(BUCKET).download(document.storage_path!);

    if (downloadError || !blob) {
      console.log(`- ${carrier.legal_name}: COULD NOT DOWNLOAD ${document.storage_path}: ${downloadError?.message}`);
      continue;
    }

    const file = new File([await blob.arrayBuffer()], path.basename(document.storage_path!), { type: "application/pdf" });
    const { read, text } = await readCarrierProfileFile(file);
    const merged = mergeCarrierProfileRead(
      read,
      {
        issuedDate: document.issued_date,
        monitoringStatus: fields.monitoring_status ?? null,
        nscNumber: document.document_number,
        safetyRating: fields.safety_rating ?? null,
      },
      today,
    );

    if (text && !carrierProfileNamesCarrier(text, carrier.legal_name)) {
      merged.notes.push(`WARNING: the profile does not name ${carrier.legal_name}.`);
    }

    const flat = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]/g, "");

    if (merged.nscNumber && carrier.nsc_number && flat(merged.nscNumber) !== flat(carrier.nsc_number)) {
      merged.notes.push(`CONFLICT: carrier on file as NSC ${carrier.nsc_number}, profile says ${merged.nscNumber}. Not changed.`);
    }

    for (const [label, current, next] of [
      ["rating", carrier.safety_rating, merged.safetyRating],
      ["monitoring", carrier.monitoring_status, merged.monitoringStatus],
    ] as const) {
      if (current && next && current !== next) {
        merged.notes.push(`CONFLICT: carrier ${label} is ${current}, profile says ${next}. Not changed.`);
      }
    }

    console.log(`- ${carrier.legal_name}\n    ${merged.notes.join("\n    ")}`);

    if (!apply || !merged.grade) {
      continue;
    }

    const nextFields: Record<string, string | null> = { ...fields, ...merged.extraFields };

    if (merged.safetyRating) nextFields.safety_rating = merged.safetyRating;
    if (merged.monitoringStatus) nextFields.monitoring_status = merged.monitoringStatus;

    const { error: documentError } = await supabase
      .from("subcontractor_document")
      .update({
        document_number: document.document_number ?? merged.nscNumber,
        fields: nextFields,
        // Only fill a missing issue date. The due date was derived from the one on file.
        ...(document.issued_date ? {} : { issued_date: merged.issuedDate }),
      })
      .eq("id", document.id)
      .eq("tenant_id", tenantId);

    const parentPatch: Database["public"]["Tables"]["subcontractor"]["Update"] = {};

    if (!carrier.nsc_number && merged.nscNumber) parentPatch.nsc_number = merged.nscNumber;
    if (!carrier.safety_rating && merged.safetyRating) parentPatch.safety_rating = merged.safetyRating;
    if (!carrier.monitoring_status && merged.monitoringStatus) parentPatch.monitoring_status = merged.monitoringStatus;

    const { error: parentError } =
      Object.keys(parentPatch).length > 0
        ? await supabase.from("subcontractor").update(parentPatch).eq("id", document.subcontractor_id).eq("tenant_id", tenantId)
        : { error: null };

    console.log(
      `    written: document ${documentError ? `FAILED ${documentError.message}` : "ok"}; carrier ${
        parentError ? `FAILED ${parentError.message}` : Object.keys(parentPatch).join(", ") || "nothing to fill"
      }`,
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
