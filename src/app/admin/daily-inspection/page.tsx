import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertTriangle, ClipboardCheck, ClipboardList, MapPin, RefreshCw, ScanLine, ShieldCheck } from "lucide-react";
import { buildPreTripForm, clearOutOfService } from "@/app/admin/daily-inspection/actions";
import { AdminShell } from "@/app/admin/_components/AdminShell";
import { canUseAdminPanel } from "@/lib/access-control";
import {
  buildFleetInspectionStatus,
  currentTimeMs,
  FLEET_STATUS_BADGE,
  FLEET_STATUS_LABELS,
  INSPECTABLE_EQUIPMENT_CATEGORIES,
  INSPECTION_TYPE_LABELS,
  OVERALL_RESULT_BADGE,
  OVERALL_RESULT_LABELS,
  type DtiInspectionRow,
  type FleetVehicleStatus,
} from "@/lib/daily-inspection";
import { PROVINCE_LABELS, PROVINCES } from "@/lib/dti-rules";
import { getPreTripFormSummary, reconcilePreTripSubmissions } from "@/lib/pre-trip-sync";
import { requireAppUser } from "@/lib/current-user";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

export const dynamic = "force-dynamic";

type EquipmentRow = Pick<
  Database["public"]["Tables"]["equipment"]["Row"],
  "id" | "unit_number" | "name" | "category" | "current_meter" | "status"
>;
type WorkerRow = Pick<Database["public"]["Tables"]["users"]["Row"], "id" | "full_name">;
type InspectionRow = Pick<
  DtiInspectionRow,
  | "id"
  | "equipment_id"
  | "province"
  | "inspection_type"
  | "overall_result"
  | "out_of_service"
  | "out_of_service_cleared_at"
  | "completed_at"
  | "valid_until"
  | "driver_user_id"
>;

type DailyInspectionPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function vehicleLabel(equipment: EquipmentRow | undefined) {
  if (!equipment) {
    return "Vehicle";
  }
  return equipment.name ? `${equipment.unit_number} - ${equipment.name}` : equipment.unit_number;
}

export default async function DailyInspectionPage({ searchParams }: DailyInspectionPageProps) {
  await requireAppUser();
  const context = await requireAppUser();

  if (!canUseAdminPanel(context.appUser)) {
    redirect("/choose");
  }

  if (!context.tenant?.daily_inspection_enabled) {
    redirect("/admin/setup");
  }

  const params = await searchParams;
  const notice = firstParam(params.notice);
  const error = firstParam(params.error);

  const supabase = await createSupabaseServerClient();
  const tenantId = context.appUser.tenant_id;

  // Capture lives in the Forms module, so pull any completed pre-trip submissions
  // into inspections before reading the board. Idempotent and cheap once caught
  // up: it only reads submissions that have no inspection yet.
  await reconcilePreTripSubmissions(supabase, { tenantId });
  const preTripForm = await getPreTripFormSummary(supabase, tenantId);

  const [{ data: equipmentRows }, { data: inspectionRows }, { data: workerRows }] = await Promise.all([
    supabase
      .from("equipment")
      .select("id, unit_number, name, category, current_meter, status")
      .eq("tenant_id", tenantId)
      .is("deleted_at", null)
      .neq("status", "retired")
      .neq("status", "sold")
      .in("category", [...INSPECTABLE_EQUIPMENT_CATEGORIES])
      .order("unit_number", { ascending: true })
      .returns<EquipmentRow[]>(),
    supabase
      .from("dti_inspection")
      .select(
        "id, equipment_id, province, inspection_type, overall_result, out_of_service, out_of_service_cleared_at, completed_at, valid_until, driver_user_id",
      )
      .eq("tenant_id", tenantId)
      .order("completed_at", { ascending: false })
      .limit(50)
      .returns<InspectionRow[]>(),
    supabase
      .from("users")
      .select("id, full_name")
      .eq("tenant_id", tenantId)
      .eq("active", true)
      .order("full_name", { ascending: true })
      .returns<WorkerRow[]>(),
  ]);

  const vehicles = equipmentRows ?? [];
  const inspections = inspectionRows ?? [];
  const workers = workerRows ?? [];
  const equipmentById = new Map(vehicles.map((vehicle) => [vehicle.id, vehicle]));
  const workersById = new Map(workers.map((worker) => [worker.id, worker]));
  const nowMs = currentTimeMs();

  const outOfService = inspections.filter((row) => row.out_of_service && !row.out_of_service_cleared_at);

  const fleetStatus = buildFleetInspectionStatus(
    vehicles.map((vehicle) => vehicle.id),
    inspections,
    nowMs,
  );
  // Surface the most urgent first: out of service, then due, then valid.
  const STATUS_ORDER: Record<FleetVehicleStatus["status"], number> = { out_of_service: 0, due: 1, valid: 2 };
  const fleetSorted = [...fleetStatus].sort(
    (a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.equipmentId.localeCompare(b.equipmentId),
  );
  const validCount = fleetStatus.filter((row) => row.status === "valid").length;
  const dueCount = fleetStatus.filter((row) => row.status === "due").length;
  const oosCount = fleetStatus.filter((row) => row.status === "out_of_service").length;

  const kpis = [
    { label: "Valid now", value: String(validCount), detail: `${vehicles.length} in fleet` },
    { label: "Due", value: String(dueCount), detail: "No valid inspection" },
    { label: "Out of service", value: String(oosCount), detail: "Major defect, not cleared" },
  ];

  return (
    <AdminShell
      eyebrow="Compliance"
      tenantName={context.tenant?.name ?? "Company profile"}
      title="Daily Trip Inspections"
    >
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

      <div className="grid gap-4 sm:grid-cols-3">
        {kpis.map((kpi) => (
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm" key={kpi.label}>
            <p className="text-sm text-[var(--ink-muted)]">{kpi.label}</p>
            <p className="mt-2 text-2xl font-bold text-[var(--ink)]">{kpi.value}</p>
            <p className="mt-1 text-xs text-[var(--ink-muted)]">{kpi.detail}</p>
          </div>
        ))}
      </div>

      {outOfService.length > 0 ? (
        <section className="mt-5 rounded-lg border border-[var(--danger)] bg-red-50/40 p-5 shadow-sm">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-white text-[var(--danger)]">
              <AlertTriangle className="h-5 w-5" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h2 className="text-lg font-semibold text-[var(--ink)]">Out of service</h2>
              <p className="mt-1 text-sm text-[var(--ink-muted)]">
                A major defect was recorded. These vehicles must not be driven until repaired and returned to service.
              </p>
              <div className="mt-3 grid gap-2">
                {outOfService.map((row) => (
                  <div
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-[var(--border)] bg-white p-3"
                    key={row.id}
                  >
                    <span className="text-sm font-semibold text-[var(--ink)]">
                      {vehicleLabel(equipmentById.get(row.equipment_id))}
                      <span className="ml-2 text-xs font-medium text-[var(--ink-muted)]">
                        {PROVINCE_LABELS[row.province]} · {row.completed_at.slice(0, 10)}
                      </span>
                    </span>
                    <form action={clearOutOfService}>
                      <input name="inspection_id" type="hidden" value={row.id} />
                      <button
                        className="inline-flex h-9 items-center justify-center rounded-md border border-[var(--border)] bg-white px-3 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)]"
                        type="submit"
                      >
                        Return to service
                      </button>
                    </form>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {vehicles.length > 0 ? (
        <section className="mt-5 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-[var(--ink)]">Fleet status</h2>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">
            Each vehicle&apos;s current daily inspection standing. Due means no valid inspection in the last 24 hours.
          </p>
          <div className="mt-4 overflow-x-auto rounded-md border border-[var(--border)] bg-white">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="border-b border-[var(--border)] text-xs uppercase tracking-wide text-[var(--ink-muted)]">
                <tr>
                  <th className="px-3 py-2 font-semibold">Vehicle</th>
                  <th className="px-3 py-2 font-semibold">Status</th>
                  <th className="px-3 py-2 font-semibold">Last inspected</th>
                  <th className="px-3 py-2 font-semibold">Valid until</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {fleetSorted.map((row) => (
                  <tr
                    className={
                      row.status === "out_of_service"
                        ? "bg-red-50/30"
                        : row.status === "due"
                          ? "bg-amber-50/20"
                          : ""
                    }
                    key={row.equipmentId}
                  >
                    <td className="px-3 py-2 font-medium text-[var(--ink)]">
                      {row.inspectionId ? (
                        <Link className="hover:underline" href={`/admin/daily-inspection/${row.inspectionId}`}>
                          {vehicleLabel(equipmentById.get(row.equipmentId))}
                        </Link>
                      ) : (
                        vehicleLabel(equipmentById.get(row.equipmentId))
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <span className={`rounded-md px-2 py-1 text-xs font-semibold ${FLEET_STATUS_BADGE[row.status]}`}>
                        {FLEET_STATUS_LABELS[row.status]}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-[var(--ink-muted)]">
                      {row.lastInspectedAt ? row.lastInspectedAt.slice(0, 16).replace("T", " ") : "Never"}
                    </td>
                    <td className="px-3 py-2 text-[var(--ink-muted)]">
                      {row.validUntil ? row.validUntil.slice(0, 16).replace("T", " ") : "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <section className="mt-5 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-[var(--surface-muted)] text-[var(--primary)]">
            <ClipboardCheck className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-[var(--ink)]">The pre-trip is a form</h2>
            <p className="mt-1 text-sm text-[var(--ink-muted)]">
              Drivers fill it in the worker app like every other form, so it syncs offline, carries photos and
              signatures, and raises corrective actions the normal way. This module reads those submissions back:
              each completed pre-trip becomes an inspection on the board above, and a major defect takes the unit out
              of service.
            </p>
          </div>
        </div>

        <div className="mt-4 grid gap-3 rounded-md border border-[var(--border)] bg-white p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-[var(--ink)]">{preTripForm.name}</p>
              <p className="mt-1 text-sm text-[var(--ink-muted)]">
                {preTripForm.formId
                  ? `${preTripForm.itemCount} inspection items, ${preTripForm.documentedItemCount} of the ${preTripForm.scheduleItemCount} NSC Schedule 1 items carrying their checks and defect definitions.`
                  : "Not built yet. Build it to get the NSC Schedule 1 items, each with the checks to perform and the regulation's minor and major defect definitions."}
              </p>
            </div>
            {preTripForm.status ? (
              <span className="rounded-full border border-[var(--border)] bg-[var(--surface-muted)] px-2.5 py-1 text-xs font-semibold text-[var(--ink-muted)]">
                {preTripForm.status}
              </span>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <form action={buildPreTripForm}>
              <button
                className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-white transition hover:opacity-90"
                type="submit"
              >
                <RefreshCw className="h-4 w-4" aria-hidden="true" />
                {preTripForm.formId ? "Refresh from NSC Schedule 1" : "Build the pre-trip form"}
              </button>
            </form>
            {preTripForm.formId ? (
              <Link
                className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-[var(--border)] bg-white px-3 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)]"
                href={`/admin/forms/${preTripForm.formId}`}
              >
                <ClipboardList className="h-4 w-4 text-[var(--primary)]" aria-hidden="true" />
                Open in Forms
              </Link>
            ) : null}
            <Link
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-[var(--border)] bg-white px-3 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)]"
              href="/admin/forms"
            >
              <ScanLine className="h-4 w-4 text-[var(--primary)]" aria-hidden="true" />
              Scan your own pre-trip
            </Link>
          </div>

          <p className="text-xs text-[var(--ink-muted)]">
            Refreshing updates the wording on items this module owns and adds any that are missing. Items you added
            yourself are left alone, and nothing is deleted, so past submissions keep their history. If your company
            already runs its own paper pre-trip, scan it instead and let OCR build the form from your own sheet.
          </p>
        </div>

        {vehicles.length === 0 ? (
          <p className="mt-4 rounded-md border border-dashed border-[var(--border)] bg-white p-6 text-center text-sm text-[var(--ink-muted)]">
            Add a vehicle or trailer in{" "}
            <Link className="font-semibold text-[var(--primary)] hover:underline" href="/admin/equipment">
              Equipment
            </Link>{" "}
            so drivers have a unit to inspect.
          </p>
        ) : null}
      </section>

      <section className="mt-5 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-[var(--ink)]">Recent inspections</h2>
        {inspections.length === 0 ? (
          <p className="mt-4 flex flex-col items-center gap-2 rounded-md border border-dashed border-[var(--border)] bg-white p-6 text-center text-sm text-[var(--ink-muted)]">
            <ClipboardCheck className="h-6 w-6 text-[var(--ink-muted)]" aria-hidden="true" />
            No inspections logged yet.
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto rounded-md border border-[var(--border)] bg-white">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="border-b border-[var(--border)] text-xs uppercase tracking-wide text-[var(--ink-muted)]">
                <tr>
                  <th className="px-3 py-2 font-semibold">Vehicle</th>
                  <th className="px-3 py-2 font-semibold">Province</th>
                  <th className="px-3 py-2 font-semibold">Type</th>
                  <th className="px-3 py-2 font-semibold">Driver</th>
                  <th className="px-3 py-2 font-semibold">Result</th>
                  <th className="px-3 py-2 font-semibold">When</th>
                  <th className="px-3 py-2 font-semibold">Valid</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {inspections.map((row) => {
                  const stillValid = new Date(row.valid_until).getTime() > nowMs;

                  return (
                    <tr className="transition hover:bg-[var(--surface-muted)]" key={row.id}>
                      <td className="px-3 py-2 font-medium text-[var(--ink)]">
                        <Link className="hover:underline" href={`/admin/daily-inspection/${row.id}`}>
                          {vehicleLabel(equipmentById.get(row.equipment_id))}
                        </Link>
                      </td>
                      <td className="px-3 py-2 text-[var(--ink-muted)]">{PROVINCE_LABELS[row.province]}</td>
                      <td className="px-3 py-2 text-[var(--ink-muted)]">{INSPECTION_TYPE_LABELS[row.inspection_type]}</td>
                      <td className="px-3 py-2 text-[var(--ink-muted)]">
                        {row.driver_user_id ? workersById.get(row.driver_user_id)?.full_name ?? "-" : "-"}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`rounded-md px-2 py-1 text-xs font-semibold ${OVERALL_RESULT_BADGE[row.overall_result]}`}
                        >
                          {OVERALL_RESULT_LABELS[row.overall_result]}
                          {row.out_of_service && !row.out_of_service_cleared_at ? " · OOS" : ""}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-[var(--ink-muted)]">{row.completed_at.slice(0, 16).replace("T", " ")}</td>
                      <td className="px-3 py-2">
                        <span
                          className={`rounded-md px-2 py-1 text-xs font-semibold ${
                            stillValid ? "bg-emerald-50 text-[var(--success)]" : "bg-[var(--surface-muted)] text-[var(--ink-muted)]"
                          }`}
                        >
                          {stillValid ? "Valid" : "Expired"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="mt-5 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
        <div className="flex items-center gap-2">
          <MapPin className="h-5 w-5 text-[var(--primary)]" aria-hidden="true" />
          <h2 className="text-lg font-semibold text-[var(--ink)]">Provinces covered</h2>
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          {PROVINCES.map((province) => (
            <div className="rounded-lg border border-[var(--border)] bg-white p-4" key={province}>
              <h3 className="text-base font-semibold text-[var(--ink)]">{PROVINCE_LABELS[province]}</h3>
              <p className="mt-1 text-sm text-[var(--ink-muted)]">
                NSC Standard 13 daily trip inspection. The province sets the weight threshold, schedule, validity, and the
                credential at risk.
              </p>
            </div>
          ))}
        </div>
        <div className="mt-4 flex items-start gap-3 rounded-md border border-[var(--border)] bg-white p-4">
          <ShieldCheck className="h-5 w-5 shrink-0 text-[var(--primary)]" aria-hidden="true" />
          <p className="text-sm text-[var(--ink-muted)]">
            A record-keeping and workflow tool. It does not replace the regulation text or a peace officer&apos;s
            authority. Confirm the seeded thresholds and schedules against current provincial regulation before relying
            on them.
          </p>
        </div>
      </section>
    </AdminShell>
  );
}
