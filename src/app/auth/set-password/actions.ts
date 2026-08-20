"use server";

import { redirect } from "next/navigation";
import { getSafeRedirectPath } from "@/lib/auth-redirect";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
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

  await markInviteAccepted(userData.user.id);

  redirect(nextPath);
}

/**
 * Records that this worker finished setting their account up, so the admin panel
 * stops showing them as an invitation nobody answered.
 *
 * A trigger on `auth.users.email_confirmed_at` records the same thing, and this
 * is deliberately the second of the two. The trigger is exact for anybody who
 * arrives through GoTrue's own confirmation, and this covers the case where the
 * account was already confirmed before a password existed, where that column
 * never changes and the trigger therefore never fires. Both are guarded on the
 * column still being null, so whichever runs first wins and the other is a no-op.
 *
 * Failure here is deliberately swallowed. The worker has a password and a session
 * and is about to land in the app; refusing to let them in because an admin
 * screen would show a stale label would be the wrong trade.
 */
async function markInviteAccepted(userId: string) {
  const adminSupabase = createSupabaseAdminClient();

  if (!adminSupabase) {
    return;
  }

  await adminSupabase
    .from("users")
    .update({ invite_accepted_at: new Date().toISOString() })
    .eq("id", userId)
    .is("invite_accepted_at", null);
}
