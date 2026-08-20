import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertTriangle, BriefcaseBusiness, Download, FileSpreadsheet, MapPin, PlusCircle, Search, Send, ShieldCheck, Upload, UserRound } from "lucide-react";
import { createWorker, importWorkersFromCsv, sendWorkerInvites } from "@/app/admin/actions";
import { AdminShell } from "@/app/admin/_components/AdminShell";
import {
  appAccessOptions,
  canUseAdminPanel,
  formatAccessLevel,
  formatPowerLevel,
  offlineSyncOptions,
  powerLevelOptions,
} from "@/lib/access-control";
import { buildCertificationDeficiencySummaries, sendCertificationExpiryNotifications } from "@/lib/certification-reminders";
import { requireAppUser, type PermissionProfileRow } from "@/lib/current-user";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { workerImportTemplateFilename, workerImportTemplateHeaders } from "@/lib/worker-import";
import type { Database } from "@/types/database";

export const dynamic = "force-dynamic";

type WorkersPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

type WorkerUserRow = Pick<
  Database["public"]["Tables"]["users"]["Row"],
  | "active"
  | "app_access"
  | "email"
  | "full_name"
  | "id"
  | "invite_accepted_at"
  | "invite_sent_at"
  | "permission_profile_id"
  | "power_level"
>;

type InviteState = "accepted" | "not_invited" | "pending";

/**
 * How far this worker has got with their invitation.
 *
 * Both columns sit on `public.users` precisely so this page can answer the
 * question under ordinary RLS. `auth.users` cannot answer it at all: somebody
 * entered and never emailed, and somebody emailed who ignored it, are the same
 * unconfirmed account there.
 */
function inviteState(user: Pick<WorkerUserRow, "invite_accepted_at" | "invite_sent_at">): InviteState {
  if (user.invite_accepted_at) {
    return "accepted";
  }

  return user.invite_sent_at ? "pending" : "not_invited";
}

const inviteStateLabels: Record<InviteState, string> = {
  accepted: "Signed up",
  not_invited: "Not invited",
  pending: "Invited, waiting",
};

const inviteStateStyles: Record<InviteState, string> = {
  accepted: "bg-emerald-50 text-emerald-700",
  not_invited: "bg-[var(--surface-muted)] text-[var(--ink-muted)]",
  pending: "bg-amber-50 text-amber-700",
};
type WorkerProfileRow = Pick<
  Database["public"]["Tables"]["worker_profiles"]["Row"],
  "id" | "phone" | "title" | "user_id"
>;
type UserLocationRow = Pick<Database["public"]["Tables"]["user_locations"]["Row"], "location_id" | "user_id">;
type CertificationRow = Pick<
  Database["public"]["Tables"]["certifications"]["Row"],
  "expires_on" | "id" | "name" | "worker_profile_id"
>;

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function includesQuery(values: (string | null | undefined)[], query: string) {
  if (!query) {
    return true;
  }

  const normalized = query.toLowerCase();
  return values.some((value) => (value ?? "").toLowerCase().includes(normalized));
}

export default async function WorkersPage({ searchParams }: WorkersPageProps) {
  const params = await searchParams;
  const notice = firstParam(params.notice);
  const error = firstParam(params.error);
  const query = firstParam(params.q)?.trim() ?? "";
  const status = firstParam(params.status) ?? "active";
  const context = await requireAppUser();
  const canInviteWorkers = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);

  if (!canUseAdminPanel(context.appUser)) {
    redirect("/choose");
  }

  const supabase = await createSupabaseServerClient();
  await sendCertificationExpiryNotifications(context.appUser.tenant_id);
  const [{ data: users }, { data: profiles }, { data: userLocations }, { data: certifications }, { data: profilesForSelect }] =
    await Promise.all([
      supabase
        .from("users")
        .select("id, email, full_name, power_level, app_access, permission_profile_id, active, invite_sent_at, invite_accepted_at")
        .eq("tenant_id", context.appUser.tenant_id)
        .order("full_name")
        .returns<WorkerUserRow[]>(),
      supabase
        .from("worker_profiles")
        .select("id, user_id, title, phone")
        .eq("tenant_id", context.appUser.tenant_id)
        .returns<WorkerProfileRow[]>(),
      supabase
        .from("user_locations")
        .select("user_id, location_id")
        .eq("tenant_id", context.appUser.tenant_id)
        .returns<UserLocationRow[]>(),
      supabase
        .from("certifications")
        .select("id, worker_profile_id, name, expires_on")
        .eq("tenant_id", context.appUser.tenant_id)
        .returns<CertificationRow[]>(),
      supabase
        .from("permission_profiles")
        .select("*")
        .eq("tenant_id", context.appUser.tenant_id)
        .order("name")
        .returns<PermissionProfileRow[]>(),
    ]);

  const profileByUserId = new Map((profiles ?? []).map((profile) => [profile.user_id, profile]));
  const locationCountByUserId = new Map<string, number>();
  const certificationCountByProfileId = new Map<string, number>();

  for (const userLocation of userLocations ?? []) {
    locationCountByUserId.set(userLocation.user_id, (locationCountByUserId.get(userLocation.user_id) ?? 0) + 1);
  }

  for (const certification of certifications ?? []) {
    certificationCountByProfileId.set(
      certification.worker_profile_id,
      (certificationCountByProfileId.get(certification.worker_profile_id) ?? 0) + 1,
    );
  }

  const visibleUsers = (users ?? []).filter((user) => {
    const profile = profileByUserId.get(user.id);
    const statusMatches =
      status === "all" || (status === "inactive" ? !user.active : user.active);

    return statusMatches && includesQuery([user.full_name, user.email, profile?.title, profile?.phone], query);
  });
  const defaultPermissionProfile =
    profilesForSelect?.find((profile) => profile.power_ceiling === "worker") ?? profilesForSelect?.[0] ?? null;
  const certificationDeficiencies = buildCertificationDeficiencySummaries({
    certifications: certifications ?? [],
    profiles: profiles ?? [],
    users: users ?? [],
  });
  const visibleCertificationDeficiencies = certificationDeficiencies.slice(0, 5);
  // Counted across the whole roster rather than the filtered view, because it is
  // the number the office is chasing, not a property of the current search.
  const notInvitedCount = (users ?? []).filter((user) => inviteState(user) === "not_invited").length;

  return (
    <AdminShell
      eyebrow="People operations"
      tenantName={context.tenant?.name ?? "Company profile"}
      title="Workers"
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

      <div className="grid gap-4 md:grid-cols-4">
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
          <p className="text-sm text-[var(--ink-muted)]">Workers</p>
          <p className="mt-2 text-2xl font-bold text-[var(--ink)]">{users?.length ?? 0}</p>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
          <p className="text-sm text-[var(--ink-muted)]">Active</p>
          <p className="mt-2 text-2xl font-bold text-[var(--ink)]">{(users ?? []).filter((user) => user.active).length}</p>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
          <p className="text-sm text-[var(--ink-muted)]">Location assignments</p>
          <p className="mt-2 text-2xl font-bold text-[var(--ink)]">{userLocations?.length ?? 0}</p>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
          <p className="text-sm text-[var(--ink-muted)]">Certifications</p>
          <p className="mt-2 text-2xl font-bold text-[var(--ink)]">{certifications?.length ?? 0}</p>
        </div>
      </div>

      <div className="mt-5 grid gap-4 xl:grid-cols-[1fr_380px]">
        <section className="min-w-0 space-y-4">
          <form action="/admin/workers" className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
            <div className="grid gap-3 md:grid-cols-[1fr_180px_auto]">
              <label className="space-y-2">
                <span className="text-sm font-medium text-[var(--ink)]">Search workers</span>
                <span className="relative block">
                  <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-[var(--ink-muted)]" aria-hidden="true" />
                  <input
                    className="h-10 w-full rounded-md border border-[var(--border)] bg-white pl-9 pr-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                    defaultValue={query}
                    name="q"
                    placeholder="name, title, phone"
                    type="search"
                  />
                </span>
              </label>
              <label className="space-y-2">
                <span className="text-sm font-medium text-[var(--ink)]">Status</span>
                <select
                  className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                  defaultValue={status}
                  name="status"
                >
                  <option value="active">Show Active</option>
                  <option value="inactive">Show Inactive</option>
                  <option value="all">Show All</option>
                </select>
              </label>
              <button
                className="inline-flex h-10 items-center justify-center gap-2 self-end rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-white transition hover:bg-[var(--primary-dark)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                type="submit"
              >
                <Search className="h-4 w-4" aria-hidden="true" />
                Apply
              </button>
            </div>
          </form>

          {/* One form around the whole table, so ticking rows and pressing send is
              a single post. The filter form above is a sibling rather than a
              parent: nested forms are not valid html and the browser drops the
              inner one, which would silently break the send. */}
          <form action={sendWorkerInvites}>
            <div className="mb-3 flex flex-wrap items-center gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-3 shadow-sm">
              <Send className="h-4 w-4 shrink-0 text-[var(--primary)]" aria-hidden="true" />
              <p className="min-w-0 flex-1 text-sm text-[var(--ink-muted)]">
                Adding a worker does not email them. Tick the people who are ready to be invited and send when it
                suits you.
                {notInvitedCount > 0 ? (
                  <span className="font-semibold text-[var(--ink)]">
                    {" "}
                    {notInvitedCount} {notInvitedCount === 1 ? "worker has" : "workers have"} never been invited.
                  </span>
                ) : null}
              </p>
              <button
                className="inline-flex h-9 items-center gap-2 rounded-md bg-[var(--primary)] px-3 text-sm font-semibold text-white transition hover:bg-[var(--primary-dark)] disabled:cursor-not-allowed disabled:opacity-50"
                disabled={!canInviteWorkers}
                title={
                  canInviteWorkers
                    ? "Emails an invitation to every worker ticked below."
                    : "Set SUPABASE_SERVICE_ROLE_KEY to send invitations."
                }
                type="submit"
              >
                <Send className="h-4 w-4" aria-hidden="true" />
                Send invitations
              </button>
            </div>

            <div className="overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-sm">
            <div className="grid min-w-[76rem] grid-cols-[auto_1.6fr_1.1fr_0.9fr_1.4fr_0.5fr_0.85fr_1fr_1fr_auto] gap-4 border-b border-[var(--border)] bg-[var(--surface-muted)] px-4 py-3 text-xs font-semibold uppercase text-[var(--ink-muted)] max-2xl:hidden">
              <span className="sr-only">Invite</span>
              <span>Name</span>
              <span>Title</span>
              <span>Access</span>
              <span>App Permission</span>
              <span>Locations</span>
              <span>Tickets</span>
              <span>Mobile</span>
              <span>Invitation</span>
              <span>Profile</span>
            </div>
            <div className="divide-y divide-[var(--border)]">
              {visibleUsers.map((user) => {
                const profile = profileByUserId.get(user.id);
                const certificationCount = profile ? certificationCountByProfileId.get(profile.id) ?? 0 : 0;
                const state = inviteState(user);

                return (
                  <div
                    className="grid gap-4 px-4 py-4 2xl:min-w-[76rem] 2xl:grid-cols-[auto_1.6fr_1.1fr_0.9fr_1.4fr_0.5fr_0.85fr_1fr_1fr_auto] 2xl:items-center"
                    key={user.id}
                  >
                    <label className="flex items-center gap-2 text-sm text-[var(--ink-muted)]">
                      <input
                        className="h-4 w-4 rounded border-[var(--border)]"
                        disabled={!canInviteWorkers}
                        name="userIds"
                        type="checkbox"
                        value={user.id}
                      />
                      <span className="2xl:sr-only">Invite {user.full_name}</span>
                    </label>
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-[var(--surface-muted)] text-[var(--primary)]">
                        <UserRound className="h-5 w-5" aria-hidden="true" />
                      </div>
                      <div className="min-w-0">
                        <Link className="block truncate font-semibold text-[var(--ink)] hover:text-[var(--primary)]" href={`/admin/workers/${user.id}`}>
                          {user.full_name}
                        </Link>
                        <p className="truncate text-sm text-[var(--ink-muted)]">{user.email}</p>
                      </div>
                    </div>
                    <p className="truncate text-sm text-[var(--ink)]">{profile?.title ?? "Not set"}</p>
                    <p className="text-sm text-[var(--ink)]">{formatPowerLevel(user.power_level)}</p>
                    <p className="text-sm text-[var(--ink)]">{formatAccessLevel(user.app_access)}</p>
                    <p className="inline-flex items-center gap-2 text-sm text-[var(--ink-muted)]">
                      <MapPin className="h-4 w-4 text-[var(--primary)]" aria-hidden="true" />
                      {locationCountByUserId.get(user.id) ?? 0}
                    </p>
                    <Link
                      className="inline-flex h-9 w-fit items-center gap-2 rounded-md border border-[var(--border)] bg-white px-3 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)] hover:text-[var(--primary)]"
                      href={`/admin/workers/${user.id}?tab=certifications`}
                    >
                      <ShieldCheck className="h-4 w-4 text-[var(--primary)]" aria-hidden="true" />
                      {certificationCount} {certificationCount === 1 ? "ticket" : "tickets"}
                    </Link>
                    <p className="truncate text-sm text-[var(--ink-muted)]">{profile?.phone ?? "Not set"}</p>
                    <span
                      className={`inline-flex w-fit items-center rounded-md px-2 py-1 text-xs font-semibold ${inviteStateStyles[state]}`}
                    >
                      {inviteStateLabels[state]}
                    </span>
                    <Link
                      className="inline-flex h-9 items-center justify-center rounded-md border border-[var(--border)] bg-white px-3 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)]"
                      href={`/admin/workers/${user.id}`}
                    >
                      Profile
                    </Link>
                  </div>
                );
              })}
              {visibleUsers.length === 0 ? (
                <div className="px-4 py-10 text-center text-sm text-[var(--ink-muted)]">No workers match the current filters.</div>
              ) : null}
            </div>
            </div>
          </form>
        </section>

        <aside className="space-y-4">
          <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-md bg-red-50 text-[var(--danger)]">
                <AlertTriangle className="h-5 w-5" aria-hidden="true" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-[var(--ink)]">Certification Deficiencies</h2>
                <p className="text-sm text-[var(--ink-muted)]">
                  {certificationDeficiencies.length} expired ticket{certificationDeficiencies.length === 1 ? "" : "s"}
                </p>
              </div>
            </div>
            {visibleCertificationDeficiencies.length > 0 ? (
              <div className="mt-4 grid gap-2">
                {visibleCertificationDeficiencies.map((deficiency) => (
                  <Link
                    className="rounded-md border border-[var(--border)] bg-white p-3 transition hover:bg-[var(--surface-muted)]"
                    href={deficiency.workerUserId ? `/admin/workers/${deficiency.workerUserId}?tab=certifications` : "/admin/workers"}
                    key={deficiency.certificationId}
                  >
                    <p className="text-sm font-semibold text-[var(--ink)]">{deficiency.workerName}</p>
                    <p className="text-sm text-[var(--ink-muted)]">{deficiency.name}</p>
                    <p className="mt-1 text-xs font-semibold text-[var(--danger)]">
                      Expired {deficiency.daysExpired} day{deficiency.daysExpired === 1 ? "" : "s"} ago
                    </p>
                  </Link>
                ))}
                {certificationDeficiencies.length > visibleCertificationDeficiencies.length ? (
                  <p className="text-xs text-[var(--ink-muted)]">
                    {certificationDeficiencies.length - visibleCertificationDeficiencies.length} more deficiencies hidden.
                  </p>
                ) : null}
              </div>
            ) : (
              <p className="mt-4 rounded-md border border-dashed border-[var(--border)] p-3 text-sm text-[var(--ink-muted)]">
                No expired certification tickets are currently recorded.
              </p>
            )}
          </section>

          {!canInviteWorkers ? (
            <div className="rounded-lg border border-[var(--warning)] bg-amber-50 p-4 text-sm leading-6 text-[var(--warning)] shadow-sm">
              Worker invite tools need the service role key in this local server. Add
              {" "}
              <span className="font-semibold">SUPABASE_SERVICE_ROLE_KEY</span>
              {" "}
              to
              {" "}
              <span className="font-semibold">.env.local</span>
              {" "}
              and restart the dev server, or use the deployed Vercel app.
            </div>
          ) : null}

          <form
            action={createWorker}
            className="h-fit rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm"
          >
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-md bg-[var(--surface-muted)] text-[var(--primary)]">
              <PlusCircle className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-[var(--ink)]">New Worker</h2>
              <p className="text-sm text-[var(--ink-muted)]">Invite a worker and create their profile.</p>
            </div>
          </div>

          <div className="mt-5 grid gap-4">
            <label className="space-y-2">
              <span className="text-sm font-medium text-[var(--ink)]">Full name</span>
              <input
                className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                name="fullName"
                required
              />
            </label>
            <label className="space-y-2">
              <span className="text-sm font-medium text-[var(--ink)]">Email</span>
              <input
                className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                name="email"
                required
                type="email"
              />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-2">
                <span className="text-sm font-medium text-[var(--ink)]">Title</span>
                <input
                  className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                  name="title"
                  placeholder="Laborer"
                />
              </label>
              <label className="space-y-2">
                <span className="text-sm font-medium text-[var(--ink)]">Mobile number</span>
                <input
                  className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                  name="phone"
                  type="tel"
                />
              </label>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-2">
                <span className="text-sm font-medium text-[var(--ink)]">Access</span>
                <select
                  className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                  defaultValue="app_access"
                  name="appAccess"
                >
                  {appAccessOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-2">
                <span className="text-sm font-medium text-[var(--ink)]">Power level</span>
                <select
                  className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                  defaultValue="worker"
                  name="powerLevel"
                >
                  {powerLevelOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="space-y-2">
              <span className="text-sm font-medium text-[var(--ink)]">Permission profile</span>
              <select
                className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                defaultValue={defaultPermissionProfile?.id ?? ""}
                name="permissionProfileId"
              >
                <option value="">No profile</option>
                {(profilesForSelect ?? []).map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-2">
              <span className="text-sm font-medium text-[var(--ink)]">Offline sync</span>
              <select
                className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                defaultValue={30}
                name="offlineSyncDays"
              >
                {offlineSyncOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <button
            className="mt-5 inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-white transition hover:bg-[var(--primary-dark)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2 disabled:cursor-not-allowed disabled:bg-[var(--ink-muted)] disabled:opacity-70 disabled:hover:bg-[var(--ink-muted)]"
            disabled={!canInviteWorkers}
            type="submit"
          >
            <BriefcaseBusiness className="h-4 w-4" aria-hidden="true" />
            Invite Worker
          </button>
          </form>

          <form
            action={importWorkersFromCsv}
            className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-md bg-[var(--surface-muted)] text-[var(--primary)]">
                  <FileSpreadsheet className="h-5 w-5" aria-hidden="true" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-[var(--ink)]">Bulk Import</h2>
                  <p className="text-sm text-[var(--ink-muted)]">Upload a completed worker CSV.</p>
                </div>
              </div>
              <a
                className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-[var(--border)] bg-white px-3 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)] hover:text-[var(--primary)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                download={workerImportTemplateFilename}
                href="/admin/workers/import-template"
              >
                <Download className="h-4 w-4" aria-hidden="true" />
                CSV Template
              </a>
            </div>

            <div className="mt-5 grid gap-4">
              <label className="space-y-2">
                <span className="text-sm font-medium text-[var(--ink)]">CSV file</span>
                <input
                  accept=".csv,text/csv"
                  className="block w-full rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm text-[var(--ink)] file:mr-3 file:rounded-md file:border-0 file:bg-[var(--surface-muted)] file:px-3 file:py-2 file:text-sm file:font-semibold file:text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                  disabled={!canInviteWorkers}
                  name="csv"
                  required
                  type="file"
                />
              </label>
              <div className="space-y-2 rounded-md border border-[var(--border)] bg-[var(--surface-muted)] p-3 text-xs leading-5 text-[var(--ink-muted)]">
                <p>File type: CSV only (.csv). Save Excel sheets as CSV before uploading.</p>
                <p>Required headers: email and full_name. Optional headers can be left blank.</p>
                <p className="break-words font-mono text-[var(--ink)]">
                  {workerImportTemplateHeaders.join(", ")}
                </p>
              </div>
            </div>

            <button
              className="mt-5 inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-white transition hover:bg-[var(--primary-dark)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2 disabled:cursor-not-allowed disabled:bg-[var(--ink-muted)] disabled:opacity-70 disabled:hover:bg-[var(--ink-muted)]"
              disabled={!canInviteWorkers}
              type="submit"
            >
              <Upload className="h-4 w-4" aria-hidden="true" />
              Import CSV
            </button>
          </form>
        </aside>
      </div>
    </AdminShell>
  );
}
