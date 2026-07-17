import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, CalendarClock, Gauge, MapPin, Save, Search, SlidersHorizontal, Truck, UserRound, Wrench } from "lucide-react";
import { createEquipment } from "@/app/admin/actions";
import { AdminShell } from "@/app/admin/_components/AdminShell";
import { canUseAdminPanel } from "@/lib/access-control";
import { requireAppUser } from "@/lib/current-user";
import {
  buildEquipmentInventoryRows,
  equipmentCategoryOptions,
  equipmentDueStatusClass,
  equipmentStatusOptions,
  equipmentTrackingModeOptions,
  formatEquipmentCategory,
  formatEquipmentMeter,
  formatEquipmentStatus,
} from "@/lib/equipment";
import { sendEquipmentAttentionNotifications } from "@/lib/equipment-reminders";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

export const dynamic = "force-dynamic";

type EquipmentPageProps = {
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
type EquipmentDocumentRow = Pick<
  Database["public"]["Tables"]["equipment_document"]["Row"],
  "equipment_id" | "expiry_date" | "is_active" | "reminder_lead_days" | "title"
>;

const sortOptions = [
  { value: "unit", label: "Unit number" },
  { value: "status", label: "Status" },
  { value: "location", label: "Location" },
  { value: "service", label: "Service due" },
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

export default async function EquipmentPage({ searchParams }: EquipmentPageProps) {
  const params = await searchParams;
  const notice = firstParam(params.notice);
  const error = firstParam(params.error);
  const query = firstParam(params.q)?.trim() ?? "";
  const status = firstParam(params.status) ?? "all";
  const category = firstParam(params.category) ?? "all";
  const assignedTo = firstParam(params.assignedTo) ?? "all";
  const sort = firstParam(params.sort) ?? "unit";
  await requireAppUser();
  const context = await requireAppUser();

  if (!canUseAdminPanel(context.appUser)) {
    redirect("/choose");
  }

  const supabase = await createSupabaseServerClient();
  await sendEquipmentAttentionNotifications(context.appUser.tenant_id);
  const [{ data: equipment }, { data: locations }, { data: users }, { data: scheduledServices }, { data: documents }] =
    await Promise.all([
      supabase
        .from("equipment")
        .select("*")
        .eq("tenant_id", context.appUser.tenant_id)
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
    assignedTo,
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

  const allEquipment = equipment ?? [];
  const activeCount = allEquipment.filter((item) => item.status === "active").length;
  const downCount = allEquipment.filter((item) => item.status === "down").length;
  const serviceAttentionCount = rows.filter((row) => row.serviceIndicator.state !== "current").length;
  // Fleet-wide service/document attention, most urgent first, for the landing panel.
  const attentionOrder: Record<string, number> = { overdue: 0, due_soon: 1, current: 2 };
  const attentionRows = rows
    .filter((row) => row.serviceIndicator.state !== "current")
    .sort((a, b) => attentionOrder[a.serviceIndicator.state] - attentionOrder[b.serviceIndicator.state]);

  return (
    <AdminShell eyebrow="Equipment files" tenantName={context.tenant?.name ?? "Company profile"} title="Equipment">
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

      <div className="grid gap-4 md:grid-cols-4">
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
          <p className="text-sm text-[var(--ink-muted)]">Equipment</p>
          <p className="mt-2 text-2xl font-bold text-[var(--ink)]">{allEquipment.length}</p>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
          <p className="text-sm text-[var(--ink-muted)]">Active</p>
          <p className="mt-2 text-2xl font-bold text-[var(--ink)]">{activeCount}</p>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
          <p className="text-sm text-[var(--ink-muted)]">Down</p>
          <p className="mt-2 text-2xl font-bold text-[var(--ink)]">{downCount}</p>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
          <p className="text-sm text-[var(--ink-muted)]">Needs attention</p>
          <p className="mt-2 text-2xl font-bold text-[var(--ink)]">{serviceAttentionCount}</p>
        </div>
      </div>

      {rows.length > 0 ? (
        <section className="mt-5 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
          <div className="flex items-center gap-2">
            <CalendarClock className="h-5 w-5 text-[var(--primary)]" aria-hidden="true" />
            <h2 className="text-lg font-semibold text-[var(--ink)]">Service and maintenance</h2>
          </div>
          {attentionRows.length > 0 ? (
            <>
              <p className="mt-1 text-sm text-[var(--ink-muted)]">
                {attentionRows.length === 1 ? "1 unit needs" : `${attentionRows.length} units need`} attention. Open a unit
                to adjust its service schedule or log the work.
              </p>
              <div className="mt-3 divide-y divide-[var(--border)] rounded-md border border-[var(--border)]">
                {attentionRows.map((row) => (
                  <Link
                    className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 transition hover:bg-[var(--surface-muted)]"
                    href={`/admin/equipment/${row.equipment.id}?tab=service`}
                    key={row.equipment.id}
                  >
                    <span className="font-semibold text-[var(--ink)]">
                      {row.equipment.unit_number}
                      <span className="ml-2 text-sm font-normal text-[var(--ink-muted)]">
                        {row.equipment.name ?? "Unnamed equipment"}
                      </span>
                    </span>
                    <span
                      className={`inline-flex w-fit items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${equipmentDueStatusClass(row.serviceIndicator)}`}
                    >
                      {row.serviceDetail}
                    </span>
                  </Link>
                ))}
              </div>
            </>
          ) : (
            <p className="mt-2 inline-flex items-center gap-2 text-sm text-[var(--ink-muted)]">
              <Wrench className="h-4 w-4 text-[var(--primary)]" aria-hidden="true" />
              All units are current on service and document renewals. Open a unit to set up or adjust its schedule.
            </p>
          )}
        </section>
      ) : null}

      <details className="mt-5 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
        <summary className="cursor-pointer text-lg font-semibold text-[var(--ink)]">Add Equipment</summary>
        <form action={createEquipment} className="mt-4 grid gap-4">
          <div className="grid gap-4 md:grid-cols-3">
            <label className="space-y-2">
              <span className="text-sm font-medium text-[var(--ink)]">Unit number</span>
              <input
                className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                name="unitNumber"
                placeholder="Unit 47"
                required
              />
            </label>
            <label className="space-y-2">
              <span className="text-sm font-medium text-[var(--ink)]">Name</span>
              <input
                className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                name="name"
                placeholder="Service truck"
              />
            </label>
            <label className="space-y-2">
              <span className="text-sm font-medium text-[var(--ink)]">Current meter</span>
              <input
                className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                min="0"
                name="currentMeter"
                step="0.1"
                type="number"
              />
            </label>
          </div>
          <div className="grid gap-4 md:grid-cols-4">
            <label className="space-y-2">
              <span className="text-sm font-medium text-[var(--ink)]">Category</span>
              <select
                className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                name="category"
                defaultValue="vehicle"
              >
                {equipmentCategoryOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-2">
              <span className="text-sm font-medium text-[var(--ink)]">Tracking mode</span>
              <select
                className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                name="trackingMode"
                defaultValue="mileage"
              >
                {equipmentTrackingModeOptions.map((option) => (
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
                name="status"
                defaultValue="active"
              >
                {equipmentStatusOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-2">
              <span className="text-sm font-medium text-[var(--ink)]">Location</span>
              <select
                className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                name="locationId"
                defaultValue=""
              >
                <option value="">Unassigned</option>
                {(locations ?? []).map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="grid gap-4 md:grid-cols-4">
            <label className="space-y-2">
              <span className="text-sm font-medium text-[var(--ink)]">Assigned to</span>
              <select
                className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                name="assignedTo"
                defaultValue=""
              >
                <option value="">Unassigned</option>
                {(users ?? []).map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.full_name}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-2">
              <span className="text-sm font-medium text-[var(--ink)]">Make</span>
              <input className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2" name="make" />
            </label>
            <label className="space-y-2">
              <span className="text-sm font-medium text-[var(--ink)]">Model</span>
              <input className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2" name="model" />
            </label>
            <label className="space-y-2">
              <span className="text-sm font-medium text-[var(--ink)]">Year</span>
              <input className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2" max="2200" min="1900" name="year" type="number" />
            </label>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <label className="space-y-2">
              <span className="text-sm font-medium text-[var(--ink)]">VIN or serial</span>
              <input className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2" name="vinOrSerial" />
            </label>
            <label className="space-y-2">
              <span className="text-sm font-medium text-[var(--ink)]">License plate</span>
              <input className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2" name="licensePlate" />
            </label>
            <label className="space-y-2">
              <span className="text-sm font-medium text-[var(--ink)]">Purchase date</span>
              <input className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2" name="purchaseDate" type="date" />
            </label>
          </div>
          <label className="space-y-2">
            <span className="text-sm font-medium text-[var(--ink)]">Notes</span>
            <textarea
              className="min-h-24 w-full rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
              name="notes"
            />
          </label>
          <label className="flex items-start gap-3 rounded-md border border-[var(--border)] bg-[var(--surface-muted)] p-3">
            <input className="mt-0.5 h-4 w-4" name="isCommercial" type="checkbox" value="true" />
            <span className="space-y-1">
              <span className="block text-sm font-medium text-[var(--ink)]">Commercial vehicle (NSC)</span>
              <span className="block text-xs text-[var(--ink-muted)]">
                Requires registration, insurance, and a maintenance record on file before the unit is complete.
              </span>
            </span>
          </label>
          <button
            className="inline-flex h-10 w-fit items-center justify-center gap-2 rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-white transition hover:bg-[var(--primary-strong)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
            type="submit"
          >
            <Save className="h-4 w-4" aria-hidden="true" />
            Save Equipment
          </button>
        </form>
      </details>

      <form className="mt-5 grid gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm xl:grid-cols-[1fr_170px_170px_210px_170px_auto] xl:items-end">
        <label className="space-y-2">
          <span className="text-sm font-medium text-[var(--ink)]">Search</span>
          <span className="relative block">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ink-muted)]" aria-hidden="true" />
            <input
              className="h-10 w-full rounded-md border border-[var(--border)] bg-white pl-9 pr-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
              defaultValue={query}
              name="q"
              placeholder="Unit, name, serial, location"
            />
          </span>
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
          <span className="text-sm font-medium text-[var(--ink)]">Category</span>
          <select
            className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
            defaultValue={category}
            name="category"
          >
            <option value="all">All categories</option>
            {equipmentCategoryOptions.map((option) => (
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
        <label className="space-y-2">
          <span className="text-sm font-medium text-[var(--ink)]">Assigned worker</span>
          <select
            className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
            defaultValue={assignedTo}
            name="assignedTo"
          >
            <option value="all">Anyone</option>
            <option value="unassigned">Unassigned</option>
            {(users ?? []).map((user) => (
              <option key={user.id} value={user.id}>
                {user.full_name}
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
        <div className="grid grid-cols-[1.1fr_130px_140px_130px_1fr_1fr_130px] gap-3 border-b border-[var(--border)] bg-[var(--surface-muted)] px-4 py-3 text-xs font-semibold uppercase text-[var(--ink-muted)] max-2xl:hidden">
          <span>Unit</span>
          <span>Category</span>
          <span>Meter</span>
          <span>Status</span>
          <span>Location</span>
          <span>Assigned</span>
          <span>Service</span>
        </div>

        {rows.length > 0 ? (
          <div className="divide-y divide-[var(--border)]">
            {rows.map((row) => (
              <div
                className="grid gap-4 px-4 py-4 transition hover:bg-[var(--surface-muted)] 2xl:grid-cols-[1.1fr_130px_140px_130px_1fr_1fr_130px] 2xl:items-center"
                key={row.equipment.id}
              >
                <div>
                  <Link className="font-semibold text-[var(--primary)] hover:underline" href={`/admin/equipment/${row.equipment.id}`}>
                    {row.equipment.unit_number}
                  </Link>
                  <p className="mt-1 text-sm text-[var(--ink-muted)]">{row.equipment.name ?? "Unnamed equipment"}</p>
                  <p className="mt-1 text-xs text-[var(--ink-muted)]">
                    {[row.equipment.make, row.equipment.model, row.equipment.year].filter(Boolean).join(" ") || "No specs recorded"}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Link
                      className="inline-flex h-8 items-center gap-1 rounded-md border border-[var(--border)] bg-white px-2.5 text-xs font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)]"
                      href={`/admin/equipment/${row.equipment.id}`}
                    >
                      Open file
                      <ArrowRight className="h-3.5 w-3.5 text-[var(--primary)]" aria-hidden="true" />
                    </Link>
                    <Link
                      className="inline-flex h-8 items-center gap-1 rounded-md border border-[var(--border)] bg-white px-2.5 text-xs font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)]"
                      href={`/admin/equipment/${row.equipment.id}?tab=service`}
                    >
                      <CalendarClock className="h-3.5 w-3.5 text-[var(--primary)]" aria-hidden="true" />
                      Service schedule
                    </Link>
                    <Link
                      className="inline-flex h-8 items-center gap-1 rounded-md border border-[var(--border)] bg-white px-2.5 text-xs font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)]"
                      href={`/admin/equipment/${row.equipment.id}?tab=maintenance`}
                    >
                      <Wrench className="h-3.5 w-3.5 text-[var(--primary)]" aria-hidden="true" />
                      Log maintenance
                    </Link>
                  </div>
                </div>
                <p className="inline-flex items-center gap-2 text-sm text-[var(--ink-muted)]">
                  <Truck className="h-4 w-4 text-[var(--primary)]" aria-hidden="true" />
                  {formatEquipmentCategory(row.equipment.category)}
                </p>
                <p className="inline-flex items-center gap-2 text-sm text-[var(--ink-muted)]">
                  <Gauge className="h-4 w-4 text-[var(--primary)]" aria-hidden="true" />
                  {formatEquipmentMeter({
                    trackingMode: row.equipment.tracking_mode,
                    value: row.equipment.current_meter,
                  })}
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
                <p className="inline-flex items-center gap-2 text-sm text-[var(--ink-muted)]">
                  <UserRound className="h-4 w-4 text-[var(--primary)]" aria-hidden="true" />
                  {row.assigneeName}
                </p>
                <span
                  className={`inline-flex w-fit rounded-full border px-2.5 py-1 text-xs font-semibold ${equipmentDueStatusClass(row.serviceIndicator)}`}
                >
                  {row.serviceDetail}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="px-4 py-12 text-center">
            <Wrench className="mx-auto h-8 w-8 text-[var(--primary)]" aria-hidden="true" />
            <h2 className="mt-3 text-lg font-semibold text-[var(--ink)]">No equipment yet</h2>
            <p className="mt-1 text-sm text-[var(--ink-muted)]">
              Add a unit above, then open its file to set up a service schedule and log maintenance.
            </p>
          </div>
        )}
      </section>
    </AdminShell>
  );
}
