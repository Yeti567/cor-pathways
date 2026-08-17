import Link from "next/link";
import { KeyRound, LogIn } from "lucide-react";
import { getSafeRedirectPath } from "@/lib/auth-redirect";
import { confirmEmailLink } from "./actions";

type VerifyPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

// Rendered, not redeemed. The button below is what actually consumes the token,
// because a single-use token verified on GET gets eaten by inbox security
// scanners before the recipient can click it.
export default async function VerifyPage({ searchParams }: VerifyPageProps) {
  const params = await searchParams;
  const tokenHash = firstParam(params.token_hash) ?? "";
  const type = firstParam(params.type) ?? "";
  const nextPath = getSafeRedirectPath(firstParam(params.next));

  const ready = Boolean(tokenHash && type);

  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--background)] px-4 py-10">
      <section className="w-full max-w-[calc(100vw-2rem)] rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm sm:max-w-md">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-[var(--surface-muted)] text-[var(--primary)]">
            <KeyRound className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-[var(--ink)]">Confirm your account</h1>
            <p className="text-sm text-[var(--ink-muted)]">One more tap and you are in.</p>
          </div>
        </div>

        {ready ? (
          <form action={confirmEmailLink} className="mt-6">
            <input type="hidden" name="token_hash" value={tokenHash} />
            <input type="hidden" name="type" value={type} />
            <input type="hidden" name="next" value={nextPath} />
            <button
              className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-white transition hover:bg-[var(--primary-dark)]"
              type="submit"
            >
              <LogIn className="h-4 w-4" aria-hidden="true" />
              Confirm and continue
            </button>
          </form>
        ) : (
          <p className="mt-6 rounded-md border border-[var(--danger)] bg-red-50 p-3 text-sm text-[var(--danger)]">
            This link is missing the details needed to confirm your account. Ask your administrator to send a new
            invitation.
          </p>
        )}

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
