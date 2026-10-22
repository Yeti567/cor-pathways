import Link from "next/link";
import { redirect } from "next/navigation";
import { AdminShell } from "@/app/admin/_components/AdminShell";
import { createPurchaseOrder } from "@/app/admin/purchasing/actions";
import {
  Flash,
  PurchasingTabs,
  checkboxClass,
  firstParam,
  inputClass,
  labelClass,
  labelTextClass,
  primaryButtonClass,
  sectionClass,
  textareaClass,
} from "@/app/admin/purchasing/_components/PurchasingChrome";
import { loadReceivingPlaces } from "@/app/admin/purchasing/_lib/purchasing-data";
import { canUseAdminPanel } from "@/lib/access-control";
import { requireAppUser } from "@/lib/current-user";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type NewOrderPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function NewPurchaseOrderPage({ searchParams }: NewOrderPageProps) {
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
  const inventoryEnabled = Boolean(context.tenant?.inventory_enabled);

  const [{ data: suppliers }, { data: locations }, places] = await Promise.all([
    supabase
      .from("supplier")
      .select("id, name")
      .eq("tenant_id", tenantId)
      .eq("active", true)
      .order("name", { ascending: true })
      .returns<{ id: string; name: string }[]>(),
    supabase
      .from("locations")
      .select("id, name")
      .eq("tenant_id", tenantId)
      .order("name", { ascending: true })
      .returns<{ id: string; name: string }[]>(),
    inventoryEnabled ? loadReceivingPlaces(supabase, tenantId) : Promise.resolve([]),
  ]);

  return (
    <AdminShell eyebrow="Purchasing" tenantName={context.tenant?.name ?? "Company profile"} title="New order">
      <PurchasingTabs active="/admin/purchasing" />
      <Flash error={firstParam(query.error)} notice={firstParam(query.notice)} />

      <section className={sectionClass}>
        <h2 className="text-base font-semibold text-[var(--ink)]">Start a purchase order</h2>
        <p className="mt-1 max-w-2xl text-sm text-[var(--ink-muted)]">
          Fill in what you know now. You add the lines on the next screen, and everything stays editable until the order
          is submitted for approval. You are recorded as the requester.
        </p>

        <form action={createPurchaseOrder} className="mt-4 space-y-4">
          <label className={labelClass}>
            <span className={labelTextClass}>Title</span>
            <input className={inputClass} name="title" placeholder="Spring PPE restock" required />
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className={labelClass}>
              <span className={labelTextClass}>Supplier</span>
              <select className={inputClass} defaultValue="" name="supplierId">
                <option value="">Choose later</option>
                {(suppliers ?? []).map((supplier) => (
                  <option key={supplier.id} value={supplier.id}>
                    {supplier.name}
                  </option>
                ))}
              </select>
              {(suppliers ?? []).length === 0 ? (
                <span className="block text-xs text-[var(--ink-muted)]">
                  No suppliers yet.{" "}
                  <Link className="font-semibold text-[var(--primary)] hover:underline" href="/admin/purchasing/suppliers">
                    Add one
                  </Link>
                  .
                </span>
              ) : null}
            </label>
            <label className={labelClass}>
              <span className={labelTextClass}>For which location</span>
              <select className={inputClass} defaultValue="" name="locationId">
                <option value="">Company-wide</option>
                {(locations ?? []).map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name}
                  </option>
                ))}
              </select>
              <span className="block text-xs text-[var(--ink-muted)]">
                The department or yard. Approval rules can differ by location.
              </span>
            </label>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <label className={labelClass}>
              <span className={labelTextClass}>Needed by (optional)</span>
              <input className={inputClass} name="neededBy" type="date" />
            </label>
            <label className={labelClass}>
              <span className={labelTextClass}>Account code (optional)</span>
              <input className={inputClass} name="accountCode" placeholder="e.g. 5200-10" />
            </label>
            {inventoryEnabled ? (
              <label className={labelClass}>
                <span className={labelTextClass}>Deliver stock to</span>
                <select className={inputClass} defaultValue="" name="shipToLocationId">
                  <option value="">Choose when receiving</option>
                  {places.map((place) => (
                    <option key={place.id} value={place.id}>
                      {place.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>

          <label className={labelClass}>
            <span className={labelTextClass}>Notes (optional)</span>
            <textarea className={textareaClass} name="notes" />
          </label>

          <label className="flex items-start gap-2 rounded-md border border-[var(--border)] bg-[var(--surface-muted)] p-3">
            <input className={`${checkboxClass} mt-0.5`} name="emergency" type="checkbox" />
            <span className="text-sm text-[var(--ink)]">
              Emergency
              <span className="block text-xs text-[var(--ink-muted)]">
                It cannot wait. The order can be placed before it is approved; approval still follows, and the trail
                records that it happened that way round.
              </span>
            </span>
          </label>

          <button className={primaryButtonClass} type="submit">
            Start order
          </button>
        </form>
      </section>
    </AdminShell>
  );
}
