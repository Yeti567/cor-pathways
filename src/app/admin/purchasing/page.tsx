import Link from "next/link";
import { redirect } from "next/navigation";
import { Plus, ShoppingCart } from "lucide-react";
import { AdminShell } from "@/app/admin/_components/AdminShell";
import {
  Flash,
  PurchasingTabs,
  StatusBadge,
  firstParam,
  inputClass,
  primaryButtonClass,
  sectionClass,
} from "@/app/admin/purchasing/_components/PurchasingChrome";
import {
  approvalStateFor,
  loadApprovalRules,
  loadPurchasingSettings,
  type PurchaseOrderEventRow,
  type PurchaseOrderRow,
} from "@/app/admin/purchasing/_lib/purchasing-data";
import { canUseAdminPanel } from "@/lib/access-control";
import { requireAppUser } from "@/lib/current-user";
import {
  awaitsApproval,
  coercePurchaseOrderStatus,
  decideApproval,
  formatMoney,
  formatPurchaseOrderNumber,
  isPurchasingAdmin,
  parsePurchaseOrderNumber,
  purchaseOrderStatusOrder,
  purchaseOrderStatuses,
} from "@/lib/purchasing";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// The list shows the most recent orders in a tab. A tenant that needs older ones finds
// them by number or through the export, which pages through everything.
const LIST_LIMIT = 300;

type PurchasingPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function PurchasingPage({ searchParams }: PurchasingPageProps) {
  const query = await searchParams;
  const context = await requireAppUser();

  if (!canUseAdminPanel(context.appUser)) {
    redirect("/choose");
  }

  // Purchasing is gated by a tenant toggle. When off, the nav entry is hidden, so send
  // any direct hits to Setup where the toggle lives.
  if (!context.tenant?.purchasing_enabled) {
    redirect("/admin/setup");
  }

  const supabase = await createSupabaseServerClient();
  const tenantId = context.appUser.tenant_id;
  const tab = firstParam(query.tab) ?? "mine";
  const statusTab = coercePurchaseOrderStatus(tab);
  const search = (firstParam(query.q) ?? "").trim();
  const searchNumber = search ? parsePurchaseOrderNumber(search) : null;

  // Orders an approver might act on: waiting for approval, or emergency orders placed
  // before approval. Read every time, because the "awaiting my approval" count shows on
  // the tab whichever tab is open.
  const [{ data: waitingRows }, rules, settings] = await Promise.all([
    supabase
      .from("purchase_order")
      .select("*")
      .eq("tenant_id", tenantId)
      .or("status.eq.pending_approval,and(emergency.eq.true,approved_at.is.null,status.in.(ordered,partially_received,received))")
      .order("created_at", { ascending: false })
      .limit(LIST_LIMIT)
      .returns<PurchaseOrderRow[]>(),
    loadApprovalRules(supabase, tenantId),
    loadPurchasingSettings(supabase, tenantId),
  ]);

  const waiting = (waitingRows ?? []).filter((order) =>
    awaitsApproval({ approved: Boolean(order.approved_at), emergency: order.emergency, status: order.status }),
  );
  const waitingIds = waiting.map((order) => order.id);
  const { data: waitingEvents } =
    waitingIds.length > 0
      ? await supabase
          .from("purchase_order_event")
          .select("*")
          .eq("tenant_id", tenantId)
          .in("purchase_order_id", waitingIds)
          .returns<PurchaseOrderEventRow[]>()
      : { data: [] as PurchaseOrderEventRow[] };

  const eventsByOrder = new Map<string, PurchaseOrderEventRow[]>();
  for (const event of waitingEvents ?? []) {
    eventsByOrder.set(event.purchase_order_id, [...(eventsByOrder.get(event.purchase_order_id) ?? []), event]);
  }

  const isAdmin = isPurchasingAdmin(context.appUser.power_level);
  const awaitingMine = waiting.filter((order) => {
    const state = approvalStateFor({ events: eventsByOrder.get(order.id) ?? [], order, rules, settings });

    return decideApproval({
      actorIsAdmin: isAdmin,
      actorUserId: context.appUser.id,
      approvals: state.approvals,
      requesterId: order.requester_id,
      requirement: state.requirement,
    }).ok;
  });

  let orders: PurchaseOrderRow[];

  if (tab === "awaiting") {
    orders = awaitingMine;
  } else {
    let list = supabase
      .from("purchase_order")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(LIST_LIMIT);

    if (statusTab) {
      list = list.eq("status", statusTab);
    } else if (tab === "mine") {
      list = list.eq("requester_id", context.appUser.id);
    } else if (tab === "open") {
      list = list.not("status", "in", "(closed,cancelled)");
    }

    if (searchNumber !== null) {
      list = list.eq("number", searchNumber);
    } else if (search) {
      list = list.ilike("title", `%${search.replace(/[%_]/g, "")}%`);
    }

    const { data } = await list.returns<PurchaseOrderRow[]>();
    orders = data ?? [];
  }

  const [{ data: suppliers }, { data: locations }] = await Promise.all([
    supabase.from("supplier").select("id, name").eq("tenant_id", tenantId).returns<{ id: string; name: string }[]>(),
    supabase.from("locations").select("id, name").eq("tenant_id", tenantId).returns<{ id: string; name: string }[]>(),
  ]);
  const supplierName = new Map((suppliers ?? []).map((row) => [row.id, row.name]));
  const locationName = new Map((locations ?? []).map((row) => [row.id, row.name]));

  const tabs = [
    { key: "mine", label: "My orders" },
    { key: "awaiting", label: "Awaiting my approval", count: awaitingMine.length },
    { key: "open", label: "All open" },
    ...purchaseOrderStatusOrder.map((status) => ({ key: status, label: purchaseOrderStatuses[status].label })),
    { key: "all", label: "Everything" },
  ];

  return (
    <AdminShell eyebrow="Operations" tenantName={context.tenant?.name ?? "Company profile"} title="Purchasing">
      <PurchasingTabs active="/admin/purchasing" />
      <Flash error={firstParam(query.error)} notice={firstParam(query.notice)} />

      <section className={sectionClass}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-[var(--surface-muted)] text-[var(--primary)]">
              <ShoppingCart className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-[var(--ink)]">Purchase orders</h2>
              <p className="mt-1 max-w-2xl text-sm text-[var(--ink-muted)]">
                One record from request to receipt: raise it, get it approved, place it with the supplier, and receive
                it into stock. Nothing here posts to your books; the export hands your finance system a clean file.
              </p>
            </div>
          </div>
          <Link className={primaryButtonClass} href="/admin/purchasing/new">
            <Plus className="h-4 w-4" aria-hidden="true" />
            New order
          </Link>
        </div>
      </section>

      <div className="mt-4 flex flex-wrap gap-2">
        {tabs.map((entry) => (
          <Link
            aria-current={entry.key === tab ? "page" : undefined}
            className={`inline-flex h-8 items-center gap-2 rounded-full border px-3 text-xs font-semibold transition ${
              entry.key === tab
                ? "border-[var(--primary)] bg-[var(--surface-muted)] text-[var(--primary)]"
                : "border-[var(--border)] bg-white text-[var(--ink-muted)] hover:text-[var(--ink)]"
            }`}
            href={`/admin/purchasing?tab=${entry.key}`}
            key={entry.key}
          >
            {entry.label}
            {"count" in entry && entry.count ? (
              <span className="rounded-full bg-[var(--danger)] px-2 py-0.5 text-[10px] font-bold text-white">
                {entry.count}
              </span>
            ) : null}
          </Link>
        ))}
      </div>

      {tab !== "awaiting" ? (
        <form action="/admin/purchasing" className="mt-3 flex max-w-md gap-2" method="get">
          <input name="tab" type="hidden" value={tab} />
          <input
            aria-label="Search orders"
            className={inputClass}
            defaultValue={search}
            name="q"
            placeholder="PO number or title"
          />
          <button className="inline-flex h-10 items-center rounded-md border border-[var(--border)] bg-white px-3 text-sm font-semibold text-[var(--ink)]" type="submit">
            Search
          </button>
        </form>
      ) : null}

      <section className="mt-4 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-sm">
        {orders.length === 0 ? (
          <p className="p-5 text-sm text-[var(--ink-muted)]">
            {tab === "awaiting" ? "Nothing is waiting for your approval." : "No orders here yet."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] bg-[var(--surface-muted)] text-left">
                  <th className="px-4 py-3 font-semibold text-[var(--ink)]">Order</th>
                  <th className="px-4 py-3 font-semibold text-[var(--ink)]">Supplier</th>
                  <th className="px-4 py-3 font-semibold text-[var(--ink)]">Location</th>
                  <th className="px-4 py-3 font-semibold text-[var(--ink)]">Status</th>
                  <th className="px-4 py-3 text-right font-semibold text-[var(--ink)]">Total</th>
                  <th className="px-4 py-3 font-semibold text-[var(--ink)]">Needed by</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => (
                  <tr className="border-b border-[var(--border)] last:border-0" key={order.id}>
                    <td className="px-4 py-3">
                      <Link className="font-semibold text-[var(--primary)] hover:underline" href={`/admin/purchasing/${order.id}`}>
                        {formatPurchaseOrderNumber(order.number)}
                      </Link>
                      <span className="block text-[var(--ink)]">{order.title}</span>
                      {order.emergency ? (
                        <span className="text-xs font-semibold text-[var(--danger)]">Emergency</span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-[var(--ink)]">
                      {order.supplier_id ? (supplierName.get(order.supplier_id) ?? "Unknown") : "Not chosen"}
                    </td>
                    <td className="px-4 py-3 text-[var(--ink-muted)]">
                      {order.location_id ? (locationName.get(order.location_id) ?? "") : ""}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={order.status} />
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-[var(--ink)]">{formatMoney(order.total)}</td>
                    <td className="px-4 py-3 text-[var(--ink-muted)]">{order.needed_by ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </AdminShell>
  );
}
