import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertTriangle, ArrowLeft, BadgeCheck, FileText, Truck } from "lucide-react";
import { AdminShell } from "@/app/admin/_components/AdminShell";
import { canUseAdminPanel } from "@/lib/access-control";
import { ensureEquipmentCertificationTypes } from "@/lib/equipment-certification-types";
import { requireAppUser } from "@/lib/current-user";
import {
  buildUnitCertificationStatuses,
  buildVehicleFileStatuses,
  certificationTypeNameMap,
  formatEquipmentCategory,
  statusesAwaitingProof,
  unitCertificationGaps,
  unitExpectsCertifications,
  vehicleFileGaps,
  vehicleFileStateClass,
  VEHICLE_FILE_STATE_LABELS,
  type UnitCertificationStatus,
  type VehicleFileRegistryKey,
  type VehicleFileStatus,
} from "@/lib/equipment";
import { hasAttachedProof } from "@/lib/proof-status";
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
  | "certification_type_id"
  | "equipment_id"
  | "doc_type"
  | "expiry_date"
  | "is_active"
  | "reminder_lead_days"
  | "title"
  | "attachment_ids"
>;

type VehicleFilesPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

// The views this page serves. Card 6 and card 7 on the Transport home link here with
// ?file= set, so each lands on just its own file.
//
// This page is a READ-ONLY audit view. Nothing is entered here. A unit's documents live
// on the unit in Equipment, which is the single system of record, and this page reads
// those same equipment_document rows arranged the way an Alberta facility audit asks
// for them. Every row therefore deep-links back to the unit file rather than growing a
// second place to type, which is how the two modules stay one source of truth.
type FileViewKey = "all" | VehicleFileRegistryKey | "vehicle_certifications";

const FILE_VIEWS: {
  value: FileViewKey;
  label: string;
  heading: string;
  blurb: string;
}[] = [
  {
    value: "all",
    label: "All vehicle files",
    heading: "Vehicle files",
    blurb: "Registration, insurance, permits, CVIP, and certifications for every road unit in the fleet.",
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
  {
    value: "vehicle_certifications",
    label: "Certifications",
    heading: "Unit certifications",
    blurb:
      "Picker and crane inspections, CSA B620 tank inspections, pressure tests, and anything else on your certification list, per unit.",
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

function expiryDetail(status: Pick<VehicleFileStatus, "state" | "expiryDate" | "daysUntilExpiry" | "hasProof">) {
  if (status.state === "missing") {
    return "Nothing on file";
  }
  if (status.state === "awaiting_proof") {
    return status.expiryDate
      ? `Expires ${status.expiryDate.slice(0, 10)}, no document uploaded`
      : "No document uploaded";
  }
  if (status.state === "due_soon" && !status.hasProof) {
    // The badge is carrying the deadline, so the missing scan is said here.
    return `${status.expiryDate?.slice(0, 10) ?? "Renewing"}, and no document uploaded`;
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

function CertificationCard({ certification }: { certification: UnitCertificationStatus }) {
  return (
    <div className="rounded-md border border-[var(--border)] bg-white p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-semibold text-[var(--ink)]">
          {certification.label}
          {certification.expected ? "" : " (not on your list)"}
        </p>
        <span
          className={`shrink-0 rounded-full border px-2 py-0.5 text-xs font-semibold ${vehicleFileStateClass(certification.state)}`}
        >
          {VEHICLE_FILE_STATE_LABELS[certification.state]}
        </span>
      </div>
      <p className="mt-1 text-xs font-medium text-[var(--ink-muted)]">{expiryDetail(certification)}</p>
    </div>
  );
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
  const [{ data: equipmentRows }, { data: documentRows }, certificationTypes] = await Promise.all([
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
      .select(
        "equipment_id, doc_type, certification_type_id, expiry_date, is_active, reminder_lead_days, title, attachment_ids",
      )
      .eq("tenant_id", tenantId)
      .is("deleted_at", null)
      .returns<DocumentRow[]>(),
    ensureEquipmentCertificationTypes(supabase, tenantId),
  ]);

  const documentsByEquipment = new Map<string, DocumentRow[]>();
  for (const document of documentRows ?? []) {
    documentsByEquipment.set(document.equipment_id, [
      ...(documentsByEquipment.get(document.equipment_id) ?? []),
      document,
    ]);
  }

  const showRegistryFiles = view.value !== "vehicle_certifications";
  const showCertifications = view.value === "all" || view.value === "vehicle_certifications";
  const certificationTypeInputs = certificationTypes.map((type) => ({ id: type.id, name: type.name }));
  const certificationTypeNames = certificationTypeNameMap(certificationTypeInputs);

  // The registry files (registration, insurance, permits, CVIP) are NSC obligations, so
  // only commercial units carry them: a shop trailer would otherwise read permanently
  // deficient. Certifications are a property of the iron rather than of the regulation,
  // so a picker truck outside NSC still needs its picker inspection.
  //
  // So the unit set follows whether certifications are on screen, not which view it is.
  // Keying it to the certifications view alone hid a non-commercial unit's certification
  // gaps on the combined view while the banner promised they were counted, which is the
  // sort of quiet disagreement between two pages that makes the numbers untrustworthy.
  const units = (equipmentRows ?? []).filter((unit) => unit.is_commercial || showCertifications);

  const rows = units.map((unit) => {
    const documents = documentsByEquipment.get(unit.id) ?? [];
    const registryStatuses =
      showRegistryFiles && unit.is_commercial
        ? buildVehicleFileStatuses({
            category: unit.category,
            documents: documents.map((document) => ({
              docType: document.doc_type,
              expiryDate: document.expiry_date,
              isActive: document.is_active,
              reminderLeadDays: document.reminder_lead_days,
              hasProof: hasAttachedProof(document.attachment_ids),
            })),
          })
        : [];

    const visibleRegistry =
      view.value === "all" || !showRegistryFiles
        ? registryStatuses
        : registryStatuses.filter((status) => status.registryKey === view.value);

    const certifications = showCertifications
      ? buildUnitCertificationStatuses({
          certificationTypes: unitExpectsCertifications(unit.category) ? certificationTypeInputs : [],
          certificationTypeNames,
          documents: documents.map((document) => ({
            certificationTypeId: document.certification_type_id,
            docType: document.doc_type,
            expiryDate: document.expiry_date,
            isActive: document.is_active,
            reminderLeadDays: document.reminder_lead_days,
            title: document.title,
            hasProof: hasAttachedProof(document.attachment_ids),
          })),
        })
      : [];

    return {
      unit,
      statuses: visibleRegistry,
      certifications,
      gaps: [...vehicleFileGaps(visibleRegistry), ...unitCertificationGaps(certifications)],
      // Files this unit has on paper and could not produce at an audit. Counted
      // apart from gaps: it is unfinished filing, not a deficiency.
      awaitingProof: [...statusesAwaitingProof(visibleRegistry), ...statusesAwaitingProof(certifications)],
    };
  })
    // A non-commercial unit carries no registry files, so if it has also filed no
    // certifications and the tenant has emptied the type list, there is nothing to say
    // about it. Rendering its card anyway would be an empty box with a heading.
    .filter((row) => row.statuses.length > 0 || row.certifications.length > 0);

  const unitsWithGaps = rows.filter((row) => row.gaps.length > 0).length;
  const totalGaps = rows.reduce((total, row) => total + row.gaps.length, 0);
  const totalAwaitingProof = rows.reduce((total, row) => total + row.awaitingProof.length, 0);
  const expiringSoon = rows.reduce(
    (total, row) =>
      total +
      row.statuses.filter((status) => status.state === "due_soon").length +
      row.certifications.filter((certification) => certification.state === "due_soon").length,
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

      <p className="mt-4 text-sm text-[var(--ink-muted)]">{view.blurb}</p>

      <div className="mt-3 rounded-md border border-[var(--border)] bg-[var(--surface-muted)] p-3">
        <p className="text-sm text-[var(--ink)]">
          <span className="font-semibold">This is a read-only audit view.</span> Nothing is entered here. Every unit
          keeps one file, on the unit in{" "}
          <Link className="font-semibold text-[var(--primary)] hover:underline" href="/admin/equipment">
            Equipment
          </Link>
          , and this page reads those same documents arranged the way a facility audit asks for them. Use{" "}
          <span className="font-semibold">Open unit file</span> on any unit to add or renew one.
        </p>
        {showCertifications ? (
          <p className="mt-2 text-sm text-[var(--ink-muted)]">
            Every certification on your list is expected on every vehicle and trailer, so one that has never been filed
            counts as a gap. If the fleet carries no tanks or pickers, remove those from{" "}
            <Link
              className="font-semibold text-[var(--primary)] hover:underline"
              href="/admin/equipment/certification-types"
            >
              the certification list
            </Link>
            .
          </p>
        ) : null}
      </div>

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

      <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
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
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
          <p className="text-sm text-[var(--ink-muted)]">Waiting on a document</p>
          <p
            className={`mt-2 text-2xl font-bold ${totalAwaitingProof > 0 ? "text-[var(--warning)]" : "text-[var(--ink)]"}`}
          >
            {totalAwaitingProof}
          </p>
          <p className="mt-1 text-xs text-[var(--ink-muted)]">
            Dates entered with no scan behind them.{" "}
            <Link className="font-semibold text-[var(--primary)] hover:underline" href="/admin/needs-document">
              Chase list
            </Link>
          </p>
        </div>
      </div>

      {rows.length === 0 ? (
        <section className="mt-5 rounded-lg border border-dashed border-[var(--border)] bg-[var(--surface)] p-10 text-center shadow-sm">
          <Truck className="mx-auto h-8 w-8 text-[var(--primary)]" aria-hidden="true" />
          <h2 className="mt-3 text-lg font-semibold text-[var(--ink)]">
            {showCertifications ? "No vehicles or trailers yet" : "No commercial units yet"}
          </h2>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">
            Add a vehicle or trailer in{" "}
            <Link className="font-semibold text-[var(--primary)] hover:underline" href="/admin/equipment">
              Equipment
            </Link>
            {showCertifications ? (
              ". Certifications are tracked on every road unit, commercial or not."
            ) : (
              <>
                {" "}
                and tick <span className="font-semibold">Commercial vehicle</span>. Only NSC-regulated units carry
                these files.
              </>
            )}
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
                  Open unit file
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

              {row.certifications.length > 0 ? (
                <div className="mt-3">
                  {row.statuses.length > 0 ? (
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
                      Certifications
                    </p>
                  ) : null}
                  <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                    {row.certifications.map((certification) => (
                      <CertificationCard
                        certification={certification}
                        key={`${row.unit.id}-${certification.certificationTypeId ?? certification.label}`}
                      />
                    ))}
                  </div>
                </div>
              ) : null}
            </section>
          ))}
        </div>
      )}
    </AdminShell>
  );
}
