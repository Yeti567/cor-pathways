import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSafeRedirectPath } from "@/lib/auth-redirect";
import { getSupabasePublicEnv } from "@/lib/env";
import type { Database } from "@/types/database";

const PUBLIC_PATH_PREFIXES = [
  "/login",
  "/auth",
  "/offline",
  "/icons",
  "/help",
  // Bearer-token authenticated endpoints: they verify their own secret inside the
  // route handler, so the session-cookie redirect below must not bounce them to
  // /login. Without this, Vercel cron requests and Auto-Share email delivery POSTs
  // (which carry no session cookie) get 307'd to the login page and never run.
  "/api/cron",
  "/api/email-delivery",
  ...(process.env.NODE_ENV === "production" ? [] : ["/e2e-fixtures"]),
];
const PUBLIC_PATHS = ["/", "/manifest.webmanifest", "/sw.js"];

export function isPublicPath(pathname: string) {
  return (
    PUBLIC_PATHS.includes(pathname) ||
    PUBLIC_PATH_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
  );
}

function copySessionCookies(from: NextResponse, to: NextResponse) {
  from.cookies.getAll().forEach((cookie) => {
    to.cookies.set(cookie);
  });
}

function redirectWithSessionCookies(url: URL, supabaseResponse: NextResponse) {
  const response = NextResponse.redirect(url);
  copySessionCookies(supabaseResponse, response);
  return response;
}

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });
  const env = getSupabasePublicEnv();
  const { pathname, search } = request.nextUrl;
  const publicPath = isPublicPath(pathname);

  if (!env) {
    if (publicPath) {
      return supabaseResponse;
    }

    const url = request.nextUrl.clone();
    url.pathname = "/auth/error";
    url.searchParams.set("message", "Supabase environment variables are not configured.");
    return NextResponse.redirect(url);
  }

  const supabase = createServerClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        supabaseResponse = NextResponse.next({
          request,
        });
        cookiesToSet.forEach(({ name, value, options }) => {
          supabaseResponse.cookies.set(name, value, options);
        });
      },
    },
  });

  const { data } = await supabase.auth.getClaims();
  const isSignedIn = Boolean(data?.claims);

  if (!isSignedIn && !publicPath) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", `${pathname}${search}`);
    return redirectWithSessionCookies(url, supabaseResponse);
  }

  if (isSignedIn && pathname === "/login") {
    const url = new URL(getSafeRedirectPath(request.nextUrl.searchParams.get("next")), request.url);
    return redirectWithSessionCookies(url, supabaseResponse);
  }

  return supabaseResponse;
}
