import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeftRight, Boxes } from "lucide-react";
import { recordInventoryMovement } from "@/app/admin/inventory/actions";
import { AdminShell } from "@/app/admin/_components/AdminShell";
import { canUseAdminPanel } from "@/lib/access-control";
import { requireAppUser } from "@/lib/current-user";
import {
  formatInventoryQty,
  inventoryMovementTypes,
  recordableInventoryMovementTypes,
} from "@/lib/inventory-ledger";
import { inventoryLocationKinds, inventoryLocationLabel } from "@/lib/inventory-locations";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database, InventoryLocationKind } from "@/types/database";

export const dynamic = "force-dynamic";

type BalanceRow = Database["public"]["Tables"]["inventory_balance"]["Row"];
type MovementRow = Database["public"]["Tables"]["inventory_movement"]["Row"];
type ItemRef = Pick<Database["public"]["Tables"]["inventory_item"]["Row"], "id" | "name" | "unit_of_measure">;
type PlaceRow = Database["public"]["Tables"]["inventory_location"]["Row"];
type LocationRef = Pick<Database["public"]["Tables"]["locations"]["Row"], "id" | "name">;
type EquipmentRef = Pick<Database["public"]["Tables"]["equipment"]["Row"], "id" | "unit_number" | "name">;
type UserRef = Pick<Database["public"]["Tables"]["users"]["Row"], "id" | "full_name" | "email">;

type StockPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

const inputClass =
  "h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2";

export default async function InventoryStockPage({ searchParams }: StockPageProps) {
  const params = await searchParams;
  const notice = firstParam(params.notice);
  const error = firstParam(params.error);
  const context = await requireAppUser();

  if (!canUseAdminPanel(context.appUser)) {
    redirect("/choose");
  }

  if (!context.tenant?.inventory_enabled) {
    redirect("/admin/setup");
  }

  const supabase = await createSupabaseServerClient();
  const tenantId = context.appUser.tenant_id;

  const [
    { data: balances },
    { data: movements },
    { data: items },
    { data: places },
    { data: locations },
    { data: equipment },
    { data: users },
  ] = await Promise.all([
    supabase.from("inventory_balance").select("*").eq("tenant_id", tenantId).returns<BalanceRow[]>(),
    supabase
      .from("inventory_movement")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("occurred_at", { ascending: false })
      .limit(25)
      .returns<MovementRow[]>(),
    supabase
      .from("inventory_item")
      .select("id, name, unit_of_measure")
      .eq("tenant_id", tenantId)
      .is("deleted_at", null)
      .eq("active", true)
      .order("name", { ascending: true })
      .returns<ItemRef[]>(),
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

  const placeRows = places ?? [];
  const placeById = new Map(placeRows.map((place) => [place.id, place]));
  const itemById = new Map((items ?? []).map((item) => [item.id, item]));

  // Only real places are offered as an origin or destination. Transit and loss are
  // reached by recording the movement that puts stock there, never by picking them.
  const selectablePlaces = placeRows
    .filter((place) => place.active && !inventoryLocationKinds[place.kind as InventoryLocationKind].virtual)
    .map((place) => ({ id: place.id, label: placeLabel(place) }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const nonZeroBalances = (balances ?? [])
    .filter((balance) => Number(balance.qty) !== 0)
    .map((balance) => ({
      ...balance,
      itemName: itemById.get(balance.item_id)?.name ?? "Unknown item",
      placeName: placeById.has(balance.location_id) ? placeLabel(placeById.get(balance.location_id)!) : "Unknown place",
      unit: itemById.get(balance.item_id)?.unit_of_measure ?? "",
    }))
    .sort((a, b) => a.itemName.localeCompare(b.itemName) || a.placeName.localeCompare(b.placeName));

  const stuckInTransit = nonZeroBalances.filter(
    (balance) => placeById.get(balance.location_id)?.kind === "transit",
  );

  return (
    <AdminShell eyebrow="Inventory" tenantName={context.tenant?.name ?? "Company profile"} title="Stock">
      {notice ? (
        <p className="mb-4 rounded-md border border-[var(--success)] bg-emerald-50 p-3 text-sm text-[var(--success)]">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className="mb-4 rounded-md border border-[var(--danger)] bg-red-50 p-3 text-sm text-[var(--danger)]">
          {error}
        </p>
      ) : null}

      <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-[var(--surface-muted)] text-[var(--primary)]">
            <ArrowLeftRight className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-[var(--ink)]">Stock movements</h2>
            <p className="mt-1 max-w-2xl text-sm text-[var(--ink-muted)]">
              Every change is recorded as a movement between two places, so a quantity is never simply edited. To
              correct a mistake, record the movement that puts it right; the history then explains itself. You will
              need at least one{" "}
              <Link className="font-semibold text-[var(--primary)] hover:underline" href="/admin/inventory/items">
                item
              </Link>{" "}
              and one{" "}
              <Link className="font-semibold text-[var(--primary)] hover:underline" href="/admin/inventory/locations">
                stocking place
              </Link>
              .
            </p>
          </div>
        </div>
      </section>

      {stuckInTransit.length > 0 ? (
        <section className="mt-4 rounded-lg border border-[var(--warning)] bg-amber-50 p-4">
          <h3 className="text-sm font-semibold text-[var(--warning)]">In transit</h3>
          <p className="mt-1 text-sm text-[var(--ink)]">
            {stuckInTransit.length} item{stuckInTransit.length === 1 ? "" : "s"} left one place and have not been
            recorded as arriving. A negative figure means more was delivered than was loaded, which is worth chasing
            rather than correcting quietly.
          </p>
          <ul className="mt-2 space-y-1 text-sm text-[var(--ink)]">
            {stuckInTransit.map((balance) => (
              <li key={`${balance.item_id}-${balance.location_id}`}>
                {balance.itemName}: {formatInventoryQty(Number(balance.qty))} {balance.unit}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="mt-5 grid gap-5 xl:grid-cols-[1fr_420px]">
        <div className="space-y-5">
          <section className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-sm">
            <div className="flex items-center justify-between border-b border-[var(--border)] bg-[var(--surface-muted)] px-4 py-3">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-[var(--ink-muted)]">On hand</h3>
              <Link
                className="text-sm font-semibold text-[var(--primary)] hover:underline"
                href="/admin/inventory/on-hand"
              >
                Full grid
              </Link>
            </div>
            {nonZeroBalances.length > 0 ? (
              <div className="divide-y divide-[var(--border)]">
                {nonZeroBalances.map((balance) => (
                  <div
                    className="flex items-center justify-between gap-3 px-4 py-3"
                    key={`${balance.item_id}-${balance.location_id}`}
                  >
                    <div>
                      <p className="text-sm font-semibold text-[var(--ink)]">{balance.itemName}</p>
                      <p className="text-sm text-[var(--ink-muted)]">{balance.placeName}</p>
                    </div>
                    <p
                      className={`text-lg font-bold tabular-nums ${
                        Number(balance.qty) < 0 ? "text-[var(--danger)]" : "text-[var(--ink)]"
                      }`}
                    >
                      {formatInventoryQty(Number(balance.qty))}{" "}
                      <span className="text-sm font-normal text-[var(--ink-muted)]">{balance.unit}</span>
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="p-6 text-sm text-[var(--ink-muted)]">
                Nothing on hand yet. Record a receipt on the right to bring stock in.
              </p>
            )}
          </section>

          <section className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-sm">
            <h3 className="border-b border-[var(--border)] bg-[var(--surface-muted)] px-4 py-3 text-sm font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
              Recent movements
            </h3>
            {(movements ?? []).length > 0 ? (
              <div className="divide-y divide-[var(--border)]">
                {(movements ?? []).map((movement) => {
                  const from = movement.from_location_id ? placeById.get(movement.from_location_id) : null;
                  const to = movement.to_location_id ? placeById.get(movement.to_location_id) : null;

                  return (
                    <div className="px-4 py-3" key={movement.id}>
                      <p className="text-sm text-[var(--ink)]">
                        <span className="font-semibold">
                          {formatInventoryQty(Number(movement.qty))} {itemById.get(movement.item_id)?.name ?? "item"}
                        </span>{" "}
                        {inventoryMovementTypes[movement.movement_type].verb}
                        {from ? ` from ${placeLabel(from)}` : ""}
                        {to ? ` to ${placeLabel(to)}` : ""}
                      </p>
                      <p className="mt-1 text-xs text-[var(--ink-muted)]">
                        {new Date(movement.occurred_at).toLocaleString()}
                        {movement.note ? ` · ${movement.note}` : ""}
                      </p>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="p-6 text-sm text-[var(--ink-muted)]">No movements recorded yet.</p>
            )}
          </section>
        </div>

        <section className="h-fit rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
          <h3 className="flex items-center gap-2 text-base font-semibold text-[var(--ink)]">
            <Boxes className="h-4 w-4 text-[var(--primary)]" aria-hidden="true" />
            Record a movement
          </h3>

          {items?.length && selectablePlaces.length ? (
            <form action={recordInventoryMovement} className="mt-4 space-y-3">
              <label className="block space-y-2">
                <span className="text-sm font-medium text-[var(--ink)]">What happened</span>
                <select className={inputClass} name="movementType" required>
                  {recordableInventoryMovementTypes.map((type) => (
                    <option key={type} value={type}>
                      {inventoryMovementTypes[type].label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block space-y-2">
                <span className="text-sm font-medium text-[var(--ink)]">Item</span>
                <select className={inputClass} name="itemId" required>
                  {(items ?? []).map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block space-y-2">
                <span className="text-sm font-medium text-[var(--ink)]">Quantity</span>
                <input className={inputClass} inputMode="decimal" name="qty" placeholder="60" required />
              </label>

              <label className="block space-y-2">
                <span className="text-sm font-medium text-[var(--ink)]">From</span>
                <select className={inputClass} name="fromLocationId">
                  <option value="">Outside the company (a purchase)</option>
                  {selectablePlaces.map((place) => (
                    <option key={place.id} value={place.id}>
                      {place.label}
                    </option>
                  ))}
                </select>
                <span className="block text-xs text-[var(--ink-muted)]">Ignored on a receipt.</span>
              </label>

              <label className="block space-y-2">
                <span className="text-sm font-medium text-[var(--ink)]">To</span>
                <select className={inputClass} name="toLocationId">
                  <option value="">Choose...</option>
                  {selectablePlaces.map((place) => (
                    <option key={place.id} value={place.id}>
                      {place.label}
                    </option>
                  ))}
                </select>
                <span className="block text-xs text-[var(--ink-muted)]">
                  A write-off goes to the built-in loss place, whatever is chosen here.
                </span>
              </label>

              <label className="block space-y-2">
                <span className="text-sm font-medium text-[var(--ink)]">Note (optional)</span>
                <input className={inputClass} name="note" placeholder="Ticket 4471" />
              </label>

              <button
                className="inline-flex h-10 w-full items-center justify-center rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-white transition hover:opacity-90"
                type="submit"
              >
                Record movement
              </button>
            </form>
          ) : (
            <p className="mt-3 text-sm text-[var(--ink-muted)]">
              Add at least one active item and one stocking place first, then movements can be recorded here.
            </p>
          )}
        </section>
      </div>
    </AdminShell>
  );
}
