// Hours of Service violation alerts.
//
// A daily companion to the expiry reminder engine (transport-reminders.ts): it
// computes each driver's current HOS violations from the duty-status log and
// notifies the transport managers and the linked driver. Alerts are keyed by
// driver + violation + day so an ongoing breach nudges once per day rather than
// on every cron tick.

import { isPowerAtLeast } from "@/lib/access-control";
import { computeHosViolations, type DutyStatusEvent, type HosViolationType } from "@/lib/hos-rules";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { recordTenantAuditEvent } from "@/lib/tenant-audit";
import type { Database } from "@/types/database";

type HosReminderClient = Pick<Awaited<ReturnType<typeof createSupabaseServerClient>>, "from">;
type HosReminderNotification = Database["public"]["Tables"]["notifications"]["Insert"];
type HosReminderNotificationAuditRow = Pick<
  Database["public"]["Tables"]["notifications"]["Row"],
  "body" | "created_at" | "delivery_status" | "id" | "recipient_name" | "recipient_type" | "title" | "user_id"
>;
type HosReminderDriver = Pick<
  Database["public"]["Tables"]["transport_driver"]["Row"],
  "id" | "full_name" | "user_id" | "hos_cycle" | "hos_regime"
>;
type HosReminderEvent = Pick<
  Database["public"]["Tables"]["transport_duty_status_event"]["Row"],
  "driver_id" | "status" | "started_at"
>;
type HosReminderUser = Pick<
  Database["public"]["Tables"]["users"]["Row"],
  "active" | "app_access" | "email" | "full_name" | "id" | "power_level"
>;
type HosReminderAuditSource = "cron" | "page";

// Cycle 2 spans 14 days, so a 15-day event window covers every availability check.
export const HOS_EVENT_WINDOW_DAYS = 15;

const HOS_VIOLATION_MESSAGES: Record<HosViolationType, string> = {
  driving_limit: "exceeded the 13-hour daily driving limit",
  on_duty_limit: "exceeded the 14-hour daily on-duty limit",
  elapsed_window: "drove after the 16-hour on-duty window closed",
  cycle_limit: "exceeded their on-duty cycle limit",
};

function displayName(user: Pick<HosReminderUser, "email" | "full_name"> | null | undefined) {
  return user?.full_name?.trim() || user?.email || "Worker";
}

function dayStamp(now: Date): string {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const day = String(now.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function managerRecipients(users: HosReminderUser[], excludeUserId: string | null) {
  return users.filter((user) => {
    if (!user.active || user.id === excludeUserId) {
      return false;
    }

    return (
      isPowerAtLeast(user.power_level, "manager") ||
      user.app_access === "admin_access" ||
      user.app_access === "super_admin_access"
    );
  });
}

function recipientsForDriver(input: {
  driver: HosReminderDriver;
  users: HosReminderUser[];
}): { recipientType: string; user: HosReminderUser }[] {
  const userById = new Map(input.users.map((user) => [user.id, user]));
  const linkedUser = input.driver.user_id ? userById.get(input.driver.user_id) : null;

  return [
    ...(linkedUser?.active ? [{ recipientType: "transport_driver", user: linkedUser }] : []),
    ...managerRecipients(input.users, linkedUser?.id ?? null).map((user) => ({
      recipientType: "transport_manager",
      user,
    })),
  ];
}

function baseNotification(input: {
  body: string;
  createdAt: string;
  recipientType: string;
  tenantId: string;
  title: string;
  user: HosReminderUser;
}): HosReminderNotification {
  return {
    body: input.body,
    channel: "in_app",
    created_at: input.createdAt,
    delivered_at: input.createdAt,
    delivery_status: "delivered",
    recipient_name: displayName(input.user),
    recipient_type: input.recipientType,
    tenant_id: input.tenantId,
    title: input.title,
    user_id: input.user.id,
  };
}

export function buildHosViolationNotifications({
  createdAt,
  drivers,
  eventsByDriver,
  now = new Date(),
  tenantId,
  users,
}: {
  createdAt: string;
  drivers: HosReminderDriver[];
  eventsByDriver: Map<string, DutyStatusEvent[]>;
  now?: Date;
  tenantId: string;
  users: HosReminderUser[];
}) {
  const stamp = dayStamp(now);
  const notifications: HosReminderNotification[] = [];

  for (const driver of drivers) {
    const events = eventsByDriver.get(driver.id) ?? [];

    if (events.length === 0) {
      continue;
    }

    const violations = computeHosViolations({ events, cycle: driver.hos_cycle, regime: driver.hos_regime, now });
    const seenTypes = new Set<HosViolationType>();

    for (const violation of violations) {
      if (seenTypes.has(violation.type)) {
        continue;
      }
      seenTypes.add(violation.type);

      // Day-stamped title keeps an ongoing breach to one alert per day; the body
      // stays stable per type so it does not re-fire as more events are logged.
      const title = `HOS violation ${stamp}: ${driver.full_name}, ${violation.label}`;
      const body = `${driver.full_name} ${HOS_VIOLATION_MESSAGES[violation.type]}. Review the duty-status log and confirm a valid reset before they drive again.`;

      for (const recipient of recipientsForDriver({ driver, users })) {
        notifications.push(
          baseNotification({
            body,
            createdAt,
            recipientType: recipient.recipientType,
            tenantId,
            title,
            user: recipient.user,
          }),
        );
      }
    }
  }

  return notifications;
}

export async function sendHosViolationNotifications(
  tenantId: string,
  now = new Date(),
  client?: HosReminderClient,
  options: {
    auditClient?: HosReminderClient | null;
    auditSource?: HosReminderAuditSource;
  } = {},
) {
  const supabase = client ?? (await createSupabaseServerClient());
  const createdAt = now.toISOString();
  const windowStart = new Date(now.getTime() - HOS_EVENT_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const [{ data: drivers, error: driversError }, { data: events, error: eventsError }, { data: users, error: usersError }] =
    await Promise.all([
      supabase
        .from("transport_driver")
        .select("id, full_name, user_id, hos_cycle, hos_regime")
        .eq("tenant_id", tenantId)
        .is("deleted_at", null)
        .returns<HosReminderDriver[]>(),
      supabase
        .from("transport_duty_status_event")
        .select("driver_id, status, started_at")
        .eq("tenant_id", tenantId)
        .gte("started_at", windowStart)
        .order("started_at", { ascending: true })
        .returns<HosReminderEvent[]>(),
      supabase
        .from("users")
        .select("id, full_name, email, active, power_level, app_access")
        .eq("tenant_id", tenantId)
        .eq("active", true)
        .returns<HosReminderUser[]>(),
    ]);

  const error = driversError?.message ?? eventsError?.message ?? usersError?.message ?? null;

  if (error) {
    return { auditError: null, created: 0, error, skipped: 0 };
  }

  const eventsByDriver = new Map<string, DutyStatusEvent[]>();
  for (const event of events ?? []) {
    eventsByDriver.set(event.driver_id, [
      ...(eventsByDriver.get(event.driver_id) ?? []),
      { status: event.status, startedAt: event.started_at },
    ]);
  }

  const candidateNotifications = buildHosViolationNotifications({
    createdAt,
    drivers: drivers ?? [],
    eventsByDriver,
    now,
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
    .returns<HosReminderNotificationAuditRow[]>();

  let auditError: string | null = null;

  if (!insertError && insertedNotifications && insertedNotifications.length > 0) {
    try {
      for (const notification of insertedNotifications) {
        await recordTenantAuditEvent(
          {
            action: "hos_violation.notification.sent",
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
      auditError = auditException instanceof Error ? auditException.message : "HOS reminder audit was not recorded.";
    }
  }

  return {
    created: insertError ? 0 : newNotifications.length,
    auditError,
    error: insertError?.message ?? null,
    skipped: candidateNotifications.length - newNotifications.length,
  };
}
