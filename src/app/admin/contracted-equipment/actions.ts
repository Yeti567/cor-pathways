"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  auditContracted,
  backTo,
  choiceValue,
  CONTRACTED_EQUIPMENT_PATH,
  optionalDate,
  optionalInteger,
  optionalString,
  readableContractedWriteError,
  requireContractedManager,
  requireOwnedCarrier,
  stringValue,
} from "@/app/admin/_lib/contracted-access";
import { parseUploadedContractedAttachmentPaths } from "@/lib/contracted-equipment";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

type UnitRow = Database["public"]["Tables"]["contracted_equipment"]["Row"];
type DocumentRow = Database["public"]["Tables"]["contracted_equipment_document"]["Row"];

const DOC_TYPES = ["registration", "insurance", "cvip", "permit", "certification", "other"] as const;
const CATEGORIES = ["vehicle", "trailer"] as const;
const STATUSES = ["active", "inactive", "terminated"] as const;

function unitPath(unitId: string) {
  return `${CONTRACTED_EQUIPMENT_PATH}/${unitId}`;
}

/**
 * Load a unit that belongs to this tenant, with the carrier it hangs off.
 *
 * The carrier id is needed for every storage path, so it is fetched here rather than
 * trusted from the form: a posted carrier id would let a forged form write a file into
 * another carrier's folder.
 */
async function requireOwnedUnit(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  tenantId: string,
  unitId: string,
): Promise<UnitRow | null> {
  if (!unitId) {
    return null;
  }

  const { data } = await supabase
    .from("contracted_equipment")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("id", unitId)
    .is("deleted_at", null)
    .maybeSingle<UnitRow>();

  return data ?? null;
}

export async function createContractedEquipment(formData: FormData) {
  const context = await requireContractedManager();
  const supabase = await createSupabaseServerClient();
  const tenantId = context.appUser.tenant_id;

  const unitNumber = stringValue(formData, "unitNumber");

  if (!unitNumber) {
    backTo(CONTRACTED_EQUIPMENT_PATH, "Give the unit a number.");
  }

  const carrier = await requireOwnedCarrier(supabase, tenantId, stringValue(formData, "subcontractorId"));

  if (!carrier) {
    backTo(CONTRACTED_EQUIPMENT_PATH, "Choose which carrier owns this unit.");
  }

  const { data, error } = await supabase
    .from("contracted_equipment")
    .insert({
      tenant_id: tenantId,
      subcontractor_id: carrier.id,
      unit_number: unitNumber,
      category: choiceValue(formData, "category", CATEGORIES, "vehicle"),
      status: choiceValue(formData, "status", STATUSES, "active"),
      year: optionalInteger(formData, "year"),
      make: optionalString(formData, "make"),
      model_or_colour: optionalString(formData, "modelOrColour"),
      vin_or_serial: optionalString(formData, "vinOrSerial"),
      license_plate: optionalString(formData, "licensePlate"),
      registration_province: optionalString(formData, "registrationProvince"),
      owner_name: optionalString(formData, "ownerName"),
      notes: optionalString(formData, "notes"),
      created_by: context.appUser.id,
    })
    .select("id")
    .maybeSingle<{ id: string }>();

  if (error || !data) {
    backTo(
      CONTRACTED_EQUIPMENT_PATH,
      readableContractedWriteError(error?.message ?? "The unit was not saved.", error?.code),
    );
  }

  await auditContracted(context, {
    action: "contracted_equipment.create",
    entityId: data.id,
    entityTable: "contracted_equipment",
    metadata: { unit_number: unitNumber, subcontractor_id: carrier.id },
  });

  revalidatePath(CONTRACTED_EQUIPMENT_PATH);
  redirect(`${unitPath(data.id)}?notice=${encodeURIComponent(`Unit ${unitNumber} added.`)}`);
}

export async function updateContractedEquipment(formData: FormData) {
  const context = await requireContractedManager();
  const supabase = await createSupabaseServerClient();
  const tenantId = context.appUser.tenant_id;
  const unitId = stringValue(formData, "unitId");
  const unit = await requireOwnedUnit(supabase, tenantId, unitId);

  if (!unit) {
    backTo(CONTRACTED_EQUIPMENT_PATH, "That unit no longer exists.");
  }

  const unitNumber = stringValue(formData, "unitNumber") || unit.unit_number;

  const { error } = await supabase
    .from("contracted_equipment")
    .update({
      unit_number: unitNumber,
      category: choiceValue(formData, "category", CATEGORIES, unit.category),
      status: choiceValue(formData, "status", STATUSES, unit.status),
      year: optionalInteger(formData, "year"),
      make: optionalString(formData, "make"),
      model_or_colour: optionalString(formData, "modelOrColour"),
      vin_or_serial: optionalString(formData, "vinOrSerial"),
      license_plate: optionalString(formData, "licensePlate"),
      registration_province: optionalString(formData, "registrationProvince"),
      owner_name: optionalString(formData, "ownerName"),
      notes: optionalString(formData, "notes"),
    })
    .eq("tenant_id", tenantId)
    .eq("id", unit.id);

  if (error) {
    backTo(unitPath(unit.id), readableContractedWriteError(error.message, error.code));
  }

  await auditContracted(context, {
    action: "contracted_equipment.update",
    entityId: unit.id,
    entityTable: "contracted_equipment",
    metadata: { unit_number: unitNumber },
  });

  revalidatePath(unitPath(unit.id));
  revalidatePath(CONTRACTED_EQUIPMENT_PATH);
  backTo(unitPath(unit.id), "Unit details saved.", "notice");
}

/**
 * Which certifications this unit is held to.
 *
 * Writes the tick list as a whole: delete then insert, so unticking is a real answer.
 * An empty submission stores an empty list, which means "held to nothing" and must never
 * collapse back into the defaults. That distinction is the entire point of the table,
 * and getting it wrong silently refills a unit somebody deliberately cleared.
 */
export async function setContractedEquipmentRequirements(formData: FormData) {
  const context = await requireContractedManager();
  const supabase = await createSupabaseServerClient();
  const tenantId = context.appUser.tenant_id;
  const unit = await requireOwnedUnit(supabase, tenantId, stringValue(formData, "unitId"));

  if (!unit) {
    backTo(CONTRACTED_EQUIPMENT_PATH, "That unit no longer exists.");
  }

  const requested = formData
    .getAll("certificationTypeIds")
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => value.trim());

  // Only ids from this tenant's own list. A posted id from elsewhere would otherwise
  // create a requirement pointing at a type the tenant cannot see or manage.
  const { data: validTypes } = await supabase
    .from("equipment_certification_types")
    .select("id")
    .eq("tenant_id", tenantId)
    .in("id", requested.length > 0 ? requested : ["00000000-0000-0000-0000-000000000000"])
    .returns<{ id: string }[]>();

  const typeIds = [...new Set((validTypes ?? []).map((type) => type.id))];

  const { error: deleteError } = await supabase
    .from("contracted_equipment_certification_requirement")
    .delete()
    .eq("tenant_id", tenantId)
    .eq("contracted_equipment_id", unit.id);

  if (deleteError) {
    backTo(unitPath(unit.id), readableContractedWriteError(deleteError.message, deleteError.code));
  }

  if (typeIds.length > 0) {
    const { error: insertError } = await supabase
      .from("contracted_equipment_certification_requirement")
      .insert(
        typeIds.map((certificationTypeId) => ({
          tenant_id: tenantId,
          contracted_equipment_id: unit.id,
          certification_type_id: certificationTypeId,
          created_by: context.appUser.id,
        })),
      );

    if (insertError) {
      backTo(unitPath(unit.id), readableContractedWriteError(insertError.message, insertError.code));
    }
  }

  await auditContracted(context, {
    action: "contracted_equipment.requirements.set",
    entityId: unit.id,
    entityTable: "contracted_equipment",
    metadata: { count: typeIds.length },
  });

  revalidatePath(unitPath(unit.id));
  backTo(unitPath(unit.id), "Inspection list saved.", "notice");
}

export async function createContractedEquipmentDocument(formData: FormData) {
  const context = await requireContractedManager();
  const supabase = await createSupabaseServerClient();
  const tenantId = context.appUser.tenant_id;
  const unit = await requireOwnedUnit(supabase, tenantId, stringValue(formData, "unitId"));

  if (!unit) {
    backTo(CONTRACTED_EQUIPMENT_PATH, "That unit no longer exists.");
  }

  const title = stringValue(formData, "title");

  if (!title) {
    backTo(unitPath(unit.id), "Give the document a title.");
  }

  const docType = choiceValue(formData, "docType", DOC_TYPES, "other");
  const certificationTypeId = docType === "certification" ? optionalString(formData, "certificationTypeId") : null;

  const attachmentIds = parseUploadedContractedAttachmentPaths(formData.getAll("uploadedAttachmentPaths"), {
    tenantId,
    subcontractorId: unit.subcontractor_id,
    subjectId: unit.id,
    scope: "contracted-equipment",
  });

  const { data, error } = await supabase
    .from("contracted_equipment_document")
    .insert({
      tenant_id: tenantId,
      contracted_equipment_id: unit.id,
      doc_type: docType,
      certification_type_id: certificationTypeId,
      title,
      issued_date: optionalDate(formData, "issuedDate"),
      // Null is allowed and meaningful here. See the column comment in the migration.
      expiry_date: optionalDate(formData, "expiryDate"),
      reminder_lead_days: optionalInteger(formData, "reminderLeadDays") ?? 30,
      attachment_ids: attachmentIds,
      created_by: context.appUser.id,
    })
    .select("id")
    .maybeSingle<{ id: string }>();

  if (error || !data) {
    backTo(
      unitPath(unit.id),
      readableContractedWriteError(error?.message ?? "The document was not saved.", error?.code),
    );
  }

  await auditContracted(context, {
    action: "contracted_equipment.document.create",
    entityId: data.id,
    entityTable: "contracted_equipment_document",
    metadata: { unit_id: unit.id, doc_type: docType, has_proof: attachmentIds.length > 0 },
  });

  revalidatePath(unitPath(unit.id));
  revalidatePath(CONTRACTED_EQUIPMENT_PATH);
  backTo(unitPath(unit.id), `${title} filed.`, "notice");
}

/**
 * File the scan onto the row that is asking for it.
 *
 * The counterpart of Add Document, and the one people should reach for. Adding a second
 * document leaves the waiting requirement exactly as it was, so the light stays amber
 * while the certificate sits on a row underneath; this attaches the proof to the record
 * that is short of it, and lets the dates be corrected in the same pass.
 */
export async function attachContractedEquipmentDocumentProof(formData: FormData) {
  const context = await requireContractedManager();
  const supabase = await createSupabaseServerClient();
  const tenantId = context.appUser.tenant_id;
  const documentId = stringValue(formData, "documentId");

  const { data: document } = await supabase
    .from("contracted_equipment_document")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("id", documentId)
    .is("deleted_at", null)
    .maybeSingle<DocumentRow>();

  if (!document) {
    backTo(CONTRACTED_EQUIPMENT_PATH, "That document no longer exists.");
  }

  const unit = await requireOwnedUnit(supabase, tenantId, document.contracted_equipment_id);

  if (!unit) {
    backTo(CONTRACTED_EQUIPMENT_PATH, "That unit no longer exists.");
  }

  const uploaded = parseUploadedContractedAttachmentPaths(formData.getAll("uploadedAttachmentPaths"), {
    tenantId,
    subcontractorId: unit.subcontractor_id,
    subjectId: unit.id,
    scope: "contracted-equipment",
  });

  const issuedDate = optionalDate(formData, "issuedDate");
  const expiryDate = optionalDate(formData, "expiryDate");

  const { error } = await supabase
    .from("contracted_equipment_document")
    .update({
      // Added to, never replaced: a certificate scanned in two passes keeps both pages,
      // and a re-upload that failed halfway cannot wipe what was already filed.
      attachment_ids: [...new Set([...document.attachment_ids, ...uploaded])],
      issued_date: issuedDate ?? document.issued_date,
      expiry_date: expiryDate ?? document.expiry_date,
    })
    .eq("tenant_id", tenantId)
    .eq("id", document.id);

  if (error) {
    backTo(unitPath(unit.id), readableContractedWriteError(error.message, error.code));
  }

  await auditContracted(context, {
    action: "contracted_equipment.document.attach_proof",
    entityId: document.id,
    entityTable: "contracted_equipment_document",
    metadata: { unit_id: unit.id, added: uploaded.length },
  });

  revalidatePath(unitPath(unit.id));
  revalidatePath(CONTRACTED_EQUIPMENT_PATH);
  backTo(
    unitPath(unit.id),
    uploaded.length > 0 ? "Document attached." : "Dates updated.",
    "notice",
  );
}

/**
 * Soft delete. The row stays so the due diligence record keeps explaining itself, and
 * because a filed certificate that vanishes takes the reason for a past decision with it.
 */
export async function deleteContractedEquipmentDocument(formData: FormData) {
  const context = await requireContractedManager();
  const supabase = await createSupabaseServerClient();
  const tenantId = context.appUser.tenant_id;
  const documentId = stringValue(formData, "documentId");
  const unitId = stringValue(formData, "unitId");

  const { error } = await supabase
    .from("contracted_equipment_document")
    .update({ deleted_at: new Date().toISOString(), is_active: false })
    .eq("tenant_id", tenantId)
    .eq("id", documentId);

  if (error) {
    backTo(unitPath(unitId), readableContractedWriteError(error.message, error.code));
  }

  await auditContracted(context, {
    action: "contracted_equipment.document.delete",
    entityId: documentId,
    entityTable: "contracted_equipment_document",
    metadata: { unit_id: unitId },
  });

  revalidatePath(unitPath(unitId));
  backTo(unitPath(unitId), "Document removed.", "notice");
}
