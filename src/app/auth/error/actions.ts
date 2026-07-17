"use server";

import { redirect } from "next/navigation";
import { getAuthRedirectUrl } from "@/lib/auth-redirect";
import { publicEnv } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// A confirmation link that was expired or already consumed (often by a mailbox
// security scanner) leaves the visitor with no session, so we cannot look their
// address up. Take it from the form instead and resend a fresh signup link.
//
// We always return the same generic notice regardless of whether the address
// exists or is already confirmed, so this cannot be used to enumerate accounts.
export async function resendSignupConfirmation(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();

  if (!EMAIL_PATTERN.test(email)) {
    redirect(`/auth/error?message=${encodeURIComponent("Enter a valid email address to resend the confirmation link.")}`);
  }

  try {
    const supabase = await createSupabaseServerClient();
    const appUrl = publicEnv.NEXT_PUBLIC_APP_URL ?? "http://127.0.0.1:3000";

    // Best effort: ignore the result so a bad or already-confirmed address looks
    // identical to a successful resend.
    await supabase.auth.resend({
      type: "signup",
      email,
      options: { emailRedirectTo: getAuthRedirectUrl(appUrl, "/") },
    });
  } catch {
    // Swallow; the generic notice below still applies.
  }

  redirect(
    `/auth/error?notice=${encodeURIComponent(
      "If that account still needs confirmation, we sent a new link. Check your inbox, and use a personal inbox if a shared one keeps failing.",
    )}`,
  );
}
