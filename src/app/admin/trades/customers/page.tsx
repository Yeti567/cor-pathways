import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertTriangle, Plus, Users } from "lucide-react";
import { createTradeCustomer } from "@/app/admin/actions";
import { AdminShell } from "@/app/admin/_components/AdminShell";
import { canUseAdminPanel } from "@/lib/access-control";
import { requireAppUser } from "@/lib/current-user";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

export const dynamic = "force-dynamic";

type CustomerRow = Pick<
  Database["public"]["Tables"]["trade_customer"]["Row"],
  "id" | "name" | "contact_name" | "email" | "phone" | "status"
>;

type CustomersPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(value: string | string[] | undefined): string | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

const inputClass =
  "h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2";

export default async function TradeCustomersPage({ searchParams }: CustomersPageProps) {
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
  const { data: customerRows } = await supabase
    .from("trade_customer")
    .select("id, name, contact_name, email, phone, status")
    .eq("tenant_id", context.appUser.tenant_id)
    .order("status", { ascending: true })
    .order("name", { ascending: true })
    .returns<CustomerRow[]>();
  const customers = customerRows ?? [];

  return (
    <AdminShell eyebrow="Trades" tenantName={context.tenant?.name ?? "Company profile"} title="Customers">
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
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-[var(--ink)]">Customers</h2>
            <span className="inline-flex h-8 items-center rounded-md bg-[var(--surface-muted)] px-3 text-sm font-semibold text-[var(--ink)]">
              {customers.length}
            </span>
          </div>

          {customers.length === 0 ? (
            <div className="mt-5 flex flex-col items-center gap-2 rounded-md border border-dashed border-[var(--border)] p-8 text-center">
              <Users className="h-6 w-6 text-[var(--ink-muted)]" aria-hidden="true" />
              <p className="text-sm text-[var(--ink-muted)]">No customers yet. Add your first one to get started.</p>
            </div>
          ) : (
            <ul className="mt-5 divide-y divide-[var(--border)] rounded-md border border-[var(--border)] bg-white">
              {customers.map((customer) => (
                <li key={customer.id}>
                  <Link
                    className="flex items-center justify-between gap-3 p-3 transition hover:bg-[var(--surface-muted)]"
                    href={`/admin/trades/customers/${customer.id}`}
                  >
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-[var(--ink)]">{customer.name}</p>
                      <p className="truncate text-sm text-[var(--ink-muted)]">
                        {[customer.contact_name, customer.phone, customer.email].filter(Boolean).join(" · ") ||
                          "No contact details"}
                      </p>
                    </div>
                    {customer.status === "archived" ? (
                      <span className="rounded-md bg-[var(--surface-muted)] px-2 py-1 text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
                        Archived
                      </span>
                    ) : null}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-[var(--ink)]">Add customer</h2>
          <form action={createTradeCustomer} className="mt-4 space-y-3">
            <label className="block space-y-1">
              <span className="text-xs font-semibold uppercase text-[var(--ink-muted)]">Customer name *</span>
              <input className={inputClass} name="name" placeholder="Acme Property Group" required type="text" />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block space-y-1">
                <span className="text-xs font-semibold uppercase text-[var(--ink-muted)]">Contact</span>
                <input className={inputClass} name="contactName" placeholder="Jane Doe" type="text" />
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-semibold uppercase text-[var(--ink-muted)]">Phone</span>
                <input className={inputClass} name="phone" placeholder="(555) 123-4567" type="tel" />
              </label>
            </div>
            <label className="block space-y-1">
              <span className="text-xs font-semibold uppercase text-[var(--ink-muted)]">Email</span>
              <input className={inputClass} name="email" placeholder="jane@acme.com" type="email" />
            </label>

            <fieldset className="space-y-3 rounded-md border border-[var(--border)] bg-[var(--surface-muted)] p-3">
              <legend className="px-1 text-xs font-semibold uppercase text-[var(--ink-muted)]">
                First service address (optional)
              </legend>
              <input className={inputClass} name="addressLabel" placeholder="Label (e.g. Main office)" type="text" />
              <input className={inputClass} name="line1" placeholder="Street address" type="text" />
              <div className="grid grid-cols-2 gap-3">
                <input className={inputClass} name="city" placeholder="City" type="text" />
                <input className={inputClass} name="region" placeholder="State / Province" type="text" />
              </div>
              <input className={inputClass} name="postalCode" placeholder="ZIP / Postal code" type="text" />
            </fieldset>

            <button
              className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-white transition hover:opacity-90"
              type="submit"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Add customer
            </button>
          </form>
        </section>
      </div>
    </AdminShell>
  );
}
