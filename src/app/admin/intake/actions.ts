"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { canUseAdminPanel } from "@/lib/access-control";
import { requireAppUser } from "@/lib/current-user";
import { fileIntakeRow, FILEABLE_DOC_TYPES, type FilingDecision } from "@/lib/document-intake/file";
import type { EquipmentDocType, FilingProposal } from "@/lib/document-intake/plan";
import { fileTicketRow } from "@/lib/document-intake/ticket-file";
import {
  INTAKE_MAX_FILES_PER_REGISTRATION,
  validateUploadedIntakeFiles,
  type RejectedIntakeFile,
  type UploadedIntakeFile,
} from "@/lib/document-intake/storage";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

type IntakeRow = Database["public"]["Tables"]["document_intake"]["Row"];

const INTAKE_PATH = "/admin/intake";
const TICKETS_PATH = "/admin/tickets/intake";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Batches of "File all ready" are capped so one click stays well inside a request, and the
// rest are one more click away.
const FILE_ALL_LIMIT = 100;

async function requireIntakeUser() {
  const context = await requireAppUser();

  if (!canUseAdminPanel(context.appUser)) {
    redirect("/choose");
  }

  return context;
}

function stringValue(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function back(kind: "error" | "notice", message: string, path: string = INTAKE_PATH): never {
  redirect(`${path}?${kind}=${encodeURIComponent(message)}`);
}

/** The page a row belongs on: tickets have their own. */
function pageFor(formData: FormData) {
  return stringValue(formData, "from") === "tickets" ? TICKETS_PATH : INTAKE_PATH;
}

export type RegisterIntakeResult = {
  queued: number;
  rejected: RejectedIntakeFile[];
};

/**
 * Records files the browser has already put in storage and queues them to be read.
 * Called by the upload page, not by a form, so it returns data instead of redirecting.
 */
export async function registerIntakeFiles(input: {
  batchId: string;
  files: { name: string; path: string; size: number; type: string }[];
  /** Unit paperwork (the default) or people's tickets. Decides which reader reads them. */
  subject?: "unit" | "ticket";
}): Promise<RegisterIntakeResult> {
  const context = await requireIntakeUser();
  const tenantId = context.appUser.tenant_id;

  if (!UUID.test(input.batchId) || !Array.isArray(input.files) || input.files.length > INTAKE_MAX_FILES_PER_REGISTRATION) {
    return { queued: 0, rejected: [{ name: "All files", reason: "That upload could not be understood. Try again." }] };
  }

  const files: UploadedIntakeFile[] = input.files.map((file) => ({
    name: String(file?.name ?? ""),
    path: String(file?.path ?? ""),
    size: Number(file?.size),
    type: String(file?.type ?? ""),
  }));
  const { accepted, rejected } = validateUploadedIntakeFiles(files, { batchId: input.batchId, tenantId });

  if (accepted.length === 0) {
    return { queued: 0, rejected };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("document_intake")
    .upsert(
      accepted.map((file) => ({
        batch_id: input.batchId,
        mime_type: file.type,
        original_name: file.name.slice(0, 300),
        size_bytes: file.size,
        status: "queued" as const,
        storage_path: file.path,
        subject: input.subject === "ticket" ? ("ticket" as const) : ("unit" as const),
        tenant_id: tenantId,
        uploaded_by: context.appUser.id,
      })),
      // Registering the same upload twice must not queue it twice, and must not reset a
      // row that has already moved on.
      { ignoreDuplicates: true, onConflict: "tenant_id,storage_path" },
    )
    .select("id");

  if (error) {
    return {
      queued: 0,
      rejected: [...rejected, { name: "All files", reason: "The files were uploaded but could not be queued. Try again." }],
    };
  }

  revalidatePath(INTAKE_PATH);
  revalidatePath(TICKETS_PATH);

  return { queued: data?.length ?? 0, rejected };
}

function decisionFromProposal(row: IntakeRow): FilingDecision | null {
  const proposal = row.proposal as Partial<FilingProposal> | null;

  if (!row.equipment_id || !proposal || !proposal.docType || proposal.action === "none") {
    return null;
  }

  return {
    certificationTypeId: proposal.certificationTypeId ?? null,
    docType: proposal.docType,
    equipmentId: row.equipment_id,
    expiryDate: proposal.expiryDate ?? null,
    issuedDate: proposal.issuedDate ?? null,
    targetDocumentId: proposal.action === "attach_to_existing" ? (proposal.targetDocumentId ?? null) : null,
    title: proposal.title ?? "",
  };
}

/** Files one reviewed row, with whatever the reviewer chose or corrected on the form. */
export async function fileIntakeItem(formData: FormData) {
  const context = await requireIntakeUser();
  const supabase = await createSupabaseServerClient();
  const intakeId = stringValue(formData, "intakeId");

  const { data: row } = await supabase
    .from("document_intake")
    .select("*")
    .eq("id", intakeId)
    .eq("tenant_id", context.appUser.tenant_id)
    .maybeSingle<IntakeRow>();

  if (!row) {
    back("error", "That file is no longer in the list.");
  }

  const docType = stringValue(formData, "docType") as EquipmentDocType;
  const target = stringValue(formData, "targetDocumentId");

  const result = await fileIntakeRow({
    actor: context.appUser,
    decision: {
      certificationTypeId: stringValue(formData, "certificationTypeId") || null,
      docType: FILEABLE_DOC_TYPES.includes(docType) ? docType : "other",
      equipmentId: stringValue(formData, "equipmentId"),
      expiryDate: stringValue(formData, "expiryDate") || null,
      issuedDate: stringValue(formData, "issuedDate") || null,
      targetDocumentId: target && target !== "new" ? target : null,
      title: stringValue(formData, "title"),
    },
    row,
    supabase,
  });

  if (!result.ok) {
    back("error", `${row.original_name}: ${result.error}`);
  }

  revalidatePath(INTAKE_PATH);
  revalidatePath("/admin/needs-document");
  back("notice", `Filed ${row.original_name}.`);
}

/** Files every confident row exactly as proposed. Each is re-checked as it is filed. */
export async function fileAllReady() {
  const context = await requireIntakeUser();
  const supabase = await createSupabaseServerClient();

  const { data: rows } = await supabase
    .from("document_intake")
    .select("*")
    .eq("tenant_id", context.appUser.tenant_id)
    .eq("subject", "unit")
    .eq("status", "ready")
    .order("created_at", { ascending: true })
    .limit(FILE_ALL_LIMIT)
    .returns<IntakeRow[]>();

  let filed = 0;
  const problems: string[] = [];

  for (const row of rows ?? []) {
    const decision = decisionFromProposal(row);

    if (!decision) {
      problems.push(`${row.original_name}: nothing to file it onto.`);
      continue;
    }

    const result = await fileIntakeRow({ actor: context.appUser, decision, row, supabase });

    if (result.ok) {
      filed += 1;
    } else {
      problems.push(`${row.original_name}: ${result.error}`);
    }
  }

  revalidatePath(INTAKE_PATH);
  revalidatePath("/admin/needs-document");

  if (problems.length > 0) {
    back("error", `Filed ${filed}. ${problems.length} could not be filed: ${problems.slice(0, 3).join(" ")}`);
  }

  const more = (rows?.length ?? 0) === FILE_ALL_LIMIT ? " There are more ready; run it again." : "";
  back("notice", `Filed ${filed} document${filed === 1 ? "" : "s"}.${more}`);
}

/** Sets a file aside without filing it. The row stays as a record of the decision. */
export async function skipIntakeItem(formData: FormData) {
  const context = await requireIntakeUser();
  const supabase = await createSupabaseServerClient();

  const { data } = await supabase
    .from("document_intake")
    .update({ reviewed_by: context.appUser.id, status: "skipped" })
    .eq("id", stringValue(formData, "intakeId"))
    .eq("tenant_id", context.appUser.tenant_id)
    .neq("status", "filed")
    .select("id");

  if (!data || data.length === 0) {
    back("error", "That file could not be set aside.", pageFor(formData));
  }

  revalidatePath(INTAKE_PATH);
  revalidatePath(TICKETS_PATH);
  back("notice", "Set aside.", pageFor(formData));
}

/** Puts a failed or set-aside file back in the queue to be read again. */
export async function retryIntakeItem(formData: FormData) {
  const context = await requireIntakeUser();
  const supabase = await createSupabaseServerClient();

  const { data } = await supabase
    .from("document_intake")
    .update({ attempts: 0, claimed_at: null, error: null, review_reasons: [], status: "queued" })
    .eq("id", stringValue(formData, "intakeId"))
    .eq("tenant_id", context.appUser.tenant_id)
    .in("status", ["failed", "skipped", "needs_review"])
    .select("id");

  if (!data || data.length === 0) {
    back("error", "That file could not be queued again.", pageFor(formData));
  }

  revalidatePath(INTAKE_PATH);
  revalidatePath(TICKETS_PATH);
  back("notice", "Queued again. Open this page to have it read.", pageFor(formData));
}

type TicketProposalJson = Partial<{
  action: "attach" | "new" | "none";
  certificationTypeId: string | null;
  detail: string | null;
  expiresOn: string | null;
  issuedOn: string | null;
  name: string;
  targetRecordId: string | null;
}>;

type TicketExtractionJson = Partial<{
  match_status: "matched" | "suggested" | "unmatched";
  person: { key: string } | null;
}>;

/**
 * Files one ticket as the reviewer decided.
 *
 * Whose ticket it is must be certain. Only a name that matched exactly one person can be
 * filed without a confirmation; for anything else (a suggestion, or a person the reviewer
 * picked) the form must carry confirm=yes, which the page sends only from the
 * "Yes, this is their ticket" button. That is the client's own rule: a ticket on the wrong
 * worker makes someone look qualified who is not.
 */
export async function fileTicketItem(formData: FormData) {
  const context = await requireIntakeUser();
  const supabase = await createSupabaseServerClient();
  const intakeId = stringValue(formData, "intakeId");

  const { data: row } = await supabase
    .from("document_intake")
    .select("*")
    .eq("id", intakeId)
    .eq("tenant_id", context.appUser.tenant_id)
    .eq("subject", "ticket")
    .maybeSingle<IntakeRow>();

  if (!row) {
    back("error", "That ticket is no longer in the list.", TICKETS_PATH);
  }

  const extraction = (row.extraction ?? {}) as TicketExtractionJson;
  const personKey = stringValue(formData, "personKey");
  const certain = extraction.match_status === "matched" && extraction.person?.key === personKey;

  if (!personKey) {
    back("error", `${row.original_name}: choose whose ticket this is.`, TICKETS_PATH);
  }

  if (!certain && stringValue(formData, "confirm") !== "yes") {
    back("error", `${row.original_name}: confirm whose ticket this is before it is saved.`, TICKETS_PATH);
  }

  const target = stringValue(formData, "targetRecordId");
  const result = await fileTicketRow({
    actor: context.appUser,
    decision: {
      certificationTypeId: stringValue(formData, "certificationTypeId") || null,
      detail: stringValue(formData, "detail") || null,
      expiresOn: stringValue(formData, "expiresOn") || null,
      issuedOn: stringValue(formData, "issuedOn") || null,
      name: stringValue(formData, "name"),
      personKey,
      // A waiting record belongs to the person it was planned for; another person gets a new one.
      targetRecordId: target && extraction.person?.key === personKey ? target : null,
    },
    row,
    supabase,
  });

  if (!result.ok) {
    back("error", `${row.original_name}: ${result.error}`, TICKETS_PATH);
  }

  revalidatePath(TICKETS_PATH);
  revalidatePath("/admin/worker-tickets");
  back("notice", `Saved ${row.original_name}.`, TICKETS_PATH);
}

/** Files every ready ticket exactly as proposed. Ready means the name matched one person exactly. */
export async function fileAllReadyTickets() {
  const context = await requireIntakeUser();
  const supabase = await createSupabaseServerClient();

  const { data: rows } = await supabase
    .from("document_intake")
    .select("*")
    .eq("tenant_id", context.appUser.tenant_id)
    .eq("subject", "ticket")
    .eq("status", "ready")
    .order("created_at", { ascending: true })
    .limit(FILE_ALL_LIMIT)
    .returns<IntakeRow[]>();

  let filed = 0;
  const problems: string[] = [];

  for (const row of rows ?? []) {
    const extraction = (row.extraction ?? {}) as TicketExtractionJson;
    const proposal = (row.proposal ?? {}) as TicketProposalJson;

    // Belt and braces: "ready" is only ever set for an exact match, but filing without a
    // person's Yes is only allowed for one, so it is checked again here.
    if (extraction.match_status !== "matched" || !extraction.person?.key || proposal.action === "none") {
      problems.push(`${row.original_name}: needs a person to confirm it.`);
      continue;
    }

    const result = await fileTicketRow({
      actor: context.appUser,
      decision: {
        certificationTypeId: proposal.certificationTypeId ?? null,
        detail: proposal.detail ?? null,
        expiresOn: proposal.expiresOn ?? null,
        issuedOn: proposal.issuedOn ?? null,
        name: proposal.name ?? "",
        personKey: extraction.person.key,
        targetRecordId: proposal.action === "attach" ? (proposal.targetRecordId ?? null) : null,
      },
      row,
      supabase,
    });

    if (result.ok) {
      filed += 1;
    } else {
      problems.push(`${row.original_name}: ${result.error}`);
    }
  }

  revalidatePath(TICKETS_PATH);
  revalidatePath("/admin/worker-tickets");

  if (problems.length > 0) {
    back("error", `Saved ${filed}. ${problems.length} could not be saved: ${problems.slice(0, 3).join(" ")}`, TICKETS_PATH);
  }

  const more = (rows?.length ?? 0) === FILE_ALL_LIMIT ? " There are more ready; run it again." : "";
  back("notice", `Saved ${filed} ticket${filed === 1 ? "" : "s"}.${more}`, TICKETS_PATH);
}
