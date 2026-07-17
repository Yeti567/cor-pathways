import { NextResponse } from "next/server";
import { autoShareNotificationAuditAction } from "@/lib/auto-share";
import { getCurrentUserContext } from "@/lib/current-user";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { recordTenantAuditEvent } from "@/lib/tenant-audit";
import type { Database } from "@/types/database";

export const dynamic = "force-dynamic";

type AutoShareAuditNotificationRow = Pick<
  Database["public"]["Tables"]["notifications"]["Row"],
  | "channel"
  | "delivery_error"
  | "delivery_status"
  | "id"
  | "recipient_contact"
  | "recipient_name"
  | "recipient_type"
  | "submission_id"
  | "title"
>;

function notificationIdsFromBody(body: unknown) {
  if (!body || typeof body !== "object" || !("notificationIds" in body)) {
    return null;
  }

  const { notificationIds } = body as { notificationIds?: unknown };

  if (!Array.isArray(notificationIds)) {
    return null;
  }

  const ids = notificationIds
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter(Boolean);

  return Array.from(new Set(ids)).slice(0, 100);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Auto-share notification audit was not recorded.";
}

export async function POST(request: Request) {
  const context = await getCurrentUserContext();

  if (context.status === "signed_out") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (context.status !== "app_user") {
    return NextResponse.json({ error: "App user access is required." }, { status: 403 });
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const notificationIds = notificationIdsFromBody(body);

  if (!notificationIds) {
    return NextResponse.json({ error: "notificationIds must be an array." }, { status: 400 });
  }

  if (notificationIds.length === 0) {
    return NextResponse.json({ recorded: 0 });
  }

  const supabase = await createSupabaseServerClient();
  const { data: notifications, error } = await supabase
    .from("notifications")
    .select("channel, delivery_error, delivery_status, id, recipient_contact, recipient_name, recipient_type, submission_id, title")
    .eq("tenant_id", context.appUser.tenant_id)
    .in("id", notificationIds)
    .ilike("title", "Auto-share:%")
    .returns<AutoShareAuditNotificationRow[]>();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if ((notifications ?? []).length !== notificationIds.length) {
    return NextResponse.json({ error: "One or more Auto-share notifications were not found." }, { status: 404 });
  }

  try {
    for (const notification of notifications ?? []) {
      await recordTenantAuditEvent({
        action: autoShareNotificationAuditAction(notification.delivery_status),
        actorRole: context.appUser.power_level,
        actorUserId: context.appUser.id,
        entityId: notification.id,
        entityTable: "notifications",
        metadata: {
          channel: notification.channel,
          delivery_error: notification.delivery_error,
          delivery_status: notification.delivery_status,
          recipient_contact: notification.recipient_contact,
          recipient_name: notification.recipient_name,
          recipient_type: notification.recipient_type,
          source: "offline_sync",
          submission_id: notification.submission_id,
          title: notification.title,
        },
        tenantId: context.appUser.tenant_id,
      });
    }
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }

  return NextResponse.json({
    recorded: notifications?.length ?? 0,
  });
}
