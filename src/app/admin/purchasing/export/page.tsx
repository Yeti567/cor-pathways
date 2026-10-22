import { redirect } from "next/navigation";
import { Download } from "lucide-react";
import { AdminShell } from "@/app/admin/_components/AdminShell";
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
} from "@/app/admin/purchasing/_components/PurchasingChrome";
import { loadOrdersForExport } from "@/app/admin/purchasing/_lib/purchasing-data";
import { canUseAdminPanel } from "@/lib/access-control";
import { requireAppUser } from "@/lib/current-user";
import { formatMoney, parsePurchaseExportFilters, purchaseExportHeader, roundMoney } from "@/lib/purchasing";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type ExportPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function PurchasingExportPage({ searchParams }: ExportPageProps) {
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

  // The form is first shown with "not yet exported" ticked. After a preview the box
  // reflects what was asked for.
  const previewed = firstParam(query.preview) === "1";
  const parsed = parsePurchaseExportFilters({
    from: firstParam(query.from),
    locationId: firstParam(query.locationId),
    onlyNotExported: previewed ? firstParam(query.onlyNotExported) === "on" : true,
    supplierId: firstParam(query.supplierId),
    to: firstParam(query.to),
  });
  const filters = parsed.ok
    ? parsed.filters
    : { from: null, locationId: null, onlyNotExported: true, supplierId: null, to: null };

  const [{ data: suppliers }, { data: locations }, matching] = await Promise.all([
    supabase
      .from("supplier")
      .select("id, name")
      .eq("tenant_id", tenantId)
      .order("name", { ascending: true })
      .returns<{ id: string; name: string }[]>(),
    supabase
      .from("locations")
      .select("id, name")
      .eq("tenant_id", tenantId)
      .order("name", { ascending: true })
      .returns<{ id: string; name: string }[]>(),
    loadOrdersForExport(supabase, tenantId, filters),
  ]);

  const matchingTotal = roundMoney(matching.reduce((sum, order) => sum + Number(order.total), 0));
  const error = firstParam(query.error) ?? (parsed.ok ? undefined : parsed.error);

  return (
    <AdminShell eyebrow="Purchasing" tenantName={context.tenant?.name ?? "Company profile"} title="Export for finance">
      <PurchasingTabs active="/admin/purchasing/export" />
      <Flash error={error} notice={firstParam(query.notice)} />

      <section className={sectionClass}>
        <h2 className="flex items-center gap-2 text-base font-semibold text-[var(--ink)]">
          <Download className="h-4 w-4 text-[var(--primary)]" aria-hidden="true" />
          Orders and lines as CSV
        </h2>
        <p className="mt-1 max-w-3xl text-sm text-[var(--ink-muted)]">
          A file for your finance system: every placed order (ordered, received, or closed), one row per line, with account
          codes. Nothing is posted anywhere. Each exported order is stamped with the export date, so next time you can
          take only the new ones. Dates are the day the order was placed.
        </p>

        <form action="/admin/purchasing/export" className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" method="get">
          <input name="preview" type="hidden" value="1" />
          <label className={labelClass}>
            <span className={labelTextClass}>From</span>
            <input className={inputClass} defaultValue={filters.from ?? ""} name="from" type="date" />
          </label>
          <label className={labelClass}>
            <span className={labelTextClass}>To</span>
            <input className={inputClass} defaultValue={filters.to ?? ""} name="to" type="date" />
          </label>
          <label className={labelClass}>
            <span className={labelTextClass}>Supplier</span>
            <select className={inputClass} defaultValue={filters.supplierId ?? ""} name="supplierId">
              <option value="">All suppliers</option>
              {(suppliers ?? []).map((supplier) => (
                <option key={supplier.id} value={supplier.id}>
                  {supplier.name}
                </option>
              ))}
            </select>
          </label>
          <label className={labelClass}>
            <span className={labelTextClass}>Location</span>
            <select className={inputClass} defaultValue={filters.locationId ?? ""} name="locationId">
              <option value="">All locations</option>
              {(locations ?? []).map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 sm:col-span-2">
            <input
              className={checkboxClass}
              defaultChecked={filters.onlyNotExported}
              name="onlyNotExported"
              type="checkbox"
            />
            <span className="text-sm text-[var(--ink)]">Only orders not exported before</span>
          </label>
          <div className="sm:col-span-2 lg:col-span-4">
            <button
              className="inline-flex h-10 items-center rounded-md border border-[var(--border)] bg-white px-4 text-sm font-semibold text-[var(--ink)]"
              type="submit"
            >
              Check what matches
            </button>
          </div>
        </form>
      </section>

      <section className={`mt-4 ${sectionClass}`}>
        <h2 className="text-base font-semibold text-[var(--ink)]">
          {matching.length} order{matching.length === 1 ? "" : "s"} match, totalling {formatMoney(matchingTotal)}
        </h2>
        <p className="mt-1 text-xs text-[var(--ink-muted)]">Columns: {purchaseExportHeader.join(", ")}.</p>
        {matching.length > 0 && parsed.ok ? (
          <form action="/admin/purchasing/export/download" className="mt-3" method="post">
            <input name="from" type="hidden" value={filters.from ?? ""} />
            <input name="to" type="hidden" value={filters.to ?? ""} />
            <input name="supplierId" type="hidden" value={filters.supplierId ?? ""} />
            <input name="locationId" type="hidden" value={filters.locationId ?? ""} />
            <input name="onlyNotExported" type="hidden" value={filters.onlyNotExported ? "on" : ""} />
            <button className={primaryButtonClass} type="submit">
              <Download className="h-4 w-4" aria-hidden="true" />
              Download CSV and mark these exported
            </button>
          </form>
        ) : null}
      </section>
    </AdminShell>
  );
}
