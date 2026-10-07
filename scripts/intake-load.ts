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
import { buildEquipmentActionMetadata, buildEquipmentAttachmentStoragePath } from "../src/lib/equipment";
import { recordTenantAuditEvent } from "../src/lib/tenant-audit";
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

type ExtraRecord = Omit<FilingDecision, "equipmentId">;
type Decision = FilingDecision & { alsoAttach?: ExtraRecord[]; intakeId: string; note?: string; skip?: boolean };

/**
 * Puts a copy of an already filed scan on a further record of the same unit: the waiting row
 * named, or a new one. Mirrors what fileIntakeRow writes. Returns an error message, or null.
 */
async function attachCopy(input: {
  actor: { id: string; power_level: string; tenant_id: string };
  equipmentId: string;
  extra: ExtraRecord;
  fileName: string;
  from: string;
  index: number;
  intakeId: string;
  supabase: Supabase;
}): Promise<string | null> {
  const { actor, extra, supabase } = input;
  const tenantId = actor.tenant_id;

  if (!input.from) {
    return "the filed scan could not be found";
  }

  const path = buildEquipmentAttachmentStoragePath({
    equipmentId: input.equipmentId,
    fileName: input.fileName.split("/").pop() ?? input.fileName,
    folder: "documents",
    index: input.index,
    tenantId,
  });
  const { error: copyError } = await supabase.storage.from(INTAKE_BUCKET).copy(input.from, path);

  if (copyError) {
    return `copy failed: ${copyError.message}`;
  }

  const actionMetadata = buildEquipmentActionMetadata({
    action: "equipment.document.intake_file",
    actorId: actor.id,
    details: { copy_of_intake: input.intakeId, doc_type: extra.docType, expiry_date: extra.expiryDate, via: "document_intake" },
    source: "admin",
  });
  let documentId: string | null = null;

  if (extra.targetDocumentId) {
    const { data: existing } = await supabase
      .from("equipment_document")
      .select("id, attachment_ids")
      .eq("id", extra.targetDocumentId)
      .eq("equipment_id", input.equipmentId)
      .eq("tenant_id", tenantId)
      .eq("doc_type", extra.docType)
      .is("deleted_at", null)
      .maybeSingle<{ attachment_ids: string[] | null; id: string }>();

    if (!existing) {
      await supabase.storage.from(INTAKE_BUCKET).remove([path]);
      return "the waiting row is no longer on that unit";
    }

    const { data: updated } = await supabase
      .from("equipment_document")
      .update({
        action_metadata: actionMetadata,
        attachment_ids: Array.from(new Set([...(existing.attachment_ids ?? []), path])),
        expiry_date: extra.expiryDate,
        issued_date: extra.issuedDate,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id)
      .eq("tenant_id", tenantId)
      .select("id");
    documentId = updated?.[0]?.id ?? null;
  } else {
    const { data: created } = await supabase
      .from("equipment_document")
      .insert({
        action_metadata: actionMetadata,
        attachment_ids: [path],
        certification_type_id: extra.certificationTypeId,
        created_by: actor.id,
        doc_type: extra.docType,
        equipment_id: input.equipmentId,
        expiry_date: extra.expiryDate,
        is_active: true,
        issued_date: extra.issuedDate,
        reminder_lead_days: 30,
        tenant_id: tenantId,
        title: extra.title,
      })
      .select("id")
      .single<{ id: string }>();
    documentId = created?.id ?? null;
  }

  if (!documentId) {
    await supabase.storage.from(INTAKE_BUCKET).remove([path]);
    return "the record could not be written";
  }

  await recordTenantAuditEvent({
    action: "equipment.document.intake_file",
    actorRole: actor.power_level,
    actorUserId: actor.id,
    entityId: documentId,
    entityTable: "equipment_document",
    metadata: { attached_to_existing: Boolean(extra.targetDocumentId), copy_of_intake: input.intakeId, doc_type: extra.docType, equipment_id: input.equipmentId, title: extra.title },
    tenantId,
  });

  return null;
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
    const work: { alsoAttach?: ExtraRecord[]; decision: FilingDecision; row: IntakeRow }[] = [];

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
      const decisions = JSON.parse(readFileSync(String(decisionsPath), "utf8")) as Decision[];
      let setAside = 0;

      for (const { alsoAttach, intakeId, note, skip, ...decision } of decisions) {
        const row = byId.get(intakeId);

        if (!row || row.status === "filed" || row.status === "skipped") {
          console.log(`skip ${intakeId}: not waiting in this batch`);
          continue;
        }

        // Set aside, as the page's "Skip" does, with the reason kept on the row.
        if (skip) {
          const { data } = await supabase
            .from("document_intake")
            .update({ review_reasons: note ? [note] : [], reviewed_by: actor.id, status: "skipped" })
            .eq("id", row.id)
            .eq("tenant_id", tenantId)
            .neq("status", "filed")
            .select("id");
          setAside += data?.length ?? 0;
          continue;
        }

        work.push({ alsoAttach: alsoAttach ?? [], decision: { ...decision, docType: decision.docType as EquipmentDocType }, row });
      }

      console.log(`set aside ${setAside}`);
    }

    let filed = 0;
    let copies = 0;

    for (const { alsoAttach, decision, row } of work) {
      const result = await fileIntakeRow({ actor, decision, row, supabase });

      if (!result.ok) {
        console.log(`NOT FILED ${row.original_name}: ${result.error}`);
        continue;
      }

      filed += 1;

      // One form that proves several records (a PVIKUC, a hose certificate covering every
      // hose): each further record gets its own copy of the scan, as every earlier load did.
      if (alsoAttach && alsoAttach.length > 0) {
        const { data: receipt } = await supabase.from("document_intake").select("storage_path").eq("id", row.id).single<{ storage_path: string }>();

        for (const [index, extra] of alsoAttach.entries()) {
          const outcome = await attachCopy({ actor, extra, fileName: row.original_name, from: receipt?.storage_path ?? "", index: index + 1, intakeId: row.id, equipmentId: decision.equipmentId, supabase });

          if (outcome) {
            console.log(`COPY NOT ATTACHED ${row.original_name} -> ${extra.title}: ${outcome}`);
          } else {
            copies += 1;
          }
        }
      }
    }

    console.log(`filed ${filed} of ${work.length}, plus ${copies} copies on further records`);
    return;
  }

  throw new Error("Choose a stage: --stage, --process, --report, --file-ready or --file-decisions.");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
