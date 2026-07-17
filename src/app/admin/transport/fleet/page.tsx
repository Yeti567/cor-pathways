import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, Gauge, MapPin, Search, SlidersHorizontal, Truck, Wrench } from "lucide-react";
import { createEquipmentScheduledService } from "@/app/admin/actions";
import { AdminShell } from "@/app/admin/_components/AdminShell";
import { canUseAdminPanel } from "@/lib/access-control";
import { requireAppUser } from "@/lib/current-user";
import {
  buildEquipmentInventoryRows,
  equipmentCategoryOptions,
  equipmentDueStatusClass,
  equipmentIntervalModeOptions,
  equipmentStatusOptions,
  formatEquipmentCategory,
  formatEquipmentStatus,
} from "@/lib/equipment";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

export const dynamic = "force-dynamic";

// Commercial vehicles and trailers are tracked as equipment. The fleet view is a
// transport-scoped lens over that data: only road units, with the maintenance
// window status front and centre.
const FLEET_CATEGORIES = ["vehicle", "trailer"] as const;

type FleetPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

type EquipmentRow = Database["public"]["Tables"]["equipment"]["Row"];
type LocationRow = Pick<Database["public"]["Tables"]["locations"]["Row"], "code" | "id" | "name">;
type UserRow = Pick<Database["public"]["Tables"]["users"]["Row"], "email" | "full_name" | "id">;
type ScheduledServiceRow = Pick<
  Database["public"]["Tables"]["equipment_scheduled_service"]["Row"],
  | "due_date"
  | "due_meter"
  | "window_start_meter"
  | "warn_meter"
  | "date_lead_days"
  | "meter_lead"
  | "equipment_id"
  | "interval_mode"
  | "is_active"
  | "title"
>;

const fleetInputClass =
  "h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2";
type EquipmentDocumentRow = Pick<
  Database["public"]["Tables"]["equipment_document"]["Row"],
  "equipment_id" | "expiry_date" | "is_active" | "reminder_lead_days" | "title"
>;

const fleetCategoryOptions = equipmentCategoryOptions.filter((option) =>
  (FLEET_CATEGORIES as readonly string[]).includes(option.value),
);

const sortOptions = [
  { value: "service", label: "Maintenance due" },
  { value: "unit", label: "Unit number" },
  { value: "status", label: "Status" },
  { value: "location", label: "Location" },
] as const;

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function statusBadgeClass(status: string) {
  switch (status) {
    case "active":
      return "border-[var(--success)] bg-emerald-50 text-[var(--success)]";
    case "down":
      return "border-[var(--danger)] bg-red-50 text-[var(--danger)]";
    case "retired":
    case "sold":
      return "border-[var(--border)] bg-[var(--surface-muted)] text-[var(--ink-muted)]";
    default:
      return "border-[var(--border)] bg-white text-[var(--ink-muted)]";
  }
}

export default async function FleetPage({ searchParams }: FleetPageProps) {
  const params = await searchParams;
  const notice = firstParam(params.notice);
  const error = firstParam(params.error);
  const query = firstParam(params.q)?.trim() ?? "";
  const status = firstParam(params.status) ?? "all";
  const category = firstParam(params.category) ?? "all";
  const sort = firstParam(params.sort) ?? "service";
  const context = await requireAppUser();

  if (!canUseAdminPanel(context.appUser)) {
    redirect("/choose");
  }

  // Fleet lives inside the gated transport module. When the module is off the
  // nav entry is hidden, so send direct hits to Setup where the toggle lives.
  if (!context.tenant?.transport_enabled) {
    redirect("/admin/setup");
  }

  const supabase = await createSupabaseServerClient();
  const [{ data: equipment }, { data: locations }, { data: users }, { data: scheduledServices }, { data: documents }] =
    await Promise.all([
      supabase
        .from("equipment")
        .select("*")
        .eq("tenant_id", context.appUser.tenant_id)
        .in("category", [...FLEET_CATEGORIES])
        .is("deleted_at", null)
        .order("unit_number", { ascending: true })
        .returns<EquipmentRow[]>(),
      supabase
        .from("locations")
        .select("id, name, code")
        .eq("tenant_id", context.appUser.tenant_id)
        .order("name", { ascending: true })
        .returns<LocationRow[]>(),
      supabase
        .from("users")
        .select("id, full_name, email")
        .eq("tenant_id", context.appUser.tenant_id)
        .order("full_name", { ascending: true })
        .returns<UserRow[]>(),
      supabase
        .from("equipment_scheduled_service")
        .select("equipment_id, title, interval_mode, due_date, due_meter, window_start_meter, warn_meter, date_lead_days, meter_lead, is_active")
        .eq("tenant_id", context.appUser.tenant_id)
        .eq("is_active", true)
        .is("deleted_at", null)
        .returns<ScheduledServiceRow[]>(),
      supabase
        .from("equipment_document")
        .select("equipment_id, title, expiry_date, reminder_lead_days, is_active")
        .eq("tenant_id", context.appUser.tenant_id)
        .eq("is_active", true)
        .is("deleted_at", null)
        .returns<EquipmentDocumentRow[]>(),
    ]);

  const rows = buildEquipmentInventoryRows({
    category,
    documents: (documents ?? []).map((document) => ({
      equipment_id: document.equipment_id,
      expiryDate: document.expiry_date,
      isActive: document.is_active,
      reminderLeadDays: document.reminder_lead_days,
      title: document.title,
    })),
    equipment: equipment ?? [],
    locations: locations ?? [],
    query,
    scheduledServices: (scheduledServices ?? []).map((service) => ({
      dueDate: service.due_date,
      dueMeter: service.due_meter,
      windowStartMeter: service.window_start_meter,
      warnMeter: service.warn_meter,
      dateLeadDays: service.date_lead_days,
      meterLead: service.meter_lead,
      equipment_id: service.equipment_id,
      intervalMode: service.interval_mode,
      isActive: service.is_active,
      title: service.title,
    })),
    sort,
    status,
    users: users ?? [],
  });

  const allFleet = equipment ?? [];
  const activeCount = allFleet.filter((item) => item.status === "active").length;
  const downCount = allFleet.filter((item) => item.status === "down").length;
  const attentionCount = rows.filter((row) => row.serviceIndicator.state !== "current").length;

  return (
    <AdminShell eyebrow="Transport" tenantName={context.tenant?.name ?? "Company profile"} title="Fleet">
      <Link
        className="inline-flex items-center gap-1 text-sm font-semibold text-[var(--primary)] hover:underline"
        href="/admin/transport"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Transport
      </Link>

      {notice ? (
        <p className="mt-4 rounded-md border border-[var(--success)] bg-emerald-50 p-3 text-sm text-[var(--success)]">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className="mt-4 rounded-md border border-[var(--danger)] bg-red-50 p-3 text-sm text-[var(--danger)]">
          {error}
        </p>
      ) : null}

      <div className="mt-4 grid gap-4 md:grid-cols-4">
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
          <p className="text-sm text-[var(--ink-muted)]">Fleet units</p>
          <p className="mt-2 text-2xl font-bold text-[var(--ink)]">{allFleet.length}</p>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
          <p className="text-sm text-[var(--ink-muted)]">Active</p>
          <p className="mt-2 text-2xl font-bold text-[var(--ink)]">{activeCount}</p>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
          <p className="text-sm text-[var(--ink-muted)]">Out of service</p>
          <p className="mt-2 text-2xl font-bold text-[var(--ink)]">{downCount}</p>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
          <p className="text-sm text-[var(--ink-muted)]">Maintenance due</p>
          <p className="mt-2 text-2xl font-bold text-[var(--ink)]">{attentionCount}</p>
        </div>
      </div>

      <details className="mt-5 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
        <summary className="cursor-pointer text-base font-semibold text-[var(--ink)]">Add service schedule</summary>
        <p className="mt-1 text-sm text-[var(--ink-muted)]">
          Set when a unit is next due (by kilometres, engine hours, or date) and how far ahead to warn. This updates the
          same unit record as the Equipment module, so there is no duplicate to keep in sync.
        </p>
        <form action={createEquipmentScheduledService} className="mt-4 grid gap-3">
          <input name="returnTo" type="hidden" value="/admin/transport/fleet" />
          <div className="grid gap-3 md:grid-cols-2">
            <label className="space-y-2">
              <span className="text-sm font-medium text-[var(--ink)]">Unit</span>
              <select className={fleetInputClass} name="equipmentId" required>
                <option value="">Choose a unit</option>
                {allFleet.map((unit) => (
                  <option key={unit.id} value={unit.id}>
                    {unit.unit_number ? `${unit.unit_number}, ` : ""}
                    {unit.name} ({formatEquipmentCategory(unit.category)})
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-2">
              <span className="text-sm font-medium text-[var(--ink)]">Service</span>
              <input className={fleetInputClass} name="title" placeholder="e.g. Oil change, CVIP, B service" required />
            </label>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <label className="space-y-2">
              <span className="text-sm font-medium text-[var(--ink)]">Track by</span>
              <select className={fleetInputClass} defaultValue="by_meter" name="intervalMode">
                {equipmentIntervalModeOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-2">
              <span className="text-sm font-medium text-[var(--ink)]">Good from (optional)</span>
              <input className={fleetInputClass} name="dueFromDate" type="date" />
            </label>
            <label className="space-y-2">
              <span className="text-sm font-medium text-[var(--ink)]">Due by (date)</span>
              <input className={fleetInputClass} name="dueDate" type="date" />
            </label>
            <label className="space-y-2">
              <span className="text-sm font-medium text-[var(--ink)]">Due meter (optional)</span>
              <input className={fleetInputClass} min="0" name="dueMeter" type="number" />
            </label>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="space-y-2">
              <span className="text-sm font-medium text-[var(--ink)]">Service every (km / hrs)</span>
              <input className={fleetInputClass} min="1" name="intervalMeter" placeholder="e.g. 5000" type="number" />
              <span className="block text-xs text-[var(--ink-muted)]">Cycle length. Due meter is set from the unit&apos;s current reading.</span>
            </label>
            <label className="space-y-2">
              <span className="text-sm font-medium text-[var(--ink)]">Up to (optional)</span>
              <input className={fleetInputClass} min="1" name="intervalMeterMax" placeholder="e.g. 7500" type="number" />
              <span className="block text-xs text-[var(--ink-muted)]">For a range, e.g. every 5,000 to 7,500.</span>
            </label>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="space-y-2">
              <span className="text-sm font-medium text-[var(--ink)]">Warn before (km / hrs)</span>
              <input className={fleetInputClass} min="0" name="meterLead" placeholder="e.g. 1000" type="number" />
            </label>
            <label className="space-y-2">
              <span className="text-sm font-medium text-[var(--ink)]">Warn before (days)</span>
              <input className={fleetInputClass} min="0" name="dateLeadDays" placeholder="e.g. 14" type="number" />
            </label>
          </div>
          <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
            <label className="space-y-2">
              <span className="text-sm font-medium text-[var(--ink)]">Repeat every (optional)</span>
              <input className={fleetInputClass} min="1" name="recurrenceValue" placeholder="e.g. 3" type="number" />
            </label>
            <label className="space-y-2">
              <span className="text-sm font-medium text-[var(--ink)]">Repeat unit</span>
              <select className={fleetInputClass} defaultValue="" name="recurrenceUnit">
                <option value="">No repeat</option>
                <option value="meter">km / hrs</option>
                <option value="days">days</option>
                <option value="months">months</option>
              </select>
            </label>
            <button
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-white transition hover:bg-[var(--primary-strong)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
              type="submit"
            >
              <Wrench className="h-4 w-4" aria-hidden="true" />
              Save schedule
            </button>
          </div>
        </form>
      </details>

      <form className="mt-5 grid gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm xl:grid-cols-[1fr_170px_170px_170px_auto] xl:items-end">
        <label className="space-y-2">
          <span className="text-sm font-medium text-[var(--ink)]">Search</span>
          <span className="relative block">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ink-muted)]" aria-hidden="true" />
            <input
              className="h-10 w-full rounded-md border border-[var(--border)] bg-white pl-9 pr-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
              defaultValue={query}
              name="q"
              placeholder="Unit, plate, VIN, location"
            />
          </span>
        </label>
        <label className="space-y-2">
          <span className="text-sm font-medium text-[var(--ink)]">Type</span>
          <select
            className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
            defaultValue={category}
            name="category"
          >
            <option value="all">All fleet</option>
            {fleetCategoryOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-2">
          <span className="text-sm font-medium text-[var(--ink)]">Status</span>
          <select
            className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
            defaultValue={status}
            name="status"
          >
            <option value="all">All statuses</option>
            {equipmentStatusOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-2">
          <span className="text-sm font-medium text-[var(--ink)]">Sort</span>
          <select
            className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
            defaultValue={sort}
            name="sort"
          >
            {sortOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <button
          className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-white transition hover:bg-[var(--primary-strong)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
          type="submit"
        >
          <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
          Filter
        </button>
      </form>

      <section className="mt-5 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-sm">
        <div className="grid grid-cols-[1.2fr_120px_140px_120px_1fr_150px] gap-3 border-b border-[var(--border)] bg-[var(--surface-muted)] px-4 py-3 text-xs font-semibold uppercase text-[var(--ink-muted)] max-2xl:hidden">
          <span>Unit</span>
          <span>Type</span>
          <span>Meter / hours</span>
          <span>Status</span>
          <span>Location</span>
          <span>Maintenance</span>
        </div>

        {rows.length > 0 ? (
          <div className="divide-y divide-[var(--border)]">
            {rows.map((row) => (
              <Link
                className="grid gap-4 px-4 py-4 transition hover:bg-[var(--surface-muted)] 2xl:grid-cols-[1.2fr_120px_140px_120px_1fr_150px] 2xl:items-center"
                href={`/admin/equipment/${row.equipment.id}?tab=service`}
                key={row.equipment.id}
              >
                <div>
                  <p className="font-semibold text-[var(--ink)]">{row.equipment.unit_number}</p>
                  <p className="mt-1 text-sm text-[var(--ink-muted)]">{row.equipment.name ?? "Unnamed unit"}</p>
                  <p className="mt-1 text-xs text-[var(--ink-muted)]">
                    {[row.equipment.make, row.equipment.model, row.equipment.year].filter(Boolean).join(" ") ||
                      row.equipment.vin_or_serial ||
                      "No specs recorded"}
                  </p>
                </div>
                <p className="inline-flex items-center gap-2 text-sm text-[var(--ink-muted)]">
                  <Truck className="h-4 w-4 text-[var(--primary)]" aria-hidden="true" />
                  {formatEquipmentCategory(row.equipment.category)}
                </p>
                <p className="inline-flex items-center gap-2 text-sm text-[var(--ink-muted)]">
                  <Gauge className="h-4 w-4 text-[var(--primary)]" aria-hidden="true" />
                  {row.meterLabel}
                </p>
                <span
                  className={`inline-flex w-fit rounded-full border px-2.5 py-1 text-xs font-semibold ${statusBadgeClass(row.equipment.status)}`}
                >
                  {formatEquipmentStatus(row.equipment.status)}
                </span>
                <p className="inline-flex items-center gap-2 text-sm text-[var(--ink-muted)]">
                  <MapPin className="h-4 w-4 text-[var(--primary)]" aria-hidden="true" />
                  {row.locationName}
                </p>
                <span
                  className={`inline-flex w-fit rounded-full border px-2.5 py-1 text-xs font-semibold ${equipmentDueStatusClass(row.serviceIndicator)}`}
                >
                  {row.serviceDetail}
                </span>
              </Link>
            ))}
          </div>
        ) : (
          <div className="px-4 py-12 text-center">
            <Truck className="mx-auto h-8 w-8 text-[var(--primary)]" aria-hidden="true" />
            <h2 className="mt-3 text-lg font-semibold text-[var(--ink)]">No fleet units found</h2>
            <p className="mt-1 text-sm text-[var(--ink-muted)]">
              Vehicles and trailers added in{" "}
              <Link className="font-semibold text-[var(--primary)] hover:underline" href="/admin/equipment">
                Equipment
              </Link>{" "}
              appear here. Set the category to Vehicle or Trailer.
            </p>
          </div>
        )}
      </section>

      <p className="mt-4 inline-flex items-center gap-2 text-sm text-[var(--ink-muted)]">
        <Wrench className="h-4 w-4 text-[var(--primary)]" aria-hidden="true" />
        Add units, log meter readings, and configure maintenance windows in{" "}
        <Link className="font-semibold text-[var(--primary)] hover:underline" href="/admin/equipment">
          Equipment
        </Link>
        .
      </p>
    </AdminShell>
  );
}
