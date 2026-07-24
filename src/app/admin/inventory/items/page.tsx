import Link from "next/link";
import { redirect } from "next/navigation";
import { Boxes, Save, Trash2 } from "lucide-react";
import { createInventoryItem, deleteInventoryItem, updateInventoryItem } from "@/app/admin/inventory/actions";
import { AdminShell } from "@/app/admin/_components/AdminShell";
import { canUseAdminPanel } from "@/lib/access-control";
import { requireAppUser } from "@/lib/current-user";
import { describeInventoryItem, inventoryRateBases, inventoryTrackingModes, inventoryUnits } from "@/lib/inventory";
import { formatInventoryQty } from "@/lib/inventory-ledger";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

export const dynamic = "force-dynamic";

type ItemRow = Database["public"]["Tables"]["inventory_item"]["Row"];
type CategoryRow = Pick<Database["public"]["Tables"]["inventory_category"]["Row"], "id" | "name">;
type EquipmentRef = Pick<Database["public"]["Tables"]["equipment"]["Row"], "id" | "unit_number" | "name">;

type ItemsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

const inputClass =
  "h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2";
const labelClass = "space-y-2";
const labelTextClass = "text-sm font-medium text-[var(--ink)]";
const checkboxClass = "h-4 w-4 rounded border-[var(--border)] text-[var(--primary)]";

/**
 * The item form, shared by the add panel and each row's edit disclosure.
 *
 * Rendered as a plain server component with no client-side state. The rate fields stay
 * visible whether or not billing is ticked, because hiding them would need client JS and
 * the server clears them anyway when billing is off. See buildInventoryItemWrite.
 */
function ItemFields({
  categories,
  equipment,
  item,
}: {
  categories: CategoryRow[];
  equipment: EquipmentRef[];
  item?: ItemRow;
}) {
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={labelClass}>
          <span className={labelTextClass}>Name</span>
          <input className={inputClass} defaultValue={item?.name ?? ""} name="name" placeholder="Rig mat" required />
        </label>
        <label className={labelClass}>
          <span className={labelTextClass}>SKU (optional)</span>
          <input className={inputClass} defaultValue={item?.sku ?? ""} name="sku" placeholder="MAT-4x8" />
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <label className={labelClass}>
          <span className={labelTextClass}>Category</span>
          <select className={inputClass} defaultValue={item?.category_id ?? ""} name="categoryId">
            <option value="">Uncategorised</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </label>
        <label className={labelClass}>
          <span className={labelTextClass}>How it is counted</span>
          <select className={inputClass} defaultValue={item?.tracking_mode ?? "bulk"} name="trackingMode">
            {inventoryTrackingModes.map((mode) => (
              <option key={mode.value} value={mode.value}>
                {mode.label}
              </option>
            ))}
          </select>
        </label>
        <label className={labelClass}>
          <span className={labelTextClass}>Unit</span>
          <input
            className={inputClass}
            defaultValue={item?.unit_of_measure ?? "each"}
            list="inventory-units"
            name="unitOfMeasure"
          />
        </label>
      </div>

      <fieldset className="grid gap-2 rounded-md border border-[var(--border)] bg-[var(--surface-muted)] p-3 sm:grid-cols-2">
        <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
          How it behaves
        </legend>
        <label className="flex items-start gap-2">
          <input
            className={checkboxClass}
            defaultChecked={item?.returnable ?? true}
            name="returnable"
            type="checkbox"
          />
          <span className="text-sm text-[var(--ink)]">
            Comes back
            <span className="block text-xs text-[var(--ink-muted)]">
              Off for anything consumed, such as PPE or filters.
            </span>
          </span>
        </label>
        <label className="flex items-start gap-2">
          <input className={checkboxClass} defaultChecked={item?.billable ?? false} name="billable" type="checkbox" />
          <span className="text-sm text-[var(--ink)]">
            Billable
            <span className="block text-xs text-[var(--ink-muted)]">Time on site is charged to the customer.</span>
          </span>
        </label>
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className={labelClass}>
          <span className={labelTextClass}>Rate (only used when billable)</span>
          <input
            className={inputClass}
            defaultValue={item?.default_rate ?? ""}
            inputMode="decimal"
            min="0"
            name="defaultRate"
            step="0.01"
            type="number"
          />
        </label>
        <label className={labelClass}>
          <span className={labelTextClass}>Charged</span>
          <select className={inputClass} defaultValue={item?.rate_basis ?? ""} name="rateBasis">
            <option value="">Not set</option>
            {inventoryRateBases.map((basis) => (
              <option key={basis.value} value={basis.value}>
                {basis.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className={labelClass}>
        <span className={labelTextClass}>Reorder point (optional)</span>
        <input
          className={inputClass}
          defaultValue={item?.reorder_point ?? ""}
          inputMode="decimal"
          min="0"
          name="reorderPoint"
          placeholder="e.g. 20"
          step="0.001"
          type="number"
        />
        <span className="block text-xs text-[var(--ink-muted)]">
          Get told when the total on hand across your real places drops to this or below. Leave blank for things you
          do not need to watch, like rental units. Best for PPE, filters, and consumables.
        </span>
      </label>

      {equipment.length > 0 ? (
        <label className={labelClass}>
          <span className={labelTextClass}>Equipment record (serialized items only)</span>
          <select className={inputClass} defaultValue={item?.equipment_id ?? ""} name="equipmentId">
            <option value="">None</option>
            {equipment.map((unit) => (
              <option key={unit.id} value={unit.id}>
                {unit.unit_number}
                {unit.name ? ` — ${unit.name}` : ""}
              </option>
            ))}
          </select>
          <span className="block text-xs text-[var(--ink-muted)]">
            Link a serialized unit that also needs a maintenance life, such as a rented generator. Inventory tracks
            where it is; Equipment tracks its condition and service.
          </span>
        </label>
      ) : null}

      <label className={labelClass}>
        <span className={labelTextClass}>Notes (optional)</span>
        <textarea className="min-h-20 w-full rounded-md border border-[var(--border)] bg-white p-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2" defaultValue={item?.notes ?? ""} name="notes" />
      </label>
    </>
  );
}

export default async function InventoryItemsPage({ searchParams }: ItemsPageProps) {
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
  const [{ data: items }, { data: categories }, { data: equipment }] = await Promise.all([
    supabase
      .from("inventory_item")
      .select("*")
      .eq("tenant_id", context.appUser.tenant_id)
      .is("deleted_at", null)
      .order("name", { ascending: true })
      .returns<ItemRow[]>(),
    supabase
      .from("inventory_category")
      .select("id, name")
      .eq("tenant_id", context.appUser.tenant_id)
      .order("name", { ascending: true })
      .returns<CategoryRow[]>(),
    supabase
      .from("equipment")
      .select("id, unit_number, name")
      .eq("tenant_id", context.appUser.tenant_id)
      .is("deleted_at", null)
      .order("unit_number", { ascending: true })
      .returns<EquipmentRef[]>(),
  ]);

  const itemRows = items ?? [];
  const categoryRows = categories ?? [];
  const equipmentRows = equipment ?? [];
  const categoryNameById = new Map(categoryRows.map((category) => [category.id, category.name]));
  const activeCount = itemRows.filter((item) => item.active).length;

  return (
    <AdminShell eyebrow="Inventory" tenantName={context.tenant?.name ?? "Company profile"} title="Items">
      <datalist id="inventory-units">
        {inventoryUnits.map((unit) => (
          <option key={unit} value={unit} />
        ))}
      </datalist>

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
            <Boxes className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-[var(--ink)]">Items</h2>
            <p className="mt-1 max-w-2xl text-sm text-[var(--ink-muted)]">
              What you stock. An item describes the thing, not how many you have: quantities arrive with the movement
              ledger, and they always belong to a location. Group them with{" "}
              <Link className="font-semibold text-[var(--primary)] hover:underline" href="/admin/inventory/categories">
                categories
              </Link>
              .
            </p>
          </div>
        </div>
      </section>

      <div className="mt-5 grid gap-4 sm:grid-cols-3">
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
          <p className="text-sm text-[var(--ink-muted)]">Items</p>
          <p className="mt-2 text-2xl font-bold text-[var(--ink)]">{itemRows.length}</p>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
          <p className="text-sm text-[var(--ink-muted)]">Active</p>
          <p className="mt-2 text-2xl font-bold text-[var(--ink)]">{activeCount}</p>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
          <p className="text-sm text-[var(--ink-muted)]">Categories</p>
          <p className="mt-2 text-2xl font-bold text-[var(--ink)]">{categoryRows.length}</p>
        </div>
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[1fr_420px]">
        <section className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-sm">
          {itemRows.length > 0 ? (
            <div className="divide-y divide-[var(--border)]">
              {itemRows.map((item) => (
                <div className="px-4 py-4" key={item.id}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-base font-semibold text-[var(--ink)]">
                        {item.name}
                        {item.active ? null : (
                          <span className="ml-2 inline-flex items-center rounded-md bg-[var(--surface-muted)] px-2 py-1 text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
                            Archived
                          </span>
                        )}
                      </p>
                      <p className="mt-1 text-sm text-[var(--ink-muted)]">
                        {describeInventoryItem(item)}
                        {item.sku ? ` · ${item.sku}` : ""}
                        {item.category_id ? ` · ${categoryNameById.get(item.category_id) ?? "Uncategorised"}` : ""}
                        {item.reorder_point !== null ? ` · Reorder at ${formatInventoryQty(Number(item.reorder_point))}` : ""}
                      </p>
                    </div>
                    <form action={deleteInventoryItem}>
                      <input name="itemId" type="hidden" value={item.id} />
                      <button
                        className="inline-flex h-9 items-center gap-2 rounded-md border border-[var(--border)] bg-white px-3 text-sm font-semibold text-[var(--danger)] transition hover:bg-red-50"
                        type="submit"
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                        Remove
                      </button>
                    </form>
                  </div>

                  <details className="mt-3">
                    <summary className="cursor-pointer text-sm font-semibold text-[var(--primary)]">Edit</summary>
                    <form action={updateInventoryItem} className="mt-3 space-y-3">
                      <input name="itemId" type="hidden" value={item.id} />
                      <ItemFields categories={categoryRows} equipment={equipmentRows} item={item} />
                      <label className="flex items-center gap-2">
                        <input
                          className={checkboxClass}
                          defaultChecked={!item.active}
                          name="archived"
                          type="checkbox"
                        />
                        <span className="text-sm text-[var(--ink)]">Archived (hide from pick lists)</span>
                      </label>
                      <button
                        className="inline-flex h-10 items-center gap-2 rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-white transition hover:opacity-90"
                        type="submit"
                      >
                        <Save className="h-4 w-4" aria-hidden="true" />
                        Save item
                      </button>
                    </form>
                  </details>
                </div>
              ))}
            </div>
          ) : (
            <p className="p-6 text-sm text-[var(--ink-muted)]">
              No items yet. Add the first one on the right. Start with the handful you move most; you do not have to
              enter everything before the module is useful.
            </p>
          )}
        </section>

        <section className="h-fit rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
          <h3 className="text-base font-semibold text-[var(--ink)]">Add an item</h3>
          <form action={createInventoryItem} className="mt-4 space-y-3">
            <ItemFields categories={categoryRows} equipment={equipmentRows} />
            <button
              className="inline-flex h-10 w-full items-center justify-center rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-white transition hover:opacity-90"
              type="submit"
            >
              Add item
            </button>
          </form>
        </section>
      </div>
    </AdminShell>
  );
}
