import { type EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { getSafeRedirectPath } from "@/lib/auth-redirect";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { recordConsultantLoginAuditEventsForSession } from "@/lib/tenant-audit";

function redirectToError(request: NextRequest, message: string) {
  const url = request.nextUrl.clone();
  url.pathname = "/auth/error";
  url.searchParams.set("message", message);
  return NextResponse.redirect(url);
}

export async function GET(request: NextRequest) {
  const oauthCode = request.nextUrl.searchParams.get("code");
  const oauthError = request.nextUrl.searchParams.get("error_description") ?? request.nextUrl.searchParams.get("error");
  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  const type = request.nextUrl.searchParams.get("type") as EmailOtpType | null;
  const nextPath = getSafeRedirectPath(request.nextUrl.searchParams.get("next"));

  if (oauthError) {
    return redirectToError(request, oauthError);
  }

  let supabase;

  try {
    supabase = await createSupabaseServerClient();
  } catch {
    return redirectToError(request, "Supabase environment variables are not configured.");
  }

  if (oauthCode) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(oauthCode);

    if (error) {
      return redirectToError(request, "The single sign-on link is invalid or expired.");
    }

    await recordConsultantLoginAuditEventsForSession(
      {
        consultantId: data.user?.id,
        method: "sso",
        nextPath,
      },
      supabase,
    );

    return NextResponse.redirect(new URL(nextPath, request.url));
  }

  if (!tokenHash || !type) {
    return redirectToError(request, "The confirmation link is missing required auth details.");
  }

  const { error } = await supabase.auth.verifyOtp({
    type,
    token_hash: tokenHash,
  });

  if (error) {
    return redirectToError(request, "The confirmation link is invalid or expired.");
  }

  return NextResponse.redirect(new URL(nextPath, request.url));
}
