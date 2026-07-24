import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowRight, PackageCheck, Truck, X } from "lucide-react";
import { cancelTransfer, recordTransferArrival } from "@/app/admin/inventory/actions";
import { AdminShell } from "@/app/admin/_components/AdminShell";
import { canUseAdminPanel } from "@/lib/access-control";
import { requireAppUser } from "@/lib/current-user";
import { formatInventoryQty } from "@/lib/inventory-ledger";
import { inventoryLocationLabel } from "@/lib/inventory-locations";
import { inventoryTransferStatuses, summariseTransferMovements } from "@/lib/inventory-transfers";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

export const dynamic = "force-dynamic";

type TransferRow = Database["public"]["Tables"]["inventory_transfer"]["Row"];
type MovementRow = Pick<
  Database["public"]["Tables"]["inventory_movement"]["Row"],
  "item_id" | "qty" | "from_location_id" | "to_location_id"
>;
type PlaceRow = Database["public"]["Tables"]["inventory_location"]["Row"];
type ItemRef = Pick<Database["public"]["Tables"]["inventory_item"]["Row"], "id" | "name" | "unit_of_measure">;
type LocationRef = Pick<Database["public"]["Tables"]["locations"]["Row"], "id" | "name">;
type EquipmentRef = Pick<Database["public"]["Tables"]["equipment"]["Row"], "id" | "unit_number" | "name">;
type UserRef = Pick<Database["public"]["Tables"]["users"]["Row"], "id" | "full_name" | "email">;

type DetailPageProps = {
  params: Promise<{ transferId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

const inputClass =
  "h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2";

export default async function InventoryTransferDetailPage({ params, searchParams }: DetailPageProps) {
  const { transferId } = await params;
  const query = await searchParams;
  const notice = firstParam(query.notice);
  const error = firstParam(query.error);
  const context = await requireAppUser();

  if (!canUseAdminPanel(context.appUser)) {
    redirect("/choose");
  }

  if (!context.tenant?.inventory_enabled) {
    redirect("/admin/setup");
  }

  const supabase = await createSupabaseServerClient();
  const tenantId = context.appUser.tenant_id;

  const { data: transfer } = await supabase
    .from("inventory_transfer")
    .select("*")
    .eq("id", transferId)
    .eq("tenant_id", tenantId)
    .maybeSingle<TransferRow>();

  if (!transfer) {
    notFound();
  }

  const [{ data: movements }, { data: places }, { data: items }, { data: locations }, { data: equipment }, { data: users }] =
    await Promise.all([
      supabase
        .from("inventory_movement")
        .select("item_id, qty, from_location_id, to_location_id")
        .eq("tenant_id", tenantId)
        .eq("transfer_id", transferId)
        .returns<MovementRow[]>(),
      supabase.from("inventory_location").select("*").eq("tenant_id", tenantId).returns<PlaceRow[]>(),
      supabase
        .from("inventory_item")
        .select("id, name, unit_of_measure")
        .eq("tenant_id", tenantId)
        .returns<ItemRef[]>(),
      supabase.from("locations").select("id, name").eq("tenant_id", tenantId).returns<LocationRef[]>(),
      supabase.from("equipment").select("id, unit_number, name").eq("tenant_id", tenantId).returns<EquipmentRef[]>(),
      supabase.from("users").select("id, full_name, email").eq("tenant_id", tenantId).returns<UserRef[]>(),
    ]);

  const locationNameById = new Map((locations ?? []).map((row) => [row.id, row.name]));
  const equipmentNameById = new Map(
    (equipment ?? []).map((row) => [row.id, row.name ? `${row.unit_number} — ${row.name}` : row.unit_number]),
  );
  const userNameById = new Map((users ?? []).map((row) => [row.id, row.full_name || row.email]));
  const itemById = new Map((items ?? []).map((row) => [row.id, row]));

  function placeLabel(place: PlaceRow | undefined) {
    if (!place) return "Unknown";
    const backing =
      (place.location_id ? locationNameById.get(place.location_id) : null) ??
      (place.equipment_id ? equipmentNameById.get(place.equipment_id) : null) ??
      (place.user_id ? userNameById.get(place.user_id) : null) ??
      null;
    return inventoryLocationLabel(place, backing);
  }

  const placeById = new Map((places ?? []).map((place) => [place.id, place]));
  const transitId = (places ?? []).find((place) => place.kind === "transit")?.id ?? "";

  const manifest = summariseTransferMovements(
    (movements ?? []).map((movement) => ({
      from_location_id: movement.from_location_id,
      item_id: movement.item_id,
      qty: Number(movement.qty),
      to_location_id: movement.to_location_id,
    })),
    transitId,
  );

  const status = inventoryTransferStatuses[transfer.status];
  const isOpen = transfer.status === "in_transit";
  const totalResidual = manifest.reduce((sum, line) => sum + line.residual, 0);

  return (
    <AdminShell eyebrow="Inventory" tenantName={context.tenant?.name ?? "Company profile"} title="Load">
      <div className="mb-4">
        <Link className="text-sm font-semibold text-[var(--primary)] hover:underline" href="/admin/inventory/transfers">
          &larr; All transfers
        </Link>
      </div>

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
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-[var(--surface-muted)] text-[var(--primary)]">
              <Truck className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <div className="flex items-center gap-2 text-base font-semibold text-[var(--ink)]">
                <span>{placeLabel(placeById.get(transfer.from_location_id))}</span>
                <ArrowRight className="h-4 w-4 text-[var(--ink-muted)]" aria-hidden="true" />
                <span>{placeLabel(placeById.get(transfer.to_location_id))}</span>
              </div>
              <p className="mt-1 text-sm text-[var(--ink-muted)]">
                Departed {new Date(transfer.departed_at).toLocaleString()}
                {transfer.vehicle_id ? ` · ${equipmentNameById.get(transfer.vehicle_id) ?? "vehicle"}` : ""}
                {transfer.driver_id ? ` · ${userNameById.get(transfer.driver_id) ?? "driver"}` : ""}
                {transfer.note ? ` · ${transfer.note}` : ""}
              </p>
            </div>
          </div>
          <span
            className={`rounded-md px-3 py-1 text-sm font-semibold ${
              status.tone === "warn"
                ? "bg-amber-50 text-[var(--warning)]"
                : status.tone === "success"
                  ? "bg-emerald-50 text-[var(--success)]"
                  : "bg-[var(--surface-muted)] text-[var(--ink-muted)]"
            }`}
          >
            {status.label}
          </span>
        </div>
      </section>

      <section className="mt-4 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] bg-[var(--surface-muted)] text-left">
                <th className="px-4 py-3 font-semibold text-[var(--ink)]">Item</th>
                <th className="px-4 py-3 text-right font-semibold text-[var(--ink)]">Loaded</th>
                <th className="px-4 py-3 text-right font-semibold text-[var(--ink)]">Delivered</th>
                <th className="px-4 py-3 text-right font-semibold text-[var(--ink)]">Still in transit</th>
              </tr>
            </thead>
            <tbody>
              {manifest.map((line) => {
                const item = itemById.get(line.itemId);
                return (
                  <tr className="border-b border-[var(--border)] last:border-0" key={line.itemId}>
                    <td className="px-4 py-3 font-medium text-[var(--ink)]">{item?.name ?? "Unknown item"}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-[var(--ink)]">
                      {formatInventoryQty(line.loaded)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-[var(--ink)]">
                      {formatInventoryQty(line.delivered)}
                    </td>
                    <td
                      className={`px-4 py-3 text-right font-semibold tabular-nums ${
                        line.residual > 0 ? "text-[var(--warning)]" : "text-[var(--ink-muted)]"
                      }`}
                    >
                      {line.residual === 0 ? "·" : formatInventoryQty(line.residual)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {totalResidual > 0 && !isOpen ? (
          <p className="border-t border-[var(--border)] bg-amber-50 px-4 py-3 text-sm text-[var(--ink)]">
            {formatInventoryQty(totalResidual)} left in transit: more was loaded than was delivered. Worth chasing with
            the driver rather than adjusting away.
          </p>
        ) : null}
      </section>

      {isOpen ? (
        <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_auto]">
          <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
            <h3 className="flex items-center gap-2 text-base font-semibold text-[var(--ink)]">
              <PackageCheck className="h-4 w-4 text-[var(--primary)]" aria-hidden="true" />
              Record arrival
            </h3>
            <p className="mt-1 text-sm text-[var(--ink-muted)]">
              Enter what actually arrived. Anything short of what was loaded stays in transit.
            </p>
            <form action={recordTransferArrival} className="mt-4 space-y-3">
              <input name="transferId" type="hidden" value={transfer.id} />
              {manifest.map((line) => {
                const item = itemById.get(line.itemId);
                return (
                  <label className="grid grid-cols-[1fr_120px] items-center gap-3" key={line.itemId}>
                    <span className="text-sm text-[var(--ink)]">
                      {item?.name ?? "Unknown"}
                      <span className="ml-1 text-xs text-[var(--ink-muted)]">loaded {formatInventoryQty(line.loaded)}</span>
                    </span>
                    <input
                      className={inputClass}
                      defaultValue={line.loaded}
                      inputMode="decimal"
                      name={`delivered_${line.itemId}`}
                    />
                  </label>
                );
              })}
              <button
                className="inline-flex h-10 w-full items-center justify-center rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-white transition hover:opacity-90"
                type="submit"
              >
                Record arrival
              </button>
            </form>
          </section>

          <section className="h-fit rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
            <h3 className="text-base font-semibold text-[var(--ink)]">Load did not go?</h3>
            <p className="mt-1 max-w-xs text-sm text-[var(--ink-muted)]">
              Cancel it and everything on board goes straight back to {placeLabel(placeById.get(transfer.from_location_id))}.
            </p>
            <form action={cancelTransfer} className="mt-3">
              <input name="transferId" type="hidden" value={transfer.id} />
              <button
                className="inline-flex h-10 items-center gap-2 rounded-md border border-[var(--border)] bg-white px-4 text-sm font-semibold text-[var(--danger)] transition hover:bg-red-50"
                type="submit"
              >
                <X className="h-4 w-4" aria-hidden="true" />
                Cancel load
              </button>
            </form>
          </section>
        </div>
      ) : null}
    </AdminShell>
  );
}
