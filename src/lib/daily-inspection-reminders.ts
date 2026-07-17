// Daily Trip Inspection reminders.
//
// A "no inspection logged" nudge: any commercial vehicle that has no valid daily
// trip inspection right now (due), or is sitting out of service from an uncleared
// major defect, generates an in-app notification to the carrier's managers and the
// vehicle's assigned worker. Mirrors the transport-reminders pattern and plugs
// into the same certification-reminders cron.
//
// The current date is woven into the message so a perpetually-due vehicle nudges
// once per day rather than being deduplicated forever (dedup is by title+body+user).

import { isPowerAtLeast } from "@/lib/access-control";
import { buildFleetInspectionStatus, INSPECTABLE_EQUIPMENT_CATEGORIES } from "@/lib/daily-inspection";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { recordTenantAuditEvent } from "@/lib/tenant-audit";
import type { Database } from "@/types/database";

type ReminderClient = Pick<Awaited<ReturnType<typeof createSupabaseServerClient>>, "from">;
type ReminderNotification = Database["public"]["Tables"]["notifications"]["Insert"];
type ReminderNotificationAuditRow = Pick<
  Database["public"]["Tables"]["notifications"]["Row"],
  "body" | "created_at" | "delivery_status" | "id" | "recipient_name" | "recipient_type" | "title" | "user_id"
>;
type ReminderUser = Pick<
  Database["public"]["Tables"]["users"]["Row"],
  "active" | "app_access" | "email" | "full_name" | "id" | "power_level"
>;
type ReminderVehicle = {
  id: string;
  unit_number: string;
  name: string | null;
  assigned_to: string | null;
};
type ReminderInspection = {
  id: string;
  equipment_id: string;
  completed_at: string;
  valid_until: string;
  out_of_service: boolean;
  out_of_service_cleared_at: string | null;
};
type ReminderAuditSource = "cron" | "page";

function displayName(user: Pick<ReminderUser, "email" | "full_name"> | null | undefined) {
  return user?.full_name?.trim() || user?.email || "Worker";
}

function vehicleLabel(vehicle: ReminderVehicle) {
  return vehicle.name ? `${vehicle.unit_number} - ${vehicle.name}` : vehicle.unit_number;
}

function utcDateLabel(now: Date) {
  return new Intl.DateTimeFormat("en", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(now);
}

function managerRecipients(users: ReminderUser[], excludeUserId: string | null) {
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

function baseNotification(input: {
  body: string;
  createdAt: string;
  recipientType: string;
  tenantId: string;
  title: string;
  user: ReminderUser;
}): ReminderNotification {
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

export function buildDailyInspectionReminders({
  createdAt,
  inspections,
  now = new Date(),
  tenantId,
  users,
  vehicles,
}: {
  createdAt: string;
  inspections: ReminderInspection[];
  now?: Date;
  tenantId: string;
  users: ReminderUser[];
  vehicles: ReminderVehicle[];
}): ReminderNotification[] {
  const fleet = buildFleetInspectionStatus(
    vehicles.map((vehicle) => vehicle.id),
    inspections,
    now.getTime(),
  );
  const vehicleById = new Map(vehicles.map((vehicle) => [vehicle.id, vehicle]));
  const userById = new Map(users.map((user) => [user.id, user]));
  const dateLabel = utcDateLabel(now);
  const notifications: ReminderNotification[] = [];

  for (const row of fleet) {
    if (row.status === "valid") {
      continue;
    }

    const vehicle = vehicleById.get(row.equipmentId);
    if (!vehicle) {
      continue;
    }

    const label = vehicleLabel(vehicle);
    const assignedUser = vehicle.assigned_to ? userById.get(vehicle.assigned_to) : null;

    const title =
      row.status === "out_of_service"
        ? `Vehicle out of service: ${label}`
        : `Trip inspection due: ${label}`;
    const body =
      row.status === "out_of_service"
        ? `${label} is out of service from a major defect as of ${dateLabel}. It must not be driven until repaired and returned to service.`
        : `No daily trip inspection has been logged for ${label} as of ${dateLabel}. A trip inspection is required every 24 hours before the vehicle is driven.`;

    const recipients = [
      ...(assignedUser?.active ? [{ recipientType: "daily_inspection_driver", user: assignedUser }] : []),
      ...managerRecipients(users, assignedUser?.id ?? null).map((user) => ({
        recipientType: "daily_inspection_manager",
        user,
      })),
    ];

    for (const recipient of recipients) {
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

  return notifications;
}

export async function sendDailyInspectionNotifications(
  tenantId: string,
  now = new Date(),
  client?: ReminderClient,
  options: {
    auditClient?: ReminderClient | null;
    auditSource?: ReminderAuditSource;
  } = {},
) {
  const supabase = client ?? (await createSupabaseServerClient());
  const createdAt = now.toISOString();
  const recentFloor = new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString();

  const [
    { data: vehicles, error: vehiclesError },
    { data: recentInspections, error: recentError },
    { data: oosInspections, error: oosError },
    { data: users, error: usersError },
  ] = await Promise.all([
    supabase
      .from("equipment")
      .select("id, unit_number, name, assigned_to")
      .eq("tenant_id", tenantId)
      .eq("status", "active")
      .is("deleted_at", null)
      .in("category", [...INSPECTABLE_EQUIPMENT_CATEGORIES])
      .returns<ReminderVehicle[]>(),
    supabase
      .from("dti_inspection")
      .select("id, equipment_id, completed_at, valid_until, out_of_service, out_of_service_cleared_at")
      .eq("tenant_id", tenantId)
      .gte("completed_at", recentFloor)
      .returns<ReminderInspection[]>(),
    supabase
      .from("dti_inspection")
      .select("id, equipment_id, completed_at, valid_until, out_of_service, out_of_service_cleared_at")
      .eq("tenant_id", tenantId)
      .eq("out_of_service", true)
      .is("out_of_service_cleared_at", null)
      .returns<ReminderInspection[]>(),
    supabase
      .from("users")
      .select("id, full_name, email, active, power_level, app_access")
      .eq("tenant_id", tenantId)
      .eq("active", true)
      .returns<ReminderUser[]>(),
  ]);

  const error =
    vehiclesError?.message ?? recentError?.message ?? oosError?.message ?? usersError?.message ?? null;

  if (error) {
    return { auditError: null, created: 0, error, skipped: 0 };
  }

  // Union the recent and out-of-service inspection sets, de-duplicated by id.
  const inspectionById = new Map<string, ReminderInspection>();
  for (const inspection of [...(recentInspections ?? []), ...(oosInspections ?? [])]) {
    inspectionById.set(inspection.id, inspection);
  }

  const candidates = buildDailyInspectionReminders({
    createdAt,
    inspections: [...inspectionById.values()],
    now,
    tenantId,
    users: users ?? [],
    vehicles: vehicles ?? [],
  });

  if (candidates.length === 0) {
    return { auditError: null, created: 0, error: null, skipped: 0 };
  }

  const titles = Array.from(new Set(candidates.map((notification) => notification.title ?? ""))).filter(Boolean);
  const { data: existing, error: existingError } =
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
    (existing ?? []).map((notification) => `${notification.user_id ?? ""}|${notification.title}|${notification.body}`),
  );
  const newNotifications = candidates.filter(
    (notification) => !existingKeys.has(`${notification.user_id ?? ""}|${notification.title}|${notification.body}`),
  );

  if (newNotifications.length === 0) {
    return { auditError: null, created: 0, error: null, skipped: candidates.length };
  }

  const { data: inserted, error: insertError } = await supabase
    .from("notifications")
    .insert(newNotifications)
    .select("body, created_at, delivery_status, id, recipient_name, recipient_type, title, user_id")
    .returns<ReminderNotificationAuditRow[]>();

  let auditError: string | null = null;

  if (!insertError && inserted && inserted.length > 0) {
    try {
      for (const notification of inserted) {
        await recordTenantAuditEvent(
          {
            action: "daily_inspection_reminder.notification.sent",
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
      auditError =
        auditException instanceof Error ? auditException.message : "Daily inspection reminder audit was not recorded.";
    }
  }

  return {
    created: insertError ? 0 : newNotifications.length,
    auditError,
    error: insertError?.message ?? null,
    skipped: candidates.length - newNotifications.length,
  };
}
