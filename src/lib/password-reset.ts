// Password resets, sent through our own Resend pipeline for the same reasons as
// worker invites: Supabase's built-in mailer is rate limited to a handful of
// messages an hour, and we want the branded email the rest of the app sends.
//
// `generateLink({ type: "recovery" })` mints the link without sending anything,
// then Resend delivers it.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { APP_NAME } from "@/lib/brand";
import { buildEmailConfirmationLink } from "@/lib/auth-email-link";
import { isDemoTenant } from "@/lib/demo";
import { sendViaResend } from "@/lib/resend-relay";

type AdminClient = SupabaseClient<Database>;

export type PasswordResetEmail = {
  subject: string;
  text: string;
  html: string;
};

export type PasswordResetParams = {
  email: string;
  fullName: string;
  companyName: string;
  redirectTo: string;
};

export type PasswordResetDeps = {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  isDemoTenant?: (client: AdminClient, tenantId: string) => Promise<boolean>;
};

// Every outcome collapses to this one value. A caller must not be able to tell a
// real address from an unknown one, a demo tenant, or a Resend failure, because
// that difference is an account enumeration oracle on a public, unauthenticated
// form.
export type PasswordResetOutcome = { handled: true };

// The single notice every public entry point shows after a reset is requested:
// the forgot-password form, and the dead-link form on /auth/error. Both must say
// exactly the same thing, because a visitor who can tell the two apart can use
// the difference to work out whether an address has an account here.
//
// It stays conditional and confirms nothing, while naming the one cause a real
// person can act on: being on another company's deployment, where their account
// does not exist and no amount of retrying will ever produce an email.
export const PASSWORD_RESET_NOTICE =
  "If that email has an account here, a reset link is on its way. Check your inbox and your junk folder. " +
  "If nothing arrives within a few minutes, check you are on your own company's web address: a reset can only " +
  "be sent from the site where your account lives.";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Builds the branded password reset email. Pure and deterministic so it can be
 * unit tested without touching Supabase or Resend.
 */
export function buildPasswordResetEmail(params: {
  fullName: string;
  companyName: string;
  actionLink: string;
}): PasswordResetEmail {
  const firstName = params.fullName.trim().split(/\s+/)[0] || "there";
  const company = params.companyName.trim() || "Your company";
  const subject = `Reset your ${company} password`;

  const text = [
    `Hi ${firstName},`,
    "",
    `Someone asked to reset the password for your ${company} account. Open the link below to choose a new one:`,
    "",
    params.actionLink,
    "",
    "This link is single use and expires. If you did not ask for this, you can safely ignore this email and your password will not change.",
    "",
    APP_NAME,
  ].join("\n");

  const safeFirstName = escapeHtml(firstName);
  const safeCompany = escapeHtml(company);
  const safeLink = escapeHtml(params.actionLink);

  const html = [
    '<div style="font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;color:#0f172a;">',
    `<p style="font-size:16px;">Hi ${safeFirstName},</p>`,
    `<p style="font-size:16px;line-height:1.5;">Someone asked to reset the password for your <strong>${safeCompany}</strong> account. Choose a new one here:</p>`,
    `<p style="margin:28px 0;"><a href="${safeLink}" style="background:#0a6b54;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 20px;border-radius:8px;display:inline-block;">Reset password</a></p>`,
    `<p style="font-size:13px;color:#64748b;line-height:1.5;">If the button does not work, paste this link into your browser:<br><a href="${safeLink}" style="color:#0a6b54;word-break:break-all;">${safeLink}</a></p>`,
    '<p style="font-size:13px;color:#64748b;line-height:1.5;">This link is single use and expires. If you did not ask for this, you can safely ignore this email and your password will not change.</p>',
    `<p style="font-size:13px;color:#64748b;">${escapeHtml(APP_NAME)}</p>`,
    "</div>",
  ].join("");

  return { subject, text, html };
}

/**
 * Emails a password reset link, if and only if the address belongs to a real
 * non-demo user.
 *
 * Always resolves to { handled: true }. Callers must show the same message no
 * matter what happened in here: an unknown address, a demo tenant, a Resend
 * outage, and a successful send are indistinguishable to the visitor by design.
 * Failures are the caller's problem to observe elsewhere, not the form's.
 */
export async function sendPasswordResetEmail(
  adminSupabase: AdminClient,
  email: string,
  deps: PasswordResetDeps = {},
): Promise<PasswordResetOutcome> {
  const env = deps.env ?? process.env;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const checkDemoTenant = deps.isDemoTenant ?? isDemoTenant;
  const normalized = email.trim().toLowerCase();

  const from = env.EMAIL_DELIVERY_FROM?.trim();
  const apiKey = env.RESEND_API_KEY?.trim();
  const appUrl = env.NEXT_PUBLIC_APP_URL?.trim() || "http://127.0.0.1:3000";

  if (!normalized || !from || !apiKey) {
    return { handled: true };
  }

  const { data: user } = await adminSupabase
    .from("users")
    .select("email, full_name, tenant_id")
    .eq("email", normalized)
    .maybeSingle<{ email: string; full_name: string; tenant_id: string }>();

  if (!user) {
    return { handled: true };
  }

  // A demo tenant must not send real mail on the deployment's Resend account,
  // and its shared password must not be resettable by a passer-by.
  if (await checkDemoTenant(adminSupabase, user.tenant_id)) {
    return { handled: true };
  }

  const { data: tenant } = await adminSupabase
    .from("tenants")
    .select("name")
    .eq("id", user.tenant_id)
    .maybeSingle<{ name: string }>();

  const redirectTo = `${appUrl}/auth/confirm`;

  // Recovery is the correct link for anyone who has confirmed their address.
  //
  // An invited worker who never opened their invite has no confirmed address,
  // and Supabase will not mint a recovery link for that account. Before the
  // fallback below, such a person had no way back in at all: the reset form
  // accepted their address, generateLink failed, and the enumeration guarantee
  // meant they were told a link was on its way. A magic link does work for an
  // unconfirmed account and lands on the same set-password page, so try that
  // rather than giving up silently.
  let actionLink: string | undefined;

  for (const type of ["recovery", "magiclink"] as const) {
    const { data, error } = await adminSupabase.auth.admin.generateLink({
      type,
      email: normalized,
      options: { redirectTo },
    });

    const link = buildEmailConfirmationLink({ properties: data?.properties, redirectTo, type });

    if (!error && link) {
      actionLink = link;
      break;
    }
  }

  if (!actionLink) {
    return { handled: true };
  }

  const message = buildPasswordResetEmail({
    actionLink,
    companyName: tenant?.name ?? "Your company",
    fullName: user.full_name,
  });

  const replyTo = env.EMAIL_DELIVERY_REPLY_TO?.trim() || undefined;

  await sendViaResend(
    { body: message.text, from, html: message.html, replyTo, subject: message.subject, to: normalized },
    apiKey,
    fetchImpl,
  );

  return { handled: true };
}
