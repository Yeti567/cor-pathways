import Link from "next/link";
import { redirect } from "next/navigation";
import {
  AlertTriangle,
  BadgeCheck,
  ClipboardList,
  FileBadge,
  FileText,
  IdCard,
  PackageCheck,
  ShieldCheck,
  Stamp,
  Truck,
  Wrench,
} from "lucide-react";
import { updateTransportSafetyFitness } from "@/app/admin/actions";
import { AdminShell } from "@/app/admin/_components/AdminShell";
import { canUseAdminPanel } from "@/lib/access-control";
import { requireAppUser } from "@/lib/current-user";
import { buildEquipmentInventoryRows, buildVehicleFileStatuses, vehicleFileGaps } from "@/lib/equipment";
import {
  companyDeficiencies,
  driverDeficiencies,
  summarizeDeficiencies,
  type TransportDocumentRecord,
} from "@/lib/transport-registry";
import {
  SAFETY_FITNESS_REMINDER_LEAD_DAYS,
  daysUntilExpiry,
  transportExpiryStage,
} from "@/lib/transport-reminders";
import { computeHosViolations, type DutyStatusEvent } from "@/lib/hos-rules";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

export const dynamic = "force-dynamic";

const FLEET_CATEGORIES = ["vehicle", "trailer"] as const;

type DriverRow = Pick<Database["public"]["Tables"]["transport_driver"]["Row"], "id" | "hos_cycle" | "hos_regime">;
type HosEventRow = Pick<
  Database["public"]["Tables"]["transport_duty_status_event"]["Row"],
  "driver_id" | "status" | "started_at"
>;
type TransportDocRow = Pick<
  Database["public"]["Tables"]["transport_document"]["Row"],
  "registry_key" | "slot_key" | "scope" | "subject_id" | "status" | "expiry_date"
>;
type FleetEquipmentRow = Database["public"]["Tables"]["equipment"]["Row"];
type FleetServiceRow = Pick<
  Database["public"]["Tables"]["equipment_scheduled_service"]["Row"],
  "due_date" | "due_meter" | "window_start_meter" | "warn_meter" | "date_lead_days" | "meter_lead" | "equipment_id" | "interval_mode" | "is_active" | "title"
>;
type FleetDocumentRow = Pick<
  Database["public"]["Tables"]["equipment_document"]["Row"],
  "equipment_id" | "doc_type" | "expiry_date" | "is_active" | "reminder_lead_days" | "title"
>;

type TransportPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

type RegistryStatus = "available" | "planned";

type RegistryCard = {
  title: string;
  description: string;
  icon: typeof Truck;
  status: RegistryStatus;
  href?: string;
};

// The seven file registries an Alberta NSC facility audit asks to see. Vehicle
// Master, Registration, and CVIP are all backed by the Equipment module's unit
// records and documents; Collision reuses Incidents. Registration and CVIP are
// two separate files in a carrier's file room and are asked for separately at
// audit, which is why they are two cards rather than one.
const REGISTRIES: RegistryCard[] = [
  {
    title: "1. Driver Qualification Files",
    description: "Per-driver application, abstracts, work history, conviction log, training, and medical fitness.",
    icon: IdCard,
    status: "available",
    href: "/admin/transport/drivers",
  },
  {
    title: "2. Hours of Service & Duty Status",
    description: "Per-driver duty-status logs with Alberta NSC cycle, daily, and elapsed-window availability and violations.",
    icon: ClipboardList,
    status: "available",
    href: "/admin/transport/hos",
  },
  {
    title: "3. Vehicle Master & Maintenance",
    description: "Unit records, meter and hours history, scheduled service windows, and maintenance logs.",
    icon: Wrench,
    status: "available",
    href: "/admin/transport/fleet",
  },
  {
    title: "4. Collision & Incident Management",
    description: "Reportable collisions, root-cause investigations, and corrective action tracking.",
    icon: AlertTriangle,
    status: "available",
    href: "/admin/incidents",
  },
  {
    title: "5. Dangerous Goods (TDG) Shipping",
    description: "Shipping documents, waste manifests, and 2-year retention for dangerous goods in transport.",
    icon: PackageCheck,
    status: "planned",
  },
  {
    title: "6. Vehicle Registration & Insurance",
    description: "Registration certificate and proof of insurance carried in the cab, plus operating permits, per unit.",
    icon: FileBadge,
    status: "available",
    href: "/admin/transport/vehicle-files?file=vehicle_registration",
  },
  {
    title: "7. CVIP Inspection Certificates",
    description: "The annual Commercial Vehicle Inspection Program certificate and decal for every road unit.",
    icon: Stamp,
    status: "available",
    href: "/admin/transport/vehicle-files?file=vehicle_cvip",
  },
];

// COR moved to its own module at /admin/cor (toggle in Setup). The old transport
// "Safety Program (COR)" and "Health, Safety & COR Audit" cards are retired; the
// /admin/transport/program and /admin/transport/audit routes redirect there.

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

// Isolated impure read (request time) so the page component body stays pure.
// Cycle 2 spans 14 days, so a 15-day window covers every HOS availability check.
function hosWindowStartIso() {
  return new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString();
}

export default async function TransportPage({ searchParams }: TransportPageProps) {
  await requireAppUser();
  const context = await requireAppUser();

  if (!canUseAdminPanel(context.appUser)) {
    redirect("/choose");
  }

  // The module is gated by a tenant toggle. When off, the nav entry is hidden, so
  // send any direct hits to Setup where the toggle lives.
  if (!context.tenant?.transport_enabled) {
    redirect("/admin/setup");
  }

  const params = await searchParams;
  const notice = firstParam(params.notice);
  const error = firstParam(params.error);

  const supabase = await createSupabaseServerClient();
  const tenantId = context.appUser.tenant_id;
  const hosWindowStart = hosWindowStartIso();
  const [{ data: drivers }, { data: driverDocuments }, { data: companyDocuments }, { data: fleetEquipment }, { data: fleetServices }, { data: fleetDocuments }, { data: hosEvents }] =
    await Promise.all([
      supabase.from("transport_driver").select("id, hos_cycle, hos_regime").eq("tenant_id", tenantId).is("deleted_at", null).returns<DriverRow[]>(),
      supabase
        .from("transport_document")
        .select("registry_key, slot_key, scope, subject_id, status, expiry_date")
        .eq("tenant_id", tenantId)
        .eq("scope", "driver")
        .is("deleted_at", null)
        .returns<TransportDocRow[]>(),
      supabase
        .from("transport_document")
        .select("registry_key, slot_key, scope, subject_id, status, expiry_date")
        .eq("tenant_id", tenantId)
        .eq("scope", "company")
        .is("deleted_at", null)
        .returns<TransportDocRow[]>(),
      supabase
        .from("equipment")
        .select("*")
        .eq("tenant_id", tenantId)
        .in("category", [...FLEET_CATEGORIES])
        .is("deleted_at", null)
        .returns<FleetEquipmentRow[]>(),
      supabase
        .from("equipment_scheduled_service")
        .select("equipment_id, title, interval_mode, due_date, due_meter, window_start_meter, warn_meter, date_lead_days, meter_lead, is_active")
        .eq("tenant_id", tenantId)
        .eq("is_active", true)
        .is("deleted_at", null)
        .returns<FleetServiceRow[]>(),
      supabase
        .from("equipment_document")
        .select("equipment_id, doc_type, title, expiry_date, reminder_lead_days, is_active")
        .eq("tenant_id", tenantId)
        .eq("is_active", true)
        .is("deleted_at", null)
        .returns<FleetDocumentRow[]>(),
      supabase
        .from("transport_duty_status_event")
        .select("driver_id, status, started_at")
        .eq("tenant_id", tenantId)
        .gte("started_at", hosWindowStart)
        .order("started_at", { ascending: true })
        .returns<HosEventRow[]>(),
    ]);

  // HOS violations across the fleet, computed from the duty-status log.
  const hosEventsByDriver = new Map<string, DutyStatusEvent[]>();
  for (const event of hosEvents ?? []) {
    hosEventsByDriver.set(event.driver_id, [
      ...(hosEventsByDriver.get(event.driver_id) ?? []),
      { status: event.status, startedAt: event.started_at },
    ]);
  }
  const driversInHosViolation = (drivers ?? []).filter(
    (driver) =>
      computeHosViolations({ events: hosEventsByDriver.get(driver.id) ?? [], cycle: driver.hos_cycle, regime: driver.hos_regime }).length > 0,
  ).length;

  // Driver file deficiencies (DQ + HOS) from the registry engine.
  const docsByDriver = new Map<string, TransportDocumentRecord[]>();
  for (const document of driverDocuments ?? []) {
    if (!document.subject_id) {
      continue;
    }
    docsByDriver.set(document.subject_id, [
      ...(docsByDriver.get(document.subject_id) ?? []),
      {
        registryKey: document.registry_key,
        slotKey: document.slot_key,
        scope: document.scope,
        subjectId: document.subject_id,
        status: document.status,
        expiryDate: document.expiry_date,
      },
    ]);
  }

  const driverSummaries = (drivers ?? []).map((driver) =>
    summarizeDeficiencies(driverDeficiencies(docsByDriver.get(driver.id) ?? [])),
  );
  const driverDeficiencyTotals = driverSummaries.reduce(
    (totals, summary) => ({
      total: totals.total + summary.total,
      missing: totals.missing + summary.missing,
      expired: totals.expired + summary.expired,
    }),
    { total: 0, missing: 0, expired: 0 },
  );
  const driversWithDeficiencies = driverSummaries.filter((summary) => summary.total > 0).length;

  // Company Safety Program (COR) deficiencies.
  const companyRecords: TransportDocumentRecord[] = (companyDocuments ?? []).map((document) => ({
    registryKey: document.registry_key,
    slotKey: document.slot_key,
    scope: document.scope,
    subjectId: document.subject_id,
    status: document.status,
    expiryDate: document.expiry_date,
  }));
  const companyDeficiencyTotal = companyDeficiencies(companyRecords).length;

  // Fleet maintenance attention (vehicles + trailers) from the equipment helper.
  const fleetRows = buildEquipmentInventoryRows({
    documents: (fleetDocuments ?? []).map((document) => ({
      equipment_id: document.equipment_id,
      expiryDate: document.expiry_date,
      isActive: document.is_active,
      reminderLeadDays: document.reminder_lead_days,
      title: document.title,
    })),
    equipment: fleetEquipment ?? [],
    locations: [],
    scheduledServices: (fleetServices ?? []).map((service) => ({
      dueDate: service.due_date,
      dueMeter: service.due_meter,
      windowStartMeter: service.window_start_meter,
      warnMeter: service.warn_meter,
      dateLeadDays: service.date_lead_days,
      meterLead: service.meter_lead,
      equipment_id: service.equipment_id,
      intervalMode: service.interval_mode,
      isActive: service.is_active,
      title: service.title,
    })),
    users: [],
  });
  const fleetAttention = fleetRows.filter((row) => row.serviceIndicator.state !== "current").length;

  // Registration/insurance and CVIP gaps across the commercial fleet (registries
  // 6 and 7). Only NSC-regulated units carry these files.
  const documentsByEquipment = new Map<string, FleetDocumentRow[]>();
  for (const document of fleetDocuments ?? []) {
    documentsByEquipment.set(document.equipment_id, [
      ...(documentsByEquipment.get(document.equipment_id) ?? []),
      document,
    ]);
  }
  const commercialUnits = (fleetEquipment ?? []).filter((unit) => unit.is_commercial);
  const vehicleFileGapCount = commercialUnits.reduce((total, unit) => {
    const statuses = buildVehicleFileStatuses({
      category: unit.category,
      documents: (documentsByEquipment.get(unit.id) ?? []).map((document) => ({
        docType: document.doc_type,
        expiryDate: document.expiry_date,
        isActive: document.is_active,
        reminderLeadDays: document.reminder_lead_days,
      })),
    });

    return total + vehicleFileGaps(statuses).length;
  }, 0);

  const snapshot = [
    {
      label: "Drivers with deficiencies",
      value: `${driversWithDeficiencies} / ${(drivers ?? []).length}`,
      detail: "Driver qualification files",
      href: "/admin/transport/drivers",
      alert: driversWithDeficiencies > 0,
    },
    {
      label: "Open driver deficiencies",
      value: String(driverDeficiencyTotals.total),
      detail: `${driverDeficiencyTotals.missing} missing, ${driverDeficiencyTotals.expired} expired`,
      href: "/admin/transport/drivers",
      alert: driverDeficiencyTotals.total > 0,
    },
    {
      label: "Drivers in HOS violation",
      value: String(driversInHosViolation),
      detail: "Hours of Service availability",
      href: "/admin/transport/hos",
      alert: driversInHosViolation > 0,
    },
    {
      label: "Safety program gaps",
      value: String(companyDeficiencyTotal),
      detail: "COR audit elements without evidence",
      href: "/admin/cor",
      alert: companyDeficiencyTotal > 0,
    },
    {
      label: "Fleet maintenance due",
      value: String(fleetAttention),
      detail: `of ${(fleetEquipment ?? []).length} units`,
      href: "/admin/transport/fleet",
      alert: fleetAttention > 0,
    },
    {
      label: "Vehicle file gaps",
      value: String(vehicleFileGapCount),
      detail: `Registration, insurance, CVIP · ${commercialUnits.length} commercial units`,
      href: "/admin/transport/vehicle-files",
      alert: vehicleFileGapCount > 0,
    },
  ];

  const sfcExpiresOn = context.tenant?.safety_fitness_expires_on ?? null;
  const sfcCertNumber = context.tenant?.safety_fitness_cert_number ?? null;
  const sfcStage = transportExpiryStage(sfcExpiresOn, SAFETY_FITNESS_REMINDER_LEAD_DAYS, new Date());
  const sfcDays = daysUntilExpiry(sfcExpiresOn, new Date());
  const sfcStatus =
    !sfcExpiresOn
      ? { label: "Not recorded", className: "border-[var(--border)] bg-[var(--surface-muted)] text-[var(--ink-muted)]" }
      : sfcStage === "expired"
        ? { label: "Expired", className: "border-[var(--danger)] bg-red-50 text-[var(--danger)]" }
        : sfcStage === "due_soon"
          ? { label: `Renew in ${sfcDays} days`, className: "border-[var(--warning)] bg-amber-50 text-[var(--warning)]" }
          : { label: "Current", className: "border-[var(--success)] bg-emerald-50 text-[var(--success)]" };

  return (
    <AdminShell
      eyebrow="Compliance"
      tenantName={context.tenant?.name ?? "Company profile"}
      title="Transport"
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

      <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-[var(--surface-muted)] text-[var(--primary)]">
            <Truck className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-[var(--ink)]">Commercial Vehicle Compliance</h2>
            <p className="mt-1 text-sm text-[var(--ink-muted)]">
              The seven files an Alberta NSC facility audit asks to see. A required document with nothing on file, or
              one that has expired, is tracked as a deficiency. Turn this module off under{" "}
              <Link className="font-semibold text-[var(--primary)] hover:underline" href="/admin/setup">
                Setup
              </Link>
              .
            </p>
          </div>
        </div>
      </section>

      <section className="mt-5 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-[var(--surface-muted)] text-[var(--primary)]">
              <ShieldCheck className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-[var(--ink)]">Safety Fitness Certificate</h2>
              <p className="mt-1 text-sm text-[var(--ink-muted)]">
                {sfcCertNumber ? `Certificate ${sfcCertNumber}` : "No certificate number recorded"}
                {sfcExpiresOn ? ` · expires ${sfcExpiresOn.slice(0, 10)}` : ""}
              </p>
            </div>
          </div>
          <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${sfcStatus.className}`}>
            {sfcStatus.label}
          </span>
        </div>

        <details className="mt-4 rounded-md border border-[var(--border)] bg-white">
          <summary className="cursor-pointer px-3 py-2 text-sm font-semibold text-[var(--primary)]">
            {sfcExpiresOn ? "Update certificate" : "Record certificate"}
          </summary>
          <form action={updateTransportSafetyFitness} className="grid gap-3 px-3 pb-3 pt-1 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <label className="space-y-2">
              <span className="text-sm font-medium text-[var(--ink)]">Certificate number</span>
              <input
                className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                defaultValue={sfcCertNumber ?? ""}
                name="certNumber"
              />
            </label>
            <label className="space-y-2">
              <span className="text-sm font-medium text-[var(--ink)]">Expiry date</span>
              <input
                className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                defaultValue={sfcExpiresOn ? sfcExpiresOn.slice(0, 10) : ""}
                name="expiresOn"
                type="date"
              />
            </label>
            <button
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-white transition hover:bg-[var(--primary-strong)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
              type="submit"
            >
              Save
            </button>
          </form>
        </details>
      </section>

      <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {snapshot.map((stat) => (
          <Link
            className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm transition hover:border-[var(--primary)]"
            href={stat.href}
            key={stat.label}
          >
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
            <p className="mt-1 text-xs text-[var(--ink-muted)]">{stat.detail}</p>
          </Link>
        ))}
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {REGISTRIES.map((registry) => {
          const Icon = registry.icon;
          const card = (
            <div className="flex h-full flex-col rounded-lg border border-[var(--border)] bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-[var(--surface-muted)] text-[var(--primary)]">
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </div>
                <span
                  className={`rounded-md px-2 py-1 text-xs font-semibold ${
                    registry.status === "available"
                      ? "bg-emerald-50 text-[var(--success)]"
                      : "bg-[var(--surface-muted)] text-[var(--ink-muted)]"
                  }`}
                >
                  {registry.status === "available" ? "Available" : "Coming soon"}
                </span>
              </div>
              <h3 className="mt-4 text-base font-semibold text-[var(--ink)]">{registry.title}</h3>
              <p className="mt-1 text-sm text-[var(--ink-muted)]">{registry.description}</p>
              {registry.href ? (
                <span className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-[var(--primary)]">
                  <FileText className="h-4 w-4" aria-hidden="true" />
                  Open
                </span>
              ) : null}
            </div>
          );

          return registry.href ? (
            <Link
              className="block transition hover:opacity-90"
              href={registry.href}
              key={registry.title}
            >
              {card}
            </Link>
          ) : (
            <div key={registry.title}>{card}</div>
          );
        })}
      </div>
    </AdminShell>
  );
}
