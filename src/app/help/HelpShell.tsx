import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowLeft, LifeBuoy, LogIn } from "lucide-react";

export function HelpShell({ children }: { children: ReactNode }) {
  return (
    <main className="min-h-screen bg-[var(--background)]">
      <header className="border-b border-[var(--border)] bg-[var(--surface)]">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <Link className="flex items-center gap-3 text-sm font-bold text-[var(--ink)]" href="/">
            <Image
              alt="Cor Pathway 360"
              className="h-9 w-auto"
              height={41}
              priority
              src="/images/cor%20pathways%20logo%20bg%20removed.png"
              width={128}
            />
            <span className="hidden text-xs font-semibold uppercase tracking-[0.18em] text-[var(--ink-muted)] sm:inline">
              Help
            </span>
          </Link>
          <nav className="flex items-center gap-2 text-sm">
            <Link
              className="inline-flex h-9 items-center gap-2 rounded-md px-3 font-semibold text-[var(--ink-muted)] transition hover:bg-[var(--surface-muted)] hover:text-[var(--ink)]"
              href="/"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              Home
            </Link>
            <Link
              className="inline-flex h-9 items-center gap-2 rounded-md px-3 font-semibold text-[var(--ink-muted)] transition hover:bg-[var(--surface-muted)] hover:text-[var(--ink)]"
              href="/help"
            >
              <LifeBuoy className="h-4 w-4" aria-hidden="true" />
              All help topics
            </Link>
            <Link
              className="inline-flex h-9 items-center gap-2 rounded-md border border-[var(--border)] bg-white px-3 font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)]"
              href="/login"
            >
              <LogIn className="h-4 w-4" aria-hidden="true" />
              Log in
            </Link>
          </nav>
        </div>
      </header>
      {children}
      <footer className="mt-12 border-t border-[var(--border)] bg-[var(--surface)] px-4 py-6 text-sm text-[var(--ink-muted)] sm:px-6">
        <div className="mx-auto max-w-6xl">
          <p>© Cor Pathway 360.</p>
          <p className="mt-1 text-xs">
            Cor Pathway 360 is owned and operated by <span className="font-semibold text-[var(--ink)]">Yeti Digital Services Ltd.</span>
          </p>
        </div>
      </footer>
    </main>
  );
}
