"use client";

import { Printer } from "lucide-react";

export function CorPrintButton() {
  return (
    <button
      className="inline-flex h-10 items-center gap-2 rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-white transition hover:bg-[var(--primary-strong)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2 print:hidden"
      onClick={() => window.print()}
      type="button"
    >
      <Printer className="h-4 w-4" aria-hidden="true" />
      Print auditor package
    </button>
  );
}
