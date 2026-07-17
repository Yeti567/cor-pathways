import Link from "next/link";
import { redirect } from "next/navigation";
import { CalendarClock, Camera, ClipboardList, Filter, UserRound, Wrench } from "lucide-react";
import { updateFollowUp } from "@/app/admin/actions";
import { AdminShell } from "@/app/admin/_components/AdminShell";
import { canUseAdminPanel, canUseDesktopMonitor } from "@/lib/access-control";
import { requireAppUser } from "@/lib/current-user";
import { followUpStatusClass, followUpStatusOptions, formatFollowUpStatus, isClosedFollowUpStatus } from "@/lib/follow-ups";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

export const dynamic = "force-dynamic";

type FollowUpsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

type FollowUpRow = Pick<
  Database["public"]["Tables"]["follow_ups"]["Row"],
  | "assigned_to"
  | "completed_at"
  | "created_at"
  | "description"
  | "due_at"
  | "form_item_id"
  | "id"
  | "parent_submission_id"
  | "photo_path"
  | "signoff_at"
  | "status"
  | "title"
  | "updated_at"
>;
type UserRow = Pick<Database["public"]["Tables"]["users"]["Row"], "active" | "email" | "full_name" | "id" | "power_level">;
type SubmissionRow = Pick<
  Database["public"]["Tables"]["submissions"]["Row"],
  "created_at" | "form_id" | "id" | "submitted_at" | "submitted_by"
>;
type FormRow = Pick<Database["public"]["Tables"]["forms"]["Row"], "code" | "id" | "name">;
type FormItemRow = Pick<Database["public"]["Tables"]["form_items"]["Row"], "id" | "label">;

const statusFilters = [{ value: "all", label: "All" }, ...followUpStatusOptions];

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function formatDate(value: string | null | undefined) {
  if (!value) {
    return "No date";
  }

  return new Intl.DateTimeFormat("en", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function toDateInputValue(value: string | null) {
  if (!value) {
    return "";
  }

  return value.slice(0, 10);
}

function isOverdue(followUp: FollowUpRow) {
  return Boolean(followUp.due_at && !isClosedFollowUpStatus(followUp.status) && new Date(followUp.due_at) < new Date());
}

function isStoragePath(path: string | null | undefined): path is string {
  return Boolean(path && !path.startsWith("data:"));
}

function photoUrlForPath(signedUrls: Map<string, string | null>, path: string | null | undefined) {
  if (!path) {
    return null;
  }

  if (path.startsWith("data:image/")) {
    return path;
  }

  return signedUrls.get(path) ?? null;
}

function statusFromParam(value: string) {
  return statusFilters.some((filter) => filter.value === value) ? value : "open";
}

export default async function FollowUpsPage({ searchParams }: FollowUpsPageProps) {
  const params = await searchParams;
  const status = statusFromParam(firstParam(params.status) ?? "open");
  const notice = firstParam(params.notice);
  const error = firstParam(params.error);
  const context = await requireAppUser();

  if (!canUseDesktopMonitor(context.appUser)) {
    redirect("/choose");
  }

  const supabase = await createSupabaseServerClient();
  const [{ data: followUps }, { data: users }] = await Promise.all([
    supabase
      .from("follow_ups")
      .select("id, title, description, status, assigned_to, due_at, completed_at, photo_path, signoff_at, parent_submission_id, form_item_id, created_at, updated_at")
      .eq("tenant_id", context.appUser.tenant_id)
      .order("created_at", { ascending: false })
      .limit(200)
      .returns<FollowUpRow[]>(),
    supabase
      .from("users")
      .select("id, full_name, email, power_level, active")
      .eq("tenant_id", context.appUser.tenant_id)
      .eq("active", true)
      .order("full_name")
      .returns<UserRow[]>(),
  ]);

  const followUpRows = followUps ?? [];
  const visibleFollowUps = status === "all" ? followUpRows : followUpRows.filter((followUp) => followUp.status === status);
  const parentSubmissionIds = Array.from(
    new Set(followUpRows.map((followUp) => followUp.parent_submission_id).filter((id): id is string => Boolean(id))),
  );
  const formItemIds = Array.from(
    new Set(followUpRows.map((followUp) => followUp.form_item_id).filter((id): id is string => Boolean(id))),
  );

  const [{ data: submissions }, { data: formItems }] = await Promise.all([
    parentSubmissionIds.length > 0
      ? supabase
          .from("submissions")
          .select("id, form_id, submitted_by, submitted_at, created_at")
          .eq("tenant_id", context.appUser.tenant_id)
          .in("id", parentSubmissionIds)
          .returns<SubmissionRow[]>()
      : Promise.resolve({ data: [] as SubmissionRow[] }),
    formItemIds.length > 0
      ? supabase
          .from("form_items")
          .select("id, label")
          .eq("tenant_id", context.appUser.tenant_id)
          .in("id", formItemIds)
          .returns<FormItemRow[]>()
      : Promise.resolve({ data: [] as FormItemRow[] }),
  ]);

  const formIds = Array.from(new Set((submissions ?? []).map((submission) => submission.form_id)));
  const { data: forms } =
    formIds.length > 0
      ? await supabase
          .from("forms")
          .select("id, name, code")
          .eq("tenant_id", context.appUser.tenant_id)
          .in("id", formIds)
          .returns<FormRow[]>()
      : { data: [] as FormRow[] };

  const userById = new Map((users ?? []).map((user) => [user.id, user]));
  const submissionById = new Map((submissions ?? []).map((submission) => [submission.id, submission]));
  const formById = new Map((forms ?? []).map((form) => [form.id, form]));
  const itemById = new Map((formItems ?? []).map((item) => [item.id, item]));
  const openCount = followUpRows.filter((followUp) => !isClosedFollowUpStatus(followUp.status)).length;
  const overdueCount = followUpRows.filter(isOverdue).length;
  const signedOffCount = followUpRows.filter((followUp) => followUp.status === "signed_off").length;
  const assignedCount = followUpRows.filter((followUp) => Boolean(followUp.assigned_to)).length;
  const followUpPhotoPaths = Array.from(new Set(followUpRows.map((followUp) => followUp.photo_path).filter(isStoragePath)));
  const followUpPhotoUrls = new Map<string, string | null>();

  await Promise.all(
    followUpPhotoPaths.map(async (path) => {
      const { data } = await supabase.storage.from("tenant-documents").createSignedUrl(path, 10 * 60);
      followUpPhotoUrls.set(path, data?.signedUrl ?? null);
    }),
  );

  return (
    <AdminShell
      eyebrow="Desktop workflow"
      monitorOnly={!canUseAdminPanel(context.appUser)}
      tenantName={context.tenant?.name ?? "Company profile"}
      title="Corrective Actions"
    >
      {notice ? (
        <div className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-[var(--success)]">
          {notice}
        </div>
      ) : null}
      {error ? (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-[var(--danger)]">
          {error}
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-4">
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
          <p className="text-sm text-[var(--ink-muted)]">Open work</p>
          <p className="mt-2 text-2xl font-bold text-[var(--ink)]">{openCount}</p>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
          <p className="text-sm text-[var(--ink-muted)]">Overdue</p>
          <p className="mt-2 text-2xl font-bold text-[var(--danger)]">{overdueCount}</p>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
          <p className="text-sm text-[var(--ink-muted)]">Assigned</p>
          <p className="mt-2 text-2xl font-bold text-[var(--ink)]">{assignedCount}</p>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
          <p className="text-sm text-[var(--ink-muted)]">Signed off</p>
          <p className="mt-2 text-2xl font-bold text-[var(--ink)]">{signedOffCount}</p>
        </div>
      </div>

      <form action="/admin/follow-ups" className="mt-5 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
        <label className="block space-y-2">
          <span className="text-sm font-medium text-[var(--ink)]">Status filter</span>
          <span className="flex flex-col gap-3 sm:flex-row">
            <select
              className="h-10 min-w-0 flex-1 rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
              defaultValue={status}
              name="status"
            >
              {statusFilters.map((filter) => (
                <option key={filter.value} value={filter.value}>
                  {filter.label}
                </option>
              ))}
            </select>
            <button
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-white transition hover:bg-[var(--primary-dark)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
              type="submit"
            >
              <Filter className="h-4 w-4" aria-hidden="true" />
              Apply
            </button>
          </span>
        </label>
      </form>

      <div className="mt-6 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-sm">
        <div className="flex flex-col gap-3 border-b border-[var(--border)] bg-[var(--surface-muted)] px-4 py-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-sm font-semibold uppercase text-[var(--ink-muted)]">Work Queue</h2>
            <p className="mt-1 text-sm text-[var(--ink-muted)]">
              {visibleFollowUps.length} items shown from {followUpRows.length} recent corrective actions.
            </p>
          </div>
          <Link
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-[var(--border)] bg-white px-3 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)]"
            href="/admin/monitor"
          >
            <ClipboardList className="h-4 w-4" aria-hidden="true" />
            Monitor
          </Link>
        </div>

        {visibleFollowUps.length > 0 ? (
          <div className="divide-y divide-[var(--border)]">
            {visibleFollowUps.map((followUp) => {
              const assignedUser = followUp.assigned_to ? userById.get(followUp.assigned_to) : null;
              const parentSubmission = followUp.parent_submission_id
                ? submissionById.get(followUp.parent_submission_id)
                : null;
              const sourceForm = parentSubmission ? formById.get(parentSubmission.form_id) : null;
              const sourceItem = followUp.form_item_id ? itemById.get(followUp.form_item_id) : null;
              const overdue = isOverdue(followUp);
              const photoUrl = photoUrlForPath(followUpPhotoUrls, followUp.photo_path);

              return (
                <article className="grid gap-4 p-4 xl:grid-cols-[minmax(0,1fr)_420px]" key={followUp.id}>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Wrench className="h-4 w-4 text-[var(--primary)]" aria-hidden="true" />
                      <h3 className="font-semibold text-[var(--ink)]">{followUp.title}</h3>
                      <span className={`rounded-md px-2 py-1 text-xs font-semibold ${followUpStatusClass(followUp.status)}`}>
                        {formatFollowUpStatus(followUp.status)}
                      </span>
                      {overdue ? (
                        <span className="rounded-md bg-red-50 px-2 py-1 text-xs font-semibold text-[var(--danger)]">
                          Overdue
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">
                      {followUp.description ?? "No description entered."}
                    </p>

                    <div className="mt-4 grid gap-3 text-sm text-[var(--ink-muted)] md:grid-cols-2">
                      <p className="inline-flex items-center gap-2">
                        <ClipboardList className="h-4 w-4 text-[var(--primary)]" aria-hidden="true" />
                        {sourceForm ? `${sourceForm.name} (${sourceForm.code})` : "Unknown source form"}
                      </p>
                      <p className="inline-flex items-center gap-2">
                        <UserRound className="h-4 w-4 text-[var(--primary)]" aria-hidden="true" />
                        {assignedUser?.full_name ?? "Unassigned"}
                      </p>
                      <p className="inline-flex items-center gap-2">
                        <CalendarClock className="h-4 w-4 text-[var(--primary)]" aria-hidden="true" />
                        Due {formatDate(followUp.due_at)}
                      </p>
                      <p className="truncate">Field: {sourceItem?.label ?? "Unknown field"}</p>
                    </div>
                    {followUp.photo_path ? (
                      <div className="mt-4 rounded-md border border-[var(--border)] bg-white p-3">
                        <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-[var(--ink)]">
                          <Camera className="h-4 w-4 text-[var(--primary)]" aria-hidden="true" />
                          Evidence photo
                        </div>
                        {photoUrl ? (
                          <a className="block w-fit" href={photoUrl} rel="noreferrer" target="_blank">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              alt={`${followUp.title} evidence`}
                              className="max-h-56 rounded-md border border-[var(--border)] object-contain"
                              src={photoUrl}
                            />
                          </a>
                        ) : (
                          <p className="text-sm text-[var(--ink-muted)]">Photo is attached and waiting for a signed storage link.</p>
                        )}
                      </div>
                    ) : null}
                  </div>

                  <form action={updateFollowUp} className="rounded-md border border-[var(--border)] bg-[var(--surface-muted)] p-3">
                    <input name="followUpId" type="hidden" value={followUp.id} />
                    <input name="returnStatus" type="hidden" value={status} />
                    <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-1">
                      <label className="space-y-1">
                        <span className="text-xs font-semibold uppercase text-[var(--ink-muted)]">Status</span>
                        <select
                          className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                          defaultValue={followUp.status}
                          name="status"
                        >
                          {followUpStatusOptions.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label className="space-y-1">
                        <span className="text-xs font-semibold uppercase text-[var(--ink-muted)]">Assignee</span>
                        <select
                          className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                          defaultValue={followUp.assigned_to ?? ""}
                          name="assignedTo"
                        >
                          <option value="">Unassigned</option>
                          {(users ?? []).map((user) => (
                            <option key={user.id} value={user.id}>
                              {user.full_name}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label className="space-y-1">
                        <span className="text-xs font-semibold uppercase text-[var(--ink-muted)]">Due date</span>
                        <input
                          className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                          defaultValue={toDateInputValue(followUp.due_at)}
                          name="dueAt"
                          type="date"
                        />
                      </label>
                    </div>
                    <button
                      className="mt-3 inline-flex h-10 w-full items-center justify-center rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-white transition hover:bg-[var(--primary-dark)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                      type="submit"
                    >
                      Save
                    </button>
                  </form>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="px-4 py-10 text-center">
            <Wrench className="mx-auto h-8 w-8 text-[var(--primary)]" aria-hidden="true" />
            <h2 className="mt-3 text-lg font-semibold text-[var(--ink)]">No corrective actions in this filter</h2>
            <p className="mt-1 text-sm text-[var(--ink-muted)]">Flagged form items will appear here after sync.</p>
          </div>
        )}
      </div>
    </AdminShell>
  );
}
