// Files one intake row onto a unit, as a person approved it.
//
// This is the only place an intake file becomes a record, and it does what a hand entry
// does, through the same tables and the same folder: the object moves into the unit's own
// documents folder, then an equipment_document row either gains the file (the row that was
// waiting for its scan) or is created. After that the intake row is only a receipt.
//
// Order matters. The object is copied BEFORE the record is written and the original removed
// AFTER, so a failure at any step leaves either nothing changed or a harmless extra copy,
// never a record pointing at a file that is not there.
//
// Every write that row-level security can silently turn into "matched nothing" asks for the
// affected row back. A caller told "filed" by a write that changed zero rows would be
// reading a lie, and the document would still read amber with no hint why.

import type { SupabaseClient } from "@supabase/supabase-js";
import { buildEquipmentActionMetadata, buildEquipmentAttachmentStoragePath } from "@/lib/equipment";
import { recordTenantAuditEvent } from "@/lib/tenant-audit";
import type { Database, Json } from "@/types/database";
import { INTAKE_BUCKET } from "./storage";
import { normalizeIsoDate } from "./schema";
import type { EquipmentDocType } from "./plan";

type Supabase = SupabaseClient<Database>;
type IntakeRow = Database["public"]["Tables"]["document_intake"]["Row"];

export const FILEABLE_DOC_TYPES: readonly EquipmentDocType[] = [
  "registration",
  "insurance",
  "cvip",
  "permit",
  "certification",
  "other",
];

// Kinds the reader recognises in order to refuse. Enforced here as well as in the planner,
// because the review form posts a doc type a person chose and must not be a way round it.
const NEVER_FILED_KINDS = new Set(["medical", "driver_personal"]);

export type FilingDecision = {
  certificationTypeId: string | null;
  docType: EquipmentDocType;
  equipmentId: string;
  expiryDate: string | null;
  issuedDate: string | null;
  /** An existing row waiting for its scan, or null to add a new one. */
  targetDocumentId: string | null;
  title: string;
};

export type FilingResult = { documentId: string; ok: true } | { error: string; ok: false };

export async function fileIntakeRow(input: {
  actor: { id: string; power_level: string; tenant_id: string };
  decision: FilingDecision;
  row: IntakeRow;
  supabase: Supabase;
}): Promise<FilingResult> {
  const { actor, decision, row, supabase } = input;
  const tenantId = actor.tenant_id;
  const fail = (error: string): FilingResult => ({ error, ok: false });

  if (row.tenant_id !== tenantId) {
    return fail("That file belongs to another company.");
  }

  if (row.status === "filed") {
    return fail("That file has already been filed.");
  }

  if (row.doc_type && NEVER_FILED_KINDS.has(row.doc_type)) {
    return fail("Medical and personal driver records are not filed from here.");
  }

  if (!FILEABLE_DOC_TYPES.includes(decision.docType)) {
    return fail("Choose a document type.");
  }

  const title = decision.title.trim().slice(0, 200);

  if (!title) {
    return fail("Enter a title for the document.");
  }

  // Dates are accepted strictly or not at all. A blank is a legitimate answer (a document
  // with no expiry is proven by its scan, not by a date); a malformed value is an error.
  const issuedDate = decision.issuedDate ? normalizeIsoDate(decision.issuedDate) : null;
  const expiryDate = decision.expiryDate ? normalizeIsoDate(decision.expiryDate) : null;

  if (decision.issuedDate && !issuedDate) {
    return fail("The issue date is not a valid date.");
  }

  if (decision.expiryDate && !expiryDate) {
    return fail("The expiry date is not a valid date.");
  }

  const { data: equipment } = await supabase
    .from("equipment")
    .select("id")
    .eq("id", decision.equipmentId)
    .eq("tenant_id", tenantId)
    .is("deleted_at", null)
    .maybeSingle<{ id: string }>();

  if (!equipment) {
    return fail("Choose a unit from this company's fleet.");
  }

  let certificationTypeId: string | null = null;

  if (decision.docType === "certification" && decision.certificationTypeId) {
    const { data: type } = await supabase
      .from("equipment_certification_types")
      .select("id")
      .eq("id", decision.certificationTypeId)
      .eq("tenant_id", tenantId)
      .maybeSingle<{ id: string }>();

    if (!type) {
      return fail("Choose a valid certification type.");
    }

    certificationTypeId = type.id;
  }

  // The target must be a live row on THIS unit of the SAME type. Read back under the
  // tenant before touching it, so an id from elsewhere cannot steer the scan onto a record
  // it does not belong to.
  let existing: { attachment_ids: string[] | null; id: string } | null = null;

  if (decision.targetDocumentId) {
    const { data } = await supabase
      .from("equipment_document")
      .select("id, attachment_ids")
      .eq("id", decision.targetDocumentId)
      .eq("equipment_id", decision.equipmentId)
      .eq("tenant_id", tenantId)
      .eq("doc_type", decision.docType)
      .is("deleted_at", null)
      .maybeSingle<{ attachment_ids: string[] | null; id: string }>();

    if (!data) {
      return fail("The document row this was meant for is no longer on that unit.");
    }

    existing = data;
  }

  const finalPath = buildEquipmentAttachmentStoragePath({
    equipmentId: decision.equipmentId,
    fileName: row.original_name,
    folder: "documents",
    index: 0,
    tenantId,
  });

  const { error: copyError } = await supabase.storage.from(INTAKE_BUCKET).copy(row.storage_path, finalPath);

  if (copyError) {
    return fail("The file could not be moved onto the unit. It is still in the intake list.");
  }

  const undoCopy = async () => {
    try {
      await supabase.storage.from(INTAKE_BUCKET).remove([finalPath]);
    } catch {
      // Best effort: a leftover object is untidy, not wrong.
    }
  };

  const actionMetadata = buildEquipmentActionMetadata({
    action: "equipment.document.intake_file",
    actorId: actor.id,
    details: {
      doc_type: decision.docType,
      expiry_date: expiryDate,
      intake_id: row.id,
      model: typeof (row.extraction as { model?: unknown } | null)?.model === "string"
        ? ((row.extraction as { model: string }).model as Json)
        : null,
      via: "document_intake",
    },
    source: "admin",
  });

  let documentId: string;

  if (existing) {
    const attachmentIds = Array.from(new Set([...(existing.attachment_ids ?? []), finalPath]));
    const { data: updated, error } = await supabase
      .from("equipment_document")
      .update({
        action_metadata: actionMetadata,
        attachment_ids: attachmentIds,
        expiry_date: expiryDate,
        issued_date: issuedDate,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id)
      .eq("tenant_id", tenantId)
      .select("id");

    if (error || !updated || updated.length === 0) {
      await undoCopy();
      return fail(error?.message ?? "The document row could not be updated.");
    }

    documentId = existing.id;
  } else {
    const { data: created, error } = await supabase
      .from("equipment_document")
      .insert({
        action_metadata: actionMetadata,
        attachment_ids: [finalPath],
        certification_type_id: certificationTypeId,
        created_by: actor.id,
        doc_type: decision.docType,
        equipment_id: decision.equipmentId,
        expiry_date: expiryDate,
        is_active: true,
        issued_date: issuedDate,
        reminder_lead_days: 30,
        tenant_id: tenantId,
        title,
      })
      .select("id")
      .single<{ id: string }>();

    if (error || !created) {
      await undoCopy();
      return fail(error?.message ?? "The document could not be created.");
    }

    documentId = created.id;
  }

  const { data: receipt } = await supabase
    .from("document_intake")
    .update({
      equipment_id: decision.equipmentId,
      filed_at: new Date().toISOString(),
      filed_document_id: documentId,
      review_reasons: [],
      reviewed_by: actor.id,
      status: "filed",
      storage_path: finalPath,
    })
    .eq("id", row.id)
    .eq("tenant_id", tenantId)
    .select("id");

  // The document IS filed at this point. A receipt that failed to update leaves the intake
  // row looking unfinished, which the reviewer can see and clear; it must not be reported
  // as a failure to file.
  if (!receipt || receipt.length === 0) {
    console.error("[document-intake] Filed a document but could not update its intake row.", { id: row.id });
  }

  // The scan now lives with the unit. Drop the intake copy so a client's paperwork is held
  // in one place, not two.
  try {
    await supabase.storage.from(INTAKE_BUCKET).remove([row.storage_path]);
  } catch {
    // Best effort, as above.
  }

  await recordTenantAuditEvent({
    action: "equipment.document.intake_file",
    actorRole: actor.power_level,
    actorUserId: actor.id,
    entityId: documentId,
    entityTable: "equipment_document",
    metadata: {
      attached_to_existing: Boolean(existing),
      doc_type: decision.docType,
      equipment_id: decision.equipmentId,
      intake_id: row.id,
      title,
    },
    tenantId,
  });

  return { documentId, ok: true };
}
