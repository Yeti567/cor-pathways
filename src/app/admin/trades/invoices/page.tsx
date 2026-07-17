import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertTriangle, FileText } from "lucide-react";
import { AdminShell } from "@/app/admin/_components/AdminShell";
import { canUseAdminPanel } from "@/lib/access-control";
import { requireAppUser } from "@/lib/current-user";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatMoney, INVOICE_STATUSES, invoiceStatusBadge, invoiceStatusLabel } from "@/lib/trades";
import type { Database } from "@/types/database";

export const dynamic = "force-dynamic";

type InvoiceRow = Pick<
  Database["public"]["Tables"]["trade_invoice"]["Row"],
  "id" | "invoice_number" | "status" | "total" | "issued_on" | "customer_id"
>;
type CustomerNameRow = Pick<Database["public"]["Tables"]["trade_customer"]["Row"], "id" | "name">;

type InvoicesPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(value: string | string[] | undefined): string | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

export default async function TradeInvoicesPage({ searchParams }: InvoicesPageProps) {
  const context = await requireAppUser();

  if (!canUseAdminPanel(context.appUser)) {
    redirect("/choose");
  }
  if (!context.tenant?.trades_enabled) {
    redirect("/admin/setup");
  }

  const params = await searchParams;
  const notice = firstParam(params.notice);
  const error = firstParam(params.error);
  const statusFilterRaw = firstParam(params.status);
  const statusFilter = INVOICE_STATUSES.find((status) => status === statusFilterRaw) ?? null;

  const supabase = await createSupabaseServerClient();
  let invoiceQuery = supabase
    .from("trade_invoice")
    .select("id, invoice_number, status, total, issued_on, customer_id")
    .eq("tenant_id", context.appUser.tenant_id);
  if (statusFilter) {
    invoiceQuery = invoiceQuery.eq("status", statusFilter);
  }
  const { data: invoiceRows } = await invoiceQuery
    .order("created_at", { ascending: false })
    .returns<InvoiceRow[]>();
  const invoices = invoiceRows ?? [];

  const { data: customerRows } = await supabase
    .from("trade_customer")
    .select("id, name")
    .eq("tenant_id", context.appUser.tenant_id)
    .returns<CustomerNameRow[]>();
  const customerName = new Map((customerRows ?? []).map((customer) => [customer.id, customer.name]));

  return (
    <AdminShell eyebrow="Trades" tenantName={context.tenant?.name ?? "Company profile"} title="Invoices">
      {notice ? (
        <p className="mb-4 inline-flex items-center gap-2 rounded-md bg-emerald-50 px-3 py-2 text-sm font-semibold text-[var(--success)]">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className="mb-4 inline-flex items-center gap-2 rounded-md bg-red-50 px-3 py-2 text-sm font-semibold text-[var(--danger)]">
          <AlertTriangle className="h-4 w-4" aria-hidden="true" />
          {error}
        </p>
      ) : null}

      <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-[var(--ink)]">Invoices</h2>
          <p className="text-sm text-[var(--ink-muted)]">Create an invoice from a work order with line items.</p>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <Link
            className={`rounded-md px-3 py-1 text-sm font-semibold ${
              statusFilter === null
                ? "bg-[var(--primary)] text-white"
                : "bg-[var(--surface-muted)] text-[var(--ink-muted)] hover:text-[var(--ink)]"
            }`}
            href="/admin/trades/invoices"
          >
            All
          </Link>
          {INVOICE_STATUSES.map((status) => (
            <Link
              className={`rounded-md px-3 py-1 text-sm font-semibold ${
                statusFilter === status
                  ? "bg-[var(--primary)] text-white"
                  : "bg-[var(--surface-muted)] text-[var(--ink-muted)] hover:text-[var(--ink)]"
              }`}
              href={`/admin/trades/invoices?status=${status}`}
              key={status}
            >
              {invoiceStatusLabel(status)}
            </Link>
          ))}
        </div>

        {invoices.length === 0 ? (
          <div className="mt-5 flex flex-col items-center gap-2 rounded-md border border-dashed border-[var(--border)] p-8 text-center">
            <FileText className="h-6 w-6 text-[var(--ink-muted)]" aria-hidden="true" />
            <p className="text-sm text-[var(--ink-muted)]">No invoices{statusFilter ? " with this status" : ""} yet.</p>
          </div>
        ) : (
          <ul className="mt-5 divide-y divide-[var(--border)] rounded-md border border-[var(--border)] bg-white">
            {invoices.map((invoice) => (
              <li key={invoice.id}>
                <Link
                  className="flex items-center justify-between gap-3 p-3 transition hover:bg-[var(--surface-muted)]"
                  href={`/admin/trades/invoices/${invoice.id}`}
                >
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-[var(--ink)]">
                      {invoice.invoice_number} · {customerName.get(invoice.customer_id) ?? "Unknown customer"}
                    </p>
                    <p className="truncate text-sm text-[var(--ink-muted)]">{invoice.issued_on ?? "Not issued"}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className="font-semibold text-[var(--ink)]">{formatMoney(invoice.total)}</span>
                    <span className={`rounded-md px-2 py-1 text-xs font-semibold ${invoiceStatusBadge(invoice.status)}`}>
                      {invoiceStatusLabel(invoice.status)}
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </AdminShell>
  );
}
