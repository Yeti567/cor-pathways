import { redirect } from "next/navigation";
import { MailCheck } from "lucide-react";
import { signOut } from "@/app/actions";
import { getCurrentUserContext } from "@/lib/current-user";
import { resendVerificationEmail } from "./actions";

export const dynamic = "force-dynamic";

type VerifyEmailPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function VerifyEmailPage({ searchParams }: VerifyEmailPageProps) {
  const params = await searchParams;
  const notice = Array.isArray(params.notice) ? params.notice[0] : params.notice;
  const context = await getCurrentUserContext();

  if (context.status === "signed_out") {
    redirect("/login");
  }

  if (context.authUser?.email_confirmed_at) {
    redirect("/");
  }

  const email = context.authUser?.email ?? "your email address";

  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--background)] p-4">
      <div className="w-full max-w-md rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm">
        <div className="flex items-center gap-2">
          <MailCheck className="h-6 w-6 text-[var(--primary)]" aria-hidden="true" />
          <h1 className="text-lg font-semibold text-[var(--ink)]">Confirm your email</h1>
        </div>
        <p className="mt-3 text-sm text-[var(--ink-muted)]">
          We sent a confirmation link to <span className="font-semibold text-[var(--ink)]">{email}</span>. Click it to
          finish setting up your account, then sign in.
        </p>

        {notice ? (
          <p className="mt-4 rounded-md border border-[var(--success)] bg-emerald-50 p-3 text-sm text-[var(--success)]">
            {notice}
          </p>
        ) : null}

        <div className="mt-5 grid gap-2">
          <form action={resendVerificationEmail}>
            <button
              className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-white transition hover:bg-[var(--primary-strong)]"
              type="submit"
            >
              Resend confirmation email
            </button>
          </form>
          <form action={signOut}>
            <button
              className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md border border-[var(--border)] bg-white px-4 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)]"
              type="submit"
            >
              Sign out
            </button>
          </form>
        </div>

        <p className="mt-4 text-xs text-[var(--ink-muted)]">
          Already confirmed? Sign out and sign back in to continue.
        </p>
      </div>
    </main>
  );
}
