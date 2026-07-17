import { AlertTriangle, BadgeCheck, Clock3 } from "lucide-react";
import { logMyDutyStatus } from "@/app/actions";

export type WorkerHosClock = { label: string; value: number; of: number };

const SELF_DUTY_OPTIONS = [
  { value: "off_duty", label: "Off duty" },
  { value: "sleeper_berth", label: "Sleeper" },
  { value: "driving", label: "Driving" },
  { value: "on_duty", label: "On duty" },
] as const;

/**
 * Worker-app Hours of Service panel: a linked driver taps their current duty
 * status and sees their remaining hours. Each button posts the self-log action,
 * which records a duty-status event for the worker's own driver record.
 */
export function WorkerHosPanel(props: {
  currentStatus: string;
  currentStatusLabel: string;
  regimeLabel: string;
  clocks: WorkerHosClock[];
  violations: number;
}) {
  return (
    <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm" id="my-hours">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-[var(--ink)]">
          <Clock3 className="h-5 w-5 text-[var(--primary)]" aria-hidden="true" />
          My hours
        </h2>
        <span className="rounded-full bg-[var(--surface-muted)] px-2.5 py-1 text-xs font-semibold text-[var(--ink-muted)]">
          {props.regimeLabel}
        </span>
      </div>
      <p className="mt-1 text-sm text-[var(--ink-muted)]">
        Current status: <span className="font-semibold text-[var(--ink)]">{props.currentStatusLabel}</span>
      </p>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {SELF_DUTY_OPTIONS.map((option) => {
          const active = option.value === props.currentStatus;

          return (
            <form action={logMyDutyStatus} key={option.value}>
              <input name="status" type="hidden" value={option.value} />
              <button
                className={`w-full rounded-md border px-3 py-2 text-sm font-semibold transition ${
                  active
                    ? "border-[var(--primary)] bg-[var(--primary)] text-white"
                    : "border-[var(--border)] bg-white text-[var(--ink)] hover:bg-[var(--surface-muted)]"
                }`}
                type="submit"
              >
                {option.label}
              </button>
            </form>
          );
        })}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {props.clocks.map((clock) => (
          <div className="rounded-md border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-3 text-center" key={clock.label}>
            <p className="text-xs uppercase tracking-wide text-[var(--ink-muted)]">{clock.label}</p>
            <p className={`mt-1 text-xl font-bold ${clock.value <= 0 ? "text-[var(--danger)]" : "text-[var(--ink)]"}`}>
              {clock.value}
              <span className="text-xs font-medium text-[var(--ink-muted)]"> / {clock.of} h</span>
            </p>
          </div>
        ))}
      </div>

      {props.violations > 0 ? (
        <p className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-[var(--danger)]">
          <AlertTriangle className="h-4 w-4" aria-hidden="true" />
          {props.violations} hours-of-service {props.violations === 1 ? "violation" : "violations"} in your log.
        </p>
      ) : (
        <p className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-[var(--success)]">
          <BadgeCheck className="h-4 w-4" aria-hidden="true" />
          No hours-of-service violations.
        </p>
      )}
    </section>
  );
}
