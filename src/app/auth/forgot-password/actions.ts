"use server";

import { redirect } from "next/navigation";
import { sendPasswordResetEmail } from "@/lib/password-reset";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// One message for every outcome. Sent, unknown address, demo tenant, Resend
// down: the visitor sees the same thing, because any difference turns this
// public form into a way to test whether an address has an account here.
const GENERIC_NOTICE = "If that email has an account, a reset link is on its way. Check your inbox and your junk folder.";

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
