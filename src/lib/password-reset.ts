// Password resets, sent through our own Resend pipeline for the same reasons as
// worker invites: Supabase's built-in mailer is rate limited to a handful of
// messages an hour, and we want the branded email the rest of the app sends.
//
// `generateLink({ type: "recovery" })` mints the link without sending anything,
// then Resend delivers it.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
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
    "Core Pathways",
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
    '<p style="font-size:13px;color:#64748b;">Core Pathways</p>',
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

  const { data, error } = await adminSupabase.auth.admin.generateLink({
    type: "recovery",
    email: normalized,
    options: {
      redirectTo: `${appUrl}/auth/confirm`,
    },
  });

  const actionLink = data?.properties?.action_link;

  if (error || !actionLink) {
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
