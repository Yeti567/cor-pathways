"use server";

import { redirect } from "next/navigation";
import { PASSWORD_RESET_NOTICE, sendPasswordResetEmail } from "@/lib/password-reset";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Emails a replacement sign-in link to someone whose emailed link is dead.
 *
 * A link that expired or was already consumed leaves the visitor with no
 * session, so we cannot look their address up from the request. Take it from the
 * form instead and send a fresh link down the same Resend pipeline the
 * forgot-password form uses.
 *
 * This used to call `supabase.auth.resend({ type: "signup" })`, which was wrong
 * two ways over and silently sent nothing at all:
 *
 *  1. Wrong link type. A signup confirmation only means anything for an account
 *     whose address is still unconfirmed. Anyone who reaches this page from a
 *     dead invite or recovery link confirmed theirs long ago, so Supabase had
 *     nothing to resend.
 *  2. Wrong mailer. `auth.resend` delivers through Supabase's built-in SMTP,
 *     which these deployments deliberately do not configure, because every
 *     email in the app goes out through Resend. The call returned 200 and no
 *     mail was ever queued.
 *
 * The visitor was then shown a cheerful "we sent a new link" notice. On
 * 2026-08-18 a client president pressed that button twice, an hour apart, and
 * nothing was sent either time: the auth log holds two `/resend` 200s and not a
 * single `generate_link`.
 *
 * Always redirects to the same generic notice whatever happened inside, because
 * this form is public and unauthenticated. See PASSWORD_RESET_NOTICE.
 */
export async function sendReplacementLink(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();

  if (!EMAIL_PATTERN.test(email)) {
    redirect(`/auth/error?message=${encodeURIComponent("Enter a valid email address to get a new link.")}`);
  }

  const adminSupabase = createSupabaseAdminClient();

  if (adminSupabase) {
    // Resolves to { handled: true } no matter what happened inside, so there is
    // deliberately nothing here to branch on.
    await sendPasswordResetEmail(adminSupabase, email);
  }

  redirect(`/auth/error?notice=${encodeURIComponent(PASSWORD_RESET_NOTICE)}`);
}
