import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Save, Star, Trash2 } from "lucide-react";
import { AdminShell } from "@/app/admin/_components/AdminShell";
import { removeSupplierItem, saveSupplierItem, updateSupplier } from "@/app/admin/purchasing/actions";
import {
  Flash,
  PurchasingTabs,
  checkboxClass,
  dangerButtonClass,
  firstParam,
  inputClass,
  labelClass,
  labelTextClass,
  primaryButtonClass,
  sectionClass,
} from "@/app/admin/purchasing/_components/PurchasingChrome";
import { SupplierFields } from "@/app/admin/purchasing/_components/SupplierFields";
import type { SupplierRow } from "@/app/admin/purchasing/_lib/purchasing-data";
import { canUseAdminPanel } from "@/lib/access-control";
import { requireAppUser } from "@/lib/current-user";
import { formatQty, formatUnitCost } from "@/lib/purchasing";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

export const dynamic = "force-dynamic";

type SupplierItemRow = Database["public"]["Tables"]["supplier_item"]["Row"];
type ItemRef = Pick<Database["public"]["Tables"]["inventory_item"]["Row"], "id" | "name" | "sku" | "unit_of_measure">;

type SupplierPageProps = {
  params: Promise<{ supplierId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function SupplierItemFields({ items, row }: { items: ItemRef[]; row?: SupplierItemRow }) {
  return (
    <>
      {row ? (
        <input name="itemId" type="hidden" value={row.item_id} />
      ) : (
        <label className={`${labelClass} sm:col-span-2`}>
          <span className={labelTextClass}>Item</span>
          <select className={inputClass} defaultValue="" name="itemId" required>
            <option value="">Choose an inventory item</option>
            {items.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
                {item.sku ? ` (${item.sku})` : ""}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className={labelClass}>
        <span className={labelTextClass}>Their part number</span>
        <input className={inputClass} defaultValue={row?.supplier_part_number ?? ""} name="supplierPartNumber" />
      </label>
      <label className={labelClass}>
        <span className={labelTextClass}>Pack size</span>
        <input className={inputClass} defaultValue={row?.pack_size ?? ""} inputMode="decimal" name="packSize" />
      </label>
      <label className={labelClass}>
        <span className={labelTextClass}>Lead time (days)</span>
        <input
          className={inputClass}
          defaultValue={row?.lead_time_days ?? ""}
          inputMode="numeric"
          min="0"
          name="leadTimeDays"
          step="1"
          type="number"
        />
      </label>
      <label className={labelClass}>
        <span className={labelTextClass}>Last unit cost</span>
        <input className={inputClass} defaultValue={row?.last_unit_cost ?? ""} inputMode="decimal" name="lastUnitCost" />
      </label>
      <label className="flex items-center gap-2 sm:col-span-2">
        <input className={checkboxClass} defaultChecked={row?.preferred ?? false} name="preferred" type="checkbox" />
        <span className="text-sm text-[var(--ink)]">Preferred supplier for this item</span>
      </label>
    </>
  );
}

export default async function SupplierPage({ params, searchParams }: SupplierPageProps) {
  const { supplierId } = await params;
  const query = await searchParams;
  const context = await requireAppUser();

  if (!canUseAdminPanel(context.appUser)) {
    redirect("/choose");
  }

  if (!context.tenant?.purchasing_enabled) {
    redirect("/admin/setup");
  }

  const supabase = await createSupabaseServerClient();
  const tenantId = context.appUser.tenant_id;

  const { data: supplier } = await supabase
    .from("supplier")
    .select("*")
    .eq("id", supplierId)
    .eq("tenant_id", tenantId)
    .maybeSingle<SupplierRow>();

  if (!supplier) {
    notFound();
  }

  const [{ data: supplierItems }, { data: items }, { count: orderCount }] = await Promise.all([
    supabase
      .from("supplier_item")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("supplier_id", supplier.id)
      .returns<SupplierItemRow[]>(),
    supabase
      .from("inventory_item")
      .select("id, name, sku, unit_of_measure")
      .eq("tenant_id", tenantId)
      .is("deleted_at", null)
      .order("name", { ascending: true })
      .returns<ItemRef[]>(),
    supabase
      .from("purchase_order")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("supplier_id", supplier.id),
  ]);

  const itemById = new Map((items ?? []).map((item) => [item.id, item]));
  const listed = new Set((supplierItems ?? []).map((row) => row.item_id));
  const unlisted = (items ?? []).filter((item) => !listed.has(item.id));
  const rows = [...(supplierItems ?? [])].sort((a, b) =>
    (itemById.get(a.item_id)?.name ?? "").localeCompare(itemById.get(b.item_id)?.name ?? ""),
  );

  return (
    <AdminShell eyebrow="Purchasing" tenantName={context.tenant?.name ?? "Company profile"} title={supplier.name}>
      <PurchasingTabs active="/admin/purchasing/suppliers" />
      <div className="mb-4">
        <Link className="text-sm font-semibold text-[var(--primary)] hover:underline" href="/admin/purchasing/suppliers">
          &larr; All suppliers
        </Link>
      </div>
      <Flash error={firstParam(query.error)} notice={firstParam(query.notice)} />

      <div className="grid gap-4 lg:grid-cols-[380px_1fr]">
        <section className={sectionClass}>
          <h2 className="text-base font-semibold text-[var(--ink)]">Details</h2>
          <p className="mt-1 text-xs text-[var(--ink-muted)]">
            Named on {orderCount ?? 0} order{orderCount === 1 ? "" : "s"}.{" "}
            {orderCount ? "Archive it rather than deleting, so those orders keep their supplier." : ""}
          </p>
          <form action={updateSupplier} className="mt-3 space-y-3">
            <input name="supplierId" type="hidden" value={supplier.id} />
            <SupplierFields supplier={supplier} />
            <button className={primaryButtonClass} type="submit">
              <Save className="h-4 w-4" aria-hidden="true" />
              Save supplier
            </button>
          </form>
        </section>

        <section className={sectionClass}>
          <h2 className="text-base font-semibold text-[var(--ink)]">What they sell</h2>
          <p className="mt-1 max-w-2xl text-sm text-[var(--ink-muted)]">
            Link this supplier to your inventory items with their part number and price. Receiving an order updates the
            last price here, and a new order line starts from it. One supplier per item can be preferred.
          </p>

          {rows.length === 0 ? (
            <p className="mt-3 text-sm text-[var(--ink-muted)]">Nothing listed yet.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {rows.map((row) => {
                const item = itemById.get(row.item_id);
                return (
                  <li className="rounded-md border border-[var(--border)] bg-white p-3" key={row.id}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="flex items-center gap-2 font-semibold text-[var(--ink)]">
                        {item?.name ?? "Removed item"}
                        {row.preferred ? (
                          <span className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--success)]">
                            <Star className="h-3 w-3" aria-hidden="true" />
                            Preferred
                          </span>
                        ) : null}
                      </span>
                      <span className="text-sm text-[var(--ink-muted)]">
                        {row.last_unit_cost !== null ? formatUnitCost(row.last_unit_cost) : "No price yet"}
                        {item ? ` per ${item.unit_of_measure}` : ""}
                      </span>
                    </div>
                    <p className="text-xs text-[var(--ink-muted)]">
                      {[
                        row.supplier_part_number ? `Part ${row.supplier_part_number}` : null,
                        row.pack_size !== null ? `Pack of ${formatQty(row.pack_size)}` : null,
                        row.lead_time_days !== null ? `${row.lead_time_days} day lead time` : null,
                      ]
                        .filter(Boolean)
                        .join(", ")}
                    </p>
                    <details className="mt-2">
                      <summary className="cursor-pointer text-xs font-semibold text-[var(--primary)]">Edit</summary>
                      <form action={saveSupplierItem} className="mt-2 grid gap-3 sm:grid-cols-2">
                        <input name="supplierId" type="hidden" value={supplier.id} />
                        <input name="supplierItemId" type="hidden" value={row.id} />
                        <SupplierItemFields items={items ?? []} row={row} />
                        <div>
                          <button className={primaryButtonClass} type="submit">
                            Save
                          </button>
                        </div>
                      </form>
                      <form action={removeSupplierItem} className="mt-2">
                        <input name="supplierId" type="hidden" value={supplier.id} />
                        <input name="supplierItemId" type="hidden" value={row.id} />
                        <button className={dangerButtonClass} type="submit">
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                          Remove from this supplier
                        </button>
                      </form>
                    </details>
                  </li>
                );
              })}
            </ul>
          )}

          {unlisted.length > 0 ? (
            <form action={saveSupplierItem} className="mt-4 grid gap-3 rounded-md border border-[var(--border)] bg-white p-3 sm:grid-cols-2">
              <input name="supplierId" type="hidden" value={supplier.id} />
              <h3 className="text-sm font-semibold text-[var(--ink)] sm:col-span-2">Add an item</h3>
              <SupplierItemFields items={unlisted} />
              <div>
                <button className={primaryButtonClass} type="submit">
                  Add item
                </button>
              </div>
            </form>
          ) : (items ?? []).length === 0 ? (
            <p className="mt-4 text-sm text-[var(--ink-muted)]">
              Items come from Inventory. Add them under{" "}
              <Link className="font-semibold text-[var(--primary)] hover:underline" href="/admin/inventory/items">
                Inventory items
              </Link>{" "}
              first, if the Inventory module is on.
            </p>
          ) : null}
        </section>
      </div>
    </AdminShell>
  );
}
