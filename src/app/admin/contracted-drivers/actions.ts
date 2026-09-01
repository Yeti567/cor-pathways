"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  auditContracted,
  backTo,
  choiceValue,
  CONTRACTED_DRIVERS_PATH,
  optionalDate,
  optionalString,
  readableContractedWriteError,
  requireContractedManager,
  requireOwnedCarrier,
  stringValue,
} from "@/app/admin/_lib/contracted-access";
import { canManageMedicalVault } from "@/lib/access-control";
import { parseUploadedContractedAttachmentPaths } from "@/lib/contracted-equipment";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  CONTRACTED_DRIVER_GENERAL_DOCUMENT_LABELS,
  CONTRACTED_DRIVER_GENERAL_DOCUMENT_TYPES,
} from "@/types/database";
import type { Database } from "@/types/database";

type DriverRow = Database["public"]["Tables"]["contracted_driver"]["Row"];

const DRIVER_TYPES = ["contracted", "casual"] as const;
const STATUSES = ["active", "inactive", "terminated"] as const;

/**
 * Everything that can be filed against a driver: the three identity documents that are
 * columns on the driver, and the general paperwork that is a column on nothing.
 */
const DRIVER_DOCUMENT_TYPES = [
  "license",
  "abstract",
  "cso",
  ...CONTRACTED_DRIVER_GENERAL_DOCUMENT_TYPES,
] as const;

const DRIVER_DOCUMENT_LABELS: Record<(typeof DRIVER_DOCUMENT_TYPES)[number], string> = {
  license: "Driver's licence",
  abstract: "Commercial driver abstract",
  cso: "Common Safety Orientation",
  other: CONTRACTED_DRIVER_GENERAL_DOCUMENT_LABELS.other.label,
  personnel_file: CONTRACTED_DRIVER_GENERAL_DOCUMENT_LABELS.personnel_file.label,
  site_access: CONTRACTED_DRIVER_GENERAL_DOCUMENT_LABELS.site_access.label,
  training_record: CONTRACTED_DRIVER_GENERAL_DOCUMENT_LABELS.training_record.label,
};

function driverPath(driverId: string) {
  return `${CONTRACTED_DRIVERS_PATH}/${driverId}`;
}

async function requireOwnedDriver(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  tenantId: string,
  driverId: string,
): Promise<DriverRow | null> {
  if (!driverId) {
    return null;
  }

  const { data } = await supabase
    .from("contracted_driver")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("id", driverId)
    .is("deleted_at", null)
    .maybeSingle<DriverRow>();

  return data ?? null;
}

/**
 * The unit posted with a driver, confirmed to belong to this tenant AND to the same
 * carrier.
 *
 * The carrier check is the one that matters: without it a driver could be parked in
 * another company's truck, and the roster would then report one carrier's driver against
 * another carrier's compliance.
 */
async function resolveUnitForCarrier(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  tenantId: string,
  subcontractorId: string,
  unitId: string | null,
): Promise<string | null> {
  if (!unitId) {
    return null;
  }

  const { data } = await supabase
    .from("contracted_equipment")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("subcontractor_id", subcontractorId)
    .eq("id", unitId)
    .is("deleted_at", null)
    .maybeSingle<{ id: string }>();

  return data?.id ?? null;
}

export async function createContractedDriver(formData: FormData) {
  const context = await requireContractedManager();
  const supabase = await createSupabaseServerClient();
  const tenantId = context.appUser.tenant_id;

  const fullName = stringValue(formData, "fullName");

  if (!fullName) {
    backTo(CONTRACTED_DRIVERS_PATH, "Give the driver a name.");
  }

  const carrier = await requireOwnedCarrier(supabase, tenantId, stringValue(formData, "subcontractorId"));

  if (!carrier) {
    backTo(CONTRACTED_DRIVERS_PATH, "Choose which carrier this driver works for.");
  }

  const unitId = await resolveUnitForCarrier(
    supabase,
    tenantId,
    carrier.id,
    optionalString(formData, "contractedEquipmentId"),
  );

  const { data, error } = await supabase
    .from("contracted_driver")
    .insert({
      tenant_id: tenantId,
      subcontractor_id: carrier.id,
      full_name: fullName,
      contracted_equipment_id: unitId,
      license_province: optionalString(formData, "licenseProvince"),
      license_expiry: optionalDate(formData, "licenseExpiry"),
      abstract_issued: optionalDate(formData, "abstractIssued"),
      abstract_expiry: optionalDate(formData, "abstractExpiry"),
      cso_completed: optionalDate(formData, "csoCompleted"),
      driver_type: choiceValue(formData, "driverType", DRIVER_TYPES, "contracted"),
      status: choiceValue(formData, "status", STATUSES, "active"),
      notes: optionalString(formData, "notes"),
      created_by: context.appUser.id,
    })
    .select("id")
    .maybeSingle<{ id: string }>();

  if (error || !data) {
    backTo(
      CONTRACTED_DRIVERS_PATH,
      readableContractedWriteError(error?.message ?? "The driver was not saved.", error?.code),
    );
  }

  await auditContracted(context, {
    action: "contracted_driver.create",
    entityId: data.id,
    entityTable: "contracted_driver",
    metadata: { subcontractor_id: carrier.id },
  });

  revalidatePath(CONTRACTED_DRIVERS_PATH);
  redirect(`${driverPath(data.id)}?notice=${encodeURIComponent(`${fullName} added.`)}`);
}

export async function updateContractedDriver(formData: FormData) {
  const context = await requireContractedManager();
  const supabase = await createSupabaseServerClient();
  const tenantId = context.appUser.tenant_id;
  const driver = await requireOwnedDriver(supabase, tenantId, stringValue(formData, "driverId"));

  if (!driver) {
    backTo(CONTRACTED_DRIVERS_PATH, "That driver no longer exists.");
  }

  const unitId = await resolveUnitForCarrier(
    supabase,
    tenantId,
    driver.subcontractor_id,
    optionalString(formData, "contractedEquipmentId"),
  );

  const { error } = await supabase
    .from("contracted_driver")
    .update({
      full_name: stringValue(formData, "fullName") || driver.full_name,
      contracted_equipment_id: unitId,
      license_province: optionalString(formData, "licenseProvince"),
      license_expiry: optionalDate(formData, "licenseExpiry"),
      abstract_issued: optionalDate(formData, "abstractIssued"),
      abstract_expiry: optionalDate(formData, "abstractExpiry"),
      cso_completed: optionalDate(formData, "csoCompleted"),
      driver_type: choiceValue(formData, "driverType", DRIVER_TYPES, driver.driver_type),
      status: choiceValue(formData, "status", STATUSES, driver.status),
      notes: optionalString(formData, "notes"),
    })
    .eq("tenant_id", tenantId)
    .eq("id", driver.id);

  if (error) {
    backTo(driverPath(driver.id), readableContractedWriteError(error.message, error.code));
  }

  await auditContracted(context, {
    action: "contracted_driver.update",
    entityId: driver.id,
    entityTable: "contracted_driver",
  });

  revalidatePath(driverPath(driver.id));
  revalidatePath(CONTRACTED_DRIVERS_PATH);
  backTo(driverPath(driver.id), "Driver details saved.", "notice");
}

/**
 * File a ticket, orientation or badge against a driver.
 *
 * The type comes from the tenant's shared certification list, so what kind of record
 * this is (ticket, orientation, site access) is decided by the type's category rather
 * than by anything chosen here. That is what keeps one list serving employees and
 * contracted drivers without either side inventing its own vocabulary.
 */
export async function createContractedDriverCertification(formData: FormData) {
  const context = await requireContractedManager();
  const supabase = await createSupabaseServerClient();
  const tenantId = context.appUser.tenant_id;
  const driver = await requireOwnedDriver(supabase, tenantId, stringValue(formData, "driverId"));

  if (!driver) {
    backTo(CONTRACTED_DRIVERS_PATH, "That driver no longer exists.");
  }

  const certificationTypeId = optionalString(formData, "certificationTypeId");
  let name = stringValue(formData, "name");

  // A chosen type names the record, so the free-text name is only needed when nobody
  // picked one. Taking the name from the type keeps a rename flowing through to every
  // record that points at it.
  if (certificationTypeId) {
    const { data: type } = await supabase
      .from("certification_types")
      .select("id, name")
      .eq("tenant_id", tenantId)
      .eq("id", certificationTypeId)
      .maybeSingle<{ id: string; name: string }>();

    if (!type) {
      backTo(driverPath(driver.id), "That certification type no longer exists.");
    }

    name = name || type.name;
  }

  if (!name) {
    backTo(driverPath(driver.id), "Choose a certification type, or type a name for it.");
  }

  const uploaded = parseUploadedContractedAttachmentPaths(formData.getAll("uploadedAttachmentPaths"), {
    tenantId,
    subcontractorId: driver.subcontractor_id,
    subjectId: driver.id,
    scope: "contracted-drivers",
  });

  const { data, error } = await supabase
    .from("contracted_driver_certification")
    .insert({
      tenant_id: tenantId,
      contracted_driver_id: driver.id,
      certification_type_id: certificationTypeId,
      name,
      issued_on: optionalDate(formData, "issuedOn"),
      // Null is a real answer: a Common Safety Orientation and most acknowledgements
      // never expire.
      expires_on: optionalDate(formData, "expiresOn"),
      issuing_company: optionalString(formData, "issuingCompany"),
      detail: optionalString(formData, "detail"),
      attachment_path: uploaded[0] ?? null,
    })
    .select("id")
    .maybeSingle<{ id: string }>();

  if (error || !data) {
    backTo(
      driverPath(driver.id),
      readableContractedWriteError(error?.message ?? "The record was not saved.", error?.code),
    );
  }

  await auditContracted(context, {
    action: "contracted_driver.certification.create",
    entityId: data.id,
    entityTable: "contracted_driver_certification",
    metadata: { driver_id: driver.id, has_proof: uploaded.length > 0 },
  });

  revalidatePath(driverPath(driver.id));
  revalidatePath(CONTRACTED_DRIVERS_PATH);
  backTo(driverPath(driver.id), `${name} filed.`, "notice");
}

/**
 * Attach the scan to the record that is short of it, and correct its dates in the same
 * pass. The counterpart of the per-row upload on a unit's documents, and for the same
 * reason: filing a second copy leaves the original still reading as unproven.
 */
export async function attachContractedDriverCertificationProof(formData: FormData) {
  const context = await requireContractedManager();
  const supabase = await createSupabaseServerClient();
  const tenantId = context.appUser.tenant_id;
  const certificationId = stringValue(formData, "certificationId");

  const { data: certification } = await supabase
    .from("contracted_driver_certification")
    .select("id, contracted_driver_id, attachment_path, issued_on, expires_on")
    .eq("tenant_id", tenantId)
    .eq("id", certificationId)
    .maybeSingle<{
      id: string;
      contracted_driver_id: string;
      attachment_path: string | null;
      issued_on: string | null;
      expires_on: string | null;
    }>();

  if (!certification) {
    backTo(CONTRACTED_DRIVERS_PATH, "That record no longer exists.");
  }

  const driver = await requireOwnedDriver(supabase, tenantId, certification.contracted_driver_id);

  if (!driver) {
    backTo(CONTRACTED_DRIVERS_PATH, "That driver no longer exists.");
  }

  const uploaded = parseUploadedContractedAttachmentPaths(formData.getAll("uploadedAttachmentPaths"), {
    tenantId,
    subcontractorId: driver.subcontractor_id,
    subjectId: driver.id,
    scope: "contracted-drivers",
  });

  const issuedOn = optionalDate(formData, "issuedOn");
  const expiresOn = optionalDate(formData, "expiresOn");

  const { error } = await supabase
    .from("contracted_driver_certification")
    .update({
      attachment_path: uploaded[0] ?? certification.attachment_path,
      issued_on: issuedOn ?? certification.issued_on,
      expires_on: expiresOn ?? certification.expires_on,
    })
    .eq("tenant_id", tenantId)
    .eq("id", certification.id);

  if (error) {
    backTo(driverPath(driver.id), readableContractedWriteError(error.message, error.code));
  }

  await auditContracted(context, {
    action: "contracted_driver.certification.attach_proof",
    entityId: certification.id,
    entityTable: "contracted_driver_certification",
    metadata: { driver_id: driver.id, added: uploaded.length },
  });

  revalidatePath(driverPath(driver.id));
  revalidatePath(CONTRACTED_DRIVERS_PATH);
  backTo(driverPath(driver.id), uploaded.length > 0 ? "Document attached." : "Dates updated.", "notice");
}

/**
 * File the scan behind a licence, an abstract or a CSO.
 *
 * Always an insert, never an update. These documents come in series -- an abstract is
 * pulled every year, a licence is renewed every five -- and the newest one replacing the
 * last in place would throw away the record an auditor asks for when they want to see
 * that the carrier has been pulling them. The newest reads as live and the rest as
 * history, the same way a renewed ticket does.
 *
 * The dates asked for here are the ones printed ON THE DOCUMENT, which is why this does
 * not touch the driver's own columns. Those stay the tracked value and are edited under
 * Driver details; when the two disagree the file says so rather than quietly picking one.
 */
export async function attachContractedDriverDocument(formData: FormData) {
  const context = await requireContractedManager();
  const supabase = await createSupabaseServerClient();
  const tenantId = context.appUser.tenant_id;
  const driver = await requireOwnedDriver(supabase, tenantId, stringValue(formData, "driverId"));

  if (!driver) {
    backTo(CONTRACTED_DRIVERS_PATH, "That driver no longer exists.");
  }

  // Deliberately not choiceValue, which falls back to a default when the value is not in
  // the list. A silent fallback here would file a CSO as a driver's licence, which is a
  // worse outcome than refusing the save.
  const posted = stringValue(formData, "docType");
  const docType = DRIVER_DOCUMENT_TYPES.find((type) => type === posted);

  if (!docType) {
    backTo(driverPath(driver.id), "Choose which document this is.");
  }

  const uploaded = parseUploadedContractedAttachmentPaths(formData.getAll("uploadedAttachmentPaths"), {
    tenantId,
    subcontractorId: driver.subcontractor_id,
    subjectId: driver.id,
    scope: "contracted-drivers",
  });

  // The table's attachment_path is not null on purpose: the dates already live on the
  // driver row, so a row here with nothing attached would carry no information at all.
  if (uploaded.length === 0) {
    backTo(driverPath(driver.id), "Choose a file to attach.");
  }

  const { data, error } = await supabase
    .from("contracted_driver_document")
    .insert({
      tenant_id: tenantId,
      contracted_driver_id: driver.id,
      doc_type: docType,
      title: optionalString(formData, "title") ?? DRIVER_DOCUMENT_LABELS[docType],
      issued_date: optionalDate(formData, "issuedDate"),
      // Null is a real answer: a CSO prints "EXPIRES: N/A", and an abstract carries no
      // expiry at all.
      expiry_date: optionalDate(formData, "expiryDate"),
      attachment_path: uploaded[0],
      created_by: context.appUser.id,
    })
    .select("id")
    .maybeSingle<{ id: string }>();

  if (error || !data) {
    backTo(
      driverPath(driver.id),
      readableContractedWriteError(error?.message ?? "The document was not saved.", error?.code),
    );
  }

  await auditContracted(context, {
    action: "contracted_driver.document.attach",
    entityId: data.id,
    entityTable: "contracted_driver_document",
    metadata: { driver_id: driver.id, doc_type: docType },
  });

  revalidatePath(driverPath(driver.id));
  revalidatePath(CONTRACTED_DRIVERS_PATH);
  backTo(driverPath(driver.id), `${DRIVER_DOCUMENT_LABELS[docType]} filed.`, "notice");
}

/**
 * Remove one filed document. Hard delete, matching the certification rows on the same
 * screen: the two behave the same way or the difference becomes a trap.
 */
export async function deleteContractedDriverDocument(formData: FormData) {
  const context = await requireContractedManager();
  const supabase = await createSupabaseServerClient();
  const tenantId = context.appUser.tenant_id;
  const documentId = stringValue(formData, "documentId");
  const driverId = stringValue(formData, "driverId");

  const { error } = await supabase
    .from("contracted_driver_document")
    .delete()
    .eq("tenant_id", tenantId)
    .eq("id", documentId);

  if (error) {
    backTo(driverPath(driverId), readableContractedWriteError(error.message, error.code));
  }

  await auditContracted(context, {
    action: "contracted_driver.document.delete",
    entityId: documentId,
    entityTable: "contracted_driver_document",
    metadata: { driver_id: driverId },
  });

  revalidatePath(driverPath(driverId));
  backTo(driverPath(driverId), "Document removed.", "notice");
}

export async function deleteContractedDriverCertification(formData: FormData) {
  const context = await requireContractedManager();
  const supabase = await createSupabaseServerClient();
  const tenantId = context.appUser.tenant_id;
  const certificationId = stringValue(formData, "certificationId");
  const driverId = stringValue(formData, "driverId");

  // Hard delete, matching public.certifications: a worker ticket has no soft delete
  // either, and the two must behave the same way or the difference becomes a trap.
  const { error } = await supabase
    .from("contracted_driver_certification")
    .delete()
    .eq("tenant_id", tenantId)
    .eq("id", certificationId);

  if (error) {
    backTo(driverPath(driverId), readableContractedWriteError(error.message, error.code));
  }

  await auditContracted(context, {
    action: "contracted_driver.certification.delete",
    entityId: certificationId,
    entityTable: "contracted_driver_certification",
    metadata: { driver_id: driverId },
  });

  revalidatePath(driverPath(driverId));
  backTo(driverPath(driverId), "Record removed.", "notice");
}

/** An audit is somebody watching a task; an evaluation decides what a driver may do. */
const OBSERVATION_TYPES = ["audit", "evaluation"] as const;
const OBSERVATION_OUTCOMES = ["clear", "deficiencies", "failed"] as const;
const SITE_ACCESS_LEVELS = ["unlimited", "limited", "suspended"] as const;

/**
 * File what a client saw the driver do.
 *
 * Two things this deliberately does not do. It does not supersede anything -- every
 * observation stands on its own, and the newest-wins rule that governs certifications
 * would erase the history this exists to keep. And it never touches the driver's
 * compliance state: an audit that found deficiencies is coaching that was written down,
 * not a lapsed ticket.
 */
export async function createContractedDriverObservation(formData: FormData) {
  const context = await requireContractedManager();
  const supabase = await createSupabaseServerClient();
  const tenantId = context.appUser.tenant_id;
  const driver = await requireOwnedDriver(supabase, tenantId, stringValue(formData, "driverId"));

  if (!driver) {
    backTo(CONTRACTED_DRIVERS_PATH, "That driver no longer exists.");
  }

  const observationType = choiceValue(formData, "observationType", OBSERVATION_TYPES, "audit");
  const title = stringValue(formData, "title");

  if (!title) {
    backTo(driverPath(driver.id), "Give this a name -- whatever the report calls it.");
  }

  // Not optionalDate with a fallback to today. The day the work was watched is the whole
  // index of this record, and quietly stamping it with the day someone got round to
  // typing it in would file an observation against a day the driver may not have worked.
  const observedOn = optionalDate(formData, "observedOn");

  if (!observedOn) {
    backTo(driverPath(driver.id), "Enter the date the work was observed, as written on the report.");
  }

  const outcome = choiceValue(formData, "outcome", OBSERVATION_OUTCOMES, "clear");
  const postedAccess = stringValue(formData, "siteAccess");
  const siteAccess = SITE_ACCESS_LEVELS.find((level) => level === postedAccess) ?? null;

  const uploaded = parseUploadedContractedAttachmentPaths(formData.getAll("uploadedAttachmentPaths"), {
    tenantId,
    subcontractorId: driver.subcontractor_id,
    subjectId: driver.id,
    scope: "contracted-drivers",
  });

  const { data, error } = await supabase
    .from("contracted_driver_observation")
    .insert({
      tenant_id: tenantId,
      contracted_driver_id: driver.id,
      observation_type: observationType,
      title,
      observed_on: observedOn,
      reported_on: optionalDate(formData, "reportedOn"),
      issuing_company: optionalString(formData, "issuingCompany"),
      observer: optionalString(formData, "observer"),
      location: optionalString(formData, "location"),
      outcome,
      site_access: siteAccess,
      findings: optionalString(formData, "findings"),
      action_taken: optionalString(formData, "actionTaken"),
      // Nullable on purpose: the row is the record, so it can be written down before the
      // report arrives.
      attachment_path: uploaded[0] ?? null,
      created_by: context.appUser.id,
    })
    .select("id")
    .maybeSingle<{ id: string }>();

  if (error || !data) {
    backTo(
      driverPath(driver.id),
      readableContractedWriteError(error?.message ?? "The observation was not saved.", error?.code),
    );
  }

  await auditContracted(context, {
    action: "contracted_driver.observation.create",
    entityId: data.id,
    entityTable: "contracted_driver_observation",
    metadata: {
      driver_id: driver.id,
      observation_type: observationType,
      outcome,
      site_access: siteAccess,
      has_proof: uploaded.length > 0,
    },
  });

  revalidatePath(driverPath(driver.id));
  backTo(driverPath(driver.id), `${title} filed.`, "notice");
}

/**
 * Remove an observation.
 *
 * A soft delete, unlike the certification and identity-document rows beside it. Those
 * describe a document that either exists or does not; this describes something that
 * happened, and a client's write-up of a driver is exactly the kind of record where
 * "who removed it, and when" is a question worth being able to answer later.
 */
export async function deleteContractedDriverObservation(formData: FormData) {
  const context = await requireContractedManager();
  const supabase = await createSupabaseServerClient();
  const tenantId = context.appUser.tenant_id;
  const observationId = stringValue(formData, "observationId");
  const driverId = stringValue(formData, "driverId");

  const { error } = await supabase
    .from("contracted_driver_observation")
    .update({ deleted_at: new Date().toISOString() })
    .eq("tenant_id", tenantId)
    .eq("id", observationId)
    .is("deleted_at", null);

  if (error) {
    backTo(driverPath(driverId), readableContractedWriteError(error.message, error.code));
  }

  await auditContracted(context, {
    action: "contracted_driver.observation.delete",
    entityId: observationId,
    entityTable: "contracted_driver_observation",
    metadata: { driver_id: driverId },
  });

  revalidatePath(driverPath(driverId));
  backTo(driverPath(driverId), "Observation removed.", "notice");
}

// --- The medical vault, for a hired carrier's driver -------------------------
//
// Separate from the certifications above, and gated on a different capability. What
// belongs here is the RECORD, never the DATE: the D&A certification and its expiry stay
// on the driver's file where the whole company can see them, and only the collector's
// paperwork comes here, because that is a person's body chemistry.
//
// A contracted driver has no user account, so the "read your own file" branch of
// authz.current_user_can_access_medical_vault can never match for them. These are
// reachable by medical_vault_access holders and by nobody else -- tighter than for an
// employee, and correct, since the app cannot authenticate another company's employee.

const VAULT_RECORD_TYPES = ["injury", "medical", "wcb", "first_aid", "drug_alcohol", "other"] as const;

/**
 * Vault access is its own capability, not a rank.
 *
 * requireContractedManager is deliberately NOT enough. Everyone who can open a carrier's
 * file can manage contracted drivers; this section is for the one person the company
 * named. Being a super admin has not been enough since 20260826040000.
 */
async function requireContractedVaultManager() {
  // Both gates, in order: the contracted module's own (admin panel, subcontractors
  // switched on), then the vault capability on top. Either alone would be a hole.
  const context = await requireContractedManager();

  if (!canManageMedicalVault(context.appUser, context.permissionProfile?.capabilities)) {
    backTo(CONTRACTED_DRIVERS_PATH, "That is held in the medical vault, which you do not have access to.");
  }

  return context;
}

export async function uploadContractedDriverMedicalRecord(formData: FormData) {
  const context = await requireContractedVaultManager();
  const supabase = await createSupabaseServerClient();
  const tenantId = context.appUser.tenant_id;
  const driver = await requireOwnedDriver(supabase, tenantId, stringValue(formData, "driverId"));

  if (!driver) {
    backTo(CONTRACTED_DRIVERS_PATH, "That driver no longer exists.");
  }

  const recordType = choiceValue(formData, "recordType", VAULT_RECORD_TYPES, "other");
  const file = formData.get("file");

  if (!(file instanceof File) || file.size === 0) {
    backTo(driverPath(driver.id), "Choose a file.");
  }

  const title = optionalString(formData, "title") ?? file.name;

  // {tenant}/{subject}/... is the shape the medical-vault storage policy parses; anything
  // else the bucket refuses whoever is asking.
  const storagePath = [
    tenantId,
    driver.id,
    `${Date.now()}-${file.name.replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120)}`,
  ].join("/");

  const { error: uploadError } = await supabase.storage.from("medical-vault").upload(storagePath, file, {
    contentType: file.type || "application/octet-stream",
    upsert: false,
  });

  if (uploadError) {
    backTo(driverPath(driver.id), uploadError.message);
  }

  const { data: record, error } = await supabase
    .from("transport_medical_record")
    .insert({
      tenant_id: tenantId,
      driver_id: null,
      contracted_driver_id: driver.id,
      record_type: recordType,
      title,
      storage_path: storagePath,
      occurred_on: optionalDate(formData, "occurredOn"),
      notes: optionalString(formData, "notes"),
      created_by: context.appUser.id,
    })
    .select("id")
    .maybeSingle<{ id: string }>();

  if (error || !record) {
    // Take the object back out rather than leave a health record in the bucket that no
    // row points at and nothing will ever list.
    await supabase.storage.from("medical-vault").remove([storagePath]);
    backTo(driverPath(driver.id), readableContractedWriteError(error?.message ?? "The record was not saved.", error?.code));
  }

  // The title and notes are deliberately kept out of the audit metadata: the audit log is
  // readable by people the vault is not.
  await auditContracted(context, {
    action: "contracted_driver.medical_record.upload",
    entityId: record.id,
    entityTable: "transport_medical_record",
    metadata: { contracted_driver_id: driver.id, record_type: recordType },
  });

  revalidatePath(driverPath(driver.id));
  backTo(driverPath(driver.id), "Filed in the medical vault.", "notice");
}

export async function archiveContractedDriverMedicalRecord(formData: FormData) {
  const context = await requireContractedVaultManager();
  const supabase = await createSupabaseServerClient();
  const tenantId = context.appUser.tenant_id;
  const recordId = stringValue(formData, "recordId");
  const driverId = stringValue(formData, "driverId");

  // Archived, not deleted, and the file stays in the bucket. A health record that was
  // filed and then withdrawn is itself something an auditor may ask about.
  const { error } = await supabase
    .from("transport_medical_record")
    .update({ status: "archived" })
    .eq("tenant_id", tenantId)
    .eq("id", recordId)
    .eq("contracted_driver_id", driverId);

  if (error) {
    backTo(driverPath(driverId), readableContractedWriteError(error.message, error.code));
  }

  await auditContracted(context, {
    action: "contracted_driver.medical_record.archive",
    entityId: recordId,
    entityTable: "transport_medical_record",
    metadata: { contracted_driver_id: driverId },
  });

  revalidatePath(driverPath(driverId));
  backTo(driverPath(driverId), "Record archived.", "notice");
}
