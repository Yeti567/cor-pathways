// File a batch of clients' audits and evaluations of a contracted driver.
//
// WHY THIS EXISTS. These arrive as a folder of emailed PDFs -- a client's people watch a
// driver unload and send the write-up to safety@. One carrier's pack held nine of them
// for one driver, spanning fifteen months. They are the record of how a driver actually
// works on somebody else's site, and until contracted_driver_observation there was
// nowhere in the app to keep one.
//
// WHY IT IS NOT attach-contracted-driver-proof. That script attaches a scan to a record
// that already exists and is reading amber for want of proof. Here there is no record to
// attach to: the observation IS the row, and the PDF is only what it says. So this one
// creates rows, and it is the only loader in this folder that does.
//
// THAT MAKES REPLAY SAFETY THE WHOLE PROBLEM. A second --apply of the same manifest must
// not double the history. An observation is identified by driver, kind, title and the day
// the work was watched -- not by its storage path, which carries a per-run stamp and
// could never match. Two genuinely different audits of the same type on the same day by
// two observers do exist, and this will refuse the second as a duplicate; file that one
// through the browser, where a person can see what they are adding.
//
// WHAT IT DOES NOT DO. It does not read the documents. Every field in the manifest is
// transcribed by a person who has read the report -- and these have to be read, because
// the observed date is routinely not the date in the filename or the date the email was
// sent, and the filename does not say whether the report granted access or took it away.
// In the first batch a report filed as "Aug 14, 2026" describes work watched on the 12th,
// and a file named only "Audit Report PPE" is the one that cut a driver to 8am-4pm.
//
// Usage:
//   npx tsx scripts/file-contracted-driver-observation.ts --manifest <file.json> [--apply]
//
// Without --apply it checks everything and writes nothing. The manifest is a JSON array:
//
//   [
//     {
//       "file": "C:/.../Audit Report PPE - Aug 14, 2026.pdf",   // optional
//       "driverId": "00000000-0000-0000-0000-000000000000",
//       "observationType": "audit",              // audit | evaluation
//       "title": "PPE audit",
//       "observedOn": "2026-08-12",              // the day the work was watched
//       "reportedOn": "2026-08-14",              // when the write-up came, if later
//       "issuingCompany": "Northgate Terminals",
//       "observer": "the observer, as the report writes it",
//       "location": "Truck Unload",
//       "outcome": "clear",                      // clear | deficiencies | failed
//       "siteAccess": "unlimited",               // only where the report states one
//       "findings": "...",
//       "actionTaken": "...",
//       "note": "printed in the report only"
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

// Matches CONTRACTED_ATTACHMENT_MIME_TYPES and the bucket's own allow-list.
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

const TYPES = ["audit", "evaluation"] as const;
const OUTCOMES = ["clear", "deficiencies", "failed"] as const;
const ACCESS_LEVELS = ["unlimited", "limited", "suspended"] as const;

type ObservationType = (typeof TYPES)[number];
type Outcome = (typeof OUTCOMES)[number];
type AccessLevel = (typeof ACCESS_LEVELS)[number];

type ManifestEntry = {
  file?: string;
  driverId: string;
  observationType: ObservationType;
  title: string;
  observedOn: string;
  reportedOn?: string | null;
  issuingCompany?: string | null;
  observer?: string | null;
  location?: string | null;
  outcome: Outcome;
  siteAccess?: AccessLevel | null;
  findings?: string | null;
  actionTaken?: string | null;
  /** Printed in the run report only. Not stored. */
  note?: string;
};

type DriverRow = { id: string; full_name: string; subcontractor_id: string; tenant_id: string };

function parseArgs(argv: string[]) {
  const read = (flag: string) => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : undefined;
  };

  const manifest = read("--manifest");

  if (!manifest) {
    console.error("Usage: npx tsx scripts/file-contracted-driver-observation.ts --manifest <file.json> [--apply]");
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
  let uploaded = 0;
  let filed = 0;

  // One stamp per run, so a batch lands as one set of names and a re-run is visibly a
  // different batch.
  const stamp = Date.now();
  let index = 0;

  for (const entry of entries) {
    index += 1;

    if (!TYPES.includes(entry.observationType)) {
      problems.push(`entry ${index}: observationType must be audit or evaluation`);
      continue;
    }

    if (!OUTCOMES.includes(entry.outcome)) {
      problems.push(`entry ${index}: outcome must be clear, deficiencies or failed`);
      continue;
    }

    if (!entry.title?.trim()) {
      problems.push(`entry ${index}: needs a title -- whatever the report calls itself`);
      continue;
    }

    // The index of the whole record. Checked here rather than left to the not-null
    // constraint so the message names the entry.
    if (!DATE.test(entry.observedOn ?? "")) {
      problems.push(`entry ${index}: observedOn must be the yyyy-mm-dd the work was watched`);
      continue;
    }

    if (entry.reportedOn && !DATE.test(entry.reportedOn)) {
      problems.push(`entry ${index}: reportedOn is not a date`);
      continue;
    }

    if (entry.siteAccess && !ACCESS_LEVELS.includes(entry.siteAccess)) {
      problems.push(`entry ${index}: siteAccess must be unlimited, limited or suspended`);
      continue;
    }

    const { data: driver } = await supabase
      .from("contracted_driver")
      .select("id, full_name, subcontractor_id, tenant_id")
      .eq("id", entry.driverId)
      .is("deleted_at", null)
      .maybeSingle<DriverRow>();

    if (!driver) {
      problems.push(`entry ${index}: no live driver ${entry.driverId}`);
      continue;
    }

    const label = `${driver.full_name} / ${entry.title} (${entry.observedOn})`;

    // Already filed? By driver, kind, title and the day observed. See the header for why
    // this and not the storage path.
    const { data: existing } = await supabase
      .from("contracted_driver_observation")
      .select("id")
      .eq("contracted_driver_id", driver.id)
      .eq("observation_type", entry.observationType)
      .eq("observed_on", entry.observedOn)
      .ilike("title", entry.title.trim())
      .is("deleted_at", null)
      .returns<{ id: string }[]>();

    if (existing && existing.length > 0) {
      planned.push(`  = ${label}: already filed, left alone`);
      continue;
    }

    let path: string | null = null;
    let bytes: Buffer | null = null;
    let contentType = "";

    if (entry.file) {
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

      path = buildContractedStoragePath({
        tenantId: driver.tenant_id,
        subcontractorId: driver.subcontractor_id,
        subjectId: driver.id,
        scope: "contracted-drivers",
        fileName: basename(entry.file),
        index,
        now: stamp,
      });
    }

    planned.push(
      `  + ${label}\n` +
        `      ${entry.observationType}, ${entry.outcome}` +
        (entry.siteAccess ? `, access ${entry.siteAccess}` : "") +
        (entry.issuingCompany ? `, ${entry.issuingCompany}` : "") +
        (path ? "" : ", NO REPORT ATTACHED") +
        (entry.note ? `\n      (${entry.note})` : ""),
    );

    if (!args.apply) {
      continue;
    }

    if (bytes && path) {
      const { error: uploadError } = await supabase.storage
        .from(CONTRACTED_DOCUMENTS_BUCKET)
        .upload(path, bytes, { contentType, upsert: false });

      if (uploadError) {
        problems.push(`entry ${index}: upload failed, ${uploadError.message}`);
        continue;
      }

      uploaded += 1;
    }

    const { error } = await supabase.from("contracted_driver_observation").insert({
      tenant_id: driver.tenant_id,
      contracted_driver_id: driver.id,
      observation_type: entry.observationType,
      title: entry.title.trim(),
      observed_on: entry.observedOn,
      reported_on: entry.reportedOn ?? null,
      issuing_company: entry.issuingCompany ?? null,
      observer: entry.observer ?? null,
      location: entry.location ?? null,
      outcome: entry.outcome,
      site_access: entry.siteAccess ?? null,
      findings: entry.findings ?? null,
      action_taken: entry.actionTaken ?? null,
      attachment_path: path,
    });

    if (error) {
      if (path && bytes) {
        // The file is up but no row points at it. Take it back down so a failed run does
        // not leave an orphan nobody can find or account for.
        await supabase.storage.from(CONTRACTED_DOCUMENTS_BUCKET).remove([path]);
      }

      problems.push(`${label}: write failed, ${error.message}`);
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

  console.log(`Uploaded ${uploaded} report(s), filed ${filed} observation(s).`);
  process.exit(problems.length > 0 ? 1 : 0);
}

void main();
