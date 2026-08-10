import { isPowerAtLeast } from "@/lib/access-control";
import {
  certificationTypeNameMap,
  coerceEquipmentIntervalMode,
  formatEquipmentMeter,
  getEquipmentDocumentStatus,
  getEquipmentScheduleStatus,
  unitCertificationLabel,
} from "@/lib/equipment";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { recordTenantAuditEvent } from "@/lib/tenant-audit";
import type { Database } from "@/types/database";

type EquipmentReminderClient = Pick<Awaited<ReturnType<typeof createSupabaseServerClient>>, "from">;
type EquipmentReminderNotification = Database["public"]["Tables"]["notifications"]["Insert"];
type EquipmentReminderNotificationAuditRow = Pick<
  Database["public"]["Tables"]["notifications"]["Row"],
  "body" | "created_at" | "delivery_status" | "id" | "recipient_name" | "recipient_type" | "title" | "user_id"
>;
type EquipmentReminderEquipment = Pick<
  Database["public"]["Tables"]["equipment"]["Row"],
  "assigned_to" | "current_meter" | "deleted_at" | "id" | "name" | "status" | "tracking_mode" | "unit_number"
>;
type EquipmentReminderService = Pick<
  Database["public"]["Tables"]["equipment_scheduled_service"]["Row"],
  | "due_date"
  | "due_meter"
  | "window_start_meter"
  | "warn_meter"
  | "date_lead_days"
  | "meter_lead"
  | "equipment_id"
  | "id"
  | "interval_mode"
  | "is_active"
  | "title"
>;
type EquipmentReminderDocument = Pick<
  Database["public"]["Tables"]["equipment_document"]["Row"],
  "certification_type_id" | "equipment_id" | "expiry_date" | "id" | "is_active" | "reminder_lead_days" | "title"
>;
type EquipmentReminderUser = Pick<
  Database["public"]["Tables"]["users"]["Row"],
  "active" | "app_access" | "email" | "full_name" | "id" | "power_level"
>;
type EquipmentReminderAuditSource = "cron" | "page";

function dateInputValue(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(value: Date, days: number) {
  const copy = new Date(value);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function displayName(user: Pick<EquipmentReminderUser, "email" | "full_name"> | null | undefined) {
  return user?.full_name?.trim() || user?.email || "Worker";
}

function formatReminderDate(value: string | null) {
  if (!value) {
    return "no due date";
  }

  return new Intl.DateTimeFormat("en", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(`${value.slice(0, 10)}T00:00:00`));
}

function equipmentName(equipment: EquipmentReminderEquipment) {
  return `${equipment.unit_number}${equipment.name ? `, ${equipment.name}` : ""}`;
}

function managerRecipients(users: EquipmentReminderUser[], assignedUserId: string | null) {
  return users.filter((user) => {
    if (!user.active || user.id === assignedUserId) {
      return false;
    }

    return (
      isPowerAtLeast(user.power_level, "manager") ||
      user.app_access === "admin_access" ||
      user.app_access === "super_admin_access"
    );
  });
}

function recipientsForEquipment(input: { equipment: EquipmentReminderEquipment; users: EquipmentReminderUser[] }) {
  const userById = new Map(input.users.map((user) => [user.id, user]));
  const assignedWorker = input.equipment.assigned_to ? userById.get(input.equipment.assigned_to) : null;
  const recipients = [
    ...(assignedWorker?.active ? [{ recipientType: "equipment_assignee", user: assignedWorker }] : []),
    ...managerRecipients(input.users, assignedWorker?.id ?? null).map((user) => ({
      recipientType: "equipment_manager",
      user,
    })),
  ];

  return recipients;
}

function serviceDueReference(service: EquipmentReminderService, equipment: EquipmentReminderEquipment) {
  const intervalMode = coerceEquipmentIntervalMode(service.interval_mode);
  const parts: string[] = [];

  if ((intervalMode === "by_date" || intervalMode === "both") && service.due_date) {
    parts.push(`due on ${formatReminderDate(service.due_date)}`);
  }

  if ((intervalMode === "by_meter" || intervalMode === "both") && service.due_meter !== null) {
    parts.push(`due at ${formatEquipmentMeter({ trackingMode: equipment.tracking_mode, value: service.due_meter })}`);
  }

  return parts.join(" and ") || "due now";
}

function documentDueReference(document: EquipmentReminderDocument) {
  return `expires on ${formatReminderDate(document.expiry_date)}`;
}

function baseNotification(input: {
  body: string;
  createdAt: string;
  recipientType: string;
  tenantId: string;
  title: string;
  user: EquipmentReminderUser;
}): EquipmentReminderNotification {
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

export function buildEquipmentAttentionNotifications({
  certificationTypeNames = new Map<string, string>(),
  createdAt,
  documents,
  equipment,
  now = new Date(),
  scheduledServices,
  tenantId,
  users,
}: {
  /**
   * The tenant's certification type list, id to name. A certification document is
   * named from this rather than from the title frozen in at upload, so renaming a
   * type renames it in every reminder that goes out afterwards. Defaults to empty,
   * which simply falls back to the stored title.
   */
  certificationTypeNames?: ReadonlyMap<string, string>;
  createdAt: string;
  documents: EquipmentReminderDocument[];
  equipment: EquipmentReminderEquipment[];
  now?: Date;
  scheduledServices: EquipmentReminderService[];
  tenantId: string;
  users: EquipmentReminderUser[];
}) {
  const equipmentById = new Map(equipment.filter((unit) => !unit.deleted_at).map((unit) => [unit.id, unit]));
  const notifications: EquipmentReminderNotification[] = [];

  for (const service of scheduledServices) {
    const unit = equipmentById.get(service.equipment_id);

    if (!unit) {
      continue;
    }

    const status = getEquipmentScheduleStatus(
      {
        dueDate: service.due_date,
        dueMeter: service.due_meter,
        windowStartMeter: service.window_start_meter,
        warnMeter: service.warn_meter,
        dateLeadDays: service.date_lead_days,
        meterLead: service.meter_lead,
        intervalMode: service.interval_mode,
        isActive: service.is_active,
      },
      unit.current_meter,
      now,
    );

    if (status.state === "current") {
      continue;
    }

    const titlePrefix = status.state === "overdue" ? "Equipment service overdue" : "Equipment service due soon";
    const dueReference = serviceDueReference(service, unit);
    const body =
      status.state === "overdue"
        ? `${equipmentName(unit)} has overdue service: ${service.title} is ${dueReference}. Review and complete the scheduled service.`
        : `${equipmentName(unit)} has upcoming service: ${service.title} is ${dueReference}. Plan the work before it becomes overdue.`;

    for (const recipient of recipientsForEquipment({ equipment: unit, users })) {
      notifications.push(
        baseNotification({
          body,
          createdAt,
          recipientType: recipient.recipientType,
          tenantId,
          title: `${titlePrefix}: ${service.title}`,
          user: recipient.user,
        }),
      );
    }
  }

  for (const document of documents) {
    const unit = equipmentById.get(document.equipment_id);

    if (!unit) {
      continue;
    }

    const status = getEquipmentDocumentStatus(
      {
        expiryDate: document.expiry_date,
        isActive: document.is_active,
        reminderLeadDays: document.reminder_lead_days,
      },
      now,
    );

    if (status.state === "current") {
      continue;
    }

    // A certification is named from the tenant's live type list, so a reminder for a
    // renamed type reads with the new name. Anything else keeps the title it was filed
    // under, and a certification whose type has since been deleted falls back to it too.
    const documentName =
      unitCertificationLabel(
        { certificationTypeId: document.certification_type_id, title: document.title },
        certificationTypeNames,
      ) || document.title;
    const titlePrefix = status.state === "overdue" ? "Equipment document expired" : "Equipment document expiring";
    const dueReference = documentDueReference(document);
    const body =
      status.state === "overdue"
        ? `${equipmentName(unit)} has an expired document: ${documentName} ${dueReference}. Renew or replace this document.`
        : `${equipmentName(unit)} has a document coming due: ${documentName} ${dueReference}. Renew it before it expires.`;

    for (const recipient of recipientsForEquipment({ equipment: unit, users })) {
      notifications.push(
        baseNotification({
          body,
          createdAt,
          recipientType: recipient.recipientType,
          tenantId,
          title: `${titlePrefix}: ${documentName}`,
          user: recipient.user,
        }),
      );
    }
  }

  return notifications;
}

export async function sendEquipmentAttentionNotifications(
  tenantId: string,
  now = new Date(),
  client?: EquipmentReminderClient,
  options: {
    auditClient?: EquipmentReminderClient | null;
    auditSource?: EquipmentReminderAuditSource;
  } = {},
) {
  const supabase = client ?? (await createSupabaseServerClient());
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const createdAt = now.toISOString();
  const thirtyDaysFromNow = dateInputValue(addDays(today, 30));
  const [{ data: equipment, error: equipmentError }, { data: services, error: servicesError }, { data: documents, error: documentsError }, { data: users, error: usersError }, { data: certificationTypes }] =
    await Promise.all([
      supabase
        .from("equipment")
        .select("id, unit_number, name, status, tracking_mode, current_meter, assigned_to, deleted_at")
        .eq("tenant_id", tenantId)
        .is("deleted_at", null)
        .returns<EquipmentReminderEquipment[]>(),
      supabase
        .from("equipment_scheduled_service")
        .select("id, equipment_id, title, interval_mode, due_date, due_meter, window_start_meter, warn_meter, date_lead_days, meter_lead, is_active")
        .eq("tenant_id", tenantId)
        .eq("is_active", true)
        .is("deleted_at", null)
        .returns<EquipmentReminderService[]>(),
      supabase
        .from("equipment_document")
        .select("id, equipment_id, certification_type_id, title, expiry_date, reminder_lead_days, is_active")
        .eq("tenant_id", tenantId)
        .eq("is_active", true)
        .is("deleted_at", null)
        .lte("expiry_date", thirtyDaysFromNow)
        .returns<EquipmentReminderDocument[]>(),
      supabase
        .from("users")
        .select("id, full_name, email, active, power_level, app_access")
        .eq("tenant_id", tenantId)
        .eq("active", true)
        .returns<EquipmentReminderUser[]>(),
      // Read-only: this runs from cron, so it must not seed. A tenant whose list has
      // never been read simply gets titles instead of type names, never a write here.
      supabase
        .from("equipment_certification_types")
        .select("id, name")
        .eq("tenant_id", tenantId)
        .returns<{ id: string; name: string }[]>(),
    ]);

  const error = equipmentError?.message ?? servicesError?.message ?? documentsError?.message ?? usersError?.message ?? null;

  if (error) {
    return { auditError: null, created: 0, error, skipped: 0 };
  }

  const candidateNotifications = buildEquipmentAttentionNotifications({
    certificationTypeNames: certificationTypeNameMap(certificationTypes ?? []),
    createdAt,
    documents: documents ?? [],
    equipment: equipment ?? [],
    now,
    scheduledServices: services ?? [],
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
    .returns<EquipmentReminderNotificationAuditRow[]>();

  let auditError: string | null = null;

  if (!insertError && insertedNotifications && insertedNotifications.length > 0) {
    try {
      for (const notification of insertedNotifications) {
        await recordTenantAuditEvent(
          {
            action: "equipment_reminder.notification.sent",
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
    } catch (error) {
      auditError = error instanceof Error ? error.message : "Equipment reminder audit was not recorded.";
    }
  }

  return {
    created: insertError ? 0 : newNotifications.length,
    auditError,
    error: insertError?.message ?? null,
    skipped: candidateNotifications.length - newNotifications.length,
  };
}
