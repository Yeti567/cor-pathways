import Link from "next/link";
import { redirect } from "next/navigation";
import { Receipt } from "lucide-react";
import { AdminShell } from "@/app/admin/_components/AdminShell";
import { canUseAdminPanel } from "@/lib/access-control";
import { requireAppUser } from "@/lib/current-user";
import {
  billableSiteKinds,
  buildRentalCharges,
  formatRentalRate,
  type BillingItem,
  type BillingMovement,
} from "@/lib/inventory-billing";
import { inventoryLocationLabel } from "@/lib/inventory-locations";
import { formatInventoryQty } from "@/lib/inventory-ledger";
import { formatMoney } from "@/lib/trades";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

export const dynamic = "force-dynamic";

type ItemRow = Pick<
  Database["public"]["Tables"]["inventory_item"]["Row"],
  "id" | "name" | "unit_of_measure" | "billable" | "default_rate" | "rate_basis"
>;
type PlaceRow = Database["public"]["Tables"]["inventory_location"]["Row"];
type LocationRef = Pick<Database["public"]["Tables"]["locations"]["Row"], "id" | "name">;
type MovementRow = Pick<
  Database["public"]["Tables"]["inventory_movement"]["Row"],
  "item_id" | "from_location_id" | "to_location_id" | "qty" | "occurred_at"
>;

type BillingPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const DAY_MS = 86_400_000;

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

/** A date input value (YYYY-MM-DD) for a UTC day, so the report is deterministic. */
function dateInputValue(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Parse a YYYY-MM-DD as UTC midnight, or null if it is not a valid date string. */
function parseDay(value: string | undefined): number | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }
  const ms = Date.parse(`${value}T00:00:00Z`);
  return Number.isNaN(ms) ? null : ms;
}

const inputClass =
  "h-10 rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2";

export default async function InventoryBillingPage({ searchParams }: BillingPageProps) {
  const params = await searchParams;
  const context = await requireAppUser();

  if (!canUseAdminPanel(context.appUser)) {
    redirect("/choose");
  }

  if (!context.tenant?.inventory_enabled) {
    redirect("/admin/setup");
  }

  const nowMs = new Date().getTime();

  // Default period: the last 30 days through today. The "to" day is billed in full, but
  // never past now, so an open rental is charged up to the moment the report is run.
  const fromMs = parseDay(firstParam(params.from)) ?? nowMs - 30 * DAY_MS;
  const toDayMs = parseDay(firstParam(params.to)) ?? nowMs;
  const periodStartMs = fromMs;
  const periodEndMs = Math.min(nowMs, toDayMs + DAY_MS);
  const invalidRange = periodEndMs <= periodStartMs;

  const supabase = await createSupabaseServerClient();
  const tenantId = context.appUser.tenant_id;

  const [{ data: items }, { data: places }, { data: locations }] = await Promise.all([
    supabase
      .from("inventory_item")
      .select("id, name, unit_of_measure, billable, default_rate, rate_basis")
      .eq("tenant_id", tenantId)
      .eq("billable", true)
      .is("deleted_at", null)
      .returns<ItemRow[]>(),
    supabase.from("inventory_location").select("*").eq("tenant_id", tenantId).returns<PlaceRow[]>(),
    supabase.from("locations").select("id, name").eq("tenant_id", tenantId).returns<LocationRef[]>(),
  ]);

  const locationNameById = new Map((locations ?? []).map((row) => [row.id, row.name]));
  const siteRows = (places ?? []).filter((place) => billableSiteKinds.includes(place.kind));
  const billingPlaces = siteRows.map((place) => ({
    id: place.id,
    kind: place.kind,
    label: inventoryLocationLabel(place, place.location_id ? locationNameById.get(place.location_id) : null),
  }));

  const billingItems: BillingItem[] = (items ?? [])
    .filter((item) => item.default_rate !== null && item.rate_basis !== null)
    .map((item) => ({
      billable: item.billable,
      default_rate: Number(item.default_rate),
      id: item.id,
      name: item.name,
      rate_basis: item.rate_basis,
      unit_of_measure: item.unit_of_measure,
    }));

  // Only the movements that can matter: billable items touching a billable site, up to the
  // period end. Everything before the period sets the opening quantity on site.
  let movements: BillingMovement[] = [];
  if (!invalidRange && billingItems.length > 0 && siteRows.length > 0) {
    const siteIds = siteRows.map((site) => site.id);
    const idList = `(${siteIds.join(",")})`;
    const { data } = await supabase
      .from("inventory_movement")
      .select("item_id, from_location_id, to_location_id, qty, occurred_at")
      .eq("tenant_id", tenantId)
      .in(
        "item_id",
        billingItems.map((item) => item.id),
      )
      .lt("occurred_at", new Date(periodEndMs).toISOString())
      .or(`from_location_id.in.${idList},to_location_id.in.${idList}`)
      .returns<MovementRow[]>();
    movements = data ?? [];
  }

  const report = invalidRange
    ? { lines: [], periodEndMs, periodStartMs, sites: [], total: 0 }
    : buildRentalCharges({ items: billingItems, movements, periodEndMs, periodStartMs, places: billingPlaces });

  const linesBySite = new Map<string, typeof report.lines>();
  for (const line of report.lines) {
    const bucket = linesBySite.get(line.siteId) ?? [];
    bucket.push(line);
    linesBySite.set(line.siteId, bucket);
  }

  return (
    <AdminShell eyebrow="Inventory" tenantName={context.tenant?.name ?? "Company profile"} title="Billing">
      <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-[var(--surface-muted)] text-[var(--primary)]">
            <Receipt className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-[var(--ink)]">Rental charges</h2>
            <p className="mt-1 max-w-2xl text-sm text-[var(--ink-muted)]">
              What each customer site owes for a period, worked out from the ledger: how many units sat there, for how
              long, at the item&apos;s rate. A partial pickup lowers the quantity for the rest of the period on its own,
              so a shortened rental needs no special handling. This is a report to bill from, not an invoice, and it is
              set on each item under{" "}
              <Link className="font-semibold text-[var(--primary)] hover:underline" href="/admin/inventory/items">
                Items
              </Link>
              .
            </p>
          </div>
        </div>

        <form className="mt-4 flex flex-wrap items-end gap-3" method="get">
          <label className="space-y-1">
            <span className="block text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">From</span>
            <input className={inputClass} defaultValue={dateInputValue(periodStartMs)} name="from" type="date" />
          </label>
          <label className="space-y-1">
            <span className="block text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">To</span>
            <input className={inputClass} defaultValue={dateInputValue(Math.min(toDayMs, nowMs))} name="to" type="date" />
          </label>
          <button
            className="inline-flex h-10 items-center rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-white transition hover:opacity-90"
            type="submit"
          >
            Run
          </button>
        </form>
        {invalidRange ? (
          <p className="mt-3 rounded-md border border-[var(--danger)] bg-red-50 p-3 text-sm text-[var(--danger)]">
            The end date has to be after the start date.
          </p>
        ) : null}
      </section>

      {report.lines.length > 0 ? (
        <>
          <section className="mt-4 flex items-center justify-between rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
            <div>
              <p className="text-sm text-[var(--ink-muted)]">Total for the period</p>
              <p className="text-xs text-[var(--ink-muted)]">
                {dateInputValue(periodStartMs)} to {dateInputValue(Math.min(toDayMs, nowMs))}
              </p>
            </div>
            <p className="text-2xl font-bold tabular-nums text-[var(--ink)]">{formatMoney(report.total)}</p>
          </section>

          <div className="mt-4 space-y-4">
            {report.sites.map((site) => (
              <section
                className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-sm"
                key={site.siteId}
              >
                <div className="flex items-center justify-between border-b border-[var(--border)] bg-[var(--surface-muted)] px-4 py-3">
                  <h3 className="text-sm font-semibold text-[var(--ink)]">{site.siteLabel}</h3>
                  <p className="text-sm font-bold tabular-nums text-[var(--ink)]">{formatMoney(site.amount)}</p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[560px] border-collapse text-sm">
                    <thead>
                      <tr className="border-b border-[var(--border)] text-left text-xs uppercase tracking-wide text-[var(--ink-muted)]">
                        <th className="px-4 py-2 font-semibold">Item</th>
                        <th className="px-4 py-2 text-right font-semibold">Rate</th>
                        <th className="px-4 py-2 text-right font-semibold">Billable quantity</th>
                        <th className="px-4 py-2 text-right font-semibold">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(linesBySite.get(site.siteId) ?? []).map((line) => (
                        <tr className="border-b border-[var(--border)] last:border-0" key={`${line.itemId}-${line.siteId}`}>
                          <td className="px-4 py-2 font-medium text-[var(--ink)]">{line.itemName}</td>
                          <td className="px-4 py-2 text-right tabular-nums text-[var(--ink-muted)]">
                            {formatRentalRate(line.rate, line.basis)}
                          </td>
                          <td className="px-4 py-2 text-right tabular-nums text-[var(--ink)]">
                            {formatInventoryQty(line.quantity)}{" "}
                            <span className="text-xs text-[var(--ink-muted)]">
                              {line.basis === "each" ? line.unit : `${line.unit}·${line.basis}s`}
                            </span>
                          </td>
                          <td className="px-4 py-2 text-right font-semibold tabular-nums text-[var(--ink)]">
                            {formatMoney(line.amount)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ))}
          </div>
        </>
      ) : (
        <section className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm">
          <p className="text-sm text-[var(--ink-muted)]">
            {invalidRange
              ? "Choose a valid period to see charges."
              : billingItems.length === 0
                ? "No billable items with a rate yet. Mark an item billable and set its rate under Items."
                : "Nothing to bill for this period. Charges appear once billable stock has been at a customer site."}
          </p>
        </section>
      )}
    </AdminShell>
  );
}
