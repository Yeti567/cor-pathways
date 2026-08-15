"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { canAccessLocationByReach } from "@/lib/access-control";
import { requireAppUser } from "@/lib/current-user";
import { sanitizeStorageFilename } from "@/lib/document-control";
import { normalizeIdentifier } from "@/lib/duplicate-check";
import { createFollowUpReadyForSignOffNotification } from "@/lib/follow-ups";
import { locationIsActive } from "@/lib/locations";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { recordTenantAuditEvent } from "@/lib/tenant-audit";
import type { Database } from "@/types/database";

const workerTicketMimeTypes = new Set(["application/pdf", "image/heic", "image/heif", "image/png", "image/jpeg", "image/webp"]);
type FollowUpNotificationAuditRow = Pick<
  Database["public"]["Tables"]["notifications"]["Row"],
  "body" | "created_at" | "delivery_status" | "id" | "recipient_type" | "submission_id" | "title" | "user_id"
>;
type WorkerTimeCardAuditRow = Pick<
  Database["public"]["Tables"]["worker_time_cards"]["Row"],
  "clocked_in_at" | "id" | "location_id" | "note" | "worker_user_id"
>;
type WorkerTimeCardLocationRow = Pick<
  Database["public"]["Tables"]["locations"]["Row"],
  "code" | "id" | "name" | "visibility_rule"
>;
type WorkerTimeCardUserLocationRow = Pick<Database["public"]["Tables"]["user_locations"]["Row"], "location_id">;

function stringValue(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function dateOnlyValue(formData: FormData, key: string) {
  const value = stringValue(formData, key);
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function getUploadFile(formData: FormData, key: string) {
  const value = formData.get(key);
  return value instanceof File && value.size > 0 ? value : null;
}

async function getReachableWorkerTimeCardLocation(input: {
  locationId: string;
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  tenantId: string;
  userId: string;
  reachType: Database["public"]["Enums"]["reach_type"];
}) {
  const [{ data: location }, { data: assignedLocations }] = await Promise.all([
    input.supabase
      .from("locations")
      .select("id, name, code, visibility_rule")
      .eq("id", input.locationId)
      .eq("tenant_id", input.tenantId)
      .maybeSingle<WorkerTimeCardLocationRow>(),
    input.supabase
      .from("user_locations")
      .select("location_id")
      .eq("tenant_id", input.tenantId)
      .eq("user_id", input.userId)
      .returns<WorkerTimeCardUserLocationRow[]>(),
  ]);

  if (!location || !locationIsActive(location.visibility_rule)) {
    return null;
  }

  const assignedLocationIds = new Set((assignedLocations ?? []).map((assignment) => assignment.location_id));
  return canAccessLocationByReach({
    assignedLocationIds,
    includeAllWorkersLocations: true,
    locationId: location.id,
    reachType: input.reachType,
    visibilityRule: location.visibility_rule,
  })
    ? location
    : null;
}

export async function signOut() {
  let supabase;

  try {
    supabase = await createSupabaseServerClient();
  } catch {
    redirect("/auth/error?message=Supabase%20environment%20variables%20are%20not%20configured.");
  }

  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/login");
}

export async function markNotificationRead(formData: FormData) {
  const context = await requireAppUser();
  const notificationId = String(formData.get("notificationId") ?? "").trim();

  if (!notificationId) {
    redirect("/web");
  }

  const supabase = await createSupabaseServerClient();
  await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", notificationId)
    .eq("tenant_id", context.appUser.tenant_id)
    .eq("user_id", context.appUser.id);

  revalidatePath("/web");
  redirect("/web");
}

const SELF_DUTY_STATUSES = new Set(["off_duty", "sleeper_berth", "driving", "on_duty"]);

// A driver logging their own Hours of Service duty status from the worker app.
// Only a worker whose account is linked to a transport_driver may log, and only
// for their own driver record.
export async function logMyDutyStatus(formData: FormData) {
  const context = await requireAppUser();
  const supabase = await createSupabaseServerClient();
  const statusRaw = stringValue(formData, "status");

  if (!SELF_DUTY_STATUSES.has(statusRaw)) {
    redirect("/web?error=Choose%20a%20duty%20status.#my-hours");
  }

  const { data: driver } = await supabase
    .from("transport_driver")
    .select("id")
    .eq("tenant_id", context.appUser.tenant_id)
    .eq("user_id", context.appUser.id)
    .is("deleted_at", null)
    .maybeSingle<{ id: string }>();

  if (!driver) {
    redirect("/web?error=No%20driver%20file%20is%20linked%20to%20your%20account.#my-hours");
  }

  const status = statusRaw as Database["public"]["Tables"]["transport_duty_status_event"]["Row"]["status"];
  const { error } = await supabase.from("transport_duty_status_event").insert({
    tenant_id: context.appUser.tenant_id,
    driver_id: driver.id,
    status,
    started_at: new Date().toISOString(),
    source: "manual",
    created_by: context.appUser.id,
  });

  if (error) {
    redirect(`/web?error=${encodeURIComponent(error.message)}#my-hours`);
  }

  revalidatePath("/web");
  redirect("/web?notice=Duty%20status%20updated.#my-hours");
}

export async function clockInWorkerTimeCard(formData: FormData) {
  const context = await requireAppUser();
  const supabase = await createSupabaseServerClient();
  const locationId = stringValue(formData, "locationId");
  const note = stringValue(formData, "note") || null;

  if (!locationId) {
    redirect("/web?error=Choose%20a%20location%20before%20clocking%20in.");
  }

  const location = await getReachableWorkerTimeCardLocation({
    locationId,
    reachType: context.appUser.reach_type,
    supabase,
    tenantId: context.appUser.tenant_id,
    userId: context.appUser.id,
  });

  if (!location) {
    redirect("/web?error=Choose%20an%20active%20location%20you%20can%20access.");
  }

  const { data: openTimeCard } = await supabase
    .from("worker_time_cards")
    .select("id")
    .eq("tenant_id", context.appUser.tenant_id)
    .eq("worker_user_id", context.appUser.id)
    .is("clocked_out_at", null)
    .maybeSingle<{ id: string }>();

  if (openTimeCard) {
    redirect("/web?error=You%20are%20already%20clocked%20in.%20Clock%20out%20before%20starting%20another%20time%20card.");
  }

  const { data: timeCard, error } = await supabase
    .from("worker_time_cards")
    .insert({
      location_id: location.id,
      note,
      tenant_id: context.appUser.tenant_id,
      worker_user_id: context.appUser.id,
    })
    .select("clocked_in_at, id, location_id, note, worker_user_id")
    .single<WorkerTimeCardAuditRow>();

  if (error || !timeCard) {
    redirect(`/web?error=${encodeURIComponent(error?.message ?? "Time card was not started.")}`);
  }

  await recordTenantAuditEvent({
    action: "worker_time_card.clock_in",
    actorRole: context.appUser.power_level,
    actorUserId: context.appUser.id,
    entityId: timeCard.id,
    entityTable: "worker_time_cards",
    metadata: {
      clocked_in_at: timeCard.clocked_in_at,
      location_code: location.code,
      location_id: timeCard.location_id,
      location_name: location.name,
      note: timeCard.note,
      source: "worker_app",
      worker_user_id: timeCard.worker_user_id,
    },
    tenantId: context.appUser.tenant_id,
  });

  revalidatePath("/web");
  revalidatePath("/admin/visitors/roster");
  redirect("/web?notice=Time%20card%20started.%20You%20are%20on%20the%20emergency%20roster.");
}

export async function clockOutWorkerTimeCard() {
  const context = await requireAppUser();
  const supabase = await createSupabaseServerClient();
  const clockedOutAt = new Date().toISOString();
  const { data: timeCard, error } = await supabase
    .from("worker_time_cards")
    .update({ clocked_out_at: clockedOutAt })
    .eq("tenant_id", context.appUser.tenant_id)
    .eq("worker_user_id", context.appUser.id)
    .is("clocked_out_at", null)
    .select("clocked_in_at, id, location_id, note, worker_user_id")
    .maybeSingle<WorkerTimeCardAuditRow>();

  if (error || !timeCard) {
    redirect(`/web?error=${encodeURIComponent(error?.message ?? "No active time card was found.")}`);
  }

  await recordTenantAuditEvent({
    action: "worker_time_card.clock_out",
    actorRole: context.appUser.power_level,
    actorUserId: context.appUser.id,
    entityId: timeCard.id,
    entityTable: "worker_time_cards",
    metadata: {
      clocked_in_at: timeCard.clocked_in_at,
      clocked_out_at: clockedOutAt,
      location_id: timeCard.location_id,
      note: timeCard.note,
      source: "worker_app",
      worker_user_id: timeCard.worker_user_id,
    },
    tenantId: context.appUser.tenant_id,
  });

  revalidatePath("/web");
  revalidatePath("/admin/visitors/roster");
  redirect("/web?notice=Time%20card%20ended.%20You%20are%20off%20the%20emergency%20roster.");
}

export async function updateAssignedFollowUpStatus(formData: FormData) {
  const context = await requireAppUser();
  const followUpId = String(formData.get("followUpId") ?? "").trim();
  const status = String(formData.get("status") ?? "").trim();

  if (!followUpId) {
    redirect("/web?error=Choose%20a%20corrective%20action.");
  }

  if (status !== "in_progress" && status !== "completed") {
    redirect("/web?error=Workers%20can%20only%20start%20or%20complete%20assigned%20corrective%20actions.");
  }

  const now = new Date().toISOString();
  const supabase = await createSupabaseServerClient();
  const { data: updatedFollowUp, error } = await supabase
    .from("follow_ups")
    .update({
      completed_at: status === "completed" ? now : null,
      status,
      updated_at: now,
    })
    .eq("id", followUpId)
    .eq("tenant_id", context.appUser.tenant_id)
    .eq("assigned_to", context.appUser.id)
    .select("id, title, parent_submission_id")
    .maybeSingle<{ id: string; parent_submission_id: string | null; title: string }>();

  if (error) {
    redirect(`/web?error=${encodeURIComponent(error.message)}`);
  }

  if (!updatedFollowUp) {
    redirect("/web?error=Only%20the%20assigned%20worker%20can%20update%20that%20corrective%20action.");
  }

  if (status === "completed" && updatedFollowUp.parent_submission_id) {
    const { data: sourceSubmission, error: sourceError } = await supabase
      .from("submissions")
      .select("submitted_by")
      .eq("id", updatedFollowUp.parent_submission_id)
      .eq("tenant_id", context.appUser.tenant_id)
      .maybeSingle<{ submitted_by: string | null }>();

    if (sourceError) {
      redirect(`/web?error=${encodeURIComponent(sourceError.message)}`);
    }

    if (sourceSubmission?.submitted_by && sourceSubmission.submitted_by !== context.appUser.id) {
      const { data: notification } = await supabase
        .from("notifications")
        .insert(
          createFollowUpReadyForSignOffNotification({
            createdAt: now,
            followUpTitle: updatedFollowUp.title,
            parentSubmissionId: updatedFollowUp.parent_submission_id,
            tenantId: context.appUser.tenant_id,
            userId: sourceSubmission.submitted_by,
          }),
        )
        .select("body, created_at, delivery_status, id, recipient_type, submission_id, title, user_id")
        .single<FollowUpNotificationAuditRow>();

      if (notification) {
        await recordTenantAuditEvent({
          action: "follow_up.notification.ready_for_signoff.sent",
          actorRole: context.appUser.power_level,
          actorUserId: context.appUser.id,
          entityId: notification.id,
          entityTable: "notifications",
          metadata: {
            body: notification.body,
            created_at: notification.created_at,
            delivery_status: notification.delivery_status,
            follow_up_id: updatedFollowUp.id,
            follow_up_title: updatedFollowUp.title,
            recipient_type: notification.recipient_type,
            source: "worker_app",
            submission_id: notification.submission_id,
            title: notification.title,
            user_id: notification.user_id,
          },
          tenantId: context.appUser.tenant_id,
        });
      }
    }
  }

  await recordTenantAuditEvent({
    action: "follow_up.worker_status_update",
    actorRole: context.appUser.power_level,
    actorUserId: context.appUser.id,
    entityId: updatedFollowUp.id,
    entityTable: "follow_ups",
    metadata: {
      completed_at: status === "completed" ? now : null,
      parent_submission_id: updatedFollowUp.parent_submission_id,
      status,
      title: updatedFollowUp.title,
    },
    tenantId: context.appUser.tenant_id,
  });

  revalidatePath("/web");
  revalidatePath("/admin/follow-ups");
  redirect(`/web?notice=${encodeURIComponent(status === "completed" ? "Corrective action marked complete." : "Corrective action started.")}`);
}

// Field worker updating one of their own assigned trade work orders. Workers can
// only start or complete; the assigned_user_id match is the ownership guard.
export async function updateAssignedWorkOrder(formData: FormData) {
  const context = await requireAppUser();
  const workOrderId = String(formData.get("workOrderId") ?? "").trim();
  const status = String(formData.get("status") ?? "").trim();

  if (!workOrderId) {
    redirect("/web?error=Choose%20a%20work%20order.");
  }

  if (status !== "in_progress" && status !== "completed") {
    redirect("/web?error=Workers%20can%20only%20start%20or%20complete%20assigned%20work%20orders.");
  }

  const supabase = await createSupabaseServerClient();
  const { data: updated, error } = await supabase
    .from("trade_work_order")
    .update({ status })
    .eq("id", workOrderId)
    .eq("tenant_id", context.appUser.tenant_id)
    .eq("assigned_user_id", context.appUser.id)
    .select("id, title")
    .maybeSingle<{ id: string; title: string }>();

  if (error) {
    redirect(`/web?error=${encodeURIComponent(error.message)}`);
  }

  if (!updated) {
    redirect("/web?error=Only%20the%20assigned%20worker%20can%20update%20that%20work%20order.");
  }

  await recordTenantAuditEvent({
    action: "trade_work_order.worker_status_update",
    actorRole: context.appUser.power_level,
    actorUserId: context.appUser.id,
    entityId: updated.id,
    entityTable: "trade_work_order",
    metadata: { status, title: updated.title },
    tenantId: context.appUser.tenant_id,
  });

  revalidatePath("/web");
  revalidatePath(`/admin/trades/work-orders/${updated.id}`);
  redirect(`/web?notice=${encodeURIComponent(status === "completed" ? "Work order completed." : "Work order started.")}`);
}

// Field worker logging a note and/or photo against one of their assigned jobs.
// The assigned_user_id match is the ownership guard; the office sees the timeline
// on the admin work-order page.
export async function addWorkOrderNote(formData: FormData) {
  const context = await requireAppUser();
  const workOrderId = String(formData.get("workOrderId") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim();
  const photo = formData.get("photo");
  const hasPhoto = photo instanceof File && photo.size > 0;

  if (!workOrderId) {
    redirect("/web?error=Choose%20a%20work%20order.#my-work");
  }

  if (!note && !hasPhoto) {
    redirect("/web?error=Add%20a%20note%20or%20a%20photo.#my-work");
  }

  const supabase = await createSupabaseServerClient();
  const { data: workOrder } = await supabase
    .from("trade_work_order")
    .select("id")
    .eq("id", workOrderId)
    .eq("tenant_id", context.appUser.tenant_id)
    .eq("assigned_user_id", context.appUser.id)
    .maybeSingle<{ id: string }>();

  if (!workOrder) {
    redirect("/web?error=Only%20the%20assigned%20worker%20can%20add%20notes%20to%20that%20work%20order.#my-work");
  }

  const storageSupabase = createSupabaseAdminClient() ?? supabase;
  let photoPath: string | null = null;
  if (hasPhoto) {
    const file = photo as File;
    photoPath = [
      context.appUser.tenant_id,
      "work-orders",
      workOrderId,
      `${Date.now()}-${sanitizeStorageFilename(file.name)}`,
    ].join("/");

    const { error: uploadError } = await storageSupabase.storage
      .from("tenant-documents")
      .upload(photoPath, file, { contentType: file.type || "application/octet-stream", upsert: false });

    if (uploadError) {
      redirect(`/web?error=${encodeURIComponent(uploadError.message)}#my-work`);
    }
  }

  const { error } = await supabase.from("trade_work_order_note").insert({
    tenant_id: context.appUser.tenant_id,
    work_order_id: workOrderId,
    author_user_id: context.appUser.id,
    note: note || null,
    photo_path: photoPath,
  });

  if (error) {
    if (photoPath) {
      await storageSupabase.storage.from("tenant-documents").remove([photoPath]);
    }
    redirect(`/web?error=${encodeURIComponent(error.message)}#my-work`);
  }

  await recordTenantAuditEvent({
    action: "trade_work_order_note.add",
    actorRole: context.appUser.power_level,
    actorUserId: context.appUser.id,
    entityId: workOrderId,
    entityTable: "trade_work_order_note",
    metadata: { has_photo: Boolean(photoPath) },
    tenantId: context.appUser.tenant_id,
  });

  revalidatePath("/web");
  revalidatePath(`/admin/trades/work-orders/${workOrderId}`);
  redirect("/web?notice=Note%20added.#my-work");
}

// Field worker completing one of their assigned jobs, optionally capturing the
// customer's printed name and drawn signature (a PNG data URL from the canvas,
// stored in the tenant-documents bucket).
export async function completeAssignedWorkOrder(formData: FormData) {
  const context = await requireAppUser();
  const workOrderId = String(formData.get("workOrderId") ?? "").trim();
  const signerName = String(formData.get("signerName") ?? "").trim();
  const signatureData = String(formData.get("signatureData") ?? "").trim();

  if (!workOrderId) {
    redirect("/web?error=Choose%20a%20work%20order.#my-work");
  }

  const supabase = await createSupabaseServerClient();
  const { data: workOrder } = await supabase
    .from("trade_work_order")
    .select("id")
    .eq("id", workOrderId)
    .eq("tenant_id", context.appUser.tenant_id)
    .eq("assigned_user_id", context.appUser.id)
    .maybeSingle<{ id: string }>();

  if (!workOrder) {
    redirect("/web?error=Only%20the%20assigned%20worker%20can%20complete%20that%20work%20order.#my-work");
  }

  const storageSupabase = createSupabaseAdminClient() ?? supabase;
  let signaturePath: string | null = null;
  const match = signatureData.match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/);
  if (match) {
    const buffer = Buffer.from(match[1], "base64");
    if (buffer.length > 0 && buffer.length < 2_000_000) {
      signaturePath = [context.appUser.tenant_id, "work-orders", workOrderId, `signoff-${Date.now()}.png`].join("/");
      const { error: uploadError } = await storageSupabase.storage
        .from("tenant-documents")
        .upload(signaturePath, buffer, { contentType: "image/png", upsert: false });
      if (uploadError) {
        redirect(`/web?error=${encodeURIComponent(uploadError.message)}#my-work`);
      }
    }
  }

  const now = new Date().toISOString();
  const signed = Boolean(signaturePath || signerName);
  const { error } = await supabase
    .from("trade_work_order")
    .update({
      status: "completed",
      signed_off_name: signerName || null,
      signed_off_signature_path: signaturePath,
      signed_off_at: signed ? now : null,
    })
    .eq("id", workOrderId)
    .eq("tenant_id", context.appUser.tenant_id)
    .eq("assigned_user_id", context.appUser.id);

  if (error) {
    if (signaturePath) {
      await storageSupabase.storage.from("tenant-documents").remove([signaturePath]);
    }
    redirect(`/web?error=${encodeURIComponent(error.message)}#my-work`);
  }

  await recordTenantAuditEvent({
    action: "trade_work_order.worker_complete_signoff",
    actorRole: context.appUser.power_level,
    actorUserId: context.appUser.id,
    entityId: workOrderId,
    entityTable: "trade_work_order",
    metadata: { signed: Boolean(signaturePath), signer_name: signerName || null },
    tenantId: context.appUser.tenant_id,
  });

  revalidatePath("/web");
  revalidatePath(`/admin/trades/work-orders/${workOrderId}`);
  redirect("/web?notice=Work%20order%20completed.#my-work");
}

// Field worker clocking on to one of their assigned jobs. Only one open entry per
// worker at a time (you cannot be on two jobs at once).
export async function clockOnWorkOrder(formData: FormData) {
  const context = await requireAppUser();
  const workOrderId = String(formData.get("workOrderId") ?? "").trim();

  if (!workOrderId) {
    redirect("/web?error=Choose%20a%20work%20order.#my-work");
  }

  const supabase = await createSupabaseServerClient();
  const { data: workOrder } = await supabase
    .from("trade_work_order")
    .select("id")
    .eq("id", workOrderId)
    .eq("tenant_id", context.appUser.tenant_id)
    .eq("assigned_user_id", context.appUser.id)
    .maybeSingle<{ id: string }>();

  if (!workOrder) {
    redirect("/web?error=Only%20the%20assigned%20worker%20can%20clock%20on%20to%20that%20job.#my-work");
  }

  const { data: openEntry } = await supabase
    .from("trade_work_order_time")
    .select("id")
    .eq("tenant_id", context.appUser.tenant_id)
    .eq("user_id", context.appUser.id)
    .is("ended_at", null)
    .maybeSingle<{ id: string }>();

  if (openEntry) {
    redirect("/web?error=You%20are%20still%20clocked%20on%20to%20another%20job.%20Clock%20off%20first.#my-work");
  }

  const { data: entry, error } = await supabase
    .from("trade_work_order_time")
    .insert({
      tenant_id: context.appUser.tenant_id,
      work_order_id: workOrderId,
      user_id: context.appUser.id,
    })
    .select("id")
    .single<{ id: string }>();

  if (error || !entry) {
    redirect(`/web?error=${encodeURIComponent(error?.message ?? "Could not clock on.")}#my-work`);
  }

  await recordTenantAuditEvent({
    action: "trade_work_order_time.clock_on",
    actorRole: context.appUser.power_level,
    actorUserId: context.appUser.id,
    entityId: workOrderId,
    entityTable: "trade_work_order_time",
    metadata: { entry_id: entry.id },
    tenantId: context.appUser.tenant_id,
  });

  revalidatePath("/web");
  revalidatePath(`/admin/trades/work-orders/${workOrderId}`);
  redirect("/web?notice=Clocked%20on.#my-work");
}

export async function clockOffWorkOrder(formData: FormData) {
  const context = await requireAppUser();
  const workOrderId = String(formData.get("workOrderId") ?? "").trim();

  if (!workOrderId) {
    redirect("/web?error=Choose%20a%20work%20order.#my-work");
  }

  const now = new Date().toISOString();
  const supabase = await createSupabaseServerClient();
  const { data: updated, error } = await supabase
    .from("trade_work_order_time")
    .update({ ended_at: now })
    .eq("tenant_id", context.appUser.tenant_id)
    .eq("work_order_id", workOrderId)
    .eq("user_id", context.appUser.id)
    .is("ended_at", null)
    .select("id")
    .maybeSingle<{ id: string }>();

  if (error) {
    redirect(`/web?error=${encodeURIComponent(error.message)}#my-work`);
  }

  if (!updated) {
    redirect("/web?error=You%20are%20not%20clocked%20on%20to%20that%20job.#my-work");
  }

  await recordTenantAuditEvent({
    action: "trade_work_order_time.clock_off",
    actorRole: context.appUser.power_level,
    actorUserId: context.appUser.id,
    entityId: workOrderId,
    entityTable: "trade_work_order_time",
    metadata: { entry_id: updated.id },
    tenantId: context.appUser.tenant_id,
  });

  revalidatePath("/web");
  revalidatePath(`/admin/trades/work-orders/${workOrderId}`);
  redirect("/web?notice=Clocked%20off.#my-work");
}

// Field worker logging operational facts on an assigned job: hours worked, travel
// distance/time, and a note. No money on the worker side; the office uses these
// for costing/reimbursement separately.
export async function addWorkOrderFieldLog(formData: FormData) {
  const context = await requireAppUser();
  const workOrderId = String(formData.get("workOrderId") ?? "").trim();

  if (!workOrderId) {
    redirect("/web?error=Choose%20a%20work%20order.#my-work");
  }

  const positiveNumber = (key: string) => {
    const value = Number.parseFloat(String(formData.get(key) ?? "").trim());
    return Number.isFinite(value) && value >= 0 ? value : null;
  };
  const positiveInteger = (key: string) => {
    const value = Number.parseInt(String(formData.get(key) ?? "").trim(), 10);
    return Number.isFinite(value) && value >= 0 ? value : null;
  };

  const hours = positiveNumber("hours");
  const travelKm = positiveNumber("travelKm");
  const travelMinutes = positiveInteger("travelMinutes");
  const note = String(formData.get("note") ?? "").trim() || null;
  const entryDateRaw = String(formData.get("entryDate") ?? "").trim();
  const entryDate = /^\d{4}-\d{2}-\d{2}$/.test(entryDateRaw) ? entryDateRaw : null;

  if (hours === null && travelKm === null && travelMinutes === null && !note) {
    redirect("/web?error=Enter%20hours,%20travel,%20or%20a%20note.#my-work");
  }

  const supabase = await createSupabaseServerClient();
  const { data: workOrder } = await supabase
    .from("trade_work_order")
    .select("id")
    .eq("id", workOrderId)
    .eq("tenant_id", context.appUser.tenant_id)
    .eq("assigned_user_id", context.appUser.id)
    .maybeSingle<{ id: string }>();

  if (!workOrder) {
    redirect("/web?error=Only%20the%20assigned%20worker%20can%20log%20against%20that%20job.#my-work");
  }

  const { error } = await supabase.from("trade_work_order_field_log").insert({
    tenant_id: context.appUser.tenant_id,
    work_order_id: workOrderId,
    user_id: context.appUser.id,
    hours,
    travel_km: travelKm,
    travel_minutes: travelMinutes,
    note,
    ...(entryDate ? { entry_date: entryDate } : {}),
  });

  if (error) {
    redirect(`/web?error=${encodeURIComponent(error.message)}#my-work`);
  }

  await recordTenantAuditEvent({
    action: "trade_work_order_field_log.add",
    actorRole: context.appUser.power_level,
    actorUserId: context.appUser.id,
    entityId: workOrderId,
    entityTable: "trade_work_order_field_log",
    metadata: { hours, travel_km: travelKm, travel_minutes: travelMinutes },
    tenantId: context.appUser.tenant_id,
  });

  revalidatePath("/web");
  revalidatePath(`/admin/trades/work-orders/${workOrderId}`);
  redirect("/web?notice=Field%20log%20saved.#my-work");
}

// Field worker logging a part/material they used on an assigned job: name,
// quantity, optional unit, and a note. No money on the worker side; the office
// prices these into billable lines separately. The assigned_user_id match is the
// ownership guard.
export async function addWorkOrderMaterial(formData: FormData) {
  const context = await requireAppUser();
  const workOrderId = String(formData.get("workOrderId") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();

  if (!workOrderId) {
    redirect("/web?error=Choose%20a%20work%20order.#my-work");
  }

  if (!name) {
    redirect("/web?error=Enter%20the%20part%20or%20material%20used.#my-work");
  }

  const quantityRaw = Number.parseFloat(String(formData.get("quantity") ?? "").trim());
  const quantity = Number.isFinite(quantityRaw) && quantityRaw > 0 ? quantityRaw : 1;
  const unit = String(formData.get("unit") ?? "").trim() || null;
  const note = String(formData.get("note") ?? "").trim() || null;
  const entryDateRaw = String(formData.get("entryDate") ?? "").trim();
  const entryDate = /^\d{4}-\d{2}-\d{2}$/.test(entryDateRaw) ? entryDateRaw : null;

  const supabase = await createSupabaseServerClient();
  const { data: workOrder } = await supabase
    .from("trade_work_order")
    .select("id")
    .eq("id", workOrderId)
    .eq("tenant_id", context.appUser.tenant_id)
    .eq("assigned_user_id", context.appUser.id)
    .maybeSingle<{ id: string }>();

  if (!workOrder) {
    redirect("/web?error=Only%20the%20assigned%20worker%20can%20log%20materials%20on%20that%20job.#my-work");
  }

  const { error } = await supabase.from("trade_work_order_material").insert({
    tenant_id: context.appUser.tenant_id,
    work_order_id: workOrderId,
    user_id: context.appUser.id,
    name,
    quantity,
    unit,
    note,
    ...(entryDate ? { entry_date: entryDate } : {}),
  });

  if (error) {
    redirect(`/web?error=${encodeURIComponent(error.message)}#my-work`);
  }

  await recordTenantAuditEvent({
    action: "trade_work_order_material.add",
    actorRole: context.appUser.power_level,
    actorUserId: context.appUser.id,
    entityId: workOrderId,
    entityTable: "trade_work_order_material",
    metadata: { name, quantity, unit },
    tenantId: context.appUser.tenant_id,
  });

  revalidatePath("/web");
  revalidatePath(`/admin/trades/work-orders/${workOrderId}`);
  redirect("/web?notice=Material%20logged.#my-work");
}

// Field worker capturing the equipment they serviced on an assigned job: type,
// make, model, serial, where it is on site, install date, a note, and an optional
// nameplate photo. Operational only, no money. The unit is filed against the job's
// customer (and service address) so the office sees it on the customer record. The
// assigned_user_id match is the ownership guard.
export async function addWorkOrderEquipment(formData: FormData) {
  const context = await requireAppUser();
  const workOrderId = String(formData.get("workOrderId") ?? "").trim();

  if (!workOrderId) {
    redirect("/web?error=Choose%20a%20work%20order.#my-work");
  }

  const equipmentType = String(formData.get("equipmentType") ?? "").trim() || null;
  const make = String(formData.get("make") ?? "").trim() || null;
  const model = String(formData.get("model") ?? "").trim() || null;
  const serial = String(formData.get("serial") ?? "").trim() || null;
  const locationNote = String(formData.get("locationNote") ?? "").trim() || null;
  const notes = String(formData.get("notes") ?? "").trim() || null;
  const installedOnRaw = String(formData.get("installedOn") ?? "").trim();
  const installedOn = /^\d{4}-\d{2}-\d{2}$/.test(installedOnRaw) ? installedOnRaw : null;
  const conditionRaw = String(formData.get("condition") ?? "").trim();
  const condition =
    conditionRaw === "good" || conditionRaw === "monitor" || conditionRaw === "needs_replacement" ? conditionRaw : null;
  const needsFollowUp = String(formData.get("needsFollowUp") ?? "").trim() === "true";
  const followUpNote = String(formData.get("followUpNote") ?? "").trim() || null;
  const photo = formData.get("photo");
  const hasPhoto = photo instanceof File && photo.size > 0;

  if (!equipmentType && !make && !model && !serial && !hasPhoto) {
    redirect("/web?error=Add%20equipment%20details%20or%20a%20photo.#my-work");
  }

  const supabase = await createSupabaseServerClient();
  const { data: workOrder } = await supabase
    .from("trade_work_order")
    .select("id, customer_id, service_address_id")
    .eq("id", workOrderId)
    .eq("tenant_id", context.appUser.tenant_id)
    .eq("assigned_user_id", context.appUser.id)
    .maybeSingle<{ id: string; customer_id: string; service_address_id: string | null }>();

  if (!workOrder) {
    redirect("/web?error=Only%20the%20assigned%20worker%20can%20log%20equipment%20on%20that%20job.#my-work");
  }

  const storageSupabase = createSupabaseAdminClient() ?? supabase;
  let photoPath: string | null = null;
  if (hasPhoto) {
    const file = photo as File;
    photoPath = [
      context.appUser.tenant_id,
      "equipment",
      workOrderId,
      `${Date.now()}-${sanitizeStorageFilename(file.name)}`,
    ].join("/");

    const { error: uploadError } = await storageSupabase.storage
      .from("tenant-documents")
      .upload(photoPath, file, { contentType: file.type || "application/octet-stream", upsert: false });

    if (uploadError) {
      redirect(`/web?error=${encodeURIComponent(uploadError.message)}#my-work`);
    }
  }

  const { error } = await supabase.from("trade_customer_equipment").insert({
    tenant_id: context.appUser.tenant_id,
    customer_id: workOrder.customer_id,
    service_address_id: workOrder.service_address_id,
    work_order_id: workOrderId,
    equipment_type: equipmentType,
    make,
    model,
    serial,
    location_note: locationNote,
    installed_on: installedOn,
    notes,
    photo_path: photoPath,
    condition,
    needs_follow_up: needsFollowUp,
    follow_up_note: followUpNote,
    created_by: context.appUser.id,
  });

  if (error) {
    if (photoPath) {
      await storageSupabase.storage.from("tenant-documents").remove([photoPath]);
    }
    redirect(`/web?error=${encodeURIComponent(error.message)}#my-work`);
  }

  await recordTenantAuditEvent({
    action: "trade_customer_equipment.add",
    actorRole: context.appUser.power_level,
    actorUserId: context.appUser.id,
    entityId: workOrderId,
    entityTable: "trade_customer_equipment",
    metadata: { equipment_type: equipmentType, make, model, serial, has_photo: Boolean(photoPath) },
    tenantId: context.appUser.tenant_id,
  });

  revalidatePath("/web");
  revalidatePath(`/admin/trades/work-orders/${workOrderId}`);
  revalidatePath(`/admin/trades/customers/${workOrder.customer_id}`);
  redirect("/web?notice=Equipment%20logged.#my-work");
}

// Field worker setting a condition and/or flagging an existing unit for office
// follow-up from an assigned job. Ownership chain: the work order is assigned to
// the worker, and the equipment belongs to that work order's customer.
export async function updateWorkOrderEquipmentFlag(formData: FormData) {
  const context = await requireAppUser();
  const workOrderId = String(formData.get("workOrderId") ?? "").trim();
  const equipmentId = String(formData.get("equipmentId") ?? "").trim();

  if (!workOrderId || !equipmentId) {
    redirect("/web?error=Choose%20a%20unit.#my-work");
  }

  const conditionRaw = String(formData.get("condition") ?? "").trim();
  const condition =
    conditionRaw === "good" || conditionRaw === "monitor" || conditionRaw === "needs_replacement" ? conditionRaw : null;
  const needsFollowUp = String(formData.get("needsFollowUp") ?? "").trim() === "true";
  const followUpNote = String(formData.get("followUpNote") ?? "").trim() || null;

  const supabase = await createSupabaseServerClient();
  const { data: workOrder } = await supabase
    .from("trade_work_order")
    .select("id, customer_id")
    .eq("id", workOrderId)
    .eq("tenant_id", context.appUser.tenant_id)
    .eq("assigned_user_id", context.appUser.id)
    .maybeSingle<{ id: string; customer_id: string }>();

  if (!workOrder) {
    redirect("/web?error=Only%20the%20assigned%20worker%20can%20flag%20equipment%20on%20that%20job.#my-work");
  }

  const { data: updated, error } = await supabase
    .from("trade_customer_equipment")
    .update({
      condition,
      needs_follow_up: needsFollowUp,
      follow_up_note: followUpNote,
    })
    .eq("id", equipmentId)
    .eq("tenant_id", context.appUser.tenant_id)
    .eq("customer_id", workOrder.customer_id)
    .select("id")
    .maybeSingle<{ id: string }>();

  if (error) {
    redirect(`/web?error=${encodeURIComponent(error.message)}#my-work`);
  }

  if (!updated) {
    redirect("/web?error=That%20unit%20is%20not%20on%20this%20customer.#my-work");
  }

  await recordTenantAuditEvent({
    action: "trade_customer_equipment.worker_flag",
    actorRole: context.appUser.power_level,
    actorUserId: context.appUser.id,
    entityId: equipmentId,
    entityTable: "trade_customer_equipment",
    metadata: { condition, needs_follow_up: needsFollowUp },
    tenantId: context.appUser.tenant_id,
  });

  revalidatePath("/web");
  revalidatePath(`/admin/trades/work-orders/${workOrderId}`);
  revalidatePath(`/admin/trades/customers/${workOrder.customer_id}`);
  revalidatePath("/admin/trades/follow-ups");
  redirect("/web?notice=Equipment%20updated.#my-work");
}

// Field worker ticking a checklist task on an assigned job done or not-done. The
// office applies a checklist to the work order; the worker checks items off on
// site. The assigned_user_id match is the ownership guard.
export async function toggleWorkOrderTask(formData: FormData) {
  const context = await requireAppUser();
  const workOrderId = String(formData.get("workOrderId") ?? "").trim();
  const taskId = String(formData.get("taskId") ?? "").trim();
  const done = String(formData.get("done") ?? "").trim() === "true";

  if (!workOrderId || !taskId) {
    redirect("/web?error=Choose%20a%20task.#my-work");
  }

  const supabase = await createSupabaseServerClient();
  const { data: workOrder } = await supabase
    .from("trade_work_order")
    .select("id")
    .eq("id", workOrderId)
    .eq("tenant_id", context.appUser.tenant_id)
    .eq("assigned_user_id", context.appUser.id)
    .maybeSingle<{ id: string }>();

  if (!workOrder) {
    redirect("/web?error=Only%20the%20assigned%20worker%20can%20update%20that%20checklist.#my-work");
  }

  const { data: updated, error } = await supabase
    .from("trade_work_order_task")
    .update({
      done,
      done_by: done ? context.appUser.id : null,
      done_at: done ? new Date().toISOString() : null,
    })
    .eq("id", taskId)
    .eq("tenant_id", context.appUser.tenant_id)
    .eq("work_order_id", workOrderId)
    .select("id")
    .maybeSingle<{ id: string }>();

  if (error) {
    redirect(`/web?error=${encodeURIComponent(error.message)}#my-work`);
  }

  if (!updated) {
    redirect("/web?error=That%20task%20is%20no%20longer%20on%20the%20job.#my-work");
  }

  await recordTenantAuditEvent({
    action: "trade_work_order_task.worker_toggle",
    actorRole: context.appUser.power_level,
    actorUserId: context.appUser.id,
    entityId: workOrderId,
    entityTable: "trade_work_order_task",
    metadata: { task_id: taskId, done },
    tenantId: context.appUser.tenant_id,
  });

  revalidatePath("/web");
  revalidatePath(`/admin/trades/work-orders/${workOrderId}`);
  redirect("/web?notice=Checklist%20updated.#my-work");
}

export async function signOffFlaggedFollowUp(formData: FormData) {
  const context = await requireAppUser();
  const followUpId = String(formData.get("followUpId") ?? "").trim();

  if (!followUpId) {
    redirect("/web?error=Choose%20a%20corrective%20action.");
  }

  const supabase = await createSupabaseServerClient();
  const { data: followUp, error: followUpError } = await supabase
    .from("follow_ups")
    .select("id, title, status, assigned_to, parent_submission_id")
    .eq("id", followUpId)
    .eq("tenant_id", context.appUser.tenant_id)
    .maybeSingle<{
      assigned_to: string | null;
      id: string;
      parent_submission_id: string | null;
      status: string;
      title: string;
    }>();

  if (followUpError) {
    redirect(`/web?error=${encodeURIComponent(followUpError.message)}`);
  }

  if (!followUp?.parent_submission_id) {
    redirect("/web?error=Corrective%20action%20source%20submission%20was%20not%20found.");
  }

  if (followUp.status !== "completed") {
    redirect("/web?error=Only%20completed%20corrective%20actions%20can%20be%20signed%20off.");
  }

  const { data: sourceSubmission, error: sourceError } = await supabase
    .from("submissions")
    .select("id")
    .eq("id", followUp.parent_submission_id)
    .eq("tenant_id", context.appUser.tenant_id)
    .eq("submitted_by", context.appUser.id)
    .maybeSingle<{ id: string }>();

  if (sourceError) {
    redirect(`/web?error=${encodeURIComponent(sourceError.message)}`);
  }

  if (!sourceSubmission) {
    redirect("/web?error=Only%20the%20worker%20who%20flagged%20this%20action%20can%20sign%20it%20off.");
  }

  const now = new Date().toISOString();
  const { data: signedOffFollowUp, error: updateError } = await supabase
    .from("follow_ups")
    .update({
      signoff_at: now,
      signoff_by: context.appUser.id,
      status: "signed_off",
      updated_at: now,
    })
    .eq("id", followUp.id)
    .eq("tenant_id", context.appUser.tenant_id)
    .eq("status", "completed")
    .select("id")
    .maybeSingle<{ id: string }>();

  if (updateError) {
    redirect(`/web?error=${encodeURIComponent(updateError.message)}`);
  }

  if (!signedOffFollowUp) {
    redirect("/web?error=Corrective%20action%20is%20no%20longer%20ready%20for%20sign-off.");
  }

  if (followUp.assigned_to && followUp.assigned_to !== context.appUser.id) {
    const { data: notification } = await supabase
      .from("notifications")
      .insert({
        body: `${followUp.title} was reviewed and signed off.`,
        channel: "in_app",
        created_at: now,
        delivered_at: now,
        delivery_status: "delivered",
        recipient_type: "follow_up_assignee",
        submission_id: followUp.parent_submission_id,
        tenant_id: context.appUser.tenant_id,
        title: "Corrective action signed off",
        user_id: followUp.assigned_to,
      })
      .select("body, created_at, delivery_status, id, recipient_type, submission_id, title, user_id")
      .single<FollowUpNotificationAuditRow>();

    if (notification) {
      await recordTenantAuditEvent({
        action: "follow_up.notification.signoff.sent",
        actorRole: context.appUser.power_level,
        actorUserId: context.appUser.id,
        entityId: notification.id,
        entityTable: "notifications",
        metadata: {
          assigned_to: followUp.assigned_to,
          body: notification.body,
          created_at: notification.created_at,
          delivery_status: notification.delivery_status,
          follow_up_id: signedOffFollowUp.id,
          follow_up_title: followUp.title,
          recipient_type: notification.recipient_type,
          source: "worker_app",
          submission_id: notification.submission_id,
          title: notification.title,
          user_id: notification.user_id,
        },
        tenantId: context.appUser.tenant_id,
      });
    }
  }

  await recordTenantAuditEvent({
    action: "follow_up.worker_signoff",
    actorRole: context.appUser.power_level,
    actorUserId: context.appUser.id,
    entityId: signedOffFollowUp.id,
    entityTable: "follow_ups",
    metadata: {
      assigned_to: followUp.assigned_to,
      parent_submission_id: followUp.parent_submission_id,
      signoff_at: now,
      status: "signed_off",
      title: followUp.title,
    },
    tenantId: context.appUser.tenant_id,
  });

  revalidatePath("/web");
  revalidatePath("/admin/follow-ups");
  revalidatePath("/admin/monitor");
  redirect("/web?notice=Corrective%20action%20signed%20off.");
}

export async function uploadWorkerCertificationTicket(formData: FormData) {
  const context = await requireAppUser();
  const name = stringValue(formData, "name");
  const issuedOn = dateOnlyValue(formData, "issuedOn");
  const expiresOn = dateOnlyValue(formData, "expiresOn");
  const attachment = getUploadFile(formData, "attachment");

  if (!name) {
    redirect("/web?error=Enter%20a%20ticket%20name.");
  }

  if (!attachment) {
    redirect("/web?error=Take%20a%20photo%20or%20choose%20a%20ticket%20file.");
  }

  if (!workerTicketMimeTypes.has(attachment.type)) {
    redirect("/web?error=Choose%20a%20PDF,%20PNG,%20JPEG,%20HEIC,%20or%20WebP%20ticket.");
  }

  const supabase = await createSupabaseServerClient();
  const storageSupabase = createSupabaseAdminClient() ?? supabase;
  const { data: workerProfile, error: profileSelectError } = await supabase
    .from("worker_profiles")
    .select("id")
    .eq("tenant_id", context.appUser.tenant_id)
    .eq("user_id", context.appUser.id)
    .maybeSingle<{ id: string }>();

  if (profileSelectError) {
    redirect(`/web?error=${encodeURIComponent(profileSelectError.message)}`);
  }

  let workerProfileId = workerProfile?.id;

  if (!workerProfileId) {
    const { data: createdProfile, error: profileCreateError } = await supabase
      .from("worker_profiles")
      .insert({
        tenant_id: context.appUser.tenant_id,
        user_id: context.appUser.id,
      })
      .select("id")
      .single<{ id: string }>();

    if (profileCreateError) {
      redirect(`/web?error=${encodeURIComponent(profileCreateError.message)}`);
    }

    workerProfileId = createdProfile?.id;
  }

  if (!workerProfileId) {
    redirect("/web?error=Worker%20profile%20was%20not%20created.");
  }

  // Uploading a second "H2S Alive" instead of renewing the first one leaves the
  // old row expired forever, so the worker reads as deficient on a ticket they
  // actually hold. Point them at Renew, which updates the record they already
  // have. Matching strips punctuation and spacing, because "First Aid" and
  // "first-aid" are one ticket to everybody except a string comparison.
  const { data: existingTickets } = await supabase
    .from("certifications")
    .select("id, name")
    .eq("tenant_id", context.appUser.tenant_id)
    .eq("worker_profile_id", workerProfileId)
    .returns<{ id: string; name: string }[]>();

  const nameKey = normalizeIdentifier(name);
  const alreadyHeld = (existingTickets ?? []).find((ticket) => normalizeIdentifier(ticket.name) === nameKey);

  if (alreadyHeld) {
    redirect(
      `/web?error=${encodeURIComponent(
        `You already have a ${alreadyHeld.name} ticket. Use Renew on that ticket to add the new card, so you do not end up with two.`,
      )}`,
    );
  }

  const attachmentPath = [
    context.appUser.tenant_id,
    "certifications",
    context.appUser.id,
    `${Date.now()}-${sanitizeStorageFilename(attachment.name)}`,
  ].join("/");

  const { error: uploadError } = await storageSupabase.storage.from("tenant-documents").upload(attachmentPath, attachment, {
    contentType: attachment.type || "application/octet-stream",
    upsert: false,
  });

  if (uploadError) {
    redirect(`/web?error=${encodeURIComponent(uploadError.message)}`);
  }

  const { data: certification, error } = await supabase
    .from("certifications")
    .insert({
      attachment_path: attachmentPath,
      expires_on: expiresOn,
      issued_on: issuedOn,
      name,
      tenant_id: context.appUser.tenant_id,
      worker_profile_id: workerProfileId,
    })
    .select("id")
    .single<{ id: string }>();

  const certificationId = certification?.id;

  if (error || !certificationId) {
    await storageSupabase.storage.from("tenant-documents").remove([attachmentPath]);
    redirect(`/web?error=${encodeURIComponent(error?.message ?? "Certification ticket was not saved.")}`);
  }

  await recordTenantAuditEvent({
    action: "certification.worker_upload",
    actorRole: context.appUser.power_level,
    actorUserId: context.appUser.id,
    entityId: certificationId,
    entityTable: "certifications",
    metadata: {
      attachment_path: attachmentPath,
      expires_on: expiresOn,
      issued_on: issuedOn,
      name,
      worker_profile_id: workerProfileId,
    },
    tenantId: context.appUser.tenant_id,
  });

  revalidatePath("/web");
  revalidatePath("/admin/workers");
  revalidatePath(`/admin/workers/${context.appUser.id}`);
  revalidatePath("/admin/worker-tickets");
  redirect("/web?notice=Ticket%20uploaded.");
}

/**
 * A worker replaces the card on one of their OWN tickets, from their phone.
 *
 * This is the half of the compliance library that makes it self-maintaining. A
 * ticket lapses and goes red, the worker photographs the new card in the yard,
 * and the record turns green without an administrator touching it. It is also
 * how the amber "No document" records get cleared: an admin bulk-loads the dates
 * from a spreadsheet, and each worker supplies the proof for their own.
 *
 * It UPDATES the existing row rather than inserting a new one. A renewal is the
 * same ticket with a later date, and filing it as a second record would leave the
 * old one expired on the worker's file forever, reporting a deficiency on a
 * qualification they actually hold.
 *
 * Dates are optional and default to what is already recorded, which is what makes
 * one action serve both jobs: a real renewal supplies a new expiry, while
 * supplying proof for an already-correct date changes only the photo.
 */
export async function renewWorkerCertification(formData: FormData) {
  const context = await requireAppUser();
  const certificationId = stringValue(formData, "certificationId");
  const issuedOn = dateOnlyValue(formData, "issuedOn");
  const expiresOn = dateOnlyValue(formData, "expiresOn");
  const attachment = getUploadFile(formData, "attachment");

  if (!certificationId) {
    redirect("/web?error=Choose%20a%20ticket%20to%20renew.");
  }

  if (!attachment) {
    redirect("/web?error=Take%20a%20photo%20of%20the%20new%20card.");
  }

  if (!workerTicketMimeTypes.has(attachment.type)) {
    redirect("/web?error=Choose%20a%20PDF,%20PNG,%20JPEG,%20HEIC,%20or%20WebP%20ticket.");
  }

  const supabase = await createSupabaseServerClient();
  const storageSupabase = createSupabaseAdminClient() ?? supabase;

  // Ownership is enforced twice on purpose. The policies added in
  // 20260814000000 stop a worker updating a colleague's ticket at the database,
  // and this check stops the request before it gets that far so the worker sees
  // a sentence rather than a silent no-op: an UPDATE that matches no row under
  // RLS returns success with zero rows changed.
  const { data: workerProfile } = await supabase
    .from("worker_profiles")
    .select("id")
    .eq("tenant_id", context.appUser.tenant_id)
    .eq("user_id", context.appUser.id)
    .maybeSingle<{ id: string }>();

  if (!workerProfile?.id) {
    redirect("/web?error=No%20worker%20profile%20on%20file%20to%20renew%20a%20ticket%20against.");
  }

  const { data: certification } = await supabase
    .from("certifications")
    .select("id, name, issued_on, expires_on, attachment_path, worker_profile_id")
    .eq("tenant_id", context.appUser.tenant_id)
    .eq("id", certificationId)
    .maybeSingle<{
      id: string;
      name: string;
      issued_on: string | null;
      expires_on: string | null;
      attachment_path: string | null;
      worker_profile_id: string;
    }>();

  if (!certification || certification.worker_profile_id !== workerProfile.id) {
    // Deliberately the same message either way. Telling someone that a ticket
    // exists but is not theirs confirms a colleague holds it.
    redirect("/web?error=That%20ticket%20is%20not%20on%20your%20file.");
  }

  const attachmentPath = [
    context.appUser.tenant_id,
    "certifications",
    context.appUser.id,
    `${Date.now()}-${sanitizeStorageFilename(attachment.name)}`,
  ].join("/");

  const { error: uploadError } = await storageSupabase.storage.from("tenant-documents").upload(attachmentPath, attachment, {
    contentType: attachment.type || "application/octet-stream",
    upsert: false,
  });

  if (uploadError) {
    redirect(`/web?error=${encodeURIComponent(uploadError.message)}`);
  }

  const { data: updated, error } = await supabase
    .from("certifications")
    .update({
      attachment_path: attachmentPath,
      expires_on: expiresOn ?? certification.expires_on,
      issued_on: issuedOn ?? certification.issued_on,
    })
    .eq("tenant_id", context.appUser.tenant_id)
    .eq("id", certification.id)
    .select("id")
    .maybeSingle<{ id: string }>();

  // No row back means RLS declined the write, which arrives as success with
  // nothing changed. Undo the upload rather than leaving an orphan behind and a
  // worker believing their ticket is current.
  if (error || !updated?.id) {
    await storageSupabase.storage.from("tenant-documents").remove([attachmentPath]);
    redirect(`/web?error=${encodeURIComponent(error?.message ?? "Ticket was not renewed.")}`);
  }

  await recordTenantAuditEvent({
    action: "certification.worker_renewal",
    actorRole: context.appUser.power_level,
    actorUserId: context.appUser.id,
    entityId: certification.id,
    entityTable: "certifications",
    metadata: {
      attachment_path: attachmentPath,
      expires_on: expiresOn ?? certification.expires_on,
      issued_on: issuedOn ?? certification.issued_on,
      name: certification.name,
      // The row now points at the new card, so the previous one is only
      // reachable from here. It is left in storage rather than deleted: it is
      // the evidence of the period that just ended, and an audit that asks what
      // this worker held last year deserves an answer.
      previous_attachment_path: certification.attachment_path,
      previous_expires_on: certification.expires_on,
      worker_profile_id: workerProfile.id,
    },
    tenantId: context.appUser.tenant_id,
  });

  revalidatePath("/web");
  revalidatePath("/admin/workers");
  revalidatePath(`/admin/workers/${context.appUser.id}`);
  revalidatePath("/admin/worker-tickets");
  revalidatePath("/admin/needs-document");
  redirect(`/web?notice=${encodeURIComponent(`${certification.name} updated.`)}`);
}
