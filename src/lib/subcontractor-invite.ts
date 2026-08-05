// Carrier portal invitations, sent through our own Resend pipeline rather than
// Supabase's built-in mailer, for the same reason worker invites are: the built-in
// transactional mail is rate limited to a handful of messages an hour, and a company
// onboarding twenty-five carriers at once would trip it immediately.
//
// The difference from a worker invite is who is on the other end. A worker is staff at
// the company doing the inviting. A carrier contact works somewhere else entirely, is
// often one person with a phone and a filing cabinet, and has no reason to care about
// this software beyond getting their certificates in. So the mail says who is asking and
// why, and the returning path is a magic link rather than a password, because the
// realistic alternative is a password written on a sticky note.

import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { isDemoTenant } from "@/lib/demo";
import { sendViaResend } from "@/lib/resend-relay";

type AdminClient = SupabaseClient<Database>;

export type SubcontractorInviteParams = {
  carrierName: string;
  companyName: string;
  email: string;
  fullName: string;
  redirectTo: string;
  // A demo tenant must not create auth users or send mail on the deployment's account.
  tenantId: string;
};

export type SubcontractorInviteResult =
  | { ok: true; user: User; emailWarning: string | null }
  | { ok: false; error: string };

export type SubcontractorInviteEmail = {
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
 * Builds the invite email. Pure and deterministic so it can be unit tested without
 * touching Supabase or Resend.
 */
export function buildSubcontractorInviteEmail(params: {
  actionLink: string;
  carrierName: string;
  companyName: string;
  fullName: string;
  returning?: boolean;
}): SubcontractorInviteEmail {
  const firstName = params.fullName.trim().split(/\s+/)[0] || "there";
  const company = params.companyName.trim() || "The hiring company";
  const carrier = params.carrierName.trim() || "your company";
  const subject = params.returning
    ? `Your sign-in link for ${company}`
    : `${company} needs your insurance and carrier documents`;

  const opening = params.returning
    ? `Here is a fresh sign-in link for the ${company} carrier portal. It works once and then expires.`
    : `${company} hires ${carrier} and keeps your insurance, carrier profile, and WCB paperwork on file. They have set up a page where you can see exactly what they need and what they already have.`;

  const text = [
    `Hi ${firstName},`,
    "",
    opening,
    "",
    params.actionLink,
    "",
    "There is no password to create. This link signs you in.",
    "",
    "If you were not expecting this, you can ignore this email.",
    "",
    company,
  ].join("\n");

  const safeFirstName = escapeHtml(firstName);
  const safeCompany = escapeHtml(company);
  const safeCarrier = escapeHtml(carrier);
  const safeLink = escapeHtml(params.actionLink);
  const safeOpening = params.returning
    ? `Here is a fresh sign-in link for the <strong>${safeCompany}</strong> carrier portal. It works once and then expires.`
    : `<strong>${safeCompany}</strong> hires ${safeCarrier} and keeps your insurance, carrier profile, and WCB paperwork on file. They have set up a page where you can see exactly what they need and what they already have.`;

  const html = [
    '<div style="font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;color:#0f172a;">',
    `<p style="font-size:16px;">Hi ${safeFirstName},</p>`,
    `<p style="font-size:16px;line-height:1.5;">${safeOpening}</p>`,
    `<p style="margin:28px 0;"><a href="${safeLink}" style="background:#0a6b54;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 20px;border-radius:8px;display:inline-block;">Open your carrier page</a></p>`,
    `<p style="font-size:13px;color:#64748b;line-height:1.5;">If the button does not work, paste this link into your browser:<br><a href="${safeLink}" style="color:#0a6b54;word-break:break-all;">${safeLink}</a></p>`,
    '<p style="font-size:13px;color:#64748b;line-height:1.5;">There is no password to create. This link signs you in. If you were not expecting this, you can ignore this email.</p>',
    `<p style="font-size:13px;color:#64748b;">${safeCompany}</p>`,
    "</div>",
  ].join("");

  return { subject, text, html };
}

type InviteDeps = {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  isDemoTenant?: (client: AdminClient, tenantId: string) => Promise<boolean>;
};

/**
 * Creates or refreshes a carrier portal login and emails the link.
 *
 * `invite` creates the auth user; `magiclink` only works once they exist. Trying invite
 * first and falling back keeps one entry point for both the first invitation and every
 * later "send it again, they lost it", which is the request that will actually come in.
 */
export async function inviteSubcontractorContact(
  adminSupabase: AdminClient,
  params: SubcontractorInviteParams,
  deps: InviteDeps = {},
): Promise<SubcontractorInviteResult> {
  const env = deps.env ?? process.env;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const checkDemoTenant = deps.isDemoTenant ?? isDemoTenant;

  // Blocked before generateLink, so a demo tenant creates no auth user for an outside
  // email address and sends nothing.
  if (await checkDemoTenant(adminSupabase, params.tenantId)) {
    return { ok: false, error: "Inviting carriers is disabled in the demo." };
  }

  let returning = false;
  let generated = await adminSupabase.auth.admin.generateLink({
    type: "invite",
    email: params.email,
    options: { redirectTo: params.redirectTo },
  });

  // Already has an account, either from a previous invite here or from another hiring
  // company that uses this software. Send them a sign-in link instead of failing.
  if (generated.error) {
    returning = true;
    generated = await adminSupabase.auth.admin.generateLink({
      type: "magiclink",
      email: params.email,
      options: { redirectTo: params.redirectTo },
    });
  }

  if (generated.error || !generated.data.user) {
    return { ok: false, error: generated.error?.message ?? "The invitation could not be created." };
  }

  const actionLink = generated.data.properties?.action_link;

  if (!actionLink) {
    return {
      ok: true,
      user: generated.data.user,
      emailWarning: "No sign-in link was returned, so no email was sent.",
    };
  }

  const from = env.EMAIL_DELIVERY_FROM?.trim();
  const apiKey = env.RESEND_API_KEY?.trim();

  if (!from || !apiKey) {
    return {
      ok: true,
      user: generated.data.user,
      emailWarning:
        "Email delivery is not configured (EMAIL_DELIVERY_FROM / RESEND_API_KEY), so no invitation was sent.",
    };
  }

  const email = buildSubcontractorInviteEmail({
    actionLink,
    carrierName: params.carrierName,
    companyName: params.companyName,
    fullName: params.fullName,
    returning,
  });

  const replyTo = env.EMAIL_DELIVERY_REPLY_TO?.trim() || undefined;
  const sendResult = await sendViaResend(
    { body: email.text, from, html: email.html, replyTo, subject: email.subject, to: params.email },
    apiKey,
    fetchImpl,
  );

  if (!sendResult.ok) {
    return { ok: true, user: generated.data.user, emailWarning: sendResult.error };
  }

  return { ok: true, user: generated.data.user, emailWarning: null };
}
