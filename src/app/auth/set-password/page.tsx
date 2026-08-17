import Link from "next/link";
import { AlertTriangle, KeyRound, Save } from "lucide-react";
import { getSafeRedirectPath } from "@/lib/auth-redirect";
import { setPassword } from "./actions";

type SetPasswordPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function SetPasswordPage({ searchParams }: SetPasswordPageProps) {
  const params = await searchParams;
  const nextPath = getSafeRedirectPath(firstParam(params.next));
  const error = firstParam(params.error);
  // Recovery and invite links exist precisely because there is no usable
  // password yet, so skipping is not offered on those. A magic link can belong
  // to someone who already has one, so they get an out.
  const canSkip = firstParam(params.optional) === "1";

  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--background)] px-4 py-10">
      <section className="w-full max-w-[calc(100vw-2rem)] rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm sm:max-w-md">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-[var(--surface-muted)] text-[var(--primary)]">
            <KeyRound className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-[var(--ink)]">Choose a password</h1>
            <p className="text-sm text-[var(--ink-muted)]">You will use it with your email to sign in from now on.</p>
          </div>
        </div>

        {error ? (
          <p className="mt-5 flex items-start gap-2 rounded-md border border-[var(--danger)] bg-red-50 p-3 text-sm text-[var(--danger)]">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </p>
        ) : null}

        <form action={setPassword} className="mt-6 space-y-4">
          <input type="hidden" name="next" value={nextPath} />

          <div className="space-y-2">
            <label className="text-sm font-medium text-[var(--ink)]" htmlFor="password">
              New password
            </label>
            <input
              autoComplete="new-password"
              className="w-full rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm text-[var(--ink)] outline-none transition focus:border-[var(--primary)] focus:ring-2 focus:ring-teal-100"
              id="password"
              minLength={6}
              name="password"
              required
              type="password"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-[var(--ink)]" htmlFor="confirmPassword">
              Confirm password
            </label>
            <input
              autoComplete="new-password"
              className="w-full rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm text-[var(--ink)] outline-none transition focus:border-[var(--primary)] focus:ring-2 focus:ring-teal-100"
              id="confirmPassword"
              minLength={6}
              name="confirmPassword"
              required
              type="password"
            />
          </div>

          <button
            className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-white transition hover:bg-[var(--primary-dark)]"
            type="submit"
          >
            <Save className="h-4 w-4" aria-hidden="true" />
            Save password and continue
          </button>
        </form>

        {canSkip ? (
          <Link
            className="mt-4 inline-flex h-10 w-full items-center justify-center rounded-md border border-[var(--border)] bg-white px-4 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)]"
            href={nextPath}
          >
            Skip for now
          </Link>
        ) : null}
      </section>
    </main>
  );
}
