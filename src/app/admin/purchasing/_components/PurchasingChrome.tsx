import Link from "next/link";
import type { PurchaseOrderStatus } from "@/types/database";
import { purchaseOrderStatuses } from "@/lib/purchasing";

// Shared pieces for the purchasing pages, so every screen in the module looks the same
// as the inventory screens it sits beside.

export const inputClass =
  "h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2";
export const textareaClass =
  "min-h-20 w-full rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2";
export const labelClass = "space-y-2";
export const labelTextClass = "text-sm font-medium text-[var(--ink)]";
export const checkboxClass = "h-4 w-4 rounded border-[var(--border)] text-[var(--primary)]";
export const primaryButtonClass =
  "inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-white transition hover:opacity-90";
export const secondaryButtonClass =
  "inline-flex h-10 items-center justify-center gap-2 rounded-md border border-[var(--border)] bg-white px-4 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)]";
export const dangerButtonClass =
  "inline-flex h-10 items-center justify-center gap-2 rounded-md border border-[var(--border)] bg-white px-4 text-sm font-semibold text-[var(--danger)] transition hover:bg-red-50";
export const sectionClass = "rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm";

export function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

const tabs = [
  { href: "/admin/purchasing", label: "Orders" },
  { href: "/admin/purchasing/suppliers", label: "Suppliers" },
  { href: "/admin/purchasing/rules", label: "Approval rules" },
  { href: "/admin/purchasing/export", label: "Export" },
] as const;

export function PurchasingTabs({ active }: { active: (typeof tabs)[number]["href"] }) {
  return (
    <nav aria-label="Purchasing" className="mb-4 flex flex-wrap gap-2">
      {tabs.map((tab) => (
        <Link
          aria-current={tab.href === active ? "page" : undefined}
          className={`inline-flex h-9 items-center rounded-md border px-3 text-sm font-semibold transition ${
            tab.href === active
              ? "border-[var(--primary)] bg-[var(--primary)] text-white"
              : "border-[var(--border)] bg-white text-[var(--ink)] hover:bg-[var(--surface-muted)]"
          }`}
          href={tab.href}
          key={tab.href}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}

export function Flash({ error, notice }: { error?: string; notice?: string }) {
  return (
    <>
      {notice ? (
        <p className="mb-4 rounded-md border border-[var(--success)] bg-emerald-50 p-3 text-sm text-[var(--success)]">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className="mb-4 rounded-md border border-[var(--danger)] bg-red-50 p-3 text-sm text-[var(--danger)]">{error}</p>
      ) : null}
    </>
  );
}

export function StatusBadge({ status }: { status: PurchaseOrderStatus }) {
  const meta = purchaseOrderStatuses[status];
  const tone =
    meta.tone === "warn"
      ? "bg-amber-50 text-[var(--warning)]"
      : meta.tone === "success"
        ? "bg-emerald-50 text-[var(--success)]"
        : meta.tone === "danger"
          ? "bg-red-50 text-[var(--danger)]"
          : meta.tone === "info"
            ? "bg-sky-50 text-[var(--primary)]"
            : "bg-[var(--surface-muted)] text-[var(--ink-muted)]";

  return <span className={`inline-flex rounded-md px-2 py-1 text-xs font-semibold ${tone}`}>{meta.label}</span>;
}
