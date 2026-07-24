import Link from "next/link";
import { redirect } from "next/navigation";
import { Lock, MapPin } from "lucide-react";
import { createInventoryLocation, setInventoryLocationActive } from "@/app/admin/inventory/actions";
import { AdminShell } from "@/app/admin/_components/AdminShell";
import { canUseAdminPanel } from "@/lib/access-control";
import { requireAppUser } from "@/lib/current-user";
import {
  inventoryLocationKinds,
  inventoryLocationLabel,
  selectableInventoryLocationKinds,
} from "@/lib/inventory-locations";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database, InventoryLocationKind } from "@/types/database";

export const dynamic = "force-dynamic";

type InventoryLocationRow = Database["public"]["Tables"]["inventory_location"]["Row"];
type LocationRef = Pick<Database["public"]["Tables"]["locations"]["Row"], "id" | "name">;
type EquipmentRef = Pick<Database["public"]["Tables"]["equipment"]["Row"], "id" | "unit_number" | "name">;
type UserRef = Pick<Database["public"]["Tables"]["users"]["Row"], "id" | "full_name" | "email">;

type LocationsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

const inputClass =
  "h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2";

export default async function InventoryLocationsPage({ searchParams }: LocationsPageProps) {
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
  const [{ data: stockingPlaces }, { data: locations }, { data: equipment }, { data: users }] = await Promise.all([
    supabase
      .from("inventory_location")
      .select("*")
      .eq("tenant_id", context.appUser.tenant_id)
      .order("kind", { ascending: true })
      .returns<InventoryLocationRow[]>(),
    supabase
      .from("locations")
      .select("id, name")
      .eq("tenant_id", context.appUser.tenant_id)
      .order("name", { ascending: true })
      .returns<LocationRef[]>(),
    supabase
      .from("equipment")
      .select("id, unit_number, name")
      .eq("tenant_id", context.appUser.tenant_id)
      .is("deleted_at", null)
      .order("unit_number", { ascending: true })
      .returns<EquipmentRef[]>(),
    supabase
      .from("users")
      .select("id, full_name, email")
      .eq("tenant_id", context.appUser.tenant_id)
      .order("full_name", { ascending: true })
      .returns<UserRef[]>(),
  ]);

  const rows = stockingPlaces ?? [];
  const locationNameById = new Map((locations ?? []).map((row) => [row.id, row.name]));
  const equipmentNameById = new Map(
    (equipment ?? []).map((row) => [row.id, row.name ? `${row.unit_number} — ${row.name}` : row.unit_number]),
  );
  const userNameById = new Map((users ?? []).map((row) => [row.id, row.full_name || row.email]));

  function backingNameFor(row: InventoryLocationRow) {
    if (row.location_id) return locationNameById.get(row.location_id) ?? null;
    if (row.equipment_id) return equipmentNameById.get(row.equipment_id) ?? null;
    if (row.user_id) return userNameById.get(row.user_id) ?? null;
    return null;
  }

  // Already-claimed backings, so the add form does not offer a place twice and earn a
  // unique-index error the user has to interpret.
  const claimed = new Set(
    rows.flatMap((row) => [row.location_id, row.equipment_id, row.user_id].filter(Boolean) as string[]),
  );

  const virtualRows = rows.filter((row) => inventoryLocationKinds[row.kind as InventoryLocationKind].virtual);
  const realRows = rows.filter((row) => !inventoryLocationKinds[row.kind as InventoryLocationKind].virtual);

  return (
    <AdminShell eyebrow="Inventory" tenantName={context.tenant?.name ?? "Company profile"} title="Stocking places">
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
            <MapPin className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-[var(--ink)]">Where stock can sit</h2>
            <p className="mt-1 max-w-2xl text-sm text-[var(--ink-muted)]">
              A yard, a customer site, a truck, or a worker. Once each is a stocking place, moving stock is one action
              whatever the two ends are: a delivery, a tool going out with a crew, and loading a truck are all the same
              movement. These are kept separate from your{" "}
              <Link className="font-semibold text-[var(--primary)] hover:underline" href="/admin/locations">
                Locations
              </Link>{" "}
              list, which stays exactly as it was.
            </p>
          </div>
        </div>
      </section>

      <div className="mt-5 grid gap-5 xl:grid-cols-[1fr_380px]">
        <div className="space-y-5">
          <section className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-sm">
            <h3 className="border-b border-[var(--border)] bg-[var(--surface-muted)] px-4 py-3 text-sm font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
              Your places
            </h3>
            {realRows.length > 0 ? (
              <div className="divide-y divide-[var(--border)]">
                {realRows.map((row) => {
                  const kind = row.kind as InventoryLocationKind;

                  return (
                    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4" key={row.id}>
                      <div>
                        <p className="text-base font-semibold text-[var(--ink)]">
                          {inventoryLocationLabel(row, backingNameFor(row))}
                          {row.active ? null : (
                            <span className="ml-2 inline-flex items-center rounded-md bg-[var(--surface-muted)] px-2 py-1 text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
                              Off
                            </span>
                          )}
                        </p>
                        <p className="mt-1 text-sm text-[var(--ink-muted)]">{inventoryLocationKinds[kind].label}</p>
                      </div>
                      <form action={setInventoryLocationActive}>
                        <input name="inventoryLocationId" type="hidden" value={row.id} />
                        <input name="active" type="hidden" value={row.active ? "false" : "true"} />
                        <button
                          className="inline-flex h-9 items-center rounded-md border border-[var(--border)] bg-white px-3 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)]"
                          type="submit"
                        >
                          {row.active ? "Turn off" : "Turn on"}
                        </button>
                      </form>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="p-6 text-sm text-[var(--ink-muted)]">
                No stocking places yet. Add your yard first: it is where most stock starts.
              </p>
            )}
          </section>

          <section className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-sm">
            <h3 className="border-b border-[var(--border)] bg-[var(--surface-muted)] px-4 py-3 text-sm font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
              Built in
            </h3>
            <div className="divide-y divide-[var(--border)]">
              {virtualRows.map((row) => {
                const kind = row.kind as InventoryLocationKind;

                return (
                  <div className="flex items-start gap-3 px-4 py-4" key={row.id}>
                    <Lock className="mt-1 h-4 w-4 shrink-0 text-[var(--ink-muted)]" aria-hidden="true" />
                    <div>
                      <p className="text-base font-semibold text-[var(--ink)]">{inventoryLocationLabel(row)}</p>
                      <p className="mt-1 max-w-xl text-sm text-[var(--ink-muted)]">
                        {inventoryLocationKinds[kind].description}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="border-t border-[var(--border)] px-4 py-3 text-sm text-[var(--ink-muted)]">
              These two are created with the module and cannot be removed. They are not real places, and they never
              appear anywhere a person could be assigned.
            </p>
          </section>
        </div>

        <section className="h-fit rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
          <h3 className="text-base font-semibold text-[var(--ink)]">Add a stocking place</h3>
          <form action={createInventoryLocation} className="mt-4 space-y-4">
            <label className="block space-y-2">
              <span className="text-sm font-medium text-[var(--ink)]">What sort of place</span>
              <select className={inputClass} name="kind" required>
                {selectableInventoryLocationKinds.map((kind) => (
                  <option key={kind} value={kind}>
                    {inventoryLocationKinds[kind].label}
                  </option>
                ))}
              </select>
            </label>

            <label className="block space-y-2">
              <span className="text-sm font-medium text-[var(--ink)]">Which one</span>
              <select className={inputClass} name="backingId" required>
                <option value="">Choose...</option>
                <optgroup label="Locations">
                  {(locations ?? [])
                    .filter((row) => !claimed.has(row.id))
                    .map((row) => (
                      <option key={row.id} value={row.id}>
                        {row.name}
                      </option>
                    ))}
                </optgroup>
                <optgroup label="Vehicles">
                  {(equipment ?? [])
                    .filter((row) => !claimed.has(row.id))
                    .map((row) => (
                      <option key={row.id} value={row.id}>
                        {equipmentNameById.get(row.id)}
                      </option>
                    ))}
                </optgroup>
                <optgroup label="Workers">
                  {(users ?? [])
                    .filter((row) => !claimed.has(row.id))
                    .map((row) => (
                      <option key={row.id} value={row.id}>
                        {userNameById.get(row.id)}
                      </option>
                    ))}
                </optgroup>
              </select>
              <span className="block text-xs text-[var(--ink-muted)]">
                Pick from the group that matches the sort of place. A yard, customer site, vendor or job comes from
                Locations; a vehicle from your equipment; a worker from your people.
              </span>
            </label>

            <button
              className="inline-flex h-10 w-full items-center justify-center rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-white transition hover:opacity-90"
              type="submit"
            >
              Add stocking place
            </button>
          </form>
        </section>
      </div>
    </AdminShell>
  );
}
