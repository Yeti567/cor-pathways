import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PrintHeader } from "@/app/admin/_components/PrintHeader";
import { PrintReportButton } from "@/app/admin/monitor/PrintReportButton";
import { canUseAdminPanel } from "@/lib/access-control";
import {
  CARRY_DOCUMENT_LABELS,
  INSPECTION_TYPE_LABELS,
  ITEM_STATUS_LABELS,
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

type CompanySettingsRow = Database["public"]["Tables"]["company_settings"]["Row"];
type PrintSettingsRow = Database["public"]["Tables"]["print_settings"]["Row"];
type ItemRow = Pick<DtiInspectionItemRow, "id" | "item_no" | "item_label" | "status" | "note">;
type EquipmentRow = Pick<
  Database["public"]["Tables"]["equipment"]["Row"],
  "id" | "unit_number" | "name" | "license_plate" | "vin_or_serial"
>;
type WorkerRow = Pick<Database["public"]["Tables"]["users"]["Row"], "id" | "full_name">;

type PrintPageProps = {
  params: Promise<{ id: string }>;
};

function field(label: string, value: string) {
  return (
    <div className="rounded-md border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2 print:border-gray-300 print:bg-white">
      <p className="text-xs font-semibold uppercase text-[var(--ink-muted)] print:text-gray-600">{label}</p>
      <p className="mt-1 font-semibold text-[var(--ink)] print:text-black">{value || "-"}</p>
    </div>
  );
}

function vehicleLabel(equipment: EquipmentRow | null) {
  if (!equipment) {
    return "-";
  }
  return equipment.name ? `${equipment.unit_number} - ${equipment.name}` : equipment.unit_number;
}

export default async function DailyInspectionPrintPage({ params }: PrintPageProps) {
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

  const [{ data: itemRows }, { data: vehicle }, { data: trailer }, { data: driver }, { data: companySettings }, { data: printSettings }] =
    await Promise.all([
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
      supabase.from("company_settings").select("*").eq("tenant_id", tenantId).maybeSingle<CompanySettingsRow>(),
      supabase.from("print_settings").select("*").eq("tenant_id", tenantId).maybeSingle<PrintSettingsRow>(),
    ]);

  const items = itemRows ?? [];
  const province = inspection.province;
  const rule = getProvinceRule(province);
  const scheduleNo = inspection.schedule_no as ScheduleNo;
  const tenantName = context.tenant?.name ?? "Company profile";
  const carrierName = companySettings?.company_name?.trim() || tenantName;
  const isOutOfService = inspection.out_of_service && !inspection.out_of_service_cleared_at;

  const logoUrl = companySettings?.logo_path
    ? (await supabase.storage.from("tenant-documents").createSignedUrl(companySettings.logo_path, 10 * 60)).data
        ?.signedUrl ?? null
    : null;

  return (
    <main className="mx-auto max-w-4xl px-4 py-5 text-[var(--ink)] print:max-w-none print:px-0 print:py-0 print:text-black">
      <div className="mb-5 flex flex-col gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm print:hidden sm:flex-row sm:items-center sm:justify-between">
        <Link
          className="inline-flex h-10 items-center gap-2 rounded-md border border-[var(--border)] bg-white px-3 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)]"
          href={`/admin/daily-inspection/${inspection.id}`}
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to record
        </Link>
        <PrintReportButton label="Print / Save PDF" />
      </div>

      <article className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm print:border-0 print:p-0 print:shadow-none">
        <PrintHeader
          className="mb-5"
          companySettings={companySettings ?? null}
          logoUrl={logoUrl}
          mode="always"
          printSettings={printSettings ?? null}
          tenantName={tenantName}
        />

        <header className="border-b border-[var(--border)] pb-5 print:border-gray-300">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase text-[var(--ink-muted)] print:text-gray-600">
                Daily trip inspection report
              </p>
              <h1 className="mt-1 text-2xl font-bold text-[var(--ink)] print:text-black">{carrierName}</h1>
              <p className="mt-1 text-sm text-[var(--ink-muted)] print:text-gray-700">
                {PROVINCE_LABELS[province]} · {scheduleCitation(province, scheduleNo)}
              </p>
            </div>
            <div className="rounded-md border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2 text-sm print:border-gray-300 print:bg-white">
              <p className="text-xs font-semibold uppercase text-[var(--ink-muted)] print:text-gray-600">Result</p>
              <p className="mt-1 font-bold text-[var(--ink)] print:text-black">
                {OVERALL_RESULT_LABELS[inspection.overall_result]}
                {isOutOfService ? " - OUT OF SERVICE" : ""}
              </p>
            </div>
          </div>
        </header>

        <section className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {field("Vehicle / unit", vehicleLabel(vehicle ?? null))}
          {field("Licence plate", vehicle?.license_plate ?? "")}
          {field("Trailer", trailer ? vehicleLabel(trailer) : "")}
          {field("Odometer / hubometer", inspection.odometer != null ? String(inspection.odometer) : "")}
          {field("Inspection type", INSPECTION_TYPE_LABELS[inspection.inspection_type])}
          {field("Location inspected", inspection.location ?? "")}
          {field("Date / time", inspection.completed_at.slice(0, 16).replace("T", " "))}
          {field("Valid until", inspection.valid_until.slice(0, 16).replace("T", " "))}
        </section>

        <section className="mt-5">
          <h2 className="text-sm font-semibold uppercase text-[var(--ink-muted)] print:text-gray-600">
            Inspection items (Schedule {scheduleNo})
          </h2>
          <table className="mt-2 w-full border border-[var(--border)] text-left text-sm print:border-gray-300">
            <thead className="border-b border-[var(--border)] print:border-gray-300">
              <tr>
                <th className="px-3 py-1.5 font-semibold">#</th>
                <th className="px-3 py-1.5 font-semibold">Item</th>
                <th className="px-3 py-1.5 font-semibold">Result</th>
                <th className="px-3 py-1.5 font-semibold">Note</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr className="border-b border-[var(--border)] print:border-gray-200" key={item.id}>
                  <td className="px-3 py-1.5">{item.item_no}</td>
                  <td className="px-3 py-1.5">{item.item_label}</td>
                  <td className={`px-3 py-1.5 font-semibold ${item.status === "major" ? "print:text-black" : ""}`}>
                    {ITEM_STATUS_LABELS[item.status]}
                  </td>
                  <td className="px-3 py-1.5">{item.note || ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="mt-5 grid gap-4 sm:grid-cols-2">
          <div className="rounded-md border border-[var(--border)] p-3 print:border-gray-300">
            <p className="text-xs font-semibold uppercase text-[var(--ink-muted)] print:text-gray-600">
              Driver / person inspecting (signature)
            </p>
            <p className="mt-6 border-t border-[var(--border)] pt-1 text-sm print:border-gray-400">
              {inspection.signature_name || driver?.full_name || ""}
              {` · ${inspection.completed_at.slice(0, 10)}`}
            </p>
          </div>
          <div className="rounded-md border border-[var(--border)] p-3 text-sm print:border-gray-300">
            <p className="text-xs font-semibold uppercase text-[var(--ink-muted)] print:text-gray-600">Compliance</p>
            <p className="mt-1 text-[var(--ink)] print:text-black">
              Carry in cab: {carryDocuments(province).map((doc) => CARRY_DOCUMENT_LABELS[doc]).join(" and ")}.
            </p>
            <p className="mt-1 text-[var(--ink-muted)] print:text-gray-700">{retentionSentence(retentionPolicy(province))}</p>
            <p className="mt-1 text-[var(--ink-muted)] print:text-gray-700">
              A major defect requires the vehicle to be taken out of service. Credential at risk:{" "}
              {CREDENTIAL_LABELS[credentialAtRisk(province)]}.
            </p>
          </div>
        </section>

        {inspection.notes ? (
          <section className="mt-5">
            <h2 className="text-sm font-semibold uppercase text-[var(--ink-muted)] print:text-gray-600">Notes</h2>
            <p className="mt-1 whitespace-pre-wrap text-sm text-[var(--ink)] print:text-black">{inspection.notes}</p>
          </section>
        ) : null}

        {!rule.thresholdVerified ? (
          <p className="mt-5 text-xs text-[var(--ink-muted)] print:text-gray-600">
            This report is a record-keeping aid. {PROVINCE_LABELS[province]}&apos;s weight threshold is pending
            verification against the current regulation; confirm applicability before relying on it.
          </p>
        ) : null}
      </article>
    </main>
  );
}
