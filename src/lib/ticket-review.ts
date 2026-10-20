// The office's check on tickets that workers add or renew from their phones.
//
// A worker's upload counts the moment it is saved (see migration
// certification_worker_review for why), and the database marks it
// 'awaiting_check' with the previous card and dates kept beside it. This module
// is everything the office side does with that mark: describe what changed,
// work out what Verify and Reject write, and send the daily summary email.

import type { SupabaseClient } from "@supabase/supabase-js";
import { isDemoTenant } from "@/lib/demo";
import { sendViaResend } from "@/lib/resend-relay";
import type { Database } from "@/types/database";

export const TICKET_CHECKS_PATH = "/admin/ticket-checks";

type CertificationRow = Database["public"]["Tables"]["certifications"]["Row"];
type CertificationUpdate = Database["public"]["Tables"]["certifications"]["Update"];
type UserRow = Database["public"]["Tables"]["users"]["Row"];

export type TicketReviewRow = Pick<
  CertificationRow,
  | "attachment_path"
  | "expires_on"
  | "id"
  | "issued_on"
  | "name"
  | "review_kind"
  | "review_previous_attachment_path"
  | "review_previous_expires_on"
  | "review_previous_issued_on"
  | "review_status"
  | "review_submitted_at"
  | "review_submitted_by"
  | "worker_profile_id"
>;

export const TICKET_REVIEW_SELECT =
  "id, name, issued_on, expires_on, attachment_path, worker_profile_id, review_status, review_kind, review_submitted_at, review_submitted_by, review_previous_attachment_path, review_previous_issued_on, review_previous_expires_on";

export type TicketChange = { after: string; before: string; label: string };

function dateLabel(value: string | null) {
  return value ? value.slice(0, 10) : "None";
}

/**
 * What the worker changed, in the words the office would use. A new ticket has
 * nothing to compare against, so it lists what was entered.
 */
export function describeTicketChange(row: TicketReviewRow): { changes: TicketChange[]; headline: string } {
  if (row.review_kind !== "renewal") {
    return {
      changes: [
        { after: dateLabel(row.issued_on), before: "", label: "Issued" },
        { after: dateLabel(row.expires_on), before: "", label: "Expires" },
      ],
      headline: "New ticket added",
    };
  }

  const changes: TicketChange[] = [];

  if (row.review_previous_expires_on !== row.expires_on) {
    changes.push({ after: dateLabel(row.expires_on), before: dateLabel(row.review_previous_expires_on), label: "Expires" });
  }

  if (row.review_previous_issued_on !== row.issued_on) {
    changes.push({ after: dateLabel(row.issued_on), before: dateLabel(row.review_previous_issued_on), label: "Issued" });
  }

  if (row.review_previous_attachment_path !== row.attachment_path) {
    changes.push({
      after: "New photo",
      before: row.review_previous_attachment_path ? "Old photo" : "No photo",
      label: "Card",
    });
  }

  return { changes, headline: changes.length > 0 ? "Ticket renewed" : "Ticket re-submitted with no changes" };
}

const CLEARED_REVIEW = {
  review_kind: null,
  review_previous_attachment_path: null,
  review_previous_expires_on: null,
  review_previous_issued_on: null,
} satisfies CertificationUpdate;

export function buildTicketVerifyUpdate(reviewerId: string, reviewedAt: string): CertificationUpdate {
  return {
    ...CLEARED_REVIEW,
    review_status: "verified",
    reviewed_at: reviewedAt,
    reviewed_by: reviewerId,
  };
}

/**
 * What Reject does. A ticket the worker added is removed: it never existed as
 * far as the office is concerned. A renewal goes back to the card and dates the
 * office last accepted. Either way the worker's uploaded file stays in storage
 * and its path stays in the audit log, as the record of what was turned down.
 */
export function buildTicketReject(
  row: TicketReviewRow,
  reviewerId: string,
  reviewedAt: string,
): { action: "delete" } | { action: "restore"; update: CertificationUpdate } {
  if (row.review_kind !== "renewal") {
    return { action: "delete" };
  }

  return {
    action: "restore",
    update: {
      ...CLEARED_REVIEW,
      attachment_path: row.review_previous_attachment_path,
      expires_on: row.review_previous_expires_on,
      issued_on: row.review_previous_issued_on,
      review_status: null,
      reviewed_at: reviewedAt,
      reviewed_by: reviewerId,
    },
  };
}

export function ticketRejectedNotice(ticketName: string, kind: TicketReviewRow["review_kind"], reason: string) {
  const outcome =
    kind === "renewal"
      ? `The office could not accept the new card for your ${ticketName} ticket, so your ticket is back to how it was before.`
      : `The office could not accept the ${ticketName} ticket you added, so it has been taken off your file.`;
  const why = reason.trim() ? ` Reason: ${reason.trim()}` : "";

  return {
    body: `${outcome}${why} Please upload it again or talk to the office.`,
    title: `Ticket not accepted: ${ticketName}`,
  };
}

// Who gets the daily summary. The company's own administrators: super admins and
// admins. Managers who were given the admin panel are left off so a crew lead is
// not emailed every morning about other crews' paperwork, and consultants are not
// company staff.
type DigestRecipientUser = Pick<UserRow, "active" | "email" | "full_name" | "id" | "power_level">;

export function ticketCheckDigestRecipients(users: DigestRecipientUser[]) {
  return users.filter(
    (user) =>
      user.active && Boolean(user.email?.trim()) && (user.power_level === "super_admin" || user.power_level === "admin"),
  );
}

export function buildTicketCheckDigestEmail(input: {
  appUrl: string;
  companyName: string;
  count: number;
  oldestSubmittedAt: string | null;
}) {
  const link = `${input.appUrl.replace(/\/$/, "")}${TICKET_CHECKS_PATH}`;
  const tickets = input.count === 1 ? "1 ticket" : `${input.count} tickets`;
  const oldest = input.oldestSubmittedAt ? input.oldestSubmittedAt.slice(0, 10) : null;
  const subject = `${tickets} to check - ${input.companyName}`;
  const lines = [
    `Employees added or renewed ${tickets} in the safety app that nobody in the office has looked at yet.`,
    "They already count as current. Please open each one, compare the photo of the card with the dates, and press Verify or Reject.",
    oldest ? `The oldest has been waiting since ${oldest}.` : null,
    `Open the list: ${link}`,
  ].filter((line): line is string => Boolean(line));
  const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const html = [
    ...lines.slice(0, -1).map((line) => `<p>${escape(line)}</p>`),
    `<p><a href="${escape(link)}">Open the list of tickets to check</a></p>`,
  ].join("\n");

  return { html, subject, text: lines.join("\n\n") };
}

// Same shape as the other reminder jobs, so the cron route can report it alongside them.
export type TicketCheckDigestResult = { auditError: string | null; created: number; error: string | null; skipped: number };

const DIGEST_RECIPIENT_TYPE = "ticket_check_admin";

function startOfUtcDay(now: Date) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
}

/**
 * Once a day, email each administrator how many tickets are waiting to be
 * checked. Nothing waiting, nothing sent. Each send is recorded in notifications
 * so a second run on the same day sends nothing more, and so a failure can be seen.
 *
 * Sent straight through Resend, the same way as password resets, rather than
 * through the Auto-Share relay: this is the app's own mail to the company's own
 * administrators, not a form report the company has chosen to share.
 */
export async function sendTicketCheckDigest(
  tenantId: string,
  now: Date,
  client: SupabaseClient<Database>,
  deps: { env?: NodeJS.ProcessEnv; fetchImpl?: typeof fetch; isDemoTenant?: typeof isDemoTenant } = {},
): Promise<TicketCheckDigestResult> {
  const env = deps.env ?? process.env;
  const checkDemoTenant = deps.isDemoTenant ?? isDemoTenant;

  const { data: waiting, error: waitingError } = await client
    .from("certifications")
    .select("review_submitted_at")
    .eq("tenant_id", tenantId)
    .eq("review_status", "awaiting_check")
    .order("review_submitted_at", { ascending: true })
    .returns<Pick<CertificationRow, "review_submitted_at">[]>();

  if (waitingError) {
    return { auditError: null, created: 0, error: waitingError.message, skipped: 0 };
  }

  if (!waiting || waiting.length === 0) {
    return { auditError: null, created: 0, error: null, skipped: 0 };
  }

  if (await checkDemoTenant(client, tenantId)) {
    return { auditError: null, created: 0, error: null, skipped: 0 };
  }

  const [{ data: users, error: usersError }, { data: tenant }, { data: sentToday, error: sentError }] = await Promise.all([
    client
      .from("users")
      .select("id, full_name, email, active, power_level")
      .eq("tenant_id", tenantId)
      .returns<DigestRecipientUser[]>(),
    client.from("tenants").select("name").eq("id", tenantId).maybeSingle<{ name: string }>(),
    client
      .from("notifications")
      .select("user_id")
      .eq("tenant_id", tenantId)
      .eq("recipient_type", DIGEST_RECIPIENT_TYPE)
      .gte("created_at", startOfUtcDay(now))
      .returns<{ user_id: string | null }[]>(),
  ]);

  if (usersError || sentError) {
    return { auditError: null, created: 0, error: (usersError ?? sentError)?.message ?? null, skipped: 0 };
  }

  const alreadySent = new Set((sentToday ?? []).map((row) => row.user_id));
  const recipients = ticketCheckDigestRecipients(users ?? []).filter((user) => !alreadySent.has(user.id));

  if (recipients.length === 0) {
    return { auditError: null, created: 0, error: null, skipped: 0 };
  }

  const from = env.EMAIL_DELIVERY_FROM?.trim();
  const apiKey = env.RESEND_API_KEY?.trim();
  const appUrl = env.NEXT_PUBLIC_APP_URL?.trim() || "http://127.0.0.1:3000";
  const replyTo = env.EMAIL_DELIVERY_REPLY_TO?.trim() || undefined;
  const message = buildTicketCheckDigestEmail({
    appUrl,
    companyName: tenant?.name ?? "Your company",
    count: waiting.length,
    oldestSubmittedAt: waiting[0]?.review_submitted_at ?? null,
  });
  let created = 0;
  let skipped = 0;

  for (const recipient of recipients) {
    const attemptedAt = new Date().toISOString();
    const result =
      from && apiKey
        ? await sendViaResend(
            { body: message.text, from, html: message.html, replyTo, subject: message.subject, to: recipient.email!.trim() },
            apiKey,
            deps.fetchImpl ?? fetch,
          )
        : { error: "Email is not set up on this deployment (EMAIL_DELIVERY_FROM or RESEND_API_KEY missing).", ok: false as const };

    const { error: insertError } = await client.from("notifications").insert({
      body: message.text,
      channel: "email",
      created_at: attemptedAt,
      delivered_at: result.ok ? attemptedAt : null,
      delivery_attempts: 1,
      delivery_error: result.ok ? null : result.error,
      delivery_status: result.ok ? "delivered" : "failed",
      failed_at: result.ok ? null : attemptedAt,
      last_delivery_attempt_at: attemptedAt,
      recipient_contact: recipient.email,
      recipient_name: recipient.full_name?.trim() || recipient.email,
      recipient_type: DIGEST_RECIPIENT_TYPE,
      tenant_id: tenantId,
      title: message.subject,
      user_id: recipient.id,
    });

    if (result.ok && !insertError) {
      created += 1;
    } else {
      skipped += 1;
    }
  }

  return { auditError: null, created, error: null, skipped };
}
