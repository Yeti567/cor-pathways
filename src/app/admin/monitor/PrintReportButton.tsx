"use client";

import { FileDown } from "lucide-react";

export function PrintReportButton({ label = "Print report" }: { label?: string }) {
  return (
    <button
      className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-[var(--border)] bg-white px-3 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2 print:hidden"
      onClick={() => window.print()}
      type="button"
    >
      <FileDown className="h-4 w-4" aria-hidden="true" />
      {label}
    </button>
  );
}
