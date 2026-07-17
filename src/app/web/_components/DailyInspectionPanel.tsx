import { ClipboardCheck } from "lucide-react";
import { InspectionChecklist } from "@/app/admin/daily-inspection/_components/InspectionChecklist";
import { submitWorkerInspection } from "@/app/admin/daily-inspection/actions";
import {
  INSPECTION_TYPE_LABELS,
  OVERALL_RESULT_BADGE,
  OVERALL_RESULT_LABELS,
  type OverallResult,
} from "@/lib/daily-inspection";
import { PROVINCE_LABELS, PROVINCES } from "@/lib/dti-rules";

type VehicleOption = {
  id: string;
  label: string;
  category: string;
};

type RecentInspection = {
  id: string;
  vehicleLabel: string;
  province: "BC" | "AB" | "ON";
  overall_result: OverallResult;
  outOfService: boolean;
  completed_at: string;
};

const inputClass =
  "h-11 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2";

// Crew-facing daily trip inspection. The driver is the signed-in worker. A major
// defect on any item takes the vehicle out of service. Server component: the form
// posts straight to the worker server action.
export function DailyInspectionPanel({
  vehicles,
  recent,
}: {
  vehicles: VehicleOption[];
  recent: RecentInspection[];
}) {
  return (
    <section
      className="scroll-mt-24 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm"
      id="trip-inspections"
    >
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-[var(--surface-muted)] text-[var(--primary)]">
          <ClipboardCheck className="h-5 w-5" aria-hidden="true" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-[var(--ink)]">Daily trip inspection</h2>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">
            Inspect your vehicle before the trip. A major defect means the vehicle is out of service: do not drive it,
            and tell your supervisor.
          </p>
        </div>
      </div>

      {vehicles.length === 0 ? (
        <p className="mt-4 rounded-md border border-dashed border-[var(--border)] bg-white p-4 text-center text-sm text-[var(--ink-muted)]">
          No vehicles are assigned to you yet. Ask the office to add one.
        </p>
      ) : (
        <details className="mt-4">
          <summary className="inline-flex h-11 cursor-pointer items-center justify-center gap-2 rounded-md bg-[var(--primary)] px-5 text-sm font-semibold text-white transition hover:opacity-90">
            <ClipboardCheck className="h-4 w-4" aria-hidden="true" />
            Start inspection
          </summary>

          <form action={submitWorkerInspection} className="mt-4 space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1">
                <span className="text-sm font-medium text-[var(--ink)]">Vehicle</span>
                <select className={inputClass} name="equipment_id" required defaultValue="">
                  <option value="" disabled>
                    Select your vehicle
                  </option>
                  {vehicles.map((vehicle) => (
                    <option key={vehicle.id} value={vehicle.id}>
                      {vehicle.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1">
                <span className="text-sm font-medium text-[var(--ink)]">Trailer (optional)</span>
                <select className={inputClass} name="trailer_equipment_id" defaultValue="">
                  <option value="">None</option>
                  {vehicles
                    .filter((vehicle) => vehicle.category === "trailer")
                    .map((vehicle) => (
                      <option key={vehicle.id} value={vehicle.id}>
                        {vehicle.label}
                      </option>
                    ))}
                </select>
              </label>
              <label className="space-y-1">
                <span className="text-sm font-medium text-[var(--ink)]">Province</span>
                <select className={inputClass} name="province" required defaultValue="">
                  <option value="" disabled>
                    Where are you operating?
                  </option>
                  {PROVINCES.map((province) => (
                    <option key={province} value={province}>
                      {PROVINCE_LABELS[province]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1">
                <span className="text-sm font-medium text-[var(--ink)]">Inspection type</span>
                <select className={inputClass} name="inspection_type" defaultValue="pre">
                  <option value="pre">{INSPECTION_TYPE_LABELS.pre}</option>
                  <option value="post">{INSPECTION_TYPE_LABELS.post}</option>
                </select>
              </label>
              <label className="space-y-1">
                <span className="text-sm font-medium text-[var(--ink)]">Odometer / hours</span>
                <input className={inputClass} name="odometer" type="number" step="0.1" min="0" inputMode="decimal" />
              </label>
              <label className="space-y-1">
                <span className="text-sm font-medium text-[var(--ink)]">Location</span>
                <input className={inputClass} name="location" placeholder="Yard, terminal, or city" />
              </label>
            </div>

            <InspectionChecklist />

            <label className="space-y-1 block">
              <span className="text-sm font-medium text-[var(--ink)]">Sign (type your name)</span>
              <input className={inputClass} name="signature_name" placeholder="Your full name" />
            </label>

            <button
              className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-[var(--primary)] px-5 text-sm font-semibold text-white transition hover:opacity-90"
              type="submit"
            >
              Submit inspection
            </button>
          </form>
        </details>
      )}

      <div className="mt-5">
        <h3 className="text-sm font-semibold text-[var(--ink)]">Your recent inspections</h3>
        {recent.length === 0 ? (
          <p className="mt-2 rounded-md border border-dashed border-[var(--border)] bg-white p-4 text-center text-sm text-[var(--ink-muted)]">
            None yet.
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
                <span className={`shrink-0 rounded-md px-2 py-1 text-xs font-semibold ${OVERALL_RESULT_BADGE[row.overall_result]}`}>
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
