"use server";

import { redirect } from "next/navigation";
import { getAuthRedirectUrl } from "@/lib/auth-redirect";
import { getCurrentUserContext } from "@/lib/current-user";
import { publicEnv } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function resendVerificationEmail() {
  const context = await getCurrentUserContext();

  if (!context.authUser?.email) {
    redirect("/login");
  }

  if (context.authUser.email_confirmed_at) {
    redirect("/");
  }

  const supabase = await createSupabaseServerClient();
  const appUrl = publicEnv.NEXT_PUBLIC_APP_URL ?? "http://127.0.0.1:3000";

  const { error } = await supabase.auth.resend({
    type: "signup",
    email: context.authUser.email,
    options: { emailRedirectTo: getAuthRedirectUrl(appUrl, "/") },
  });

  const notice = error ? "Could not resend the email. Try again shortly." : "Verification email sent. Check your inbox.";
  redirect(`/verify-email?notice=${encodeURIComponent(notice)}`);
}
