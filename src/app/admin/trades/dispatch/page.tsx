import Link from "next/link";
import { redirect } from "next/navigation";
import { CalendarClock, ChevronLeft, ChevronRight, Inbox, UserRound } from "lucide-react";
import { AdminShell } from "@/app/admin/_components/AdminShell";
import { canUseAdminPanel } from "@/lib/access-control";
import { requireAppUser } from "@/lib/current-user";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { workOrderStatusBadge, workOrderStatusLabel, workTypeLabel } from "@/lib/trades";
import type { Database } from "@/types/database";

export const dynamic = "force-dynamic";

type WorkOrderRow = Pick<
  Database["public"]["Tables"]["trade_work_order"]["Row"],
  "id" | "title" | "status" | "work_type" | "scheduled_start" | "scheduled_end" | "assigned_user_id" | "customer_id"
>;
type CustomerNameRow = Pick<Database["public"]["Tables"]["trade_customer"]["Row"], "id" | "name">;
type UserRow = Pick<Database["public"]["Tables"]["users"]["Row"], "id" | "full_name">;

type DispatchPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(value: string | string[] | undefined): string | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// The board works in UTC calendar days so the day shown matches the time entered
// on a work order (which is stored as given). Timezone-aware scheduling is a
// later refinement.
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function shiftIso(dateIso: string, days: number): string {
  const date = new Date(`${dateIso}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function formatDayHeading(dateIso: string): string {
  return new Intl.DateTimeFormat("en", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${dateIso}T00:00:00.000Z`));
}

function formatTime(value: string | null): string {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return new Intl.DateTimeFormat("en", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" }).format(date);
}

function cardTimeRange(workOrder: WorkOrderRow): string {
  const start = formatTime(workOrder.scheduled_start);
  const end = formatTime(workOrder.scheduled_end);
  if (start && end) {
    return `${start} – ${end}`;
  }
  return start || "Anytime";
}

export default async function TradeDispatchPage({ searchParams }: DispatchPageProps) {
  const context = await requireAppUser();

  if (!canUseAdminPanel(context.appUser)) {
    redirect("/choose");
  }
  if (!context.tenant?.trades_enabled) {
    redirect("/admin/setup");
  }

  const params = await searchParams;
  const dateParam = firstParam(params.date);
  const dateIso = dateParam && DATE_PATTERN.test(dateParam) ? dateParam : todayIso();
  const dayStart = `${dateIso}T00:00:00.000Z`;
  const dayEnd = `${shiftIso(dateIso, 1)}T00:00:00.000Z`;

  const supabase = await createSupabaseServerClient();
  const [{ data: scheduledRows }, { data: backlogRows }, { data: userRows }, { data: customerRows }] =
    await Promise.all([
      supabase
        .from("trade_work_order")
        .select("id, title, status, work_type, scheduled_start, scheduled_end, assigned_user_id, customer_id")
        .eq("tenant_id", context.appUser.tenant_id)
        .gte("scheduled_start", dayStart)
        .lt("scheduled_start", dayEnd)
        .order("scheduled_start", { ascending: true })
        .returns<WorkOrderRow[]>(),
      supabase
        .from("trade_work_order")
        .select("id, title, status, work_type, scheduled_start, scheduled_end, assigned_user_id, customer_id")
        .eq("tenant_id", context.appUser.tenant_id)
        .is("scheduled_start", null)
        .in("status", ["open", "scheduled"])
        .order("created_at", { ascending: false })
        .returns<WorkOrderRow[]>(),
      supabase
        .from("users")
        .select("id, full_name")
        .eq("tenant_id", context.appUser.tenant_id)
        .eq("active", true)
        .order("full_name", { ascending: true })
        .returns<UserRow[]>(),
      supabase
        .from("trade_customer")
        .select("id, name")
        .eq("tenant_id", context.appUser.tenant_id)
        .returns<CustomerNameRow[]>(),
    ]);
  const scheduled = scheduledRows ?? [];
  const backlog = backlogRows ?? [];
  const userName = new Map((userRows ?? []).map((user) => [user.id, user.full_name]));
  const customerName = new Map((customerRows ?? []).map((customer) => [customer.id, customer.name]));

  // Group the day's work into lanes by technician, with an Unassigned lane last.
  const lanes = new Map<string, WorkOrderRow[]>();
  for (const workOrder of scheduled) {
    const key = workOrder.assigned_user_id ?? "unassigned";
    const lane = lanes.get(key) ?? [];
    lane.push(workOrder);
    lanes.set(key, lane);
  }
  const laneKeys = [...lanes.keys()].sort((a, b) => {
    if (a === "unassigned") return 1;
    if (b === "unassigned") return -1;
    return (userName.get(a) ?? "").localeCompare(userName.get(b) ?? "");
  });

  function renderCard(workOrder: WorkOrderRow) {
    return (
      <Link
        className="block rounded-md border border-[var(--border)] bg-white p-3 transition hover:border-[var(--primary)] hover:bg-[var(--surface-muted)]"
        href={`/admin/trades/work-orders/${workOrder.id}`}
        key={workOrder.id}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-semibold text-[var(--ink)]">{cardTimeRange(workOrder)}</span>
          <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${workOrderStatusBadge(workOrder.status)}`}>
            {workOrderStatusLabel(workOrder.status)}
          </span>
        </div>
        <p className="mt-1 truncate text-sm font-semibold text-[var(--ink)]">{workOrder.title}</p>
        <p className="truncate text-xs text-[var(--ink-muted)]">
          {[customerName.get(workOrder.customer_id) ?? "Unknown customer", workTypeLabel(workOrder.work_type)]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </Link>
    );
  }

  return (
    <AdminShell eyebrow="Trades" tenantName={context.tenant?.name ?? "Company profile"} title="Dispatch">
      <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <CalendarClock className="h-5 w-5 text-[var(--primary)]" aria-hidden="true" />
            <h2 className="text-lg font-semibold text-[var(--ink)]">{formatDayHeading(dateIso)}</h2>
          </div>
          <div className="flex items-center gap-2">
            <Link
              aria-label="Previous day"
              className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-[var(--border)] bg-white text-[var(--ink-muted)] transition hover:text-[var(--ink)]"
              href={`/admin/trades/dispatch?date=${shiftIso(dateIso, -1)}`}
            >
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            </Link>
            <Link
              className="inline-flex h-9 items-center justify-center rounded-md border border-[var(--border)] bg-white px-3 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)]"
              href="/admin/trades/dispatch"
            >
              Today
            </Link>
            <Link
              aria-label="Next day"
              className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-[var(--border)] bg-white text-[var(--ink-muted)] transition hover:text-[var(--ink)]"
              href={`/admin/trades/dispatch?date=${shiftIso(dateIso, 1)}`}
            >
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>
        </div>

        {laneKeys.length === 0 ? (
          <div className="mt-5 flex flex-col items-center gap-2 rounded-md border border-dashed border-[var(--border)] p-8 text-center">
            <CalendarClock className="h-6 w-6 text-[var(--ink-muted)]" aria-hidden="true" />
            <p className="text-sm text-[var(--ink-muted)]">Nothing scheduled for this day.</p>
          </div>
        ) : (
          <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {laneKeys.map((key) => {
              const lane = lanes.get(key) ?? [];
              const label = key === "unassigned" ? "Unassigned" : userName.get(key) ?? "Unknown technician";

              return (
                <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-3" key={key}>
                  <div className="flex items-center justify-between gap-2 px-1">
                    <h3 className="flex items-center gap-1.5 text-sm font-semibold text-[var(--ink)]">
                      <UserRound className="h-4 w-4 text-[var(--primary)]" aria-hidden="true" />
                      {label}
                    </h3>
                    <span className="rounded-md bg-white px-2 py-0.5 text-xs font-semibold text-[var(--ink-muted)]">
                      {lane.length}
                    </span>
                  </div>
                  <div className="mt-3 space-y-2">{lane.map(renderCard)}</div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-[var(--ink)]">
          <Inbox className="h-5 w-5 text-[var(--primary)]" aria-hidden="true" />
          Unscheduled backlog
          <span className="rounded-md bg-[var(--surface-muted)] px-2 py-0.5 text-sm font-semibold text-[var(--ink-muted)]">
            {backlog.length}
          </span>
        </h2>
        <p className="mt-1 text-sm text-[var(--ink-muted)]">
          Open work without a scheduled time. Open one to assign a technician and a slot.
        </p>
        {backlog.length === 0 ? (
          <p className="mt-4 rounded-md border border-dashed border-[var(--border)] p-6 text-center text-sm text-[var(--ink-muted)]">
            Nothing waiting to be scheduled.
          </p>
        ) : (
          <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-3">{backlog.map(renderCard)}</div>
        )}
      </section>
    </AdminShell>
  );
}
