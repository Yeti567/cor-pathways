import { isPowerAtLeast } from "@/lib/access-control";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { recordTenantAuditEvent } from "@/lib/tenant-audit";
import type { Database } from "@/types/database";
import { daysUntilCertificationExpiry } from "./workers";

type CertificationReminderStage = "thirty_day" | "fourteen_day" | "expired";
type CertificationReminderClient = Pick<Awaited<ReturnType<typeof createSupabaseServerClient>>, "from">;

type CertificationReminderCertification = Pick<
  Database["public"]["Tables"]["certifications"]["Row"],
  "expires_on" | "id" | "name" | "tenant_id" | "worker_profile_id"
>;
type CertificationReminderProfile = Pick<Database["public"]["Tables"]["worker_profiles"]["Row"], "id" | "title" | "user_id">;
type CertificationReminderUser = Pick<
  Database["public"]["Tables"]["users"]["Row"],
  "active" | "app_access" | "email" | "full_name" | "id" | "power_level"
>;
type CertificationReminderNotification = Database["public"]["Tables"]["notifications"]["Insert"];
type CertificationReminderNotificationAuditRow = Pick<
  Database["public"]["Tables"]["notifications"]["Row"],
  "body" | "created_at" | "delivery_status" | "id" | "recipient_name" | "recipient_type" | "title" | "user_id"
>;
type CertificationDeficiencyCertification = Pick<
  Database["public"]["Tables"]["certifications"]["Row"],
  "expires_on" | "id" | "name" | "worker_profile_id"
>;
type CertificationReminderAuditSource = "cron" | "page";

export type CertificationDeficiencySummary = {
  certificationId: string;
  daysExpired: number;
  expiresOn: string;
  name: string;
  workerName: string;
  workerUserId: string | null;
};

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

function formatReminderDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00`));
}

function displayName(user: Pick<CertificationReminderUser, "email" | "full_name"> | null | undefined) {
  return user?.full_name?.trim() || user?.email || "Worker";
}

function reminderStage(expiresOn: string | null, now: Date): CertificationReminderStage | null {
  const daysUntilExpiry = daysUntilCertificationExpiry(expiresOn, now);

  if (daysUntilExpiry === null) {
    return null;
  }

  if (daysUntilExpiry < 0) {
    return "expired";
  }

  if (daysUntilExpiry <= 14) {
    return "fourteen_day";
  }

  if (daysUntilExpiry <= 30) {
    return "thirty_day";
  }

  return null;
}

function managerRecipients(users: CertificationReminderUser[], workerId: string) {
  return users.filter((user) => {
    if (!user.active || user.id === workerId) {
      return false;
    }

    return (
      isPowerAtLeast(user.power_level, "manager") ||
      user.app_access === "admin_access" ||
      user.app_access === "super_admin_access"
    );
  });
}

function workerNotification(input: {
  certification: CertificationReminderCertification;
  createdAt: string;
  stage: CertificationReminderStage;
  tenantId: string;
  worker: CertificationReminderUser;
}) {
  const expiryDate = input.certification.expires_on ? formatReminderDate(input.certification.expires_on) : "its expiry date";
  const common = {
    channel: "in_app",
    created_at: input.createdAt,
    delivered_at: input.createdAt,
    delivery_status: "delivered",
    recipient_name: displayName(input.worker),
    recipient_type: "certification_worker",
    tenant_id: input.tenantId,
    user_id: input.worker.id,
  };

  if (input.stage === "expired") {
    return {
      ...common,
      body: `Your ${input.certification.name} certification expired on ${expiryDate} and is now a certification deficiency. Upload recertification as soon as possible.`,
      title: `Certification deficiency: ${input.certification.name}`,
    };
  }

  if (input.stage === "fourteen_day") {
    return {
      ...common,
      body: `Your ${input.certification.name} certification expires on ${expiryDate}. Recertification is required before it lapses.`,
      title: `Certification due in 14 days: ${input.certification.name}`,
    };
  }

  return {
    ...common,
    body: `Your ${input.certification.name} certification expires on ${expiryDate}. Please start recertification before it lapses.`,
    title: `Certification due in 30 days: ${input.certification.name}`,
  };
}

function managerNotification(input: {
  certification: CertificationReminderCertification;
  createdAt: string;
  manager: CertificationReminderUser;
  stage: Exclude<CertificationReminderStage, "thirty_day">;
  tenantId: string;
  worker: CertificationReminderUser;
}) {
  const expiryDate = input.certification.expires_on ? formatReminderDate(input.certification.expires_on) : "its expiry date";
  const workerName = displayName(input.worker);
  const common = {
    channel: "in_app",
    created_at: input.createdAt,
    delivered_at: input.createdAt,
    delivery_status: "delivered",
    recipient_name: displayName(input.manager),
    recipient_type: "certification_manager",
    tenant_id: input.tenantId,
    user_id: input.manager.id,
  };

  if (input.stage === "expired") {
    return {
      ...common,
      body: `${workerName}'s ${input.certification.name} certification expired on ${expiryDate} and is now a certification deficiency. Follow up and verify recertification.`,
      title: `Certification deficiency: ${input.certification.name}`,
    };
  }

  return {
    ...common,
    body: `${workerName}'s ${input.certification.name} certification expires on ${expiryDate}. Follow up to keep this worker current.`,
    title: `Certification due in 14 days: ${input.certification.name}`,
  };
}

export function buildCertificationReminderNotifications({
  certifications,
  createdAt,
  now = new Date(),
  profiles,
  tenantId,
  users,
}: {
  certifications: CertificationReminderCertification[];
  createdAt: string;
  now?: Date;
  profiles: CertificationReminderProfile[];
  tenantId: string;
  users: CertificationReminderUser[];
}) {
  const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
  const userById = new Map(users.map((user) => [user.id, user]));
  const notifications: CertificationReminderNotification[] = [];

  for (const certification of certifications) {
    const stage = reminderStage(certification.expires_on, now);
    const profile = profileById.get(certification.worker_profile_id);
    const worker = profile ? userById.get(profile.user_id) : null;

    if (!stage || !worker?.active) {
      continue;
    }

    notifications.push(
      workerNotification({
        certification,
        createdAt,
        stage,
        tenantId,
        worker,
      }),
    );

    if (stage === "thirty_day") {
      continue;
    }

    for (const manager of managerRecipients(users, worker.id)) {
      notifications.push(
        managerNotification({
          certification,
          createdAt,
          manager,
          stage,
          tenantId,
          worker,
        }),
      );
    }
  }

  return notifications;
}

export function buildCertificationDeficiencySummaries({
  certifications,
  now = new Date(),
  profiles,
  users,
}: {
  certifications: CertificationDeficiencyCertification[];
  now?: Date;
  profiles: CertificationReminderProfile[];
  users: Pick<CertificationReminderUser, "email" | "full_name" | "id">[];
}) {
  const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
  const userById = new Map(users.map((user) => [user.id, user]));

  return certifications
    .map((certification): CertificationDeficiencySummary | null => {
      const daysUntilExpiry = daysUntilCertificationExpiry(certification.expires_on, now);

      if (daysUntilExpiry === null || daysUntilExpiry >= 0 || !certification.expires_on) {
        return null;
      }

      const workerUserId = profileById.get(certification.worker_profile_id)?.user_id ?? null;
      const worker = workerUserId ? userById.get(workerUserId) : null;

      return {
        certificationId: certification.id,
        daysExpired: Math.abs(daysUntilExpiry),
        expiresOn: certification.expires_on,
        name: certification.name,
        workerName: displayName(worker),
        workerUserId,
      };
    })
    .filter((summary): summary is CertificationDeficiencySummary => Boolean(summary))
    .sort((left, right) => right.daysExpired - left.daysExpired || left.workerName.localeCompare(right.workerName));
}

export async function sendCertificationExpiryNotifications(
  tenantId: string,
  now = new Date(),
  client?: CertificationReminderClient,
  options: {
    auditClient?: CertificationReminderClient | null;
    auditSource?: CertificationReminderAuditSource;
  } = {},
) {
  const supabase = client ?? (await createSupabaseServerClient());
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const createdAt = now.toISOString();
  const thirtyDaysFromNow = dateInputValue(addDays(today, 30));
  const { data: certifications, error: certificationError } = await supabase
    .from("certifications")
    .select("id, tenant_id, worker_profile_id, name, expires_on")
    .eq("tenant_id", tenantId)
    .not("expires_on", "is", null)
    .lte("expires_on", thirtyDaysFromNow)
    .order("expires_on", { ascending: true })
    .limit(1000)
    .returns<CertificationReminderCertification[]>();

  if (certificationError || !certifications?.length) {
    return { auditError: null, created: 0, error: certificationError?.message ?? null, skipped: 0 };
  }

  const profileIds = Array.from(new Set(certifications.map((certification) => certification.worker_profile_id)));
  const [{ data: profiles, error: profileError }, { data: users, error: userError }] = await Promise.all([
    supabase
      .from("worker_profiles")
      .select("id, user_id, title")
      .eq("tenant_id", tenantId)
      .in("id", profileIds)
      .returns<CertificationReminderProfile[]>(),
    supabase
      .from("users")
      .select("id, full_name, email, active, power_level, app_access")
      .eq("tenant_id", tenantId)
      .eq("active", true)
      .returns<CertificationReminderUser[]>(),
  ]);

  if (profileError || userError) {
    return { auditError: null, created: 0, error: profileError?.message ?? userError?.message ?? null, skipped: 0 };
  }

  const candidateNotifications = buildCertificationReminderNotifications({
    certifications,
    createdAt,
    now,
    profiles: profiles ?? [],
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
    .returns<CertificationReminderNotificationAuditRow[]>();

  let auditError: string | null = null;

  if (!insertError && insertedNotifications && insertedNotifications.length > 0) {
    try {
      for (const notification of insertedNotifications) {
        await recordTenantAuditEvent(
          {
            action: "certification_reminder.notification.sent",
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
      auditError = error instanceof Error ? error.message : "Certification reminder audit was not recorded.";
    }
  }

  return {
    created: insertError ? 0 : newNotifications.length,
    auditError,
    error: insertError?.message ?? null,
    skipped: candidateNotifications.length - newNotifications.length,
  };
}
