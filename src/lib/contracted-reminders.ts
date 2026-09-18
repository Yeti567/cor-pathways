// Reminders for the contracted units and drivers.
//
// The same shape as equipment-reminders.ts, with one difference that decides the whole
// design: there is nobody on the other end to chase.
//
// A contracted unit's certificate belongs to another company, and that company holds no
// login here. So every reminder goes to the people who do the chasing, and it names the
// carrier, because "unit 7710's CVIP expires in nine days" is unactionable until you know
// whose truck it is and who to phone. That is also why the carrier's own contact details
// live on the subcontractor record: the reminder points at the file that has them.
//
// The ageing rules are not reimplemented here. getEquipmentDocumentStatus decides due and
// overdue for units, and certificationStatus does it for driver tickets, exactly as they
// do everywhere else.

import { isPowerAtLeast } from "@/lib/access-control";
import { getEquipmentDocumentStatus } from "@/lib/equipment";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { recordTenantAuditEvent } from "@/lib/tenant-audit";
import { daysUntilCertificationExpiry } from "@/lib/workers";
import { existingNotificationKeys, notificationKey } from "@/lib/notification-dedupe";
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
type ReminderAuditSource = "cron" | "page";

export type ContractedReminderCarrier = { id: string; legal_name: string };
export type ContractedReminderUnit = Pick<
  Database["public"]["Tables"]["contracted_equipment"]["Row"],
  "id" | "subcontractor_id" | "unit_number" | "status"
>;
export type ContractedReminderDocument = Pick<
  Database["public"]["Tables"]["contracted_equipment_document"]["Row"],
  "id" | "contracted_equipment_id" | "title" | "expiry_date" | "reminder_lead_days" | "is_active"
>;
export type ContractedReminderDriver = Pick<
  Database["public"]["Tables"]["contracted_driver"]["Row"],
  "id" | "subcontractor_id" | "full_name" | "license_expiry" | "status"
>;
export type ContractedReminderCertification = Pick<
  Database["public"]["Tables"]["contracted_driver_certification"]["Row"],
  "id" | "contracted_driver_id" | "name" | "expires_on"
>;

/** The window a driver ticket or licence starts being chased in. */
export const CONTRACTED_TICKET_LEAD_DAYS = 30;

function formatReminderDate(value: string | null) {
  if (!value) {
    return "no expiry date";
  }

  return new Intl.DateTimeFormat("en", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(`${value.slice(0, 10)}T00:00:00`));
}

/**
 * Who hears about it.
 *
 * Managers and admins only. There is deliberately no assignee branch: a contracted unit
 * is not assigned to anybody here, and the carrier has no login, so inventing a recipient
 * would either notify the wrong person or nobody.
 */
function chaseRecipients(users: ReminderUser[]) {
  return users.filter(
    (user) =>
      user.active &&
      (isPowerAtLeast(user.power_level, "manager") ||
        user.app_access === "admin_access" ||
        user.app_access === "super_admin_access"),
  );
}

function notificationFor(input: {
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
    recipient_name: input.user.full_name?.trim() || input.user.email || "Manager",
    recipient_type: input.recipientType,
    tenant_id: input.tenantId,
    title: input.title,
    user_id: input.user.id,
  };
}

/**
 * Everything worth saying today about the contracted fleet and its drivers.
 *
 * Pure, so the wording and the thresholds are testable without a database. One
 * notification per recipient per finding; the caller de-duplicates against what has
 * already been sent.
 */
export function buildContractedAttentionNotifications(input: {
  carriers: readonly ContractedReminderCarrier[];
  certifications: readonly ContractedReminderCertification[];
  createdAt: string;
  documents: readonly ContractedReminderDocument[];
  drivers: readonly ContractedReminderDriver[];
  now: Date;
  tenantId: string;
  units: readonly ContractedReminderUnit[];
  users: readonly ReminderUser[];
}): ReminderNotification[] {
  const recipients = chaseRecipients([...input.users]);

  if (recipients.length === 0) {
    return [];
  }

  const carrierName = new Map(input.carriers.map((carrier) => [carrier.id, carrier.legal_name]));
  // Only units and drivers still running. A terminated contract is not a renewal anyone
  // is going to chase, and reminding about one is how a board becomes noise.
  const activeUnits = input.units.filter((unit) => unit.status === "active");
  const activeDrivers = input.drivers.filter((driver) => driver.status === "active");
  const unitById = new Map(activeUnits.map((unit) => [unit.id, unit]));
  const driverById = new Map(activeDrivers.map((driver) => [driver.id, driver]));

  // Only the newest record of each kind is chased. Everything behind it is history.
  //
  // This is the rule the whole reminders module turns on once a client loads their
  // renewal history rather than only what is current. Without it, a hose certificate
  // renewed every year since 2023 raises a fresh "expired" notification for each of the
  // old ones, every night, to every manager. The screens already collapse to the freshest
  // record, so a reminder for a superseded one would also be pointing at something the
  // app does not show as a problem.
  const freshestOnly = <T>(
    rows: readonly T[],
    keyOf: (row: T) => string,
    expiryOf: (row: T) => string | null,
  ): T[] => {
    const best = new Map<string, T>();

    for (const row of rows) {
      const key = keyOf(row);
      const current = best.get(key);

      if (!current || (expiryOf(row) ?? "") > (expiryOf(current) ?? "")) {
        best.set(key, row);
      }
    }

    return [...best.values()];
  };

  const notifications: ReminderNotification[] = [];

  const push = (title: string, body: string, recipientType: string) => {
    for (const user of recipients) {
      notifications.push(
        notificationFor({
          body,
          createdAt: input.createdAt,
          recipientType,
          tenantId: input.tenantId,
          title,
          user,
        }),
      );
    }
  };

  // --- Unit documents ---
  // Keyed on the unit plus the document's own title, which is what tells a primary hose
  // from a spare and a 20 lb extinguisher from a 10 lb one. Keying on the type alone
  // would let a current spare silence an overdue primary.
  const liveDocuments = freshestOnly(
    input.documents.filter((document) => document.is_active),
    (document) => `${document.contracted_equipment_id}|${document.title.trim().toLowerCase()}`,
    (document) => document.expiry_date,
  );

  for (const document of liveDocuments) {
    const unit = unitById.get(document.contracted_equipment_id);

    if (!unit || !document.is_active) {
      continue;
    }

    // A document with no expiry is never chased. Null means no expiry is tracked, not
    // that it lapsed, and treating it as overdue would raise a renewal that does not
    // exist. Its missing scan is the chase list's job, not this one's.
    if (!document.expiry_date) {
      continue;
    }

    const status = getEquipmentDocumentStatus(
      {
        expiryDate: document.expiry_date,
        isActive: document.is_active,
        reminderLeadDays: document.reminder_lead_days,
      },
      input.now,
    );

    if (status.state === "current") {
      continue;
    }

    const carrier = carrierName.get(unit.subcontractor_id) ?? "an unknown carrier";
    const overdue = status.state === "overdue";

    push(
      `${overdue ? "Expired" : "Expiring"}: ${document.title}, contracted unit ${unit.unit_number}`,
      `${document.title} on contracted unit ${unit.unit_number} (${carrier}) ${overdue ? "expired on" : "expires on"} ${formatReminderDate(document.expiry_date)}. Contact the carrier for the renewal.`,
      "contracted_equipment_manager",
    );
  }

  // --- Driver licences ---
  for (const driver of activeDrivers) {
    const days = daysUntilCertificationExpiry(driver.license_expiry, input.now);

    if (days === null || days > CONTRACTED_TICKET_LEAD_DAYS) {
      continue;
    }

    const carrier = carrierName.get(driver.subcontractor_id) ?? "an unknown carrier";

    push(
      `${days < 0 ? "Expired" : "Expiring"}: driver's licence, ${driver.full_name}`,
      `${driver.full_name} (${carrier}) has a driver's licence that ${days < 0 ? "expired on" : "expires on"} ${formatReminderDate(driver.license_expiry)}.`,
      "contracted_driver_manager",
    );
  }

  // --- Driver tickets ---
  const liveCertifications = freshestOnly(
    input.certifications,
    (certification) =>
      `${certification.contracted_driver_id}|${certification.name.trim().toLowerCase()}`,
    (certification) => certification.expires_on,
  );

  for (const certification of liveCertifications) {
    const driver = driverById.get(certification.contracted_driver_id);

    if (!driver) {
      continue;
    }

    const days = daysUntilCertificationExpiry(certification.expires_on, input.now);

    // Same rule as the unit documents: no expiry is not overdue.
    if (days === null || days > CONTRACTED_TICKET_LEAD_DAYS) {
      continue;
    }

    const carrier = carrierName.get(driver.subcontractor_id) ?? "an unknown carrier";

    push(
      `${days < 0 ? "Expired" : "Expiring"}: ${certification.name}, ${driver.full_name}`,
      `${driver.full_name} (${carrier}) holds ${certification.name} that ${days < 0 ? "expired on" : "expires on"} ${formatReminderDate(certification.expires_on)}.`,
      "contracted_driver_manager",
    );
  }

  return notifications;
}

/**
 * Read today's contracted findings and file the notifications nobody has had yet.
 *
 * De-duplicated on recipient plus title plus body, matching the equipment reminders, so a
 * page render and the nightly cron cannot both notify for the same expiry.
 */
export async function sendContractedAttentionNotifications(
  tenantId: string,
  now = new Date(),
  client?: ReminderClient,
  options: { auditClient?: ReminderClient | null; auditSource?: ReminderAuditSource } = {},
) {
  const supabase = client ?? (await createSupabaseServerClient());
  const createdAt = now.toISOString();

  const [
    { data: carriers, error: carriersError },
    { data: units, error: unitsError },
    { data: documents, error: documentsError },
    { data: drivers, error: driversError },
    { data: certifications, error: certificationsError },
    { data: users, error: usersError },
  ] = await Promise.all([
    supabase
      .from("subcontractor")
      .select("id, legal_name")
      .eq("tenant_id", tenantId)
      .is("deleted_at", null)
      .returns<ContractedReminderCarrier[]>(),
    supabase
      .from("contracted_equipment")
      .select("id, subcontractor_id, unit_number, status")
      .eq("tenant_id", tenantId)
      .is("deleted_at", null)
      .returns<ContractedReminderUnit[]>(),
    supabase
      .from("contracted_equipment_document")
      .select("id, contracted_equipment_id, title, expiry_date, reminder_lead_days, is_active")
      .eq("tenant_id", tenantId)
      .eq("is_active", true)
      .is("deleted_at", null)
      .not("expiry_date", "is", null)
      .returns<ContractedReminderDocument[]>(),
    supabase
      .from("contracted_driver")
      .select("id, subcontractor_id, full_name, license_expiry, status")
      .eq("tenant_id", tenantId)
      .is("deleted_at", null)
      .returns<ContractedReminderDriver[]>(),
    supabase
      .from("contracted_driver_certification")
      .select("id, contracted_driver_id, name, expires_on")
      .eq("tenant_id", tenantId)
      .not("expires_on", "is", null)
      .returns<ContractedReminderCertification[]>(),
    supabase
      .from("users")
      .select("id, full_name, email, active, power_level, app_access")
      .eq("tenant_id", tenantId)
      .eq("active", true)
      .returns<ReminderUser[]>(),
  ]);

  const error =
    carriersError?.message ??
    unitsError?.message ??
    documentsError?.message ??
    driversError?.message ??
    certificationsError?.message ??
    usersError?.message ??
    null;

  if (error) {
    return { auditError: null, created: 0, error, skipped: 0 };
  }

  const candidates = buildContractedAttentionNotifications({
    carriers: carriers ?? [],
    certifications: certifications ?? [],
    createdAt,
    documents: documents ?? [],
    drivers: drivers ?? [],
    now,
    tenantId,
    units: units ?? [],
    users: users ?? [],
  });

  if (candidates.length === 0) {
    return { auditError: null, created: 0, error: null, skipped: 0 };
  }

  const { error: existingError, keys: existingKeys } = await existingNotificationKeys(supabase, tenantId, candidates);

  if (existingError) {
    return { auditError: null, created: 0, error: existingError, skipped: 0 };
  }

  const fresh = candidates.filter((notification) => !existingKeys.has(notificationKey(notification)));

  if (fresh.length === 0) {
    return { auditError: null, created: 0, error: null, skipped: candidates.length };
  }

  const { data: inserted, error: insertError } = await supabase
    .from("notifications")
    .insert(fresh)
    .select("body, created_at, delivery_status, id, recipient_name, recipient_type, title, user_id")
    .returns<ReminderNotificationAuditRow[]>();

  let auditError: string | null = null;

  if (!insertError && inserted && inserted.length > 0) {
    try {
      for (const notification of inserted) {
        await recordTenantAuditEvent(
          {
            action: "contracted_reminder.notification.sent",
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
    } catch (auditFailure) {
      auditError =
        auditFailure instanceof Error ? auditFailure.message : "Contracted reminder audit was not recorded.";
    }
  }

  return {
    auditError,
    created: insertError ? 0 : fresh.length,
    error: insertError?.message ?? null,
    skipped: candidates.length - fresh.length,
  };
}
