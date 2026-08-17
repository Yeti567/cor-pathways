import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  BadgeCheck,
  BriefcaseBusiness,
  CalendarDays,
  Camera,
  FileText,
  IdCard,
  KeyRound,
  MapPin,
  Paperclip,
  Save,
  Send,
  Trash2,
  UserRound,
} from "lucide-react";
import {
  createWorkerCertification,
  deleteWorkerCertification,
  resendWorkerInvite,
  updateWorkerAccess,
  updateWorkerLocations,
  updateWorkerProfile,
} from "@/app/admin/actions";
import { AdminShell } from "@/app/admin/_components/AdminShell";
import {
  appAccessOptions,
  canManageAccess,
  canUseAdminPanel,
  formatAccessLevel,
  formatPowerLevel,
  formatReachType,
  formatSyncDays,
  offlineSyncOptions,
  powerLevelOptions,
  reachOptions,
} from "@/lib/access-control";
import { requireAppUser, type PermissionProfileRow } from "@/lib/current-user";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  certificationStatus,
  certificationStatusClass,
  coerceWorkerDetailTab,
  parseEmergencyContacts,
  workerDetailTabs,
} from "@/lib/workers";
import { hasAttachedProof } from "@/lib/proof-status";
import type { Database } from "@/types/database";

export const dynamic = "force-dynamic";

type WorkerDetailPageProps = {
  params: Promise<{ userId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

type WorkerUserRow = Database["public"]["Tables"]["users"]["Row"];
type WorkerProfileRow = Database["public"]["Tables"]["worker_profiles"]["Row"];
type LocationRow = Pick<Database["public"]["Tables"]["locations"]["Row"], "code" | "id" | "name">;
type UserLocationRow = Pick<Database["public"]["Tables"]["user_locations"]["Row"], "location_id">;
type CertificationTypeRow = Database["public"]["Tables"]["certification_types"]["Row"];
type CertificationRow = Database["public"]["Tables"]["certifications"]["Row"];
type SubmissionRow = Pick<
  Database["public"]["Tables"]["submissions"]["Row"],
  "created_at" | "form_id" | "id" | "location_id" | "status" | "submitted_at" | "sync_state"
>;
type FormRow = Pick<Database["public"]["Tables"]["forms"]["Row"], "code" | "id" | "name">;
type SignatureRow = Pick<Database["public"]["Tables"]["signatures"]["Row"], "id" | "submission_id">;
type RegisterRow = Pick<Database["public"]["Tables"]["document_control_register"]["Row"], "dcn" | "source_id" | "source_table">;

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
  }).format(new Date(value));
}

function signedPathUrl(
  urls: Map<string, string | null>,
  path: string | null | undefined,
) {
  return path ? urls.get(path) ?? null : null;
}

function isImageAttachmentPath(path: string | null | undefined) {
  return /\.(avif|gif|jpe?g|png|webp)$/i.test(path ?? "");
}

export default async function WorkerDetailPage({ params, searchParams }: WorkerDetailPageProps) {
  const [{ userId }, pageParams] = await Promise.all([params, searchParams]);
  const notice = firstParam(pageParams.notice);
  const error = firstParam(pageParams.error);
  const activeTab = coerceWorkerDetailTab(firstParam(pageParams.tab));
  const context = await requireAppUser();

  if (!canUseAdminPanel(context.appUser)) {
    redirect("/choose");
  }

  const supabase = await createSupabaseServerClient();
  const storageSupabase = createSupabaseAdminClient() ?? supabase;
  const [{ data: worker }, { data: profile }] = await Promise.all([
    supabase
      .from("users")
      .select("*")
      .eq("id", userId)
      .eq("tenant_id", context.appUser.tenant_id)
      .maybeSingle<WorkerUserRow>(),
    supabase
      .from("worker_profiles")
      .select("*")
      .eq("user_id", userId)
      .eq("tenant_id", context.appUser.tenant_id)
      .maybeSingle<WorkerProfileRow>(),
  ]);

  if (!worker) {
    redirect(
      `/admin/workers?error=${encodeURIComponent(
        "Worker record not found or is no longer available.",
      )}`,
    );
  }

  const [
    { data: permissionProfiles },
    { data: locations },
    { data: assignedLocations },
    { data: certificationTypes },
    { data: certifications },
    { data: submissions },
  ] = await Promise.all([
    supabase
      .from("permission_profiles")
      .select("*")
      .eq("tenant_id", context.appUser.tenant_id)
      .order("name")
      .returns<PermissionProfileRow[]>(),
    supabase
      .from("locations")
      .select("id, name, code")
      .eq("tenant_id", context.appUser.tenant_id)
      .order("name")
      .returns<LocationRow[]>(),
    supabase
      .from("user_locations")
      .select("location_id")
      .eq("tenant_id", context.appUser.tenant_id)
      .eq("user_id", userId)
      .returns<UserLocationRow[]>(),
    supabase
      .from("certification_types")
      .select("*")
      .eq("tenant_id", context.appUser.tenant_id)
      .order("name")
      .returns<CertificationTypeRow[]>(),
    profile?.id
      ? supabase
          .from("certifications")
          .select("*")
          .eq("tenant_id", context.appUser.tenant_id)
          .eq("worker_profile_id", profile.id)
          .order("expires_on", { ascending: true })
          .returns<CertificationRow[]>()
      : Promise.resolve({ data: [] as CertificationRow[] }),
    supabase
      .from("submissions")
      .select("id, form_id, location_id, status, sync_state, submitted_at, created_at")
      .eq("tenant_id", context.appUser.tenant_id)
      .eq("submitted_by", userId)
      .order("created_at", { ascending: false })
      .limit(20)
      .returns<SubmissionRow[]>(),
  ]);

  const formIds = Array.from(new Set((submissions ?? []).map((submission) => submission.form_id)));
  const submissionIds = (submissions ?? []).map((submission) => submission.id);
  const [{ data: forms }, { data: signatures }, { data: documentRows }] =
    formIds.length > 0
      ? await Promise.all([
          supabase
            .from("forms")
            .select("id, name, code")
            .eq("tenant_id", context.appUser.tenant_id)
            .in("id", formIds)
            .returns<FormRow[]>(),
          submissionIds.length > 0
            ? supabase
                .from("signatures")
                .select("id, submission_id")
                .eq("tenant_id", context.appUser.tenant_id)
                .in("submission_id", submissionIds)
                .returns<SignatureRow[]>()
            : Promise.resolve({ data: [] as SignatureRow[] }),
          supabase
            .from("document_control_register")
            .select("source_id, source_table, dcn")
            .eq("tenant_id", context.appUser.tenant_id)
            .eq("source_table", "forms")
            .in("source_id", formIds)
            .returns<RegisterRow[]>(),
        ])
      : [{ data: [] as FormRow[] }, { data: [] as SignatureRow[] }, { data: [] as RegisterRow[] }];
  const formById = new Map((forms ?? []).map((form) => [form.id, form]));
  const locationById = new Map((locations ?? []).map((location) => [location.id, location]));
  const dcnByFormId = new Map((documentRows ?? []).map((document) => [document.source_id, document.dcn]));
  const signatureCountBySubmissionId = new Map<string, number>();

  for (const signature of signatures ?? []) {
    signatureCountBySubmissionId.set(
      signature.submission_id,
      (signatureCountBySubmissionId.get(signature.submission_id) ?? 0) + 1,
    );
  }

  const assignedLocationIds = new Set((assignedLocations ?? []).map((location) => location.location_id));
  const emergencyContact = parseEmergencyContacts(profile?.emergency_contacts ?? [])[0];
  const attachmentPaths = [
    profile?.photo_path,
    ...(certifications ?? []).map((certification) => certification.attachment_path),
  ].filter((path): path is string => Boolean(path));
  const signedUrls = new Map<string, string | null>();

  await Promise.all(
    attachmentPaths.map(async (path) => {
      const { data } = await storageSupabase.storage.from("tenant-documents").createSignedUrl(path, 10 * 60);
      signedUrls.set(path, data?.signedUrl ?? null);
    }),
  );

  const photoUrl = signedPathUrl(signedUrls, profile?.photo_path);
  const canEditAccess = canManageAccess(context.appUser);

  return (
    <AdminShell
      eyebrow="Worker profile"
      tenantName={context.tenant?.name ?? "Company profile"}
      title={worker.full_name}
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

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Link
          className="inline-flex h-9 items-center rounded-md border border-[var(--border)] bg-white px-3 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)]"
          href="/admin/workers"
        >
          Back to Workers
        </Link>
        <span className="rounded-md bg-[var(--surface-muted)] px-2 py-1 text-xs font-semibold text-[var(--ink-muted)]">
          {formatPowerLevel(worker.power_level)}
        </span>
        <span className="rounded-md bg-[var(--surface-muted)] px-2 py-1 text-xs font-semibold text-[var(--ink-muted)]">
          {formatAccessLevel(worker.app_access)}
        </span>
        <span className="rounded-md bg-[var(--surface-muted)] px-2 py-1 text-xs font-semibold text-[var(--ink-muted)]">
          {formatReachType(worker.reach_type)}
        </span>
        <form action={resendWorkerInvite} className="ml-auto">
          <input type="hidden" name="userId" value={userId} />
          <button
            className="inline-flex h-9 items-center gap-2 rounded-md border border-[var(--border)] bg-white px-3 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)] hover:text-[var(--primary)]"
            title="Emails this worker a fresh sign-in link. Use it when the first invite never arrived."
            type="submit"
          >
            <Send className="h-4 w-4 text-[var(--primary)]" aria-hidden="true" />
            Resend invite
          </button>
        </form>
      </div>

      <div className="grid gap-6 xl:grid-cols-[220px_1fr]">
        <aside className="h-fit rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2 shadow-sm">
          {workerDetailTabs.map((tab) => {
            const active = activeTab === tab.value;

            return (
              <Link
                className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm font-semibold transition ${
                  active
                    ? "bg-[var(--surface-muted)] text-[var(--primary)]"
                    : "text-[var(--ink-muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--ink)]"
                }`}
                href={`/admin/workers/${userId}?tab=${tab.value}`}
                key={tab.value}
              >
                {tab.value === "profile" ? <UserRound className="h-4 w-4" aria-hidden="true" /> : null}
                {tab.value === "access" ? <KeyRound className="h-4 w-4" aria-hidden="true" /> : null}
                {tab.value === "certifications" ? <BadgeCheck className="h-4 w-4" aria-hidden="true" /> : null}
                {tab.value === "locations" ? <MapPin className="h-4 w-4" aria-hidden="true" /> : null}
                {tab.value === "signed-documents" ? <FileText className="h-4 w-4" aria-hidden="true" /> : null}
                {tab.label}
              </Link>
            );
          })}
        </aside>

        <section>
          {activeTab === "profile" ? (
            <form
              action={updateWorkerProfile}
              className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm"
            >
              <input name="userId" type="hidden" value={userId} />
              <div className="grid gap-5 xl:grid-cols-[1fr_180px]">
                <div className="grid gap-4 md:grid-cols-2">
                  <label className="space-y-2">
                    <span className="text-sm font-medium text-[var(--ink)]">Full name</span>
                    <input
                      className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                      defaultValue={worker.full_name}
                      name="fullName"
                      required
                    />
                  </label>
                  <label className="space-y-2">
                    <span className="text-sm font-medium text-[var(--ink)]">Job title</span>
                    <input
                      className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                      defaultValue={profile?.title ?? ""}
                      name="title"
                    />
                  </label>
                  <label className="space-y-2">
                    <span className="text-sm font-medium text-[var(--ink)]">Email</span>
                    <input
                      className="h-10 w-full rounded-md border border-[var(--border)] bg-[var(--surface-muted)] px-3 text-sm text-[var(--ink-muted)]"
                      defaultValue={worker.email}
                      disabled
                    />
                  </label>
                  <label className="space-y-2">
                    <span className="text-sm font-medium text-[var(--ink)]">Phone number</span>
                    <input
                      className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                      defaultValue={profile?.phone ?? ""}
                      name="phone"
                      type="tel"
                    />
                  </label>
                  <label className="space-y-2">
                    <span className="text-sm font-medium text-[var(--ink)]">Employee number</span>
                    <input
                      className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                      defaultValue={profile?.employee_number ?? ""}
                      name="employeeNumber"
                    />
                  </label>
                  <label className="space-y-2">
                    <span className="text-sm font-medium text-[var(--ink)]">Date hired</span>
                    <input
                      className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                      defaultValue={profile?.hired_on ?? ""}
                      name="hiredOn"
                      type="date"
                    />
                  </label>
                </div>
                <div className="rounded-md border border-[var(--border)] bg-[var(--surface-muted)] p-4">
                  <div className="flex aspect-square items-center justify-center rounded-md border border-[var(--border)] bg-white">
                    {photoUrl ? (
                      <Image alt={`${worker.full_name} profile photo`} className="h-full w-full rounded-md object-cover" height={160} src={photoUrl} unoptimized width={160} />
                    ) : (
                      <Camera className="h-8 w-8 text-[var(--ink-muted)]" aria-hidden="true" />
                    )}
                  </div>
                  <label className="mt-3 block space-y-2">
                    <span className="text-sm font-medium text-[var(--ink)]">Profile photo</span>
                    <input
                      accept="image/png,image/jpeg,image/webp"
                      className="block w-full text-sm text-[var(--ink-muted)] file:mr-3 file:rounded-md file:border-0 file:bg-white file:px-3 file:py-2 file:text-sm file:font-semibold file:text-[var(--ink)]"
                      name="photo"
                      type="file"
                    />
                  </label>
                </div>
              </div>

              <section className="mt-6 rounded-md border border-[var(--border)] bg-white p-4">
                <div className="flex items-center gap-2">
                  <IdCard className="h-4 w-4 text-[var(--primary)]" aria-hidden="true" />
                  <h2 className="text-sm font-semibold text-[var(--ink)]">Emergency Contact</h2>
                </div>
                <div className="mt-4 grid gap-4 md:grid-cols-3">
                  <label className="space-y-2">
                    <span className="text-sm font-medium text-[var(--ink)]">Name</span>
                    <input
                      className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                      defaultValue={emergencyContact?.name ?? ""}
                      name="emergencyContactName"
                    />
                  </label>
                  <label className="space-y-2">
                    <span className="text-sm font-medium text-[var(--ink)]">Phone</span>
                    <input
                      className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                      defaultValue={emergencyContact?.phone ?? ""}
                      name="emergencyContactPhone"
                    />
                  </label>
                  <label className="space-y-2">
                    <span className="text-sm font-medium text-[var(--ink)]">Relationship</span>
                    <input
                      className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                      defaultValue={emergencyContact?.relationship ?? ""}
                      name="emergencyContactRelationship"
                    />
                  </label>
                </div>
              </section>

              <button
                className="mt-5 inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-white transition hover:bg-[var(--primary-dark)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                type="submit"
              >
                <Save className="h-4 w-4" aria-hidden="true" />
                Save Profile
              </button>
            </form>
          ) : null}

          {activeTab === "access" ? (
            <form action={updateWorkerAccess} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
              <input name="userId" type="hidden" value={userId} />
              <div className="flex items-center gap-3">
                <KeyRound className="h-5 w-5 text-[var(--primary)]" aria-hidden="true" />
                <div>
                  <h2 className="text-lg font-semibold text-[var(--ink)]">App Access</h2>
                  <p className="text-sm text-[var(--ink-muted)]">
                    Current sync window: {formatSyncDays(worker.offline_sync_days)}.
                  </p>
                </div>
              </div>
              <fieldset disabled={!canEditAccess} className="mt-5 grid gap-4 md:grid-cols-2">
                <label className="space-y-2">
                  <span className="text-sm font-medium text-[var(--ink)]">Access</span>
                  <select className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm" defaultValue={worker.app_access} name="appAccess">
                    {appAccessOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-2">
                  <span className="text-sm font-medium text-[var(--ink)]">Power level</span>
                  <select className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm" defaultValue={worker.power_level} name="powerLevel">
                    {powerLevelOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-2">
                  <span className="text-sm font-medium text-[var(--ink)]">Permission profile</span>
                  <select className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm" defaultValue={worker.permission_profile_id ?? ""} name="permissionProfileId">
                    <option value="">No profile</option>
                    {(permissionProfiles ?? []).map((permissionProfile) => (
                      <option key={permissionProfile.id} value={permissionProfile.id}>
                        {permissionProfile.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-2">
                  <span className="text-sm font-medium text-[var(--ink)]">Reach</span>
                  <select className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm" defaultValue={worker.reach_type} name="reachType">
                    {reachOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-2">
                  <span className="text-sm font-medium text-[var(--ink)]">Offline sync</span>
                  <select className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm" defaultValue={worker.offline_sync_days} name="offlineSyncDays">
                    {offlineSyncOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              </fieldset>
              <button
                className="mt-5 inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-white transition hover:bg-[var(--primary-dark)] disabled:cursor-not-allowed disabled:opacity-50"
                disabled={!canEditAccess}
                type="submit"
              >
                <Save className="h-4 w-4" aria-hidden="true" />
                Save Access
              </button>
            </form>
          ) : null}

          {activeTab === "certifications" ? (
            <div className="grid gap-5">
              <form
                action={createWorkerCertification}
                className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm"
              >
                <input name="userId" type="hidden" value={userId} />
                <div className="flex items-center gap-3">
                  <BadgeCheck className="h-5 w-5 text-[var(--primary)]" aria-hidden="true" />
                  <div>
                    <h2 className="text-lg font-semibold text-[var(--ink)]">Add Certification</h2>
                    <p className="text-sm text-[var(--ink-muted)]">Attach a certificate, card, or training record.</p>
                  </div>
                </div>
                <div className="mt-5 grid gap-4 lg:grid-cols-2">
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                      <label className="text-sm font-medium text-[var(--ink)]" htmlFor="certificationTypeId">
                        Certification type
                      </label>
                      <Link className="text-xs font-semibold text-[var(--primary)] hover:underline" href="/admin/certification-types">
                        Set these up
                      </Link>
                    </div>
                    <select
                      className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm"
                      id="certificationTypeId"
                      name="certificationTypeId"
                    >
                      <option value="">Manual entry</option>
                      {(certificationTypes ?? []).map((certificationType) => (
                        <option key={certificationType.id} value={certificationType.id}>
                          {certificationType.name}
                        </option>
                      ))}
                    </select>
                    {(certificationTypes ?? []).length === 0 ? (
                      <span className="block text-xs text-[var(--ink-muted)]">
                        No certification types yet. Add reusable names in{" "}
                        <Link className="font-semibold text-[var(--primary)] hover:underline" href="/admin/certification-types">
                          Certification Types
                        </Link>
                        , or leave this on Manual entry and type the name.
                      </span>
                    ) : null}
                  </div>
                  <label className="space-y-2">
                    <span className="text-sm font-medium text-[var(--ink)]">Name</span>
                    <input className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm" name="name" placeholder="Auto from type if blank" />
                  </label>
                  <label className="space-y-2">
                    <span className="text-sm font-medium text-[var(--ink)]">Issued on</span>
                    <input className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm" name="issuedOn" type="date" />
                  </label>
                  <label className="space-y-2">
                    <span className="text-sm font-medium text-[var(--ink)]">Expires on</span>
                    <input className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm" name="expiresOn" type="date" />
                  </label>
                  <label className="space-y-2 lg:col-span-2">
                    <span className="text-sm font-medium text-[var(--ink)]">Attachment</span>
                    <input
                      accept=".pdf,image/png,image/jpeg,image/webp,application/pdf"
                      className="block h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-[var(--surface-muted)] file:px-3 file:py-1 file:text-sm file:font-semibold"
                      name="attachment"
                      type="file"
                    />
                  </label>
                </div>
                <button className="mt-5 inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-white" type="submit">
                  <BriefcaseBusiness className="h-4 w-4" aria-hidden="true" />
                  Add Certification
                </button>
              </form>

              <div className="grid gap-4 lg:grid-cols-3">
                {(certifications ?? []).map((certification) => {
                  const status = certificationStatus(
                    certification.expires_on,
                    undefined,
                    hasAttachedProof(certification.attachment_path),
                  );
                  const attachmentUrl = signedPathUrl(signedUrls, certification.attachment_path);
                  const showImagePreview = attachmentUrl && isImageAttachmentPath(certification.attachment_path);

                  return (
                    <article className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm" key={certification.id}>
                      <div className="flex aspect-[4/3] items-center justify-center rounded-md border border-[var(--border)] bg-[var(--surface-muted)]">
                        {showImagePreview ? (
                          <Image
                            alt={`${certification.name} ticket`}
                            className="h-full w-full rounded-md object-contain"
                            height={180}
                            src={attachmentUrl}
                            unoptimized
                            width={240}
                          />
                        ) : (
                          <BadgeCheck className="h-9 w-9 text-[var(--primary)]" aria-hidden="true" />
                        )}
                      </div>
                      <h2 className="mt-4 line-clamp-2 font-semibold text-[var(--ink)]">{certification.name}</h2>
                      <p className="mt-2 text-sm text-[var(--ink-muted)]">
                        {formatDate(certification.issued_on)} to {formatDate(certification.expires_on)}
                      </p>
                      <span className={`mt-3 inline-flex rounded-md px-2 py-1 text-xs font-semibold ${certificationStatusClass(status.tone)}`}>
                        {status.label}
                      </span>
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        {attachmentUrl ? (
                          <a
                            className="inline-flex h-9 items-center gap-2 rounded-md border border-[var(--border)] bg-white px-3 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)]"
                            href={attachmentUrl}
                            rel="noreferrer"
                            target="_blank"
                          >
                            <Paperclip className="h-4 w-4" aria-hidden="true" />
                            Open Attachment
                          </a>
                        ) : null}
                        <form action={deleteWorkerCertification}>
                          <input name="certificationId" type="hidden" value={certification.id} />
                          <input name="workerUserId" type="hidden" value={userId} />
                          <button
                            className="inline-flex h-9 items-center gap-2 rounded-md border border-[var(--danger)] bg-red-50 px-3 text-sm font-semibold text-[var(--danger)] transition hover:bg-[var(--danger)] hover:text-white focus:outline-none focus:ring-2 focus:ring-[var(--danger)] focus:ring-offset-2"
                            title="Delete this certification"
                            type="submit"
                          >
                            <Trash2 className="h-4 w-4" aria-hidden="true" />
                            Delete
                          </button>
                        </form>
                      </div>
                    </article>
                  );
                })}
                {(certifications ?? []).length === 0 ? (
                  <div className="rounded-lg border border-dashed border-[var(--border)] bg-[var(--surface)] p-8 text-center text-sm text-[var(--ink-muted)] lg:col-span-3">
                    No certifications recorded for this worker.
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}

          {activeTab === "locations" ? (
            <form action={updateWorkerLocations} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
              <input name="userId" type="hidden" value={userId} />
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-[var(--ink)]">Current Locations</h2>
                  <p className="text-sm text-[var(--ink-muted)]">{assignedLocationIds.size} assigned locations.</p>
                  {!canEditAccess ? (
                    <p className="mt-1 text-sm text-[var(--ink-muted)]">
                      Access management permission is required to change assigned locations.
                    </p>
                  ) : null}
                </div>
                <MapPin className="h-5 w-5 text-[var(--primary)]" aria-hidden="true" />
              </div>
              <fieldset className="mt-5 divide-y divide-[var(--border)] rounded-md border border-[var(--border)]" disabled={!canEditAccess}>
                {(locations ?? []).map((location) => (
                  <label className="flex min-h-12 items-center gap-3 px-3 text-sm text-[var(--ink)]" key={location.id}>
                    <input
                      className="h-4 w-4 accent-[var(--primary)]"
                      defaultChecked={assignedLocationIds.has(location.id)}
                      name="locationIds"
                      type="checkbox"
                      value={location.id}
                    />
                    {location.name}
                    <span className="text-xs text-[var(--ink-muted)]">{location.code}</span>
                  </label>
                ))}
                {(locations ?? []).length === 0 ? (
                  <div className="p-6 text-center text-sm text-[var(--ink-muted)]">No locations exist yet.</div>
                ) : null}
              </fieldset>
              <button
                className="mt-5 inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                disabled={!canEditAccess}
                type="submit"
              >
                <Save className="h-4 w-4" aria-hidden="true" />
                Save Locations
              </button>
            </form>
          ) : null}

          {activeTab === "signed-documents" ? (
            <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
              <div className="flex items-center gap-3">
                <FileText className="h-5 w-5 text-[var(--primary)]" aria-hidden="true" />
                <div>
                  <h2 className="text-lg font-semibold text-[var(--ink)]">Signed Documents</h2>
                  <p className="text-sm text-[var(--ink-muted)]">Recent submissions signed or submitted by this worker.</p>
                </div>
              </div>
              <div className="mt-5 divide-y divide-[var(--border)] rounded-md border border-[var(--border)]">
                {(submissions ?? []).map((submission) => {
                  const form = formById.get(submission.form_id);
                  const location = submission.location_id ? locationById.get(submission.location_id) : null;
                  const signatureCount = signatureCountBySubmissionId.get(submission.id) ?? 0;
                  const dcn = dcnByFormId.get(submission.form_id);

                  return (
                    <div className="grid gap-3 px-3 py-3 xl:grid-cols-[1.1fr_140px_120px_120px_120px] xl:items-center" key={submission.id}>
                      <div>
                        <p className="font-semibold text-[var(--ink)]">{form?.name ?? "Submitted form"}</p>
                        <p className="text-sm text-[var(--ink-muted)]">{dcn ?? form?.code ?? submission.form_id}</p>
                      </div>
                      <p className="inline-flex items-center gap-2 text-sm text-[var(--ink-muted)]">
                        <MapPin className="h-4 w-4 text-[var(--primary)]" aria-hidden="true" />
                        {location?.name ?? "No location"}
                      </p>
                      <p className="inline-flex items-center gap-2 text-sm text-[var(--ink-muted)]">
                        <CalendarDays className="h-4 w-4 text-[var(--primary)]" aria-hidden="true" />
                        {formatDate(submission.submitted_at ?? submission.created_at)}
                      </p>
                      <span className="w-fit rounded-md bg-[var(--surface-muted)] px-2 py-1 text-xs font-semibold text-[var(--ink-muted)]">
                        {signatureCount} signatures
                      </span>
                      <span className="w-fit rounded-md bg-[var(--surface-muted)] px-2 py-1 text-xs font-semibold text-[var(--ink-muted)]">
                        {submission.sync_state}
                      </span>
                    </div>
                  );
                })}
                {(submissions ?? []).length === 0 ? (
                  <div className="p-8 text-center text-sm text-[var(--ink-muted)]">No signed documents found.</div>
                ) : null}
              </div>
            </section>
          ) : null}
        </section>
      </div>
    </AdminShell>
  );
}
