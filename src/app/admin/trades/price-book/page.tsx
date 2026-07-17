import { redirect } from "next/navigation";
import { AlertTriangle, Plus, Receipt } from "lucide-react";
import { createPriceBookItem } from "@/app/admin/actions";
import { AdminShell } from "@/app/admin/_components/AdminShell";
import { canUseAdminPanel } from "@/lib/access-control";
import { requireAppUser } from "@/lib/current-user";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatMoney, PRICE_TIERS, priceTierLabel } from "@/lib/trades";
import type { Database } from "@/types/database";

export const dynamic = "force-dynamic";

type PriceBookRow = Pick<
  Database["public"]["Tables"]["trade_price_book_item"]["Row"],
  "id" | "code" | "name" | "category" | "tier" | "unit" | "unit_price" | "active"
>;

type PriceBookPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(value: string | string[] | undefined): string | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

const inputClass =
  "h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2";

export default async function TradePriceBookPage({ searchParams }: PriceBookPageProps) {
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
  const { data: itemRows } = await supabase
    .from("trade_price_book_item")
    .select("id, code, name, category, tier, unit, unit_price, active")
    .eq("tenant_id", context.appUser.tenant_id)
    .order("active", { ascending: false })
    .order("category", { ascending: true, nullsFirst: false })
    .order("name", { ascending: true })
    .returns<PriceBookRow[]>();
  const items = itemRows ?? [];

  return (
    <AdminShell eyebrow="Trades" tenantName={context.tenant?.name ?? "Company profile"} title="Price Book">
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
            <h2 className="text-lg font-semibold text-[var(--ink)]">Flat-rate items</h2>
            <span className="inline-flex h-8 items-center rounded-md bg-[var(--surface-muted)] px-3 text-sm font-semibold text-[var(--ink)]">
              {items.length}
            </span>
          </div>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">
            Reusable priced items. Add them to a work order to build a quote or invoice.
          </p>

          {items.length === 0 ? (
            <div className="mt-5 flex flex-col items-center gap-2 rounded-md border border-dashed border-[var(--border)] p-8 text-center">
              <Receipt className="h-6 w-6 text-[var(--ink-muted)]" aria-hidden="true" />
              <p className="text-sm text-[var(--ink-muted)]">No price book items yet.</p>
            </div>
          ) : (
            <ul className="mt-5 divide-y divide-[var(--border)] rounded-md border border-[var(--border)] bg-white">
              {items.map((item) => (
                <li className="flex items-center justify-between gap-3 p-3" key={item.id}>
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 font-semibold text-[var(--ink)]">
                      <span className="truncate">{item.name}</span>
                      {item.tier !== "standard" ? (
                        <span className="rounded-md bg-[var(--surface-muted)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
                          {priceTierLabel(item.tier)}
                        </span>
                      ) : null}
                      {!item.active ? (
                        <span className="rounded-md bg-[var(--surface-muted)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
                          Inactive
                        </span>
                      ) : null}
                    </p>
                    <p className="truncate text-sm text-[var(--ink-muted)]">
                      {[item.code, item.category].filter(Boolean).join(" · ") || "Uncategorized"}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="font-semibold text-[var(--ink)]">{formatMoney(item.unit_price)}</p>
                    {item.unit ? <p className="text-xs text-[var(--ink-muted)]">per {item.unit}</p> : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-[var(--ink)]">Add item</h2>
          <form action={createPriceBookItem} className="mt-4 space-y-3">
            <label className="block space-y-1">
              <span className="text-xs font-semibold uppercase text-[var(--ink-muted)]">Name *</span>
              <input className={inputClass} name="name" placeholder="AC tune-up" required type="text" />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block space-y-1">
                <span className="text-xs font-semibold uppercase text-[var(--ink-muted)]">Code</span>
                <input className={inputClass} name="code" placeholder="SKU" type="text" />
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-semibold uppercase text-[var(--ink-muted)]">Category</span>
                <input className={inputClass} name="category" placeholder="HVAC" type="text" />
              </label>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="block space-y-1">
                <span className="text-xs font-semibold uppercase text-[var(--ink-muted)]">Tier</span>
                <select className={inputClass} defaultValue="standard" name="tier">
                  {PRICE_TIERS.map((tier) => (
                    <option key={tier} value={tier}>
                      {priceTierLabel(tier)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-semibold uppercase text-[var(--ink-muted)]">Unit</span>
                <input className={inputClass} name="unit" placeholder="each / hour / flat" type="text" />
              </label>
            </div>
            <label className="block space-y-1">
              <span className="text-xs font-semibold uppercase text-[var(--ink-muted)]">Unit price</span>
              <input
                className={inputClass}
                inputMode="decimal"
                min="0"
                name="unitPrice"
                placeholder="0.00"
                step="0.01"
                type="number"
              />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-semibold uppercase text-[var(--ink-muted)]">Description</span>
              <textarea
                className="min-h-16 w-full rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                name="description"
                placeholder="What's included"
              />
            </label>
            <button
              className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-white transition hover:opacity-90"
              type="submit"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Add item
            </button>
          </form>
        </section>
      </div>
    </AdminShell>
  );
}
