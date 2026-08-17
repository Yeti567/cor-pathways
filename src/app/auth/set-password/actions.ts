"use server";

import { redirect } from "next/navigation";
import { getSafeRedirectPath } from "@/lib/auth-redirect";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Matches the minLength on the sign-in and sign-up forms. Kept in one place here
// so the rule cannot drift between "the password you set" and "the password you
// are allowed to sign in with".
const MIN_PASSWORD_LENGTH = 6;

function backToForm(nextPath: string, message: string): never {
  redirect(`/auth/set-password?next=${encodeURIComponent(nextPath)}&error=${encodeURIComponent(message)}`);
}

/**
 * Sets a password on the currently signed-in account.
 *
 * This runs with the session the confirmation link just created, which is the
 * only window an invited worker has: `generateLink` provisions the account
 * without a password, so until this runs they can never sign in again on
 * another device or after the session ends.
 */
export async function setPassword(formData: FormData) {
  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");
  const nextPath = getSafeRedirectPath(String(formData.get("next") ?? ""));

  if (password.length < MIN_PASSWORD_LENGTH) {
    backToForm(nextPath, `Use at least ${MIN_PASSWORD_LENGTH} characters.`);
  }

  if (password !== confirmPassword) {
    backToForm(nextPath, "The two passwords do not match.");
  }

  let supabase;

  try {
    supabase = await createSupabaseServerClient();
  } catch {
    backToForm(nextPath, "Supabase environment variables are not configured.");
  }

  // The session comes from the confirmation link. Without it updateUser would
  // silently have no account to act on, so check rather than assume.
  const { data: userData } = await supabase.auth.getUser();

  if (!userData.user) {
    redirect(
      `/auth/error?message=${encodeURIComponent(
        "Your confirmation link has expired. Ask your administrator for a new invitation.",
      )}`,
    );
  }

  const { error } = await supabase.auth.updateUser({ password });

  if (error) {
    backToForm(nextPath, error.message);
  }

  redirect(nextPath);
}
