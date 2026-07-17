import { isPowerAtLeast } from "@/lib/access-control";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { recordTenantAuditEvent } from "@/lib/tenant-audit";
import type { Database } from "@/types/database";

type DocumentReminderClient = Pick<Awaited<ReturnType<typeof createSupabaseServerClient>>, "from">;
type DocumentReminderNotification = Database["public"]["Tables"]["notifications"]["Insert"];
type DocumentReminderNotificationAuditRow = Pick<
  Database["public"]["Tables"]["notifications"]["Row"],
  "body" | "created_at" | "delivery_status" | "id" | "recipient_name" | "recipient_type" | "title" | "user_id"
>;
type DocumentReminderResource = Pick<
  Database["public"]["Tables"]["resources"]["Row"],
  "id" | "name" | "review_date" | "reminder_lead_days"
>;
type DocumentReminderUser = Pick<
  Database["public"]["Tables"]["users"]["Row"],
  "active" | "app_access" | "email" | "full_name" | "id" | "power_level"
>;
type DocumentReminderAuditSource = "cron" | "page";

export type ResourceReviewState = "none" | "current" | "due_soon" | "overdue";

function startOfDay(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function addDays(value: Date, days: number) {
  const copy = new Date(value);
  copy.setDate(copy.getDate() + days);
  return copy;
}

export function addMonths(value: Date, months: number) {
  const copy = new Date(value);
  copy.setMonth(copy.getMonth() + months);
  return copy;
}

export function dateInputValue(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatReviewDate(value: string | null) {
  if (!value) {
    return "no expiry date";
  }

  return new Intl.DateTimeFormat("en", { day: "2-digit", month: "short", year: "numeric" }).format(
    new Date(`${value.slice(0, 10)}T00:00:00`),
  );
}

// A document is due_soon once it is within its reminder lead window, overdue once
// the review date has passed.
export function getResourceReviewStatus(
  review: { reminderLeadDays: number | null; reviewDate: string | null },
  now = new Date(),
): ResourceReviewState {
  if (!review.reviewDate) {
    return "none";
  }

  const today = startOfDay(now);
  const due = startOfDay(new Date(`${review.reviewDate.slice(0, 10)}T00:00:00`));
  const lead = typeof review.reminderLeadDays === "number" ? review.reminderLeadDays : 30;
  const msPerDay = 24 * 60 * 60 * 1000;
  const daysUntil = Math.round((due.getTime() - today.getTime()) / msPerDay);

  if (daysUntil < 0) {
    return "overdue";
  }
  if (daysUntil <= lead) {
    return "due_soon";
  }
  return "current";
}

function displayName(user: Pick<DocumentReminderUser, "email" | "full_name"> | null | undefined) {
  return user?.full_name?.trim() || user?.email || "Manager";
}

function managerRecipients(users: DocumentReminderUser[]) {
  return users.filter(
    (user) =>
      user.active &&
      (isPowerAtLeast(user.power_level, "manager") ||
        user.app_access === "admin_access" ||
        user.app_access === "super_admin_access"),
  );
}

export function buildDocumentReviewNotifications({
  createdAt,
  now = new Date(),
  resources,
  tenantId,
  users,
}: {
  createdAt: string;
  now?: Date;
  resources: DocumentReminderResource[];
  tenantId: string;
  users: DocumentReminderUser[];
}) {
  const recipients = managerRecipients(users);
  const notifications: DocumentReminderNotification[] = [];

  for (const resource of resources) {
    const state = getResourceReviewStatus(
      { reminderLeadDays: resource.reminder_lead_days, reviewDate: resource.review_date },
      now,
    );

    if (state === "none" || state === "current") {
      continue;
    }

    const reviewDate = formatReviewDate(resource.review_date);
    const overdue = state === "overdue";
    const title = `${overdue ? "Document expired" : "Document expiry due"}: ${resource.name}`;
    const body = overdue
      ? `${resource.name} expired on ${reviewDate}. Review and update it, then set the new expiry date.`
      : `${resource.name} expires on ${reviewDate}. Review it before then and set the new expiry date.`;

    for (const user of recipients) {
      notifications.push({
        body,
        channel: "in_app",
        created_at: createdAt,
        delivered_at: createdAt,
        delivery_status: "delivered",
        recipient_name: displayName(user),
        recipient_type: "document_review_manager",
        tenant_id: tenantId,
        title,
        user_id: user.id,
      });
    }
  }

  return notifications;
}

export async function sendDocumentReviewNotifications(
  tenantId: string,
  now = new Date(),
  client?: DocumentReminderClient,
  options: { auditClient?: DocumentReminderClient | null; auditSource?: DocumentReminderAuditSource } = {},
) {
  const supabase = client ?? (await createSupabaseServerClient());
  const today = startOfDay(now);
  const createdAt = now.toISOString();
  // Only pull documents already at or inside their reminder window. A generous
  // 365-day horizon covers long lead times; the status check narrows it per doc.
  const horizon = dateInputValue(addDays(today, 365));

  const [{ data: resources, error: resourcesError }, { data: users, error: usersError }] = await Promise.all([
    supabase
      .from("resources")
      .select("id, name, review_date, reminder_lead_days")
      .eq("tenant_id", tenantId)
      .not("review_date", "is", null)
      .lte("review_date", horizon)
      .returns<DocumentReminderResource[]>(),
    supabase
      .from("users")
      .select("id, full_name, email, active, power_level, app_access")
      .eq("tenant_id", tenantId)
      .eq("active", true)
      .returns<DocumentReminderUser[]>(),
  ]);

  const error = resourcesError?.message ?? usersError?.message ?? null;
  if (error) {
    return { auditError: null, created: 0, error, skipped: 0 };
  }

  const candidateNotifications = buildDocumentReviewNotifications({
    createdAt,
    now,
    resources: resources ?? [],
    tenantId,
    users: users ?? [],
  });

  if (candidateNotifications.length === 0) {
    return { auditError: null, created: 0, error: null, skipped: 0 };
  }

  const titles = Array.from(new Set(candidateNotifications.map((notification) => notification.title ?? ""))).filter(Boolean);
  const { data: existingNotifications, error: existingError } =
    titles.length > 0
      ? await supabase
          .from("notifications")
          .select("body, title, user_id")
          .eq("tenant_id", tenantId)
          .in("title", titles)
          .returns<Pick<Database["public"]["Tables"]["notifications"]["Row"], "body" | "title" | "user_id">[]>()
      : { data: [], error: null };

  if (existingError) {
    return { auditError: null, created: 0, error: existingError.message, skipped: 0 };
  }

  const existingKeys = new Set(
    (existingNotifications ?? []).map((notification) => `${notification.user_id ?? ""}|${notification.title}|${notification.body}`),
  );
  const newNotifications = candidateNotifications.filter(
    (notification) => !existingKeys.has(`${notification.user_id ?? ""}|${notification.title}|${notification.body}`),
  );

  if (newNotifications.length === 0) {
    return { auditError: null, created: 0, error: null, skipped: candidateNotifications.length };
  }

  const { data: insertedNotifications, error: insertError } = await supabase
    .from("notifications")
    .insert(newNotifications)
    .select("body, created_at, delivery_status, id, recipient_name, recipient_type, title, user_id")
    .returns<DocumentReminderNotificationAuditRow[]>();

  let auditError: string | null = null;

  if (!insertError && insertedNotifications && insertedNotifications.length > 0) {
    try {
      for (const notification of insertedNotifications) {
        await recordTenantAuditEvent(
          {
            action: "document_review_reminder.notification.sent",
            actorRole: "system",
            entityId: notification.id,
            entityTable: "notifications",
            metadata: {
              created_at: notification.created_at,
              delivery_status: notification.delivery_status,
              recipient_name: notification.recipient_name,
              recipient_type: notification.recipient_type,
              source: options.auditSource ?? "page",
              title: notification.title,
              user_id: notification.user_id,
            },
            tenantId,
          },
          options.auditClient === undefined ? undefined : options.auditClient,
        );
      }
    } catch (auditException) {
      auditError = auditException instanceof Error ? auditException.message : "Document review audit was not recorded.";
    }
  }

  return {
    created: insertError ? 0 : newNotifications.length,
    auditError,
    error: insertError?.message ?? null,
    skipped: candidateNotifications.length - newNotifications.length,
  };
}
