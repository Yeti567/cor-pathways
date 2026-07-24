import Link from "next/link";
import { redirect } from "next/navigation";
import { ClipboardCheck, ScanLine } from "lucide-react";
import { CountEntryForm } from "@/app/admin/inventory/counts/_components/CountEntryForm";
import { AdminShell } from "@/app/admin/_components/AdminShell";
import { canUseAdminPanel } from "@/lib/access-control";
import { requireAppUser } from "@/lib/current-user";
import { describeCountDelta } from "@/lib/inventory-count";
import { formatInventoryQty } from "@/lib/inventory-ledger";
import { inventoryLocationKinds, inventoryLocationLabel } from "@/lib/inventory-locations";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database, InventoryLocationKind } from "@/types/database";

export const dynamic = "force-dynamic";

type BalanceRow = Database["public"]["Tables"]["inventory_balance"]["Row"];
type CountRow = Database["public"]["Tables"]["inventory_count"]["Row"];
type ItemRow = Pick<Database["public"]["Tables"]["inventory_item"]["Row"], "id" | "name" | "unit_of_measure" | "active" | "deleted_at">;
type PlaceRow = Database["public"]["Tables"]["inventory_location"]["Row"];
type LocationRef = Pick<Database["public"]["Tables"]["locations"]["Row"], "id" | "name">;
type EquipmentRef = Pick<Database["public"]["Tables"]["equipment"]["Row"], "id" | "unit_number" | "name">;
type UserRef = Pick<Database["public"]["Tables"]["users"]["Row"], "id" | "full_name" | "email">;

type CountsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function InventoryCountsPage({ searchParams }: CountsPageProps) {
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
    { data: items },
    { data: places },
    { data: locations },
    { data: equipment },
    { data: users },
    { data: counts },
  ] = await Promise.all([
    supabase.from("inventory_balance").select("*").eq("tenant_id", tenantId).returns<BalanceRow[]>(),
    supabase
      .from("inventory_item")
      .select("id, name, unit_of_measure, active, deleted_at")
      .eq("tenant_id", tenantId)
      .is("deleted_at", null)
      .order("name", { ascending: true })
      .returns<ItemRow[]>(),
    supabase.from("inventory_location").select("*").eq("tenant_id", tenantId).returns<PlaceRow[]>(),
    supabase.from("locations").select("id, name").eq("tenant_id", tenantId).returns<LocationRef[]>(),
    supabase
      .from("equipment")
      .select("id, unit_number, name")
      .eq("tenant_id", tenantId)
      .is("deleted_at", null)
      .returns<EquipmentRef[]>(),
    supabase.from("users").select("id, full_name, email").eq("tenant_id", tenantId).returns<UserRef[]>(),
    supabase
      .from("inventory_count")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("counted_at", { ascending: false })
      .limit(25)
      .returns<CountRow[]>(),
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
  const lossPlace = placeRows.find((place) => place.kind === "loss") ?? null;

  // Only real, active places can be counted. Transit and loss are reached by the movement
  // that reconciles a count, never counted directly.
  const selectablePlaces = placeRows
    .filter((place) => place.active && !inventoryLocationKinds[place.kind as InventoryLocationKind].virtual)
    .map((place) => ({ id: place.id, label: placeLabel(place) }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const itemOptions = (items ?? []).map((item) => ({
    id: item.id,
    name: item.name,
    unit: item.unit_of_measure,
  }));

  // What the form needs to show "the books say" for a chosen pair, keyed item::place.
  const balanceLookup: Record<string, number> = {};
  for (const balance of balances ?? []) {
    balanceLookup[`${balance.item_id}::${balance.location_id}`] = Number(balance.qty);
  }

  // The variance report: what has accumulated in the loss place, per item. Positive is
  // net shrinkage written off or counted short; negative means more turned up than the
  // books expected, which is worth a second look rather than quiet acceptance.
  const lossByItem = lossPlace
    ? (balances ?? [])
        .filter((balance) => balance.location_id === lossPlace.id && Number(balance.qty) !== 0)
        .map((balance) => ({
          itemId: balance.item_id,
          itemName: itemById.get(balance.item_id)?.name ?? "Unknown item",
          qty: Number(balance.qty),
          unit: itemById.get(balance.item_id)?.unit_of_measure ?? "",
        }))
        .sort((a, b) => a.itemName.localeCompare(b.itemName))
    : [];

  const defaultItemId = firstParam(params.item);
  const defaultPlaceId = firstParam(params.place);

  return (
    <AdminShell eyebrow="Inventory" tenantName={context.tenant?.name ?? "Company profile"} title="Counts">
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
            <ClipboardCheck className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-[var(--ink)]">Count what is actually there</h2>
            <p className="mt-1 max-w-2xl text-sm text-[var(--ink-muted)]">
              Enter the real number on the shelf and the system works out the difference against the books, then records
              it as a movement into the loss place. Nobody edits a balance by hand, so a correction always says where
              the stock went. See what you have under{" "}
              <Link className="font-semibold text-[var(--primary)] hover:underline" href="/admin/inventory/on-hand">
                On hand
              </Link>
              .
            </p>
          </div>
        </div>
      </section>

      <div className="mt-5 grid gap-5 xl:grid-cols-[1fr_420px]">
        <div className="space-y-5">
          <section className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-sm">
            <h3 className="border-b border-[var(--border)] bg-[var(--surface-muted)] px-4 py-3 text-sm font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
              Loss and write-off, by item
            </h3>
            {lossByItem.length > 0 ? (
              <div className="divide-y divide-[var(--border)]">
                {lossByItem.map((row) => (
                  <div className="flex items-center justify-between gap-3 px-4 py-3" key={row.itemId}>
                    <p className="text-sm font-semibold text-[var(--ink)]">{row.itemName}</p>
                    <p
                      className={`text-sm font-bold tabular-nums ${
                        row.qty < 0 ? "text-[var(--danger)]" : "text-[var(--ink)]"
                      }`}
                    >
                      {formatInventoryQty(row.qty)}{" "}
                      <span className="text-xs font-normal text-[var(--ink-muted)]">{row.unit}</span>
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="p-6 text-sm text-[var(--ink-muted)]">
                Nothing written off or counted short yet. What lands in the loss place shows here, so it stays
                reviewable rather than disappearing.
              </p>
            )}
          </section>

          <section className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-sm">
            <h3 className="border-b border-[var(--border)] bg-[var(--surface-muted)] px-4 py-3 text-sm font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
              Recent counts
            </h3>
            {(counts ?? []).length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-[var(--border)] text-left text-xs uppercase tracking-wide text-[var(--ink-muted)]">
                      <th className="px-4 py-2 font-semibold">Item</th>
                      <th className="px-4 py-2 font-semibold">Place</th>
                      <th className="px-4 py-2 text-right font-semibold">Books</th>
                      <th className="px-4 py-2 text-right font-semibold">Counted</th>
                      <th className="px-4 py-2 text-right font-semibold">Variance</th>
                      <th className="px-4 py-2 font-semibold">When</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(counts ?? []).map((count) => {
                      const place = placeById.get(count.location_id);
                      const delta = Number(count.delta);

                      return (
                        <tr className="border-b border-[var(--border)] last:border-0" key={count.id}>
                          <td className="px-4 py-2 font-medium text-[var(--ink)]">
                            {itemById.get(count.item_id)?.name ?? "Unknown item"}
                          </td>
                          <td className="px-4 py-2 text-[var(--ink-muted)]">
                            {place ? placeLabel(place) : "Unknown place"}
                          </td>
                          <td className="px-4 py-2 text-right tabular-nums text-[var(--ink-muted)]">
                            {formatInventoryQty(Number(count.expected_qty))}
                          </td>
                          <td className="px-4 py-2 text-right font-semibold tabular-nums text-[var(--ink)]">
                            {formatInventoryQty(Number(count.counted_qty))}
                          </td>
                          <td
                            className={`px-4 py-2 text-right font-semibold tabular-nums ${
                              delta === 0
                                ? "text-[var(--success)]"
                                : delta < 0
                                  ? "text-[var(--warning)]"
                                  : "text-[var(--primary)]"
                            }`}
                          >
                            {delta === 0 ? "matched" : describeCountDelta(delta)}
                          </td>
                          <td className="px-4 py-2 text-xs text-[var(--ink-muted)]">
                            {new Date(count.counted_at).toLocaleDateString()}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="p-6 text-sm text-[var(--ink-muted)]">No counts recorded yet.</p>
            )}
          </section>
        </div>

        <section className="h-fit rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
          <h3 className="flex items-center gap-2 text-base font-semibold text-[var(--ink)]">
            <ScanLine className="h-4 w-4 text-[var(--primary)]" aria-hidden="true" />
            Record a count
          </h3>

          {itemOptions.length && selectablePlaces.length ? (
            <CountEntryForm
              balances={balanceLookup}
              defaultItemId={defaultItemId}
              defaultPlaceId={defaultPlaceId}
              items={itemOptions}
              lossLocationId={lossPlace?.id ?? null}
              places={selectablePlaces}
            />
          ) : (
            <p className="mt-3 text-sm text-[var(--ink-muted)]">
              Add at least one active{" "}
              <Link className="font-semibold text-[var(--primary)] hover:underline" href="/admin/inventory/items">
                item
              </Link>{" "}
              and one{" "}
              <Link className="font-semibold text-[var(--primary)] hover:underline" href="/admin/inventory/locations">
                stocking place
              </Link>{" "}
              first, then a count can be recorded here.
            </p>
          )}
        </section>
      </div>
    </AdminShell>
  );
}
