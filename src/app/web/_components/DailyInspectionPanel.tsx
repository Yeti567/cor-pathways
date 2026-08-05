import { ClipboardCheck } from "lucide-react";
import {
  OVERALL_RESULT_BADGE,
  OVERALL_RESULT_LABELS,
  type OverallResult,
} from "@/lib/daily-inspection";
import { PROVINCE_LABELS } from "@/lib/dti-rules";

type RecentInspection = {
  id: string;
  vehicleLabel: string;
  province: "BC" | "AB" | "ON";
  overall_result: OverallResult;
  outOfService: boolean;
  completed_at: string;
};

// The driver's own inspection record, read only.
//
// The pre-trip itself is a form: the driver fills it in Assigned Forms with every
// other form, which is what makes it sync offline, carry photos and a signature,
// and raise corrective actions. This panel is the result of those submissions, so
// a driver can see at a glance whether a unit they inspected is out of service.
export function DailyInspectionPanel({ recent }: { recent: RecentInspection[] }) {
  const outOfService = recent.filter((row) => row.outOfService);

  return (
    <section
      className="scroll-mt-24 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm"
      id="trip-inspections"
    >
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-[var(--surface-muted)] text-[var(--primary)]">
          <ClipboardCheck className="h-5 w-5" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-[var(--ink)]">Daily trip inspection</h2>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">
            Your pre-trip is one of your assigned forms. Open it above, walk the unit, and answer every item. A major
            defect means the vehicle is out of service: do not drive it, and tell your supervisor.
          </p>
        </div>
      </div>

      {outOfService.length > 0 ? (
        <div className="mt-4 rounded-md border border-[var(--danger)] bg-red-50 p-3">
          <p className="text-sm font-semibold text-[var(--danger)]">
            {outOfService.length === 1
              ? "A unit you inspected is out of service"
              : `${outOfService.length} units you inspected are out of service`}
          </p>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">
            {outOfService.map((row) => row.vehicleLabel).join(", ")}. Do not drive until the office returns it to
            service.
          </p>
        </div>
      ) : null}

      <div className="mt-5">
        <h3 className="text-sm font-semibold text-[var(--ink)]">Your recent inspections</h3>
        {recent.length === 0 ? (
          <p className="mt-2 rounded-md border border-dashed border-[var(--border)] bg-white p-4 text-center text-sm text-[var(--ink-muted)]">
            None yet. Complete your pre-trip form and it will show up here.
          </p>
        ) : (
          <ul className="mt-2 divide-y divide-[var(--border)] rounded-md border border-[var(--border)] bg-white">
            {recent.map((row) => (
              <li className="flex items-center justify-between gap-3 px-3 py-2" key={row.id}>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-[var(--ink)]">{row.vehicleLabel}</p>
                  <p className="text-xs text-[var(--ink-muted)]">
                    {PROVINCE_LABELS[row.province]} · {row.completed_at.slice(0, 10)}
                  </p>
                </div>
                <span
                  className={`shrink-0 rounded-md px-2 py-1 text-xs font-semibold ${OVERALL_RESULT_BADGE[row.overall_result]}`}
                >
                  {OVERALL_RESULT_LABELS[row.overall_result]}
                  {row.outOfService ? " · OOS" : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
