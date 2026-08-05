import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertTriangle, ArrowLeft, BadgeCheck, FileText, Truck } from "lucide-react";
import { AdminShell } from "@/app/admin/_components/AdminShell";
import { canUseAdminPanel } from "@/lib/access-control";
import { requireAppUser } from "@/lib/current-user";
import {
  buildVehicleFileStatuses,
  formatEquipmentCategory,
  vehicleFileGaps,
  vehicleFileStateClass,
  VEHICLE_FILE_STATE_LABELS,
  type VehicleFileRegistryKey,
  type VehicleFileStatus,
} from "@/lib/equipment";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

export const dynamic = "force-dynamic";

const FLEET_CATEGORIES = ["vehicle", "trailer"] as const;

type EquipmentRow = Pick<
  Database["public"]["Tables"]["equipment"]["Row"],
  "id" | "unit_number" | "name" | "category" | "status" | "is_commercial" | "license_plate" | "vin_or_serial"
>;
type DocumentRow = Pick<
  Database["public"]["Tables"]["equipment_document"]["Row"],
  "equipment_id" | "doc_type" | "expiry_date" | "is_active" | "reminder_lead_days" | "title"
>;

type VehicleFilesPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

// The two registries this page serves. Card 6 and card 7 on the Transport home
// link here with ?file= set, so each lands on just its own file.
const FILE_VIEWS: {
  value: "all" | VehicleFileRegistryKey;
  label: string;
  heading: string;
  blurb: string;
}[] = [
  {
    value: "all",
    label: "All vehicle files",
    heading: "Vehicle files",
    blurb: "Registration, insurance, permits, and CVIP for every road unit in the fleet.",
  },
  {
    value: "vehicle_registration",
    label: "Registration & insurance",
    heading: "Vehicle registration & insurance",
    blurb:
      "The registration certificate and proof of insurance carried in the cab, plus any operating permits the work needs.",
  },
  {
    value: "vehicle_cvip",
    label: "CVIP certificates",
    heading: "CVIP inspection certificates",
    blurb:
      "The annual Commercial Vehicle Inspection Program certificate and decal for each unit. A unit with no valid CVIP may not be operated.",
  },
];

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function coerceView(value: string | undefined) {
  return FILE_VIEWS.find((view) => view.value === value) ?? FILE_VIEWS[0];
}

function unitLabel(unit: EquipmentRow) {
  return unit.name ? `${unit.unit_number} - ${unit.name}` : unit.unit_number;
}

function expiryDetail(status: VehicleFileStatus) {
  if (status.state === "missing") {
    return "Nothing on file";
  }
  if (!status.expiryDate) {
    return "No expiry recorded";
  }
  if (status.daysUntilExpiry === null) {
    return status.expiryDate.slice(0, 10);
  }
  if (status.daysUntilExpiry < 0) {
    return `Expired ${Math.abs(status.daysUntilExpiry)} days ago`;
  }
  return `${status.expiryDate.slice(0, 10)} (${status.daysUntilExpiry} days)`;
}

export default async function VehicleFilesPage({ searchParams }: VehicleFilesPageProps) {
  const context = await requireAppUser();

  if (!canUseAdminPanel(context.appUser)) {
    redirect("/choose");
  }

  if (!context.tenant?.transport_enabled) {
    redirect("/admin/setup");
  }

  const params = await searchParams;
  const view = coerceView(firstParam(params.file));

  const supabase = await createSupabaseServerClient();
  const tenantId = context.appUser.tenant_id;
  const [{ data: equipmentRows }, { data: documentRows }] = await Promise.all([
    supabase
      .from("equipment")
      .select("id, unit_number, name, category, status, is_commercial, license_plate, vin_or_serial")
      .eq("tenant_id", tenantId)
      .in("category", [...FLEET_CATEGORIES])
      .is("deleted_at", null)
      .neq("status", "retired")
      .neq("status", "sold")
      .order("unit_number", { ascending: true })
      .returns<EquipmentRow[]>(),
    supabase
      .from("equipment_document")
      .select("equipment_id, doc_type, expiry_date, is_active, reminder_lead_days, title")
      .eq("tenant_id", tenantId)
      .is("deleted_at", null)
      .returns<DocumentRow[]>(),
  ]);

  const documentsByEquipment = new Map<string, DocumentRow[]>();
  for (const document of documentRows ?? []) {
    documentsByEquipment.set(document.equipment_id, [
      ...(documentsByEquipment.get(document.equipment_id) ?? []),
      document,
    ]);
  }

  // Only NSC-regulated units carry these files. A shop trailer that is not a
  // commercial unit would otherwise show up as permanently deficient.
  const units = (equipmentRows ?? []).filter((unit) => unit.is_commercial);

  const rows = units.map((unit) => {
    const statuses = buildVehicleFileStatuses({
      category: unit.category,
      documents: (documentsByEquipment.get(unit.id) ?? []).map((document) => ({
        docType: document.doc_type,
        expiryDate: document.expiry_date,
        isActive: document.is_active,
        reminderLeadDays: document.reminder_lead_days,
      })),
    });

    const visible = view.value === "all" ? statuses : statuses.filter((status) => status.registryKey === view.value);

    return { unit, statuses: visible, gaps: vehicleFileGaps(visible) };
  });

  const unitsWithGaps = rows.filter((row) => row.gaps.length > 0).length;
  const totalGaps = rows.reduce((total, row) => total + row.gaps.length, 0);
  const expiringSoon = rows.reduce(
    (total, row) => total + row.statuses.filter((status) => status.state === "due_soon").length,
    0,
  );

  return (
    <AdminShell eyebrow="Transport" tenantName={context.tenant?.name ?? "Company profile"} title={view.heading}>
      <Link
        className="inline-flex items-center gap-1 text-sm font-semibold text-[var(--primary)] hover:underline"
        href="/admin/transport"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Transport
      </Link>

      <p className="mt-4 text-sm text-[var(--ink-muted)]">
        {view.blurb} Files are the unit&apos;s own documents, so they are added and renewed on the unit in{" "}
        <Link className="font-semibold text-[var(--primary)] hover:underline" href="/admin/equipment">
          Equipment
        </Link>
        .
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        {FILE_VIEWS.map((option) => (
          <Link
            className={`inline-flex h-9 items-center rounded-md border px-3 text-sm font-semibold transition ${
              option.value === view.value
                ? "border-[var(--primary)] bg-[var(--primary)] text-white"
                : "border-[var(--border)] bg-white text-[var(--ink)] hover:bg-[var(--surface-muted)]"
            }`}
            href={option.value === "all" ? "/admin/transport/vehicle-files" : `/admin/transport/vehicle-files?file=${option.value}`}
            key={option.value}
          >
            {option.label}
          </Link>
        ))}
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-3">
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
          <p className="text-sm text-[var(--ink-muted)]">Units with a gap</p>
          <p className={`mt-2 text-2xl font-bold ${unitsWithGaps > 0 ? "text-[var(--danger)]" : "text-[var(--ink)]"}`}>
            {unitsWithGaps} / {rows.length}
          </p>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
          <p className="text-sm text-[var(--ink-muted)]">Missing or expired files</p>
          <p className={`mt-2 text-2xl font-bold ${totalGaps > 0 ? "text-[var(--danger)]" : "text-[var(--ink)]"}`}>
            {totalGaps}
          </p>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
          <p className="text-sm text-[var(--ink-muted)]">Renewing soon</p>
          <p className={`mt-2 text-2xl font-bold ${expiringSoon > 0 ? "text-[var(--warning)]" : "text-[var(--ink)]"}`}>
            {expiringSoon}
          </p>
        </div>
      </div>

      {rows.length === 0 ? (
        <section className="mt-5 rounded-lg border border-dashed border-[var(--border)] bg-[var(--surface)] p-10 text-center shadow-sm">
          <Truck className="mx-auto h-8 w-8 text-[var(--primary)]" aria-hidden="true" />
          <h2 className="mt-3 text-lg font-semibold text-[var(--ink)]">No commercial units yet</h2>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">
            Add a vehicle or trailer in{" "}
            <Link className="font-semibold text-[var(--primary)] hover:underline" href="/admin/equipment">
              Equipment
            </Link>{" "}
            and tick <span className="font-semibold">Commercial vehicle</span>. Only NSC-regulated units carry these
            files.
          </p>
        </section>
      ) : (
        <div className="mt-5 grid gap-4">
          {rows.map((row) => (
            <section
              className={`rounded-lg border bg-[var(--surface)] p-4 shadow-sm ${
                row.gaps.length > 0 ? "border-[var(--danger)]" : "border-[var(--border)]"
              }`}
              key={row.unit.id}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="inline-flex items-center gap-2 text-base font-semibold text-[var(--ink)]">
                    {row.gaps.length > 0 ? (
                      <AlertTriangle className="h-4 w-4 text-[var(--danger)]" aria-hidden="true" />
                    ) : (
                      <BadgeCheck className="h-4 w-4 text-[var(--success)]" aria-hidden="true" />
                    )}
                    {unitLabel(row.unit)}
                  </h2>
                  <p className="mt-1 text-xs text-[var(--ink-muted)]">
                    {formatEquipmentCategory(row.unit.category)}
                    {row.unit.license_plate ? ` · plate ${row.unit.license_plate}` : ""}
                    {row.unit.vin_or_serial ? ` · VIN ${row.unit.vin_or_serial}` : ""}
                  </p>
                </div>
                <Link
                  className="inline-flex h-9 items-center gap-2 rounded-md border border-[var(--border)] bg-white px-3 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)]"
                  href={`/admin/equipment/${row.unit.id}?tab=documents`}
                >
                  <FileText className="h-4 w-4 text-[var(--primary)]" aria-hidden="true" />
                  File a document
                </Link>
              </div>

              <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                {row.statuses.map((status) => (
                  <div
                    className="rounded-md border border-[var(--border)] bg-white p-3"
                    key={`${row.unit.id}-${status.docType}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-semibold text-[var(--ink)]">
                        {status.label}
                        {status.required ? "" : " (if applicable)"}
                      </p>
                      <span
                        className={`shrink-0 rounded-full border px-2 py-0.5 text-xs font-semibold ${vehicleFileStateClass(status.state)}`}
                      >
                        {VEHICLE_FILE_STATE_LABELS[status.state]}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-[var(--ink-muted)]">{status.description}</p>
                    <p className="mt-1 text-xs font-medium text-[var(--ink-muted)]">{expiryDetail(status)}</p>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </AdminShell>
  );
}
