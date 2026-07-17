import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertTriangle, ArrowLeft } from "lucide-react";
import { updateTradeInvoice } from "@/app/admin/actions";
import { AdminShell } from "@/app/admin/_components/AdminShell";
import { canUseAdminPanel } from "@/lib/access-control";
import { requireAppUser } from "@/lib/current-user";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatMoney, INVOICE_STATUSES, invoiceStatusBadge, invoiceStatusLabel } from "@/lib/trades";
import type { Database } from "@/types/database";

export const dynamic = "force-dynamic";

type InvoiceRow = Database["public"]["Tables"]["trade_invoice"]["Row"];
type CustomerNameRow = Pick<Database["public"]["Tables"]["trade_customer"]["Row"], "id" | "name">;
type LineRow = Pick<
  Database["public"]["Tables"]["trade_invoice_line"]["Row"],
  "id" | "name" | "quantity" | "unit_price" | "line_total"
>;

type InvoiceDetailProps = {
  params: Promise<{ invoiceId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(value: string | string[] | undefined): string | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

const inputClass =
  "h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2";

export default async function TradeInvoiceDetailPage({ params, searchParams }: InvoiceDetailProps) {
  const context = await requireAppUser();

  if (!canUseAdminPanel(context.appUser)) {
    redirect("/choose");
  }
  if (!context.tenant?.trades_enabled) {
    redirect("/admin/setup");
  }

  const { invoiceId } = await params;
  const query = await searchParams;
  const notice = firstParam(query.notice);
  const error = firstParam(query.error);

  const supabase = await createSupabaseServerClient();
  const { data: invoice } = await supabase
    .from("trade_invoice")
    .select("*")
    .eq("tenant_id", context.appUser.tenant_id)
    .eq("id", invoiceId)
    .maybeSingle<InvoiceRow>();

  if (!invoice) {
    redirect("/admin/trades/invoices?error=Invoice%20not%20found.");
  }

  const [{ data: customer }, { data: lineRows }] = await Promise.all([
    supabase
      .from("trade_customer")
      .select("id, name")
      .eq("tenant_id", context.appUser.tenant_id)
      .eq("id", invoice.customer_id)
      .maybeSingle<CustomerNameRow>(),
    supabase
      .from("trade_invoice_line")
      .select("id, name, quantity, unit_price, line_total")
      .eq("tenant_id", context.appUser.tenant_id)
      .eq("invoice_id", invoiceId)
      .order("created_at", { ascending: true })
      .returns<LineRow[]>(),
  ]);
  const lines = lineRows ?? [];

  return (
    <AdminShell
      eyebrow="Trades"
      tenantName={context.tenant?.name ?? "Company profile"}
      title={`Invoice ${invoice.invoice_number}`}
    >
      <Link
        className="mb-4 inline-flex items-center gap-1 text-sm font-semibold text-[var(--primary)] hover:underline"
        href="/admin/trades/invoices"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        All invoices
      </Link>

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

      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-[var(--ink)]">{invoice.invoice_number}</h2>
              <p className="text-sm text-[var(--ink-muted)]">
                {customer ? (
                  <Link className="text-[var(--primary)] hover:underline" href={`/admin/trades/customers/${customer.id}`}>
                    {customer.name}
                  </Link>
                ) : (
                  "Unknown customer"
                )}
                {invoice.issued_on ? ` · Issued ${invoice.issued_on}` : ""}
                {invoice.due_on ? ` · Due ${invoice.due_on}` : ""}
              </p>
            </div>
            <span className={`rounded-md px-2 py-1 text-xs font-semibold ${invoiceStatusBadge(invoice.status)}`}>
              {invoiceStatusLabel(invoice.status)}
            </span>
          </div>

          {invoice.work_order_id ? (
            <Link
              className="mt-2 inline-flex text-sm font-semibold text-[var(--primary)] hover:underline"
              href={`/admin/trades/work-orders/${invoice.work_order_id}`}
            >
              View source work order
            </Link>
          ) : null}

          <div className="mt-4 overflow-hidden rounded-md border border-[var(--border)]">
            <table className="w-full text-sm">
              <thead className="bg-[var(--surface-muted)] text-left text-xs font-semibold uppercase text-[var(--ink-muted)]">
                <tr>
                  <th className="p-3">Item</th>
                  <th className="p-3 text-right">Qty</th>
                  <th className="p-3 text-right">Unit</th>
                  <th className="p-3 text-right">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)] bg-white">
                {lines.map((line) => (
                  <tr key={line.id}>
                    <td className="p-3 font-semibold text-[var(--ink)]">{line.name}</td>
                    <td className="p-3 text-right text-[var(--ink-muted)]">{Number(line.quantity)}</td>
                    <td className="p-3 text-right text-[var(--ink-muted)]">{formatMoney(line.unit_price)}</td>
                    <td className="p-3 text-right font-semibold text-[var(--ink)]">{formatMoney(line.line_total)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-[var(--surface-muted)]">
                <tr>
                  <td className="p-3 text-right text-[var(--ink-muted)]" colSpan={3}>
                    Subtotal
                  </td>
                  <td className="p-3 text-right font-semibold text-[var(--ink)]">{formatMoney(invoice.subtotal)}</td>
                </tr>
                <tr>
                  <td className="p-3 text-right text-[var(--ink-muted)]" colSpan={3}>
                    Tax ({Number(invoice.tax_rate)}%)
                  </td>
                  <td className="p-3 text-right font-semibold text-[var(--ink)]">{formatMoney(invoice.tax_amount)}</td>
                </tr>
                <tr>
                  <td className="p-3 text-right text-sm font-semibold uppercase text-[var(--ink-muted)]" colSpan={3}>
                    Total
                  </td>
                  <td className="p-3 text-right text-base font-semibold text-[var(--ink)]">{formatMoney(invoice.total)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          {invoice.notes ? (
            <p className="mt-3 whitespace-pre-wrap rounded-md bg-[var(--surface-muted)] p-3 text-sm text-[var(--ink-muted)]">
              {invoice.notes}
            </p>
          ) : null}
        </section>

        <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-[var(--ink)]">Update</h2>
          <form action={updateTradeInvoice} className="mt-4 space-y-3">
            <input name="invoiceId" type="hidden" value={invoice.id} />
            <label className="block space-y-1">
              <span className="text-xs font-semibold uppercase text-[var(--ink-muted)]">Status</span>
              <select className={inputClass} defaultValue={invoice.status} name="status">
                {INVOICE_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {invoiceStatusLabel(status)}
                  </option>
                ))}
              </select>
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-semibold uppercase text-[var(--ink-muted)]">Tax rate (%)</span>
              <input
                className={inputClass}
                defaultValue={Number(invoice.tax_rate)}
                inputMode="decimal"
                min="0"
                name="taxRate"
                step="0.001"
                type="number"
              />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-semibold uppercase text-[var(--ink-muted)]">Due date</span>
              <input className={inputClass} defaultValue={invoice.due_on ?? ""} name="dueOn" type="date" />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-semibold uppercase text-[var(--ink-muted)]">Notes</span>
              <textarea
                className="min-h-20 w-full rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                defaultValue={invoice.notes ?? ""}
                name="notes"
                placeholder="Payment terms, thank-you note, etc."
              />
            </label>
            <button
              className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-white transition hover:opacity-90"
              type="submit"
            >
              Save invoice
            </button>
          </form>
        </section>
      </div>
    </AdminShell>
  );
}
