"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { loadResolvedSubcontractorSlots } from "@/app/admin/subcontractors/_lib/settings";
import { canUseAdminPanel } from "@/lib/access-control";
import { requireAppUser } from "@/lib/current-user";
import { sanitizeStorageFilename } from "@/lib/document-control";
import {
  buildSubcontractorDocumentWrite,
  isSubcontractorSlotKey,
  resolveIntervalMonths,
  slotCaptures,
  SUBCONTRACTOR_MONITORING_STATUSES,
  SUBCONTRACTOR_SAFETY_RATINGS,
  SUBCONTRACTOR_SLOTS,
  type SubcontractorSlot,
} from "@/lib/subcontractor-requirements";
import { inviteSubcontractorContact } from "@/lib/subcontractor-invite";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { recordTenantAuditEvent } from "@/lib/tenant-audit";
import type { Database } from "@/types/database";

const BUCKET = "subcontractor-documents";
const LIST_PATH = "/admin/subcontractors";

// --- Form helpers (mirrors the admin/actions.ts conventions) ----------------

function stringValue(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function optionalString(formData: FormData, key: string): string | null {
  const value = stringValue(formData, key);
  return value ? value : null;
}

function checkboxValue(formData: FormData, key: string) {
  return formData.get(key) === "on" || formData.get(key) === "true";
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

  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }

  return Math.round(parsed * 100) / 100;
}

function optionalChoice(formData: FormData, key: string, allowed: readonly { value: string }[]): string | null {
  const value = stringValue(formData, key);
  return allowed.some((option) => option.value === value) ? value : null;
}

function backToList(message: string, kind: "error" | "notice" = "error"): never {
  redirect(`${LIST_PATH}?${kind}=${encodeURIComponent(message)}`);
}

function backToSubcontractor(
  subcontractorId: string,
  message: string,
  kind: "error" | "notice" = "error",
): never {
  redirect(`${LIST_PATH}/${subcontractorId}?${kind}=${encodeURIComponent(message)}`);
}

/**
 * Module write gate: an admin-capable user in a tenant that has the module switched on.
 *
 * Defense in depth behind the hidden nav entry and the page guard. Those two shape what
 * a person sees; this one decides what the server will accept, which is the only part
 * that cannot be skipped by typing a URL.
 */
async function requireSubcontractorManager() {
  const context = await requireAppUser();

  if (!canUseAdminPanel(context.appUser)) {
    redirect("/choose");
  }

  if (!context.tenant?.subcontractors_enabled) {
    redirect("/admin/setup");
  }

  return context;
}

type ManagerContext = Awaited<ReturnType<typeof requireSubcontractorManager>>;

async function audit(
  context: ManagerContext,
  input: { action: string; entityId: string; entityTable: string; metadata?: Record<string, unknown> },
) {
  await recordTenantAuditEvent({
    tenantId: context.appUser.tenant_id,
    actorRole: context.appUser.power_level,
    actorUserId: context.appUser.id,
    action: input.action,
    entityId: input.entityId,
    entityTable: input.entityTable,
    metadata: (input.metadata ?? {}) as Record<string, never>,
  });
}

function readableWriteError(message: string, code?: string): string {
  if (code === "23505" && message.includes("subcontractor_tenant_legal_name_key")) {
    return "A subcontractor with that legal name already exists.";
  }

  return message;
}

/**
 * Confirm the subcontractor belongs to this tenant before anything is written against it.
 *
 * Row level security would refuse a cross-tenant write anyway, but it refuses by
 * matching nothing, which reads back as a successful update of zero rows. Checking first
 * turns that silence into a message that names the problem.
 */
async function requireOwnedSubcontractor(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  tenantId: string,
  subcontractorId: string,
) {
  if (!subcontractorId) {
    return null;
  }

  const { data } = await supabase
    .from("subcontractor")
    .select("id, carrier_profile_interval_months, rate_statement_interval_months")
    .eq("id", subcontractorId)
    .eq("tenant_id", tenantId)
    .is("deleted_at", null)
    .maybeSingle();

  return data ?? null;
}

// --- Subcontractors ---------------------------------------------------------

function subcontractorFieldsFromForm(formData: FormData) {
  return {
    legal_name: stringValue(formData, "legalName"),
    operating_name: optionalString(formData, "operatingName"),
    contact_name: optionalString(formData, "contactName"),
    contact_email: optionalString(formData, "contactEmail"),
    contact_phone: optionalString(formData, "contactPhone"),
    nsc_number: optionalString(formData, "nscNumber"),
    wcb_account_number: optionalString(formData, "wcbAccountNumber"),
    broker_name: optionalString(formData, "brokerName"),
    broker_email: optionalString(formData, "brokerEmail"),
    broker_phone: optionalString(formData, "brokerPhone"),
    notes: optionalString(formData, "notes"),
  };
}

export async function createSubcontractor(formData: FormData) {
  const context = await requireSubcontractorManager();
  const fields = subcontractorFieldsFromForm(formData);

  if (!fields.legal_name) {
    backToList("Enter the subcontractor's legal name.");
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("subcontractor")
    .insert({ ...fields, created_by: context.appUser.id, tenant_id: context.appUser.tenant_id })
    .select("id")
    .single();

  if (error) {
    backToList(readableWriteError(error.message, error.code));
  }

  await audit(context, {
    action: "subcontractor.create",
    entityId: data.id,
    entityTable: "subcontractor",
    metadata: { legal_name: fields.legal_name },
  });

  revalidatePath(LIST_PATH);
  backToSubcontractor(data.id, `${fields.legal_name} added. File their documents below.`, "notice");
}

export async function updateSubcontractor(formData: FormData) {
  const context = await requireSubcontractorManager();
  const subcontractorId = stringValue(formData, "subcontractorId");
  const fields = subcontractorFieldsFromForm(formData);

  if (!fields.legal_name) {
    backToSubcontractor(subcontractorId, "Enter the subcontractor's legal name.");
  }

  const supabase = await createSupabaseServerClient();

  if (!(await requireOwnedSubcontractor(supabase, context.appUser.tenant_id, subcontractorId))) {
    backToList("Subcontractor not found.");
  }

  const { data, error } = await supabase
    .from("subcontractor")
    .update({ ...fields, active: !checkboxValue(formData, "archived") })
    .eq("id", subcontractorId)
    .eq("tenant_id", context.appUser.tenant_id)
    .select("id");

  if (error) {
    backToSubcontractor(subcontractorId, readableWriteError(error.message, error.code));
  }

  if (!data || data.length === 0) {
    backToSubcontractor(subcontractorId, "Nothing was saved. You may not have permission to change this record.");
  }

  await audit(context, {
    action: "subcontractor.update",
    entityId: subcontractorId,
    entityTable: "subcontractor",
    metadata: { legal_name: fields.legal_name },
  });

  revalidatePath(LIST_PATH);
  backToSubcontractor(subcontractorId, "Saved.", "notice");
}

export async function removeSubcontractor(formData: FormData) {
  const context = await requireSubcontractorManager();
  const subcontractorId = stringValue(formData, "subcontractorId");
  const supabase = await createSupabaseServerClient();

  if (!(await requireOwnedSubcontractor(supabase, context.appUser.tenant_id, subcontractorId))) {
    backToList("Subcontractor not found.");
  }

  // Soft delete. The filed documents are the evidence of what was checked and when, and
  // removing a company from the active list is not a reason to destroy that.
  const { data, error } = await supabase
    .from("subcontractor")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", subcontractorId)
    .eq("tenant_id", context.appUser.tenant_id)
    .select("id");

  if (error) {
    backToSubcontractor(subcontractorId, error.message);
  }

  if (!data || data.length === 0) {
    backToSubcontractor(subcontractorId, "Nothing was removed. You may not have permission to change this record.");
  }

  await audit(context, {
    action: "subcontractor.remove",
    entityId: subcontractorId,
    entityTable: "subcontractor",
  });

  revalidatePath(LIST_PATH);
  backToList("Subcontractor removed.", "notice");
}

// --- Portal logins ----------------------------------------------------------

/**
 * Invite (or re-invite) a person at a hired carrier.
 *
 * Everything that creates identity runs through the service role, not the admin's own
 * session. There is deliberately no insert or update policy on subcontractor_user for
 * `authenticated` at all, so a portal login cannot mint a second login or reactivate a
 * revoked one even if it found a way to post here.
 */
export async function inviteSubcontractorUser(formData: FormData) {
  const context = await requireSubcontractorManager();
  const subcontractorId = stringValue(formData, "subcontractorId");
  const email = stringValue(formData, "email").toLowerCase();
  const fullName = stringValue(formData, "fullName");

  if (!email || !email.includes("@")) {
    backToSubcontractor(subcontractorId, "Enter the email address to invite.");
  }

  if (!fullName) {
    backToSubcontractor(subcontractorId, "Enter the name of the person you are inviting.");
  }

  const supabase = await createSupabaseServerClient();
  const { data: carrier } = await supabase
    .from("subcontractor")
    .select("id, legal_name")
    .eq("id", subcontractorId)
    .eq("tenant_id", context.appUser.tenant_id)
    .is("deleted_at", null)
    .maybeSingle();

  if (!carrier) {
    backToList("Subcontractor not found.");
  }

  const adminSupabase = createSupabaseAdminClient();

  if (!adminSupabase) {
    backToSubcontractor(subcontractorId, "Portal invitations need a service role key, which is not configured.");
  }

  const invite = await inviteSubcontractorContact(adminSupabase, {
    carrierName: carrier.legal_name,
    companyName: context.tenant?.name ?? "The hiring company",
    email,
    fullName,
    redirectTo: `${process.env.NEXT_PUBLIC_APP_URL ?? "http://127.0.0.1:3000"}/auth/confirm?next=%2Fsub`,
    tenantId: context.appUser.tenant_id,
  });

  if (!invite.ok) {
    backToSubcontractor(subcontractorId, invite.error);
  }

  const { error: userError } = await adminSupabase
    .from("subcontractor_user")
    .upsert(
      { active: true, email, full_name: fullName, id: invite.user.id },
      { onConflict: "id" },
    );

  if (userError) {
    backToSubcontractor(subcontractorId, userError.message);
  }

  // Re-inviting somebody who was revoked restores them, which is the behaviour an admin
  // expects from pressing invite again.
  const { error: accessError } = await adminSupabase.from("subcontractor_user_access").upsert(
    {
      allowed: true,
      invited_by: context.appUser.id,
      subcontractor_id: subcontractorId,
      subcontractor_user_id: invite.user.id,
      tenant_id: context.appUser.tenant_id,
    },
    { onConflict: "subcontractor_user_id,subcontractor_id" },
  );

  if (accessError) {
    backToSubcontractor(subcontractorId, accessError.message);
  }

  await adminSupabase.from("subcontractor_audit_log").insert({
    action: "subcontractor.portal.invite",
    metadata: { email, invited_by: context.appUser.id },
    subcontractor_id: subcontractorId,
    subcontractor_user_id: invite.user.id,
    tenant_id: context.appUser.tenant_id,
  });

  await audit(context, {
    action: "subcontractor.portal.invite",
    entityId: subcontractorId,
    entityTable: "subcontractor_user_access",
    metadata: { email },
  });

  revalidatePath(LIST_PATH);
  backToSubcontractor(
    subcontractorId,
    invite.emailWarning
      ? `Login created, but the email was not sent: ${invite.emailWarning}`
      : `Invitation sent to ${email}.`,
    invite.emailWarning ? "error" : "notice",
  );
}

/**
 * Revoke a portal login for one carrier.
 *
 * Flips `allowed` rather than deleting the row, so who had access and when stays
 * answerable. The row level security gate reads `allowed`, so the door shuts on the next
 * request without touching the auth user, who may still legitimately act for a different
 * carrier or a different hiring company.
 */
export async function revokeSubcontractorUser(formData: FormData) {
  const context = await requireSubcontractorManager();
  const subcontractorId = stringValue(formData, "subcontractorId");
  const accessId = stringValue(formData, "accessId");
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("subcontractor_user_access")
    .update({ allowed: false })
    .eq("id", accessId)
    .eq("tenant_id", context.appUser.tenant_id)
    .select("id, subcontractor_user_id");

  if (error) {
    backToSubcontractor(subcontractorId, error.message);
  }

  if (!data || data.length === 0) {
    backToSubcontractor(subcontractorId, "Nothing was revoked. You may not have permission to change this record.");
  }

  await audit(context, {
    action: "subcontractor.portal.revoke",
    entityId: accessId,
    entityTable: "subcontractor_user_access",
    metadata: { subcontractor_id: subcontractorId },
  });

  revalidatePath(LIST_PATH);
  backToSubcontractor(subcontractorId, "Portal access revoked.", "notice");
}

// --- Requirements -----------------------------------------------------------

const REQUIREMENTS_PATH = "/admin/subcontractors/requirements";

function backToRequirements(message: string, kind: "error" | "notice" = "error"): never {
  redirect(`${REQUIREMENTS_PATH}?${kind}=${encodeURIComponent(message)}`);
}

function optionalInteger(formData: FormData, key: string, min: number, max: number): number | null {
  const raw = stringValue(formData, key);

  if (!raw) {
    return null;
  }

  const parsed = Number(raw);

  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < min || parsed > max) {
    return null;
  }

  return parsed;
}

/**
 * Save the whole requirements screen in one write.
 *
 * One row per slot, upserted on (tenant_id, slot_key). A blank override field stores
 * null rather than the default it would have fallen back to, so the shipped defaults
 * stay improvable: a value in the column always means somebody chose it.
 */
export async function updateSubcontractorRequirements(formData: FormData) {
  const context = await requireSubcontractorManager();
  const supabase = await createSupabaseServerClient();

  const rows = SUBCONTRACTOR_SLOTS.map((slot) => ({
    enabled: checkboxValue(formData, `enabled__${slot.key}`),
    interval_months: slot.dueMode === "interval" ? optionalInteger(formData, `interval__${slot.key}`, 1, 60) : null,
    minimum_coverage_amount: slotCaptures(slot, "coverage_amount")
      ? optionalMoney(formData, `minimum__${slot.key}`)
      : null,
    reminder_lead_days: optionalInteger(formData, `lead__${slot.key}`, 0, 365),
    required: checkboxValue(formData, `required__${slot.key}`),
    slot_key: slot.key,
    tenant_id: context.appUser.tenant_id,
  }));

  if (rows.every((row) => !row.enabled)) {
    backToRequirements("Leave at least one document switched on, or the module has nothing to track.");
  }

  const { data, error } = await supabase
    .from("subcontractor_requirement_setting")
    .upsert(rows, { onConflict: "tenant_id,slot_key" })
    .select("id");

  if (error) {
    backToRequirements(error.message);
  }

  if (!data || data.length === 0) {
    backToRequirements("Nothing was saved. You may not have permission to change these settings.");
  }

  await audit(context, {
    action: "subcontractor.requirements.update",
    entityId: context.appUser.tenant_id,
    entityTable: "subcontractor_requirement_setting",
    metadata: {
      disabled: rows.filter((row) => !row.enabled).map((row) => row.slot_key),
      minimums: Object.fromEntries(
        rows.filter((row) => row.minimum_coverage_amount !== null).map((row) => [row.slot_key, row.minimum_coverage_amount]),
      ),
    },
  });

  revalidatePath(LIST_PATH);
  revalidatePath(REQUIREMENTS_PATH);
  backToRequirements("Requirements saved.", "notice");
}

// --- Documents --------------------------------------------------------------

/**
 * Values a slot captures that also belong on the subcontractor itself.
 *
 * A safety rating read off a carrier profile is a fact about the carrier, not only about
 * that one PDF, and the list has to be sortable by it. Same for the two account numbers.
 * They are stored on the document as the record of what that filing said, and copied up
 * so the current answer is one column away.
 */
function parentPatchFromCaptures(slot: SubcontractorSlot, fields: Record<string, string | null>) {
  const patch: Database["public"]["Tables"]["subcontractor"]["Update"] = {};

  if (slotCaptures(slot, "safety_rating") && fields.safety_rating) {
    patch.safety_rating = fields.safety_rating;
  }

  if (slotCaptures(slot, "monitoring_status") && fields.monitoring_status) {
    patch.monitoring_status = fields.monitoring_status;
  }

  if (slotCaptures(slot, "wcb_account") && fields.wcb_account) {
    patch.wcb_account_number = fields.wcb_account;
  }

  return patch;
}

export async function fileSubcontractorDocument(formData: FormData) {
  const context = await requireSubcontractorManager();
  const subcontractorId = stringValue(formData, "subcontractorId");
  const slotKey = stringValue(formData, "slotKey");

  const supabase = await createSupabaseServerClient();
  const subcontractor = await requireOwnedSubcontractor(supabase, context.appUser.tenant_id, subcontractorId);

  if (!subcontractor) {
    backToList("Subcontractor not found.");
  }

  // Resolved rather than raw, so a slot this company has switched off cannot be filed
  // against by posting the form directly, and so the interval and lead that get written
  // are the ones the company actually configured.
  const { slots } = await loadResolvedSubcontractorSlots(supabase, context.appUser.tenant_id);
  const slot = slots.find((entry) => entry.key === slotKey) ?? null;

  if (!slot) {
    backToSubcontractor(
      subcontractorId,
      isSubcontractorSlotKey(slotKey)
        ? "That document is switched off for your company. Turn it back on under Requirements."
        : "That is not a document we collect.",
    );
  }

  const file = formData.get("file");
  // A broker often issues one certificate covering auto, general liability, and cargo on
  // a single PDF, with a different limit and sometimes a different expiry on each line.
  // Rather than storing that file three times, a later slot can point at the copy already
  // uploaded and still carry its own dates and limits.
  const reusePath = optionalString(formData, "reuseStoragePath");
  const hasUpload = file instanceof File && file.size > 0;

  if (!hasUpload && !reusePath) {
    backToSubcontractor(subcontractorId, "Choose a file, or reuse one already uploaded for this subcontractor.");
  }

  const issuedDate = optionalDate(formData, "issuedDate");
  const expiryDate = optionalDate(formData, "expiryDate");

  if (slot.dueMode === "expiry" && !expiryDate) {
    backToSubcontractor(subcontractorId, `${slot.label} needs an expiry date, or nothing can warn you before it lapses.`);
  }

  if (slot.dueMode === "interval" && !issuedDate) {
    backToSubcontractor(
      subcontractorId,
      `${slot.label} needs the date it was issued, because it falls due on an interval rather than carrying an expiry.`,
    );
  }

  if (reusePath && !reusePath.startsWith(`${context.appUser.tenant_id}/${subcontractorId}/`)) {
    backToSubcontractor(subcontractorId, "That file does not belong to this subcontractor.");
  }

  let storagePath = reusePath;

  if (hasUpload) {
    // Tenant id leads the path so the bucket's folder-scoped policy applies, and so the
    // restrictive policy that blocks writes into demo tenants applies too.
    storagePath = [
      context.appUser.tenant_id,
      subcontractorId,
      slot.key,
      `${Date.now()}-${sanitizeStorageFilename(file.name)}`,
    ].join("/");

    const { error: uploadError } = await supabase.storage.from(BUCKET).upload(storagePath, file, {
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });

    if (uploadError) {
      backToSubcontractor(subcontractorId, uploadError.message);
    }
  }

  const fields: Record<string, string | null> = {
    employer_rate: optionalString(formData, "employerRate"),
    industry_rate: optionalString(formData, "industryRate"),
    monitoring_status: optionalChoice(formData, "monitoringStatus", SUBCONTRACTOR_MONITORING_STATUSES),
    safety_rating: optionalChoice(formData, "safetyRating", SUBCONTRACTOR_SAFETY_RATINGS),
    wcb_account: optionalString(formData, "wcbAccount"),
  };

  const write = buildSubcontractorDocumentWrite(
    slot,
    {
      additionalInsured: checkboxValue(formData, "additionalInsured"),
      coverageAmount: optionalMoney(formData, "coverageAmount"),
      deductibleAmount: optionalMoney(formData, "deductibleAmount"),
      documentNumber: optionalString(formData, "documentNumber"),
      expiryDate,
      fields,
      insurer: optionalString(formData, "insurer"),
      issuedDate,
      reminderLeadDays: null,
      storagePath,
      title: optionalString(formData, "title"),
    },
    {
      // Most specific wins: this carrier's exception, then the company policy already
      // folded into the resolved slot, then the shipped default.
      intervalMonths: resolveIntervalMonths(
        slot,
        slot.key === "carrier_profile"
          ? subcontractor.carrier_profile_interval_months
          : slot.key === "wcb_rate_statement"
            ? subcontractor.rate_statement_interval_months
            : null,
      ),
    },
  );

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("subcontractor_document")
    .insert({
      ...write,
      created_by: context.appUser.id,
      // Filed by the hiring company itself, from a certificate it already accepted, so
      // there is no third party left to review it. Documents that arrive through the
      // subcontractor's own portal land as 'pending' instead, and go through the review
      // workflow that arrives with it.
      review_status: "approved",
      reviewed_at: now,
      reviewed_by: context.appUser.id,
      subcontractor_id: subcontractorId,
      tenant_id: context.appUser.tenant_id,
    })
    .select("id")
    .single();

  if (error) {
    if (hasUpload && storagePath) {
      // Roll back the orphaned object so storage does not drift from the table.
      await supabase.storage.from(BUCKET).remove([storagePath]);
    }

    backToSubcontractor(subcontractorId, readableWriteError(error.message, error.code));
  }

  // Supersede whatever this replaces, so the slot reads as one live document with a
  // history behind it rather than a pile of equally current copies.
  const { data: replaced } = await supabase
    .from("subcontractor_document")
    .update({ superseded_by_id: data.id })
    .eq("subcontractor_id", subcontractorId)
    .eq("tenant_id", context.appUser.tenant_id)
    .eq("slot_key", slot.key)
    .neq("id", data.id)
    .is("superseded_by_id", null)
    .is("deleted_at", null)
    .select("id");

  const parentPatch = parentPatchFromCaptures(slot, fields);

  if (Object.keys(parentPatch).length > 0) {
    await supabase
      .from("subcontractor")
      .update(parentPatch)
      .eq("id", subcontractorId)
      .eq("tenant_id", context.appUser.tenant_id);
  }

  await audit(context, {
    action: "subcontractor.document.file",
    entityId: data.id,
    entityTable: "subcontractor_document",
    metadata: {
      due_date: write.due_date,
      reused_existing_file: !hasUpload,
      slot_key: slot.key,
      subcontractor_id: subcontractorId,
      superseded_count: replaced?.length ?? 0,
    },
  });

  revalidatePath(LIST_PATH);
  backToSubcontractor(subcontractorId, `${slot.label} filed.`, "notice");
}

/**
 * Accept or return a document the carrier filed.
 *
 * Approval is where superseding happens, not upload. A pending file is a claim, and
 * retiring the certificate the company is currently relying on because somebody uploaded
 * an unread PDF would be exactly backwards: it would create a gap at the moment the
 * carrier was trying to close one.
 */
export async function reviewSubcontractorDocument(formData: FormData) {
  const context = await requireSubcontractorManager();
  const subcontractorId = stringValue(formData, "subcontractorId");
  const documentId = stringValue(formData, "documentId");
  const decision = stringValue(formData, "decision");
  const rejectionReason = optionalString(formData, "rejectionReason");

  if (decision !== "approve" && decision !== "reject") {
    backToSubcontractor(subcontractorId, "Choose whether to accept or return this document.");
  }

  if (decision === "reject" && !rejectionReason) {
    backToSubcontractor(
      subcontractorId,
      "Say why you are returning it. Sending it back with no reason just means they send the same thing again.",
    );
  }

  const supabase = await createSupabaseServerClient();
  const { data: document } = await supabase
    .from("subcontractor_document")
    .select("id, slot_key, fields, review_status")
    .eq("id", documentId)
    .eq("subcontractor_id", subcontractorId)
    .eq("tenant_id", context.appUser.tenant_id)
    .is("deleted_at", null)
    .maybeSingle();

  if (!document) {
    backToSubcontractor(subcontractorId, "Document not found.");
  }

  const { slots } = await loadResolvedSubcontractorSlots(supabase, context.appUser.tenant_id);
  const slot = slots.find((entry) => entry.key === document.slot_key) ?? null;
  const now = new Date().toISOString();

  if (decision === "reject") {
    const { data, error } = await supabase
      .from("subcontractor_document")
      .update({
        rejection_reason: rejectionReason,
        review_status: "rejected",
        reviewed_at: now,
        reviewed_by: context.appUser.id,
      })
      .eq("id", documentId)
      .eq("tenant_id", context.appUser.tenant_id)
      .select("id");

    if (error) {
      backToSubcontractor(subcontractorId, error.message);
    }

    if (!data || data.length === 0) {
      backToSubcontractor(subcontractorId, "Nothing was returned. You may not have permission to review documents.");
    }

    await audit(context, {
      action: "subcontractor.document.reject",
      entityId: documentId,
      entityTable: "subcontractor_document",
      metadata: { reason: rejectionReason, slot_key: document.slot_key, subcontractor_id: subcontractorId },
    });

    revalidatePath(LIST_PATH);
    backToSubcontractor(subcontractorId, "Returned to the carrier with your reason.", "notice");
  }

  // The reviewer reads the rating off the carrier profile at the moment they accept it.
  // That is the whole reason the document is collected, so it is captured here rather
  // than trusted from whatever the carrier typed.
  const reviewedFields: Record<string, string | null> = { ...((document.fields ?? {}) as Record<string, string | null>) };

  if (slot && slotCaptures(slot, "safety_rating")) {
    reviewedFields.safety_rating = optionalChoice(formData, "safetyRating", SUBCONTRACTOR_SAFETY_RATINGS);
    reviewedFields.monitoring_status = optionalChoice(formData, "monitoringStatus", SUBCONTRACTOR_MONITORING_STATUSES);
  }

  const { data, error } = await supabase
    .from("subcontractor_document")
    .update({
      fields: reviewedFields,
      rejection_reason: null,
      review_status: "approved",
      reviewed_at: now,
      reviewed_by: context.appUser.id,
    })
    .eq("id", documentId)
    .eq("tenant_id", context.appUser.tenant_id)
    .select("id");

  if (error) {
    backToSubcontractor(subcontractorId, error.message);
  }

  if (!data || data.length === 0) {
    backToSubcontractor(subcontractorId, "Nothing was accepted. You may not have permission to review documents.");
  }

  const { data: replaced } = await supabase
    .from("subcontractor_document")
    .update({ superseded_by_id: documentId })
    .eq("subcontractor_id", subcontractorId)
    .eq("tenant_id", context.appUser.tenant_id)
    .eq("slot_key", document.slot_key)
    .neq("id", documentId)
    .is("superseded_by_id", null)
    .is("deleted_at", null)
    .select("id");

  if (slot) {
    const parentPatch = parentPatchFromCaptures(slot, reviewedFields);

    if (Object.keys(parentPatch).length > 0) {
      await supabase
        .from("subcontractor")
        .update(parentPatch)
        .eq("id", subcontractorId)
        .eq("tenant_id", context.appUser.tenant_id);
    }
  }

  await audit(context, {
    action: "subcontractor.document.approve",
    entityId: documentId,
    entityTable: "subcontractor_document",
    metadata: {
      slot_key: document.slot_key,
      subcontractor_id: subcontractorId,
      superseded_count: replaced?.length ?? 0,
    },
  });

  revalidatePath(LIST_PATH);
  backToSubcontractor(subcontractorId, "Accepted.", "notice");
}

export async function removeSubcontractorDocument(formData: FormData) {
  const context = await requireSubcontractorManager();
  const subcontractorId = stringValue(formData, "subcontractorId");
  const documentId = stringValue(formData, "documentId");
  const supabase = await createSupabaseServerClient();

  const { data: document } = await supabase
    .from("subcontractor_document")
    .select("id, slot_key, storage_path")
    .eq("id", documentId)
    .eq("tenant_id", context.appUser.tenant_id)
    .is("deleted_at", null)
    .maybeSingle();

  if (!document) {
    backToSubcontractor(subcontractorId, "Document not found.");
  }

  const { data, error } = await supabase
    .from("subcontractor_document")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", documentId)
    .eq("tenant_id", context.appUser.tenant_id)
    .select("id");

  if (error) {
    backToSubcontractor(subcontractorId, error.message);
  }

  if (!data || data.length === 0) {
    backToSubcontractor(subcontractorId, "Nothing was removed. You may not have permission to change this record.");
  }

  // Only drop the stored file once nothing else points at it. A shared broker
  // certificate is referenced by several slots, and deleting one of them must not pull
  // the file out from under the others.
  if (document.storage_path) {
    const { data: stillReferenced } = await supabase
      .from("subcontractor_document")
      .select("id")
      .eq("tenant_id", context.appUser.tenant_id)
      .eq("storage_path", document.storage_path)
      .is("deleted_at", null)
      .limit(1);

    if (!stillReferenced || stillReferenced.length === 0) {
      await supabase.storage.from(BUCKET).remove([document.storage_path]);
    }
  }

  await audit(context, {
    action: "subcontractor.document.remove",
    entityId: documentId,
    entityTable: "subcontractor_document",
    metadata: { slot_key: document.slot_key, subcontractor_id: subcontractorId },
  });

  revalidatePath(LIST_PATH);
  backToSubcontractor(subcontractorId, "Document removed.", "notice");
}
