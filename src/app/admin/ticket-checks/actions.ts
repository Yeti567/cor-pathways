"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { canUseAdminPanel } from "@/lib/access-control";
import { requireAppUser } from "@/lib/current-user";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { recordTenantAuditEvent } from "@/lib/tenant-audit";
import {
  buildTicketReject,
  buildTicketVerifyUpdate,
  TICKET_CHECKS_PATH,
  TICKET_REVIEW_SELECT,
  ticketRejectedNotice,
  type TicketReviewRow,
} from "@/lib/ticket-review";

function backTo(key: "error" | "notice", message: string): never {
  redirect(`${TICKET_CHECKS_PATH}?${key}=${encodeURIComponent(message)}`);
}

async function requireTicketChecker() {
  const context = await requireAppUser();

  if (!canUseAdminPanel(context.appUser)) {
    redirect("/choose");
  }

  return context;
}

async function loadAwaitingTicket(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  tenantId: string,
  certificationId: string,
) {
  const { data, error } = await supabase
    .from("certifications")
    .select(TICKET_REVIEW_SELECT)
    .eq("tenant_id", tenantId)
    .eq("id", certificationId)
    .maybeSingle<TicketReviewRow>();

  if (error) {
    backTo("error", error.message);
  }

  // Two people working the list at once: the second click finds it already done.
  if (!data || data.review_status !== "awaiting_check") {
    backTo("notice", "That ticket has already been checked.");
  }

  return data;
}

function revalidateTicketPages(workerUserId: string | null) {
  revalidatePath(TICKET_CHECKS_PATH);
  revalidatePath("/admin", "layout");
  revalidatePath("/admin/worker-tickets");
  revalidatePath("/admin/needs-document");
  revalidatePath("/web");

  if (workerUserId) {
    revalidatePath(`/admin/workers/${workerUserId}`);
  }
}

async function workerUserIdFor(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  tenantId: string,
  workerProfileId: string,
) {
  const { data } = await supabase
    .from("worker_profiles")
    .select("user_id")
    .eq("tenant_id", tenantId)
    .eq("id", workerProfileId)
    .maybeSingle<{ user_id: string }>();

  return data?.user_id ?? null;
}

export async function verifyWorkerTicket(formData: FormData) {
  const context = await requireTicketChecker();
  const certificationId = String(formData.get("certificationId") ?? "").trim();

  if (!certificationId) {
    backTo("error", "Choose a ticket to verify.");
  }

  const supabase = await createSupabaseServerClient();
  const tenantId = context.appUser.tenant_id;
  const ticket = await loadAwaitingTicket(supabase, tenantId, certificationId);
  const reviewedAt = new Date().toISOString();

  const { data: updated, error } = await supabase
    .from("certifications")
    .update(buildTicketVerifyUpdate(context.appUser.id, reviewedAt))
    .eq("tenant_id", tenantId)
    .eq("id", ticket.id)
    .eq("review_status", "awaiting_check")
    .select("id")
    .maybeSingle<{ id: string }>();

  if (error || !updated) {
    backTo("error", error?.message ?? "The ticket was not marked as checked.");
  }

  await recordTenantAuditEvent({
    action: "certification.review_verified",
    actorRole: context.appUser.power_level,
    actorUserId: context.appUser.id,
    entityId: ticket.id,
    entityTable: "certifications",
    metadata: {
      attachment_path: ticket.attachment_path,
      expires_on: ticket.expires_on,
      issued_on: ticket.issued_on,
      name: ticket.name,
      review_kind: ticket.review_kind,
      submitted_at: ticket.review_submitted_at,
      submitted_by: ticket.review_submitted_by,
      worker_profile_id: ticket.worker_profile_id,
    },
    tenantId,
  });

  revalidateTicketPages(await workerUserIdFor(supabase, tenantId, ticket.worker_profile_id));
  backTo("notice", `${ticket.name} checked.`);
}

export async function rejectWorkerTicket(formData: FormData) {
  const context = await requireTicketChecker();
  const certificationId = String(formData.get("certificationId") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim().slice(0, 500);

  if (!certificationId) {
    backTo("error", "Choose a ticket to reject.");
  }

  if (!reason) {
    backTo("error", "Say why the ticket is being rejected. The employee sees this.");
  }

  const supabase = await createSupabaseServerClient();
  const tenantId = context.appUser.tenant_id;
  const ticket = await loadAwaitingTicket(supabase, tenantId, certificationId);
  const workerUserId = await workerUserIdFor(supabase, tenantId, ticket.worker_profile_id);
  const reviewedAt = new Date().toISOString();
  const reject = buildTicketReject(ticket, context.appUser.id, reviewedAt);

  if (reject.action === "delete") {
    const { error } = await supabase
      .from("certifications")
      .delete()
      .eq("tenant_id", tenantId)
      .eq("id", ticket.id)
      .eq("review_status", "awaiting_check");

    if (error) {
      backTo("error", error.message);
    }
  } else {
    const { data: updated, error } = await supabase
      .from("certifications")
      .update(reject.update)
      .eq("tenant_id", tenantId)
      .eq("id", ticket.id)
      .eq("review_status", "awaiting_check")
      .select("id")
      .maybeSingle<{ id: string }>();

    if (error || !updated) {
      backTo("error", error?.message ?? "The ticket was not put back.");
    }
  }

  await recordTenantAuditEvent({
    action: "certification.review_rejected",
    actorRole: context.appUser.power_level,
    actorUserId: context.appUser.id,
    entityId: ticket.id,
    entityTable: "certifications",
    metadata: {
      // The rejected card stays in storage; this is the only pointer to it.
      rejected_attachment_path: ticket.attachment_path,
      rejected_expires_on: ticket.expires_on,
      rejected_issued_on: ticket.issued_on,
      name: ticket.name,
      outcome: reject.action === "delete" ? "removed" : "restored",
      reason,
      restored_attachment_path: ticket.review_previous_attachment_path,
      restored_expires_on: ticket.review_previous_expires_on,
      restored_issued_on: ticket.review_previous_issued_on,
      review_kind: ticket.review_kind,
      submitted_at: ticket.review_submitted_at,
      submitted_by: ticket.review_submitted_by,
      worker_profile_id: ticket.worker_profile_id,
    },
    tenantId,
  });

  if (workerUserId) {
    const notice = ticketRejectedNotice(ticket.name, ticket.review_kind, reason);

    await supabase.from("notifications").insert({
      ...notice,
      channel: "in_app",
      delivered_at: reviewedAt,
      delivery_status: "delivered",
      recipient_type: "certification_worker",
      tenant_id: tenantId,
      user_id: workerUserId,
    });
  }

  revalidateTicketPages(workerUserId);
  backTo("notice", `${ticket.name} rejected. The employee has been told.`);
}
