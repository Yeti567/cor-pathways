import Link from "next/link";
import { AlertTriangle, MailCheck } from "lucide-react";
import { sendReplacementLink } from "./actions";

type AuthErrorPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

// Whether this looks like a confirmation-link failure (expired or already used)
// rather than, say, an SSO error. Only then do we offer to resend a link.
function isConfirmationError(message: string) {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("confirmation") ||
    normalized.includes("link is invalid") ||
    normalized.includes("expired") ||
    normalized.includes("replaced")
  );
}

export default async function AuthErrorPage({ searchParams }: AuthErrorPageProps) {
  const params = await searchParams;
  const message = firstParam(params.message) ?? "Authentication could not be completed.";
  const notice = firstParam(params.notice);
  const showResend = !notice && isConfirmationError(message);

  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--background)] px-4 py-10">
      <section className="w-full max-w-[calc(100vw-2rem)] rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm sm:max-w-md">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-red-50 text-[var(--danger)]">
            <AlertTriangle className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-[var(--ink)]">Auth needs attention</h1>
            <p className="text-sm text-[var(--ink-muted)]">{message}</p>
          </div>
        </div>

        {notice ? (
          <p className="mt-5 flex items-start gap-2 rounded-md border border-[var(--success)] bg-emerald-50 p-3 text-sm text-[var(--success)]">
            <MailCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{notice}</span>
          </p>
        ) : null}

        {showResend ? (
          <form action={sendReplacementLink} className="mt-5 grid gap-2">
            <label className="text-sm font-medium text-[var(--ink)]" htmlFor="email">
              Get a new link
            </label>
            <p className="text-xs text-[var(--ink-muted)]">
              Enter your email and we will send a fresh link you can use to set a password. Requesting a new link
              turns off every earlier email, so once it arrives, use that newest email and ignore the older ones.
            </p>
            <input
              autoComplete="email"
              className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
              id="email"
              name="email"
              placeholder="you@company.com"
              required
              type="email"
            />
            <button
              className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-white transition hover:bg-[var(--primary-strong)]"
              type="submit"
            >
              <MailCheck className="h-4 w-4" aria-hidden="true" />
              Email me a new link
            </button>
          </form>
        ) : null}

        <Link
          className="mt-6 inline-flex h-10 items-center justify-center rounded-md border border-[var(--border)] bg-white px-4 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)]"
          href="/login"
        >
          Back to sign in
        </Link>
      </section>
    </main>
  );
}
