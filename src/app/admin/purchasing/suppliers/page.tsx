import Link from "next/link";
import { redirect } from "next/navigation";
import { Building2, Plus } from "lucide-react";
import { AdminShell } from "@/app/admin/_components/AdminShell";
import { createSupplier } from "@/app/admin/purchasing/actions";
import {
  Flash,
  PurchasingTabs,
  firstParam,
  primaryButtonClass,
  sectionClass,
} from "@/app/admin/purchasing/_components/PurchasingChrome";
import { SupplierFields } from "@/app/admin/purchasing/_components/SupplierFields";
import type { SupplierRow } from "@/app/admin/purchasing/_lib/purchasing-data";
import { canUseAdminPanel } from "@/lib/access-control";
import { requireAppUser } from "@/lib/current-user";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type SuppliersPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function SuppliersPage({ searchParams }: SuppliersPageProps) {
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
  const showArchived = firstParam(query.archived) === "1";

  let list = supabase.from("supplier").select("*").eq("tenant_id", tenantId).order("name", { ascending: true });
  if (!showArchived) {
    list = list.eq("active", true);
  }

  const [{ data: suppliers }, { data: supplierItems }] = await Promise.all([
    list.returns<SupplierRow[]>(),
    supabase
      .from("supplier_item")
      .select("supplier_id")
      .eq("tenant_id", tenantId)
      .returns<{ supplier_id: string }[]>(),
  ]);

  const itemCount = new Map<string, number>();
  for (const row of supplierItems ?? []) {
    itemCount.set(row.supplier_id, (itemCount.get(row.supplier_id) ?? 0) + 1);
  }

  return (
    <AdminShell eyebrow="Purchasing" tenantName={context.tenant?.name ?? "Company profile"} title="Suppliers">
      <PurchasingTabs active="/admin/purchasing/suppliers" />
      <Flash error={firstParam(query.error)} notice={firstParam(query.notice)} />

      <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
        <section className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] px-4 py-3">
            <h2 className="flex items-center gap-2 text-base font-semibold text-[var(--ink)]">
              <Building2 className="h-4 w-4 text-[var(--primary)]" aria-hidden="true" />
              {showArchived ? "All suppliers" : "Active suppliers"}
            </h2>
            <Link
              className="text-sm font-semibold text-[var(--primary)] hover:underline"
              href={showArchived ? "/admin/purchasing/suppliers" : "/admin/purchasing/suppliers?archived=1"}
            >
              {showArchived ? "Hide archived" : "Show archived"}
            </Link>
          </div>
          {(suppliers ?? []).length === 0 ? (
            <p className="p-4 text-sm text-[var(--ink-muted)]">No suppliers yet. Add the first one on the right.</p>
          ) : (
            <ul>
              {(suppliers ?? []).map((supplier) => (
                <li className="border-b border-[var(--border)] px-4 py-3 last:border-0" key={supplier.id}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Link
                      className="font-semibold text-[var(--primary)] hover:underline"
                      href={`/admin/purchasing/suppliers/${supplier.id}`}
                    >
                      {supplier.name}
                    </Link>
                    {!supplier.active ? (
                      <span className="rounded-md bg-[var(--surface-muted)] px-2 py-0.5 text-xs font-semibold text-[var(--ink-muted)]">
                        Archived
                      </span>
                    ) : null}
                  </div>
                  <p className="text-sm text-[var(--ink-muted)]">
                    {[supplier.contact_name, supplier.phone, supplier.email].filter(Boolean).join(", ") || "No contact yet"}
                  </p>
                  <p className="text-xs text-[var(--ink-muted)]">
                    {supplier.categories.length > 0 ? `${supplier.categories.join(", ")}. ` : ""}
                    {itemCount.get(supplier.id) ?? 0} item{(itemCount.get(supplier.id) ?? 0) === 1 ? "" : "s"} listed
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className={sectionClass}>
          <h2 className="flex items-center gap-2 text-base font-semibold text-[var(--ink)]">
            <Plus className="h-4 w-4 text-[var(--primary)]" aria-hidden="true" />
            Add a supplier
          </h2>
          <form action={createSupplier} className="mt-3 space-y-3">
            <SupplierFields />
            <button className={primaryButtonClass} type="submit">
              Add supplier
            </button>
          </form>
        </section>
      </div>
    </AdminShell>
  );
}
