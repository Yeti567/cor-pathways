"use server";

import { type EmailOtpType } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { getSafeRedirectPath } from "@/lib/auth-redirect";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// The email OTP types Supabase can hand us on a confirmation link. Anything else
// is either not an email link or not something this page should be redeeming, so
// it is rejected rather than passed through to verifyOtp.
const ALLOWED_TYPES = new Set<EmailOtpType>(["invite", "magiclink", "signup", "recovery", "email_change", "email"]);

function isAllowedType(value: string): value is EmailOtpType {
  return ALLOWED_TYPES.has(value as EmailOtpType);
}

/**
 * Redeems an email confirmation token.
 *
 * This runs on POST for a reason: the token is single use, and verifying on GET
 * meant any inbox security scanner that prefetched the link burned it before the
 * recipient ever clicked. See the comment in /auth/confirm/route.ts.
 */
export async function confirmEmailLink(formData: FormData) {
  const tokenHash = String(formData.get("token_hash") ?? "").trim();
  const rawType = String(formData.get("type") ?? "").trim();
  const nextPath = getSafeRedirectPath(String(formData.get("next") ?? ""));

  if (!tokenHash || !isAllowedType(rawType)) {
    redirect(`/auth/error?message=${encodeURIComponent("The confirmation link is missing required auth details.")}`);
  }

  let supabase;

  try {
    supabase = await createSupabaseServerClient();
  } catch {
    redirect(`/auth/error?message=${encodeURIComponent("Supabase environment variables are not configured.")}`);
  }

  const { error } = await supabase.auth.verifyOtp({
    type: rawType,
    token_hash: tokenHash,
  });

  if (error) {
    redirect(
      `/auth/error?message=${encodeURIComponent(
        "This link has expired or was replaced by a newer email. Only the most recent email we sent you works.",
      )}`,
    );
  }

  // An account reached through one of these links has no usable password:
  // `generateLink` provisions an invited worker without one, and a recovery link
  // exists because the old one is gone. Send them to set one now, while they
  // still hold the session this link just created. Skip that and they are a
  // one-session user who cannot sign in from another phone, which is the exact
  // support call this flow is meant to prevent.
  //
  // A magic link can belong to someone who already has a password, so they get
  // the same page with a skip option rather than a wall.
  if (rawType === "invite" || rawType === "recovery" || rawType === "signup") {
    redirect(`/auth/set-password?next=${encodeURIComponent(nextPath)}`);
  }

  if (rawType === "magiclink") {
    redirect(`/auth/set-password?next=${encodeURIComponent(nextPath)}&optional=1`);
  }

  redirect(nextPath);
}
