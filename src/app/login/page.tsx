import Link from "next/link";
import { AlertTriangle, Building2, Globe2, KeyRound, LogIn, MailCheck, UserPlus } from "lucide-react";
import { APP_NAME } from "@/lib/brand";
import { InstallAppButton } from "@/app/_components/InstallAppButton";
import { getSafeRedirectPath } from "@/lib/auth-redirect";
import { getSupabasePublicEnv } from "@/lib/env";
import { isSelfSignupAvailable } from "@/lib/self-signup";
import { getSsoLoginState } from "@/lib/sso";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { login, loginWithSso, signup } from "./actions";

type LoginPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

// Modules a standalone ($10) signup can pick exactly one of. Values must match the
// TenantFeature keys the signup action and tenant-creation trigger validate against.
const STANDALONE_MODULE_OPTIONS: { value: string; label: string }[] = [
  { value: "daily_inspection", label: "Daily Trip Inspection (vehicle pre-trip log)" },
  { value: "equipment", label: "Equipment and Maintenance" },
  { value: "trades", label: "Trades and Service Work Orders" },
  { value: "gc", label: "Construction and General Contractor" },
  { value: "document_control", label: "Document Control" },
  { value: "workflows", label: "Workflows and Corrective Actions" },
  { value: "analytics", label: "Analytics" },
  { value: "scheduling", label: "Scheduling" },
];

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const nextPath = getSafeRedirectPath(firstParam(params.next));
  const error = firstParam(params.error);
  const notice = firstParam(params.notice);
  const isConfigured = Boolean(getSupabasePublicEnv());
  const isStandaloneSignup = firstParam(params.plan) === "standalone";
  const moduleParam = firstParam(params.module);
  const defaultModule = STANDALONE_MODULE_OPTIONS.some((option) => option.value === moduleParam)
    ? (moduleParam as string)
    : "daily_inspection";
  const ssoLogin = getSsoLoginState({
    provider: process.env.NEXT_PUBLIC_SSO_PROVIDER,
    supabaseConfigured: isConfigured,
  });

  // Once this deployment has a company, signing yourself up is over: everybody
  // else arrives by invitation. Ask rather than assume, and if Supabase is not
  // configured at all do not even try, because the panel below already says so.
  const signupAvailable = isConfigured
    ? await isSelfSignupAvailable(await createSupabaseServerClient())
    : false;

  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--background)] px-4 py-10">
      <section className="grid w-full max-w-5xl gap-5 lg:grid-cols-[1fr_1fr]">
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-md bg-[var(--surface-muted)] text-[var(--primary)]">
              <KeyRound className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-[var(--ink)]">Login to your account</h1>
              <p className="text-sm text-[var(--ink-muted)]">{APP_NAME}</p>
            </div>
          </div>

          {!isConfigured ? (
            <div className="mt-5 flex gap-3 rounded-md border border-[var(--warning)] bg-orange-50 p-3 text-sm text-[var(--ink)]">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--warning)]" aria-hidden="true" />
              <p>
                Add your Supabase URL and publishable key to{" "}
                <code className="rounded bg-white px-1 py-0.5 text-xs">.env.local</code> before signing in.
              </p>
            </div>
          ) : null}

          {error ? (
            <p className="mt-5 rounded-md border border-[var(--danger)] bg-red-50 p-3 text-sm text-[var(--danger)]">
              {error}
            </p>
          ) : null}

          {notice ? (
            <p className="mt-5 rounded-md border border-[var(--success)] bg-emerald-50 p-3 text-sm text-[var(--success)]">
              {notice}
            </p>
          ) : null}

          <form action={login} className="mt-6 space-y-4">
            <input type="hidden" name="next" value={nextPath} />
            <div className="space-y-2">
              <label className="text-sm font-medium text-[var(--ink)]" htmlFor="login-email">
                Email
              </label>
              <input
                className="w-full rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm text-[var(--ink)] outline-none transition focus:border-[var(--primary)] focus:ring-2 focus:ring-teal-100"
                id="login-email"
                name="email"
                type="email"
                autoComplete="email"
                required
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-baseline justify-between gap-3">
                <label className="text-sm font-medium text-[var(--ink)]" htmlFor="login-password">
                  Password
                </label>
                <Link
                  className="text-xs font-semibold text-[var(--primary)] hover:underline"
                  href="/auth/forgot-password"
                >
                  Forgot password?
                </Link>
              </div>
              <input
                className="w-full rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm text-[var(--ink)] outline-none transition focus:border-[var(--primary)] focus:ring-2 focus:ring-teal-100"
                id="login-password"
                name="password"
                type="password"
                autoComplete="current-password"
                minLength={6}
                required
              />
            </div>

            <button
              className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-white transition hover:bg-[var(--primary-dark)] disabled:cursor-not-allowed disabled:opacity-60"
              formAction={login}
              disabled={!isConfigured}
            >
              <LogIn className="h-4 w-4" aria-hidden="true" />
              Next
            </button>

            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 text-xs uppercase text-[var(--ink-muted)]">
              <span className="h-px bg-[var(--border)]" />
              <span>Or</span>
              <span className="h-px bg-[var(--border)]" />
            </div>

            <button
              className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-md border border-[var(--border)] bg-white px-4 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)] disabled:cursor-not-allowed disabled:opacity-60"
              formAction={loginWithSso}
              disabled={!ssoLogin.enabled}
            >
              <Globe2 className="h-4 w-4 text-[var(--primary)]" aria-hidden="true" />
              Login with {APP_NAME} SSO
            </button>
          </form>

          <InstallAppButton />
        </div>

        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-md bg-[var(--surface-muted)] text-[var(--accent)]">
              {signupAvailable ? (
                <Building2 className="h-5 w-5" aria-hidden="true" />
              ) : (
                <MailCheck className="h-5 w-5" aria-hidden="true" />
              )}
            </div>
            <div>
              <h2 className="text-xl font-semibold text-[var(--ink)]">
                {signupAvailable ? "Create company account" : "Joining by invitation"}
              </h2>
              <p className="text-sm text-[var(--ink-muted)]">
                {signupAvailable
                  ? "Your account starts as the tenant Super Admin."
                  : "This company is already set up here."}
              </p>
            </div>
          </div>

          {signupAvailable ? (
            <>
          {isStandaloneSignup ? (
            <p className="mt-5 rounded-md border border-[var(--primary)]/40 bg-emerald-50 p-3 text-sm text-[var(--ink)]">
              Standalone plan, $10 per user. Pick the one module you need below; you can upgrade to a full plan anytime.
            </p>
          ) : null}

          <form action={signup} className="mt-6 space-y-4">
            <input type="hidden" name="next" value={nextPath} />
            {isStandaloneSignup ? (
              <>
                <input type="hidden" name="plan" value="standalone" />
                <div className="space-y-2">
                  <label className="text-sm font-medium text-[var(--ink)]" htmlFor="signup-module">
                    Module
                  </label>
                  <select
                    className="w-full rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm text-[var(--ink)] outline-none transition focus:border-[var(--primary)] focus:ring-2 focus:ring-teal-100"
                    id="signup-module"
                    name="standaloneModule"
                    defaultValue={defaultModule}
                  >
                    {STANDALONE_MODULE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              </>
            ) : null}
            <div className="space-y-2">
              <label className="text-sm font-medium text-[var(--ink)]" htmlFor="signup-name">
                Full name
              </label>
              <input
                className="w-full rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm text-[var(--ink)] outline-none transition focus:border-[var(--primary)] focus:ring-2 focus:ring-teal-100"
                id="signup-name"
                name="fullName"
                type="text"
                autoComplete="name"
                required
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-[var(--ink)]" htmlFor="signup-company">
                Company name
              </label>
              <input
                className="w-full rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm text-[var(--ink)] outline-none transition focus:border-[var(--primary)] focus:ring-2 focus:ring-teal-100"
                id="signup-company"
                name="companyName"
                type="text"
                autoComplete="organization"
                required
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-[var(--ink)]" htmlFor="signup-email">
                Email
              </label>
              <input
                className="w-full rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm text-[var(--ink)] outline-none transition focus:border-[var(--primary)] focus:ring-2 focus:ring-teal-100"
                id="signup-email"
                name="email"
                type="email"
                autoComplete="email"
                required
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-[var(--ink)]" htmlFor="signup-password">
                Password
              </label>
              <input
                className="w-full rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm text-[var(--ink)] outline-none transition focus:border-[var(--primary)] focus:ring-2 focus:ring-teal-100"
                id="signup-password"
                name="password"
                type="password"
                autoComplete="new-password"
                minLength={6}
                required
              />
            </div>

            <button
              className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-md border border-[var(--primary)] bg-white px-4 text-sm font-semibold text-[var(--primary)] transition hover:bg-[var(--surface-muted)] disabled:cursor-not-allowed disabled:opacity-60"
              formAction={signup}
              disabled={!isConfigured}
            >
              <UserPlus className="h-4 w-4" aria-hidden="true" />
              Create account
            </button>
          </form>
            </>
          ) : (
            <div className="mt-6 space-y-4 text-sm text-[var(--ink-muted)]">
              <p>
                Accounts here are created by invitation, so there is no signup form. Ask an
                administrator at your company to send you one, and it will arrive by email with a
                link to set your own password.
              </p>
              <p>
                Already been sent an invitation? Use the link in that email rather than this page.
                If you have set your password already, sign in on the left.
              </p>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
