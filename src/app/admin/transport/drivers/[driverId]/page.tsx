import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AlertTriangle, ArrowLeft, BadgeCheck, Clock, Download, FileText, FileWarning, Link2, Lock, Trash2, Upload } from "lucide-react";
import {
  addDailyTimeRecord,
  addDutyStatusEvent,
  archiveMedicalVaultRecord,
  archiveTransportDocument,
  deleteDutyStatusEvent,
  updateDriverHosCycle,
  updateDriverHosRegime,
  uploadMedicalVaultRecord,
  uploadTransportDocument,
} from "@/app/admin/actions";
import { AdminShell } from "@/app/admin/_components/AdminShell";
import { canUseAdminPanel, canManageMedicalVault, canViewMedicalVault } from "@/lib/access-control";
import { requireAppUser } from "@/lib/current-user";
import {
  AWAITING_PROOF_CLASS,
  AWAITING_PROOF_DESCRIPTION,
  AWAITING_PROOF_LABEL,
  hasAttachedProof,
} from "@/lib/proof-status";
import {
  TRANSPORT_REGISTRIES,
  driverDeficiencies,
  driverProofGaps,
  requirementsForScope,
  type TransportDocumentRecord,
} from "@/lib/transport-registry";
import {
  buildDailyLog,
  computeAvailability,
  computeHosViolations,
  coerceHosRegime,
  DUTY_STATUS_LABELS,
  HOS_REGIME_LABELS,
  HOS_RULESETS,
  type DutyStatusEvent,
} from "@/lib/hos-rules";
import { getHosOcrStatus } from "@/lib/hos-ocr";
import { HosLogScan } from "./_components/HosLogScan";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

export const dynamic = "force-dynamic";

type DriverDetailPageProps = {
  params: Promise<{ driverId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

type DriverRow = Database["public"]["Tables"]["transport_driver"]["Row"];
type DocumentRow = Database["public"]["Tables"]["transport_document"]["Row"];
type DutyEventRow = Database["public"]["Tables"]["transport_duty_status_event"]["Row"];

function formatDateTime(value: string) {
  return value.slice(0, 16).replace("T", " ");
}

const inputClass =
  "h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2";

// The driver detail page renders the driver-scope registries (DQ + HOS).
const DRIVER_REGISTRIES = TRANSPORT_REGISTRIES.filter((registry) => registry.scope === "driver");

const DUTY_STRIP_COLOR: Record<string, string> = {
  off_duty: "bg-[#cbd5e1]",
  sleeper_berth: "bg-[#818cf8]",
  driving: "bg-[var(--primary)]",
  on_duty: "bg-[var(--warning)]",
};

const SAFETY_EVENT_LABELS: Record<string, string> = {
  speeding: "Speeding",
  harsh_brake: "Harsh braking",
  harsh_accel: "Harsh acceleration",
  collision: "Collision",
  other: "Event",
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function formatDate(value: string | null) {
  return value ? value.slice(0, 10) : "Not set";
}

function slotKeyOf(registryKey: string, slotKey: string) {
  return `${registryKey}::${slotKey}`;
}

export default async function TransportDriverDetailPage({ params, searchParams }: DriverDetailPageProps) {
  const { driverId } = await params;
  const search = await searchParams;
  const notice = firstParam(search.notice);
  const error = firstParam(search.error);
  const context = await requireAppUser();

  if (!canUseAdminPanel(context.appUser)) {
    redirect("/choose");
  }

  if (!context.tenant?.transport_enabled) {
    redirect("/admin/setup");
  }

  const supabase = await createSupabaseServerClient();
  const { data: driver } = await supabase
    .from("transport_driver")
    .select("*")
    .eq("id", driverId)
    .eq("tenant_id", context.appUser.tenant_id)
    .is("deleted_at", null)
    .maybeSingle<DriverRow>();

  if (!driver) {
    notFound();
  }

  const { data: documents } = await supabase
    .from("transport_document")
    .select("*")
    .eq("tenant_id", context.appUser.tenant_id)
    .eq("scope", "driver")
    .eq("subject_id", driverId)
    .eq("status", "active")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .returns<DocumentRow[]>();

  const activeDocuments = documents ?? [];

  // Signed URLs for downloads (10-minute expiry, matching the documents module).
  const signedUrlByPath = new Map<string, string>();
  await Promise.all(
    activeDocuments
      .map((document) => document.storage_path)
      .filter((path): path is string => Boolean(path))
      .map(async (path) => {
        const { data } = await supabase.storage.from("tenant-documents").createSignedUrl(path, 10 * 60);
        if (data?.signedUrl) {
          signedUrlByPath.set(path, data.signedUrl);
        }
      }),
  );

  const documentsBySlot = new Map<string, DocumentRow[]>();
  for (const document of activeDocuments) {
    const key = slotKeyOf(document.registry_key, document.slot_key);
    documentsBySlot.set(key, [...(documentsBySlot.get(key) ?? []), document]);
  }

  const records: TransportDocumentRecord[] = activeDocuments.map((document) => ({
    registryKey: document.registry_key,
    slotKey: document.slot_key,
    scope: document.scope,
    subjectId: document.subject_id,
    status: document.status,
    expiryDate: document.expiry_date,
    hasProof: hasAttachedProof(document.attachment_ids),
  }));
  const deficiencies = driverDeficiencies(records);
  const deficiencyBySlot = new Map(
    deficiencies.map((deficiency) => [slotKeyOf(deficiency.registryKey, deficiency.slotKey), deficiency]),
  );
  // Slots that satisfy the requirement on paper and have no document behind them.
  // Not deficiencies, so they never turn a slot red, but the DQ file cannot be
  // handed to an auditor until this set is empty.
  const proofGapSlots = new Set(
    driverProofGaps(records).map((gap) => slotKeyOf(gap.registryKey, gap.slotKey)),
  );

  const driverRequirements = requirementsForScope("driver");

  // Hours of Service: load the driver's duty-status events and compute Alberta
  // NSC availability and violations from them (same engine ELD logs will use).
  const { data: dutyEventRows } = await supabase
    .from("transport_duty_status_event")
    .select("*")
    .eq("tenant_id", context.appUser.tenant_id)
    .eq("driver_id", driverId)
    .order("started_at", { ascending: false })
    .limit(50)
    .returns<DutyEventRow[]>();

  // ELD-reported driver profile (contact, role, status, manager) if synced.
  const { data: eldDriverProfile } = await supabase
    .from("eld_driver_profile")
    .select("provider, email, phone, role, status, manager_name, manager_email")
    .eq("tenant_id", context.appUser.tenant_id)
    .eq("driver_id", driverId)
    .maybeSingle<{
      provider: string;
      email: string | null;
      phone: string | null;
      role: string | null;
      status: string | null;
      manager_name: string | null;
      manager_email: string | null;
    }>();

  // ELD safety: the performance scorecard and recent safety events.
  const [{ data: eldPerformance }, { data: eldSafetyEvents }] = await Promise.all([
    supabase
      .from("eld_driver_performance")
      .select("score, total_events, speeding_count, harsh_brake_count, harsh_accel_count, distance, drive_time_minutes, period_start, period_end")
      .eq("tenant_id", context.appUser.tenant_id)
      .eq("driver_id", driverId)
      .maybeSingle<{
        score: number | null;
        total_events: number | null;
        speeding_count: number | null;
        harsh_brake_count: number | null;
        harsh_accel_count: number | null;
        distance: number | null;
        drive_time_minutes: number | null;
        period_start: string | null;
        period_end: string | null;
      }>(),
    supabase
      .from("eld_driver_event")
      .select("id, event_type, occurred_at, severity, value, description, location")
      .eq("tenant_id", context.appUser.tenant_id)
      .eq("driver_id", driverId)
      .order("occurred_at", { ascending: false })
      .limit(20)
      .returns<
        { id: string; event_type: "speeding" | "harsh_brake" | "harsh_accel" | "collision" | "other"; occurred_at: string; severity: string | null; value: number | null; description: string | null; location: string | null }[]
      >(),
  ]);
  const safetyEvents = eldSafetyEvents ?? [];

  const dutyEvents = dutyEventRows ?? [];
  const hosEvents: DutyStatusEvent[] = dutyEvents.map((event) => ({
    status: event.status,
    startedAt: event.started_at,
  }));
  const hosCycle = driver.hos_cycle;
  const hosRegime = coerceHosRegime(driver.hos_regime);
  const hosRuleset = HOS_RULESETS[hosRegime];
  const availability = computeAvailability({ events: hosEvents, cycle: hosCycle, regime: hosRegime });
  const hosViolations = computeHosViolations({ events: hosEvents, cycle: hosCycle, regime: hosRegime });
  const { data: companySettings } = await supabase
    .from("company_settings")
    .select("timezone")
    .eq("tenant_id", context.appUser.tenant_id)
    .maybeSingle<{ timezone: string | null }>();
  const tenantTimezone = companySettings?.timezone ?? undefined;
  const dailyLog = buildDailyLog(hosEvents, undefined, tenantTimezone).slice(0, 8);
  const hosOcrReady = getHosOcrStatus().ready;

  const hosClocks = [
    { label: "Drive left", value: availability.driveRemainingHours, of: hosRuleset.drivingHours },
    { label: "On-duty left", value: availability.onDutyRemainingHours, of: hosRuleset.onDutyHours },
    ...(availability.windowRemainingHours !== null
      ? [{ label: "Window left", value: availability.windowRemainingHours, of: hosRuleset.elapsedWindowHours ?? 0 }]
      : []),
    ...(availability.cycleRemainingHours !== null
      ? [{ label: "Cycle left", value: availability.cycleRemainingHours, of: hosCycle === "cycle_2" ? 120 : 70 }]
      : []),
  ];

  // Restricted medical / injury vault. Visible only to vault managers and the
  // affected worker; the database also enforces this via RLS.
  const capabilities = context.permissionProfile?.capabilities;
  const canViewVault = canViewMedicalVault({
    profile: context.appUser,
    capabilities,
    userId: context.appUser.id,
    driverUserId: driver.user_id,
  });
  const canManageVault = canManageMedicalVault(context.appUser, capabilities);

  type MedicalRecordRow = Database["public"]["Tables"]["transport_medical_record"]["Row"];
  let medicalRecords: MedicalRecordRow[] = [];
  const medicalSignedUrlByPath = new Map<string, string>();

  if (canViewVault) {
    const { data: vaultRecords } = await supabase
      .from("transport_medical_record")
      .select("*")
      .eq("tenant_id", context.appUser.tenant_id)
      .eq("driver_id", driverId)
      .eq("status", "active")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .returns<MedicalRecordRow[]>();

    medicalRecords = vaultRecords ?? [];
    await Promise.all(
      medicalRecords
        .map((record) => record.storage_path)
        .filter((path): path is string => Boolean(path))
        .map(async (path) => {
          const { data } = await supabase.storage.from("medical-vault").createSignedUrl(path, 10 * 60);
          if (data?.signedUrl) {
            medicalSignedUrlByPath.set(path, data.signedUrl);
          }
        }),
    );
  }

  return (
    <AdminShell eyebrow="Driver qualification" tenantName={context.tenant?.name ?? "Company profile"} title={driver.full_name}>
      <Link
        className="inline-flex items-center gap-1 text-sm font-semibold text-[var(--primary)] hover:underline"
        href="/admin/transport/drivers"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Drivers
      </Link>

      {notice ? (
        <p className="mt-4 rounded-md border border-[var(--success)] bg-emerald-50 p-3 text-sm text-[var(--success)]">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className="mt-4 rounded-md border border-[var(--danger)] bg-red-50 p-3 text-sm text-[var(--danger)]">
          {error}
        </p>
      ) : null}

      <section className="mt-4 grid gap-4 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm lg:grid-cols-[1fr_200px]">
        <div className="grid gap-2 text-sm text-[var(--ink-muted)] sm:grid-cols-2">
          <p>License number: <span className="font-semibold text-[var(--ink)]">{driver.license_number ?? "Not set"}</span></p>
          <p>License class: <span className="font-semibold text-[var(--ink)]">{driver.license_class ?? "Not set"}</span></p>
          <p>License expiry: <span className="font-semibold text-[var(--ink)]">{formatDate(driver.license_expiry)}</span></p>
          <p>Hired on: <span className="font-semibold text-[var(--ink)]">{formatDate(driver.hired_on)}</span></p>
        </div>
        <div className="flex flex-col items-center justify-center gap-2 rounded-md bg-[var(--surface-muted)] p-4">
          {deficiencies.length === 0 ? (
            <span className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--success)]">
              <BadgeCheck className="h-5 w-5" aria-hidden="true" />
              File complete
            </span>
          ) : (
            <span className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--danger)]">
              <AlertTriangle className="h-5 w-5" aria-hidden="true" />
              {deficiencies.length} deficienc{deficiencies.length === 1 ? "y" : "ies"}
            </span>
          )}
          {eldDriverProfile ? (
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--primary)]">
              <Link2 className="h-4 w-4" aria-hidden="true" />
              ELD linked ({eldDriverProfile.provider === "motive" ? "Motive" : eldDriverProfile.provider})
            </span>
          ) : null}
        </div>
      </section>

      {eldDriverProfile &&
      (eldDriverProfile.email ||
        eldDriverProfile.phone ||
        eldDriverProfile.role ||
        eldDriverProfile.status ||
        eldDriverProfile.manager_name) ? (
        <section className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
          <h2 className="flex items-center gap-2 text-base font-semibold text-[var(--ink)]">
            <Link2 className="h-4 w-4 text-[var(--primary)]" aria-hidden="true" />
            ELD driver details
          </h2>
          <div className="mt-3 grid gap-2 text-sm text-[var(--ink-muted)] sm:grid-cols-2">
            <p>Email: <span className="font-semibold text-[var(--ink)]">{eldDriverProfile.email ?? "Not reported"}</span></p>
            <p>Phone: <span className="font-semibold text-[var(--ink)]">{eldDriverProfile.phone ?? "Not reported"}</span></p>
            <p>Role: <span className="font-semibold text-[var(--ink)]">{eldDriverProfile.role ?? "Not reported"}</span></p>
            <p>ELD status: <span className="font-semibold text-[var(--ink)]">{eldDriverProfile.status ?? "Not reported"}</span></p>
            <p>
              Manager:{" "}
              <span className="font-semibold text-[var(--ink)]">
                {eldDriverProfile.manager_name ?? "Not reported"}
                {eldDriverProfile.manager_email ? ` (${eldDriverProfile.manager_email})` : ""}
              </span>
            </p>
          </div>
        </section>
      ) : null}

      {eldPerformance || safetyEvents.length > 0 ? (
        <section className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
          <h2 className="flex items-center gap-2 text-base font-semibold text-[var(--ink)]">
            <AlertTriangle className="h-4 w-4 text-[var(--warning)]" aria-hidden="true" />
            ELD safety
          </h2>
          {eldPerformance ? (
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <div className="rounded-md bg-[var(--surface-muted)] p-3">
                <p className="text-xs text-[var(--ink-muted)]">Safety score</p>
                <p className="mt-1 text-lg font-bold text-[var(--ink)]">
                  {eldPerformance.score ?? "Not scored"}
                </p>
              </div>
              <div className="rounded-md bg-[var(--surface-muted)] p-3">
                <p className="text-xs text-[var(--ink-muted)]">Speeding events</p>
                <p className="mt-1 text-lg font-bold text-[var(--ink)]">{eldPerformance.speeding_count ?? 0}</p>
              </div>
              <div className="rounded-md bg-[var(--surface-muted)] p-3">
                <p className="text-xs text-[var(--ink-muted)]">Harsh events</p>
                <p className="mt-1 text-lg font-bold text-[var(--ink)]">
                  {(eldPerformance.harsh_brake_count ?? 0) + (eldPerformance.harsh_accel_count ?? 0)}
                </p>
              </div>
            </div>
          ) : null}
          {safetyEvents.length > 0 ? (
            <ul className="mt-4 divide-y divide-[var(--border)] rounded-md border border-[var(--border)]">
              {safetyEvents.slice(0, 8).map((event) => (
                <li className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm" key={event.id}>
                  <span className="text-[var(--ink)]">
                    {SAFETY_EVENT_LABELS[event.event_type] ?? "Event"}
                    {event.value != null ? ` (${event.value})` : ""}
                    {event.severity ? `, ${event.severity}` : ""}
                    {event.description ? `, ${event.description}` : ""}
                  </span>
                  <span className="text-[var(--ink-muted)]">{formatDate(event.occurred_at)}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      {DRIVER_REGISTRIES.map((registry) => {
        const slots = driverRequirements.filter((requirement) => requirement.registryKey === registry.key);

        return (
          <section
            className="mt-5 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-sm"
            key={registry.key}
          >
            <div className="border-b border-[var(--border)] bg-[var(--surface-muted)] px-4 py-3">
              <h2 className="text-base font-semibold text-[var(--ink)]">{registry.label}</h2>
              <p className="mt-1 text-sm text-[var(--ink-muted)]">{registry.description}</p>
            </div>

            <div className="divide-y divide-[var(--border)]">
              {slots.map((requirement) => {
                const key = slotKeyOf(requirement.registryKey, requirement.slotKey);
                const filed = documentsBySlot.get(key) ?? [];
                const deficiency = deficiencyBySlot.get(key);
                const ok = !deficiency && (filed.length > 0 || !requirement.required);

                return (
                  <div className="grid gap-3 px-4 py-4" key={key}>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold text-[var(--ink)]">
                          {requirement.label}
                          {requirement.required ? null : (
                            <span className="ml-2 text-xs font-normal text-[var(--ink-muted)]">(optional)</span>
                          )}
                        </p>
                        {requirement.description ? (
                          <p className="mt-1 text-xs text-[var(--ink-muted)]">{requirement.description}</p>
                        ) : null}
                      </div>
                      {deficiency ? (
                        <span className="inline-flex w-fit items-center gap-1 rounded-full border border-[var(--danger)] bg-red-50 px-2.5 py-1 text-xs font-semibold text-[var(--danger)]">
                          <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                          {deficiency.reason === "expired" ? "Expired" : "Missing"}
                        </span>
                      ) : proofGapSlots.has(key) ? (
                        <span
                          className={`inline-flex w-fit items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold ${AWAITING_PROOF_CLASS}`}
                          title={AWAITING_PROOF_DESCRIPTION}
                        >
                          <FileWarning className="h-4 w-4" aria-hidden="true" />
                          {AWAITING_PROOF_LABEL}
                        </span>
                      ) : ok && filed.length > 0 ? (
                        <span className="inline-flex w-fit items-center gap-1 rounded-full border border-[var(--success)] bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-[var(--success)]">
                          <BadgeCheck className="h-4 w-4" aria-hidden="true" />
                          On file
                        </span>
                      ) : null}
                    </div>

                    {filed.length > 0 ? (
                      <ul className="grid gap-2">
                        {filed.map((document) => {
                          const signedUrl = document.storage_path ? signedUrlByPath.get(document.storage_path) : null;
                          return (
                            <li
                              className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-[var(--surface-muted)] px-3 py-2"
                              key={document.id}
                            >
                              <span className="inline-flex items-center gap-2 text-sm text-[var(--ink)]">
                                <FileText className="h-4 w-4 text-[var(--primary)]" aria-hidden="true" />
                                {document.title}
                                <span className="text-xs text-[var(--ink-muted)]">
                                  {document.expiry_date ? `expires ${formatDate(document.expiry_date)}` : "no expiry"}
                                </span>
                              </span>
                              <span className="flex items-center gap-3">
                                {signedUrl ? (
                                  <a
                                    className="inline-flex items-center gap-1 text-sm font-semibold text-[var(--primary)] hover:underline"
                                    href={signedUrl}
                                    rel="noreferrer"
                                    target="_blank"
                                  >
                                    <Download className="h-4 w-4" aria-hidden="true" />
                                    Open
                                  </a>
                                ) : null}
                                <form action={archiveTransportDocument}>
                                  <input name="documentId" type="hidden" value={document.id} />
                                  <input name="driverId" type="hidden" value={driver.id} />
                                  <button
                                    className="inline-flex items-center gap-1 text-sm font-semibold text-[var(--ink-muted)] transition hover:text-[var(--danger)]"
                                    type="submit"
                                  >
                                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                                    Archive
                                  </button>
                                </form>
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    ) : null}

                    <details className="rounded-md border border-[var(--border)] bg-white">
                      <summary className="cursor-pointer px-3 py-2 text-sm font-semibold text-[var(--primary)]">
                        Upload document
                      </summary>
                      <form action={uploadTransportDocument} className="grid gap-3 px-3 pb-3 pt-1">
                        <input name="driverId" type="hidden" value={driver.id} />
                        <input name="registryKey" type="hidden" value={requirement.registryKey} />
                        <input name="slotKey" type="hidden" value={requirement.slotKey} />
                        <div className="grid gap-3 sm:grid-cols-2">
                          <label className="space-y-2">
                            <span className="text-sm font-medium text-[var(--ink)]">Title</span>
                            <input className={inputClass} name="title" placeholder={requirement.label} />
                          </label>
                          <label className="space-y-2">
                            <span className="text-sm font-medium text-[var(--ink)]">File</span>
                            <input
                              accept="application/pdf,image/png,image/jpeg,image/webp,.doc,.docx"
                              className="block w-full text-sm text-[var(--ink)] file:mr-3 file:rounded-md file:border-0 file:bg-[var(--primary)] file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white"
                              name="file"
                              required
                              type="file"
                            />
                          </label>
                        </div>
                        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                          <label className="space-y-2">
                            <span className="text-sm font-medium text-[var(--ink)]">Issued date</span>
                            <input className={inputClass} name="issuedDate" type="date" />
                          </label>
                          <label className="space-y-2">
                            <span className="text-sm font-medium text-[var(--ink)]">
                              Expiry date{requirement.tracksExpiry ? "" : " (optional)"}
                            </span>
                            <input className={inputClass} name="expiryDate" type="date" />
                          </label>
                          <button
                            className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-white transition hover:bg-[var(--primary-strong)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                            type="submit"
                          >
                            <Upload className="h-4 w-4" aria-hidden="true" />
                            Upload
                          </button>
                        </div>
                      </form>
                    </details>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}

      <section className="mt-5 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-sm">
        <div className="border-b border-[var(--border)] bg-[var(--surface-muted)] px-4 py-3">
          <h2 className="flex items-center gap-2 text-base font-semibold text-[var(--ink)]">
            <Clock className="h-4 w-4 text-[var(--primary)]" aria-hidden="true" />
            Hours of Service &amp; Duty Status
          </h2>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">
            Alberta NSC availability from the duty-status log. Manual entry today; ELD import is planned.
          </p>
        </div>

        <div className="grid gap-4 px-4 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-[var(--ink-muted)]">
              Current status:{" "}
              <span className="font-semibold text-[var(--ink)]">
                {DUTY_STATUS_LABELS[availability.currentStatus]}
              </span>
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <form action={updateDriverHosRegime} className="flex items-center gap-2">
                <input name="driverId" type="hidden" value={driver.id} />
                <label className="text-sm font-medium text-[var(--ink)]" htmlFor="hos-regime">
                  Regime
                </label>
                <select className={`${inputClass} w-auto`} defaultValue={hosRegime} id="hos-regime" name="regime">
                  <option value="federal">{HOS_REGIME_LABELS.federal}</option>
                  <option value="provincial_ab">{HOS_REGIME_LABELS.provincial_ab}</option>
                </select>
                <button
                  className="inline-flex h-10 items-center justify-center rounded-md border border-[var(--border)] px-3 text-sm font-semibold text-[var(--primary)] transition hover:bg-[var(--surface-muted)]"
                  type="submit"
                >
                  Save
                </button>
              </form>
              {hosRegime === "federal" ? (
                <form action={updateDriverHosCycle} className="flex items-center gap-2">
                  <input name="driverId" type="hidden" value={driver.id} />
                  <label className="text-sm font-medium text-[var(--ink)]" htmlFor="hos-cycle">
                    Cycle
                  </label>
                  <select className={`${inputClass} w-auto`} defaultValue={hosCycle} id="hos-cycle" name="cycle">
                    <option value="cycle_1">Cycle 1 (70 h / 7 days)</option>
                    <option value="cycle_2">Cycle 2 (120 h / 14 days)</option>
                  </select>
                  <button
                    className="inline-flex h-10 items-center justify-center rounded-md border border-[var(--border)] px-3 text-sm font-semibold text-[var(--primary)] transition hover:bg-[var(--surface-muted)]"
                    type="submit"
                  >
                    Save
                  </button>
                </form>
              ) : null}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {hosClocks.map((clock) => (
              <div
                className="rounded-md border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-3 text-center"
                key={clock.label}
              >
                <p className="text-xs uppercase tracking-wide text-[var(--ink-muted)]">{clock.label}</p>
                <p
                  className={`mt-1 text-2xl font-bold ${
                    clock.value <= 0 ? "text-[var(--danger)]" : "text-[var(--ink)]"
                  }`}
                >
                  {clock.value}
                  <span className="text-sm font-medium text-[var(--ink-muted)]"> / {clock.of} h</span>
                </p>
              </div>
            ))}
          </div>

          {hosViolations.length > 0 ? (
            <ul className="grid gap-2">
              {hosViolations.map((violation, index) => (
                <li
                  className="flex items-start gap-2 rounded-md border border-[var(--danger)] bg-red-50 px-3 py-2 text-sm text-[var(--danger)]"
                  key={`${violation.type}-${index}`}
                >
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>
                    <span className="font-semibold">{violation.label}.</span> {violation.detail}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--success)]">
              <BadgeCheck className="h-4 w-4" aria-hidden="true" />
              No HOS violations in the current log.
            </p>
          )}

          {dailyLog.length > 0 ? (
            <div className="grid gap-3">
              <h3 className="text-sm font-semibold text-[var(--ink)]">Daily log</h3>
              {dailyLog.map((day) => (
                <div className="rounded-md border border-[var(--border)] p-3" key={day.date}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-[var(--ink)]">{formatDate(day.date)}</p>
                    <p className="text-xs text-[var(--ink-muted)]">
                      Off {day.totals.off_duty} h, SB {day.totals.sleeper_berth} h, Drive {day.totals.driving} h, On-duty{" "}
                      {day.totals.on_duty} h
                    </p>
                  </div>
                  <div className="mt-2 flex h-3 w-full overflow-hidden rounded bg-[var(--surface-muted)]">
                    {day.segments.map((segment, index) => (
                      <span
                        className={DUTY_STRIP_COLOR[segment.status] ?? "bg-[var(--surface-muted)]"}
                        key={`${day.date}-${index}`}
                        style={{ width: `${(segment.hours / 24) * 100}%` }}
                        title={`${DUTY_STATUS_LABELS[segment.status]} ${segment.hours} h`}
                      />
                    ))}
                  </div>
                </div>
              ))}
              <div className="flex flex-wrap gap-3 text-xs text-[var(--ink-muted)]">
                {(["off_duty", "sleeper_berth", "driving", "on_duty"] as const).map((status) => (
                  <span className="inline-flex items-center gap-1" key={status}>
                    <span className={`inline-block h-3 w-3 rounded-sm ${DUTY_STRIP_COLOR[status]}`} aria-hidden="true" />
                    {DUTY_STATUS_LABELS[status]}
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          {dutyEvents.length > 0 ? (
            <ul className="grid gap-2">
              {dutyEvents.slice(0, 12).map((event) => (
                <li
                  className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-[var(--surface-muted)] px-3 py-2"
                  key={event.id}
                >
                  <span className="inline-flex items-center gap-2 text-sm text-[var(--ink)]">
                    <span className="font-semibold">{DUTY_STATUS_LABELS[event.status]}</span>
                    <span className="text-xs text-[var(--ink-muted)]">{formatDateTime(event.started_at)}</span>
                    {event.location ? (
                      <span className="text-xs text-[var(--ink-muted)]">· {event.location}</span>
                    ) : null}
                    {event.source !== "manual" ? (
                      <span className="rounded-full bg-white px-2 py-0.5 text-xs uppercase tracking-wide text-[var(--ink-muted)]">
                        {event.source}
                      </span>
                    ) : null}
                  </span>
                  <form action={deleteDutyStatusEvent}>
                    <input name="eventId" type="hidden" value={event.id} />
                    <input name="driverId" type="hidden" value={driver.id} />
                    <button
                      className="inline-flex items-center gap-1 text-sm font-semibold text-[var(--ink-muted)] transition hover:text-[var(--danger)]"
                      type="submit"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                      Remove
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-[var(--ink-muted)]">No duty-status entries logged yet.</p>
          )}

          <details className="rounded-md border border-[var(--border)] bg-white">
            <summary className="cursor-pointer px-3 py-2 text-sm font-semibold text-[var(--primary)]">
              Log duty status
            </summary>
            <form action={addDutyStatusEvent} className="grid gap-3 px-3 pb-3 pt-1">
              <input name="driverId" type="hidden" value={driver.id} />
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-2">
                  <span className="text-sm font-medium text-[var(--ink)]">Status</span>
                  <select className={inputClass} defaultValue="driving" name="status">
                    <option value="off_duty">Off duty</option>
                    <option value="sleeper_berth">Sleeper berth</option>
                    <option value="driving">Driving</option>
                    <option value="on_duty">On duty (not driving)</option>
                  </select>
                </label>
                <label className="space-y-2">
                  <span className="text-sm font-medium text-[var(--ink)]">Start time</span>
                  <input className={inputClass} name="startedAt" required type="datetime-local" />
                </label>
              </div>
              <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                <label className="space-y-2">
                  <span className="text-sm font-medium text-[var(--ink)]">Location (optional)</span>
                  <input className={inputClass} name="location" placeholder="City / yard" />
                </label>
                <label className="space-y-2">
                  <span className="text-sm font-medium text-[var(--ink)]">Remark (optional)</span>
                  <input className={inputClass} name="remark" placeholder="Note" />
                </label>
                <button
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-white transition hover:bg-[var(--primary-strong)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                  type="submit"
                >
                  <Clock className="h-4 w-4" aria-hidden="true" />
                  Log
                </button>
              </div>
            </form>
          </details>

          <details className="rounded-md border border-[var(--border)] bg-white">
            <summary className="cursor-pointer px-3 py-2 text-sm font-semibold text-[var(--primary)]">
              Log local day (160 km exemption)
            </summary>
            <form action={addDailyTimeRecord} className="grid gap-3 px-3 pb-3 pt-1">
              <input name="driverId" type="hidden" value={driver.id} />
              <p className="text-xs text-[var(--ink-muted)]">
                For a 160 km local driver: record the time they reported to work and the time they were released. This
                is the time record the carrier keeps for 6 months, and it counts toward the driver&apos;s on-duty hours.
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-2">
                  <span className="text-sm font-medium text-[var(--ink)]">Reported to work</span>
                  <input className={inputClass} name="reportAt" required type="datetime-local" />
                </label>
                <label className="space-y-2">
                  <span className="text-sm font-medium text-[var(--ink)]">Released from work</span>
                  <input className={inputClass} name="releaseAt" required type="datetime-local" />
                </label>
              </div>
              <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                <label className="space-y-2">
                  <span className="text-sm font-medium text-[var(--ink)]">Start location (optional)</span>
                  <input className={inputClass} name="startLocation" placeholder="Home terminal" />
                </label>
                <label className="space-y-2">
                  <span className="text-sm font-medium text-[var(--ink)]">End location (optional)</span>
                  <input className={inputClass} name="endLocation" placeholder="Home terminal" />
                </label>
                <button
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-white transition hover:bg-[var(--primary-strong)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                  type="submit"
                >
                  <Clock className="h-4 w-4" aria-hidden="true" />
                  Log day
                </button>
              </div>
            </form>
          </details>

          <details className="rounded-md border border-[var(--border)] bg-white">
            <summary className="cursor-pointer px-3 py-2 text-sm font-semibold text-[var(--primary)]">
              Scan a paper log (AI assist)
            </summary>
            <div className="px-3 pb-3 pt-1">
              <HosLogScan driverId={driver.id} ready={hosOcrReady} />
            </div>
          </details>
        </div>
      </section>

      {canViewVault ? (
        <section className="mt-5 overflow-hidden rounded-lg border border-[var(--danger)] bg-[var(--surface)] shadow-sm">
          <div className="border-b border-[var(--border)] bg-red-50 px-4 py-3">
            <h2 className="flex items-center gap-2 text-base font-semibold text-[var(--ink)]">
              <Lock className="h-4 w-4 text-[var(--danger)]" aria-hidden="true" />
              Medical &amp; injury records (restricted)
            </h2>
            <p className="mt-1 text-sm text-[var(--ink-muted)]">
              Visible only to the medical vault role and the worker. Kept separate from the standard driver file.
            </p>
          </div>

          <div className="grid gap-3 px-4 py-4">
            {medicalRecords.length > 0 ? (
              <ul className="grid gap-2">
                {medicalRecords.map((record) => {
                  const signedUrl = record.storage_path ? medicalSignedUrlByPath.get(record.storage_path) : null;
                  return (
                    <li
                      className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-[var(--surface-muted)] px-3 py-2"
                      key={record.id}
                    >
                      <span className="inline-flex items-center gap-2 text-sm text-[var(--ink)]">
                        <FileText className="h-4 w-4 text-[var(--danger)]" aria-hidden="true" />
                        {record.title}
                        <span className="text-xs uppercase tracking-wide text-[var(--ink-muted)]">
                          {record.record_type.replaceAll("_", " ")}
                        </span>
                        {record.occurred_on ? (
                          <span className="text-xs text-[var(--ink-muted)]">{record.occurred_on.slice(0, 10)}</span>
                        ) : null}
                      </span>
                      <span className="flex items-center gap-3">
                        {signedUrl ? (
                          <a
                            className="inline-flex items-center gap-1 text-sm font-semibold text-[var(--primary)] hover:underline"
                            href={signedUrl}
                            rel="noreferrer"
                            target="_blank"
                          >
                            <Download className="h-4 w-4" aria-hidden="true" />
                            Open
                          </a>
                        ) : null}
                        {canManageVault ? (
                          <form action={archiveMedicalVaultRecord}>
                            <input name="recordId" type="hidden" value={record.id} />
                            <input name="driverId" type="hidden" value={driver.id} />
                            <button
                              className="inline-flex items-center gap-1 text-sm font-semibold text-[var(--ink-muted)] transition hover:text-[var(--danger)]"
                              type="submit"
                            >
                              <Trash2 className="h-4 w-4" aria-hidden="true" />
                              Archive
                            </button>
                          </form>
                        ) : null}
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-sm text-[var(--ink-muted)]">No medical or injury records on file.</p>
            )}

            {canManageVault ? (
              <details className="rounded-md border border-[var(--border)] bg-white">
                <summary className="cursor-pointer px-3 py-2 text-sm font-semibold text-[var(--primary)]">
                  Add record
                </summary>
                <form action={uploadMedicalVaultRecord} className="grid gap-3 px-3 pb-3 pt-1">
                  <input name="driverId" type="hidden" value={driver.id} />
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="space-y-2">
                      <span className="text-sm font-medium text-[var(--ink)]">Type</span>
                      <select className={inputClass} defaultValue="injury" name="recordType">
                        <option value="injury">Injury</option>
                        <option value="medical">Medical</option>
                        <option value="wcb">WCB claim</option>
                        <option value="first_aid">First aid</option>
                        <option value="other">Other</option>
                      </select>
                    </label>
                    <label className="space-y-2">
                      <span className="text-sm font-medium text-[var(--ink)]">Title</span>
                      <input className={inputClass} name="title" placeholder="Record title" />
                    </label>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="space-y-2">
                      <span className="text-sm font-medium text-[var(--ink)]">File</span>
                      <input
                        accept="application/pdf,image/png,image/jpeg,image/webp,.doc,.docx"
                        className="block w-full text-sm text-[var(--ink)] file:mr-3 file:rounded-md file:border-0 file:bg-[var(--danger)] file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white"
                        name="file"
                        required
                        type="file"
                      />
                    </label>
                    <label className="space-y-2">
                      <span className="text-sm font-medium text-[var(--ink)]">Date (optional)</span>
                      <input className={inputClass} name="occurredOn" type="date" />
                    </label>
                  </div>
                  <label className="space-y-2">
                    <span className="text-sm font-medium text-[var(--ink)]">Notes (optional)</span>
                    <textarea
                      className="min-h-16 w-full rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                      name="notes"
                    />
                  </label>
                  <button
                    className="inline-flex h-10 w-fit items-center justify-center gap-2 rounded-md bg-[var(--danger)] px-4 text-sm font-semibold text-white transition hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-[var(--danger)] focus:ring-offset-2"
                    type="submit"
                  >
                    <Upload className="h-4 w-4" aria-hidden="true" />
                    Save to vault
                  </button>
                </form>
              </details>
            ) : null}
          </div>
        </section>
      ) : null}
    </AdminShell>
  );
}
