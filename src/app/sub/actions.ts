"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { sanitizeStorageFilename } from "@/lib/document-control";
import { requireSubcontractorUser } from "@/lib/current-user";
import {
  buildSubcontractorDocumentWrite,
  resolveIntervalMonths,
  resolveSubcontractorSlots,
  type SubcontractorRequirementSetting,
} from "@/lib/subcontractor-requirements";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const BUCKET = "subcontractor-documents";
const PORTAL_PATH = "/sub";

function stringValue(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function optionalString(formData: FormData, key: string): string | null {
  const value = stringValue(formData, key);
  return value ? value : null;
}

function optionalDate(formData: FormData, key: string): string | null {
  const value = stringValue(formData, key);
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function optionalMoney(formData: FormData, key: string): number | null {
  const raw = stringValue(formData, key).replace(/[$,\s]/g, "");

  if (!raw) {
    return null;
  }

  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed * 100) / 100 : null;
}

function backToPortal(message: string, kind: "error" | "notice" = "error"): never {
  redirect(`${PORTAL_PATH}?${kind}=${encodeURIComponent(message)}`);
}

/**
 * The carrier files a document.
 *
 * Everything here runs as the carrier's own session, never the service role, so row
 * level security is doing the real work and this function is only responsible for asking
 * for something sensible. In particular it does not set review_status: the insert policy
 * requires 'pending' and refuses anything else, so a bug here cannot produce an
 * accepted document.
 */
export async function submitSubcontractorDocument(formData: FormData) {
  const context = await requireSubcontractorUser();
  const subcontractorId = stringValue(formData, "subcontractorId");
  const slotKey = stringValue(formData, "slotKey");

  const access = context.access.find((row) => row.subcontractor_id === subcontractorId);

  if (!access) {
    backToPortal("That company is not on your account.");
  }

  const supabase = await createSupabaseServerClient();

  // Read the bar this hiring company set, so the interval and lead written onto the row
  // match what they configured rather than the shipped defaults.
  const { data: settingRows } = await supabase
    .from("subcontractor_requirement_setting")
    .select("slot_key, enabled, required, minimum_coverage_amount, reminder_lead_days, interval_months")
    .eq("tenant_id", access.tenant_id);

  const settings: SubcontractorRequirementSetting[] = (settingRows ?? []).map((row) => ({
    enabled: row.enabled,
    intervalMonths: row.interval_months,
    minimumCoverageAmount: row.minimum_coverage_amount === null ? null : Number(row.minimum_coverage_amount),
    reminderLeadDays: row.reminder_lead_days,
    required: row.required,
    slotKey: row.slot_key,
  }));

  const slot = resolveSubcontractorSlots(settings).find((entry) => entry.key === slotKey) ?? null;

  if (!slot) {
    backToPortal("That document is not being collected.");
  }

  const file = formData.get("file");

  if (!(file instanceof File) || file.size === 0) {
    backToPortal("Choose a file to upload.");
  }

  const issuedDate = optionalDate(formData, "issuedDate");
  const expiryDate = optionalDate(formData, "expiryDate");

  if (slot.dueMode === "expiry" && !expiryDate) {
    backToPortal(`${slot.label} needs the expiry date printed on it.`);
  }

  if (slot.dueMode === "interval" && !issuedDate) {
    backToPortal(`${slot.label} needs the date it was issued.`);
  }

  const storagePath = [
    access.tenant_id,
    subcontractorId,
    slot.key,
    `${Date.now()}-${sanitizeStorageFilename(file.name)}`,
  ].join("/");

  const { error: uploadError } = await supabase.storage.from(BUCKET).upload(storagePath, file, {
    contentType: file.type || "application/octet-stream",
    upsert: false,
  });

  if (uploadError) {
    backToPortal(uploadError.message);
  }

  const write = buildSubcontractorDocumentWrite(
    slot,
    {
      additionalInsured: formData.get("additionalInsured") === "on",
      coverageAmount: optionalMoney(formData, "coverageAmount"),
      deductibleAmount: optionalMoney(formData, "deductibleAmount"),
      documentNumber: optionalString(formData, "documentNumber"),
      expiryDate,
      // The carrier does not get to state its own safety rating or WCB rates. Those are
      // read off the document by whoever reviews it, so nothing is captured here.
      fields: {},
      insurer: optionalString(formData, "insurer"),
      issuedDate,
      reminderLeadDays: null,
      storagePath,
      title: null,
    },
    { intervalMonths: resolveIntervalMonths(slot, null) },
  );

  const { data, error } = await supabase
    .from("subcontractor_document")
    .insert({
      ...write,
      review_status: "pending",
      subcontractor_id: subcontractorId,
      submitted_by_subcontractor_user: context.subcontractorUser.id,
      tenant_id: access.tenant_id,
    })
    .select("id")
    .single();

  if (error) {
    // Roll back the orphaned object so storage does not drift from the table.
    await supabase.storage.from(BUCKET).remove([storagePath]);
    backToPortal(error.message);
  }

  await supabase.from("subcontractor_audit_log").insert({
    action: "subcontractor.portal.submit",
    metadata: { document_id: data.id, slot_key: slot.key },
    subcontractor_id: subcontractorId,
    subcontractor_user_id: context.subcontractorUser.id,
    tenant_id: access.tenant_id,
  });

  revalidatePath(PORTAL_PATH);
  backToPortal(`${slot.label} sent. It will show as received once it has been checked.`, "notice");
}

/**
 * The carrier corrects how to reach it.
 *
 * Only contact and broker details. A database trigger enforces that independently, so
 * the narrow column list below is the polite version of a rule that does not depend on
 * this function being written correctly.
 */
export async function updateSubcontractorContactDetails(formData: FormData) {
  const context = await requireSubcontractorUser();
  const subcontractorId = stringValue(formData, "subcontractorId");
  const access = context.access.find((row) => row.subcontractor_id === subcontractorId);

  if (!access) {
    backToPortal("That company is not on your account.");
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("subcontractor")
    .update({
      broker_email: optionalString(formData, "brokerEmail"),
      broker_name: optionalString(formData, "brokerName"),
      broker_phone: optionalString(formData, "brokerPhone"),
      contact_email: optionalString(formData, "contactEmail"),
      contact_name: optionalString(formData, "contactName"),
      contact_phone: optionalString(formData, "contactPhone"),
    })
    .eq("id", subcontractorId)
    .select("id");

  if (error) {
    backToPortal(error.message);
  }

  if (!data || data.length === 0) {
    backToPortal("Nothing was saved. Your access may have been withdrawn.");
  }

  await supabase.from("subcontractor_audit_log").insert({
    action: "subcontractor.portal.update_contact",
    metadata: {},
    subcontractor_id: subcontractorId,
    subcontractor_user_id: context.subcontractorUser.id,
    tenant_id: access.tenant_id,
  });

  revalidatePath(PORTAL_PATH);
  backToPortal("Your details are saved.", "notice");
}
