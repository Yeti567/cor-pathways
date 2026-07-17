import Link from "next/link";
import { CloudOff } from "lucide-react";

export default function OfflinePage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--background)] px-4 py-10">
      <section className="w-full max-w-md rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6 text-center shadow-sm">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-md bg-[var(--surface-muted)] text-[var(--primary)]">
          <CloudOff className="h-6 w-6" aria-hidden="true" />
        </div>
        <h1 className="mt-4 text-xl font-semibold text-[var(--ink)]">Offline</h1>
        <p className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">
          The last opened app screens and saved worker data are available when they have been cached on this device.
        </p>
        <Link
          className="mt-5 inline-flex h-10 items-center justify-center rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-white"
          href="/web"
        >
          Open web app
        </Link>
      </section>
    </main>
  );
}
