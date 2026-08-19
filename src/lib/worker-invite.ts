// Worker invitations, sent through our own Resend pipeline instead of Supabase's
// built-in mailer.
//
// Supabase's transactional email is rate-limited to a handful of messages per
// hour, so looping `auth.admin.inviteUserByEmail` over a roster (e.g. a 20-person
// CSV import) trips the limit almost immediately. Instead we use
// `auth.admin.generateLink({ type: 'invite' })`, which creates the user and
// returns the exact same action link WITHOUT sending an email, then deliver a
// branded invite through Resend. The downstream accept flow is unchanged because
// the link is identical to what Supabase would have emailed.

import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { APP_NAME } from "@/lib/brand";
import { isDemoTenant } from "@/lib/demo";
import { buildEmailConfirmationLink } from "@/lib/auth-email-link";
import { sendViaResend } from "@/lib/resend-relay";

type AdminClient = SupabaseClient<Database>;

export type WorkerInviteParams = {
  email: string;
  fullName: string;
  companyName: string;
  redirectTo: string;
  // The inviting admin's tenant. A demo tenant cannot invite: it would create an
  // auth user for an arbitrary email and send it a Resend email on the
  // deployment's account, which is exactly what the demo must not do.
  tenantId: string;
};

export type WorkerInviteResult =
  // The auth user exists (created and link generated). `emailWarning` is set when
  // the user was created but the invite email could not be delivered, so the
  // caller can still finish setting up the worker and surface a resend hint.
  | { ok: true; user: User; emailWarning: string | null }
  // The invite link itself could not be created; no user exists.
  | { ok: false; error: string };

export type WorkerInviteResendResult = { ok: true } | { ok: false; error: string };

export type WorkerInviteEmail = {
  subject: string;
  text: string;
  html: string;
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Builds the branded invite email. Pure and deterministic so it can be unit
 * tested without touching Supabase or Resend.
 */
export function buildWorkerInviteEmail(params: {
  fullName: string;
  companyName: string;
  actionLink: string;
}): WorkerInviteEmail {
  const firstName = params.fullName.trim().split(/\s+/)[0] || "there";
  const company = params.companyName.trim() || "Your company";
  const subject = `${company} has invited you to ${APP_NAME}`;

  const text = [
    `Hi ${firstName},`,
    "",
    `${company} has invited you to ${APP_NAME}. Click the link below to accept your invitation and set up your account:`,
    "",
    params.actionLink,
    "",
    "This link is single use and expires, and a newer invitation email replaces this one - always use the newest email from us. If you were not expecting this invitation, you can safely ignore it.",
    "",
    APP_NAME,
  ].join("\n");

  const safeFirstName = escapeHtml(firstName);
  const safeCompany = escapeHtml(company);
  const safeLink = escapeHtml(params.actionLink);

  const html = [
    '<div style="font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;color:#0f172a;">',
    `<p style="font-size:16px;">Hi ${safeFirstName},</p>`,
    `<p style="font-size:16px;line-height:1.5;"><strong>${safeCompany}</strong> has invited you to ${escapeHtml(APP_NAME)}. Accept your invitation and set up your account:</p>`,
    `<p style="margin:28px 0;"><a href="${safeLink}" style="background:#0a6b54;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 20px;border-radius:8px;display:inline-block;">Accept invitation</a></p>`,
    `<p style="font-size:13px;color:#64748b;line-height:1.5;">If the button does not work, paste this link into your browser:<br><a href="${safeLink}" style="color:#0a6b54;word-break:break-all;">${safeLink}</a></p>`,
    '<p style="font-size:13px;color:#64748b;line-height:1.5;">This link is single use and expires, and a newer invitation email replaces this one &mdash; always use the newest email from us. If you were not expecting this invitation, you can safely ignore it.</p>',
    `<p style="font-size:13px;color:#64748b;">${escapeHtml(APP_NAME)}</p>`,
    "</div>",
  ].join("");

  return { subject, text, html };
}

type InviteDeps = {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  // Injectable so the pure invite logic can be unit tested without a database.
  // Defaults to the real tenants.demo_mode lookup.
  isDemoTenant?: (client: AdminClient, tenantId: string) => Promise<boolean>;
};

/**
 * Creates a worker invite (auth user + action link) and emails it via Resend.
 * Returns ok:true once the user exists, even if the email could not be sent, so
 * the caller can still provision the worker and tell the admin to resend.
 */
export async function inviteWorkerByEmail(
  adminSupabase: AdminClient,
  params: WorkerInviteParams,
  deps: InviteDeps = {},
): Promise<WorkerInviteResult> {
  const env = deps.env ?? process.env;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const checkDemoTenant = deps.isDemoTenant ?? isDemoTenant;

  // A demo tenant must not create auth users or send email. Block before
  // generateLink so no user is created and nothing is sent.
  if (await checkDemoTenant(adminSupabase, params.tenantId)) {
    return { ok: false, error: "Inviting workers is disabled in the demo." };
  }

  const { data, error } = await adminSupabase.auth.admin.generateLink({
    type: "invite",
    email: params.email,
    options: {
      data: {
        company_name: params.companyName,
        full_name: params.fullName,
      },
      redirectTo: params.redirectTo,
    },
  });

  if (error || !data.user) {
    return { ok: false, error: error?.message ?? "Worker invite could not be created." };
  }

  const actionLink = buildEmailConfirmationLink({
    properties: data.properties,
    redirectTo: params.redirectTo,
    type: "invite",
  });

  if (!actionLink) {
    // The user exists but we have no link to send. Treat as created-with-warning
    // so the worker is still provisioned and the admin can resend.
    return { ok: true, user: data.user, emailWarning: "No invitation link was returned, so no email was sent." };
  }

  const from = env.EMAIL_DELIVERY_FROM?.trim();
  const apiKey = env.RESEND_API_KEY?.trim();

  if (!from || !apiKey) {
    return {
      ok: true,
      user: data.user,
      emailWarning: "Email delivery is not configured (EMAIL_DELIVERY_FROM / RESEND_API_KEY), so no invite email was sent.",
    };
  }

  const email = buildWorkerInviteEmail({
    actionLink,
    companyName: params.companyName,
    fullName: params.fullName,
  });

  const replyTo = env.EMAIL_DELIVERY_REPLY_TO?.trim() || undefined;
  const sendResult = await sendViaResend(
    { body: email.text, from, html: email.html, replyTo, subject: email.subject, to: params.email },
    apiKey,
    fetchImpl,
  );

  if (!sendResult.ok) {
    return { ok: true, user: data.user, emailWarning: sendResult.error };
  }

  return { ok: true, user: data.user, emailWarning: null };
}

/**
 * Re-sends the invite email to a worker who already exists.
 *
 * `generateLink({ type: "invite" })` refuses an address that is already
 * registered, so before this existed a failed first send stranded the worker:
 * the account was created, no email arrived, and nothing in the admin UI could
 * reach them. That is survivable for one person and not survivable for a
 * roster import where some fraction of sends fail.
 *
 * A magic link is the right primitive. `/auth/confirm` verifies any OTP type
 * through the same path and lands the worker in the same place, so the
 * recipient experience is identical to accepting the original invite.
 *
 * Unlike the initial invite this returns ok:false when the email fails. No
 * account is being provisioned here, so a send that did not happen is a plain
 * failure with nothing to keep.
 */
export async function resendWorkerInviteByEmail(
  adminSupabase: AdminClient,
  params: WorkerInviteParams,
  deps: InviteDeps = {},
): Promise<WorkerInviteResendResult> {
  const env = deps.env ?? process.env;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const checkDemoTenant = deps.isDemoTenant ?? isDemoTenant;

  if (await checkDemoTenant(adminSupabase, params.tenantId)) {
    return { ok: false, error: "Inviting workers is disabled in the demo." };
  }

  const from = env.EMAIL_DELIVERY_FROM?.trim();
  const apiKey = env.RESEND_API_KEY?.trim();

  // Check before minting a link. A link generated and never sent is a live
  // credential sitting in the auth system for nothing.
  if (!from || !apiKey) {
    return {
      ok: false,
      error: "Email delivery is not configured (EMAIL_DELIVERY_FROM / RESEND_API_KEY), so no invite email was sent.",
    };
  }

  const { data, error } = await adminSupabase.auth.admin.generateLink({
    type: "magiclink",
    email: params.email,
    options: {
      redirectTo: params.redirectTo,
    },
  });

  const actionLink = buildEmailConfirmationLink({
    properties: data?.properties,
    redirectTo: params.redirectTo,
    type: "magiclink",
  });

  if (error || !actionLink) {
    return { ok: false, error: error?.message ?? "No invitation link was returned, so no email was sent." };
  }

  const email = buildWorkerInviteEmail({
    actionLink,
    companyName: params.companyName,
    fullName: params.fullName,
  });

  const replyTo = env.EMAIL_DELIVERY_REPLY_TO?.trim() || undefined;
  const sendResult = await sendViaResend(
    { body: email.text, from, html: email.html, replyTo, subject: email.subject, to: params.email },
    apiKey,
    fetchImpl,
  );

  if (!sendResult.ok) {
    return { ok: false, error: sendResult.error };
  }

  return { ok: true };
}
