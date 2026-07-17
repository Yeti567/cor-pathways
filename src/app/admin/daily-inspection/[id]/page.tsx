import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AlertTriangle, ArrowLeft, Printer } from "lucide-react";
import { clearOutOfService } from "@/app/admin/daily-inspection/actions";
import { AdminShell } from "@/app/admin/_components/AdminShell";
import { canUseAdminPanel } from "@/lib/access-control";
import {
  CARRY_DOCUMENT_LABELS,
  currentTimeMs,
  INSPECTION_TYPE_LABELS,
  ITEM_STATUS_BADGE,
  ITEM_STATUS_LABELS,
  OVERALL_RESULT_BADGE,
  OVERALL_RESULT_LABELS,
  retentionSentence,
  type DtiInspectionItemRow,
  type DtiInspectionRow,
} from "@/lib/daily-inspection";
import {
  carryDocuments,
  CREDENTIAL_LABELS,
  credentialAtRisk,
  getProvinceRule,
  PROVINCE_LABELS,
  retentionPolicy,
  scheduleCitation,
  type ScheduleNo,
} from "@/lib/dti-rules";
import { requireAppUser } from "@/lib/current-user";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

export const dynamic = "force-dynamic";

type ItemRow = Pick<DtiInspectionItemRow, "id" | "item_no" | "item_label" | "status" | "note">;
type EquipmentRow = Pick<
  Database["public"]["Tables"]["equipment"]["Row"],
  "id" | "unit_number" | "name" | "license_plate" | "vin_or_serial"
>;
type WorkerRow = Pick<Database["public"]["Tables"]["users"]["Row"], "id" | "full_name">;

type DetailPageProps = {
  params: Promise<{ id: string }>;
};

function infoCell(label: string, value: string) {
  return (
    <div className="rounded-md border border-[var(--border)] bg-white p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">{label}</p>
      <p className="mt-1 font-semibold text-[var(--ink)]">{value}</p>
    </div>
  );
}

function vehicleLabel(equipment: EquipmentRow | null) {
  if (!equipment) {
    return "Vehicle";
  }
  return equipment.name ? `${equipment.unit_number} - ${equipment.name}` : equipment.unit_number;
}

export default async function DailyInspectionDetailPage({ params }: DetailPageProps) {
  await requireAppUser();
  const context = await requireAppUser();

  if (!canUseAdminPanel(context.appUser)) {
    redirect("/choose");
  }

  if (!context.tenant?.daily_inspection_enabled) {
    redirect("/admin/setup");
  }

  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const tenantId = context.appUser.tenant_id;

  const { data: inspection } = await supabase
    .from("dti_inspection")
    .select("*")
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .maybeSingle<DtiInspectionRow>();

  if (!inspection) {
    notFound();
  }

  const [{ data: itemRows }, { data: vehicle }, { data: trailer }, { data: driver }] = await Promise.all([
    supabase
      .from("dti_inspection_item")
      .select("id, item_no, item_label, status, note")
      .eq("inspection_id", inspection.id)
      .eq("tenant_id", tenantId)
      .order("item_no", { ascending: true })
      .returns<ItemRow[]>(),
    supabase
      .from("equipment")
      .select("id, unit_number, name, license_plate, vin_or_serial")
      .eq("id", inspection.equipment_id)
      .eq("tenant_id", tenantId)
      .maybeSingle<EquipmentRow>(),
    inspection.trailer_equipment_id
      ? supabase
          .from("equipment")
          .select("id, unit_number, name, license_plate, vin_or_serial")
          .eq("id", inspection.trailer_equipment_id)
          .eq("tenant_id", tenantId)
          .maybeSingle<EquipmentRow>()
      : Promise.resolve({ data: null as EquipmentRow | null }),
    inspection.driver_user_id
      ? supabase
          .from("users")
          .select("id, full_name")
          .eq("id", inspection.driver_user_id)
          .eq("tenant_id", tenantId)
          .maybeSingle<WorkerRow>()
      : Promise.resolve({ data: null as WorkerRow | null }),
  ]);

  const items = itemRows ?? [];
  const province = inspection.province;
  const rule = getProvinceRule(province);
  const scheduleNo = inspection.schedule_no as ScheduleNo;
  const validNow = new Date(inspection.valid_until).getTime() > currentTimeMs();
  const isOutOfService = inspection.out_of_service && !inspection.out_of_service_cleared_at;
  const defects = items.filter((item) => item.status !== "pass");

  return (
    <AdminShell
      eyebrow="Compliance"
      tenantName={context.tenant?.name ?? "Company profile"}
      title="Inspection record"
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Link
          className="inline-flex h-10 items-center gap-2 rounded-md border border-[var(--border)] bg-white px-3 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)]"
          href="/admin/daily-inspection"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to inspections
        </Link>
        <Link
          className="inline-flex h-10 items-center gap-2 rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-white transition hover:opacity-90"
          href={`/admin/daily-inspection/${inspection.id}/print`}
        >
          <Printer className="h-4 w-4" aria-hidden="true" />
          Print / Save PDF
        </Link>
      </div>

      {isOutOfService ? (
        <section className="mb-5 rounded-lg border border-[var(--danger)] bg-red-50/40 p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 shrink-0 text-[var(--danger)]" aria-hidden="true" />
              <p className="text-sm font-semibold text-[var(--ink)]">
                Out of service. A major defect was recorded; this vehicle must not be driven until repaired.
              </p>
            </div>
            <form action={clearOutOfService}>
              <input name="inspection_id" type="hidden" value={inspection.id} />
              <button
                className="inline-flex h-9 items-center justify-center rounded-md border border-[var(--border)] bg-white px-3 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)]"
                type="submit"
              >
                Return to service
              </button>
            </form>
          </div>
        </section>
      ) : null}

      <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-[var(--ink)]">{vehicleLabel(vehicle ?? null)}</h2>
            <p className="mt-1 text-sm text-[var(--ink-muted)]">
              {PROVINCE_LABELS[province]} · {INSPECTION_TYPE_LABELS[inspection.inspection_type]} · Schedule {scheduleNo}
            </p>
          </div>
          <span className={`rounded-md px-3 py-1 text-sm font-semibold ${OVERALL_RESULT_BADGE[inspection.overall_result]}`}>
            {OVERALL_RESULT_LABELS[inspection.overall_result]}
          </span>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {infoCell("Completed", inspection.completed_at.slice(0, 16).replace("T", " "))}
          {infoCell("Valid until", `${inspection.valid_until.slice(0, 16).replace("T", " ")} (${validNow ? "valid" : "expired"})`)}
          {infoCell("Driver", driver?.full_name ?? "-")}
          {infoCell("Odometer / hours", inspection.odometer != null ? String(inspection.odometer) : "-")}
          {infoCell("Location", inspection.location || "-")}
          {infoCell("Trailer", trailer ? vehicleLabel(trailer) : "-")}
          {infoCell("Credential at risk", CREDENTIAL_LABELS[credentialAtRisk(province)])}
          {infoCell("Citation", scheduleCitation(province, scheduleNo))}
        </div>

        <div className="mt-3 rounded-md border border-[var(--border)] bg-white p-3 text-sm text-[var(--ink-muted)]">
          <p>
            <span className="font-semibold text-[var(--ink)]">Carry in cab:</span>{" "}
            {carryDocuments(province).map((doc) => CARRY_DOCUMENT_LABELS[doc]).join(" and ")}.
          </p>
          <p className="mt-1">{retentionSentence(retentionPolicy(province))}</p>
          {!rule.thresholdVerified ? (
            <p className="mt-1 text-[var(--warning)]">
              Note: this province&apos;s weight threshold is pending verification against the current regulation.
            </p>
          ) : null}
        </div>
      </section>

      <section className="mt-5 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-[var(--ink)]">
          Checklist results
          {defects.length > 0 ? (
            <span className="ml-2 rounded-md bg-amber-50 px-2 py-0.5 text-xs font-semibold text-[var(--warning)]">
              {defects.length} defect{defects.length === 1 ? "" : "s"}
            </span>
          ) : null}
        </h2>

        {items.length === 0 ? (
          <p className="mt-4 text-sm text-[var(--ink-muted)]">No item results recorded.</p>
        ) : (
          <div className="mt-4 overflow-x-auto rounded-md border border-[var(--border)] bg-white">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead className="border-b border-[var(--border)] text-xs uppercase tracking-wide text-[var(--ink-muted)]">
                <tr>
                  <th className="px-3 py-2 font-semibold">#</th>
                  <th className="px-3 py-2 font-semibold">Item</th>
                  <th className="px-3 py-2 font-semibold">Result</th>
                  <th className="px-3 py-2 font-semibold">Note</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {items.map((item) => (
                  <tr className={item.status !== "pass" ? "bg-amber-50/30" : ""} key={item.id}>
                    <td className="px-3 py-2 text-[var(--ink-muted)]">{item.item_no}</td>
                    <td className="px-3 py-2 font-medium text-[var(--ink)]">{item.item_label}</td>
                    <td className="px-3 py-2">
                      <span className={`rounded-md px-2 py-1 text-xs font-semibold ${ITEM_STATUS_BADGE[item.status]}`}>
                        {ITEM_STATUS_LABELS[item.status]}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-[var(--ink-muted)]">{item.note || ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {inspection.signature_name ? (
          <p className="mt-4 text-sm text-[var(--ink-muted)]">
            <span className="font-semibold text-[var(--ink)]">Signed:</span> {inspection.signature_name}
          </p>
        ) : null}
        {inspection.notes ? (
          <p className="mt-1 text-sm text-[var(--ink-muted)]">
            <span className="font-semibold text-[var(--ink)]">Notes:</span> {inspection.notes}
          </p>
        ) : null}
      </section>
    </AdminShell>
  );
}
