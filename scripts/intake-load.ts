// Load a pile of unit paperwork through Document Intake from this machine, using exactly the
// code the /admin/intake page uses. Nothing here decides anything the page does not.
//
// WHY A SCRIPT. The page takes files from a browser. A pile on disk (zips per trailer) is the
// same job; this puts the files where the page's uploader would, queues the same rows, runs
// the same reader (processQueuedIntake), and files through the same function (fileIntakeRow)
// with the same audit trail. A record filed here cannot be told from one filed on the page.
//
// STAGES, run one at a time, each safe to repeat:
//   --stage    upload every readable file in --folder (and inside its zips) to the tenant's
//              intake folder and queue it under a new batch. Prints the batch id.
//   --process  read everything queued in --batch, a few at a time, until none is left.
//   --report   write the batch's state (status, unit, proposal, reasons) to --out as CSV.
//   --file-ready      file every row the reader marked ready, exactly as proposed.
//   --file-decisions  file rows per a JSON list of decisions a person made:
//              [{ "intakeId", "equipmentId", "docType", "certificationTypeId", "targetDocumentId",
//                 "title", "issuedDate", "expiryDate" }]
//
// Required: --env <client .env.local> --tenant <uuid> --actor <app user id of the approver>.
// The report holds VINs and plates; keep it in a local folder that is not synced to any cloud, and delete it after.

import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { unzipSync } from "fflate";
import type { Database, Json } from "../src/types/database";
import { fileIntakeRow, type FilingDecision } from "../src/lib/document-intake/file";
import type { GroundingResult } from "../src/lib/document-intake/ground";
import {
  applyPathHint,
  expiryHintFromName,
  matchUnit,
  unitHintFromPath,
  type MatchableUnit,
} from "../src/lib/document-intake/match";
import { planFiling, type EquipmentDocType, type FilingProposal, type PlanUnitDocument } from "../src/lib/document-intake/plan";
import type { IntakeExtraction } from "../src/lib/document-intake/schema";
import { processQueuedIntake } from "../src/lib/document-intake/process";
import { buildIntakeStoragePath, INTAKE_BUCKET, INTAKE_MAX_BYTES } from "../src/lib/document-intake/storage";

type Supabase = SupabaseClient<Database>;
type IntakeRow = Database["public"]["Tables"]["document_intake"]["Row"];

const argv = process.argv.slice(2);
const take = (flag: string) => {
  const index = argv.indexOf(flag);
  return index >= 0 ? (argv[index + 1] ?? null) : null;
};
const has = (flag: string) => argv.includes(flag);

function loadEnvFile(path: string) {
  if (!existsSync(path)) {
    throw new Error(`Env file not found: ${path}`);
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
const IGNORED = /(^|[\\/])(__MACOSX|\.DS_Store|Thumbs\.db|desktop\.ini)([\\/]|$)|(^|[\\/])\._/i;

function collect(folder: string) {
  const files: { bytes: Uint8Array; mimeType: string; name: string }[] = [];
  const skipped: { name: string; reason: string }[] = [];

  const add = (name: string, bytes: Uint8Array) => {
    const mimeType = MIME_BY_EXTENSION[extname(name).toLowerCase()];

    if (!mimeType) {
      skipped.push({ name, reason: "not a PDF or photo" });
    } else if (bytes.byteLength === 0 || bytes.byteLength > INTAKE_MAX_BYTES) {
      skipped.push({ name, reason: bytes.byteLength === 0 ? "empty" : "too large" });
    } else {
      files.push({ bytes, mimeType, name: name.replace(/\\/g, "/") });
    }
  };

  const walk = (directory: string) => {
    for (const entry of readdirSync(directory)) {
      const full = join(directory, entry);
      const name = relative(folder, full);

      if (IGNORED.test(name) || /\.md$/i.test(entry)) {
        continue;
      }

      if (statSync(full).isDirectory()) {
        walk(full);
      } else if (extname(entry).toLowerCase() === ".zip") {
        const entries = unzipSync(new Uint8Array(readFileSync(full)), {
          filter: (item) => !item.name.endsWith("/") && !IGNORED.test(item.name),
        });

        for (const [inner, data] of Object.entries(entries)) {
          add(`${name}/${inner}`, data);
        }
      } else {
        add(name, new Uint8Array(readFileSync(full)));
      }
    }
  };

  walk(folder);
  return { files, skipped };
}

async function batchRows(supabase: Supabase, tenantId: string, batchId: string) {
  const rows: IntakeRow[] = [];

  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("document_intake")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("batch_id", batchId)
      .order("original_name", { ascending: true })
      .range(from, from + 999)
      .returns<IntakeRow[]>();

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
  const text = value === null || value === undefined ? "" : typeof value === "string" ? value : JSON.stringify(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

async function main() {
  const env = take("--env");
  const tenantId = take("--tenant");
  const actorId = take("--actor");

  if (!env || !tenantId || !actorId) {
    throw new Error("Usage: --env <.env.local> --tenant <uuid> --actor <user id> and one stage flag.");
  }

  loadEnvFile(env);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!url || !serviceKey) {
    throw new Error("The env file has no Supabase URL and service key.");
  }

  const supabase = createClient<Database>(url, serviceKey, { auth: { persistSession: false } });

  const { data: actor } = await supabase
    .from("users")
    .select("id, power_level, tenant_id")
    .eq("id", actorId)
    .eq("tenant_id", tenantId)
    .maybeSingle<{ id: string; power_level: string; tenant_id: string }>();

  if (!actor) {
    throw new Error("The actor is not a user of this tenant.");
  }

  if (has("--stage")) {
    const folder = take("--folder");

    if (!folder) {
      throw new Error("--stage needs --folder.");
    }

    const { files, skipped } = collect(folder);
    const batchId = randomUUID();
    let queued = 0;

    for (const [index, file] of files.entries()) {
      const path = buildIntakeStoragePath({ batchId, fileName: file.name.split("/").pop() ?? file.name, index, tenantId });
      const { error: uploadError } = await supabase.storage
        .from(INTAKE_BUCKET)
        .upload(path, file.bytes, { contentType: file.mimeType, upsert: false });

      if (uploadError) {
        skipped.push({ name: file.name, reason: `upload failed: ${uploadError.message}` });
        continue;
      }

      const { error } = await supabase.from("document_intake").insert({
        batch_id: batchId,
        mime_type: file.mimeType,
        original_name: file.name.slice(0, 300),
        size_bytes: file.bytes.byteLength,
        status: "queued",
        storage_path: path,
        subject: "unit",
        tenant_id: tenantId,
        uploaded_by: actor.id,
      });

      if (error) {
        await supabase.storage.from(INTAKE_BUCKET).remove([path]);
        skipped.push({ name: file.name, reason: `queue failed: ${error.message}` });
        continue;
      }

      queued += 1;
    }

    console.log(JSON.stringify({ batchId, found: files.length, queued, skipped }, null, 1));
    return;
  }

  const batchId = take("--batch");

  if (!batchId) {
    throw new Error("This stage needs --batch.");
  }

  if (has("--process")) {
    for (let round = 1; ; round += 1) {
      const result = await processQueuedIntake({ batchId, concurrency: 6, limit: 6, supabase, tenantId });
      console.log(`round ${round}: read ${result.processed}, ${result.remaining} left`);

      if (result.remaining === 0 || result.processed === 0) {
        break;
      }
    }

    return;
  }

  // Re-runs the planner over rows already marked ready, from what was already read, so a
  // planner fix made after reading applies without reading the files again. It only ever
  // takes a row OUT of ready: a row the reader held stays held.
  if (has("--recheck-ready")) {
    const rows = (await batchRows(supabase, tenantId, batchId)).filter((row) => row.status === "ready");
    const [{ data: fleet }, { data: certificationTypes }] = await Promise.all([
      supabase.from("equipment").select("id, unit_number, vin_or_serial, license_plate").eq("tenant_id", tenantId).is("deleted_at", null).returns<MatchableUnit[]>(),
      supabase.from("equipment_certification_types").select("id, name").eq("tenant_id", tenantId).returns<{ id: string; name: string }[]>(),
    ]);
    let demoted = 0;

    for (const row of rows) {
      const extraction = row.extraction as unknown as IntakeExtraction & { grounding?: GroundingResult };
      const match = applyPathHint(
        matchUnit({ license_plate: extraction.license_plate, unit_number: extraction.unit_number, vin: extraction.vin }, fleet ?? []),
        unitHintFromPath(row.original_name, fleet ?? []),
        fleet ?? [],
      );
      const { data: unitDocuments } = match.equipmentId
        ? await supabase
            .from("equipment_document")
            .select("id, doc_type, certification_type_id, title, issued_date, expiry_date, attachment_ids, is_active")
            .eq("tenant_id", tenantId)
            .eq("equipment_id", match.equipmentId)
            .is("deleted_at", null)
            .returns<PlanUnitDocument[]>()
        : { data: [] as PlanUnitDocument[] };
      const plan = planFiling({
        certificationTypes: certificationTypes ?? [],
        expiryHint: expiryHintFromName(row.original_name),
        extraction,
        grounding: extraction.grounding ?? null,
        match,
        today: new Date().toISOString().slice(0, 10),
        unitDocuments: unitDocuments ?? [],
      });

      if (!plan.ready) {
        await supabase
          .from("document_intake")
          .update({ proposal: { ...plan.proposal, notes: plan.notes } as unknown as Json, review_reasons: plan.reasons, status: "needs_review" })
          .eq("id", row.id)
          .eq("tenant_id", tenantId)
          .eq("status", "ready");
        demoted += 1;
        console.log(`held ${row.original_name.split("/").pop()}: ${plan.reasons.join(" | ")}`);
      }
    }

    console.log(`rechecked ${rows.length} ready rows; ${demoted} now need a person`);
    return;
  }

  if (has("--report")) {
    const out = take("--out");

    if (!out) {
      throw new Error("--report needs --out <file.csv>.");
    }

    const rows = await batchRows(supabase, tenantId, batchId);
    const { data: units } = await supabase
      .from("equipment")
      .select("id, unit_number")
      .eq("tenant_id", tenantId)
      .returns<{ id: string; unit_number: string }[]>();
    const unitById = new Map((units ?? []).map((unit) => [unit.id, unit.unit_number]));
    const header = ["intake_id", "file", "status", "unit", "equipment_id", "doc_kind", "proposal", "reasons", "extraction", "filed_document_id"];
    const lines = [header.join(",")];

    for (const row of rows) {
      lines.push(
        [
          row.id,
          row.original_name,
          row.status,
          row.equipment_id ? (unitById.get(row.equipment_id) ?? "") : "",
          row.equipment_id,
          row.doc_type,
          row.proposal,
          (row.review_reasons ?? []).join(" | "),
          row.extraction,
          row.filed_document_id,
        ]
          .map(csvCell)
          .join(","),
      );
    }

    writeFileSync(out, lines.join("\r\n"), "utf8");
    const counts: Record<string, number> = {};

    for (const row of rows) {
      counts[row.status] = (counts[row.status] ?? 0) + 1;
    }

    console.log(JSON.stringify({ rows: rows.length, status: counts, out }, null, 1));
    return;
  }

  if (has("--file-ready") || has("--file-decisions")) {
    const rows = await batchRows(supabase, tenantId, batchId);
    const byId = new Map(rows.map((row) => [row.id, row]));
    const work: { decision: FilingDecision; row: IntakeRow }[] = [];

    if (has("--file-ready")) {
      for (const row of rows.filter((candidate) => candidate.status === "ready")) {
        const proposal = row.proposal as Partial<FilingProposal> | null;

        if (!row.equipment_id || !proposal?.docType || proposal.action === "none") {
          console.log(`skip ${row.original_name}: nothing to file it onto`);
          continue;
        }

        work.push({
          decision: {
            certificationTypeId: proposal.certificationTypeId ?? null,
            docType: proposal.docType,
            equipmentId: row.equipment_id,
            expiryDate: proposal.expiryDate ?? null,
            issuedDate: proposal.issuedDate ?? null,
            targetDocumentId: proposal.action === "attach_to_existing" ? (proposal.targetDocumentId ?? null) : null,
            title: proposal.title ?? "",
          },
          row,
        });
      }
    } else {
      const decisionsPath = take("--file-decisions");
      const decisions = JSON.parse(readFileSync(String(decisionsPath), "utf8")) as (FilingDecision & { intakeId: string })[];

      for (const { intakeId, ...decision } of decisions) {
        const row = byId.get(intakeId);

        if (!row) {
          console.log(`skip ${intakeId}: not in this batch`);
          continue;
        }

        work.push({ decision: { ...decision, docType: decision.docType as EquipmentDocType }, row });
      }
    }

    let filed = 0;

    for (const { decision, row } of work) {
      const result = await fileIntakeRow({ actor, decision, row, supabase });

      if (result.ok) {
        filed += 1;
      } else {
        console.log(`NOT FILED ${row.original_name}: ${result.error}`);
      }
    }

    console.log(`filed ${filed} of ${work.length}`);
    return;
  }

  throw new Error("Choose a stage: --stage, --process, --report, --file-ready or --file-decisions.");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
