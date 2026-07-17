import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  CalendarDays,
  Camera,
  CheckCircle2,
  ClipboardList,
  FileText,
  Gauge,
  Link2,
  MapPin,
  Paperclip,
  Printer,
  Save,
  Truck,
  Unlink,
  UserRound,
  Wrench,
} from "lucide-react";
import {
  completeEquipmentScheduledService,
  createEquipmentDocument,
  createEquipmentMaintenanceLog,
  createEquipmentMeterReading,
  createManualEquipmentSubmissionLink,
  createEquipmentScheduledService,
  deleteEquipmentSubmissionLink,
  updateEquipment,
  uploadEquipmentPhotos,
} from "@/app/admin/actions";
import { AdminShell } from "@/app/admin/_components/AdminShell";
import { canUseAdminPanel } from "@/lib/access-control";
import { requireAppUser } from "@/lib/current-user";
import {
  coerceEquipmentTab,
  equipmentCategoryOptions,
  equipmentDocumentTypeOptions,
  equipmentDueStatusClass,
  equipmentIntervalModeOptions,
  equipmentMaintenanceTypeOptions,
  equipmentServiceTypeOptions,
  equipmentStatusOptions,
  equipmentTabs,
  equipmentTrackingModeOptions,
  equipmentTracksByMeter,
  formatEquipmentCategory,
  formatEquipmentMeter,
  formatEquipmentStatus,
  getEquipmentComplianceStatus,
  getEquipmentDocumentStatus,
  getEquipmentScheduleStatus,
  type EquipmentDueStatus,
  type EquipmentTab,
} from "@/lib/equipment";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

export const dynamic = "force-dynamic";

type EquipmentDetailPageProps = {
  params: Promise<{ equipmentId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

type EquipmentRow = Database["public"]["Tables"]["equipment"]["Row"];
type LocationRow = Pick<Database["public"]["Tables"]["locations"]["Row"], "code" | "id" | "name">;
type UserRow = Pick<Database["public"]["Tables"]["users"]["Row"], "email" | "full_name" | "id">;
type ScheduledServiceRow = Database["public"]["Tables"]["equipment_scheduled_service"]["Row"];
type MaintenanceRow = Database["public"]["Tables"]["equipment_maintenance_log"]["Row"];
type MeterRow = Database["public"]["Tables"]["equipment_meter_log"]["Row"];
type EquipmentDocumentRow = Database["public"]["Tables"]["equipment_document"]["Row"];
type EquipmentSubmissionLinkRow = Database["public"]["Tables"]["equipment_submission_link"]["Row"];
type SubmissionRow = Pick<
  Database["public"]["Tables"]["submissions"]["Row"],
  "created_at" | "form_id" | "id" | "status" | "submitted_at" | "submitted_by" | "sync_state"
>;
type FormRow = Pick<Database["public"]["Tables"]["forms"]["Row"], "code" | "id" | "name">;

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function formatDate(value: string | null | undefined) {
  if (!value) {
    return "Not set";
  }

  return new Intl.DateTimeFormat("en", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(`${value.slice(0, 10)}T00:00:00`));
}

function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return "Not submitted";
  }

  return new Intl.DateTimeFormat("en", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function signedPathUrl(urls: Map<string, string | null>, path: string | null | undefined) {
  return path ? urls.get(path) ?? null : null;
}

function attachmentLabel(path: string, index: number) {
  const filename = path.split("/").pop() ?? `Attachment ${index + 1}`;
  return filename.replace(/^\d+-\d+-/, "").replace(/^\d+-/, "") || `Attachment ${index + 1}`;
}

function formatCurrency(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === "") {
    return "Not recorded";
  }

  const parsed = typeof value === "number" ? value : Number(value);

  if (!Number.isFinite(parsed)) {
    return "Not recorded";
  }

  return new Intl.NumberFormat("en", {
    currency: "USD",
    style: "currency",
  }).format(parsed);
}

function statusBadgeClass(status: string) {
  switch (status) {
    case "active":
      return "border-[var(--success)] bg-emerald-50 text-[var(--success)]";
    case "down":
      return "border-[var(--danger)] bg-red-50 text-[var(--danger)]";
    case "retired":
    case "sold":
      return "border-[var(--border)] bg-[var(--surface-muted)] text-[var(--ink-muted)]";
    default:
      return "border-[var(--border)] bg-white text-[var(--ink-muted)]";
  }
}

function sourceLabel(value: string) {
  switch (value) {
    case "inspection":
      return "Inspection";
    case "maintenance":
      return "Maintenance";
    case "eld":
      return "ELD";
    default:
      return "Manual";
  }
}

function tabLabel(tab: EquipmentTab) {
  switch (tab) {
    case "service":
      return "Service Schedule";
    case "maintenance":
      return "Maintenance";
    case "meter":
      return "Meter History";
    case "documents":
      return "Documents";
    case "forms":
      return "Inspections and Forms";
    default:
      return "Overview";
  }
}

function dueDetail(status: EquipmentDueStatus) {
  if (status.daysUntilDue !== null) {
    if (status.daysUntilDue < 0) {
      return `${Math.abs(status.daysUntilDue)} days overdue`;
    }

    if (status.daysUntilDue === 0) {
      return "Due today";
    }

    return `Due in ${status.daysUntilDue} days`;
  }

  if (status.meterRemaining !== null) {
    if (status.meterRemaining <= 0) {
      return `${Math.abs(status.meterRemaining).toLocaleString("en")} past due`;
    }

    return `${status.meterRemaining.toLocaleString("en")} remaining`;
  }

  return status.label;
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
      <p className="text-xs font-semibold uppercase text-[var(--ink-muted)]">{label}</p>
      <p className="mt-2 text-sm font-semibold text-[var(--ink)]">{value}</p>
    </div>
  );
}

const inputClass =
  "h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2 disabled:bg-[var(--surface-muted)] disabled:text-[var(--ink-muted)]";
const textareaClass =
  "min-h-24 w-full rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2";
const primaryButtonClass =
  "inline-flex h-10 w-fit items-center justify-center gap-2 rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-white transition hover:bg-[var(--primary-strong)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2";
const panelClass = "rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm";

export default async function EquipmentDetailPage({ params, searchParams }: EquipmentDetailPageProps) {
  const { equipmentId } = await params;
  const queryParams = await searchParams;
  const activeTab = coerceEquipmentTab(firstParam(queryParams.tab));
  const notice = firstParam(queryParams.notice);
  const error = firstParam(queryParams.error);
  const context = await requireAppUser();

  if (!canUseAdminPanel(context.appUser)) {
    redirect("/choose");
  }

  const supabase = await createSupabaseServerClient();
  const { data: equipment } = await supabase
    .from("equipment")
    .select("*")
    .eq("id", equipmentId)
    .eq("tenant_id", context.appUser.tenant_id)
    .is("deleted_at", null)
    .maybeSingle<EquipmentRow>();

  if (!equipment) {
    redirect(`/admin/equipment?error=${encodeURIComponent("Equipment record not found or is no longer available.")}`);
  }

  const [
    { data: location },
    { data: assignee },
    { data: allLocations },
    { data: allUsers },
    { data: scheduledServices },
    { data: maintenance },
    { data: meterRows },
    { data: documents },
    { data: linkedSubmissions },
  ] = await Promise.all([
    equipment.location_id
      ? supabase
          .from("locations")
          .select("id, name, code")
          .eq("id", equipment.location_id)
          .eq("tenant_id", context.appUser.tenant_id)
          .maybeSingle<LocationRow>()
      : Promise.resolve({ data: null }),
    equipment.assigned_to
      ? supabase
          .from("users")
          .select("id, full_name, email")
          .eq("id", equipment.assigned_to)
          .eq("tenant_id", context.appUser.tenant_id)
          .maybeSingle<UserRow>()
      : Promise.resolve({ data: null }),
    supabase
      .from("locations")
      .select("id, name, code")
      .eq("tenant_id", context.appUser.tenant_id)
      .order("name", { ascending: true })
      .returns<LocationRow[]>(),
    supabase
      .from("users")
      .select("id, full_name, email")
      .eq("tenant_id", context.appUser.tenant_id)
      .eq("active", true)
      .order("full_name", { ascending: true })
      .returns<UserRow[]>(),
    supabase
      .from("equipment_scheduled_service")
      .select("*")
      .eq("equipment_id", equipment.id)
      .eq("tenant_id", context.appUser.tenant_id)
      .is("deleted_at", null)
      .order("due_date", { ascending: true, nullsFirst: false })
      .order("due_meter", { ascending: true, nullsFirst: false })
      .returns<ScheduledServiceRow[]>(),
    supabase
      .from("equipment_maintenance_log")
      .select("*")
      .eq("equipment_id", equipment.id)
      .eq("tenant_id", context.appUser.tenant_id)
      .is("deleted_at", null)
      .order("performed_at", { ascending: false })
      .returns<MaintenanceRow[]>(),
    supabase
      .from("equipment_meter_log")
      .select("*")
      .eq("equipment_id", equipment.id)
      .eq("tenant_id", context.appUser.tenant_id)
      .order("recorded_at", { ascending: false })
      .returns<MeterRow[]>(),
    supabase
      .from("equipment_document")
      .select("*")
      .eq("equipment_id", equipment.id)
      .eq("tenant_id", context.appUser.tenant_id)
      .is("deleted_at", null)
      .order("expiry_date", { ascending: true })
      .returns<EquipmentDocumentRow[]>(),
    supabase
      .from("equipment_submission_link")
      .select("*")
      .eq("equipment_id", equipment.id)
      .eq("tenant_id", context.appUser.tenant_id)
      .order("linked_at", { ascending: false })
      .returns<EquipmentSubmissionLinkRow[]>(),
  ]);

  // A linked ELD (Motive) vehicle, if this unit was matched during sync.
  const { data: eldVehicleLink } = await supabase
    .from("eld_vehicle_link")
    .select("provider, external_vehicle_id")
    .eq("equipment_id", equipment.id)
    .eq("tenant_id", context.appUser.tenant_id)
    .maybeSingle<{ provider: string; external_vehicle_id: string }>();

  // ELD telematics for the unit: device state plus recent disconnect / fault events.
  const [{ data: eldDevice }, { data: eldEvents }] = await Promise.all([
    supabase
      .from("eld_device")
      .select("identifier, model, firmware, status, last_seen_at")
      .eq("equipment_id", equipment.id)
      .eq("tenant_id", context.appUser.tenant_id)
      .maybeSingle<{ identifier: string | null; model: string | null; firmware: string | null; status: string | null; last_seen_at: string | null }>(),
    supabase
      .from("eld_vehicle_event")
      .select("id, event_type, code, description, severity, occurred_at")
      .eq("equipment_id", equipment.id)
      .eq("tenant_id", context.appUser.tenant_id)
      .order("occurred_at", { ascending: false })
      .limit(20)
      .returns<
        { id: string; event_type: "disconnect" | "fault_code"; code: string | null; description: string | null; severity: string | null; occurred_at: string }[]
      >(),
  ]);
  const eldDisconnects = (eldEvents ?? []).filter((event) => event.event_type === "disconnect");
  const eldFaultCodes = (eldEvents ?? []).filter((event) => event.event_type === "fault_code");

  const submissionIds = Array.from(new Set((linkedSubmissions ?? []).map((link) => link.submission_id)));
  const { data: submissions } =
    submissionIds.length > 0
      ? await supabase
          .from("submissions")
          .select("id, form_id, submitted_by, status, sync_state, submitted_at, created_at")
          .eq("tenant_id", context.appUser.tenant_id)
          .in("id", submissionIds)
          .returns<SubmissionRow[]>()
      : { data: [] as SubmissionRow[] };
  const linkedSubmissionIdSet = new Set(submissionIds);
  const { data: candidateSubmissions } = await supabase
    .from("submissions")
    .select("id, form_id, submitted_by, status, sync_state, submitted_at, created_at")
    .eq("tenant_id", context.appUser.tenant_id)
    .order("created_at", { ascending: false })
    .limit(100)
    .returns<SubmissionRow[]>();
  const linkableSubmissions = (candidateSubmissions ?? []).filter((submission) => !linkedSubmissionIdSet.has(submission.id));
  const displaySubmissionRows = [...(submissions ?? []), ...linkableSubmissions];
  const formIds = Array.from(new Set(displaySubmissionRows.map((submission) => submission.form_id)));
  const submitterIds = Array.from(
    new Set(displaySubmissionRows.map((submission) => submission.submitted_by).filter((userId): userId is string => Boolean(userId))),
  );
  const [{ data: forms }, { data: submitters }] = await Promise.all([
    formIds.length > 0
      ? supabase
          .from("forms")
          .select("id, name, code")
          .eq("tenant_id", context.appUser.tenant_id)
          .in("id", formIds)
          .returns<FormRow[]>()
      : Promise.resolve({ data: [] as FormRow[] }),
    submitterIds.length > 0
      ? supabase
          .from("users")
          .select("id, full_name, email")
          .eq("tenant_id", context.appUser.tenant_id)
          .in("id", submitterIds)
          .returns<UserRow[]>()
      : Promise.resolve({ data: [] as UserRow[] }),
  ]);

  const formById = new Map((forms ?? []).map((form) => [form.id, form]));
  const submitterById = new Map((submitters ?? []).map((user) => [user.id, user]));
  const submissionById = new Map((submissions ?? []).map((submission) => [submission.id, submission]));
  const attachmentPaths = Array.from(
    new Set([
      ...equipment.photo_ids,
      ...(maintenance ?? []).flatMap((entry) => entry.attachment_ids),
      ...(documents ?? []).flatMap((document) => document.attachment_ids),
    ]),
  ).filter((path): path is string => Boolean(path));
  const signedUrls = new Map<string, string | null>();

  await Promise.all(
    attachmentPaths.map(async (path) => {
      const { data } = await supabase.storage.from("tenant-documents").createSignedUrl(path, 10 * 60);
      signedUrls.set(path, data?.signedUrl ?? null);
    }),
  );
  const serviceAttentionCount = [
    ...(scheduledServices ?? []).map((service) =>
      getEquipmentScheduleStatus(
        {
          dueDate: service.due_date,
          dueMeter: service.due_meter,
          windowStartMeter: service.window_start_meter,
          warnMeter: service.warn_meter,
          dateLeadDays: service.date_lead_days,
          meterLead: service.meter_lead,
          intervalMode: service.interval_mode,
          isActive: service.is_active,
        },
        equipment.current_meter,
      ),
    ),
    ...(documents ?? []).map((document) =>
      getEquipmentDocumentStatus({
        expiryDate: document.expiry_date,
        isActive: document.is_active,
        reminderLeadDays: document.reminder_lead_days,
      }),
    ),
  ].filter((status) => status.state !== "current").length;

  // Trailers (and other meterless units) have no odometer/hour meter, so the
  // service form drops the meter inputs and tracks by date only.
  const tracksByMeter = equipmentTracksByMeter(equipment.category);

  // Commercial/NSC units must carry registration, insurance, and a maintenance
  // record. A maintenance record counts as a logged entry or a set-up schedule.
  const compliance = getEquipmentComplianceStatus({
    isCommercial: equipment.is_commercial,
    documents: (documents ?? []).map((document) => ({
      docType: document.doc_type,
      expiryDate: document.expiry_date,
      isActive: document.is_active,
    })),
    hasMaintenanceRecord: (maintenance?.length ?? 0) > 0 || (scheduledServices?.length ?? 0) > 0,
  });

  return (
    <AdminShell
      eyebrow="Equipment file"
      tenantName={context.tenant?.name ?? "Company profile"}
      title={`${equipment.unit_number} ${equipment.name ? `, ${equipment.name}` : ""}`}
    >
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Link
          className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-[var(--border)] bg-white px-3 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)]"
          href="/admin/equipment"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Equipment
        </Link>
        <span className={`inline-flex rounded-full border px-3 py-1 text-sm font-semibold ${statusBadgeClass(equipment.status)}`}>
          {formatEquipmentStatus(equipment.status)}
        </span>
        {compliance.applicable ? (
          <span
            className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-sm font-semibold ${
              compliance.isComplete
                ? "border-[var(--success)] bg-emerald-50 text-[var(--success)]"
                : "border-[var(--danger)] bg-red-50 text-[var(--danger)]"
            }`}
          >
            {compliance.isComplete ? (
              <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
            ) : (
              <AlertTriangle className="h-4 w-4" aria-hidden="true" />
            )}
            {compliance.isComplete ? "File complete" : "File incomplete"}
          </span>
        ) : null}
        {eldVehicleLink ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-[var(--primary)] bg-[var(--surface-muted)] px-3 py-1 text-sm font-semibold text-[var(--primary)]">
            <Link2 className="h-4 w-4" aria-hidden="true" />
            ELD linked ({eldVehicleLink.provider === "motive" ? "Motive" : eldVehicleLink.provider})
          </span>
        ) : null}
      </div>
      {compliance.applicable && !compliance.isComplete ? (
        <div className="mb-4 rounded-md border border-[var(--danger)] bg-red-50 p-3">
          <p className="flex items-center gap-2 text-sm font-semibold text-[var(--danger)]">
            <AlertTriangle className="h-4 w-4" aria-hidden="true" />
            This commercial unit&apos;s file is incomplete.
          </p>
          <p className="mt-1 text-sm text-[var(--ink)]">
            Add the following before the unit is compliant:{" "}
            {compliance.missing.map((item, index) => (
              <span key={item.key} className="font-semibold">
                {index > 0 ? ", " : ""}
                {item.label}
                {item.reason === "expired" ? " (expired)" : ""}
              </span>
            ))}
            .
          </p>
          <Link
            className="mt-3 inline-flex h-9 items-center justify-center gap-2 rounded-md bg-[var(--primary)] px-3 text-sm font-semibold text-white transition hover:bg-[var(--primary-strong)]"
            href={`/admin/equipment/${equipment.id}?tab=documents`}
          >
            <FileText className="h-4 w-4" aria-hidden="true" />
            Upload documents
          </Link>
        </div>
      ) : null}
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

      <div className="grid gap-4 md:grid-cols-4">
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
          <p className="text-sm text-[var(--ink-muted)]">Current meter</p>
          <p className="mt-2 text-2xl font-bold text-[var(--ink)]">
            {formatEquipmentMeter({ trackingMode: equipment.tracking_mode, value: equipment.current_meter })}
          </p>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
          <p className="text-sm text-[var(--ink-muted)]">Service alerts</p>
          <p className="mt-2 text-2xl font-bold text-[var(--ink)]">{serviceAttentionCount}</p>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
          <p className="text-sm text-[var(--ink-muted)]">Maintenance entries</p>
          <p className="mt-2 text-2xl font-bold text-[var(--ink)]">{maintenance?.length ?? 0}</p>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
          <p className="text-sm text-[var(--ink-muted)]">Linked forms</p>
          <p className="mt-2 text-2xl font-bold text-[var(--ink)]">{linkedSubmissions?.length ?? 0}</p>
        </div>
      </div>

      <nav className="mt-5 flex gap-2 overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2 shadow-sm">
        {equipmentTabs.map((tab) => (
          <Link
            className={`whitespace-nowrap rounded-md px-3 py-2 text-sm font-semibold transition ${
              activeTab === tab ? "bg-[var(--primary)] text-white" : "text-[var(--ink-muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--ink)]"
            }`}
            href={`/admin/equipment/${equipment.id}?tab=${tab}`}
            key={tab}
          >
            {tabLabel(tab)}
          </Link>
        ))}
      </nav>

      {activeTab === "overview" ? (
        <section className="mt-5 grid gap-5 xl:grid-cols-[1fr_340px]">
          <div className="grid gap-5">
            <div className="grid gap-4 md:grid-cols-2">
              <InfoRow label="Category" value={formatEquipmentCategory(equipment.category)} />
              <InfoRow label="Tracking mode" value={equipment.tracking_mode === "hours" ? "Hours" : "Mileage"} />
              <InfoRow label="Make" value={equipment.make ?? "Not set"} />
              <InfoRow label="Model" value={equipment.model ?? "Not set"} />
              <InfoRow label="Year" value={equipment.year ? String(equipment.year) : "Not set"} />
              <InfoRow label="VIN or serial" value={equipment.vin_or_serial ?? "Not set"} />
              <InfoRow label="License plate" value={equipment.license_plate ?? "Not set"} />
              <InfoRow label="Purchase date" value={formatDate(equipment.purchase_date)} />
              <InfoRow label="Commercial vehicle" value={equipment.is_commercial ? "Yes (NSC)" : "No"} />
            </div>

            {eldDevice || eldDisconnects.length > 0 || eldFaultCodes.length > 0 ? (
              <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
                <div className="flex items-center gap-2">
                  <Link2 className="h-5 w-5 text-[var(--primary)]" aria-hidden="true" />
                  <h2 className="text-lg font-semibold text-[var(--ink)]">ELD telematics</h2>
                </div>
                {eldDevice ? (
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <InfoRow label="Device" value={eldDevice.identifier ?? "Not reported"} />
                    <InfoRow label="Model" value={eldDevice.model ?? "Not reported"} />
                    <InfoRow label="Firmware" value={eldDevice.firmware ?? "Not reported"} />
                    <InfoRow label="Status" value={eldDevice.status ?? "Not reported"} />
                    <InfoRow label="Last seen" value={formatDate(eldDevice.last_seen_at)} />
                  </div>
                ) : null}
                {eldDisconnects.length > 0 ? (
                  <div className="mt-4">
                    <h3 className="flex items-center gap-2 text-sm font-semibold text-[var(--ink)]">
                      <AlertTriangle className="h-4 w-4 text-[var(--warning)]" aria-hidden="true" />
                      Recent ELD disconnects
                    </h3>
                    <ul className="mt-2 divide-y divide-[var(--border)] rounded-md border border-[var(--border)]">
                      {eldDisconnects.slice(0, 5).map((event) => (
                        <li className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm" key={event.id}>
                          <span className="text-[var(--ink)]">{event.description ?? "Disconnected"}</span>
                          <span className="text-[var(--ink-muted)]">{formatDate(event.occurred_at)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {eldFaultCodes.length > 0 ? (
                  <div className="mt-4">
                    <h3 className="flex items-center gap-2 text-sm font-semibold text-[var(--ink)]">
                      <Wrench className="h-4 w-4 text-[var(--primary)]" aria-hidden="true" />
                      Recent fault codes
                    </h3>
                    <ul className="mt-2 divide-y divide-[var(--border)] rounded-md border border-[var(--border)]">
                      {eldFaultCodes.slice(0, 5).map((event) => (
                        <li className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm" key={event.id}>
                          <span className="text-[var(--ink)]">
                            {event.code ? `${event.code}: ` : ""}
                            {event.description ?? "Fault code"}
                            {event.severity ? ` (${event.severity})` : ""}
                          </span>
                          <span className="text-[var(--ink-muted)]">{formatDate(event.occurred_at)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : null}

            <form action={updateEquipment} className={panelClass}>
              <input name="equipmentId" type="hidden" value={equipment.id} />
              {equipment.status === "down" ? <input name="locationId" type="hidden" value="" /> : null}
              <h2 className="text-lg font-semibold text-[var(--ink)]">Edit Equipment</h2>
              <div className="mt-4 grid gap-4 md:grid-cols-3">
                <label className="space-y-2">
                  <span className="text-sm font-medium text-[var(--ink)]">Unit number</span>
                  <input className={inputClass} defaultValue={equipment.unit_number} name="unitNumber" required />
                </label>
                <label className="space-y-2">
                  <span className="text-sm font-medium text-[var(--ink)]">Name</span>
                  <input className={inputClass} defaultValue={equipment.name ?? ""} name="name" />
                </label>
                <label className="space-y-2">
                  <span className="text-sm font-medium text-[var(--ink)]">Status</span>
                  <select className={inputClass} defaultValue={equipment.status} name="status">
                    {equipmentStatusOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="mt-4 grid gap-4 md:grid-cols-4">
                <label className="space-y-2">
                  <span className="text-sm font-medium text-[var(--ink)]">Category</span>
                  <select className={inputClass} defaultValue={equipment.category} name="category">
                    {equipmentCategoryOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-2">
                  <span className="text-sm font-medium text-[var(--ink)]">Tracking mode</span>
                  <select className={inputClass} defaultValue={equipment.tracking_mode} name="trackingMode">
                    {equipmentTrackingModeOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-2">
                  <span className="text-sm font-medium text-[var(--ink)]">Assigned to</span>
                  <select className={inputClass} defaultValue={equipment.assigned_to ?? ""} name="assignedTo">
                    <option value="">Unassigned</option>
                    {(allUsers ?? []).map((user) => (
                      <option key={user.id} value={user.id}>
                        {user.full_name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-2">
                  <span className="text-sm font-medium text-[var(--ink)]">Location</span>
                  <select
                    className={inputClass}
                    defaultValue={equipment.status === "down" ? "" : equipment.location_id ?? ""}
                    disabled={equipment.status === "down"}
                    name="locationId"
                  >
                    <option value="">Unassigned</option>
                    {(allLocations ?? []).map((availableLocation) => (
                      <option key={availableLocation.id} value={availableLocation.id}>
                        {availableLocation.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="mt-4 grid gap-4 md:grid-cols-4">
                <label className="space-y-2">
                  <span className="text-sm font-medium text-[var(--ink)]">Make</span>
                  <input className={inputClass} defaultValue={equipment.make ?? ""} name="make" />
                </label>
                <label className="space-y-2">
                  <span className="text-sm font-medium text-[var(--ink)]">Model</span>
                  <input className={inputClass} defaultValue={equipment.model ?? ""} name="model" />
                </label>
                <label className="space-y-2">
                  <span className="text-sm font-medium text-[var(--ink)]">Year</span>
                  <input className={inputClass} defaultValue={equipment.year ?? ""} max="2200" min="1900" name="year" type="number" />
                </label>
                <label className="space-y-2">
                  <span className="text-sm font-medium text-[var(--ink)]">Purchase date</span>
                  <input className={inputClass} defaultValue={equipment.purchase_date ?? ""} name="purchaseDate" type="date" />
                </label>
              </div>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <label className="space-y-2">
                  <span className="text-sm font-medium text-[var(--ink)]">VIN or serial</span>
                  <input className={inputClass} defaultValue={equipment.vin_or_serial ?? ""} name="vinOrSerial" />
                </label>
                <label className="space-y-2">
                  <span className="text-sm font-medium text-[var(--ink)]">License plate</span>
                  <input className={inputClass} defaultValue={equipment.license_plate ?? ""} name="licensePlate" />
                </label>
              </div>
              <label className="mt-4 block space-y-2">
                <span className="text-sm font-medium text-[var(--ink)]">Notes</span>
                <textarea className={textareaClass} defaultValue={equipment.notes ?? ""} name="notes" />
              </label>
              <label className="mt-4 flex items-start gap-3 rounded-md border border-[var(--border)] bg-[var(--surface-muted)] p-3">
                <input
                  className="mt-0.5 h-4 w-4"
                  defaultChecked={equipment.is_commercial}
                  name="isCommercial"
                  type="checkbox"
                  value="true"
                />
                <span className="space-y-1">
                  <span className="block text-sm font-medium text-[var(--ink)]">Commercial vehicle (NSC)</span>
                  <span className="block text-xs text-[var(--ink-muted)]">
                    Requires registration, insurance, and a maintenance record on file. The unit shows as incomplete until they are added.
                  </span>
                </span>
              </label>
              <button className={`${primaryButtonClass} mt-4`} type="submit">
                <Save className="h-4 w-4" aria-hidden="true" />
                Save Equipment
              </button>
            </form>
          </div>
          <aside className="h-fit rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
            <h2 className="text-lg font-semibold text-[var(--ink)]">Assignment</h2>
            <div className="mt-4 grid gap-3 text-sm text-[var(--ink-muted)]">
              <p className="inline-flex items-center gap-2">
                <UserRound className="h-4 w-4 text-[var(--primary)]" aria-hidden="true" />
                {assignee?.full_name ?? "Unassigned"}
              </p>
              <p className="inline-flex items-center gap-2">
                <MapPin className="h-4 w-4 text-[var(--primary)]" aria-hidden="true" />
                {equipment.status === "down"
                  ? "No location while down"
                  : location
                    ? `${location.name}${location.code ? ` (${location.code})` : ""}`
                    : "Unassigned"}
              </p>
              <p className="inline-flex items-center gap-2">
                <Truck className="h-4 w-4 text-[var(--primary)]" aria-hidden="true" />
                {equipment.photo_ids.length} photos
              </p>
            </div>
            <div className="mt-5 rounded-md bg-[var(--surface-muted)] p-4">
              <p className="text-xs font-semibold uppercase text-[var(--ink-muted)]">Notes</p>
              <p className="mt-2 whitespace-pre-wrap text-sm text-[var(--ink)]">{equipment.notes || "No notes recorded."}</p>
            </div>
            <div className="mt-5">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold text-[var(--ink)]">Unit Photos</h2>
                <span className="text-xs font-semibold text-[var(--ink-muted)]">{equipment.photo_ids.length}</span>
              </div>
              {equipment.photo_ids.length > 0 ? (
                <div className="mt-3 grid grid-cols-2 gap-3">
                  {equipment.photo_ids.map((path, index) => {
                    const url = signedPathUrl(signedUrls, path);
                    const label = attachmentLabel(path, index);

                    return url ? (
                      <a
                        aria-label={`Open ${label}`}
                        className="group block overflow-hidden rounded-md border border-[var(--border)] bg-white focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                        href={url}
                        key={path}
                        rel="noreferrer"
                        target="_blank"
                      >
                        <Image
                          alt={label}
                          className="aspect-[4/3] w-full object-cover transition group-hover:scale-105"
                          height={120}
                          src={url}
                          unoptimized
                          width={160}
                        />
                      </a>
                    ) : (
                      <div
                        className="flex aspect-[4/3] items-center justify-center rounded-md border border-dashed border-[var(--border)] bg-white px-3 text-center text-xs text-[var(--ink-muted)]"
                        key={path}
                      >
                        Photo unavailable
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="mt-3 rounded-md border border-dashed border-[var(--border)] bg-white px-3 py-4 text-sm text-[var(--ink-muted)]">
                  No unit photos uploaded.
                </p>
              )}
            </div>
            <form action={uploadEquipmentPhotos} className="mt-5 border-t border-[var(--border)] pt-5">
              <input name="equipmentId" type="hidden" value={equipment.id} />
              <label className="space-y-2">
                <span className="text-sm font-medium text-[var(--ink)]">Add Photos</span>
                <input accept="image/*,.heic,.heif" className={inputClass} multiple name="photos" type="file" />
              </label>
              <button className={`${primaryButtonClass} mt-3`} type="submit">
                <Camera className="h-4 w-4" aria-hidden="true" />
                Upload Photos
              </button>
            </form>
          </aside>
        </section>
      ) : null}

      {activeTab === "service" ? (
        <div className="mt-5 grid gap-5 xl:grid-cols-[360px_1fr]">
          <form action={createEquipmentScheduledService} className={`${panelClass} h-fit`}>
            <input name="equipmentId" type="hidden" value={equipment.id} />
            <h2 className="text-lg font-semibold text-[var(--ink)]">Add Service</h2>
            <div className="mt-4 grid gap-4">
              <label className="space-y-2">
                <span className="text-sm font-medium text-[var(--ink)]">Title</span>
                <input className={inputClass} name="title" placeholder="Oil change" required />
              </label>
              <label className="space-y-2">
                <span className="text-sm font-medium text-[var(--ink)]">Service type</span>
                <select className={inputClass} defaultValue="scheduled_maintenance" name="serviceType">
                  {equipmentServiceTypeOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              {tracksByMeter ? (
                <label className="space-y-2">
                  <span className="text-sm font-medium text-[var(--ink)]">Interval mode</span>
                  <select className={inputClass} defaultValue="by_meter" name="intervalMode">
                    {equipmentIntervalModeOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <>
                  <input name="intervalMode" type="hidden" value="by_date" />
                  <p className="rounded-md border border-dashed border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2 text-xs text-[var(--ink-muted)]">
                    This unit has no meter, so service is tracked by date.
                  </p>
                </>
              )}
              {tracksByMeter ? (
                <>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="space-y-2">
                      <span className="text-sm font-medium text-[var(--ink)]">
                        Service due every ({equipment.tracking_mode === "hours" ? "hrs" : "km"})
                      </span>
                      <input className={inputClass} min="1" name="intervalMeter" placeholder="e.g. 5000" step="0.1" type="number" />
                      <span className="block text-xs text-[var(--ink-muted)]">Distance between services. The next due reading is set from the current meter.</span>
                    </label>
                    <label className="space-y-2">
                      <span className="text-sm font-medium text-[var(--ink)]">Up to (optional)</span>
                      <input className={inputClass} min="1" name="intervalMeterMax" placeholder="e.g. 7500" step="0.1" type="number" />
                      <span className="block text-xs text-[var(--ink-muted)]">For a range, e.g. every 5,000 to 7,500.</span>
                    </label>
                  </div>
                  <label className="space-y-2">
                    <span className="text-sm font-medium text-[var(--ink)]">Warn before ({equipment.tracking_mode === "hours" ? "hrs" : "km"})</span>
                    <input className={inputClass} min="0" name="meterLead" placeholder="e.g. 1000" step="0.1" type="number" />
                    <span className="block text-xs text-[var(--ink-muted)]">How far ahead of due to start warning. This is not the interval.</span>
                  </label>
                  <details className="rounded-md border border-[var(--border)] bg-[var(--surface-muted)] p-3">
                    <summary className="cursor-pointer text-sm font-medium text-[var(--ink)]">Advanced options</summary>
                    <div className="mt-3 grid gap-4">
                      <div className="grid gap-4 sm:grid-cols-2">
                        <label className="space-y-2">
                          <span className="text-sm font-medium text-[var(--ink)]">Good from (optional)</span>
                          <input className={inputClass} name="dueFromDate" type="date" />
                        </label>
                        <label className="space-y-2">
                          <span className="text-sm font-medium text-[var(--ink)]">Due by (optional)</span>
                          <input className={inputClass} name="dueDate" type="date" />
                        </label>
                      </div>
                      <label className="space-y-2">
                        <span className="text-sm font-medium text-[var(--ink)]">Warn before (days)</span>
                        <input className={inputClass} min="0" name="dateLeadDays" placeholder="e.g. 14" type="number" />
                      </label>
                      <p className="text-xs text-[var(--ink-muted)]">Or set an exact odometer target instead of an interval:</p>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <label className="space-y-2">
                          <span className="text-sm font-medium text-[var(--ink)]">Due meter</span>
                          <input className={inputClass} min="0" name="dueMeter" step="0.1" type="number" />
                        </label>
                        <label className="space-y-2">
                          <span className="text-sm font-medium text-[var(--ink)]">Due from meter</span>
                          <input className={inputClass} min="0" name="windowStartMeter" step="0.1" type="number" />
                        </label>
                      </div>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <label className="space-y-2">
                          <span className="text-sm font-medium text-[var(--ink)]">Warn at meter</span>
                          <input className={inputClass} min="0" name="warnMeter" step="0.1" type="number" />
                        </label>
                        <label className="space-y-2">
                          <span className="text-sm font-medium text-[var(--ink)]">Repeat override</span>
                          <input className={inputClass} min="1" name="recurrenceValue" placeholder="Auto from interval" type="number" />
                        </label>
                      </div>
                      <label className="space-y-2">
                        <span className="text-sm font-medium text-[var(--ink)]">Repeat unit override</span>
                        <select className={inputClass} defaultValue="" name="recurrenceUnit">
                          <option value="">Auto (repeat on the interval)</option>
                          <option value="meter">Meter</option>
                          <option value="days">Days</option>
                          <option value="months">Months</option>
                        </select>
                      </label>
                    </div>
                  </details>
                </>
              ) : (
                <>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="space-y-2">
                      <span className="text-sm font-medium text-[var(--ink)]">Good from (optional)</span>
                      <input className={inputClass} name="dueFromDate" type="date" />
                      <span className="block text-xs text-[var(--ink-muted)]">Start of the acceptable window.</span>
                    </label>
                    <label className="space-y-2">
                      <span className="text-sm font-medium text-[var(--ink)]">Due by</span>
                      <input className={inputClass} name="dueDate" type="date" />
                      <span className="block text-xs text-[var(--ink-muted)]">Overdue only after this date.</span>
                    </label>
                  </div>
                  <label className="space-y-2">
                    <span className="text-sm font-medium text-[var(--ink)]">Warn before (days)</span>
                    <input className={inputClass} min="0" name="dateLeadDays" placeholder="e.g. 14" type="number" />
                    <span className="block text-xs text-[var(--ink-muted)]">Used when there is no good-from date.</span>
                  </label>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="space-y-2">
                      <span className="text-sm font-medium text-[var(--ink)]">Repeat every (optional)</span>
                      <input className={inputClass} min="1" name="recurrenceValue" type="number" />
                    </label>
                    <label className="space-y-2">
                      <span className="text-sm font-medium text-[var(--ink)]">Repeat unit</span>
                      <select className={inputClass} defaultValue="" name="recurrenceUnit">
                        <option value="">No repeat</option>
                        <option value="days">Days</option>
                        <option value="months">Months</option>
                      </select>
                    </label>
                  </div>
                </>
              )}
            </div>
            <button className={`${primaryButtonClass} mt-4`} type="submit">
              <Save className="h-4 w-4" aria-hidden="true" />
              Add Service
            </button>
          </form>

          <section className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-sm">
            {(scheduledServices ?? []).length > 0 ? (
              <div className="divide-y divide-[var(--border)]">
                {(scheduledServices ?? []).map((service) => {
                  const status = getEquipmentScheduleStatus(
                    {
                      dueDate: service.due_date,
                      dueMeter: service.due_meter,
                      windowStartMeter: service.window_start_meter,
                      warnMeter: service.warn_meter,
                      dateLeadDays: service.date_lead_days,
                      meterLead: service.meter_lead,
                      intervalMode: service.interval_mode,
                      isActive: service.is_active,
                    },
                    equipment.current_meter,
                  );
                  const meterWindowLabel =
                    service.window_start_meter !== null || service.warn_meter !== null
                      ? [
                          service.window_start_meter !== null
                            ? `due from ${formatEquipmentMeter({ trackingMode: equipment.tracking_mode, value: service.window_start_meter })}`
                            : null,
                          service.warn_meter !== null
                            ? `warn ${formatEquipmentMeter({ trackingMode: equipment.tracking_mode, value: service.warn_meter })}`
                            : null,
                        ]
                          .filter(Boolean)
                          .join(", ")
                      : null;

                  return (
                    <div className="grid gap-4 px-4 py-4" key={service.id}>
                      <div className="grid gap-3 lg:grid-cols-[1fr_140px_140px_130px] lg:items-center">
                        <div>
                          <p className="font-semibold text-[var(--ink)]">{service.title}</p>
                          <p className="mt-1 text-sm text-[var(--ink-muted)]">{service.service_type.replaceAll("_", " ")}</p>
                        </div>
                        <p className="inline-flex items-center gap-2 text-sm text-[var(--ink-muted)]">
                          <CalendarDays className="h-4 w-4 text-[var(--primary)]" aria-hidden="true" />
                          {formatDate(service.due_date)}
                        </p>
                        <p className="text-sm text-[var(--ink-muted)]">
                          <span className="inline-flex items-center gap-2">
                            <Gauge className="h-4 w-4 text-[var(--primary)]" aria-hidden="true" />
                            {service.due_meter === null ? "No meter due" : formatEquipmentMeter({ trackingMode: equipment.tracking_mode, value: service.due_meter })}
                          </span>
                          {meterWindowLabel ? (
                            <span className="mt-1 block text-xs text-[var(--ink-muted)]">{meterWindowLabel}</span>
                          ) : null}
                        </p>
                        <span className={`inline-flex w-fit rounded-full border px-2.5 py-1 text-xs font-semibold ${equipmentDueStatusClass(status)}`}>
                          {dueDetail(status)}
                        </span>
                      </div>
                      {service.is_active ? (
                        <form action={completeEquipmentScheduledService} className="grid gap-3 rounded-md bg-[var(--surface-muted)] p-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                          <input name="equipmentId" type="hidden" value={equipment.id} />
                          <input name="serviceId" type="hidden" value={service.id} />
                          <label className="space-y-2">
                            <span className="text-sm font-medium text-[var(--ink)]">Completed date</span>
                            <input className={inputClass} name="completedAt" type="date" />
                          </label>
                          <label className="space-y-2">
                            <span className="text-sm font-medium text-[var(--ink)]">Completed meter</span>
                            <input className={inputClass} min="0" name="completedMeter" step="0.1" type="number" />
                          </label>
                          <button className={primaryButtonClass} type="submit">
                            Complete
                          </button>
                        </form>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : (
              <EmptyState icon={<CalendarDays className="h-8 w-8" aria-hidden="true" />} title="No scheduled service" />
            )}
          </section>
        </div>
      ) : null}

      {activeTab === "maintenance" ? (
        <div className="mt-5 grid gap-5 xl:grid-cols-[360px_1fr]">
          <form action={createEquipmentMaintenanceLog} className={`${panelClass} h-fit`}>
            <input name="equipmentId" type="hidden" value={equipment.id} />
            <h2 className="text-lg font-semibold text-[var(--ink)]">Log Maintenance</h2>
            <div className="mt-4 grid gap-4">
              <label className="space-y-2">
                <span className="text-sm font-medium text-[var(--ink)]">Title</span>
                <input className={inputClass} name="title" placeholder="Replaced brake pads" required />
              </label>
              <label className="space-y-2">
                <span className="text-sm font-medium text-[var(--ink)]">Type</span>
                <select className={inputClass} defaultValue="repair" name="type">
                  {equipmentMaintenanceTypeOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="space-y-2">
                  <span className="text-sm font-medium text-[var(--ink)]">Performed date</span>
                  <input className={inputClass} name="performedAt" type="date" />
                </label>
                <label className="space-y-2">
                  <span className="text-sm font-medium text-[var(--ink)]">Meter at service</span>
                  <input className={inputClass} min="0" name="meterAtService" step="0.1" type="number" />
                </label>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="space-y-2">
                  <span className="text-sm font-medium text-[var(--ink)]">Cost</span>
                  <input className={inputClass} min="0" name="cost" step="0.01" type="number" />
                </label>
                <label className="space-y-2">
                  <span className="text-sm font-medium text-[var(--ink)]">Vendor</span>
                  <input className={inputClass} name="vendor" />
                </label>
              </div>
              <label className="space-y-2">
                <span className="text-sm font-medium text-[var(--ink)]">Description</span>
                <textarea className={textareaClass} name="description" />
              </label>
              <label className="space-y-2">
                <span className="text-sm font-medium text-[var(--ink)]">Receipts or photos</span>
                <input
                  accept="application/pdf,image/*"
                  className={inputClass}
                  multiple
                  name="attachments"
                  type="file"
                />
                <span className="block text-xs text-[var(--ink-muted)]">Upload invoices, receipts, or repair photos.</span>
              </label>
            </div>
            <button className={`${primaryButtonClass} mt-4`} type="submit">
              <Save className="h-4 w-4" aria-hidden="true" />
              Log Maintenance
            </button>
          </form>

          <section className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-sm">
            {(maintenance ?? []).length > 0 ? (
              <div className="divide-y divide-[var(--border)]">
                {(maintenance ?? []).map((entry) => (
                  <div className="grid gap-3 px-4 py-4 lg:grid-cols-[1fr_130px_130px_130px] lg:items-center" key={entry.id}>
                    <div>
                      <p className="font-semibold text-[var(--ink)]">{entry.title}</p>
                      <p className="mt-1 text-sm text-[var(--ink-muted)]">{entry.description || entry.type.replaceAll("_", " ")}</p>
                      {entry.attachment_ids.length > 0 ? (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {entry.attachment_ids.map((path, index) => {
                            const url = signedPathUrl(signedUrls, path);

                            return url ? (
                              <a
                                className="inline-flex items-center gap-1 rounded-md border border-[var(--border)] bg-white px-2 py-1 text-xs font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)]"
                                href={url}
                                key={path}
                                rel="noreferrer"
                                target="_blank"
                              >
                                <Paperclip className="h-3.5 w-3.5 text-[var(--primary)]" aria-hidden="true" />
                                {attachmentLabel(path, index)}
                              </a>
                            ) : (
                              <span
                                className="inline-flex items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--surface-muted)] px-2 py-1 text-xs font-semibold text-[var(--ink-muted)]"
                                key={path}
                              >
                                <Paperclip className="h-3.5 w-3.5" aria-hidden="true" />
                                {attachmentLabel(path, index)}
                              </span>
                            );
                          })}
                        </div>
                      ) : null}
                    </div>
                    <p className="text-sm text-[var(--ink-muted)]">{formatDate(entry.performed_at)}</p>
                    <p className="text-sm text-[var(--ink-muted)]">
                      {formatEquipmentMeter({ trackingMode: equipment.tracking_mode, value: entry.meter_at_service })}
                    </p>
                    <p className="text-sm text-[var(--ink-muted)]">{formatCurrency(entry.cost)}</p>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState icon={<Wrench className="h-8 w-8" aria-hidden="true" />} title="No maintenance history" />
            )}
          </section>
        </div>
      ) : null}

      {activeTab === "meter" ? (
        <div className="mt-5 grid gap-5 xl:grid-cols-[360px_1fr]">
          <form action={createEquipmentMeterReading} className={`${panelClass} h-fit`}>
            <input name="equipmentId" type="hidden" value={equipment.id} />
            <h2 className="text-lg font-semibold text-[var(--ink)]">Log Meter</h2>
            <div className="mt-4 grid gap-4">
              <label className="space-y-2">
                <span className="text-sm font-medium text-[var(--ink)]">Reading</span>
                <input className={inputClass} min="0" name="value" required step="0.1" type="number" />
              </label>
              <label className="space-y-2">
                <span className="text-sm font-medium text-[var(--ink)]">Recorded at</span>
                <input className={inputClass} name="recordedAt" type="datetime-local" />
              </label>
            </div>
            <button className={`${primaryButtonClass} mt-4`} type="submit">
              <Save className="h-4 w-4" aria-hidden="true" />
              Log Meter
            </button>
          </form>

          <section className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-sm">
            {(meterRows ?? []).length > 0 ? (
              <div className="divide-y divide-[var(--border)]">
                {(meterRows ?? []).map((reading) => (
                  <div className="grid gap-3 px-4 py-4 lg:grid-cols-[1fr_150px_150px] lg:items-center" key={reading.id}>
                    <p className="inline-flex items-center gap-2 font-semibold text-[var(--ink)]">
                      <Gauge className="h-4 w-4 text-[var(--primary)]" aria-hidden="true" />
                      {formatEquipmentMeter({ trackingMode: equipment.tracking_mode, value: reading.value })}
                    </p>
                    <p className="text-sm text-[var(--ink-muted)]">{sourceLabel(reading.source)}</p>
                    <p className="text-sm text-[var(--ink-muted)]">{formatDateTime(reading.recorded_at)}</p>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState icon={<Gauge className="h-8 w-8" aria-hidden="true" />} title="No meter readings" />
            )}
          </section>
        </div>
      ) : null}

      {activeTab === "documents" ? (
        <div className="mt-5 grid gap-5 xl:grid-cols-[360px_1fr]">
          {compliance.applicable ? (
            <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm xl:col-span-2">
              <h3 className="text-sm font-semibold text-[var(--ink)]">Required for this commercial unit</h3>
              <ul className="mt-3 grid gap-2 sm:grid-cols-3">
                {compliance.required.map((item) => (
                  <li className="flex items-center gap-2 text-sm" key={item.key}>
                    {item.met ? (
                      <CheckCircle2 className="h-4 w-4 text-[var(--success)]" aria-hidden="true" />
                    ) : (
                      <AlertTriangle className="h-4 w-4 text-[var(--danger)]" aria-hidden="true" />
                    )}
                    <span className={item.met ? "text-[var(--ink)]" : "font-semibold text-[var(--danger)]"}>
                      {item.label}
                      {item.reason === "expired" ? " (expired)" : item.met ? "" : " (missing)"}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <form action={createEquipmentDocument} className={`${panelClass} h-fit`}>
            <input name="equipmentId" type="hidden" value={equipment.id} />
            <h2 className="text-lg font-semibold text-[var(--ink)]">Add Document</h2>
            <div className="mt-4 grid gap-4">
              <label className="space-y-2">
                <span className="text-sm font-medium text-[var(--ink)]">Title</span>
                <input className={inputClass} name="title" placeholder="Registration" required />
              </label>
              <label className="space-y-2">
                <span className="text-sm font-medium text-[var(--ink)]">Document type</span>
                <select className={inputClass} defaultValue="registration" name="docType">
                  {equipmentDocumentTypeOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="space-y-2">
                  <span className="text-sm font-medium text-[var(--ink)]">Issued date</span>
                  <input className={inputClass} name="issuedDate" type="date" />
                </label>
                <label className="space-y-2">
                  <span className="text-sm font-medium text-[var(--ink)]">Expiry date</span>
                  <input className={inputClass} name="expiryDate" required type="date" />
                </label>
              </div>
              <label className="space-y-2">
                <span className="text-sm font-medium text-[var(--ink)]">Reminder lead days</span>
                <input className={inputClass} defaultValue={30} min="0" name="reminderLeadDays" type="number" />
              </label>
              <label className="space-y-2">
                <span className="text-sm font-medium text-[var(--ink)]">Scans or photos</span>
                <input
                  accept="application/pdf,image/*"
                  className={inputClass}
                  multiple
                  name="attachments"
                  type="file"
                />
                <span className="block text-xs text-[var(--ink-muted)]">Upload registrations, insurance slips, permits, or certificates.</span>
              </label>
            </div>
            <button className={`${primaryButtonClass} mt-4`} type="submit">
              <Save className="h-4 w-4" aria-hidden="true" />
              Add Document
            </button>
          </form>

          <section className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-sm">
            {(documents ?? []).length > 0 ? (
              <div className="divide-y divide-[var(--border)]">
                {(documents ?? []).map((document) => {
                  const status = getEquipmentDocumentStatus({
                    expiryDate: document.expiry_date,
                    isActive: document.is_active,
                    reminderLeadDays: document.reminder_lead_days,
                  });

                  return (
                    <div className="grid gap-3 px-4 py-4 lg:grid-cols-[1fr_140px_130px_120px] lg:items-center" key={document.id}>
                      <div>
                        <p className="font-semibold text-[var(--ink)]">{document.title}</p>
                        <p className="mt-1 text-sm text-[var(--ink-muted)]">{document.doc_type.replaceAll("_", " ")}</p>
                      </div>
                      <p className="text-sm text-[var(--ink-muted)]">{formatDate(document.expiry_date)}</p>
                      <span className={`inline-flex w-fit rounded-full border px-2.5 py-1 text-xs font-semibold ${equipmentDueStatusClass(status)}`}>
                        {dueDetail(status)}
                      </span>
                      <div className="flex flex-wrap gap-2">
                        {document.attachment_ids.length > 0 ? (
                          document.attachment_ids.map((path, index) => {
                            const url = signedPathUrl(signedUrls, path);

                            return url ? (
                              <a
                                className="inline-flex items-center gap-1 rounded-md border border-[var(--border)] bg-white px-2 py-1 text-xs font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)]"
                                href={url}
                                key={path}
                                rel="noreferrer"
                                target="_blank"
                              >
                                <Paperclip className="h-3.5 w-3.5 text-[var(--primary)]" aria-hidden="true" />
                                {attachmentLabel(path, index)}
                              </a>
                            ) : (
                              <span
                                className="inline-flex items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--surface-muted)] px-2 py-1 text-xs font-semibold text-[var(--ink-muted)]"
                                key={path}
                              >
                                <Paperclip className="h-3.5 w-3.5" aria-hidden="true" />
                                {attachmentLabel(path, index)}
                              </span>
                            );
                          })
                        ) : (
                          <span className="text-sm text-[var(--ink-muted)]">No scan</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <EmptyState icon={<FileText className="h-8 w-8" aria-hidden="true" />} title="No equipment documents" />
            )}
          </section>
        </div>
      ) : null}

      {activeTab === "forms" ? (
        <div className="mt-5 grid gap-5 xl:grid-cols-[360px_1fr]">
          <form action={createManualEquipmentSubmissionLink} className={`${panelClass} h-fit`}>
            <input name="equipmentId" type="hidden" value={equipment.id} />
            <h2 className="text-lg font-semibold text-[var(--ink)]">Attach Submitted Form</h2>
            <div className="mt-4 grid gap-4">
              <label className="space-y-2">
                <span className="text-sm font-medium text-[var(--ink)]">Submitted form</span>
                <select className={inputClass} disabled={linkableSubmissions.length === 0} name="submissionId" required>
                  <option value="">{linkableSubmissions.length === 0 ? "No unlinked submissions" : "Choose a submission"}</option>
                  {linkableSubmissions.map((submission) => {
                    const form = formById.get(submission.form_id);
                    const submitter = submission.submitted_by ? submitterById.get(submission.submitted_by) : undefined;

                    return (
                      <option key={submission.id} value={submission.id}>
                        {(form?.name ?? form?.code ?? "Submitted form") +
                          " - " +
                          formatDateTime(submission.submitted_at ?? submission.created_at) +
                          " - " +
                          (submitter?.full_name ?? "Unknown submitter")}
                      </option>
                    );
                  })}
                </select>
              </label>
            </div>
            <button
              className={`${primaryButtonClass} mt-4 disabled:cursor-not-allowed disabled:bg-[var(--ink-muted)]`}
              disabled={linkableSubmissions.length === 0}
              type="submit"
            >
              <Link2 className="h-4 w-4" aria-hidden="true" />
              Attach Form
            </button>
          </form>

          <section className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-sm">
            {(linkedSubmissions ?? []).length > 0 ? (
              <div className="divide-y divide-[var(--border)]">
                {(linkedSubmissions ?? []).map((link) => {
                  const submission = submissionById.get(link.submission_id);
                  const form = submission ? formById.get(submission.form_id) : undefined;
                  const submitter = submission?.submitted_by ? submitterById.get(submission.submitted_by) : undefined;

                  return (
                    <div className="grid gap-3 px-4 py-4 xl:grid-cols-[1fr_150px_150px_110px_110px_96px] xl:items-center" key={link.id}>
                      <div>
                        <p className="font-semibold text-[var(--ink)]">{form?.name ?? link.form_type ?? "Linked form"}</p>
                        <p className="mt-1 text-sm text-[var(--ink-muted)]">{form?.code ?? link.form_type ?? "No form code"}</p>
                      </div>
                      <p className="inline-flex items-center gap-2 text-sm text-[var(--ink-muted)]">
                        <UserRound className="h-4 w-4 text-[var(--primary)]" aria-hidden="true" />
                        {submitter?.full_name ?? "Unknown submitter"}
                      </p>
                      <p className="text-sm text-[var(--ink-muted)]">{formatDateTime(submission?.submitted_at ?? submission?.created_at)}</p>
                      <span className="inline-flex w-fit rounded-full border border-[var(--border)] bg-[var(--surface-muted)] px-2.5 py-1 text-xs font-semibold text-[var(--ink-muted)]">
                        {link.link_source === "auto" ? "Auto" : "Manual"}
                      </span>
                      {submission ? (
                        <Link
                          className="inline-flex h-9 w-fit items-center justify-center gap-2 rounded-md border border-[var(--border)] bg-white px-3 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)]"
                          href={`/admin/monitor/${submission.id}/print`}
                        >
                          <Printer className="h-4 w-4" aria-hidden="true" />
                          Print
                        </Link>
                      ) : (
                        <span className="text-sm text-[var(--ink-muted)]">Missing submission</span>
                      )}
                      <form action={deleteEquipmentSubmissionLink}>
                        <input name="equipmentId" type="hidden" value={equipment.id} />
                        <input name="linkId" type="hidden" value={link.id} />
                        <button
                          className="inline-flex h-9 w-fit items-center justify-center gap-2 rounded-md border border-[var(--border)] bg-white px-3 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)]"
                          type="submit"
                        >
                          <Unlink className="h-4 w-4" aria-hidden="true" />
                          Unlink
                        </button>
                      </form>
                    </div>
                  );
                })}
              </div>
            ) : (
              <EmptyState icon={<ClipboardList className="h-8 w-8" aria-hidden="true" />} title="No linked forms" />
            )}
          </section>
        </div>
      ) : null}
    </AdminShell>
  );
}

function EmptyState({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="px-4 py-12 text-center text-[var(--ink-muted)]">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-md bg-[var(--surface-muted)] text-[var(--primary)]">
        {icon}
      </div>
      <h2 className="mt-3 text-lg font-semibold text-[var(--ink)]">{title}</h2>
    </div>
  );
}
