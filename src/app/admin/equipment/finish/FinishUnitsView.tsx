import Link from "next/link";
import { ArrowRight, CheckCircle2, ExternalLink, SkipForward } from "lucide-react";
import { FinishTaskCard } from "@/app/admin/equipment/finish/FinishTaskCard";
import { describeTask, type FinishUnitRow, type UnitFinish } from "@/lib/unit-finish";

// The Finish Your Units screen, given its numbers. Kept apart from the page so the page
// only has to fetch, and so the screen can be looked at with made-up units (see
// src/app/e2e-fixtures/finish-units) without signing in to a real company.

export type FinishUnitsViewProps = {
  current: UnitFinish | undefined;
  error?: string;
  finished: number;
  justFinished: UnitFinish | undefined;
  notice?: string;
  queueLength: number;
  returnTo: string;
  skipHref: string;
  tenantId: string;
  total: number;
  upNext: UnitFinish[];
};

export function formatFinishDate(value: string) {
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("en-CA", { day: "numeric", month: "long", timeZone: "UTC", year: "numeric" });
}

export function finishUnitLabel(unit: FinishUnitRow) {
  return unit.name && unit.name !== unit.unit_number ? `Unit ${unit.unit_number} (${unit.name})` : `Unit ${unit.unit_number}`;
}

export function FinishUnitsView({
  current,
  error,
  finished,
  justFinished,
  notice,
  queueLength,
  returnTo,
  skipHref,
  tenantId,
  total,
  upNext,
}: FinishUnitsViewProps) {
  const percent = total === 0 ? 0 : Math.round((finished / total) * 100);

  return (
    <>
      <p className="max-w-2xl text-sm text-[var(--ink-muted)]">
        One unit at a time. Upload what each unit is asking for and it turns green, then the next one comes up. The units
        closest to finished come first.
      </p>

      <section className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-lg font-semibold text-[var(--ink)]">
            {finished} of {total} units have everything on file
          </p>
          <p className="text-sm font-semibold tabular-nums text-[var(--success)]">{percent}%</p>
        </div>
        <div className="mt-3 h-3 w-full overflow-hidden rounded-full bg-[var(--surface-muted)]">
          <div className="h-full rounded-full bg-[var(--success)] transition-all" style={{ width: `${percent}%` }} />
        </div>
      </section>

      {justFinished ? (
        <p className="mt-4 flex items-center gap-2 rounded-md border border-[var(--success)] bg-emerald-50 p-3 text-sm font-semibold text-[var(--success)]">
          <CheckCircle2 className="h-5 w-5 shrink-0" aria-hidden="true" />
          {finishUnitLabel(justFinished.unit)} is done. Everything it needs is on file.
        </p>
      ) : notice ? (
        <p className="mt-4 rounded-md border border-[var(--success)] bg-emerald-50 p-3 text-sm text-[var(--success)]">{notice}</p>
      ) : null}
      {error ? (
        <p className="mt-4 rounded-md border border-[var(--danger)] bg-red-50 p-3 text-sm text-[var(--danger)]">{error}</p>
      ) : null}

      {current ? (
        <section className="mt-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">Working on</p>
              <h2 className="text-2xl font-bold text-[var(--ink)]">{finishUnitLabel(current.unit)}</h2>
              <p className="text-sm text-[var(--ink-muted)]">
                {current.open === 1 ? "1 thing left" : `${current.open} things left`} to turn this unit green.
              </p>
            </div>
            <div className="flex flex-wrap gap-3 text-sm">
              <Link
                className="inline-flex items-center gap-1.5 font-semibold text-[var(--primary)] hover:underline"
                href={`/admin/equipment/${current.unit.id}?tab=documents`}
              >
                <ExternalLink className="h-4 w-4" aria-hidden="true" />
                Open the full unit page
              </Link>
              <Link className="inline-flex items-center gap-1.5 font-semibold text-[var(--ink-muted)] hover:underline" href={skipHref}>
                <SkipForward className="h-4 w-4" aria-hidden="true" />
                Skip this unit for now
              </Link>
            </div>
          </div>

          <ul className="mt-4 grid gap-3">
            {current.tasks.map((task) => (
              <FinishTaskCard
                description={describeTask(task, formatFinishDate)}
                equipmentId={current.unit.id}
                key={task.key}
                returnTo={returnTo}
                task={task}
                tenantId={tenantId}
                unitLabel={finishUnitLabel(current.unit)}
              />
            ))}
          </ul>
        </section>
      ) : (
        <section className="mt-5 rounded-lg border border-[var(--success)] bg-emerald-50 p-6 text-center">
          <CheckCircle2 className="mx-auto h-10 w-10 text-[var(--success)]" aria-hidden="true" />
          <p className="mt-2 text-lg font-semibold text-[var(--ink)]">Every unit has everything on file.</p>
          <p className="text-sm text-[var(--ink-muted)]">Renewals will show up here as they come due.</p>
        </section>
      )}

      {upNext.length > 0 ? (
        <section className="mt-6">
          <h2 className="text-sm font-semibold text-[var(--ink)]">Up next</h2>
          <ul className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {upNext.map((entry) => (
              <li key={entry.unit.id}>
                <Link
                  className="flex items-center justify-between gap-2 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm transition hover:bg-[var(--surface-muted)]"
                  href={`/admin/equipment/finish?unit=${entry.unit.id}`}
                >
                  <span className="font-semibold text-[var(--ink)]">{finishUnitLabel(entry.unit)}</span>
                  <span className="inline-flex items-center gap-1 text-[var(--ink-muted)]">
                    {entry.open === 1 ? "1 thing" : `${entry.open} things`}
                    <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          {queueLength > upNext.length + 1 ? (
            <p className="mt-2 text-xs text-[var(--ink-muted)]">and {queueLength - upNext.length - 1} more after those.</p>
          ) : null}
        </section>
      ) : null}
    </>
  );
}
