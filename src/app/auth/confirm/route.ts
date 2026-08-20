import { type EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { ACCOUNT_SETUP_PARAM } from "@/lib/auth-email-link";
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

  // Deliberately do NOT verify here.
  //
  // Supabase email tokens are single use, and this is a GET. Inbox security
  // scanners (Microsoft Defender Safe Links, which every Microsoft 365 tenant
  // has, plus most other mail filters) fetch every URL in an inbound message to
  // check it. That fetch consumes the token, so the account gets marked
  // confirmed seconds after the invite goes out and the recipient's own click
  // then fails with "invalid or expired". The link worked perfectly, just not
  // for the person it was sent to.
  //
  // Hand off to a page that verifies on POST instead. Scanners follow links;
  // they do not submit forms. This fixes it for every scanner rather than
  // depending on one customer's IT allowlisting our domain.
  const verifyUrl = request.nextUrl.clone();
  verifyUrl.pathname = "/auth/verify";
  verifyUrl.search = "";
  verifyUrl.searchParams.set("token_hash", tokenHash);
  verifyUrl.searchParams.set("type", type);
  verifyUrl.searchParams.set("next", nextPath);

  // Carried through from the invitation email. Marks somebody who has never set a
  // password, so the verify step can insist on one instead of offering to skip.
  if (request.nextUrl.searchParams.get(ACCOUNT_SETUP_PARAM) === "1") {
    verifyUrl.searchParams.set(ACCOUNT_SETUP_PARAM, "1");
  }

  return NextResponse.redirect(verifyUrl);
}
