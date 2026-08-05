// Warnings before a hired carrier's paperwork runs out.
//
// The date arithmetic is deliberately separated from everything that touches the
// database, because "did an email go out thirty days before a date" is the one thing in
// this module that cannot be checked by clicking. The pure half below is unit tested
// against fixed clocks; the half that reads and writes is a thin caller.
//
// Deduplication follows the four reminder modules already here: a notification is keyed
// by recipient, title, and body, and anything already sent with the same three is
// skipped. The stage and the due date are both encoded in the text, so a carrier moving
// from the first warning to the final one produces a genuinely different message and a
// carrier sitting still produces the same one, which is what stops a daily cron from
// becoming a daily nuisance.

import { isPowerAtLeast } from "@/lib/access-control";
import {
  resolveSubcontractorSlots,
  type ResolvedSubcontractorSlot,
  type SubcontractorRequirementSetting,
} from "@/lib/subcontractor-requirements";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { recordTenantAuditEvent } from "@/lib/tenant-audit";
import type { Database } from "@/types/database";

type ReminderClient = Pick<Awaited<ReturnType<typeof createSupabaseServerClient>>, "from">;
type ReminderAuditSource = "cron" | "page";

type ReminderNotification = Database["public"]["Tables"]["notifications"]["Insert"];
type ReminderUser = Pick<
  Database["public"]["Tables"]["users"]["Row"],
  "active" | "email" | "full_name" | "id" | "power_level"
>;
type ReminderSubcontractor = Pick<
  Database["public"]["Tables"]["subcontractor"]["Row"],
  "id" | "legal_name" | "contact_name" | "broker_name"
>;
type ReminderDocument = Pick<
  Database["public"]["Tables"]["subcontractor_document"]["Row"],
  "due_date" | "id" | "review_status" | "slot_key" | "subcontractor_id" | "superseded_by_id"
>;
type ReminderSettingRow = Database["public"]["Tables"]["subcontractor_requirement_setting"]["Row"];
type ReminderNotificationAuditRow = Pick<
  Database["public"]["Tables"]["notifications"]["Row"],
  "created_at" | "delivery_status" | "id" | "recipient_name" | "recipient_type" | "title" | "user_id"
>;

/**
 * How urgent this is.
 *
 * `lead`   first time inside the company's configured warning window.
 * `final`  a week or less, or the whole window if it is shorter than a week.
 * `lapsed` past due. The carrier is non-compliant from this point.
 */
export type SubcontractorReminderStage = "lead" | "final" | "lapsed";

export const SUBCONTRACTOR_FINAL_WARNING_DAYS = 7;

export function daysUntilDue(dueDate: string | null, now: Date): number | null {
  if (!dueDate || !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
    return null;
  }

  const due = Date.parse(`${dueDate}T00:00:00.000Z`);

  if (Number.isNaN(due)) {
    return null;
  }

  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.floor((due - today) / 86_400_000);
}

/**
 * Which warning, if any, this document is due for today.
 *
 * Returns null outside the window, which is the common case and the reason the cron does
 * not send anything most days.
 */
export function subcontractorReminderStage(
  dueDate: string | null,
  leadDays: number,
  now: Date,
): SubcontractorReminderStage | null {
  const days = daysUntilDue(dueDate, now);

  if (days === null) {
    return null;
  }

  if (days < 0) {
    return "lapsed";
  }

  // A company that only wants three days of warning should not get a "final" notice
  // seven days out that its own settings say is premature.
  if (days <= Math.min(SUBCONTRACTOR_FINAL_WARNING_DAYS, leadDays)) {
    return "final";
  }

  return days <= leadDays ? "lead" : null;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", { day: "2-digit", month: "short", year: "numeric" }).format(
    new Date(`${value}T00:00:00`),
  );
}

export function subcontractorReminderTitle(stage: SubcontractorReminderStage, carrierName: string) {
  if (stage === "lapsed") {
    return `${carrierName} is non-compliant`;
  }

  return stage === "final" ? `${carrierName} expires within a week` : `${carrierName} has paperwork expiring`;
}

export function subcontractorReminderBody(input: {
  dueDate: string;
  days: number;
  slotLabel: string;
  stage: SubcontractorReminderStage;
}) {
  if (input.stage === "lapsed") {
    const overdue = Math.abs(input.days);
    return `${input.slotLabel} lapsed on ${formatDate(input.dueDate)} (${overdue} ${overdue === 1 ? "day" : "days"} ago). They are not covered for work until it is replaced.`;
  }

  if (input.days === 0) {
    return `${input.slotLabel} is due today, ${formatDate(input.dueDate)}.`;
  }

  return `${input.slotLabel} is due on ${formatDate(input.dueDate)}, in ${input.days} ${input.days === 1 ? "day" : "days"}.`;
}

export type SubcontractorReminderCandidate = {
  body: string;
  carrierName: string;
  dueDate: string;
  slotLabel: string;
  stage: SubcontractorReminderStage;
  subcontractorId: string;
  title: string;
};

/**
 * The pure core: given the live documents and the resolved slots, what needs saying.
 *
 * Only approved, un-superseded documents are considered. A pending upload is not cover,
 * and a superseded one has already been replaced, so warning about either would send the
 * company chasing something that is either not yet real or no longer their problem.
 */
export function buildSubcontractorReminderCandidates(input: {
  documents: ReminderDocument[];
  now: Date;
  slots: ResolvedSubcontractorSlot[];
  subcontractors: ReminderSubcontractor[];
}): SubcontractorReminderCandidate[] {
  const slotByKey = new Map(input.slots.map((slot) => [slot.key, slot]));
  const carrierById = new Map(input.subcontractors.map((carrier) => [carrier.id, carrier]));
  const candidates: SubcontractorReminderCandidate[] = [];

  for (const document of input.documents) {
    if (document.review_status !== "approved" || document.superseded_by_id !== null) {
      continue;
    }

    const slot = slotByKey.get(document.slot_key);
    const carrier = carrierById.get(document.subcontractor_id);

    if (!slot || !carrier || !document.due_date) {
      continue;
    }

    const stage = subcontractorReminderStage(document.due_date, slot.reminderLeadDays, input.now);

    if (!stage) {
      continue;
    }

    const days = daysUntilDue(document.due_date, input.now) ?? 0;

    candidates.push({
      body: subcontractorReminderBody({ days, dueDate: document.due_date, slotLabel: slot.label, stage }),
      carrierName: carrier.legal_name,
      dueDate: document.due_date,
      slotLabel: slot.label,
      stage,
      subcontractorId: carrier.id,
      title: subcontractorReminderTitle(stage, carrier.legal_name),
    });
  }

  return candidates;
}

/** Who hears about it: the people who can actually do something, not every worker. */
export function subcontractorReminderRecipients(users: ReminderUser[]) {
  return users.filter((user) => user.active && isPowerAtLeast(user.power_level, "admin"));
}

export function buildSubcontractorReminderNotifications(input: {
  candidates: SubcontractorReminderCandidate[];
  createdAt: string;
  tenantId: string;
  users: ReminderUser[];
}): ReminderNotification[] {
  const recipients = subcontractorReminderRecipients(input.users);
  const notifications: ReminderNotification[] = [];

  for (const candidate of input.candidates) {
    for (const recipient of recipients) {
      notifications.push({
        body: candidate.body,
        channel: "in_app",
        created_at: input.createdAt,
        delivery_status: "delivered",
        recipient_contact: recipient.email,
        recipient_name: recipient.full_name?.trim() || recipient.email,
        recipient_type: "user",
        tenant_id: input.tenantId,
        title: candidate.title,
        user_id: recipient.id,
      });
    }
  }

  return notifications;
}

/**
 * Read, decide, write. Same signature as the four reminder modules beside it, so the
 * cron route treats them all the same way.
 */
export async function sendSubcontractorExpiryNotifications(
  tenantId: string,
  now: Date,
  client?: ReminderClient,
  options: { auditClient?: ReminderClient | null; auditSource?: ReminderAuditSource } = {},
) {
  const supabase = client ?? (await createSupabaseServerClient());
  const createdAt = now.toISOString();

  const [{ data: subcontractors, error: carrierError }, { data: settings, error: settingError }] = await Promise.all([
    supabase
      .from("subcontractor")
      .select("id, legal_name, contact_name, broker_name")
      .eq("tenant_id", tenantId)
      .eq("active", true)
      .is("deleted_at", null)
      .returns<ReminderSubcontractor[]>(),
    supabase
      .from("subcontractor_requirement_setting")
      .select("slot_key, enabled, required, minimum_coverage_amount, reminder_lead_days, interval_months")
      .eq("tenant_id", tenantId)
      .returns<ReminderSettingRow[]>(),
  ]);

  if (carrierError || settingError) {
    return { auditError: null, created: 0, error: carrierError?.message ?? settingError?.message ?? null, skipped: 0 };
  }

  if (!subcontractors?.length) {
    return { auditError: null, created: 0, error: null, skipped: 0 };
  }

  const resolvedSettings: SubcontractorRequirementSetting[] = (settings ?? []).map((row) => ({
    enabled: row.enabled,
    intervalMonths: row.interval_months,
    minimumCoverageAmount: row.minimum_coverage_amount === null ? null : Number(row.minimum_coverage_amount),
    reminderLeadDays: row.reminder_lead_days,
    required: row.required,
    slotKey: row.slot_key,
  }));

  const { data: documents, error: documentError } = await supabase
    .from("subcontractor_document")
    .select("id, subcontractor_id, slot_key, due_date, review_status, superseded_by_id")
    .eq("tenant_id", tenantId)
    .is("deleted_at", null)
    .not("due_date", "is", null)
    .limit(2000)
    .returns<ReminderDocument[]>();

  if (documentError) {
    return { auditError: null, created: 0, error: documentError.message, skipped: 0 };
  }

  const candidates = buildSubcontractorReminderCandidates({
    documents: documents ?? [],
    now,
    slots: resolveSubcontractorSlots(resolvedSettings),
    subcontractors,
  });

  if (candidates.length === 0) {
    return { auditError: null, created: 0, error: null, skipped: 0 };
  }

  const { data: users, error: userError } = await supabase
    .from("users")
    .select("id, full_name, email, active, power_level")
    .eq("tenant_id", tenantId)
    .eq("active", true)
    .returns<ReminderUser[]>();

  if (userError) {
    return { auditError: null, created: 0, error: userError.message, skipped: 0 };
  }

  const candidateNotifications = buildSubcontractorReminderNotifications({
    candidates,
    createdAt,
    tenantId,
    users: users ?? [],
  });

  if (candidateNotifications.length === 0) {
    return { auditError: null, created: 0, error: null, skipped: 0 };
  }

  const titles = Array.from(new Set(candidateNotifications.map((notification) => notification.title ?? ""))).filter(
    Boolean,
  );
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
    (existingNotifications ?? []).map(
      (notification) => `${notification.user_id ?? ""}|${notification.title}|${notification.body}`,
    ),
  );
  const newNotifications = candidateNotifications.filter(
    (notification) => !existingKeys.has(`${notification.user_id ?? ""}|${notification.title}|${notification.body}`),
  );

  if (newNotifications.length === 0) {
    return { auditError: null, created: 0, error: null, skipped: candidateNotifications.length };
  }

  const { data: inserted, error: insertError } = await supabase
    .from("notifications")
    .insert(newNotifications)
    .select("created_at, delivery_status, id, recipient_name, recipient_type, title, user_id")
    .returns<ReminderNotificationAuditRow[]>();

  let auditError: string | null = null;

  if (!insertError && inserted && inserted.length > 0) {
    try {
      for (const notification of inserted) {
        await recordTenantAuditEvent(
          {
            action: "subcontractor_reminder.notification.sent",
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
      auditError = error instanceof Error ? error.message : "Subcontractor reminder audit was not recorded.";
    }
  }

  return {
    auditError,
    created: insertError ? 0 : newNotifications.length,
    error: insertError?.message ?? null,
    skipped: candidateNotifications.length - newNotifications.length,
  };
}
