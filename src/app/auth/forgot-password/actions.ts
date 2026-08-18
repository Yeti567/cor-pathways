"use server";

import { redirect } from "next/navigation";
import { PASSWORD_RESET_NOTICE, sendPasswordResetEmail } from "@/lib/password-reset";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// The notice text, the reasoning behind it, and the dead end it closes now live
// beside the sender in @/lib/password-reset, so this form and the dead-link form
// on /auth/error cannot drift apart and become an enumeration oracle.

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

  redirect(`/auth/forgot-password?notice=${encodeURIComponent(PASSWORD_RESET_NOTICE)}`);
}
