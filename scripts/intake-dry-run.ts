// Dry run of document intake against a real pile of files.
//
// WHAT IT DOES. Reads every PDF and photo in a folder (and inside any zip in it) with the
// same reader, text-layer cross-check, unit matcher and filing planner the Document Intake
// page uses, matches each against a client's real fleet, and writes a report of what it
// WOULD do with each file. That is the whole point: judge the technique on real paperwork
// before it is allowed anywhere near a record.
//
// WHAT IT NEVER DOES. It writes nothing to the database and nothing to storage. The only
// calls it makes to Supabase are SELECTs, and the only thing it writes anywhere is the
// report on this machine. It files nothing and it deletes nothing, including your source
// files.
//
// WHERE THE DATA GOES. Each file is sent to OpenRouter and the model's provider to be
// read. That is the one place a client's paperwork leaves this machine, and it is the
// reason to try a small --limit first.
//
// Usage (run from the app folder; any client's app can supply --env):
//   npx tsx scripts/intake-dry-run.ts --folder <dir> --env <client app>/.env.local \
//     [--tenant <slug|uuid|name>] [--sample 10 | --limit 10] [--out <report dir>] [--concurrency 4]
//
// --env supplies the client's Supabase connection (read only, never printed). The OpenRouter
// key and model come from this machine's environment, or from the same file. --limit reads
// only the first N files, which is how a first run should go.
//
// The report holds VINs, plates and unit numbers read off the documents. It is written
// under the system temp folder unless --out says otherwise. Keep it off any synced or
// shared folder, and delete it when you are done.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, extname, join, relative } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { unzipSync } from "fflate";
import { readDocument, intakeModel, isIntakeReaderConfigured } from "../src/lib/document-intake/extract";
import { groundExtraction } from "../src/lib/document-intake/ground";
import {
  applyPathHint,
  matchUnit,
  unitHintFromPath,
  type MatchableUnit,
  type UnitMatch,
} from "../src/lib/document-intake/match";
import { planFiling, type PlanUnitDocument } from "../src/lib/document-intake/plan";
import { readPdfTextLayer } from "../src/lib/document-intake/pdf-text";
import { secondOpinion } from "../src/lib/document-intake/verify";
import { INTAKE_MAX_BYTES } from "../src/lib/document-intake/storage";

type Args = {
  concurrency: number;
  env: string;
  folder: string;
  limit: number | null;
  out: string | null;
  sample: number | null;
  tenant: string | null;
};

function parseArgs(argv: string[]): Args {
  const take = (flag: string) => {
    const index = argv.indexOf(flag);
    return index >= 0 ? (argv[index + 1] ?? null) : null;
  };
  const folder = take("--folder");
  const env = take("--env");

  if (!folder || !env) {
    console.error("Usage: npx tsx scripts/intake-dry-run.ts --folder <dir> --env <.env.local> [--tenant x] [--limit N] [--out dir]");
    process.exit(2);
  }

  const limit = take("--limit");
  const sample = take("--sample");
  const concurrency = take("--concurrency");

  return {
    concurrency: concurrency ? Math.max(1, Math.min(8, Number(concurrency) || 4)) : 4,
    env,
    folder,
    limit: limit ? Math.max(1, Number(limit) || 1) : null,
    out: take("--out"),
    sample: sample ? Math.max(1, Number(sample) || 1) : null,
    tenant: take("--tenant"),
  };
}

/** Minimal env file reader. Sets only what is not already set, and never echoes a value. */
function loadEnvFile(path: string) {
  if (!existsSync(path)) {
    console.error(`Env file not found: ${path}`);
    process.exit(2);
  }

  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);

    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
    }
  }
}

const MIME_BY_EXTENSION: Record<string, string> = {
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".webp": "image/webp",
};
const IGNORED = /(^|[\\/])(__MACOSX|\.DS_Store|Thumbs\.db|desktop\.ini)([\\/]|$)|(^|[\\/])\._|(^|[\\/])_intake-report/i;

type SourceFile = { bytes: Uint8Array; mimeType: string; name: string };
type Skipped = { name: string; reason: string };

function collect(folder: string): { files: SourceFile[]; skipped: Skipped[] } {
  const files: SourceFile[] = [];
  const skipped: Skipped[] = [];

  function add(name: string, bytes: Uint8Array) {
    const mimeType = MIME_BY_EXTENSION[extname(name).toLowerCase()];

    if (!mimeType) {
      skipped.push({ name, reason: "not a PDF or photo" });
    } else if (bytes.byteLength === 0 || bytes.byteLength > INTAKE_MAX_BYTES) {
      skipped.push({ name, reason: bytes.byteLength === 0 ? "empty" : "larger than 10 MB" });
    } else {
      files.push({ bytes, mimeType, name });
    }
  }

  function walk(directory: string) {
    for (const entry of readdirSync(directory)) {
      const full = join(directory, entry);
      const name = relative(folder, full);

      if (IGNORED.test(name)) {
        continue;
      }

      if (statSync(full).isDirectory()) {
        walk(full);
      } else if (extname(entry).toLowerCase() === ".zip") {
        try {
          const entries = unzipSync(new Uint8Array(readFileSync(full)), {
            filter: (item) => !item.name.endsWith("/") && !IGNORED.test(item.name),
          });

          for (const [inner, data] of Object.entries(entries)) {
            add(`${name}/${inner}`, data);
          }
        } catch {
          skipped.push({ name, reason: "zip could not be opened" });
        }
      } else {
        add(name, new Uint8Array(readFileSync(full)));
      }
    }
  }

  walk(folder);
  return { files, skipped };
}

async function pagedSelect<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>) {
  const rows: T[] = [];

  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999);

    if (error) {
      throw new Error(error.message);
    }

    rows.push(...(data ?? []));

    if (!data || data.length < 1000) {
      return rows;
    }
  }
}

function csvCell(value: unknown) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  loadEnvFile(args.env);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    console.error("The env file has no Supabase URL and service key.");
    process.exit(2);
  }

  if (!isIntakeReaderConfigured()) {
    console.error("The reader is not configured: it needs OPENROUTER_API_KEY and a model (OPENROUTER_FORM_IMPORT_MODEL).");
    process.exit(2);
  }

  // Read only, by construction: this client is only ever asked to select.
  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

  const { data: tenants, error: tenantError } = await supabase.from("tenants").select("id, name, slug");

  if (tenantError || !tenants || tenants.length === 0) {
    console.error("Could not read the company list.");
    process.exit(1);
  }

  const wanted = args.tenant?.toLowerCase();
  const tenant =
    tenants.length === 1 && !wanted
      ? tenants[0]
      : tenants.find((entry) => entry.id === args.tenant || entry.slug.toLowerCase() === wanted || entry.name.toLowerCase() === wanted);

  if (!tenant) {
    console.error(`Which company? Pass --tenant. Choices: ${tenants.map((entry) => entry.slug).join(", ")}`);
    process.exit(2);
  }

  const [fleet, contractedFleet, ownDocs, contractedDocs, certTypes] = await Promise.all([
    pagedSelect<MatchableUnit>((from, to) =>
      supabase.from("equipment").select("id, unit_number, vin_or_serial, license_plate").eq("tenant_id", tenant.id).is("deleted_at", null).range(from, to),
    ),
    pagedSelect<MatchableUnit>((from, to) =>
      supabase.from("contracted_equipment").select("id, unit_number, vin_or_serial, license_plate").eq("tenant_id", tenant.id).is("deleted_at", null).range(from, to),
    ),
    pagedSelect<PlanUnitDocument & { equipment_id: string }>((from, to) =>
      supabase
        .from("equipment_document")
        .select("id, equipment_id, doc_type, certification_type_id, title, issued_date, expiry_date, attachment_ids, is_active")
        .eq("tenant_id", tenant.id)
        .is("deleted_at", null)
        .range(from, to),
    ),
    pagedSelect<PlanUnitDocument & { contracted_equipment_id: string }>((from, to) =>
      supabase
        .from("contracted_equipment_document")
        .select("id, contracted_equipment_id, doc_type, certification_type_id, title, issued_date, expiry_date, attachment_ids, is_active")
        .eq("tenant_id", tenant.id)
        .is("deleted_at", null)
        .range(from, to),
    ),
    pagedSelect<{ id: string; name: string }>((from, to) =>
      supabase.from("equipment_certification_types").select("id, name").eq("tenant_id", tenant.id).range(from, to),
    ),
  ]);

  const docsByUnit = new Map<string, PlanUnitDocument[]>();
  for (const doc of ownDocs) {
    docsByUnit.set(doc.equipment_id, [...(docsByUnit.get(doc.equipment_id) ?? []), doc]);
  }
  for (const doc of contractedDocs) {
    docsByUnit.set(doc.contracted_equipment_id, [...(docsByUnit.get(doc.contracted_equipment_id) ?? []), doc]);
  }

  const unitById = new Map([...fleet, ...contractedFleet].map((unit) => [unit.id, unit]));
  const collected = collect(args.folder);
  // --sample N takes N files spread evenly across the whole pile, so a first pass covers
  // many units instead of the first zip. --limit N takes the first N in order.
  const sorted = [...collected.files].sort((a, b) => a.name.localeCompare(b.name));
  const files = args.sample
    ? sorted.length <= args.sample
      ? sorted
      : Array.from({ length: args.sample }, (_, index) => sorted[Math.floor((index * sorted.length) / args.sample!)])
    : args.limit
      ? sorted.slice(0, args.limit)
      : sorted;

  console.log(`Company: ${tenant.name}`);
  console.log(`Fleet on file: ${fleet.length} own units, ${contractedFleet.length} contracted units`);
  console.log(`Files found: ${collected.files.length} readable, ${collected.skipped.length} skipped. Reading ${files.length} with ${intakeModel()}.`);

  const today = new Date().toISOString().slice(0, 10);
  const seen = new Map<string, string>();
  const rows: Record<string, unknown>[] = [];
  let done = 0;
  let cursor = 0;

  async function work(file: SourceFile) {
    const sha = createHash("sha256").update(file.bytes).digest("hex");
    const base = { file: file.name, size_kb: Math.round(file.bytes.byteLength / 1024) };

    if (seen.has(sha)) {
      rows.push({ ...base, status: "duplicate", reasons: `Same file as ${seen.get(sha)}` });
      return;
    }

    seen.set(sha, file.name);
    const outcome = await readDocument({
      bytes: file.bytes,
      certificationTypeNames: certTypes.map((type) => type.name),
      fileName: basename(file.name),
      mimeType: file.mimeType,
    });

    if (!outcome.ok) {
      rows.push({ ...base, status: outcome.needsPerson ? "needs_review" : "failed", reasons: outcome.reason });
      return;
    }

    const { extraction } = outcome;
    const textLayer = file.mimeType === "application/pdf" ? await readPdfTextLayer(file.bytes) : null;
    const grounding = groundExtraction(extraction, textLayer);
    const ids = { license_plate: extraction.license_plate, unit_number: extraction.unit_number, vin: extraction.vin };

    let match: UnitMatch = matchUnit(ids, fleet);
    let fleetKind = "own";

    // Nothing in the company's own fleet: it may belong to a hired carrier's unit.
    if (match.status === "none") {
      const contracted = matchUnit(ids, contractedFleet);

      if (contracted.status !== "none") {
        match = contracted;
        fleetKind = "contracted";
      }
    }

    // Then the folder or file name the client chose: it can suggest a unit or contradict a match.
    const activeFleet = fleetKind === "own" ? fleet : contractedFleet;
    match = applyPathHint(match, unitHintFromPath(file.name, activeFleet), activeFleet);

    const plan = planFiling({
      certificationTypes: certTypes,
      extraction,
      grounding,
      match,
      today,
      unitDocuments: match.equipmentId ? (docsByUnit.get(match.equipmentId) ?? []) : [],
    });

    // Same rule as the app: a file about to be one click is read again, and stays ready only
    // if the two readings agree. A PDF whose values were found in its own text skips it.
    const foundInText = grounding.checked && grounding.lookedUp > 0;
    let ready = plan.ready;
    let reasons = plan.reasons;
    let confirmation = foundInText ? "PDF text" : "none (scan)";

    if (plan.ready && !foundInText) {
      const opinion = await secondOpinion({
        first: extraction,
        read: () =>
          readDocument({
            bytes: file.bytes,
            certificationTypeNames: certTypes.map((type) => type.name),
            fileName: basename(file.name),
            mimeType: file.mimeType,
          }),
      });

      if (opinion.agrees) {
        confirmation = "read twice, agreed";
      } else {
        ready = false;
        reasons = [...reasons, opinion.reason];
      }
    }

    rows.push({
      ...base,
      action: plan.proposal.action,
      checked_against_text: confirmation,
      confidence: extraction.confidence.toFixed(2),
      doc_type: plan.proposal.docType ?? extraction.document_kind,
      expiry: plan.proposal.expiryDate,
      fleet: match.equipmentId ? fleetKind : "",
      issued: plan.proposal.issuedDate,
      kind_read: extraction.document_kind,
      match_strength: match.status === "matched" ? match.strength : match.status,
      notes: plan.notes.join(" | "),
      plate_read: extraction.license_plate,
      reasons: reasons.join(" | "),
      status: ready ? "ready" : "needs_review",
      unit: match.equipmentId ? unitById.get(match.equipmentId)?.unit_number : "",
      vin_read: extraction.vin,
    });
  }

  async function lane() {
    while (cursor < files.length) {
      const file = files[cursor++];

      try {
        await work(file);
      } catch {
        rows.push({ file: file.name, reasons: "Unexpected error while processing this file.", status: "failed" });
      }

      done += 1;

      if (done % 10 === 0 || done === files.length) {
        console.log(`  ${done}/${files.length}`);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(args.concurrency, files.length) }, lane));

  for (const skipped of collected.skipped) {
    rows.push({ file: skipped.name, reasons: `Not read: ${skipped.reason}`, status: "skipped" });
  }

  rows.sort((a, b) => String(a.file).localeCompare(String(b.file)));

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const out = args.out ?? join(tmpdir(), "intake-reports",`${tenant.slug}-${stamp}`);
  mkdirSync(out, { recursive: true });

  const columns = [
    "file", "status", "kind_read", "doc_type", "unit", "fleet", "match_strength", "action", "issued", "expiry",
    "confidence", "checked_against_text", "vin_read", "plate_read", "reasons", "notes", "size_kb",
  ];
  writeFileSync(
    join(out, "report.csv"),
    [columns.join(","), ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(","))].join("\r\n"),
  );

  const count = (predicate: (row: Record<string, unknown>) => boolean) => rows.filter(predicate).length;
  const byStatus = (status: string) => count((row) => row.status === status);
  const reasonCounts = new Map<string, number>();

  for (const row of rows) {
    for (const reason of String(row.reasons ?? "").split(" | ").filter(Boolean)) {
      const key = reason.replace(/\(.*?\)/g, "(…)").replace(/\d{4}-\d{2}-\d{2}/g, "<date>").replace(/\d+%/g, "N%");
      reasonCounts.set(key, (reasonCounts.get(key) ?? 0) + 1);
    }
  }

  const summary = [
    `# Document intake dry run: ${tenant.name}`,
    "",
    `Run ${new Date().toISOString()} with ${intakeModel()}. Nothing was filed, written or deleted.`,
    "",
    `Files read: ${files.length} of ${collected.files.length} found (${collected.skipped.length} skipped as unreadable types or sizes).`,
    "",
    "| Result | Files |",
    "|---|---|",
    `| Ready to file | ${byStatus("ready")} |`,
    `| Needs a person | ${byStatus("needs_review")} |`,
    `| Failed to read | ${byStatus("failed")} |`,
    `| Duplicates of another file | ${byStatus("duplicate")} |`,
    `| Not read | ${byStatus("skipped")} |`,
    "",
    `Matched to an own unit: ${count((row) => row.fleet === "own")}. Matched to a hired carrier's unit: ${count((row) => row.fleet === "contracted")} (document intake does not file these yet). No unit found: ${count((row) => row.match_strength === "none")}.`,
    `Confirmed against the PDF's own text: ${count((row) => row.checked_against_text === "PDF text")}. Read twice and agreed: ${count((row) => row.checked_against_text === "read twice, agreed")}. Scans with no extra confirmation: ${count((row) => row.checked_against_text === "none (scan)")}.`,
    "",
    "## Why files needed a person",
    "",
    ...[...reasonCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([reason, n]) => `- ${n} x ${reason}`),
    "",
    "The per-file detail is in report.csv. This folder holds VINs and plates read off the documents; delete it when finished.",
  ].join("\n");
  writeFileSync(join(out, "summary.md"), summary);

  console.log("");
  console.log(`Ready ${byStatus("ready")} | Needs a person ${byStatus("needs_review")} | Failed ${byStatus("failed")} | Duplicates ${byStatus("duplicate")} | Not read ${byStatus("skipped")}`);
  console.log(`Report: ${out}`);
}

main().catch((error) => {
  // The class only: a message can echo request detail, and these are a client's documents.
  console.error("Dry run stopped:", error instanceof Error ? error.name : "unknown error");
  process.exit(1);
});
