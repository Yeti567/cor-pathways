"use server";

import { redirect } from "next/navigation";
import { sendPasswordResetEmail } from "@/lib/password-reset";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// One message for every outcome. Sent, unknown address, demo tenant, Resend
// down: the visitor sees the same thing, because any difference turns this
// public form into a way to test whether an address has an account here.
//
// That rule has a cost, and it bit a real user. Someone on the WRONG deployment
// gets this same reassuring sentence and waits forever for an email that was
// never going to come, because their account lives in a different company's
// database. From their side "nothing happened" is indistinguishable from
// success, and they have no way to work out why.
//
// So the wording keeps the protection (still conditional, still no confirmation
// that any address exists) while naming the one cause a legitimate person can
// actually act on: being on the wrong web address.
const GENERIC_NOTICE =
  "If that email has an account here, a reset link is on its way. Check your inbox and your junk folder. " +
  "If nothing arrives within a few minutes, check you are on your own company's web address: a reset can only " +
  "be sent from the site where your account lives.";

export async function requestPasswordReset(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();

  if (!EMAIL_PATTERN.test(email)) {
    redirect(`/auth/forgot-password?error=${encodeURIComponent("Enter a valid email address.")}`);
  }

  const adminSupabase = createSupabaseAdminClient();

  if (adminSupabase) {
    // Resolves to { handled: true } no matter what happened inside, so there is
    // deliberately nothing here to branch on.
    await sendPasswordResetEmail(adminSupabase, email);
  }

  redirect(`/auth/forgot-password?notice=${encodeURIComponent(GENERIC_NOTICE)}`);
}
