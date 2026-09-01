// File a paper incident report from before the app existed, as a real submission.
//
// WHY THIS EXISTS. The Incidents tab is a view over submissions of any form whose name
// mentions an incident, an injury or an accident -- there is no incident table. So a
// client's incident report from 2019, sitting in a filing cabinet, can only become a
// record in this app by becoming a submission of the tenant's incident form. Filing four
// of them through the browser means re-typing them four times with no record of what came
// from which page.
//
// WHAT IT WILL NOT DO. It does not sign anything. The incident form marks a reporter
// signature as required, and there is no honest way for a batch to supply one: the person
// who signed the paper is not here, and a signature invented to satisfy a required field
// is a forgery sitting in a compliance record. These land unsigned, and the report says
// so. Anyone who wants them signed off can do it in the app, as themselves.
//
// TWO DATES, AND WHY THEY DIFFER.
//   submissions.created_at  -- when this ROW was made. Today. Left alone deliberately:
//                              the Incidents tab only reads the last 365 days by
//                              created_at, so back-dating this hides the record from the
//                              screen it was filed for.
//   submissions.submitted_at -- the day the original report was made. This is what the
//                              tab DISPLAYS, so the register reads 2019 as it should.
// The date of the event itself is a value on the form, where the form put it.
//
// Usage:
//   npx tsx scripts/file-historical-incident.ts --manifest <file.json> [--apply]
//
// Without --apply it checks everything and writes nothing. The manifest is a JSON array:
//
//   [
//     {
//       "file": "C:/.../incident 08-20-2021.pdf",    // optional, attached as the record
//       "tenantId": "0000...",
//       "formCode": "INC-RPT",
//       "reportedOn": "2021-08-20",                  // sets submitted_at
//       "answers": {                                  // keyed by the form item's LABEL
//         "Date of incident": "2021-08-20",
//         "Time of incident": "08:30",
//         "Location": "North terminal",
//         "Description of what happened": "...",
//         "Was anyone injured?": "no"
//       },
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

// Where submission attachments live, from src/lib/offline/sync.ts.
const BUCKET = "tenant-documents";

const CONTENT_TYPES: Record<string, string> = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

const MAX_BYTES = 10 * 1024 * 1024;

const YES_NO_NA = new Set(["yes", "no", "na", ""]);

type ManifestEntry = {
  file?: string;
  tenantId: string;
  formCode: string;
  reportedOn: string;
  answers: Record<string, string>;
  note?: string;
};

type FormRow = { id: string; code: string; name: string };
type ItemRow = { id: string; label: string; field_type: string; required: boolean };

function parseArgs(argv: string[]) {
  const read = (flag: string) => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : undefined;
  };

  const manifest = read("--manifest");

  if (!manifest) {
    console.error("Usage: npx tsx scripts/file-historical-incident.ts --manifest <file.json> [--apply]");
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
  let filed = 0;
  const stamp = Date.now();
  let index = 0;

  for (const entry of entries) {
    index += 1;

    const { data: form } = await supabase
      .from("forms")
      .select("id, code, name")
      .eq("tenant_id", entry.tenantId)
      .eq("code", entry.formCode)
      .maybeSingle<FormRow>();

    if (!form) {
      problems.push(`entry ${index}: no form with code ${entry.formCode} in this tenant`);
      continue;
    }

    const { data: items } = await supabase
      .from("form_items")
      .select("id, label, field_type, required")
      .eq("form_id", form.id)
      .returns<ItemRow[]>();

    const byLabel = new Map((items ?? []).map((item) => [item.label.trim().toLowerCase(), item]));

    // Every answer must name a field that exists. A typo in a label would otherwise be
    // dropped in silence, and the record would be filed missing the thing it was for.
    const unknown = Object.keys(entry.answers).filter((label) => !byLabel.has(label.trim().toLowerCase()));

    if (unknown.length > 0) {
      problems.push(`entry ${index}: ${form.code} has no field called ${unknown.map((u) => `"${u}"`).join(", ")}`);
      continue;
    }

    let invalid = false;

    for (const [label, value] of Object.entries(entry.answers)) {
      const item = byLabel.get(label.trim().toLowerCase())!;

      if ((item.field_type === "yes_no_na" || item.field_type === "yes_no") && !YES_NO_NA.has(value)) {
        problems.push(`entry ${index}: "${label}" is a yes/no/na field and got "${value}"`);
        invalid = true;
      }

      if (item.field_type === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        problems.push(`entry ${index}: "${label}" is a date field and got "${value}"`);
        invalid = true;
      }

      if (item.field_type === "time" && !/^\d{2}:\d{2}$/.test(value)) {
        problems.push(`entry ${index}: "${label}" is a time field and got "${value}"`);
        invalid = true;
      }
    }

    if (invalid) {
      continue;
    }

    const dateItem = (items ?? []).find((item) => item.field_type === "date");
    const incidentDate = dateItem ? entry.answers[dateItem.label] : undefined;

    // Replay safety. These INSERT rows, so a second run of the same manifest would
    // double the register. An incident is identified by its form and the day it
    // happened, read back out of the values rather than from anything this script holds.
    if (incidentDate && dateItem) {
      const { data: sameDay } = await supabase
        .from("submission_values")
        .select("submission_id, submissions!inner(form_id)")
        .eq("tenant_id", entry.tenantId)
        .eq("form_item_id", dateItem.id)
        .eq("value", JSON.stringify(incidentDate))
        .returns<{ submission_id: string }[]>();

      if (sameDay && sameDay.length > 0) {
        planned.push(`  = ${form.code} ${incidentDate}: already filed, left alone`);
        continue;
      }
    }

    const missing = (items ?? [])
      .filter((item) => item.required && !(item.label.trim().toLowerCase() in
        Object.fromEntries(Object.keys(entry.answers).map((k) => [k.trim().toLowerCase(), true]))))
      .map((item) => item.label);

    const label = `${form.code} ${incidentDate ?? "(no date)"} ${entry.answers.Location ?? ""}`.trim();

    planned.push(
      `  + ${label}` +
        `\n      ${Object.keys(entry.answers).length} answer(s), reported ${entry.reportedOn}` +
        (entry.file ? `\n      attaching ${basename(entry.file)}` : "\n      no document attached") +
        (missing.length > 0 ? `\n      LEFT BLANK (required on the form): ${missing.join(", ")}` : "") +
        (entry.note ? `\n      (${entry.note})` : ""),
    );

    if (!args.apply) {
      continue;
    }

    const { data: submission, error: submissionError } = await supabase
      .from("submissions")
      .insert({
        tenant_id: entry.tenantId,
        form_id: form.id,
        status: "submitted",
        // Left as the day this row was made, not the day of the incident: the Incidents
        // tab filters on created_at over the last 365 days, and a back-dated row is
        // invisible there. The original date is submitted_at, which is what it displays.
        submitted_at: `${entry.reportedOn}T12:00:00Z`,
        submitted_by: null,
        sync_state: "synced",
      })
      .select("id")
      .single<{ id: string }>();

    if (submissionError || !submission) {
      problems.push(`${label}: submission not created, ${submissionError?.message}`);
      continue;
    }

    const values = Object.entries(entry.answers).map(([answerLabel, value]) => ({
      tenant_id: entry.tenantId,
      submission_id: submission.id,
      form_item_id: byLabel.get(answerLabel.trim().toLowerCase())!.id,
      value: value as never,
    }));

    const { error: valuesError } = await supabase.from("submission_values").insert(values);

    if (valuesError) {
      await supabase.from("submissions").delete().eq("id", submission.id);
      problems.push(`${label}: answers not written, ${valuesError.message}. The submission was rolled back.`);
      continue;
    }

    if (entry.file) {
      if (!existsSync(entry.file)) {
        problems.push(`${label}: filed, but ${entry.file} was not found so nothing is attached`);
        filed += 1;
        continue;
      }

      const bytes = readFileSync(entry.file);
      const extension = extname(entry.file).toLowerCase();
      const contentType = CONTENT_TYPES[extension];

      if (!contentType) {
        problems.push(`${label}: filed, but ${extension} is not a type the bucket accepts`);
        filed += 1;
        continue;
      }

      if (bytes.byteLength > MAX_BYTES) {
        problems.push(`${label}: filed, but the document is over the 10 MB limit`);
        filed += 1;
        continue;
      }

      const safe = basename(entry.file).replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120);
      const path = `${entry.tenantId}/incidents/${stamp}-${index}-${safe}`;

      const { error: uploadError } = await supabase.storage
        .from(BUCKET)
        .upload(path, bytes, { contentType, upsert: false });

      if (uploadError) {
        problems.push(`${label}: filed, but the document did not upload, ${uploadError.message}`);
        filed += 1;
        continue;
      }

      const photoItem = (items ?? []).find((item) => item.field_type === "photo");

      const { error: photoError } = await supabase.from("submission_photos").insert({
        tenant_id: entry.tenantId,
        submission_id: submission.id,
        form_item_id: photoItem?.id ?? null,
        storage_path: path,
        caption: `Original report, filed from paper: ${basename(entry.file)}`,
      });

      if (photoError) {
        await supabase.storage.from(BUCKET).remove([path]);
        problems.push(`${label}: filed, but the document is not linked, ${photoError.message}. The upload was rolled back.`);
        filed += 1;
        continue;
      }
    }

    filed += 1;
  }

  console.log(planned.join("\n"));
  console.log("");

  if (args.apply) {
    console.log(`Filed ${filed} historical incident(s).`);
    console.log("None of them is signed. The reporter signature is required on the form and");
    console.log("was left empty on purpose: these are transcriptions of somebody else's paper.");
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

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
