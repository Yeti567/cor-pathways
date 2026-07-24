import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, Truck } from "lucide-react";
import { recordTransferDeparture } from "@/app/admin/inventory/actions";
import { AdminShell } from "@/app/admin/_components/AdminShell";
import { canUseAdminPanel } from "@/lib/access-control";
import { requireAppUser } from "@/lib/current-user";
import { inventoryLocationKinds, inventoryLocationLabel } from "@/lib/inventory-locations";
import { formatTransferAge, inventoryTransferStatuses, transferLineRowCount } from "@/lib/inventory-transfers";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database, InventoryLocationKind } from "@/types/database";

export const dynamic = "force-dynamic";

type TransferRow = Database["public"]["Tables"]["inventory_transfer"]["Row"];
type PlaceRow = Database["public"]["Tables"]["inventory_location"]["Row"];
type ItemRef = Pick<Database["public"]["Tables"]["inventory_item"]["Row"], "id" | "name">;
type LocationRef = Pick<Database["public"]["Tables"]["locations"]["Row"], "id" | "name">;
type EquipmentRef = Pick<Database["public"]["Tables"]["equipment"]["Row"], "id" | "unit_number" | "name">;
type UserRef = Pick<Database["public"]["Tables"]["users"]["Row"], "id" | "full_name" | "email">;

type TransfersPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

const inputClass =
  "h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2";

export default async function InventoryTransfersPage({ searchParams }: TransfersPageProps) {
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

  const [{ data: transfers }, { data: places }, { data: items }, { data: locations }, { data: equipment }, { data: users }] =
    await Promise.all([
      supabase
        .from("inventory_transfer")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("departed_at", { ascending: false })
        .limit(50)
        .returns<TransferRow[]>(),
      supabase.from("inventory_location").select("*").eq("tenant_id", tenantId).returns<PlaceRow[]>(),
      supabase
        .from("inventory_item")
        .select("id, name")
        .eq("tenant_id", tenantId)
        .is("deleted_at", null)
        .eq("active", true)
        .order("name", { ascending: true })
        .returns<ItemRef[]>(),
      supabase.from("locations").select("id, name").eq("tenant_id", tenantId).returns<LocationRef[]>(),
      supabase
        .from("equipment")
        .select("id, unit_number, name")
        .eq("tenant_id", tenantId)
        .is("deleted_at", null)
        .order("unit_number", { ascending: true })
        .returns<EquipmentRef[]>(),
      supabase
        .from("users")
        .select("id, full_name, email")
        .eq("tenant_id", tenantId)
        .eq("active", true)
        .order("full_name", { ascending: true })
        .returns<UserRef[]>(),
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

  const placeById = new Map((places ?? []).map((place) => [place.id, place]));
  const selectablePlaces = (places ?? [])
    .filter((place) => place.active && !inventoryLocationKinds[place.kind as InventoryLocationKind].virtual)
    .map((place) => ({ id: place.id, label: placeLabel(place) }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const transferRows = transfers ?? [];
  const openLoads = transferRows.filter((transfer) => transfer.status === "in_transit");
  const settledLoads = transferRows.filter((transfer) => transfer.status !== "in_transit");
  const nowMs = new Date().getTime();

  const canRecord = selectablePlaces.length >= 2 && (items?.length ?? 0) >= 1;

  function transferLine(transfer: TransferRow) {
    const from = placeById.get(transfer.from_location_id);
    const to = placeById.get(transfer.to_location_id);
    return { from: from ? placeLabel(from) : "Unknown", to: to ? placeLabel(to) : "Unknown" };
  }

  return (
    <AdminShell eyebrow="Inventory" tenantName={context.tenant?.name ?? "Company profile"} title="Transfers">
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
            <Truck className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-[var(--ink)]">Loads on the move</h2>
            <p className="mt-1 max-w-2xl text-sm text-[var(--ink-muted)]">
              A load leaves one place, sits in transit, and arrives at another, so stock in flight is never invisible.
              Record the departure now and the arrival when it lands. If less arrives than left, the difference stays in
              transit for you to chase.
            </p>
          </div>
        </div>
      </section>

      <div className="mt-5 grid gap-5 xl:grid-cols-[1fr_420px]">
        <div className="space-y-5">
          <section className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-sm">
            <h3 className="border-b border-[var(--border)] bg-[var(--surface-muted)] px-4 py-3 text-sm font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
              Open loads {openLoads.length > 0 ? `(${openLoads.length})` : ""}
            </h3>
            {openLoads.length > 0 ? (
              <div className="divide-y divide-[var(--border)]">
                {openLoads.map((transfer) => {
                  const { from, to } = transferLine(transfer);
                  return (
                    <Link
                      className="flex items-center justify-between gap-3 px-4 py-3 transition hover:bg-[var(--surface-muted)]"
                      href={`/admin/inventory/transfers/${transfer.id}`}
                      key={transfer.id}
                    >
                      <div className="flex items-center gap-2 text-sm text-[var(--ink)]">
                        <span className="font-semibold">{from}</span>
                        <ArrowRight className="h-4 w-4 text-[var(--ink-muted)]" aria-hidden="true" />
                        <span className="font-semibold">{to}</span>
                      </div>
                      <span className="rounded-md bg-amber-50 px-2 py-1 text-xs font-semibold text-[var(--warning)]">
                        {formatTransferAge(transfer.departed_at, nowMs)} in transit
                      </span>
                    </Link>
                  );
                })}
              </div>
            ) : (
              <p className="p-6 text-sm text-[var(--ink-muted)]">No loads in transit. Everything is at a place.</p>
            )}
          </section>

          {settledLoads.length > 0 ? (
            <section className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-sm">
              <h3 className="border-b border-[var(--border)] bg-[var(--surface-muted)] px-4 py-3 text-sm font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
                Recent
              </h3>
              <div className="divide-y divide-[var(--border)]">
                {settledLoads.map((transfer) => {
                  const { from, to } = transferLine(transfer);
                  const status = inventoryTransferStatuses[transfer.status];
                  return (
                    <Link
                      className="flex items-center justify-between gap-3 px-4 py-3 transition hover:bg-[var(--surface-muted)]"
                      href={`/admin/inventory/transfers/${transfer.id}`}
                      key={transfer.id}
                    >
                      <div className="flex items-center gap-2 text-sm text-[var(--ink)]">
                        <span>{from}</span>
                        <ArrowRight className="h-4 w-4 text-[var(--ink-muted)]" aria-hidden="true" />
                        <span>{to}</span>
                      </div>
                      <span
                        className={`rounded-md px-2 py-1 text-xs font-semibold ${
                          status.tone === "success"
                            ? "bg-emerald-50 text-[var(--success)]"
                            : "bg-[var(--surface-muted)] text-[var(--ink-muted)]"
                        }`}
                      >
                        {status.label}
                      </span>
                    </Link>
                  );
                })}
              </div>
            </section>
          ) : null}
        </div>

        <section className="h-fit rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
          <h3 className="text-base font-semibold text-[var(--ink)]">Record a departure</h3>

          {canRecord ? (
            <form action={recordTransferDeparture} className="mt-4 space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-2">
                  <span className="text-sm font-medium text-[var(--ink)]">From</span>
                  <select className={inputClass} name="fromLocationId" required>
                    <option value="">Choose...</option>
                    {selectablePlaces.map((place) => (
                      <option key={place.id} value={place.id}>
                        {place.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-2">
                  <span className="text-sm font-medium text-[var(--ink)]">To</span>
                  <select className={inputClass} name="toLocationId" required>
                    <option value="">Choose...</option>
                    {selectablePlaces.map((place) => (
                      <option key={place.id} value={place.id}>
                        {place.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-2">
                  <span className="text-sm font-medium text-[var(--ink)]">Truck (optional)</span>
                  <select className={inputClass} name="vehicleId">
                    <option value="">None</option>
                    {(equipment ?? []).map((unit) => (
                      <option key={unit.id} value={unit.id}>
                        {equipmentNameById.get(unit.id)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-2">
                  <span className="text-sm font-medium text-[var(--ink)]">Driver (optional)</span>
                  <select className={inputClass} name="driverId">
                    <option value="">None</option>
                    {(users ?? []).map((driver) => (
                      <option key={driver.id} value={driver.id}>
                        {userNameById.get(driver.id)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <fieldset className="space-y-2 rounded-md border border-[var(--border)] bg-[var(--surface-muted)] p-3">
                <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
                  On the load
                </legend>
                {Array.from({ length: transferLineRowCount }).map((_, index) => (
                  <div className="grid grid-cols-[1fr_100px] gap-2" key={index}>
                    <select className={inputClass} defaultValue="" name={`lineItem${index}`}>
                      <option value="">{index === 0 ? "Choose an item..." : "Add another..."}</option>
                      {(items ?? []).map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                        </option>
                      ))}
                    </select>
                    <input className={inputClass} inputMode="decimal" name={`lineQty${index}`} placeholder="Qty" />
                  </div>
                ))}
              </fieldset>

              <label className="block space-y-2">
                <span className="text-sm font-medium text-[var(--ink)]">Note (optional)</span>
                <input className={inputClass} name="note" placeholder="Ticket 4471" />
              </label>

              <button
                className="inline-flex h-10 w-full items-center justify-center rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-white transition hover:opacity-90"
                type="submit"
              >
                Record departure
              </button>
            </form>
          ) : (
            <p className="mt-3 text-sm text-[var(--ink-muted)]">
              You need at least two stocking places and one active item before a load can move. Set them up under{" "}
              <Link className="font-semibold text-[var(--primary)] hover:underline" href="/admin/inventory/locations">
                Stocking places
              </Link>{" "}
              and{" "}
              <Link className="font-semibold text-[var(--primary)] hover:underline" href="/admin/inventory/items">
                Items
              </Link>
              .
            </p>
          )}
        </section>
      </div>
    </AdminShell>
  );
}
