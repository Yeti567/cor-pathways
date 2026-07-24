import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowDownLeft, ArrowUpRight, Package, X } from "lucide-react";
import { AdminShell } from "@/app/admin/_components/AdminShell";
import { canUseAdminPanel } from "@/lib/access-control";
import { requireAppUser } from "@/lib/current-user";
import { buildInventoryGrid, gridCellQty } from "@/lib/inventory-grid";
import { formatInventoryQty, inventoryMovementTypes } from "@/lib/inventory-ledger";
import { coerceInventoryLocationKind, inventoryLocationKinds, inventoryLocationLabel } from "@/lib/inventory-locations";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database, InventoryLocationKind } from "@/types/database";

export const dynamic = "force-dynamic";

type BalanceRow = Database["public"]["Tables"]["inventory_balance"]["Row"];
type MovementRow = Database["public"]["Tables"]["inventory_movement"]["Row"];
type ItemRow = Pick<
  Database["public"]["Tables"]["inventory_item"]["Row"],
  "id" | "name" | "category_id" | "unit_of_measure"
>;
type CategoryRow = Pick<Database["public"]["Tables"]["inventory_category"]["Row"], "id" | "name">;
type PlaceRow = Database["public"]["Tables"]["inventory_location"]["Row"];
type LocationRef = Pick<Database["public"]["Tables"]["locations"]["Row"], "id" | "name">;
type EquipmentRef = Pick<Database["public"]["Tables"]["equipment"]["Row"], "id" | "unit_number" | "name">;
type UserRef = Pick<Database["public"]["Tables"]["users"]["Row"], "id" | "full_name" | "email">;

type OnHandPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

const selectClass =
  "h-10 rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2";

export default async function InventoryOnHandPage({ searchParams }: OnHandPageProps) {
  const params = await searchParams;
  const context = await requireAppUser();

  if (!canUseAdminPanel(context.appUser)) {
    redirect("/choose");
  }

  if (!context.tenant?.inventory_enabled) {
    redirect("/admin/setup");
  }

  const supabase = await createSupabaseServerClient();
  const tenantId = context.appUser.tenant_id;

  const [{ data: balances }, { data: items }, { data: categories }, { data: places }, { data: locations }, { data: equipment }, { data: users }] =
    await Promise.all([
      supabase.from("inventory_balance").select("*").eq("tenant_id", tenantId).returns<BalanceRow[]>(),
      supabase
        .from("inventory_item")
        .select("id, name, category_id, unit_of_measure")
        .eq("tenant_id", tenantId)
        .is("deleted_at", null)
        .returns<ItemRow[]>(),
      supabase
        .from("inventory_category")
        .select("id, name")
        .eq("tenant_id", tenantId)
        .order("name", { ascending: true })
        .returns<CategoryRow[]>(),
      supabase.from("inventory_location").select("*").eq("tenant_id", tenantId).returns<PlaceRow[]>(),
      supabase.from("locations").select("id, name").eq("tenant_id", tenantId).returns<LocationRef[]>(),
      supabase
        .from("equipment")
        .select("id, unit_number, name")
        .eq("tenant_id", tenantId)
        .is("deleted_at", null)
        .returns<EquipmentRef[]>(),
      supabase.from("users").select("id, full_name, email").eq("tenant_id", tenantId).returns<UserRef[]>(),
    ]);

  const locationNameById = new Map((locations ?? []).map((row) => [row.id, row.name]));
  const equipmentNameById = new Map(
    (equipment ?? []).map((row) => [row.id, row.name ? `${row.unit_number} — ${row.name}` : row.unit_number]),
  );
  const userNameById = new Map((users ?? []).map((row) => [row.id, row.full_name || row.email]));

  function placeLabel(place: PlaceRow) {
    const backing =
      (place.location_id ? locationNameById.get(place.location_id) : null) ??
      (place.equipment_id ? equipmentNameById.get(place.equipment_id) : null) ??
      (place.user_id ? userNameById.get(place.user_id) : null) ??
      null;

    return inventoryLocationLabel(place, backing);
  }

  const itemById = new Map((items ?? []).map((item) => [item.id, item]));
  const placeById = new Map((places ?? []).map((place) => [place.id, place]));

  const categoryFilter = firstParam(params.category) ?? "";
  const kindFilter = coerceInventoryLocationKind(firstParam(params.kind)) ?? "";

  const grid = buildInventoryGrid(
    (balances ?? []).map((balance) => ({
      item_id: balance.item_id,
      location_id: balance.location_id,
      qty: Number(balance.qty),
    })),
    (items ?? []).map((item) => ({
      id: item.id,
      name: item.name,
      category_id: item.category_id,
      unit_of_measure: item.unit_of_measure,
    })),
    (places ?? []).map((place) => ({ id: place.id, kind: place.kind, label: placeLabel(place) })),
    { categoryId: categoryFilter || null, kind: kindFilter },
  );

  // Which kinds are worth offering as a filter: only the ones a place actually uses.
  const usedKinds = [...new Set((places ?? []).map((place) => place.kind))];

  // The drill-down. A cell links to ?item=&place=, which loads that pair's history.
  const drillItemId = firstParam(params.item) ?? null;
  const drillPlaceId = firstParam(params.place) ?? null;
  const drillItem = drillItemId ? itemById.get(drillItemId) : null;
  const drillPlace = drillPlaceId ? placeById.get(drillPlaceId) : null;

  let drillMovements: MovementRow[] = [];
  if (drillItem && drillPlace) {
    const { data } = await supabase
      .from("inventory_movement")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("item_id", drillItem.id)
      .or(`from_location_id.eq.${drillPlace.id},to_location_id.eq.${drillPlace.id}`)
      .order("occurred_at", { ascending: false })
      .limit(50)
      .returns<MovementRow[]>();
    drillMovements = data ?? [];
  }

  const filterQuery = new URLSearchParams();
  if (categoryFilter) filterQuery.set("category", categoryFilter);
  if (kindFilter) filterQuery.set("kind", kindFilter);
  const filterSuffix = filterQuery.toString();

  function cellHref(itemId: string, placeId: string) {
    const query = new URLSearchParams(filterSuffix);
    query.set("item", itemId);
    query.set("place", placeId);
    return `/admin/inventory/on-hand?${query.toString()}`;
  }

  return (
    <AdminShell eyebrow="Inventory" tenantName={context.tenant?.name ?? "Company profile"} title="On hand">
      <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-[var(--surface-muted)] text-[var(--primary)]">
            <Package className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-[var(--ink)]">How many, and where</h2>
            <p className="mt-1 max-w-2xl text-sm text-[var(--ink-muted)]">
              Every item against every place that holds it. Empty places and used-up items drop out, so what is left is
              only what you actually have. Select a number to see the movements behind it. To bring stock in or move it,
              use{" "}
              <Link className="font-semibold text-[var(--primary)] hover:underline" href="/admin/inventory/stock">
                Stock
              </Link>
              .
            </p>
          </div>
        </div>

        <form className="mt-4 flex flex-wrap items-end gap-3" method="get">
          <label className="space-y-1">
            <span className="block text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">Category</span>
            <select className={selectClass} defaultValue={categoryFilter} name="category">
              <option value="">All categories</option>
              {(categories ?? []).map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="block text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
              Kind of place
            </span>
            <select className={selectClass} defaultValue={kindFilter} name="kind">
              <option value="">All places</option>
              {usedKinds.map((kind) => (
                <option key={kind} value={kind}>
                  {inventoryLocationKinds[kind as InventoryLocationKind].label}
                </option>
              ))}
            </select>
          </label>
          <button
            className="inline-flex h-10 items-center rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-white transition hover:opacity-90"
            type="submit"
          >
            Apply
          </button>
          {filterSuffix ? (
            <Link
              className="inline-flex h-10 items-center rounded-md border border-[var(--border)] bg-white px-4 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)]"
              href="/admin/inventory/on-hand"
            >
              Clear
            </Link>
          ) : null}
        </form>
      </section>

      {grid.rows.length > 0 ? (
        <section className="mt-5 overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-sm">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] bg-[var(--surface-muted)] text-left">
                <th className="sticky left-0 z-10 bg-[var(--surface-muted)] px-4 py-3 font-semibold text-[var(--ink)]">
                  Item
                </th>
                {grid.columns.map((column) => (
                  <th
                    className={`px-4 py-3 text-right font-semibold ${
                      column.virtual ? "text-[var(--ink-muted)]" : "text-[var(--ink)]"
                    }`}
                    key={column.place.id}
                  >
                    {column.place.label}
                  </th>
                ))}
                <th className="px-4 py-3 text-right font-semibold text-[var(--ink)]">Total</th>
              </tr>
            </thead>
            <tbody>
              {grid.rows.map((row) => (
                <tr className="border-b border-[var(--border)] last:border-0" key={row.item.id}>
                  <th className="sticky left-0 z-10 bg-[var(--surface)] px-4 py-3 text-left font-medium text-[var(--ink)]">
                    {row.item.name}
                    <span className="ml-1 text-xs font-normal text-[var(--ink-muted)]">{row.item.unit_of_measure}</span>
                  </th>
                  {grid.columns.map((column) => {
                    const qty = gridCellQty(row, column.place.id);

                    return (
                      <td className="px-4 py-3 text-right tabular-nums" key={column.place.id}>
                        {qty === 0 ? (
                          <span className="text-[var(--ink-muted)]">·</span>
                        ) : (
                          <Link
                            className={`font-semibold hover:underline ${
                              qty < 0 ? "text-[var(--danger)]" : "text-[var(--ink)]"
                            }`}
                            href={cellHref(row.item.id, column.place.id)}
                          >
                            {formatInventoryQty(qty)}
                          </Link>
                        )}
                      </td>
                    );
                  })}
                  <td className="px-4 py-3 text-right font-bold tabular-nums text-[var(--ink)]">
                    {formatInventoryQty(row.total)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-[var(--border)] bg-[var(--surface-muted)]">
                <th className="sticky left-0 z-10 bg-[var(--surface-muted)] px-4 py-3 text-left font-semibold text-[var(--ink)]">
                  Total
                </th>
                {grid.columns.map((column) => (
                  <td className="px-4 py-3 text-right font-semibold tabular-nums text-[var(--ink)]" key={column.place.id}>
                    {formatInventoryQty(column.total)}
                  </td>
                ))}
                <td className="px-4 py-3 text-right font-bold tabular-nums text-[var(--ink)]">
                  {formatInventoryQty(grid.grandTotal)}
                </td>
              </tr>
            </tfoot>
          </table>
        </section>
      ) : (
        <section className="mt-5 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm">
          <p className="text-sm text-[var(--ink-muted)]">
            {balances?.length
              ? "Nothing matches these filters."
              : "Nothing on hand yet. Record a receipt under Stock to bring stock in."}
          </p>
        </section>
      )}

      {drillItem && drillPlace ? (
        <section className="mt-5 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-base font-semibold text-[var(--ink)]">
                {drillItem.name} at {placeLabel(drillPlace)}
              </h3>
              <p className="mt-1 text-sm text-[var(--ink-muted)]">
                Every movement that touched this item at this place, newest first.
              </p>
            </div>
            <Link
              aria-label="Close history"
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border)] bg-white text-[var(--ink-muted)] transition hover:bg-[var(--surface-muted)]"
              href={filterSuffix ? `/admin/inventory/on-hand?${filterSuffix}` : "/admin/inventory/on-hand"}
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>

          {drillMovements.length > 0 ? (
            <ul className="mt-4 divide-y divide-[var(--border)]">
              {drillMovements.map((movement) => {
                const isIn = movement.to_location_id === drillPlace.id;

                return (
                  <li className="flex items-start gap-3 py-3" key={movement.id}>
                    <div
                      className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
                        isIn ? "bg-emerald-50 text-[var(--success)]" : "bg-amber-50 text-[var(--warning)]"
                      }`}
                    >
                      {isIn ? (
                        <ArrowDownLeft className="h-4 w-4" aria-hidden="true" />
                      ) : (
                        <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm text-[var(--ink)]">
                        <span className="font-semibold tabular-nums">
                          {isIn ? "+" : "−"}
                          {formatInventoryQty(Number(movement.qty))} {drillItem.unit_of_measure}
                        </span>{" "}
                        {inventoryMovementTypes[movement.movement_type].label.toLowerCase()}
                      </p>
                      <p className="mt-0.5 text-xs text-[var(--ink-muted)]">
                        {new Date(movement.occurred_at).toLocaleString()}
                        {movement.note ? ` · ${movement.note}` : ""}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="mt-4 text-sm text-[var(--ink-muted)]">No movements found for this pair.</p>
          )}
        </section>
      ) : null}
    </AdminShell>
  );
}
