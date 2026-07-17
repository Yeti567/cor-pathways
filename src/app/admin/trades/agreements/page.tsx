import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertTriangle, Plus, RefreshCw } from "lucide-react";
import { createServiceAgreement } from "@/app/admin/actions";
import { AdminShell } from "@/app/admin/_components/AdminShell";
import { canUseAdminPanel } from "@/lib/access-control";
import { requireAppUser } from "@/lib/current-user";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  agreementStatusBadge,
  agreementStatusLabel,
  annualizedAgreementValue,
  BILLING_INTERVALS,
  billingIntervalLabel,
  formatMoney,
} from "@/lib/trades";
import type { Database } from "@/types/database";

export const dynamic = "force-dynamic";

type AgreementRow = Pick<
  Database["public"]["Tables"]["trade_service_agreement"]["Row"],
  "id" | "name" | "status" | "billing_amount" | "billing_interval" | "next_visit_on" | "customer_id"
>;
type CustomerRow = Pick<Database["public"]["Tables"]["trade_customer"]["Row"], "id" | "name">;

type AgreementsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(value: string | string[] | undefined): string | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

const inputClass =
  "h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2";

export default async function TradeAgreementsPage({ searchParams }: AgreementsPageProps) {
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

  const supabase = await createSupabaseServerClient();
  const [{ data: agreementRows }, { data: customerRows }] = await Promise.all([
    supabase
      .from("trade_service_agreement")
      .select("id, name, status, billing_amount, billing_interval, next_visit_on, customer_id")
      .eq("tenant_id", context.appUser.tenant_id)
      .order("status", { ascending: true })
      .order("next_visit_on", { ascending: true, nullsFirst: false })
      .returns<AgreementRow[]>(),
    supabase
      .from("trade_customer")
      .select("id, name")
      .eq("tenant_id", context.appUser.tenant_id)
      .eq("status", "active")
      .order("name", { ascending: true })
      .returns<CustomerRow[]>(),
  ]);
  const agreements = agreementRows ?? [];
  const customers = customerRows ?? [];
  const customerName = new Map(customers.map((customer) => [customer.id, customer.name]));
  const annualRecurring = agreements
    .filter((agreement) => agreement.status === "active")
    .reduce((sum, agreement) => sum + annualizedAgreementValue(agreement.billing_amount, agreement.billing_interval), 0);

  return (
    <AdminShell eyebrow="Trades" tenantName={context.tenant?.name ?? "Company profile"} title="Service Agreements">
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
            <h2 className="text-lg font-semibold text-[var(--ink)]">Agreements &amp; memberships</h2>
            <div className="rounded-md bg-[var(--surface-muted)] px-3 py-1.5 text-right">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
                Active recurring / yr
              </p>
              <p className="text-sm font-semibold text-[var(--ink)]">{formatMoney(annualRecurring)}</p>
            </div>
          </div>

          {agreements.length === 0 ? (
            <div className="mt-5 flex flex-col items-center gap-2 rounded-md border border-dashed border-[var(--border)] p-8 text-center">
              <RefreshCw className="h-6 w-6 text-[var(--ink-muted)]" aria-hidden="true" />
              <p className="text-sm text-[var(--ink-muted)]">No service agreements yet.</p>
            </div>
          ) : (
            <ul className="mt-5 divide-y divide-[var(--border)] rounded-md border border-[var(--border)] bg-white">
              {agreements.map((agreement) => (
                <li key={agreement.id}>
                  <Link
                    className="flex items-center justify-between gap-3 p-3 transition hover:bg-[var(--surface-muted)]"
                    href={`/admin/trades/agreements/${agreement.id}`}
                  >
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-[var(--ink)]">{agreement.name}</p>
                      <p className="truncate text-sm text-[var(--ink-muted)]">
                        {[
                          customerName.get(agreement.customer_id) ?? "Unknown customer",
                          `${formatMoney(agreement.billing_amount)} ${billingIntervalLabel(agreement.billing_interval).toLowerCase()}`,
                          agreement.next_visit_on ? `next visit ${agreement.next_visit_on}` : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </div>
                    <span className={`shrink-0 rounded-md px-2 py-1 text-xs font-semibold ${agreementStatusBadge(agreement.status)}`}>
                      {agreementStatusLabel(agreement.status)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-[var(--ink)]">New agreement</h2>
          {customers.length === 0 ? (
            <p className="mt-4 text-sm text-[var(--ink-muted)]">
              Add a{" "}
              <Link className="font-semibold text-[var(--primary)] hover:underline" href="/admin/trades/customers">
                customer
              </Link>{" "}
              first.
            </p>
          ) : (
            <form action={createServiceAgreement} className="mt-4 space-y-3">
              <label className="block space-y-1">
                <span className="text-xs font-semibold uppercase text-[var(--ink-muted)]">Customer *</span>
                <select className={inputClass} defaultValue="" name="customerId" required>
                  <option disabled value="">
                    Select a customer
                  </option>
                  {customers.map((customer) => (
                    <option key={customer.id} value={customer.id}>
                      {customer.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-semibold uppercase text-[var(--ink-muted)]">Plan name *</span>
                <input className={inputClass} name="name" placeholder="Annual HVAC maintenance" required type="text" />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block space-y-1">
                  <span className="text-xs font-semibold uppercase text-[var(--ink-muted)]">Amount</span>
                  <input className={inputClass} inputMode="decimal" min="0" name="billingAmount" placeholder="0.00" step="0.01" type="number" />
                </label>
                <label className="block space-y-1">
                  <span className="text-xs font-semibold uppercase text-[var(--ink-muted)]">Interval</span>
                  <select className={inputClass} defaultValue="monthly" name="billingInterval">
                    {BILLING_INTERVALS.map((interval) => (
                      <option key={interval} value={interval}>
                        {billingIntervalLabel(interval)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="block space-y-1">
                  <span className="text-xs font-semibold uppercase text-[var(--ink-muted)]">Visits / yr</span>
                  <input className={inputClass} min="0" name="visitsPerYear" placeholder="2" step="1" type="number" />
                </label>
                <label className="block space-y-1">
                  <span className="text-xs font-semibold uppercase text-[var(--ink-muted)]">Next visit</span>
                  <input className={inputClass} name="nextVisitOn" type="date" />
                </label>
              </div>
              <label className="block space-y-1">
                <span className="text-xs font-semibold uppercase text-[var(--ink-muted)]">Start date</span>
                <input className={inputClass} name="startOn" type="date" />
              </label>
              <button
                className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-white transition hover:opacity-90"
                type="submit"
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                Create agreement
              </button>
            </form>
          )}
        </section>
      </div>
    </AdminShell>
  );
}
