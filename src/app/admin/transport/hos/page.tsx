import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertTriangle, ArrowLeft, BadgeCheck, Clock, Gauge, UserRound } from "lucide-react";
import { AdminShell } from "@/app/admin/_components/AdminShell";
import { canUseAdminPanel } from "@/lib/access-control";
import { requireAppUser } from "@/lib/current-user";
import {
  computeAvailability,
  computeHosViolations,
  DUTY_STATUS_LABELS,
  type DutyStatusEvent,
} from "@/lib/hos-rules";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

export const dynamic = "force-dynamic";

type DriverRow = Pick<
  Database["public"]["Tables"]["transport_driver"]["Row"],
  "id" | "full_name" | "hos_cycle" | "hos_regime" | "status"
>;
type EventRow = Pick<
  Database["public"]["Tables"]["transport_duty_status_event"]["Row"],
  "driver_id" | "status" | "started_at"
>;

// Cycle 2 spans 14 days, so two weeks of events covers every availability window.
const EVENT_WINDOW_DAYS = 15;

// Isolated impure read (request time) so the page component body stays pure.
function eventWindowStartIso() {
  return new Date(Date.now() - EVENT_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

export default async function TransportHosPage() {
  const context = await requireAppUser();

  if (!canUseAdminPanel(context.appUser)) {
    redirect("/choose");
  }

  if (!context.tenant?.transport_enabled) {
    redirect("/admin/setup");
  }

  const supabase = await createSupabaseServerClient();
  const tenantId = context.appUser.tenant_id;
  const windowStart = eventWindowStartIso();

  const [{ data: drivers }, { data: events }] = await Promise.all([
    supabase
      .from("transport_driver")
      .select("id, full_name, hos_cycle, hos_regime, status")
      .eq("tenant_id", tenantId)
      .is("deleted_at", null)
      .order("full_name", { ascending: true })
      .returns<DriverRow[]>(),
    supabase
      .from("transport_duty_status_event")
      .select("driver_id, status, started_at")
      .eq("tenant_id", tenantId)
      .gte("started_at", windowStart)
      .order("started_at", { ascending: true })
      .returns<EventRow[]>(),
  ]);

  const eventsByDriver = new Map<string, DutyStatusEvent[]>();
  for (const event of events ?? []) {
    eventsByDriver.set(event.driver_id, [
      ...(eventsByDriver.get(event.driver_id) ?? []),
      { status: event.status, startedAt: event.started_at },
    ]);
  }

  const rows = (drivers ?? []).map((driver) => {
    const driverEvents = eventsByDriver.get(driver.id) ?? [];
    const availability = computeAvailability({ events: driverEvents, cycle: driver.hos_cycle, regime: driver.hos_regime });
    const violations = computeHosViolations({ events: driverEvents, cycle: driver.hos_cycle, regime: driver.hos_regime });
    // "Near limit" warns before a breach: under an hour of drive time or under
    // ten hours of cycle time left, when not already in violation. Provincial
    // drivers have no cycle, so only the drive-time threshold applies to them.
    const nearLimit =
      violations.length === 0 &&
      driverEvents.length > 0 &&
      (availability.driveRemainingHours <= 1 ||
        (availability.cycleRemainingHours !== null && availability.cycleRemainingHours <= 10));

    return { driver, availability, violationCount: violations.length, nearLimit };
  });

  // Worst first: violations, then near-limit, then least drive time remaining.
  const sortedRows = [...rows].sort((a, b) => {
    if (b.violationCount !== a.violationCount) {
      return b.violationCount - a.violationCount;
    }
    if (a.nearLimit !== b.nearLimit) {
      return a.nearLimit ? -1 : 1;
    }
    return a.availability.driveRemainingHours - b.availability.driveRemainingHours;
  });

  const inViolation = rows.filter((row) => row.violationCount > 0).length;
  const nearLimitCount = rows.filter((row) => row.nearLimit).length;

  const summary = [
    { label: "Drivers", value: rows.length, alert: false },
    { label: "In HOS violation", value: inViolation, alert: inViolation > 0 },
    { label: "Near a limit", value: nearLimitCount, alert: nearLimitCount > 0 },
  ];

  return (
    <AdminShell eyebrow="Transport" tenantName={context.tenant?.name ?? "Company profile"} title="Hours of Service">
      <Link
        className="inline-flex items-center gap-1 text-sm font-semibold text-[var(--primary)] hover:underline"
        href="/admin/transport"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Transport
      </Link>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-[var(--ink-muted)]">
          Live Alberta NSC availability across the fleet, computed from each driver&apos;s duty-status log, logged
          manually or imported from a connected ELD.
        </p>
        <Link
          className="inline-flex h-10 shrink-0 items-center gap-1 rounded-md border border-[var(--border)] px-3 text-sm font-semibold text-[var(--primary)] transition hover:bg-[var(--surface-muted)]"
          href="/admin/transport/connections"
        >
          ELD connections
        </Link>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-3">
        {summary.map((stat) => (
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm" key={stat.label}>
            <p className="flex items-center gap-2 text-sm text-[var(--ink-muted)]">
              {stat.alert ? (
                <AlertTriangle className="h-4 w-4 text-[var(--danger)]" aria-hidden="true" />
              ) : (
                <BadgeCheck className="h-4 w-4 text-[var(--success)]" aria-hidden="true" />
              )}
              {stat.label}
            </p>
            <p className={`mt-2 text-2xl font-bold ${stat.alert ? "text-[var(--danger)]" : "text-[var(--ink)]"}`}>
              {stat.value}
            </p>
          </div>
        ))}
      </div>

      <section className="mt-5 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-sm">
        <div className="grid grid-cols-[1.4fr_110px_160px_110px_110px_140px] gap-3 border-b border-[var(--border)] bg-[var(--surface-muted)] px-4 py-3 text-xs font-semibold uppercase text-[var(--ink-muted)] max-2xl:hidden">
          <span>Driver</span>
          <span>Cycle</span>
          <span>Status</span>
          <span>Drive left</span>
          <span>Cycle left</span>
          <span>HOS status</span>
        </div>

        {sortedRows.length > 0 ? (
          <div className="divide-y divide-[var(--border)]">
            {sortedRows.map(({ driver, availability, violationCount, nearLimit }) => (
              <Link
                className="grid gap-3 px-4 py-4 transition hover:bg-[var(--surface-muted)] 2xl:grid-cols-[1.4fr_110px_160px_110px_110px_140px] 2xl:items-center"
                href={`/admin/transport/drivers/${driver.id}`}
                key={driver.id}
              >
                <div>
                  <p className="font-semibold text-[var(--ink)]">{driver.full_name}</p>
                  {driver.status !== "active" ? (
                    <p className="mt-1 text-xs uppercase tracking-wide text-[var(--ink-muted)]">Inactive</p>
                  ) : null}
                </div>
                <p className="text-sm text-[var(--ink-muted)]">{driver.hos_cycle === "cycle_2" ? "Cycle 2" : "Cycle 1"}</p>
                <p className="inline-flex items-center gap-2 text-sm text-[var(--ink-muted)]">
                  <Clock className="h-4 w-4 text-[var(--primary)]" aria-hidden="true" />
                  {DUTY_STATUS_LABELS[availability.currentStatus]}
                </p>
                <p
                  className={`inline-flex items-center gap-1 text-sm font-semibold ${
                    availability.driveRemainingHours <= 0 ? "text-[var(--danger)]" : "text-[var(--ink)]"
                  }`}
                >
                  <Gauge className="h-4 w-4 text-[var(--ink-muted)]" aria-hidden="true" />
                  {availability.driveRemainingHours} h
                </p>
                <p
                  className={`text-sm font-semibold ${
                    availability.cycleRemainingHours !== null && availability.cycleRemainingHours <= 0
                      ? "text-[var(--danger)]"
                      : "text-[var(--ink)]"
                  }`}
                >
                  {availability.cycleRemainingHours === null ? "No cycle" : `${availability.cycleRemainingHours} h`}
                </p>
                {violationCount > 0 ? (
                  <span className="inline-flex w-fit items-center gap-1 rounded-full border border-[var(--danger)] bg-red-50 px-2.5 py-1 text-xs font-semibold text-[var(--danger)]">
                    <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                    {violationCount} violation{violationCount === 1 ? "" : "s"}
                  </span>
                ) : nearLimit ? (
                  <span className="inline-flex w-fit items-center gap-1 rounded-full border border-[var(--warning)] bg-amber-50 px-2.5 py-1 text-xs font-semibold text-[var(--warning)]">
                    <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                    Near limit
                  </span>
                ) : (
                  <span className="inline-flex w-fit items-center gap-1 rounded-full border border-[var(--success)] bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-[var(--success)]">
                    <BadgeCheck className="h-4 w-4" aria-hidden="true" />
                    Compliant
                  </span>
                )}
              </Link>
            ))}
          </div>
        ) : (
          <div className="px-4 py-12 text-center">
            <UserRound className="mx-auto h-8 w-8 text-[var(--primary)]" aria-hidden="true" />
            <h2 className="mt-3 text-lg font-semibold text-[var(--ink)]">No drivers yet</h2>
            <p className="mt-1 text-sm text-[var(--ink-muted)]">Add a driver to start tracking Hours of Service.</p>
          </div>
        )}
      </section>
    </AdminShell>
  );
}
