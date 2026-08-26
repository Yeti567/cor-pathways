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
import { parseUploadedContractedAttachmentPaths } from "@/lib/contracted-equipment";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

type DriverRow = Database["public"]["Tables"]["contracted_driver"]["Row"];

const DRIVER_TYPES = ["contracted", "casual"] as const;
const STATUSES = ["active", "inactive", "terminated"] as const;

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
