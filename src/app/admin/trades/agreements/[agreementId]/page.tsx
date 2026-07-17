import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertTriangle, ArrowLeft } from "lucide-react";
import { updateServiceAgreement } from "@/app/admin/actions";
import { AdminShell } from "@/app/admin/_components/AdminShell";
import { canUseAdminPanel } from "@/lib/access-control";
import { requireAppUser } from "@/lib/current-user";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  AGREEMENT_STATUSES,
  agreementStatusBadge,
  agreementStatusLabel,
  annualizedAgreementValue,
  BILLING_INTERVALS,
  billingIntervalLabel,
  formatMoney,
} from "@/lib/trades";
import type { Database } from "@/types/database";

export const dynamic = "force-dynamic";

type AgreementRow = Database["public"]["Tables"]["trade_service_agreement"]["Row"];
type CustomerNameRow = Pick<Database["public"]["Tables"]["trade_customer"]["Row"], "id" | "name">;

type AgreementDetailProps = {
  params: Promise<{ agreementId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(value: string | string[] | undefined): string | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

const inputClass =
  "h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2";

export default async function TradeAgreementDetailPage({ params, searchParams }: AgreementDetailProps) {
  const context = await requireAppUser();

  if (!canUseAdminPanel(context.appUser)) {
    redirect("/choose");
  }
  if (!context.tenant?.trades_enabled) {
    redirect("/admin/setup");
  }

  const { agreementId } = await params;
  const query = await searchParams;
  const notice = firstParam(query.notice);
  const error = firstParam(query.error);

  const supabase = await createSupabaseServerClient();
  const { data: agreement } = await supabase
    .from("trade_service_agreement")
    .select("*")
    .eq("tenant_id", context.appUser.tenant_id)
    .eq("id", agreementId)
    .maybeSingle<AgreementRow>();

  if (!agreement) {
    redirect("/admin/trades/agreements?error=Agreement%20not%20found.");
  }

  const { data: customer } = await supabase
    .from("trade_customer")
    .select("id, name")
    .eq("tenant_id", context.appUser.tenant_id)
    .eq("id", agreement.customer_id)
    .maybeSingle<CustomerNameRow>();

  const annualValue = annualizedAgreementValue(agreement.billing_amount, agreement.billing_interval);

  return (
    <AdminShell eyebrow="Trades" tenantName={context.tenant?.name ?? "Company profile"} title={agreement.name}>
      <Link
        className="mb-4 inline-flex items-center gap-1 text-sm font-semibold text-[var(--primary)] hover:underline"
        href="/admin/trades/agreements"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        All agreements
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
              <h2 className="text-lg font-semibold text-[var(--ink)]">{agreement.name}</h2>
              <p className="text-sm text-[var(--ink-muted)]">
                {customer ? (
                  <Link className="text-[var(--primary)] hover:underline" href={`/admin/trades/customers/${customer.id}`}>
                    {customer.name}
                  </Link>
                ) : (
                  "Unknown customer"
                )}
              </p>
            </div>
            <span className={`rounded-md px-2 py-1 text-xs font-semibold ${agreementStatusBadge(agreement.status)}`}>
              {agreementStatusLabel(agreement.status)}
            </span>
          </div>

          <dl className="mt-4 grid gap-2 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-[var(--ink-muted)]">Billing</dt>
              <dd className="font-semibold text-[var(--ink)]">
                {formatMoney(agreement.billing_amount)} {billingIntervalLabel(agreement.billing_interval).toLowerCase()}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-[var(--ink-muted)]">Annualized</dt>
              <dd className="font-semibold text-[var(--ink)]">{formatMoney(annualValue)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-[var(--ink-muted)]">Visits / year</dt>
              <dd className="font-semibold text-[var(--ink)]">{agreement.visits_per_year}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-[var(--ink-muted)]">Start date</dt>
              <dd className="font-semibold text-[var(--ink)]">{agreement.start_on ?? "Not set"}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-[var(--ink-muted)]">Next visit</dt>
              <dd className="font-semibold text-[var(--ink)]">{agreement.next_visit_on ?? "Not scheduled"}</dd>
            </div>
          </dl>

          {agreement.notes ? (
            <p className="mt-3 whitespace-pre-wrap rounded-md bg-[var(--surface-muted)] p-3 text-sm text-[var(--ink-muted)]">
              {agreement.notes}
            </p>
          ) : null}
        </section>

        <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-[var(--ink)]">Update</h2>
          <form action={updateServiceAgreement} className="mt-4 space-y-3">
            <input name="agreementId" type="hidden" value={agreement.id} />
            <label className="block space-y-1">
              <span className="text-xs font-semibold uppercase text-[var(--ink-muted)]">Status</span>
              <select className={inputClass} defaultValue={agreement.status} name="status">
                {AGREEMENT_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {agreementStatusLabel(status)}
                  </option>
                ))}
              </select>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block space-y-1">
                <span className="text-xs font-semibold uppercase text-[var(--ink-muted)]">Amount</span>
                <input
                  className={inputClass}
                  defaultValue={Number(agreement.billing_amount)}
                  inputMode="decimal"
                  min="0"
                  name="billingAmount"
                  step="0.01"
                  type="number"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-semibold uppercase text-[var(--ink-muted)]">Interval</span>
                <select className={inputClass} defaultValue={agreement.billing_interval} name="billingInterval">
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
                <input
                  className={inputClass}
                  defaultValue={agreement.visits_per_year}
                  min="0"
                  name="visitsPerYear"
                  step="1"
                  type="number"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-semibold uppercase text-[var(--ink-muted)]">Next visit</span>
                <input className={inputClass} defaultValue={agreement.next_visit_on ?? ""} name="nextVisitOn" type="date" />
              </label>
            </div>
            <label className="block space-y-1">
              <span className="text-xs font-semibold uppercase text-[var(--ink-muted)]">Notes</span>
              <textarea
                className="min-h-20 w-full rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                defaultValue={agreement.notes ?? ""}
                name="notes"
                placeholder="Plan details, covered equipment, etc."
              />
            </label>
            <button
              className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-white transition hover:opacity-90"
              type="submit"
            >
              Save agreement
            </button>
          </form>
        </section>
      </div>
    </AdminShell>
  );
}
