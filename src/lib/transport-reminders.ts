import { isPowerAtLeast } from "@/lib/access-control";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { recordTenantAuditEvent } from "@/lib/tenant-audit";
import {
  DRIVER_LICENSE_REMINDER_LEAD_DAYS,
  expiryTrackedRequirements,
  requirementLeadDays,
} from "@/lib/transport-registry";
import type { Database } from "@/types/database";

type TransportReminderClient = Pick<Awaited<ReturnType<typeof createSupabaseServerClient>>, "from">;
type TransportReminderNotification = Database["public"]["Tables"]["notifications"]["Insert"];
type TransportReminderNotificationAuditRow = Pick<
  Database["public"]["Tables"]["notifications"]["Row"],
  "body" | "created_at" | "delivery_status" | "id" | "recipient_name" | "recipient_type" | "title" | "user_id"
>;
type TransportReminderDriver = Pick<
  Database["public"]["Tables"]["transport_driver"]["Row"],
  "id" | "full_name" | "user_id" | "license_expiry"
>;
type TransportReminderDocument = Pick<
  Database["public"]["Tables"]["transport_document"]["Row"],
  "id" | "registry_key" | "slot_key" | "subject_id" | "title" | "expiry_date" | "status"
>;
type TransportReminderUser = Pick<
  Database["public"]["Tables"]["users"]["Row"],
  "active" | "app_access" | "email" | "full_name" | "id" | "power_level"
>;
type TransportReminderAuditSource = "cron" | "page";

export type TransportExpiryStage = "current" | "due_soon" | "expired";

// The carrier Safety Fitness Certificate opens a 45-day renewal window.
export const SAFETY_FITNESS_REMINDER_LEAD_DAYS = 45;

function dateOnlyUtc(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const parsed = Date.parse(`${value.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(parsed) ? null : parsed;
}

function todayUtc(now: Date): number {
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

/** Days until expiry (negative if already past), or null when no date. */
export function daysUntilExpiry(expiryDate: string | null, now: Date): number | null {
  const expiry = dateOnlyUtc(expiryDate);

  if (expiry === null) {
    return null;
  }

  return Math.floor((expiry - todayUtc(now)) / 86_400_000);
}

/** Classify an expiry date against a lead window. */
export function transportExpiryStage(expiryDate: string | null, leadDays: number, now: Date): TransportExpiryStage {
  const days = daysUntilExpiry(expiryDate, now);

  if (days === null) {
    return "current";
  }

  if (days < 0) {
    return "expired";
  }

  return days <= leadDays ? "due_soon" : "current";
}

function dateInputValue(value: Date) {
  const year = value.getUTCFullYear();
  const month = String(value.getUTCMonth() + 1).padStart(2, "0");
  const day = String(value.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function displayName(user: Pick<TransportReminderUser, "email" | "full_name"> | null | undefined) {
  return user?.full_name?.trim() || user?.email || "Worker";
}

function formatReminderDate(value: string | null) {
  if (!value) {
    return "no date";
  }

  return new Intl.DateTimeFormat("en", { day: "2-digit", month: "short", year: "numeric" }).format(
    new Date(`${value.slice(0, 10)}T00:00:00`),
  );
}

function managerRecipients(users: TransportReminderUser[], excludeUserId: string | null) {
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
  driver: TransportReminderDriver;
  users: TransportReminderUser[];
}): { recipientType: string; user: TransportReminderUser }[] {
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
  user: TransportReminderUser;
}): TransportReminderNotification {
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

export function buildTransportExpiryNotifications({
  createdAt,
  documents,
  drivers,
  now = new Date(),
  safetyFitnessExpiresOn = null,
  tenantId,
  users,
}: {
  createdAt: string;
  documents: TransportReminderDocument[];
  drivers: TransportReminderDriver[];
  now?: Date;
  safetyFitnessExpiresOn?: string | null;
  tenantId: string;
  users: TransportReminderUser[];
}) {
  const driverById = new Map(drivers.map((driver) => [driver.id, driver]));
  const expiryTrackedKeys = new Set(
    expiryTrackedRequirements().map((requirement) => `${requirement.registryKey}::${requirement.slotKey}`),
  );
  const notifications: TransportReminderNotification[] = [];

  // Driver licence expiry.
  for (const driver of drivers) {
    const stage = transportExpiryStage(driver.license_expiry, DRIVER_LICENSE_REMINDER_LEAD_DAYS, now);

    if (stage === "current") {
      continue;
    }

    const titlePrefix = stage === "expired" ? "Driver licence expired" : "Driver licence expiring";
    const reference = `expires ${formatReminderDate(driver.license_expiry)}`;
    const body =
      stage === "expired"
        ? `${driver.full_name}'s driver licence ${reference}. Confirm a valid licence before they operate.`
        : `${driver.full_name}'s driver licence ${reference}. Request a renewal before it lapses.`;

    for (const recipient of recipientsForDriver({ driver, users })) {
      notifications.push(
        baseNotification({
          body,
          createdAt,
          recipientType: recipient.recipientType,
          tenantId,
          title: `${titlePrefix}: ${driver.full_name}`,
          user: recipient.user,
        }),
      );
    }
  }

  // Expiry-tracked driver documents (abstract, medical).
  for (const document of documents) {
    if (document.status !== "active" || !document.subject_id) {
      continue;
    }

    if (!expiryTrackedKeys.has(`${document.registry_key}::${document.slot_key}`)) {
      continue;
    }

    const driver = driverById.get(document.subject_id);

    if (!driver) {
      continue;
    }

    const leadDays = requirementLeadDays(document.registry_key, document.slot_key);
    const stage = transportExpiryStage(document.expiry_date, leadDays, now);

    if (stage === "current") {
      continue;
    }

    const titlePrefix = stage === "expired" ? "Driver document expired" : "Driver document expiring";
    const reference = `expires ${formatReminderDate(document.expiry_date)}`;
    const body =
      stage === "expired"
        ? `${driver.full_name} has an expired document: ${document.title} ${reference}. Renew or replace it.`
        : `${driver.full_name} has a document coming due: ${document.title} ${reference}. Renew it before it expires.`;

    for (const recipient of recipientsForDriver({ driver, users })) {
      notifications.push(
        baseNotification({
          body,
          createdAt,
          recipientType: recipient.recipientType,
          tenantId,
          title: `${titlePrefix}: ${driver.full_name}, ${document.title}`,
          user: recipient.user,
        }),
      );
    }
  }

  // Carrier Safety Fitness Certificate (company-level, managers only).
  const sfcStage = transportExpiryStage(safetyFitnessExpiresOn, SAFETY_FITNESS_REMINDER_LEAD_DAYS, now);

  if (sfcStage !== "current") {
    const reference = `expires ${formatReminderDate(safetyFitnessExpiresOn)}`;
    const body =
      sfcStage === "expired"
        ? `The carrier Safety Fitness Certificate ${reference}. Renew it immediately; a current certificate must be carried in every NSC vehicle.`
        : `The carrier Safety Fitness Certificate ${reference}. Complete the renewal and fee before it lapses.`;
    const title = sfcStage === "expired" ? "Safety Fitness Certificate expired" : "Safety Fitness Certificate expiring";

    for (const user of managerRecipients(users, null)) {
      notifications.push(
        baseNotification({
          body,
          createdAt,
          recipientType: "transport_manager",
          tenantId,
          title,
          user,
        }),
      );
    }
  }

  return notifications;
}

export async function sendTransportExpiryNotifications(
  tenantId: string,
  now = new Date(),
  client?: TransportReminderClient,
  options: {
    auditClient?: TransportReminderClient | null;
    auditSource?: TransportReminderAuditSource;
  } = {},
) {
  const supabase = client ?? (await createSupabaseServerClient());
  const createdAt = now.toISOString();
  // Widest lead across licence + expiry-tracked slots bounds the document query.
  const maxLeadDays = Math.max(
    DRIVER_LICENSE_REMINDER_LEAD_DAYS,
    ...expiryTrackedRequirements().map((requirement) => requirement.reminderLeadDays ?? DRIVER_LICENSE_REMINDER_LEAD_DAYS),
  );
  const horizon = dateInputValue(new Date(todayUtc(now) + maxLeadDays * 86_400_000));

  const [{ data: tenant, error: tenantError }, { data: drivers, error: driversError }, { data: documents, error: documentsError }, { data: users, error: usersError }] =
    await Promise.all([
      supabase
        .from("tenants")
        .select("safety_fitness_expires_on")
        .eq("id", tenantId)
        .maybeSingle<{ safety_fitness_expires_on: string | null }>(),
      supabase
        .from("transport_driver")
        .select("id, full_name, user_id, license_expiry")
        .eq("tenant_id", tenantId)
        .is("deleted_at", null)
        .returns<TransportReminderDriver[]>(),
      supabase
        .from("transport_document")
        .select("id, registry_key, slot_key, subject_id, title, expiry_date, status")
        .eq("tenant_id", tenantId)
        .eq("scope", "driver")
        .eq("status", "active")
        .is("deleted_at", null)
        .not("expiry_date", "is", null)
        .lte("expiry_date", horizon)
        .returns<TransportReminderDocument[]>(),
      supabase
        .from("users")
        .select("id, full_name, email, active, power_level, app_access")
        .eq("tenant_id", tenantId)
        .eq("active", true)
        .returns<TransportReminderUser[]>(),
    ]);

  const error = tenantError?.message ?? driversError?.message ?? documentsError?.message ?? usersError?.message ?? null;

  if (error) {
    return { auditError: null, created: 0, error, skipped: 0 };
  }

  const candidateNotifications = buildTransportExpiryNotifications({
    createdAt,
    documents: documents ?? [],
    drivers: drivers ?? [],
    now,
    safetyFitnessExpiresOn: tenant?.safety_fitness_expires_on ?? null,
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
    .returns<TransportReminderNotificationAuditRow[]>();

  let auditError: string | null = null;

  if (!insertError && insertedNotifications && insertedNotifications.length > 0) {
    try {
      for (const notification of insertedNotifications) {
        await recordTenantAuditEvent(
          {
            action: "transport_reminder.notification.sent",
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
      auditError = auditException instanceof Error ? auditException.message : "Transport reminder audit was not recorded.";
    }
  }

  return {
    created: insertError ? 0 : newNotifications.length,
    auditError,
    error: insertError?.message ?? null,
    skipped: candidateNotifications.length - newNotifications.length,
  };
}
