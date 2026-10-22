import Link from "next/link";
import { redirect } from "next/navigation";
import { CalendarClock, Hammer, Plus, RefreshCw } from "lucide-react";
import { AdminShell } from "@/app/admin/_components/AdminShell";
import { raisePreventiveWorkOrdersNow } from "@/app/admin/maintenance/actions";
import {
  Flash,
  PriorityBadge,
  firstParam,
  inputClass,
  primaryButtonClass,
  secondaryButtonClass,
  sectionClass,
} from "@/app/admin/maintenance/_components/MaintenanceChrome";
import {
  equipmentLabel,
  loadEquipmentOptions,
  loadPeople,
  todayIso,
  workOrderPath,
  type WorkOrderRow,
} from "@/app/admin/maintenance/_lib/maintenance-data";
import { canUseAdminPanel } from "@/lib/access-control";
import { requireAppUser } from "@/lib/current-user";
import {
  filterWorkOrders,
  formatWorkOrderNumber,
  groupForBoard,
  isWorkOrderOverdue,
  maintenanceStatuses,
  maintenanceStatusOrder,
  maintenanceTypes,
  parseBoardFilters,
  parseWorkOrderNumber,
  typeLabel,
} from "@/lib/maintenance";
import { formatMoney } from "@/lib/purchasing";
import { selectAllRows } from "@/lib/supabase/select-all";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// Closed and cancelled work piles up; the board shows the most recent of each. Older ones
// are found by number, or on the asset's Work orders tab.
const FINISHED_LIMIT = 60;

type MaintenancePageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function MaintenancePage({ searchParams }: MaintenancePageProps) {
  const query = await searchParams;
  const context = await requireAppUser();

  if (!canUseAdminPanel(context.appUser)) {
    redirect("/choose");
  }

  // Maintenance is gated by a tenant toggle. When off, the nav entry is hidden, so send
  // any direct hits to Setup where the toggle lives.
  if (!context.tenant?.maintenance_enabled) {
    redirect("/admin/setup");
  }

  const supabase = await createSupabaseServerClient();
  const tenantId = context.appUser.tenant_id;
  const filters = parseBoardFilters({
    asset: firstParam(query.asset),
    assignee: firstParam(query.assignee),
    overdue: firstParam(query.overdue),
    type: firstParam(query.type),
  });
  const search = (firstParam(query.q) ?? "").trim();
  const searchNumber = search ? parseWorkOrderNumber(search) : null;
  const today = todayIso();

  const [working, finished, equipment, people] = await Promise.all([
    selectAllRows<WorkOrderRow>((from, to) =>
      supabase
        .from("maintenance_work_order")
        .select("*")
        .eq("tenant_id", tenantId)
        .not("status", "in", "(closed,cancelled)")
        .order("number", { ascending: true })
        .range(from, to)
        .returns<WorkOrderRow[]>(),
    ),
    supabase
      .from("maintenance_work_order")
      .select("*")
      .eq("tenant_id", tenantId)
      .in("status", ["closed", "cancelled"])
      .order("updated_at", { ascending: false })
      .limit(FINISHED_LIMIT * 2)
      .returns<WorkOrderRow[]>(),
    loadEquipmentOptions(supabase, tenantId),
    loadPeople(supabase, tenantId),
  ]);

  let rows = [...working, ...(finished.data ?? [])];

  if (searchNumber !== null) {
    rows = rows.filter((row) => row.number === searchNumber);

    if (rows.length === 0) {
      const { data } = await supabase
        .from("maintenance_work_order")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("number", searchNumber)
        .returns<WorkOrderRow[]>();
      rows = data ?? [];
    }
  } else if (search) {
    const needle = search.toLowerCase();
    rows = rows.filter((row) => row.title.toLowerCase().includes(needle));
  }

  const visible = filterWorkOrders(rows, filters, today);
  const columns = groupForBoard(visible);
  const equipmentById = new Map(equipment.map((row) => [row.id, row]));
  const personById = new Map(people.map((person) => [person.id, person.name]));
  const overdueCount = working.filter((row) => isWorkOrderOverdue(row, today)).length;
  const filtersOn = Boolean(filters.assigneeId || filters.equipmentId || filters.type || filters.overdueOnly || search);

  return (
    <AdminShell eyebrow="Operations" tenantName={context.tenant?.name ?? "Company profile"} title="Maintenance">
      <Flash error={firstParam(query.error)} notice={firstParam(query.notice)} />

      <section className={sectionClass}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-[var(--surface-muted)] text-[var(--primary)]">
              <Hammer className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-[var(--ink)]">Work orders</h2>
              <p className="mt-1 max-w-2xl text-sm text-[var(--ink-muted)]">
                Repairs and service on your own assets, from request to close. Closing a work order writes the job and its
                cost into the asset&apos;s history. {overdueCount > 0 ? `${overdueCount} open work order${overdueCount === 1 ? " is" : "s are"} past due.` : ""}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <form action={raisePreventiveWorkOrdersNow}>
              <button className={secondaryButtonClass} type="submit">
                <RefreshCw className="h-4 w-4" aria-hidden="true" />
                Check scheduled service now
              </button>
            </form>
            <Link className={primaryButtonClass} href="/admin/maintenance/new">
              <Plus className="h-4 w-4" aria-hidden="true" />
              New work order
            </Link>
          </div>
        </div>
      </section>

      <form action="/admin/maintenance" className="mt-4 grid gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm md:grid-cols-6" method="get">
        <input aria-label="Search work orders" className={`${inputClass} md:col-span-2`} defaultValue={search} name="q" placeholder="WO number or title" />
        <select aria-label="Asset" className={inputClass} defaultValue={filters.equipmentId ?? ""} name="asset">
          <option value="">Every asset</option>
          {equipment.map((row) => (
            <option key={row.id} value={row.id}>
              {equipmentLabel(row)}
            </option>
          ))}
        </select>
        <select aria-label="Type" className={inputClass} defaultValue={filters.type ?? ""} name="type">
          <option value="">Every type</option>
          {maintenanceTypes.map((type) => (
            <option key={type.value} value={type.value}>
              {type.label}
            </option>
          ))}
        </select>
        <select aria-label="Assigned to" className={inputClass} defaultValue={filters.assigneeId ?? ""} name="assignee">
          <option value="">Anyone</option>
          <option value="none">Nobody yet</option>
          {people
            .filter((person) => person.active)
            .map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
        </select>
        <div className="flex items-center gap-3">
          <label className="inline-flex items-center gap-2 text-sm text-[var(--ink)]">
            <input defaultChecked={filters.overdueOnly} name="overdue" type="checkbox" value="1" />
            Overdue only
          </label>
          <button className={secondaryButtonClass} type="submit">
            Filter
          </button>
        </div>
        {filtersOn ? (
          <Link className="text-sm font-semibold text-[var(--primary)] hover:underline md:col-span-6" href="/admin/maintenance">
            Clear filters
          </Link>
        ) : null}
      </form>

      <div className="mt-4 flex gap-3 overflow-x-auto pb-2">
        {maintenanceStatusOrder.map((status) => {
          const all = columns.get(status) ?? [];
          const shown = status === "closed" || status === "cancelled" ? all.slice(0, FINISHED_LIMIT) : all;

          return (
            <section
              aria-label={maintenanceStatuses[status].label}
              className="w-72 shrink-0 rounded-lg border border-[var(--border)] bg-[var(--surface-muted)]"
              key={status}
            >
              <h3 className="flex items-center justify-between border-b border-[var(--border)] px-3 py-2 text-sm font-semibold text-[var(--ink)]">
                {maintenanceStatuses[status].label}
                <span className="rounded-full bg-white px-2 py-0.5 text-xs text-[var(--ink-muted)]">{all.length}</span>
              </h3>
              <div className="grid gap-2 p-2">
                {shown.length === 0 ? <p className="px-1 py-2 text-xs text-[var(--ink-muted)]">Nothing here.</p> : null}
                {shown.map((row) => {
                  const asset = row.equipment_id ? equipmentById.get(row.equipment_id) : null;
                  const overdue = isWorkOrderOverdue(row, today);

                  return (
                    <Link
                      className="block rounded-md border border-[var(--border)] bg-white p-3 text-sm shadow-sm transition hover:border-[var(--primary)]"
                      href={workOrderPath(row.id)}
                      key={row.id}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-[var(--primary)]">{formatWorkOrderNumber(row.number)}</span>
                        <PriorityBadge priority={row.priority} />
                      </span>
                      <span className="mt-1 block font-medium text-[var(--ink)]">{row.title}</span>
                      <span className="mt-1 block text-xs text-[var(--ink-muted)]">
                        {row.equipment_id ? equipmentLabel(asset) : "No asset"} · {typeLabel(row.type)}
                      </span>
                      <span className="mt-1 block text-xs text-[var(--ink-muted)]">
                        {row.assignee_id ? (personById.get(row.assignee_id) ?? "Unknown") : "Not assigned"}
                      </span>
                      <span className="mt-2 flex items-center justify-between text-xs">
                        <span className={overdue ? "inline-flex items-center gap-1 font-semibold text-[var(--danger)]" : "inline-flex items-center gap-1 text-[var(--ink-muted)]"}>
                          {row.due_date ? (
                            <>
                              <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />
                              {overdue ? "Overdue " : "Due "}
                              {row.due_date}
                            </>
                          ) : null}
                        </span>
                        <span className="tabular-nums text-[var(--ink-muted)]">{formatMoney(row.total_cost)}</span>
                      </span>
                    </Link>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </AdminShell>
  );
}
