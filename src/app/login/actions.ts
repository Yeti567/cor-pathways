"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAuthRedirectUrl, getSafeRedirectPath } from "@/lib/auth-redirect";
import { getDemoLoginCredentials } from "@/lib/demo";
import { publicEnv } from "@/lib/env";
import { getConfiguredSsoProvider } from "@/lib/sso";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { recordConsultantLoginAuditEventsForSession } from "@/lib/tenant-audit";

function getCredentials(formData: FormData) {
  return {
    email: String(formData.get("email") ?? "").trim().toLowerCase(),
    password: String(formData.get("password") ?? ""),
    nextPath: getSafeRedirectPath(formData.get("next")),
  };
}

function getSignupDetails(formData: FormData) {
  return {
    fullName: String(formData.get("fullName") ?? "").trim(),
    companyName: String(formData.get("companyName") ?? "").trim(),
  };
}

function redirectToLogin(message: string, nextPath: string): never {
  const url = new URL("/login", publicEnv.NEXT_PUBLIC_APP_URL ?? "http://127.0.0.1:3000");
  url.searchParams.set("error", message);
  url.searchParams.set("next", nextPath);
  redirect(`${url.pathname}${url.search}`);
}

async function getSupabaseOrRedirect() {
  try {
    return await createSupabaseServerClient();
  } catch {
    redirect("/auth/error?message=Supabase%20environment%20variables%20are%20not%20configured.");
  }
}

export async function login(formData: FormData) {
  const { email, password, nextPath } = getCredentials(formData);
  const supabase = await getSupabaseOrRedirect();

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    if (error.code === "email_not_confirmed" || /not confirmed/i.test(error.message)) {
      redirectToLogin("Please confirm your email before signing in. Check your inbox for the link.", nextPath);
    }
    redirectToLogin("Invalid email or password.", nextPath);
  }

  await recordConsultantLoginAuditEventsForSession(
    {
      consultantId: data.user?.id,
      method: "password",
      nextPath,
    },
    supabase,
  );

  revalidatePath("/", "layout");
  redirect(nextPath);
}

/**
 * One-click sign-in to the shared demo tenant. Bound to a button on the landing page, and
 * only reachable when DEMO_LOGIN_EMAIL and DEMO_LOGIN_PASSWORD are set on the deployment.
 * The credentials never touch the client: they are read here, server-side, and exchanged
 * for a session exactly like a normal password login.
 */
export async function demoLogin() {
  const credentials = getDemoLoginCredentials();

  if (!credentials) {
    redirectToLogin("The live demo is not available right now.", "/");
  }

  const supabase = await getSupabaseOrRedirect();
  const { error } = await supabase.auth.signInWithPassword(credentials);

  if (error) {
    redirectToLogin("The live demo is not available right now.", "/");
  }

  revalidatePath("/", "layout");
  redirect("/");
}

export async function loginWithSso(formData: FormData) {
  const nextPath = getSafeRedirectPath(formData.get("next"));
  const provider = getConfiguredSsoProvider();

  if (!provider) {
    redirectToLogin("Single sign-on is not configured.", nextPath);
  }

  const supabase = await getSupabaseOrRedirect();
  const appUrl = publicEnv.NEXT_PUBLIC_APP_URL ?? "http://127.0.0.1:3000";
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo: getAuthRedirectUrl(appUrl, nextPath),
    },
  });

  if (error || !data.url) {
    redirectToLogin(error?.message ?? "Single sign-on could not be started.", nextPath);
  }

  redirect(data.url);
}

export async function signup(formData: FormData) {
  const { email, password, nextPath } = getCredentials(formData);
  const { fullName, companyName } = getSignupDetails(formData);
  const supabase = await getSupabaseOrRedirect();
  const appUrl = publicEnv.NEXT_PUBLIC_APP_URL ?? "http://127.0.0.1:3000";

  if (!fullName || !companyName) {
    redirectToLogin("Enter your name and company name to create an account.", nextPath);
  }

  const metadata: Record<string, string> = {
    company_name: companyName,
    full_name: fullName,
  };
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: metadata,
      emailRedirectTo: getAuthRedirectUrl(appUrl, nextPath),
    },
  });

  if (error) {
    redirectToLogin(error.message, nextPath);
  }

  if (data.session) {
    revalidatePath("/", "layout");
    redirect(nextPath);
  }

  const url = new URL("/login", appUrl);
  url.searchParams.set("notice", "Check your email to confirm your account.");
  url.searchParams.set("next", nextPath);
  redirect(`${url.pathname}${url.search}`);
}
