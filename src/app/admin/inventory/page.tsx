import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ArrowLeftRight,
  BellRing,
  Boxes,
  ClipboardCheck,
  Layers,
  MapPin,
  Package,
  Smartphone,
  Truck,
} from "lucide-react";
import { AdminShell } from "@/app/admin/_components/AdminShell";
import { canUseAdminPanel } from "@/lib/access-control";
import { requireAppUser } from "@/lib/current-user";
import { formatInventoryQty } from "@/lib/inventory-ledger";
import { sendInventoryLowStockNotifications } from "@/lib/inventory-reminders";
import {
  lowStockLevels,
  summariseInventoryStockLevels,
  type StockLevelBalance,
  type StockLevelItem,
} from "@/lib/inventory-stock-levels";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// What the inventory module holds, built out over successive slices. An area with an
// href is live; the rest carry the stage they are at rather than a link that would lead
// to a dead route. Areas gain an href as their slice lands.
const upcomingAreas = [
  {
    description:
      "What you stock, and how each thing behaves: counted in bulk or tracked one by one, whether it comes back, and whether time on site is billable.",
    href: "/admin/inventory/items",
    icon: Boxes,
    stage: "Ready",
    title: "Items",
  },
  {
    description: "Groups for filtering your items: Mats, Tools, PPE, Parts, Consumables. Optional, and easy to change.",
    href: "/admin/inventory/categories",
    icon: Layers,
    stage: "Ready",
    title: "Categories",
  },
  {
    description:
      "Your yards, customer sites, trucks, and crews all become places stock can sit, so the same movement covers a delivery, a tool check-out, and truck stock.",
    href: "/admin/inventory/locations",
    icon: MapPin,
    stage: "Ready",
    title: "Stocking Places",
  },
  {
    description:
      "Bring stock in, move it between places, and write it off. Every change is a movement between two places, so a quantity is never simply edited.",
    href: "/admin/inventory/stock",
    icon: ArrowLeftRight,
    stage: "Ready",
    title: "Stock & Movements",
  },
  {
    description:
      "A grid of what you have and where it is, filtered by category and place, with the full movement history behind every number.",
    href: "/admin/inventory/on-hand",
    icon: Package,
    stage: "Ready",
    title: "On Hand",
  },
  {
    description:
      "Move a load between places in two legs: it leaves, it sits in transit, it arrives. A load that never arrives stays visible instead of quietly vanishing.",
    href: "/admin/inventory/transfers",
    icon: Truck,
    stage: "Ready",
    title: "Transfers",
  },
  {
    description:
      "The driver records a pickup or a drop from their phone, with photos and a signature. Works with no signal and syncs when it comes back.",
    icon: Smartphone,
    stage: "Planned",
    title: "Field Capture",
  },
  {
    description:
      "Count what is actually there and enter the real number. The system works out the difference and records it, so nobody edits a balance by hand.",
    href: "/admin/inventory/counts",
    icon: ClipboardCheck,
    stage: "Ready",
    title: "Counts & Reconciliation",
  },
  {
    description:
      "Set a reorder point on the things you must not run out of, and get told before you do. Shows here and notifies your managers. Mostly for PPE and consumables.",
    href: "/admin/inventory/items",
    icon: BellRing,
    stage: "Ready",
    title: "Low Stock Alerts",
  },
] as const;

export default async function InventoryPage() {
  const context = await requireAppUser();

  if (!canUseAdminPanel(context.appUser)) {
    redirect("/choose");
  }

  // The Inventory module is gated by a tenant toggle. When off, the nav entry is
  // hidden, so send any direct hits to Setup where the toggle lives.
  if (!context.tenant?.inventory_enabled) {
    redirect("/admin/setup");
  }

  const supabase = await createSupabaseServerClient();
  const tenantId = context.appUser.tenant_id;

  // Raise low-stock notifications on the way in, deduped, the same way the equipment
  // dashboard raises service reminders. Landing here is the natural moment to check.
  await sendInventoryLowStockNotifications(tenantId);

  const [{ data: watchedItems }, { data: balances }] = await Promise.all([
    supabase
      .from("inventory_item")
      .select("id, name, unit_of_measure, reorder_point, active")
      .eq("tenant_id", tenantId)
      .is("deleted_at", null)
      .eq("active", true)
      .not("reorder_point", "is", null)
      .returns<StockLevelItem[]>(),
    supabase
      .from("inventory_balance")
      .select("item_id, qty, allows_negative")
      .eq("tenant_id", tenantId)
      .returns<StockLevelBalance[]>(),
  ]);

  const lowStock = lowStockLevels(summariseInventoryStockLevels(watchedItems ?? [], balances ?? []));

  return (
    <AdminShell eyebrow="Operations" tenantName={context.tenant?.name ?? "Company profile"} title="Inventory">
      {lowStock.length > 0 ? (
        <section className="mb-4 rounded-lg border border-[var(--warning)] bg-amber-50 p-4 shadow-sm">
          <div className="flex items-start gap-3">
            <BellRing className="mt-0.5 h-5 w-5 shrink-0 text-[var(--warning)]" aria-hidden="true" />
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-[var(--warning)]">
                {lowStock.length} item{lowStock.length === 1 ? "" : "s"} to reorder
              </h2>
              <ul className="mt-2 space-y-1 text-sm text-[var(--ink)]">
                {lowStock.map((level) => (
                  <li key={level.itemId}>
                    <Link className="font-semibold hover:underline" href="/admin/inventory/items">
                      {level.name}
                    </Link>
                    :{" "}
                    {level.state === "out" ? (
                      <span className="font-semibold text-[var(--danger)]">out of stock</span>
                    ) : (
                      <>
                        {formatInventoryQty(level.onHand)} {level.unit} on hand
                      </>
                    )}
                    <span className="text-[var(--ink-muted)]">
                      {" "}
                      (reorder at {formatInventoryQty(level.reorderPoint)})
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>
      ) : null}

      <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-[var(--surface-muted)] text-[var(--primary)]">
            <Package className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-[var(--ink)]">Inventory</h2>
            <p className="mt-1 max-w-2xl text-sm text-[var(--ink-muted)]">
              Two questions about anything you count: how many, and where. Rental units on customer sites, tools out
              with a crew, parts on a truck, PPE and consumables in the yard. Turn this module off under{" "}
              <Link className="font-semibold text-[var(--primary)] hover:underline" href="/admin/setup">
                Setup
              </Link>{" "}
              if you do not need to count stock.
            </p>
          </div>
        </div>
      </section>

      <section className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
        <h3 className="text-base font-semibold text-[var(--ink)]">Start by listing what you stock</h3>
        <p className="mt-1 max-w-2xl text-sm text-[var(--ink-muted)]">
          Set up your{" "}
          <Link className="font-semibold text-[var(--primary)] hover:underline" href="/admin/inventory/items">
            items
          </Link>{" "}
          and your stocking places, then record what you have under Stock. Start with the handful you move most.
        </p>
      </section>

      <section className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
        <h3 className="text-base font-semibold text-[var(--ink)]">Module areas</h3>
        <p className="mt-1 text-sm text-[var(--ink-muted)]">Where this is going, in the order it is being built.</p>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {upcomingAreas.map((area) => {
            const Icon = area.icon;
            const href = "href" in area ? area.href : undefined;

            const body = (
              <>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-md bg-[var(--surface-muted)] text-[var(--primary)]">
                    <Icon className="h-5 w-5" aria-hidden="true" />
                  </div>
                  <span className="inline-flex items-center rounded-md bg-[var(--surface-muted)] px-2 py-1 text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
                    {area.stage}
                  </span>
                </div>
                <h4 className="mt-3 text-base font-semibold text-[var(--ink)]">{area.title}</h4>
                <p className="mt-1 text-sm text-[var(--ink-muted)]">{area.description}</p>
              </>
            );

            return href ? (
              <Link
                className="rounded-lg border border-[var(--border)] bg-white p-4 transition hover:border-[var(--primary)] hover:bg-[var(--surface-muted)]"
                href={href}
                key={area.title}
              >
                {body}
              </Link>
            ) : (
              <div className="rounded-lg border border-[var(--border)] bg-white p-4" key={area.title}>
                {body}
              </div>
            );
          })}
        </div>
      </section>
    </AdminShell>
  );
}
