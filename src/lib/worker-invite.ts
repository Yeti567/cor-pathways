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
import { sendViaResend } from "@/lib/resend-relay";

type AdminClient = SupabaseClient<Database>;

export type WorkerInviteParams = {
  email: string;
  fullName: string;
  companyName: string;
  redirectTo: string;
};

export type WorkerInviteResult =
  // The auth user exists (created and link generated). `emailWarning` is set when
  // the user was created but the invite email could not be delivered, so the
  // caller can still finish setting up the worker and surface a resend hint.
  | { ok: true; user: User; emailWarning: string | null }
  // The invite link itself could not be created; no user exists.
  | { ok: false; error: string };

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
  const subject = `You are invited to ${company} on Core Pathways`;

  const text = [
    `Hi ${firstName},`,
    "",
    `${company} has invited you to Core Pathways. Click the link below to accept your invitation and set up your account:`,
    "",
    params.actionLink,
    "",
    "This link is single use. If you were not expecting this invitation, you can safely ignore this email.",
    "",
    "Core Pathways",
  ].join("\n");

  const safeFirstName = escapeHtml(firstName);
  const safeCompany = escapeHtml(company);
  const safeLink = escapeHtml(params.actionLink);

  const html = [
    '<div style="font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;color:#0f172a;">',
    `<p style="font-size:16px;">Hi ${safeFirstName},</p>`,
    `<p style="font-size:16px;line-height:1.5;"><strong>${safeCompany}</strong> has invited you to Core Pathways. Accept your invitation and set up your account:</p>`,
    `<p style="margin:28px 0;"><a href="${safeLink}" style="background:#0a6b54;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 20px;border-radius:8px;display:inline-block;">Accept invitation</a></p>`,
    `<p style="font-size:13px;color:#64748b;line-height:1.5;">If the button does not work, paste this link into your browser:<br><a href="${safeLink}" style="color:#0a6b54;word-break:break-all;">${safeLink}</a></p>`,
    '<p style="font-size:13px;color:#64748b;line-height:1.5;">This link is single use. If you were not expecting this invitation, you can safely ignore this email.</p>',
    '<p style="font-size:13px;color:#64748b;">Core Pathways</p>',
    "</div>",
  ].join("");

  return { subject, text, html };
}

type InviteDeps = {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
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

  const actionLink = data.properties?.action_link;

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

  const sendResult = await sendViaResend(
    { body: email.text, from, html: email.html, subject: email.subject, to: params.email },
    apiKey,
    fetchImpl,
  );

  if (!sendResult.ok) {
    return { ok: true, user: data.user, emailWarning: sendResult.error };
  }

  return { ok: true, user: data.user, emailWarning: null };
}
